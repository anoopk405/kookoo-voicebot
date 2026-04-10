const WebSocket = require('ws');

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';

class OpenAIRealtimeSession {
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gpt-4o-realtime-preview';
    this.instructions = opts.instructions || '';
    this.voice = opts.voice || 'alloy';
    this.tools = opts.tools || [];
    this.onAudio = opts.onAudio;
    this.onTranscript = opts.onTranscript;
    this.onToolCall = opts.onToolCall;
    this.onInterrupt = opts.onInterrupt;
    this.onError = opts.onError;
    this.ws = null;
    this.connected = false;
  }

  connect() {
    const url = `${REALTIME_URL}?model=${this.model}`;
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.ws.on('open', () => {
      this.connected = true;
      this._sendSessionConfig();
    });

    this.ws.on('message', (raw) => {
      try { this._handle(JSON.parse(raw.toString())); }
      catch (e) { /* ignore parse errors */ }
    });

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      if (code !== 1000 && code !== 1005) {
        if (this.onError) this.onError(new Error(`OpenAI closed: ${code} ${reason}`));
      }
    });

    this.ws.on('error', (err) => {
      if (this.onError) this.onError(err);
    });
  }

  _sendSessionConfig() {
    const config = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.instructions,
        voice: this.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    };

    if (this.tools.length > 0) {
      config.session.tools = this.tools;
    }

    this._send(config);

    // Send initial response.create to get the first greeting
    this._send({
      type: 'response.create',
      response: { modalities: ['text', 'audio'] },
    });
  }

  _handle(msg) {
    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
        break;

      case 'response.audio.delta': {
        if (msg.delta && this.onAudio) {
          this.onAudio(msg.delta);
        }
        break;
      }

      case 'response.audio_transcript.done': {
        if (msg.transcript && this.onTranscript) {
          this.onTranscript({ role: 'agent', text: msg.transcript, isFinal: true });
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (msg.transcript && this.onTranscript) {
          this.onTranscript({ role: 'user', text: msg.transcript, isFinal: true });
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        const name = msg.name || '';
        let params = {};
        try { params = JSON.parse(msg.arguments || '{}'); } catch { /* ignore */ }
        const callId = msg.call_id || '';

        let result = { success: true };
        if (this.onToolCall) {
          result = this.onToolCall({ name, params, id: callId }) || result;
        }

        // Send function call output and trigger next response
        this._send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          },
        });
        this._send({ type: 'response.create' });
        break;
      }

      case 'input_audio_buffer.speech_started': {
        // User started speaking — interrupt agent
        if (this.onInterrupt) this.onInterrupt();
        break;
      }

      case 'error': {
        if (this.onError) {
          this.onError(new Error(msg.error?.message || 'OpenAI Realtime error'));
        }
        break;
      }
    }
  }

  sendAudio(base64) {
    if (!this.connected) return;
    this._send({
      type: 'input_audio_buffer.append',
      audio: base64,
    });
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

module.exports = { OpenAIRealtimeSession };
