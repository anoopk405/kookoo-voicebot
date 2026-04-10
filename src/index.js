const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { CallHandler } = require('./call-handler');
const { samplesToBase64, base64ToChunks, samplesToBase64_24k, base64ToChunks_24k, buildMediaPacket } = require('./audio');
const { ElevenLabsSession } = require('./elevenlabs');
const { OpenAIRealtimeSession } = require('./openai-realtime');

class KooKooVoiceBot {
  /**
   * Create a new KooKoo voice bot.
   *
   * @param {object} config
   * @param {string} config.sipNumber        - KooKoo SIP registration number
   * @param {string} [config.provider]       - 'elevenlabs' (default) or 'openai'
   * @param {number} [config.port]           - Server port (default: process.env.PORT || 3000)
   * @param {string} [config.wsUrl]          - Override WebSocket URL (auto-detected on Railway)
   *
   * ElevenLabs config (when provider = 'elevenlabs'):
   * @param {string} config.elevenlabs.agentId - ElevenLabs Conversational AI agent ID
   * @param {string} [config.elevenlabs.apiKey] - ElevenLabs API key
   *
   * OpenAI config (when provider = 'openai'):
   * @param {string} config.openai.apiKey      - OpenAI API key
   * @param {string} [config.openai.model]     - Model (default: 'gpt-4o-realtime-preview')
   * @param {string} [config.openai.voice]     - Voice: 'alloy','echo','fable','onyx','nova','shimmer' (default: 'alloy')
   * @param {string} [config.openai.instructions] - System prompt for the agent
   * @param {Array}  [config.openai.tools]     - Function calling tools array
   *
   * @param {object} [hooks] - Lifecycle hooks (same for both providers)
   */
  constructor(config, hooks) {
    const provider = config.provider || (config.openai ? 'openai' : 'elevenlabs');

    this.config = {
      sipNumber: config.sipNumber || process.env.SIP_NUMBER || '0000',
      wsUrl: config.wsUrl || process.env.WEBSOCKET_URL || '',
      port: config.port || parseInt(process.env.PORT) || 3000,
      provider,
      elevenlabs: {
        agentId: config.elevenlabs?.agentId || process.env.ELEVENLABS_AGENT_ID || '',
        apiKey: config.elevenlabs?.apiKey || process.env.ELEVENLABS_API_KEY || '',
      },
      openai: {
        apiKey: config.openai?.apiKey || process.env.OPENAI_API_KEY || '',
        model: config.openai?.model || process.env.OPENAI_MODEL || 'gpt-4o-realtime-preview',
        voice: config.openai?.voice || process.env.OPENAI_VOICE || 'alloy',
        instructions: config.openai?.instructions || '',
        tools: config.openai?.tools || [],
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

    this.app.get('/', (req, res) => {
      res.json({
        status: 'ok',
        service: 'kookoo-voicebot',
        provider: this.config.provider,
        activeCalls: this.handlers.size,
      });
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', provider: this.config.provider, activeCalls: this.handlers.size });
    });

    this.app.all('/kookoo', (req, res) => this._handleIVR(req, res));
    this.app.post('/kookoo/cdr', (req, res) => {
      if (this.hooks.onCDR) this.hooks.onCDR(req.body);
      res.json({ status: 'ok' });
    });
  }

  use(...args) {
    this.app.use(...args);
    return this;
  }

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

  async start() {
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const id = crypto.randomUUID();
      const handler = new CallHandler(ws, this.config, this.hooks);
      this.handlers.set(id, handler);

      ws.on('message', (raw) => handler.handleMessage(raw.toString()));
      ws.on('close', () => { handler.cleanup(); this.handlers.delete(id); });
      ws.on('error', (err) => {
        if (this.hooks.onError) this.hooks.onError({ ucid: handler.ucid, error: err });
      });
    });

    return new Promise((resolve) => {
      this.server.listen(this.config.port, '0.0.0.0', () => {
        console.log(`[KooKooVoiceBot] Provider: ${this.config.provider}`);
        console.log(`[KooKooVoiceBot] Listening on port ${this.config.port}`);
        console.log(`[KooKooVoiceBot] IVR webhook: /kookoo`);
        console.log(`[KooKooVoiceBot] WebSocket:   /ws`);
        resolve(this.server);
      });
    });
  }

  async stop() {
    for (const [, handler] of this.handlers) handler.cleanup();
    this.handlers.clear();
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }
}

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

module.exports = {
  KooKooVoiceBot, xml,
  CallHandler, ElevenLabsSession, OpenAIRealtimeSession,
  samplesToBase64, base64ToChunks, samplesToBase64_24k, base64ToChunks_24k, buildMediaPacket,
};
