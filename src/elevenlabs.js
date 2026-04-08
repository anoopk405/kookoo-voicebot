const WebSocket = require('ws');

const CONV_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';

class ElevenLabsSession {
  constructor(opts) {
    this.agentId = opts.agentId;
    this.apiKey = opts.apiKey;
    this.initData = opts.initData || {};
    this.onAudio = opts.onAudio;
    this.onTranscript = opts.onTranscript;
    this.onToolCall = opts.onToolCall;
    this.onInterrupt = opts.onInterrupt;
    this.onError = opts.onError;
    this.ws = null;
    this.connected = false;
    this.conversationId = null;
  }

  connect() {
    const url = `${CONV_URL}?agent_id=${this.agentId}`;
    this.ws = new WebSocket(url, {
      headers: this.apiKey ? { 'xi-api-key': this.apiKey } : {},
    });

    this.ws.on('open', () => {
      this.connected = true;
      if (Object.keys(this.initData).length > 0) {
        this._send({
          type: 'conversation_initiation_client_data',
          ...this.initData,
        });
      }
    });

    this.ws.on('message', (raw) => {
      try { this._handle(JSON.parse(raw.toString())); }
      catch (e) { /* ignore parse errors */ }
    });

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      if (code !== 1000 && code !== 1005) {
        const err = new Error(`ElevenLabs closed: ${code} ${reason}`);
        if (this.onError) this.onError(err);
      }
    });

    this.ws.on('error', (err) => {
      if (this.onError) this.onError(err);
    });
  }

  _handle(msg) {
    switch (msg.type) {
      case 'conversation_initiation_metadata':
        this.conversationId = msg.conversation_initiation_metadata_event?.conversation_id;
        break;

      case 'audio':
        if (msg.audio_event?.audio_base_64 && this.onAudio) {
          this.onAudio(msg.audio_event.audio_base_64);
        }
        break;

      case 'agent_response':
        if (msg.agent_response_event?.agent_response && this.onTranscript) {
          this.onTranscript({ role: 'agent', text: msg.agent_response_event.agent_response, isFinal: true });
        }
        break;

      case 'user_transcript':
        if (msg.user_transcription_event?.user_transcript && this.onTranscript) {
          this.onTranscript({
            role: 'user',
            text: msg.user_transcription_event.user_transcript,
            isFinal: msg.user_transcription_event.is_final !== false,
          });
        }
        break;

      case 'client_tool_call':
        if (msg.client_tool_call && this.onToolCall) {
          const result = this.onToolCall({
            name: msg.client_tool_call.tool_name,
            params: msg.client_tool_call.parameters || {},
            id: msg.client_tool_call.tool_call_id,
          });
          this._send({
            type: 'client_tool_result',
            tool_call_id: msg.client_tool_call.tool_call_id,
            result: JSON.stringify(result ?? { success: true }),
          });
        }
        break;

      case 'interruption':
        if (this.onInterrupt) this.onInterrupt();
        break;

      case 'ping':
        this._send({ type: 'pong', event_id: msg.ping_event?.event_id });
        break;
    }
  }

  sendAudio(base64) {
    if (!this.connected) return;
    this._send({ type: 'user_audio_chunk', user_audio_chunk: base64 });
  }

  close() {
    this.connected = false;
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

module.exports = { ElevenLabsSession };
