---
name: kookoo-voicebot
description: "Build and deploy AI voice agents that answer real phone calls. Use whenever a user wants a voice agent, phone bot, IVR replacement, auto-attendant, appointment booking line, phone support agent, lead qualification bot, voicemail handler, call routing system, multilingual phone agent (Hindi, Telugu, Tamil, etc.), or anything that says 'answer calls with AI', 'AI phone agent', 'phone number that talks', or 'voice agent on a phone number'. Runs on KooKoo/Ozonetel telephony with a choice of two AI providers: ElevenLabs Conversational AI (best voice quality, dashboard-configured prompts) or OpenAI Realtime API (GPT-4o, prompt in code, native function calling). Generates a complete deployable Node.js app with a /kookoo URL to paste into the KooKoo portal."
argument-hint: "[describe your voice agent] [--openai | --elevenlabs]"
allowed-tools: Bash(npm *) Bash(node *) Bash(git *) Bash(curl *) Read Write Edit Grep Glob WebFetch
---

# KooKoo Voice Agent Builder

You are building an AI voice agent that handles real phone calls. The user describes what kind of agent they want, and you generate a complete, deployable Node.js application using the `kookoo-voicebot` SDK.

## What to build

The user said: **$ARGUMENTS**

Based on their description, you will:
1. **Determine the AI provider:**
   - If `$ARGUMENTS` contains `--openai`, use OpenAI Realtime API
   - If `$ARGUMENTS` contains `--elevenlabs`, use ElevenLabs Conversational AI
   - If the user named a provider in prose (e.g. "using OpenAI", "with ElevenLabs"), use that
   - Otherwise, **default to OpenAI** (no dashboard setup, faster time-to-running agent) and tell the user you chose it — they can switch with `--elevenlabs` if they prefer voice cloning or UI-based prompt editing
2. Scaffold a complete Node.js project
3. Install `kookoo-voicebot` from npm
4. Write `index.js` with the appropriate provider config and hooks
5. If ElevenLabs: write the agent system prompt to paste in ElevenLabs dashboard
6. If OpenAI: write the system prompt directly in code (`instructions` field)
7. Create deployment files (Procfile, nixpacks.toml, .env.example, .gitignore)
8. Tell them exactly how to deploy and get a working phone number

---

## Step-by-step: Build the voice agent

### 1. Scaffold the project

```bash
mkdir <agent-name> && cd <agent-name>
npm init -y
npm install kookoo-voicebot
```

### 2. Create index.js

The SDK supports two providers. Use whichever the user chose (or default to OpenAI):

#### Option A: OpenAI Realtime API (DEFAULT — system prompt in code, no dashboard needed)

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-realtime-preview',
      voice: 'nova', // alloy, echo, fable, onyx, nova, shimmer
      instructions: `<WRITE THE SYSTEM PROMPT HERE BASED ON USER'S USE CASE>`,
      tools: [
        // Add function calling tools if the agent needs to take actions
      ],
    },
  },
  {
    // Add hooks based on the use case...
  }
);

bot.start();
```

#### Option B: ElevenLabs (agent configured in ElevenLabs dashboard)

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

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
    // Add hooks based on the use case...
  }
);

bot.start();
```

**OpenAI advantages:** System prompt lives in code (no separate dashboard), function calling built-in, GPT-4o intelligence, faster to first working call.
**ElevenLabs advantages:** Better voice quality/cloning, agent configured via UI, no code changes for prompt updates, better for non-technical prompt owners.

**OpenAI voice options:** `alloy` (neutral), `echo` (male), `fable` (British), `onyx` (deep male), `nova` (female), `shimmer` (soft female).

**OpenAI tools format** (for function calling):
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

### Available hooks — use what the agent needs:

| Hook | When it fires | Return value |
|------|--------------|-------------|
| `onCallStart({ucid, did, metadata})` | Call connects | void |
| `onCallEnd({ucid})` | Call disconnects | void |
| `onTranscript({ucid, role, text, isFinal})` | User or agent speaks | void |
| `onToolCall({ucid, name, params, id})` | ElevenLabs tool invoked | result object |
| `onInterrupt({ucid})` | User barges in | void |
| `onPostStream({ucid, params})` | AI stream ends, call still active | KooKoo XML string |
| `getInitData({ucid, did})` | Before ElevenLabs connects | data object |
| `onError({ucid, error})` | Error occurs | void |
| `onCDR(data)` | KooKoo CDR callback | void |

### XML helpers for onPostStream:

