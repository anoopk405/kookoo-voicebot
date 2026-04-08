const { ElevenLabsSession } = require('./elevenlabs');
const { samplesToBase64, base64ToChunks, buildMediaPacket } = require('./audio');

class CallHandler {
  constructor(kookooWs, config, hooks) {
    this.ws = kookooWs;
    this.config = config;
    this.hooks = hooks || {};
    this.ucid = null;
    this.did = null;
    this.metadata = {};
    this.el = null;
    this.audioQueue = [];
    this.pumpTimer = null;
    this.pumping = false;
  }

  async handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const event = msg.event || '';

    if (event === 'start') {
      this.ucid = msg.ucid || '';
      this.did = msg.did || '';
      this.metadata = msg;

      if (this.hooks.onCallStart) {
        await this.hooks.onCallStart({ ucid: this.ucid, did: this.did, metadata: msg });
      }

      this._connectElevenLabs();

    } else if (event === 'media' && msg.type === 'media') {
      const data = msg.data || {};
      if (data.sampleRate === 16000) return; // skip calibration packet
      if (this.el?.connected && data.samples?.length) {
        this.el.sendAudio(samplesToBase64(data.samples));
      }

    } else if (event === 'stop') {
      if (this.hooks.onCallEnd) {
        await this.hooks.onCallEnd({ ucid: this.ucid });
      }
    }
  }

  _connectElevenLabs() {
    const initData = {};
    if (this.hooks.getInitData) {
      Object.assign(initData, this.hooks.getInitData({ ucid: this.ucid, did: this.did }));
    }

    this.el = new ElevenLabsSession({
      agentId: this.config.elevenlabs.agentId,
      apiKey: this.config.elevenlabs.apiKey,
      initData,
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
        this._stopPump();
        this._sendCommand('clearBuffer');
        if (this.hooks.onInterrupt) this.hooks.onInterrupt({ ucid: this.ucid });
      },
      onError: (err) => {
        if (this.hooks.onError) this.hooks.onError({ ucid: this.ucid, error: err });
      },
    });

    this.el.connect();
  }

  _onAgentAudio(b64) {
    this.audioQueue.push(...base64ToChunks(b64));
    this._startPump();
  }

  _startPump() {
    if (this.pumping) return;
    this.pumping = true;
    this.pumpTimer = setInterval(() => {
      if (this.audioQueue.length === 0) { this._stopPump(); return; }
      const chunk = this.audioQueue.shift();
      try {
        if (this.ws.readyState === 1) {
          this.ws.send(buildMediaPacket(this.ucid, chunk));
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
    if (this.el) this.el.close();
  }
}

module.exports = { CallHandler };
