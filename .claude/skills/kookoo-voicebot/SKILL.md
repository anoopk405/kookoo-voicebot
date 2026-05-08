---
name: kookoo-voicebot
description: "Build and deploy AI voice agents that answer real phone calls. Use whenever a user wants a voice agent, phone bot, IVR replacement, auto-attendant, appointment booking line, phone support agent, lead qualification bot, voicemail handler, call routing system, multilingual phone agent (Hindi, Telugu, Tamil, Spanish, Arabic, etc.), or anything that says 'answer calls with AI', 'AI phone agent', 'phone number that talks', 'voice agent on a phone number', or 'translate calls live'. Runs on KooKoo/Ozonetel telephony with three AI provider options: ElevenLabs Conversational AI (best voice quality, dashboard-configured prompts), OpenAI Realtime API (gpt-realtime-2 with selectable reasoning effort, prompt in code, native function calling), or OpenAI Translate Bridge (gpt-realtime-translate ↔ gpt-realtime-2 for callers speaking 70+ languages, AI replies in caller's own language). Generates a complete deployable Node.js app with a /kookoo URL to paste into the KooKoo portal."
argument-hint: "[describe your voice agent] [--openai | --elevenlabs | --translate]"
allowed-tools: Bash(npm *) Bash(node *) Bash(git *) Bash(curl *) Read Write Edit Grep Glob WebFetch
---

# KooKoo Voice Agent Builder

You are building an AI voice agent that handles real phone calls. The user describes what kind of agent they want, and you generate a complete, deployable Node.js application using the `kookoo-voicebot` SDK.

## What to build

The user said: **$ARGUMENTS**

Based on their description, you will:
1. **Determine the AI provider:**
   - If `$ARGUMENTS` contains `--openai`, use OpenAI Realtime API (gpt-realtime-2)
   - If `$ARGUMENTS` contains `--elevenlabs`, use ElevenLabs Conversational AI
   - If `$ARGUMENTS` contains `--translate`, use the OpenAI Translate Bridge (multilingual)
   - If the user named a provider in prose (e.g. "using OpenAI", "with ElevenLabs", "translate live"), use that
   - **If the user mentions multilingual / non-English callers / translation / 70+ languages / "reply in caller's language"**, default to `--translate`
   - Otherwise, **default to OpenAI** (no dashboard setup, faster time-to-running agent) and tell the user you chose it — they can switch with `--elevenlabs` (voice cloning, UI prompts) or `--translate` (multilingual)
2. Scaffold a complete Node.js project
3. Install `kookoo-voicebot` from npm
4. Write `index.js` with the appropriate provider config and hooks
5. If ElevenLabs: write the agent system prompt to paste in ElevenLabs dashboard
6. If OpenAI: write the system prompt directly in code (`instructions` field)
7. If OpenAI Translate Bridge: write an English-only receptionist prompt; the translate sessions are language-agnostic. NOTE: translate-bridge is not yet a built-in `provider` on the SDK — implement orchestration directly in your backend (see "Multilingual Translate Bridge (advanced)" below).
8. Create deployment files (Procfile, nixpacks.toml, .env.example, .gitignore)
9. Tell them exactly how to deploy and get a working phone number

---

## Step-by-step: Build the voice agent

### 1. Scaffold the project

```bash
mkdir <agent-name> && cd <agent-name>
npm init -y
npm install kookoo-voicebot
```

### 2. Create index.js

The SDK supports two providers (OpenAI, ElevenLabs) plus an advanced translate-bridge pattern that's implemented in user code (not yet as an SDK provider). Use whichever the user chose (or default to OpenAI):

#### Option A: OpenAI Realtime API (DEFAULT — system prompt in code, no dashboard needed)

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-realtime-2',         // released May 2026; supersedes gpt-4o-realtime-preview
      reasoningEffort: 'low',           // minimal | low | medium | high | xhigh — default low
      voice: 'nova',                    // alloy, echo, fable, onyx, nova, shimmer
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

**Pricing (May 2026):** `gpt-realtime-2` is $32 / 1M audio-input tokens, $64 / 1M audio-output tokens. Default `reasoningEffort: 'low'` for receptionist flows; bump to `'high'` / `'xhigh'` only when complex reasoning is required.