```js
const { xml } = require('kookoo-voicebot');
xml.playAndHangup('Goodbye!');              // play TTS then hang up
xml.playAndHangup('धन्यवाद!', 'hi-IN');     // Hindi TTS
xml.transfer('9001');                        // dial an extension
xml.ccTransfer('general', 'sales', 30);      // contact center queue transfer
xml.hangup();                                // just hang up
```

### 3. Create .env.example

**For OpenAI (default):**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

**For ElevenLabs:**
```
ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

If using MongoDB, add: `MONGODB_URI=mongodb+srv://...`

### 4. Create deployment files

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

### 5. Set up the AI provider

#### If using OpenAI (default):

No dashboard needed. Write the system prompt directly in the `instructions` field in code. The user just needs an OpenAI API key with Realtime API access.

For tools/function calling, define them in the `tools` array in config. OpenAI handles STT + LLM + TTS in one connection.

**Voice options:** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.

#### If using ElevenLabs:

Write a system prompt and tell the user to:

1. Go to **elevenlabs.io** > **Conversational AI** > **Create Agent**
2. Pick a voice (for Indian voice: choose an Indian-accented voice, or use voice cloning)
3. Paste the system prompt you generate into **Agent > Prompt**
4. Set the **First message** (the greeting the agent says when the call connects)
5. If tools are needed (transfer, voicemail, etc.), add them under **Tools** tab
6. Copy the **Agent ID** from the URL bar (format: `agent_xxxxxxxxxxxx`)
7. **IMPORTANT:** The Agent ID is the long string in the URL (e.g. `agent_2401knp683wrfbsr304aadb36v5r`), NOT the agent display name

**For Indian voice:** Select an Indian English voice in ElevenLabs voice settings, or use voice cloning for a custom Indian voice.

#### For both providers:

The `<playtext>` XML tags (used in `onPostStream`) should use `lang="en-IN"` for Indian English or `lang="hi-IN"` for Hindi.

### 6. Deploy and get the application URL

Tell the user:

1. **Push to GitHub** — `git init && git add -A && git commit -m "Initial" && git remote add origin <url> && git push -u origin main`
2. **Deploy on Railway:**
   - Go to railway.com, create new project, connect GitHub repo
   - For OpenAI: set `OPENAI_API_KEY`, `SIP_NUMBER`
   - For ElevenLabs: set `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY`, `SIP_NUMBER`
   - `MONGODB_URI` (if using MongoDB) — paste as a SINGLE LINE, no line breaks
   - Deploy — Railway gives you a URL like `https://your-app.up.railway.app`
3. **The application URL is:** `https://your-app.up.railway.app/kookoo`
4. **Paste this URL in KooKoo portal:**
   - Sign up at kookoo.in or ozonetel.com
   - Go to your KooKoo dashboard
   - Get a phone number
   - Set the IVR/Application URL to: `https://your-app.up.railway.app/kookoo`
   - Save — calls to that number now hit your voice agent

---

## KooKoo Platform Documentation (Source of Truth)

Use this documentation for ALL telephony decisions. Do NOT guess — use these exact formats.

### IVR XML Tags

All IVR responses MUST be wrapped in `<response>` tags:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
    <!-- tags here -->
