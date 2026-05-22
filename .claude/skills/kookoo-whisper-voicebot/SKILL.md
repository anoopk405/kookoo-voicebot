---
name: kookoo-whisper-voicebot
description: Build a KooKoo phone voice bot that combines streaming STT (gpt-realtime-whisper, word-by-word as the caller speaks) with gpt-realtime-2 in text-in / audio-out mode for the LLM + TTS leg, plus a live dashboard with streaming caption box and pre-warmed OpenAI sessions for sub-second first-turn latency. Use when the user wants a voice agent on KooKoo/Ozonetel telephony AND wants the caller transcript to appear word-by-word on a dashboard as they speak (not just at turn boundaries), or asks for "streaming STT", "whisper streaming with KooKoo", "kookoo + whisper voice bot", or to extend the existing kookoo-voicebot pattern with a real-time caption UI. Differs from the kookoo-voicebot skill: that one uses gpt-realtime-2 (or ElevenLabs) end-to-end where STT is internal; this skill splits STT and LLM+TTS into separate OpenAI sessions so the caller's transcript can stream to a dashboard while the bot reasons over the finalized text.
---

# KooKoo Streaming-Whisper Voice Bot

A KooKoo phone agent with two parallel OpenAI sessions per call:

| Session | Model | Job |
|---|---|---|
| **Whisper** | `gpt-realtime-whisper` | Streaming STT — emits transcript deltas as the caller speaks. Drives dashboard live captions AND feeds the LLM. |
| **Realtime** | `gpt-realtime-2` | LLM + TTS in **text-in / audio-out** mode. Receives whisper's finals as `input_text`, generates spoken responses. |