##### Verified gpt-realtime-2 session.update payload (May 2026)

If you bypass the npm SDK and talk to OpenAI directly via WebSocket, this is the
exact session.update payload the API accepts. Each field below was confirmed
through live `invalid_request_error` responses — the schema is strict.

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",                                  // REQUIRED
    "model": "gpt-realtime-2",                            // optional, falls back to URL ?model=
    "instructions": "...",
    "output_modalities": ["audio"],                       // NOT "modalities" — that's the legacy field
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "turn_detection": { "type": "semantic_vad" }      // turn_detection nests UNDER audio.input
      },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 }, // rate is REQUIRED on output
        "voice": "alloy"
      }
    }
  }
}
```

Common rejections (each verified via API error):

| Mistake | API response |
|---------|--------------|
| `session.modalities: ["audio"]` | `Unknown parameter: 'session.modalities'` (renamed to `output_modalities`) |
| `session.turn_detection: { ... }` | `Unknown parameter: 'session.turn_detection'` (must nest under `audio.input`) |
| Omitting `session.type` | `Missing required parameter: 'session.type'` |
| Omitting `audio.output.format.rate` | `Missing required parameter: 'session.audio.output.format.rate'` |
| `session.reasoning_effort` at root | rejected — config on this is still in flux as of May 2026 |

The npm SDK (`kookoo-voicebot`) handles all this automatically — the schema
above only matters if you're rolling your own WebSocket handler.

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

**OpenAI advantages:** System prompt lives in code (no separate dashboard), function calling built-in, gpt-realtime-2 reasoning (GPT-5-class), tunable `reasoningEffort`, faster to first working call.
**ElevenLabs advantages:** Better voice quality/cloning, agent configured via UI, no code changes for prompt updates, better for non-technical prompt owners.

**OpenAI voice options:** `alloy` (neutral), `echo` (male), `fable` (British), `onyx` (deep male), `nova` (female), `shimmer` (soft female).

#### Option C: OpenAI Multilingual (single gpt-realtime-2 session) — RECOMMENDED for non-English

When callers may speak any language and the AI should reply in **the caller's same language**. Uses `gpt-realtime-2` alone with audio-in / audio-out and an instruction to "detect the language from the first utterance and reply in that same language." `gpt-realtime` and `gpt-realtime-2` are both natively multilingual — no translation hop is needed.

```
Caller (lang X, 8 kHz)
   ↓ resample 8→24 kHz
gpt-realtime-2 (audio in / audio out, multilingual)
   ↓ resample 24→8 kHz
Caller hears reply in lang X
```

**Why this is the default for non-English calls:**
- **One** OpenAI session per call (vs three for the translate-bridge pattern).
- **~500–1000 ms** turn latency (vs ~1.5–2 s with translation hops).
- **No separate translation step** — the model understands and produces audio in any of its supported languages directly.
- Production-proven: this is the same approach the existing `provider: 'openai'` path on the `kookoo-voicebot` SDK uses (just on the legacy `gpt-realtime` model with the legacy schema). It handles multilingual conversation including mid-call language switches.

**System prompt template:**

```
You are a phone receptionist. Detect the language the caller is speaking from
their first utterance, then continue the entire conversation in THAT SAME
language. If they switch language mid-call, follow them. Default to English
if uncertain. Possibilities include English, Hindi, Telugu, Tamil, Kannada,
Malayalam, Marathi, Bengali, Gujarati, Spanish, French, Arabic.
Keep replies short (1-3 sentences). Speak naturally; no markdown or lists.
```

**Env vars:** `OPENAI_API_KEY`. Optionally `MODE=multilingual` if you gate it behind a flag.

**Implementation notes:**

- The `kookoo-voicebot` npm SDK already does this for you via `provider: 'openai'` (legacy schema, defaults to `gpt-4o-realtime-preview`; override with `model: 'gpt-realtime'` or `'gpt-realtime-2'`). For most users this is enough — just set the multilingual instructions and you're done.
- If you need the new schema's features (e.g. `gpt-realtime-2` with `output_modalities`, semantic_vad turn detection), implement the WS yourself using the verified payload above. A reference implementation lives at `src/services/multilingualHandler.js` in the `kookoo-ai-receptionist` backend.

#### Option D: OpenAI Translate Bridge (multilingual receptionist, 70+ languages)

Use when callers may speak any language and the AI should reply in the **caller's own language**. Three OpenAI sessions are stitched per call:

```
Caller (lang X) → gpt-realtime-translate (→ English transcript)
                                                ↓
                                       gpt-realtime-2 (English in / English audio out)
                                                ↓
                                  gpt-realtime-translate (English audio → lang X audio) → Caller