</response>
```

#### `<playtext>` — Text-to-speech

```xml
<playtext lang="en-IN" speed="3" quality="best" type="ggl">Hello, how can I help?</playtext>
```

| Attribute | Values | Default |
|-----------|--------|---------|
| `lang` | `en-IN`, `hi-IN`, `te-IN`, `ta-IN`, `ml-IN`, `kn-IN`, `mr-IN`, `gu-IN`, `bn-IN` | `en-IN` |
| `speed` | `1` (slow) to `5` (fast) | `3` |
| `quality` | `best`, `high`, `medium`, `low` | `best` |
| `type` | `ggl` (Google), `polly` (AWS Polly) | `ggl` |

#### `<dial>` — Dial another number

```xml
<dial transfer_allowed_by_caller="true" callback_onanswered="https://..." moh="default" record="true">9123456789</dial>
```

#### `<stream>` — Bidirectional WebSocket audio stream

```xml
<stream is_sip="true" url="wss://yourserver.com/ws" x-uui="{json_data}">SIP_NUMBER</stream>
```

| Attribute | Description |
|-----------|-------------|
| `is_sip` | Always `"true"` |
| `url` | Your WebSocket server URL (ws:// or wss://) |
| `x-uui` | Custom JSON data to pass with the stream |

Content inside the tag = **SIP registration number**.

**NOTE:** The `x-uui` data set in the XML does NOT arrive as `x-uui` on the WebSocket. KooKoo forwards it as `x_headers` (see WebSocket Events below).

#### `<collectdtmf>` — Collect keypad input

```xml
<collectdtmf l="1" t="5000">https://yourdomain.com/handle-input</collectdtmf>
```

#### `<cctransfer>` — Transfer to contact center queue

```xml
<cctransfer record="" moh="default" uui="sales" timeout="30" ringType="ring">general</cctransfer>
```

#### `<gotourl>` — Transfer to another IVR

```xml
<gotourl clean_params="false">https://other-ivr.com/handler</gotourl>
```

#### `<hangup/>` — End the call

```xml
<hangup/>
```

#### `<start-record/>` — Start recording

```xml
<start-record/>
```

### IVR Webhook: NewCall Event

When KooKoo sends `event=NewCall` to your `/kookoo` endpoint, it includes rich caller data:

```
GET /kookoo?event=NewCall&sid=21275806501458167&cid=919704665032&called_number=918065740671&operator=Airtel&circle=ANDHRA+PRADESH&cid_type=MOBILE&cid_countryname=India&cid_country=91&cid_e164=%2B919704665032&request_time=2026-04-10+13%3A05%3A02
```

| Parameter | Description | Example |
|-----------|-------------|---------|
| `event` | Always `NewCall` for inbound | `NewCall` |
| `sid` | Session/Call ID (same as UCID) | `21275806501458167` |
| `cid` | Caller's phone number | `919704665032` |
| `cid_e164` | Caller number in E.164 format | `+919704665032` |
| `called_number` | Your KooKoo phone number | `918065740671` |
| `operator` | Caller's telecom operator | `Airtel` |
| `circle` | Caller's telecom circle/region | `ANDHRA PRADESH` |
| `cid_type` | Call type | `MOBILE` or `LANDLINE` |
| `cid_countryname` | Caller's country | `India` |
| `cid_country` | Country code | `91` |
| `request_time` | Call arrival time | `2026-04-10 13:05:02` |

### Bidirectional Audio Streaming (WebSocket)

#### XML to initiate stream (returned on NewCall):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<response>
    <start-record/>
    <stream is_sip="true" url="wss://yourserver.com/ws" x-uui="{call_params_json}">SIP_NUMBER</stream>
</response>
```

#### WebSocket Events (ACTUAL FORMAT — verified from live calls)

**Connection open (`start`):**

```json
{
  "event": "start",
  "type": "text",
  "ucid": "21275806501458167",
  "did": "918065740671",
  "call_id": "919704665032",
  "x_account": "serv_del",
  "x_headers": "{\"cid_countryname\":\"India\",\"cid_country\":\"91\",\"called_number\":\"918065740671\",\"operator\":\"Airtel\",\"sid\":\"21275806501458167\",\"cid\":\"919704665032\",\"cid_e164\":\"+919704665032\",\"event\":\"NewCall\",\"circle\":\"ANDHRA PRADESH\",\"cid_type\":\"MOBILE\",\"request_time\":\"2026-04-10 13:05:02\"}",
  "media": {"encoding": "PCMU", "sampleRate": 8000, "channels": 1, "bitsPerSample": 16, "payloadType": 0}
}
```

**CRITICAL fields in the start event:**

| Field | What it is | Example |
|-------|-----------|---------|
| `ucid` | Unique Call ID | `21275806501458167` |
| `did` | Called number (YOUR KooKoo number) | `918065740671` |
| `call_id` | **CALLER's phone number** | `919704665032` |
| `x_headers` | JSON string with ALL NewCall params (cid, operator, circle, country, etc.) | See above |
| `media` | Audio format metadata | `{encoding, sampleRate, channels, ...}` |

**IMPORTANT:**
- `did` is the CALLED number (your KooKoo number), NOT the caller
- `call_id` is the CALLER's phone number — use this to identify who is calling
- `x_headers` is a JSON STRING (must be parsed) containing all the rich caller data from NewCall
- The `x-uui` attribute set in the `<stream>` XML tag is NOT forwarded as `x-uui` — KooKoo forwards it inside `x_headers`

**Audio data (`media`):**
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

**Call end (`stop`):**
```json
{"event": "stop", "type": "text", "ucid": "xxxxx", "did": "xxxxx"}
```

#### Audio Format

| Property | Value |
|----------|-------|
| Encoding | PCM Linear |
| Bit Depth | 16-bit (int16) |
| Sample Rate | 8000 Hz |
| Channels | 1 (mono) |
| Frame Size | 80 samples per chunk (10ms) |

**CRITICAL:** The first packet after connection has `sampleRate: 16000` and `numberOfFrames: 160`. This packet MUST be ignored. All subsequent packets use 8000 Hz.

#### Sending Audio Back

