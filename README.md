# kookoo-voicebot

Build AI voice agents on **KooKoo/Ozonetel** telephony with **ElevenLabs** conversational AI. Handle inbound calls, bidirectional audio streaming, and real-time AI responses — no telephony knowledge required.

## Quick Start

```bash
npm install kookoo-voicebot
```

```js
const { KooKooVoiceBot } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot({
  sipNumber: '524431',
  elevenlabs: {
    agentId: 'agent_xxxxxxxxxxxx',
    apiKey: 'sk_xxxxxxxxxxxx',
  },
});

bot.start(); // that's it — voice agent is live
```

## What It Does

When a phone call comes in through KooKoo:

1. **Answers the call** — returns KooKoo XML with `<stream>` tag
2. **Opens a WebSocket** — receives real-time PCM audio from the caller
3. **Streams to ElevenLabs** — converts 8kHz → 16kHz, sends to your AI agent
4. **Plays back AI response** — converts 16kHz → 8kHz, sends back to caller
5. **Handles call lifecycle** — barge-in, transfer, voicemail, hangup

All on a single port. Deploy to Railway and point your KooKoo IVR URL to `/kookoo`.

## Setup

### 1. Create an ElevenLabs Agent

Go to [elevenlabs.io](https://elevenlabs.io) → Conversational AI → Create Agent.

Set the system prompt (example for a receptionist):
```
You are a professional AI receptionist. Keep responses short (1-3 sentences).
Ask how you can help. Offer to transfer to sales, support, or billing.
```

### 2. Configure KooKoo

Point your KooKoo IVR URL to: `https://your-app.up.railway.app/kookoo`

### 3. Set Environment Variables

```bash
ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000  # optional, default 3000
```

## Lifecycle Hooks

Hooks let you add custom logic without touching telephony code:

```js
const bot = new KooKooVoiceBot(config, {
  // Called when a new call connects
  onCallStart({ ucid, did, metadata }) {
    console.log(`Call from ${did}`);
  },

  // Called for every transcript line (user or agent)
  onTranscript({ ucid, role, text, isFinal }) {
    if (isFinal) console.log(`[${role}] ${text}`);
  },

  // Called when your ElevenLabs agent invokes a tool
  onToolCall({ ucid, name, params, id }) {
    if (name === 'transfer_call') {
      return { transferred: true };
    }
    return { success: true };
  },

  // Called when user interrupts the agent (barge-in)
  onInterrupt({ ucid }) {
    console.log('User interrupted');
  },

  // Called when the call ends
  onCallEnd({ ucid }) {
    console.log('Call ended');
  },

  // Return custom XML after the AI stream ends (call is still active!)
  onPostStream({ ucid, params }) {
    return xml.transfer('9001'); // transfer to extension
    // or: return xml.playAndHangup('Goodbye!');
    // or: return xml.ccTransfer('general', 'sales');
    // or: return null for default (thank you + hangup)
  },

  // Pass initial data to ElevenLabs on connection
  getInitData({ ucid, did }) {
    return {
      custom_llm_extra_body: {
        caller_id: did,
      },
    };
  },
});
```

## XML Helpers

Build KooKoo XML responses for post-stream actions:

```js
const { xml } = require('kookoo-voicebot');

xml.playAndHangup('Thank you for calling!');
xml.playAndHangup('धन्यवाद!', 'hi-IN');   // Hindi
xml.transfer('9001');                        // dial extension
xml.ccTransfer('general', 'sales', 30);      // contact center queue
xml.hangup();
```

## Express Integration

Mount your own routes alongside the voice bot:

```js
const cors = require('cors');

bot.use(cors());

const app = bot.getExpressApp();
app.get('/api/status', (req, res) => {
  res.json({ activeCalls: bot.handlers.size });
});
```

## Audio Format Reference

KooKoo bidirectional stream uses:
- **PCM Linear 16-bit**, 8000 Hz, mono
- **80 samples per chunk** (10ms)
- First packet at 16kHz — automatically ignored
- JSON format: `{ type: "media", ucid, data: { samples: [...], sampleRate: 8000, ... } }`

The SDK handles all format conversion automatically. If you need raw access:

```js
const { samplesToBase64, base64ToChunks, buildMediaPacket } = require('kookoo-voicebot');
```

## Deploy to Railway

```bash
# Procfile
web: node index.js
```

Set environment variables in Railway dashboard. The WebSocket URL is auto-detected from `RAILWAY_PUBLIC_DOMAIN`.

## Examples

- [`examples/receptionist.js`](examples/receptionist.js) — Simple AI receptionist (~40 lines)
- [`examples/with-mongodb.js`](examples/with-mongodb.js) — With call logging to MongoDB
- [`examples/transfer-bot.js`](examples/transfer-bot.js) — Department transfer with tool calls

## License

MIT