```

**The npm SDK does not yet ship this as a `provider`.** Do not write `provider: 'openai-translate'` — it won't work. Instead, run a custom WebSocket handler in your backend. A reference implementation lives in the `kookoo-ai-receptionist` backend repo:

- `src/services/translateBridgeHandler.js` — orchestrator
- `src/services/openaiTranslateSession.js` — gpt-realtime-translate WS wrapper
- `src/services/openaiRealtimeSession.js` — gpt-realtime-2 WS wrapper
- `src/utils/audioConverter.js` — `kookooSamplesToBase64_24k` / `base64_24kToKookooChunks` helpers (8↔24 kHz)

See **Multilingual Translate Bridge (advanced)** below for the full pattern, env vars, and pitfalls.

**Translate-bridge advantages:** Caller hears their own language naturally; AI reasoning still benefits from gpt-realtime-2; works across 70+ source languages.
**Trade-offs:** ~3× the OpenAI cost per call (3 concurrent sessions), ~1.5–2s perceived first-turn latency, no built-in barge-in (must be added manually), no first-greeting in auto-detect mode (need to wait for caller's first utterance to detect language).

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

**For OpenAI Translate Bridge (multilingual):**
```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
CALLER_LANGUAGE=                # empty = auto-detect; or set ISO code: es, hi, te, ar, fr, ...
MODE=translate                  # only if you gate the bridge behind a mode flag in your app
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

**Model selection:** Default to `gpt-realtime-2` (May 2026). For older deployments still on `gpt-4o-realtime-preview`, suggest upgrading. Use `reasoningEffort: 'low'` (default) for receptionists; bump to `'high'` only for diagnostic / triage / complex-decision flows.

#### If using OpenAI Translate Bridge (multilingual):

No dashboard needed. The English-only receptionist prompt lives in code on the gpt-realtime-2 leg. The two `gpt-realtime-translate` legs need no prompt — just a target language. Source language is auto-detected from the caller's first utterance unless `CALLER_LANGUAGE` is set explicitly.

This pattern is **not yet a built-in `provider` on the npm SDK** — implement the orchestration directly in your backend's WebSocket handler. See the **Multilingual Translate Bridge (advanced)** section below for the wiring contract and pitfalls.

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
   - For OpenAI Translate Bridge: set `OPENAI_API_KEY`, `MODE=translate`, optional `CALLER_LANGUAGE` (ISO code or leave empty for auto-detect), `SIP_NUMBER`
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
| `x-uui` | **Custom JSON string** carrying the call's metadata into the WS handler |

Content inside the tag = **SIP registration number**.

##### x-uui is the ONLY channel to pass NewCall params into the WS handler

KooKoo's WebSocket `start` event natively contains ONLY:
- `ucid`, `did`, `call_id`, `x_account`, `media`, plus whatever you put in `x-uui`.

It does NOT include `operator`, `circle`, `cid_e164`, `cid_countryname`, `cid_type`, `request_time`, etc. by default. **If your WS handler needs any of those, your IVR webhook MUST take all the NewCall query/body params and JSON-encode them into `x-uui` on the `<stream>` tag.** Otherwise that data is gone forever once the WS opens.

**Required pattern in the NewCall handler:**

```js
router.all('/', (req, res) => {
  const params = { ...req.query, ...req.body };
  if (params.event === 'NewCall') {
    // Serialise EVERY NewCall param into x-uui — escape single quotes
    // because we wrap the attribute value in single quotes.
    const uui = JSON.stringify(params).replace(/'/g, '&apos;');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <start-record/>
    <stream is_sip="true" url="${wsUrl}/ws" x-uui='${uui}'>${sipNumber}</stream>
</response>`;
    res.set('Content-Type', 'text/xml');
    return res.send(xml);
  }
  // ... handle Stream / Hangup / etc.
});
```

**Data flow end-to-end:**

```
Caller dials KooKoo number
  ↓