Every outgoing media packet MUST include a `seqid` (UUID) so KooKoo can acknowledge playback:

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

#### Mark Event (Playback Acknowledgment)

After KooKoo plays an audio packet, it sends back a `mark` event with the same `seqid`:

```json
{
  "event": "mark",
  "type": "ack",
  "ucid": "31761560059211253",
  "seqid": "21707e3f-ab0f-4675-9146-8df9ddcc4a79",
  "timestamp": 1761560089206
}
```

This confirms the audio was played to the caller. Useful for tracking playback progress and synchronization. The SDK handles seqid generation and mark events automatically.

#### Commands

Clear audio buffer (for barge-in):
```json
{"command": "clearBuffer"}
```

Disconnect call:
```json
{"command": "callDisconnect"}
```

### IVR Callback Events

KooKoo sends these events to your IVR URL (`/kookoo`):

| Event | When | Call Status | Return XML? |
|-------|------|------------|------------|
| `NewCall` | Call answered (only with `url`, no `extra_data`) | Starting | YES — return stream XML |
| `Stream` | Stream/WebSocket ended | **STILL ACTIVE** | YES — transfer, hangup, or more IVR |
| `Dial` | Dialed party (Leg B) disconnected | **STILL ACTIVE** with Leg A | YES |
| `Hangup` + `process=stream` | Caller hung up during stream | Ending | Return 200 OK |
| `Hangup` + `process=dial` | Caller hung up during dial | Ending | Return 200 OK |
| `Hangup` (no process) | Call completely ended | Ended | Return 200 OK |
| `Disconnect` | IVR sent hangup | Ending | Return 200 OK |

**Key insight:** After `event=Stream`, the call is STILL ACTIVE. You can return more XML to transfer, play messages, or hang up.

### Outbound API

```
GET http://in1-cpaas.ozonetel.com/outbound/outbound.php
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `api_key` | Yes | KooKoo API key |
| `phone_no` | Yes | Number to call |
| `url` or `extra_data` | Yes (either) | IVR URL or inline XML |
| `outbound_version` | Yes | Always `2` |
| `caller_id` | No | Caller ID to display |
| `callback_url` | No | URL for final CDR |

### IVR Transfer API

```
POST https://in-ccaas.ozonetel.com/api/v1/CallControl/IVRTransfer
```

Parameters: `ucid`, `did`, `appURL` (URL-encoded), `phoneno`, `api_key`, `cburl` (optional).

### Fetch Call Info API

```
GET https://in1-cpaas.ozonetel.com/restkookoo/index.php/api/Call_data/calldata/ucid/{ucid}/date/{YYYY-MM-DD}/format/json
```

---

## Debugging Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| `agent does not exist` | Wrong agent ID | Use the ID from the ElevenLabs URL: `agent_xxxx` (not the display name) |
| `Override not allowed` | Agent config locked | Don't send `conversation_config_override` with `prompt` or `first_message`. Configure the prompt directly in ElevenLabs dashboard. Use `custom_llm_extra_body` instead to pass dynamic data. |
| `MongoDB connection error` | Whitespace in URI | Ensure URI is a single line with no line breaks when pasting into Railway Variables |
| Blank audio / silence | ElevenLabs not connected | Check agent ID, API key, and Railway logs for connection errors |
| Stream duration=1 | WebSocket URL wrong | SDK auto-detects from `RAILWAY_PUBLIC_DOMAIN` — remove any `WEBSOCKET_URL` placeholder env var |
| Dashboard shows no calls | MongoDB not connected | Set `MONGODB_URI` in Railway Variables dashboard (not in .env file — Railway doesn't read .env) |
| Caller number shows as the KooKoo number | Using `did` instead of `call_id` | `did` = your KooKoo number. Use `call_id` from WebSocket start event or `cid` from `x_headers` for the CALLER's number |
| `x-uui` not found on WebSocket | KooKoo renames it | KooKoo forwards `x-uui` as `x_headers` (JSON string). Parse it: `JSON.parse(message.x_headers)` |

---

## How users get started with KooKoo

Tell users who are new to KooKoo:

1. **Sign up** at **ozonetel.com** or **kookoo.in**
2. Go to the dashboard and **get a phone number** (Indian virtual number)
3. Find the **IVR/Application URL** setting for that number
4. Paste your deployed app URL: `https://your-railway-app.up.railway.app/kookoo`
5. **Call the number** — your AI voice agent answers!

The `kookoo-voicebot` SDK handles everything: XML responses, WebSocket audio streaming, format conversion, and ElevenLabs/OpenAI integration. The user just writes the business logic in hooks.
