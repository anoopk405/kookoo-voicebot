# kookoo-voicebot

> Build and deploy production-ready AI voice agents on KooKoo/Ozonetel telephony — powered by ElevenLabs Conversational AI or OpenAI Realtime API.

A Claude Code skill that scaffolds a complete, deployable Node.js voice agent application from a single natural-language description. Describe what you want, pick your AI provider, and get a working phone number that answers real calls.

---

## Table of Contents

- [What This Skill Does](#what-this-skill-does)
- [When to Use It](#when-to-use-it)
- [Quick Start](#quick-start)
- [AI Provider Comparison](#ai-provider-comparison)
- [Architecture](#architecture)
- [Available Hooks](#available-hooks)
- [XML Helpers](#xml-helpers)
- [KooKoo Platform Reference](#kookoo-platform-reference)
- [WebSocket Streaming Protocol](#websocket-streaming-protocol)
- [Deployment Guide](#deployment-guide)
- [Debugging Reference](#debugging-reference)
- [Example Use Cases](#example-use-cases)

---

## What This Skill Does

Given a description like *"a voice agent for my dental clinic that books appointments"* or *"a support line that transfers callers to the right department"*, the skill will:

1. Ask which AI provider you want (ElevenLabs or OpenAI)
2. Scaffold a complete Node.js project with `npm init` and install the `kookoo-voicebot` SDK
3. Generate `index.js` wired to the chosen provider with the right hooks for the use case
4. Write the system prompt (in code for OpenAI, or to paste into ElevenLabs for EL)
5. Create deployment files: `Procfile`, `nixpacks.toml`, `.env.example`, `.gitignore`
6. Give you step-by-step instructions to deploy on Railway and wire the URL into KooKoo

The output is a deployable app whose `/kookoo` URL you paste into the KooKoo portal against a phone number — calls to that number then hit your agent.

---

## When to Use It

Trigger this skill whenever the user wants to build **any phone-based voice application**, including:

- Inbound IVR / auto-attendant replacements
- Appointment booking lines
- Customer support agents with intent routing
- Lead qualification / sales qualification bots
- Voicemail-to-text / after-hours handlers
- Call transfer and contact center queue routing
- Multilingual phone agents (Hindi, Telugu, Tamil, etc.)

If the request involves a phone number, PSTN/SIP calls, or IVR behavior on KooKoo or Ozonetel, this skill is the right tool.

---

## Quick Start

```bash
mkdir my-voice-agent && cd my-voice-agent
npm init -y
npm install kookoo-voicebot
```

Minimal `index.js` using OpenAI Realtime:

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-realtime-preview',
      voice: 'nova',
      instructions: `You are a friendly receptionist for Acme Corp. Greet the caller, ask how you can help, and keep responses short and conversational.`,
    },
  },
  {
    onCallStart: ({ ucid, did }) => console.log(`Call ${ucid} started on ${did}`),
    onTranscript: ({ role, text }) => console.log(`${role}: ${text}`),
    onCallEnd: ({ ucid }) => console.log(`Call ${ucid} ended`),
  }
);

bot.start();
```

Set `OPENAI_API_KEY`, `SIP_NUMBER`, deploy to Railway, and paste `https://your-app.up.railway.app/kookoo` into the KooKoo portal's Application URL for your number. Call the number — the agent answers.

---

## AI Provider Comparison

The skill supports two providers. Pick based on what you care about:

| Dimension | ElevenLabs Conversational AI | OpenAI Realtime API |
|---|---|---|
| **Prompt location** | ElevenLabs dashboard UI | In code (`instructions` field) |
| **Voice quality** | Best-in-class, supports cloning | Very good, 6 preset voices |
| **Prompt iteration** | No redeploy needed | Redeploy on every change |
| **Function calling** | Configured in EL Tools tab | Native `tools` array in config |
| **Best for** | Product teams, non-technical prompt owners | Developer-owned agents, tight iteration loops |
| **Indian voices** | Choose Indian-accented voice or clone one | Limited — use `nova` or `shimmer`, accent is neutral |

### OpenAI voice options

`alloy` (neutral) · `echo` (male) · `fable` (British) · `onyx` (deep male) · `nova` (female) · `shimmer` (soft female)

### OpenAI tools (function calling) format

```js
tools: [
  {
    type: 'function',
    name: 'transfer_call',
    description: 'Transfer the caller to a department',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string', enum: ['sales', 'support', 'billing'] },
      },
      required: ['department'],
    },
  },
]
```

Handle the invocation inside the `onToolCall` hook (ElevenLabs) or via the OpenAI tool response flow.

---

## Architecture

```
Caller's phone ──► KooKoo/Ozonetel PSTN ──► Your /kookoo URL (NewCall event)
                                                   │
                                                   ▼
                                        Your app returns XML with <stream> tag
                                                   │
                                                   ▼
                                        KooKoo opens WebSocket to your app
                                                   │
                                         bidirectional PCM audio (8kHz, 16-bit)
                                                   │
                                                   ▼
                                    SDK bridges WebSocket ⇄ AI provider
                                         (ElevenLabs or OpenAI Realtime)
```

The `kookoo-voicebot` SDK handles:
- IVR XML response generation on `/kookoo`
- WebSocket server for KooKoo's media stream
- Audio format conversion (PCM Linear 8kHz ⇄ provider format)
- `seqid` generation and `mark` event tracking
- Provider connection lifecycle
- Hook dispatch for your business logic

You only write hooks.

---

## Available Hooks

| Hook | Fires When | Returns |
|---|---|---|
| `onCallStart({ucid, did, metadata})` | Call connects to your agent | `void` |
| `onCallEnd({ucid})` | Call disconnects cleanly | `void` |
| `onTranscript({ucid, role, text, isFinal})` | User or agent speaks | `void` |
| `onToolCall({ucid, name, params, id})` | ElevenLabs tool is invoked | Tool result object |
| `onInterrupt({ucid})` | Caller barges in over the agent | `void` |
| `onPostStream({ucid, params})` | AI stream ends, call still active | KooKoo XML string |
| `getInitData({ucid, did})` | Before ElevenLabs connects | Data object for the agent |
| `onError({ucid, error})` | Any error during the call | `void` |
| `onCDR(data)` | KooKoo sends Call Detail Record | `void` |

### `onPostStream` is the most powerful hook

After the AI conversation ends but the call is still active, you can return XML to transfer, play a final message, or hang up. This is where you implement "after the agent is done, route to a human" patterns.

---

## XML Helpers

```js
const { xml } = require('kookoo-voicebot');

xml.playAndHangup('Goodbye!');                    // TTS in English (IN), then hang up
xml.playAndHangup('धन्यवाद!', 'hi-IN');           // Hindi TTS, then hang up
xml.transfer('9001');                              // Dial an extension
xml.ccTransfer('general', 'sales', 30);            // Contact center queue transfer
xml.hangup();                                      // Just hang up
```

For custom XML, return any valid KooKoo response string from `onPostStream`.

---

## KooKoo Platform Reference

All IVR responses MUST be wrapped in `<response>` tags:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
    <!-- tags here -->
</response>
```

### Core IVR Tags

#### `<playtext>` — Text-to-Speech

```xml
<playtext lang="en-IN" speed="3" quality="best" type="ggl">Hello, how can I help?</playtext>
```

| Attribute | Values | Default |
|---|---|---|
| `lang` | `en-IN`, `hi-IN`, `te-IN`, `ta-IN`, `ml-IN`, `kn-IN`, `mr-IN`, `gu-IN`, `bn-IN` | `en-IN` |
| `speed` | `1` (slow) to `5` (fast) | `3` |
| `quality` | `best`, `high`, `medium`, `low` | `best` |
| `type` | `ggl` (Google), `polly` (AWS Polly) | `ggl` |

#### `<stream>` — Bidirectional WebSocket Audio

```xml
<stream is_sip="true" url="wss://yourserver.com/ws" x-uui="{json_data}">SIP_NUMBER</stream>
```

- `is_sip` — always `"true"`
- `url` — your WebSocket endpoint (SDK auto-generates this from `RAILWAY_PUBLIC_DOMAIN`)
- `x-uui` — custom JSON payload (arrives on the WebSocket as `x_headers`, not `x-uui`)
- Tag body — your SIP registration number

#### `<dial>` — Dial Another Number

```xml
<dial transfer_allowed_by_caller="true" callback_onanswered="https://..." moh="default" record="true">9123456789</dial>
```

#### `<collectdtmf>` — Collect Keypad Input

```xml
<collectdtmf l="1" t="5000">https://yourdomain.com/handle-input</collectdtmf>
```

#### `<cctransfer>` — Contact Center Queue Transfer

```xml
<cctransfer record="" moh="default" uui="sales" timeout="30" ringType="ring">general</cctransfer>
```

#### Other tags

- `<gotourl clean_params="false">https://other-ivr.com/handler</gotourl>` — jump to another IVR
- `<hangup/>` — end the call
- `<start-record/>` — start recording

### `NewCall` Webhook Parameters

When KooKoo hits your `/kookoo` endpoint with `event=NewCall`, it sends rich caller data:

| Parameter | Meaning | Example |
|---|---|---|
| `sid` | Session/Call ID (same as `ucid`) | `21275806501458167` |
| `cid` | Caller's phone number | `919704665032` |
| `cid_e164` | Caller number in E.164 format | `+919704665032` |
| `called_number` | Your KooKoo number | `918065740671` |
| `operator` | Caller's telecom operator | `Airtel` |
| `circle` | Caller's telecom circle | `ANDHRA PRADESH` |
| `cid_type` | `MOBILE` or `LANDLINE` | `MOBILE` |
| `cid_countryname` | Country | `India` |
| `cid_country` | Country code | `91` |
| `request_time` | Call arrival timestamp | `2026-04-10 13:05:02` |

### IVR Callback Events

| Event | Meaning | Call Status | Return XML? |
|---|---|---|---|
| `NewCall` | Inbound call answered | Starting | Yes — return stream XML |
| `Stream` | Stream/WebSocket ended | Still active | Yes — transfer/hangup/more IVR |
| `Dial` | Dialed party (Leg B) disconnected | Still active (Leg A) | Yes |
| `Hangup` + `process=stream` | Caller hung up during stream | Ending | 200 OK |
| `Hangup` + `process=dial` | Caller hung up during dial | Ending | 200 OK |
| `Hangup` (no process) | Call fully ended | Ended | 200 OK |
| `Disconnect` | Your IVR sent hangup | Ending | 200 OK |

**Key insight:** `event=Stream` means the AI conversation ended but the call is still connected — you can return more XML here.

---

## WebSocket Streaming Protocol

### Start event (connection open)

```json
{
  "event": "start",
  "type": "text",
  "ucid": "21275806501458167",
  "did": "918065740671",
  "call_id": "919704665032",
  "x_account": "serv_del",
  "x_headers": "{...JSON string with all NewCall params...}",
  "media": {"encoding": "PCMU", "sampleRate": 8000, "channels": 1, "bitsPerSample": 16, "payloadType": 0}
}
```

**Critical field semantics:**

| Field | What it is |
|---|---|
| `ucid` | Unique Call ID |
| `did` | The CALLED number (your KooKoo number) — **not the caller** |
| `call_id` | The CALLER's phone number — use this to identify who's calling |
| `x_headers` | JSON **string** (must be parsed) with the full NewCall payload |

`x-uui` set in the `<stream>` XML tag is forwarded inside `x_headers` — not as a top-level `x-uui` field.

### Media event (audio data)

```json
{
  "event": "media",
  "type": "media",
  "ucid": "21275806501458167",
  "data": {
    "samples": [8, 8, 8, ...],
    "bitsPerSample": 16,
    "sampleRate": 8000,
    "channelCount": 1,
    "numberOfFrames": 80,
    "type": "data"
  }
}
```

### Audio format

| Property | Value |
|---|---|
| Encoding | PCM Linear |
| Bit depth | 16-bit (int16) |
| Sample rate | 8000 Hz |
| Channels | 1 (mono) |
| Frame size | 80 samples / 10 ms per chunk |

**CRITICAL:** The first packet after connection reports `sampleRate: 16000` and `numberOfFrames: 160`. **Ignore this packet.** All subsequent packets are 8000 Hz.

### Sending audio back

Every outbound media packet must include a `seqid` (UUID) so KooKoo can acknowledge playback:

```json
{
  "event": "media",
  "type": "media",
  "ucid": "YOUR_UCID",
  "seqid": "21707e3f-ab0f-4675-9146-8df9ddcc4a79",
  "data": {
    "samples": [1, -3, 5, 2, ...],
    "bitsPerSample": 16,
    "sampleRate": 8000,
    "channelCount": 1,
    "numberOfFrames": 80,
    "type": "data"
  }
}
```

### Mark event (playback acknowledgment)

After KooKoo plays a packet, it echoes back:

```json
{
  "event": "mark",
  "type": "ack",
  "ucid": "31761560059211253",
  "seqid": "21707e3f-ab0f-4675-9146-8df9ddcc4a79",
  "timestamp": 1761560089206
}
```

The SDK handles `seqid` generation and mark tracking automatically. You don't need to manage this yourself unless you're doing custom synchronization.

### Commands you can send

```json
{"command": "clearBuffer"}        // for barge-in / interruption
{"command": "callDisconnect"}     // hang up the call
```

### Stop event (call end)

```json
{"event": "stop", "type": "text", "ucid": "xxxxx", "did": "xxxxx"}
```

---

## Deployment Guide

### 1. Push to GitHub

```bash
git init
git add -A
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Deploy on Railway

1. Go to **railway.com**, create a new project, connect your GitHub repo
2. Set environment variables in the Railway dashboard (not in `.env` — Railway doesn't read `.env` files):
   - **For ElevenLabs:** `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY`, `SIP_NUMBER`
   - **For OpenAI:** `OPENAI_API_KEY`, `SIP_NUMBER`
   - **Optional:** `MONGODB_URI` (paste as a single line — no line breaks)
3. Deploy. Railway assigns a URL like `https://your-app.up.railway.app`.

The SDK auto-detects the public URL from `RAILWAY_PUBLIC_DOMAIN`, so the WebSocket URL is wired up for you.

### 3. Wire it into KooKoo

1. Sign up at **kookoo.in** or **ozonetel.com**
2. Get a virtual phone number from your KooKoo dashboard
3. Set the **IVR/Application URL** for that number to:
   ```
   https://your-app.up.railway.app/kookoo
   ```
4. Save. Calls to that number now hit your voice agent.

### .env.example templates

**ElevenLabs:**
```
ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

**OpenAI:**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

### Deployment files

**Procfile:**
```
web: node index.js
```

**nixpacks.toml:**
```toml
[phases.setup]
nixPkgs = ["nodejs_20"]
[start]
cmd = "node index.js"
```

**.gitignore:**
```
node_modules/
.env
*.log
```

---

## Debugging Reference

| Symptom | Cause | Fix |
|---|---|---|
| `agent does not exist` | Wrong ElevenLabs agent ID | Use the ID from the EL URL (`agent_xxxx`), not the display name |
| `Override not allowed` | Agent config locked in EL | Don't send `conversation_config_override` with `prompt` / `first_message`. Configure prompt in EL dashboard. Use `custom_llm_extra_body` for dynamic data instead |
| MongoDB connection error | Whitespace in URI | Paste `MONGODB_URI` as a single line in Railway Variables |
| Silence / blank audio | Provider not connected | Check agent ID & API key; inspect Railway logs for connection errors |
| `Stream duration=1` | WebSocket URL is wrong | Remove any stale `WEBSOCKET_URL` env var — the SDK auto-detects from `RAILWAY_PUBLIC_DOMAIN` |
| Dashboard shows no calls | MongoDB not connected | Set `MONGODB_URI` in Railway Variables — not in `.env` |
| Caller number shows as KooKoo number | Reading `did` instead of `call_id` | `did` is your KooKoo number. The caller is in `call_id` (or `cid` inside parsed `x_headers`) |
| `x-uui` missing on WebSocket | KooKoo renames it | Parse `x_headers`: `JSON.parse(message.x_headers)` |

---

## Example Use Cases

### Receptionist that routes by intent (OpenAI)

```js
const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-realtime-preview',
      voice: 'nova',
      instructions: `You are the receptionist for Acme Dental. Greet the caller warmly, ask what they need, and call transfer_call with the right department. Keep it short.`,
      tools: [{
        type: 'function',
        name: 'transfer_call',
        description: 'Transfer to a department',
        parameters: {
          type: 'object',
          properties: { department: { type: 'string', enum: ['appointments', 'billing', 'emergency'] } },
          required: ['department'],
        },
      }],
    },
  },
  {
    onPostStream: ({ params }) => {
      const dept = params?.department;
      const extMap = { appointments: '9001', billing: '9002', emergency: '9999' };
      return xml.transfer(extMap[dept] || '9000');
    },
  }
);
bot.start();
```

### Hindi voicemail (ElevenLabs)

Configure the agent in ElevenLabs with a Hindi voice and a prompt like *"आप एक मददगार सहायक हैं..."*, then:

```js
const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'elevenlabs',
    elevenlabs: {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      apiKey: process.env.ELEVENLABS_API_KEY,
    },
  },
  {
    onPostStream: () => xml.playAndHangup('धन्यवाद! आपका दिन शुभ हो।', 'hi-IN'),
  }
);
bot.start();
```

### Capture caller identity from the WebSocket

```js
onCallStart: ({ ucid, did, metadata }) => {
  // metadata contains parsed x_headers — caller number is in cid / call_id
  const callerNumber = metadata?.cid || metadata?.call_id;
  console.log(`Call ${ucid} from ${callerNumber} to ${did}`);
}
```

---

## Allowed Tools

This skill restricts tool use to:

- `Bash` — `npm *`, `node *`, `git *`, `curl *`
- `Read`, `Write`, `Edit`
- `Grep`, `Glob`
- `WebFetch`

Enough to scaffold, install, commit, push, and verify the agent. No broad shell access needed.

---

## License & Support

The `kookoo-voicebot` SDK is published on npm. For KooKoo/Ozonetel platform accounts, sign up at **ozonetel.com** or **kookoo.in**. For ElevenLabs Conversational AI, see **elevenlabs.io**. For OpenAI Realtime API access, see **platform.openai.com**.
