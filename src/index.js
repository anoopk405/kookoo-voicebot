const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { CallHandler } = require('./call-handler');
const { samplesToBase64, base64ToChunks, buildMediaPacket } = require('./audio');
const { ElevenLabsSession } = require('./elevenlabs');

class KooKooVoiceBot {
  /**
   * Create a new KooKoo voice bot.
   *
   * @param {object} config
   * @param {string} config.sipNumber      - KooKoo SIP registration number
   * @param {string} config.elevenlabs.agentId - ElevenLabs Conversational AI agent ID
   * @param {string} [config.elevenlabs.apiKey] - ElevenLabs API key (for private agents)
   * @param {number} [config.port]         - Server port (default: process.env.PORT || 3000)
   * @param {string} [config.wsUrl]        - Override WebSocket URL (auto-detected on Railway)
   * @param {object} [hooks]               - Lifecycle hooks
   * @param {function} [hooks.onCallStart]  - ({ucid, did, metadata}) => void
   * @param {function} [hooks.onCallEnd]    - ({ucid}) => void
   * @param {function} [hooks.onTranscript] - ({ucid, role, text, isFinal}) => void
   * @param {function} [hooks.onToolCall]   - ({ucid, name, params, id}) => result
   * @param {function} [hooks.onInterrupt]  - ({ucid}) => void
   * @param {function} [hooks.onError]      - ({ucid, error}) => void
   * @param {function} [hooks.getInitData]  - ({ucid, did}) => object (sent to ElevenLabs on connect)
   * @param {function} [hooks.onPostStream] - ({ucid, req}) => xmlString (custom XML after stream ends)
   */
  constructor(config, hooks) {
    this.config = {
      sipNumber: config.sipNumber || process.env.SIP_NUMBER || '0000',
      wsUrl: config.wsUrl || process.env.WEBSOCKET_URL || '',
      port: config.port || parseInt(process.env.PORT) || 3000,
      elevenlabs: {
        agentId: config.elevenlabs?.agentId || process.env.ELEVENLABS_AGENT_ID || '',
        apiKey: config.elevenlabs?.apiKey || process.env.ELEVENLABS_API_KEY || '',
      },
    };
    this.hooks = hooks || {};
    this.handlers = new Map();
    this.app = express();
    this.server = null;
    this.wss = null;

    this._setupExpress();
  }

  _setupExpress() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Health check
    this.app.get('/', (req, res) => {
      res.json({ status: 'ok', service: 'kookoo-voicebot', activeCalls: this.handlers.size });
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', activeCalls: this.handlers.size });
    });

    // KooKoo IVR webhook
    this.app.all('/kookoo', (req, res) => this._handleIVR(req, res));
    this.app.post('/kookoo/cdr', (req, res) => {
      if (this.hooks.onCDR) this.hooks.onCDR(req.body);
      res.json({ status: 'ok' });
    });
  }

  /**
   * Mount additional Express middleware or routes.
   * @param  {...any} args - Same args as express.use()
   */
  use(...args) {
    this.app.use(...args);
    return this;
  }

  /**
   * Access the underlying Express app for advanced routing.
   */
  getExpressApp() {
    return this.app;
  }

  _resolveWsUrl(req) {
    if (this.config.wsUrl && !this.config.wsUrl.includes('your-')) return this.config.wsUrl;
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || req.get('host') || '';
    return domain ? `wss://${domain}` : '';
  }

  _handleIVR(req, res) {
    const params = { ...req.query, ...req.body };
    const event = params.event || '';
    const sid = params.sid || '';
    const processParam = params.process || '';

    if (event === 'NewCall') {
      const wsUrl = this._resolveWsUrl(req);
      const uuiJson = JSON.stringify(params).replace(/'/g, '&apos;');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <start-record/>
    <stream is_sip="true" url="${wsUrl}/ws" x-uui='${uuiJson}'>${this.config.sipNumber}</stream>
</response>`;

      res.set('Content-Type', 'text/xml');
      return res.send(xml);
    }

    if (event === 'Stream') {
      // Stream ended — call still active, return next action XML
      let xml;
      if (this.hooks.onPostStream) {
        xml = this.hooks.onPostStream({ ucid: sid, req, params });
      }
      if (!xml) {
        xml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <playtext lang="en-IN" speed="3" quality="best" type="ggl">Thank you for calling. Goodbye.</playtext>
    <hangup/>
</response>`;
      }
      res.set('Content-Type', 'text/xml');
      return res.send(xml);
    }

    if ((event === 'Hangup' && processParam) || event === 'Disconnect' || event === 'Hangup') {
      return res.sendStatus(200);
    }

    res.sendStatus(200);
  }

  /**
   * Start the server.
   * @returns {Promise<http.Server>}
   */
  async start() {
    this.server = http.createServer(this.app);

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const id = crypto.randomUUID();
      const handler = new CallHandler(ws, this.config, this.hooks);
      this.handlers.set(id, handler);

      ws.on('message', (raw) => handler.handleMessage(raw.toString()));

      ws.on('close', () => {
        handler.cleanup();
        this.handlers.delete(id);
      });

      ws.on('error', (err) => {
        if (this.hooks.onError) this.hooks.onError({ ucid: handler.ucid, error: err });
      });
    });

    return new Promise((resolve) => {
      this.server.listen(this.config.port, '0.0.0.0', () => {
        console.log(`[KooKooVoiceBot] Listening on port ${this.config.port}`);
        console.log(`[KooKooVoiceBot] IVR webhook: /kookoo`);
        console.log(`[KooKooVoiceBot] WebSocket:   /ws`);
        resolve(this.server);
      });
    });
  }

  /**
   * Stop the server.
   */
  async stop() {
    for (const [, handler] of this.handlers) handler.cleanup();
    this.handlers.clear();
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }
}

// XML helper for building post-stream responses
const xml = {
  playAndHangup(text, lang = 'en-IN') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <playtext lang="${lang}" speed="3" quality="best" type="ggl">${text}</playtext>
    <hangup/>
</response>`;
  },

  transfer(number, record = true) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <dial record="${record}">${number}</dial>
</response>`;
  },

  ccTransfer(queue, department = '', timeout = 30) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <cctransfer record="" moh="default" uui="${department}" timeout="${timeout}" ringType="ring">${queue}</cctransfer>
</response>`;
  },

  hangup() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<response>\n    <hangup/>\n</response>`;
  },
};

module.exports = { KooKooVoiceBot, xml, CallHandler, ElevenLabsSession, samplesToBase64, base64ToChunks, buildMediaPacket };