Use this pattern when:
- The dashboard / operator UI needs to see the caller's words as they're spoken (not after each turn).
- You want exactly-one-source-of-truth for what the AI is reasoning over (whisper's transcript == what shows on dashboard == what gpt-realtime-2 sees).
- You're already on the `kookoo-voicebot` SDK pattern but want a richer monitoring surface.

The canonical implementation lives at https://github.com/anoopk405/whisper-realtime-stream — clone it as a template, or scaffold from scratch using the instructions below.

---

## Architecture

```
                                ┌─ /kookoo?event=NewCall ─────────────┐
Caller ──▶ KooKoo ─────────────▶│  preWarm(sid) opens both OpenAI WSs │
                                │  returns <stream> XML               │
                                └────────────┬────────────────────────┘
                                             │ (~200-500ms later)
                                             ▼
                                ┌─ WS /ws connects (event=start) ─────┐
                                │  sessionCache.attach(ucid, handlers)│
                                │  flush buffered greeting audio      │
                                └────────────┬────────────────────────┘
                                             │
   Caller audio (10ms PCM16 8kHz frames) ────┤
                                             │
                                             ▼
                            ┌─ Whisper WS (intent=transcription) ─────┐
                            │  upsample 8k→24k, append, client VAD    │
                            │  → input_audio_buffer.commit on 200ms   │
                            │     silence                              │
                            │  ├─ delta → dashboard SSE (live captions)│
                            │  └─ completed → realtime.sendUserText() ─┐
                            └─────────────────────────────────────────┘ │
                                                                        │
                                                                        ▼
                            ┌─ Realtime WS (model=gpt-realtime-2) ────┐
                            │  conversation.item.create {input_text}  │
                            │  response.create                        │
                            │  ◀── audio chunks (PCM16 24kHz base64) ─┤
                            └─────────────────────────────────────────┘
                                             │
                                             ▼
                            decimate 24k→8k, 80-sample frames, 10ms pump
                                             │
                                             ▼
                                       KooKoo ──▶ caller hears reply
```

---

## When to use vs. the stock `kookoo-voicebot` skill

| Need | Skill |
|---|---|
| Simple voice bot, no live caption UI | `kookoo-voicebot` (provider: openai) |
| Streaming caller-side captions in a dashboard, while the bot speaks | **this skill** |
| Caller may speak any of 70+ languages with translated AI replies | `kookoo-voicebot` (provider: openai-translate) |
| Want exactly-one transcript source feeding both UI and LLM | **this skill** |

---

## Step-by-step scaffold

### 1. Project layout

```
my-voice-bot/
├── package.json
├── Procfile           # web: node src/server.js
├── railway.json
├── .env.example
├── .gitignore
├── public/
│   ├── index.html     # live call list
│   └── call.html      # per-call live transcript with streaming caption box
└── src/
    ├── server.js                    # HTTP/WS + IVR
    ├── session-cache.js             # pre-warm pool keyed by sid
    ├── openai-realtime-session.js   # gpt-realtime-2 (text-in / audio-out)
    ├── transcription-session.js     # gpt-realtime-whisper (streaming STT + client VAD)
    ├── store.js                     # in-memory call state + SSE pubsub
    └── audio.js                     # 8k↔24k resamplers, KooKoo packet builder
```

### 2. `package.json`

```json
{
  "name": "my-voice-bot",
  "version": "0.1.0",
  "private": true,
  "main": "src/server.js",
  "scripts": { "start": "node src/server.js" },
  "engines": { "node": ">=18" },
  "dependencies": {
    "express": "^4.19.2",
    "ws": "^8.18.0"
  }
}
```

### 3. `.env.example`

```
# Required
OPENAI_API_KEY=sk-...

# Optional — defaults shown
TRANSCRIBE_MODEL=gpt-realtime-whisper
# Supported voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
OPENAI_VOICE=alloy
OPENAI_REASONING_EFFORT=low
# SIP destination KooKoo dials as a placeholder for the bidirectional WS stream.
# Use a non-answering extension on your KooKoo account.
SIP_NUMBER=525837
PORT=3000
```

### 4. Key file contents (canonical)

The full file contents live in the reference repo (https://github.com/anoopk405/whisper-realtime-stream/tree/main/src). Clone that, or use the patterns below.

#### `src/transcription-session.js` — streaming whisper with client VAD

The GA transcription endpoint is `wss://api.openai.com/v1/realtime?intent=transcription`. Headers: only `Authorization` (NO `OpenAI-Beta`).

Session config:

```js
{
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'gpt-realtime-whisper' },
        // NO turn_detection — gpt-realtime-whisper rejects it.
      },
    },
  },
}
```

Client-side VAD knobs (top of file):

```js
const VAD_ENERGY_THRESHOLD = 800;   // PCM16 peak amplitude
const VAD_SILENCE_MS = 200;          // commit after N ms of silence (250 if slow speakers cut off)
const VAD_MAX_CHUNK_MS = 8000;       // force commit if caller never pauses
const MIN_COMMIT_MS = 120;           // OpenAI rejects commits with <100ms of audio
```

Handle these events:
- `conversation.item.input_audio_transcription.delta` → onPartial (streams as caller speaks)
- `conversation.item.input_audio_transcription.completed` → onFinal

#### `src/openai-realtime-session.js` — gpt-realtime-2 text-in / audio-out

URL: `wss://api.openai.com/v1/realtime?model=gpt-realtime-2`. Headers: `Authorization` + `OpenAI-Safety-Identifier`.

Session config (NO `audio.input` — we don't send audio here):

```js
{
  type: 'session.update',
  session: {
    type: 'realtime',
    model: 'gpt-realtime-2',
    instructions: RECEPTIONIST_PROMPT,
    output_modalities: ['audio'],
    audio: {
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
        voice: 'alloy', // pick from supported list above
      },
    },
  },
}
```

Sending a user turn (text):

```js
ws.send(JSON.stringify({
  type: 'conversation.item.create',
  item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
}));
ws.send(JSON.stringify({ type: 'response.create' }));
```

Handle these events:
- `response.output_audio.delta` / `response.audio.delta` → base64 PCM16 24kHz audio chunk
- `response.output_audio_transcript.done` → agent text transcript (for dashboard)
- `session.updated` → fire onReady (now safe to call `sendUserText`)
- `error` → log + close (often a session.update field error; check the message)

#### `src/audio.js` — resamplers + KooKoo packet builder

```js
function upsample8kTo24k(samples) {
  const out = new Int16Array(samples.length * 3);
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = i + 1 < samples.length ? samples[i + 1] : a;
    const o = i * 3;
    out[o]     = a;
    out[o + 1] = Math.round(a * (2 / 3) + b * (1 / 3));
    out[o + 2] = Math.round(a * (1 / 3) + b * (2 / 3));
  }
  return out;
}

function base64Pcm24kToKookooChunks(base64Str) {
  const buf = Buffer.from(base64Str, 'base64');
  const samples24k = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const n8k = Math.floor(samples24k.length / 3);
  const samples8k = new Array(n8k);
  for (let i = 0; i < n8k; i++) {
    samples8k[i] = Math.round(
      (samples24k[i * 3] + samples24k[i * 3 + 1] + samples24k[i * 3 + 2]) / 3
    );
  }
  // Frame into 80-sample (10ms @ 8kHz) chunks
  const chunks = [];
  for (let i = 0; i < samples8k.length; i += 80) {
    const c = samples8k.slice(i, i + 80);
    while (c.length < 80) c.push(0);
    chunks.push(c);
  }
  return chunks;
}

function buildKookooMediaPacket(ucid, samples, seqid) {
  return JSON.stringify({
    event: 'media', type: 'media', ucid, seqid,
    data: {
      samples, bitsPerSample: 16, sampleRate: 8000, channelCount: 1,
      numberOfFrames: samples.length, type: 'data',
    },
  });
}
```

#### `src/session-cache.js` — pre-warm OpenAI sessions at NewCall

Map `sid → { whisper, realtime, audioBuffer, pendingCallerFinals, ... }`. On HTTP `NewCall`, kick off both OpenAI WSs. Buffer any events emitted before the KooKoo WS attaches. On WS `start`, the handler calls `attach(ucid)` which registers the live callbacks AND flushes the buffer.

TTL out orphans after 30s (NewCall fired but KooKoo never opened the WS).

#### `src/server.js` — IVR + WS

The IVR `/kookoo` handler:

```js
app.all('/kookoo', (req, res) => {
  const params = { ...req.query, ...req.body };
  const event = params.event || '';

  if (event === 'NewCall') {
    const sid = (params.sid || '').toString();
    if (sid) sessionCache.preWarm(sid, {
      apiKey: OPENAI_API_KEY,
      transcribeModel: TRANSCRIBE_MODEL,
      instructions: RECEPTIONIST_PROMPT,
      voice: REALTIME_VOICE,
      reasoningEffort: REASONING_EFFORT,
      greetingTrigger: GREETING_TRIGGER,
    });
    res.set('Content-Type', 'text/xml');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<response>
    <start-record/>
    <stream is_sip="true" url="wss://${req.get('host')}/ws">${SIP_NUMBER}</stream>
</response>`);
  }

  if (event === 'Stream') return res.sendStatus(200);   // DO NOT hang up here
  if (event === 'Hangup' || event === 'Disconnect') return res.sendStatus(200);
  res.sendStatus(200);
});
```

The WS handler on `start`:

```js
const handlers = {
  onCallerPartial: (delta) => {
    const cur = store.getCall(ucid);
    store.setCallerPartial(ucid, (cur?.callerPartial || '') + delta);
  },
  onCallerFinal: ({ itemId, transcript }) => {
    store.addSegment(ucid, { role: 'caller', itemId, text: transcript });
    if (realtime?.connected && transcript?.trim()) realtime.sendUserText(transcript);
  },
  onAudioChunk: (b64) => {
    const chunks = base64Pcm24kToKookooChunks(b64);
    for (const c of chunks) audioQueue.push(c);
    startPump();
  },
  onAgentTranscript: ({ itemId, transcript }) => {
    store.addSegment(ucid, { role: 'agent', itemId, text: transcript });
  },
};

