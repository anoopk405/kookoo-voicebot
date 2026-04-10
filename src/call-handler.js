const crypto = require('crypto');
const { ElevenLabsSession } = require('./elevenlabs');
const { OpenAIRealtimeSession } = require('./openai-realtime');
const { samplesToBase64, base64ToChunks, samplesToBase64_24k, base64ToChunks_24k, buildMediaPacket } = require('./audio');

class CallHandler {
  constructor(kookooWs, config, hooks) {
    this.ws = kookooWs;
    this.config = config;
    this.hooks = hooks || {};
    this.ucid = null;
    this.did = null;
    this.callId = null;
    this.metadata = {};
    this.aiSession = null;
    this.provider = config.provider || 'elevenlabs';
    this.audioQueue = [];
    this.pumpTimer = null;
    this.pumping = false;
    this.pendingMarks = new Map(); // seqid -> timestamp
  }

  async handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const event = msg.event || '';

    if (event === 'start') {
      this.ucid = msg.ucid || '';
      this.did = msg.did || '';
      this.callId = msg.call_id || '';
      this.metadata = msg;

      // Parse x_headers for rich caller data
      let callerDetails = {};
      if (msg.x_headers) {
        try {
          callerDetails = typeof msg.x_headers === 'string'
            ? JSON.parse(msg.x_headers) : msg.x_headers;
        } catch { /* ignore */ }
      }

      if (this.hooks.onCallStart) {
        await this.hooks.onCallStart({
          ucid: this.ucid,
          did: this.did,
          callerId: this.callId || callerDetails.cid || '',
          callerDetails,
          metadata: msg,
        });
      }

      this._connectAI();

    } else if (event === 'media' && msg.type === 'media') {
      const data = msg.data || {};
      if (data.sampleRate === 16000) return; // skip calibration packet
      if (this.aiSession?.connected && data.samples?.length) {
        if (this.provider === 'openai') {
          this.aiSession.sendAudio(samplesToBase64_24k(data.samples));
        } else {
          this.aiSession.sendAudio(samplesToBase64(data.samples));
        }
      }

    } else if (event === 'mark' && msg.type === 'ack') {
      // KooKoo acknowledges our audio packet was played
      this.pendingMarks.delete(msg.seqid);
      if (this.hooks.onMark) {
        this.hooks.onMark({ ucid: this.ucid, seqid: msg.seqid, timestamp: msg.timestamp });
      }

    } else if (event === 'stop') {
      if (this.hooks.onCallEnd) {
        await this.hooks.onCallEnd({ ucid: this.ucid });
      }
    }
  }

  _connectAI() {
    const commonCallbacks = {
      onAudio: (b64) => this._onAgentAudio(b64),
      onTranscript: (t) => {
        if (this.hooks.onTranscript) this.hooks.onTranscript({ ucid: this.ucid, ...t });
      },
      onToolCall: (tool) => {
        if (this.hooks.onToolCall) return this.hooks.onToolCall({ ucid: this.ucid, ...tool });
        return { success: true };
      },
      onInterrupt: () => {
        this.audioQueue = [];
        this.pendingMarks.clear();
        this._stopPump();
        this._sendCommand('clearBuffer');
        if (this.hooks.onInterrupt) this.hooks.onInterrupt({ ucid: this.ucid });
      },
      onError: (err) => {
        if (this.hooks.onError) this.hooks.onError({ ucid: this.ucid, error: err });
      },
    };

    if (this.provider === 'openai') {
      const openaiCfg = this.config.openai || {};
      this.aiSession = new OpenAIRealtimeSession({
        apiKey: openaiCfg.apiKey,
        model: openaiCfg.model,
        instructions: openaiCfg.instructions || '',
        voice: openaiCfg.voice || 'alloy',
        tools: openaiCfg.tools || [],
        ...commonCallbacks,
      });
    } else {
      const initData = {};
      if (this.hooks.getInitData) {
        Object.assign(initData, this.hooks.getInitData({ ucid: this.ucid, did: this.did }));
      }
      this.aiSession = new ElevenLabsSession({
        agentId: this.config.elevenlabs.agentId,
        apiKey: this.config.elevenlabs.apiKey,
        initData,
        ...commonCallbacks,
      });
    }

    this.aiSession.connect();
  }

  _onAgentAudio(b64) {
    const chunks = this.provider === 'openai'
      ? base64ToChunks_24k(b64)
      : base64ToChunks(b64);
    this.audioQueue.push(...chunks);
    this._startPump();
  }

  _startPump() {
    if (this.pumping) return;
    this.pumping = true;
    this.pumpTimer = setInterval(() => {
      if (this.audioQueue.length === 0) { this._stopPump(); return; }
      const chunk = this.audioQueue.shift();
      const seqid = crypto.randomUUID();
      const packet = buildMediaPacket(this.ucid, chunk, seqid);
      this.pendingMarks.set(seqid, Date.now());
      try {
        if (this.ws.readyState === 1) {
          this.ws.send(packet);
        }
      } catch { /* ignore */ }
    }, 10);
  }

  _stopPump() {
    if (this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
    this.pumping = false;
  }

  _sendCommand(command) {
    try {
      if (this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ command }));
      }
    } catch { /* ignore */ }
  }

  disconnect() {
    this._sendCommand('callDisconnect');
  }

  cleanup() {
    this._stopPump();
    this.pendingMarks.clear();
    if (this.aiSession) this.aiSession.close();
  }
}

module.exports = { CallHandler };