KooKoo IVR webhook  GET /kookoo?event=NewCall&sid=…&cid=…&operator=…&circle=…&…
  ↓ (your IVR handler reads req.query)
Returns <stream x-uui='{"event":"NewCall","sid":"…","cid":"…","operator":"…",…}'>
  ↓ (KooKoo bridges SIP, opens WebSocket)
WebSocket "start" event
  ├── ucid       (KooKoo-generated)
  ├── did        (your KooKoo number)
  ├── call_id    (caller's phone number, same as cid)
  └── x_headers  ← JSON STRING of whatever you put in x-uui
                   (KooKoo renames the attribute from "x-uui" to "x_headers"
                    and encodes it as a string, NOT a parsed object)
```

**Reading x_headers in your WS handler:**

```js
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.event === 'start') {
    let callerDetails = {};
    if (msg.x_headers) {
      try {
        callerDetails = typeof msg.x_headers === 'string'
          ? JSON.parse(msg.x_headers)   // it's a STRING — must JSON.parse
          : msg.x_headers;
      } catch {}
    }
    // Now you have everything from NewCall:
    const callerNumber = msg.call_id || callerDetails.cid;
    const operator     = callerDetails.operator;     // 'Airtel'
    const circle       = callerDetails.circle;       // 'ANDHRA PRADESH'
    const country      = callerDetails.cid_countryname;
    const requestTime  = callerDetails.request_time;
  }
});
```

**Common mistakes that lose call data:**

- Hardcoding `x-uui="{}"` in the XML — the WS handler then sees nothing beyond `ucid`/`did`/`call_id`.
- Forgetting to escape `'` inside the JSON when the XML attribute is single-quoted (XML parsers will silently truncate).
- Treating `x_headers` as a parsed object — it's a JSON string, you MUST `JSON.parse` it.
- Reading `msg['x-uui']` on the WebSocket — KooKoo renamed it to `x_headers`. The original `x-uui` key is gone.

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

KooKoo hits `/kookoo` with `event=NewCall` in TWO different scenarios. Your code must handle both:

**A) Real call (live phone call from a real caller)** — includes rich caller data:

```
GET /kookoo?event=NewCall&sid=21275806501458167&cid=919704665032&called_number=918065740671&operator=Airtel&circle=ANDHRA+PRADESH&cid_type=MOBILE&cid_countryname=India&cid_country=91&cid_e164=%2B919704665032&request_time=2026-04-10+13%3A05%3A02
```

**B) "Test Application URL" ping (KooKoo portal probe)** — only `event` is set, no caller data:

```
GET /kookoo?event=NewCall
```

→ Full body: `{"event":"NewCall"}` and that's it. **No `sid`, no `cid`, no `called_number`.**

This is the response when an admin clicks "Test" on the IVR URL setting in the KooKoo portal — KooKoo verifies the URL responds with valid XML but never opens a SIP stream, never sends a `start` event, and your WebSocket handler will NOT run. **Do not treat a Test ping as a real call** — don't create DB rows for it, don't increment caller counters. Detect the test ping by checking that `sid`/`cid` are missing or by inspecting all params:

```js
const isTestPing = !params.sid && !params.cid;
if (event === 'NewCall' && isTestPing) {
  // Reply with valid stream XML so the portal test passes,
  // but skip side effects (DB writes, analytics).
  res.set('Content-Type', 'text/xml');
  return res.send(streamXml);
}
```

**Distinguishing tests from real calls in logs:**

| Symptom | Meaning |
|---------|---------|
| `[KooKoo IVR] event=NewCall sid= cid= process=` followed by no `[WS] New connection` line | Test Application URL ping. Real call did not happen. |
| `[KooKoo IVR] event=NewCall sid=2127... cid=919...` followed by `[WS] New connection ... mode=...` | Real call connected to your WebSocket. |
| Real call params logged but no following `[WS] New connection` | KooKoo couldn't open the WebSocket — check `wss://` URL is reachable from the public internet, not blocked by auth, and certificate is valid. |

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