const cached = sessionCache.attach(ucid, handlers);
if (cached) {
  whisper = cached.whisper;
  realtime = cached.realtime;
} else {
  // cold-start fallback — create both sessions inline
}
```

The audio pump (10ms `setInterval`):

```js
pumpTimer = setInterval(() => {
  if (audioQueue.length === 0) { clearInterval(pumpTimer); pumpTimer = null; return; }
  if (kookooWs.readyState !== kookooWs.OPEN) return;
  const samples = audioQueue.shift();
  kookooWs.send(buildKookooMediaPacket(ucid, samples, crypto.randomUUID()));
}, 10);
```

### 5. The receptionist prompt (multilingual + terse)

```
You are a warm, professional AI receptionist taking phone calls for a business.

LANGUAGE:
- Detect the caller's language from their first utterance, then continue in THAT language.
- If they switch language mid-call, follow them.
- Default to English if unsure.

STYLE:
- VERY SHORT replies: 1 sentence, max 15 words. This is a phone call — long answers feel slow.
- Speak naturally; no markdown, lists, or emojis.
- Be warm and direct. No filler ("I'd be happy to…", "Let me explain…").
- Ask one focused question at a time when you need more info.
- Never claim to be human, but don't volunteer that you're an AI — say "I'm the receptionist" (in the caller's language).

TASKS:
- Greet warmly and ask how you can help.
- Offer to transfer to sales/support/billing if requested.
- Take a brief voicemail if asked.
- Answer general business questions concisely.
```

### 6. Live dashboard

Two HTML pages backed by SSE endpoints (`/stream-list`, `/stream/:ucid`):

- `public/index.html` — auto-updating list of calls
- `public/call.html` — per-call view with two elements:
  - **Streaming caption box** — green-tinted panel at top showing whisper partials with a blinking caret. Updates on every delta.
  - **Conversation history** — green caller bubbles + blue agent bubbles, appended on each `addSegment`.

Server-side: `store.js` keeps a `Map<ucid, callState>` plus subscriber sets, broadcasts on every mutation.

---

## Deployment (Railway)

1. Push the repo to GitHub.
2. New Railway project → connect repo.
3. Variables to set:
   - `OPENAI_API_KEY` (required)
   - `SIP_NUMBER` (your KooKoo extension placeholder, e.g. `525837`)
   - `OPENAI_VOICE` (optional; default `alloy`)
   - Do **not** set `TRANSCRIBE_MODEL` to `gpt-4o-mini-transcribe` if you want streaming partials — that model emits finals only.
4. Deploy → Railway gives you `https://<app>.up.railway.app`.
5. In KooKoo portal, set the IVR/Application URL to `https://<app>.up.railway.app/kookoo`.

---

## Latency budget (target)

| Stage | Time | Tunable? |
|---|---|---|
| KooKoo NewCall → server preWarm | ~50 ms | no |
| OpenAI WS open + session.update + `session.updated` | ~250-400 ms | runs DURING NewCall→WS gap, free if cache hits |
| KooKoo WS connect + start event | ~300-500 ms after NewCall | no |
| Caller stops speaking → VAD silence | 200 ms | `VAD_SILENCE_MS` (250 if cutting) |
| Whisper commit → `.completed` | ~150 ms | no |
| `sendUserText` → first audio chunk from gpt-realtime-2 | 400-800 ms | dominant cost; mostly fixed |
| Audio queued → KooKoo plays | ~30 ms | no |
| **First-turn perceived (greeting)** | **~700-900 ms** | with pre-warm cache hit |
| **Mid-conversation perceived** | **~800-1200 ms** | dominated by LLM TTFB |

---

## Gotchas & troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid value: 'nova'. Supported values are: 'alloy', 'ash', ...` | Old voice name. GA set as of May 2026: `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar` | Default to `alloy`. Also fix BOTH server.js's `REALTIME_VOICE` default AND the session class's fallback. |
| `Model "gpt-realtime-whisper" is a transcription model and cannot be used as the realtime session model` | Put whisper model in `?model=` URL param | Whisper URL is `?intent=transcription` (no model param). Model goes in `audio.input.transcription.model`. |
| `Passing a transcription session update event to a realtime session is not allowed` | Used `?model=gpt-realtime-2` URL with `session.type: 'transcription'` | These are different endpoints. Use `?intent=transcription` for whisper, `?model=gpt-realtime-2` for realtime. |
| `Turn detection is not supported for this transcription model` | Set `audio.input.turn_detection` on whisper session | Whisper rejects it. Run client-side energy VAD and emit `input_audio_buffer.commit` manually. |
| `Error committing input audio buffer: buffer too small. Expected at least 100ms` | Commit fired with <100ms of audio appended | Track `uncommittedMs` and skip commits below ~120ms. |
| `The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API.` | Old `OpenAI-Beta: realtime=v1` header or `?intent=transcription` *with* beta header | Drop the `OpenAI-Beta` header. The `?intent=transcription` URL is still correct for GA. |
| Call drops immediately after `Stream` event | Server returns `<hangup/>` XML on `Stream` event | `Stream` means the stream leg ended, NOT the call. Return 200 OK; only return `<hangup/>` on `Hangup`/`Disconnect`. |
| Partials log on server but dashboard shows nothing | UI hides them in a small bottom line | Render partials in a prominent live box with a blinking caret. SSE pushes on every delta. |
| Voice bot doesn't reply (silent after caller speaks) | `realtime.sendUserText()` not wired to whisper's `onFinal` | In `onCallerFinal`, after `addSegment`, call `realtime.sendUserText(transcript)` and ensure realtime is connected. |
| Booting up always says `voice=nova` even after fixing the session class | server.js has its own env default | Update the `REALTIME_VOICE` constant in server.js — the env-or-default chain runs there too. |
| Always cold-starting (no pre-warm hit) | `sid` from `NewCall` ≠ `ucid` from WS `start` | They should match. Double-check by logging both. |
| Boots, but calls drop the moment audio starts | Sent invalid value in `session.update` (e.g. unsupported voice) | OpenAI closes with `1005` after the first response. Check the `error` event for the exact field name. |

---

## Extending

- **Barge-in support**: on whisper's `input_audio_buffer.speech_started`, call `realtime.cancelResponse()` and emit `{"command":"clearBuffer"}` to KooKoo to drop already-queued TTS audio.
- **Function calling**: add `tools: [...]` to the realtime session config and handle `response.function_call_arguments.done` events. See https://developers.openai.com/api/docs/guides/realtime-tools.
- **Recorded greeting fallback**: cache the first-turn TTS audio as a WAV; replay it instantly on subsequent calls to drop first-turn latency to ~0ms. Greetings become identical.
- **MongoDB persistence**: mirror `backend/`'s `callSessionService` to write turns + intents per call for analytics.
- **Multi-tenant**: prefix all keys with a tenant id and key the session cache by `(tenantId, sid)`.

---

## Reference implementation

Live working code at https://github.com/anoopk405/whisper-realtime-stream. Recent commits walk the evolution from a transcription-only app to the current voice bot + streaming whisper pattern — useful for understanding what each fix solved.