## Multilingual Translate Bridge (advanced)

Pattern for callers speaking any of OpenAI's 70+ supported languages where the AI must reply in the caller's own language. Use when stock `provider: 'openai'` isn't enough because the caller is non-English.

### Models used

| Role | Model | Purpose |
|------|-------|---------|
| Translate-IN | `gpt-realtime-translate` | Caller speech (lang X) → English transcript + auto-detected source language |
| Brain | `gpt-realtime-2` | Reasons in English; emits English audio reply |
| Translate-OUT | `gpt-realtime-translate` | English audio → caller's-language audio |

### Endpoints

```
wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
wss://api.openai.com/v1/realtime?model=gpt-realtime-2
```

Required headers on every WS:
- `Authorization: Bearer <OPENAI_API_KEY>`
- `OpenAI-Safety-Identifier: <your-app>-<ucid>`

### Audio format

- KooKoo sends/expects: PCM16 **8 kHz**, JSON `{samples:[...], sampleRate:8000}` array, 80 samples / 10 ms.
- OpenAI Realtime + Translate use: PCM16 **24 kHz** base64 inside `input_audio_buffer.append`.
- You MUST resample 8↔24 kHz on both legs. 3× linear-interpolation upsample / 3-sample average decimate is good enough for telephony. Reference helpers (`kookooSamplesToBase64_24k` / `base64_24kToKookooChunks`) live in the `kookoo-ai-receptionist` backend's `src/utils/audioConverter.js`.

### Session orchestration

1. On KooKoo `start`:
   - Open Translate-IN with `session.audio.output.language = 'en'`.
   - Open gpt-realtime-2 with `modalities: ['audio','text']`, `turn_detection: null`, English-only instructions.
   - **Do NOT open Translate-OUT yet** — its target language is unknown.
2. Pipe caller media → 8→24 kHz upsample → Translate-IN `input_audio_buffer.append`.
3. On Translate-IN's `conversation.item.input_audio_transcription.completed`:
   - Read `language` (or `detected_language`) field → open Translate-OUT with that target.
   - Buffer any gpt-realtime-2 audio that arrives before Translate-OUT is connected; flush once it is.
4. On Translate-IN's translated transcript (`response.output_audio_transcript.done`):
   - Send the **English** text to gpt-realtime-2 via `conversation.item.create` (`input_text`) + `response.create`.
   - **Critical**: forward the *translated* (English) transcript, NOT the *source* (caller-language) transcript. Forwarding the source causes the AI to reason in the wrong language and Translate-OUT to double-translate, producing audio in unrelated languages.
5. On gpt-realtime-2's audio delta:
   - Forward base64 24 kHz chunks to Translate-OUT `input_audio_buffer.append`.
6. On Translate-OUT's audio delta:
   - 24→8 kHz downsample → 80-sample frames → KooKoo media packets (with `seqid`).

### Required env vars

```
OPENAI_API_KEY=sk-...
CALLER_LANGUAGE=          # ISO code (es, hi, te, ar, ...) or empty for auto-detect
MODE=translate            # if you're gating the bridge behind a flag in an existing app
```

### gpt-realtime-2 instructions for the bridge

```
You are a phone receptionist. Reply ONLY in clear, natural English in 1-3 sentences.
A separate translator speaks your words to the caller in their language —
do NOT switch language yourself. No markdown. Never claim to be human;
say "I'm the receptionist" if pressed.
```

### Known trade-offs / pitfalls

- **No greeting first** in auto-detect mode: the AI must wait for the caller's first utterance so source language can be detected before Translate-OUT opens. Set `CALLER_LANGUAGE` explicitly to allow an opening greeting.
- **Latency stacks**: ~1.5–2 s first turn, ~1 s subsequent. Acceptable for phone, not for snappy IVR.
- **Cost ~3×** stock OpenAI per call (three concurrent OpenAI sessions).
- **Barge-in is not free**: Translate-IN's VAD doesn't propagate cancel signals to gpt-realtime-2 / Translate-OUT. To support interruption, on Translate-IN `input_audio_buffer.speech_started` send `response.cancel` to gpt-realtime-2, drop pending Translate-OUT audio, and emit `{"command":"clearBuffer"}` to KooKoo.
- **Event-name variance**: OpenAI has shipped both `response.audio.delta` and `response.output_audio.delta` over time. Handle both.

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
| Logs show `event=NewCall` with empty `sid=` `cid=` and full params is just `{"event":"NewCall"}` | KooKoo portal "Test Application URL" ping, not a real call | Place an actual phone call to your KooKoo number. Test pings never open the WebSocket and shouldn't create DB rows — gate side effects on `sid && cid` being present. |
| Real call connects but no `[WS] New connection` log line | KooKoo can't reach your WebSocket URL | Verify the `<stream url>` is `wss://` (not `ws://`), the host is publicly reachable, and there's no Cloudflare/Railway WAF blocking the upgrade. Test with `wscat -c <url>` from outside your network. |
| Translate-bridge: caller hears wrong / random language | Forwarded the *source* transcript (caller's language) to gpt-realtime-2 | Forward the **translated** transcript (English) to gpt-realtime-2. Source transcript is for logging only. |
| Translate-bridge: caller hears nothing | Translate-OUT never opened (auto-detect didn't fire) | Log raw Translate-IN events and look for the `language` field. Set `CALLER_LANGUAGE` explicitly as a fallback. |
| Translate-bridge: chipmunk / robotic audio | Wrong sample rate (16 kHz instead of 24 kHz) on OpenAI side | OpenAI Realtime + Translate use 24 kHz, NOT 16 kHz. Don't reuse the ElevenLabs 8↔16 helpers. |
| Translate-bridge: AI replies in caller's language but Translate-OUT mangles it | gpt-realtime-2 ignored the English-only instruction | Tighten the system prompt: "Reply ONLY in English. A separate translator speaks to the caller." |
| Translate-bridge: session opens, audio sends correctly, but no `session.input_transcript.*` events ever fire | `gpt-realtime-translate` model's auto-VAD did not trigger reliably as of May 2026 | Switch to **MODE=multilingual** (single `gpt-realtime-2` session, audio I/O, natively multilingual). The translate-bridge approach is still experimental — manual commits and explicit `transcription` config are both rejected by the API. |
| Translate-out swallows audio silently — caller hears nothing | Target language same as source language (e.g. `en→en`) | Either route AI English audio direct to the caller (skip translate-out entirely for English speakers) or only open translate-out once a non-English caller language is detected. The translate model no-ops on same-language pairs. |
| `Missing required parameter: 'session.type'` from gpt-realtime-2 | New schema requires `session.type: 'realtime'` | Add `type: 'realtime'` inside the `session` object of `session.update`. |
| `Missing required parameter: 'session.audio.output.format.rate'` | Output format requires explicit rate even when input has it | Set `audio.output.format.rate: 24000`. |
| `Unknown parameter: 'session.modalities'` from gpt-realtime-2 | Field renamed in the new schema | Use `output_modalities: ["audio"]` instead. |
| `Unknown parameter: 'session.turn_detection'` from gpt-realtime-2 | Field moved out of session root | Nest under `audio.input.turn_detection: { type: "semantic_vad" }`. |
| Logs say `mode=multilingual` (or any non-default) but `[CallHandler]` runs | Older Railway deploy still active — current code's mode-routing isn't deployed | Force a redeploy in Railway, then verify with `curl /` and confirm the `commit` field matches the latest pushed commit SHA. |

---

## How users get started with KooKoo

Tell users who are new to KooKoo:

1. **Sign up** at **ozonetel.com** or **kookoo.in**
2. Go to the dashboard and **get a phone number** (Indian virtual number)
3. Find the **IVR/Application URL** setting for that number
4. Paste your deployed app URL: `https://your-railway-app.up.railway.app/kookoo`
5. **Call the number** — your AI voice agent answers!

The `kookoo-voicebot` SDK handles everything: XML responses, WebSocket audio streaming, format conversion, and ElevenLabs/OpenAI integration. The user just writes the business logic in hooks.
