---
name: kookoo-voicebot
description: Scaffold, configure, and deploy AI voice agents on KooKoo/Ozonetel telephony with ElevenLabs. Use when building voice bots, IVR systems, or phone-based AI agents.
argument-hint: "[action: init | add-hooks | add-transfer | add-mongodb | deploy | health | debug]"
allowed-tools: Bash(npm *) Bash(node *) Bash(git *) Bash(curl *) Read Write Edit Grep Glob WebFetch
---

# KooKoo VoiceBot Skill

You are helping a developer build an AI voice agent using the `kookoo-voicebot` npm package. This package connects KooKoo/Ozonetel telephony to ElevenLabs Conversational AI with zero telephony knowledge required.

## Action: $ARGUMENTS

Based on the action, follow the appropriate section below. If no action is provided, show available actions and ask what the user wants to do.

---

## Action: init

Scaffold a new kookoo-voicebot project from scratch:

1. Create a new directory (or use current) and run `npm init -y`
2. Install: `npm install kookoo-voicebot`
3. Create `index.js` with this starter:

```js
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    elevenlabs: {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      apiKey: process.env.ELEVENLABS_API_KEY,
    },
  },
  {
    onCallStart({ ucid, did }) {
      console.log(`Call started: ${ucid} from ${did}`);
    },
    onTranscript({ ucid, role, text, isFinal }) {
      if (isFinal) console.log(`[${role}] ${text}`);
    },
    onCallEnd({ ucid }) {
      console.log(`Call ended: ${ucid}`);
    },
    onPostStream() {
      return xml.playAndHangup('Thank you for calling. Goodbye!');
    },
  }
);

bot.start();
```

4. Create `.env.example`:
```
ELEVENLABS_AGENT_ID=agent_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
SIP_NUMBER=524431
PORT=3000
```

5. Create `Procfile`: `web: node index.js`
6. Create `.gitignore` with `node_modules/`, `.env`, `*.log`
7. Tell the user to:
   - Create an ElevenLabs agent at elevenlabs.io > Conversational AI
   - Set the agent system prompt to match their use case
   - Copy the agent ID from the URL (format: `agent_xxxx`)
   - Set env vars and deploy to Railway

---

## Action: add-hooks

Add lifecycle hooks to an existing kookoo-voicebot project. Read the current `index.js`, find the KooKooVoiceBot constructor, and add hooks the user asks for. Available hooks:

| Hook | Signature | Purpose |
|------|-----------|---------|
| `onCallStart` | `({ucid, did, metadata})` | New call connected |
| `onCallEnd` | `({ucid})` | Call disconnected |
| `onTranscript` | `({ucid, role, text, isFinal})` | User or agent spoke |
| `onToolCall` | `({ucid, name, params, id}) => result` | ElevenLabs agent invoked a tool |
| `onInterrupt` | `({ucid})` | User barged in |
| `onPostStream` | `({ucid, params}) => xmlString` | After AI stream ends, return KooKoo XML |
| `getInitData` | `({ucid, did}) => object` | Pass data to ElevenLabs on connect |
| `onError` | `({ucid, error})` | Error occurred |
| `onCDR` | `(data)` | KooKoo CDR callback received |

---

## Action: add-transfer

Add call transfer capability to the voice bot:

1. Add a `onToolCall` hook that handles `transfer_call` and `take_voicemail`
2. Add a `onPostStream` hook that returns the appropriate XML based on the tool call
3. Create a map of department extensions
4. Remind the user to add matching tools in their ElevenLabs agent config:
   - Tool `transfer_call` with parameter `department` (string)
   - Tool `take_voicemail` with parameter `message` (string)

Use `xml.transfer(number)` for direct dial, `xml.ccTransfer(queue, dept)` for contact center.

---

## Action: add-mongodb

Add MongoDB persistence to the voice bot:

1. Install mongoose: `npm install mongoose`
2. Create a CallLog schema
3. Add `onCallStart` → create record, `onTranscript` → push to transcript array, `onCallEnd` → set endedAt
4. Connect mongoose before `bot.start()`
5. Add `MONGODB_URI` to `.env.example`

---

## Action: deploy

Guide the user to deploy their voice bot to Railway:

1. Verify `Procfile` exists with `web: node index.js`
2. Verify `.gitignore` excludes `.env` and `node_modules/`
3. Commit and push to GitHub
4. Create a Railway project, connect the GitHub repo
5. Set environment variables in Railway dashboard:
   - `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY`, `SIP_NUMBER`
   - `MONGODB_URI` (if using MongoDB)
6. Deploy — Railway auto-detects Node.js
7. The WebSocket URL is auto-detected from `RAILWAY_PUBLIC_DOMAIN`
8. Point KooKoo IVR URL to `https://<railway-domain>/kookoo`

---

## Action: health

Check the health of a deployed kookoo-voicebot:

1. Ask for the Railway URL if not obvious from env/config
2. Fetch `https://<url>/health` and display the result
3. Fetch `https://<url>/` to check active calls
4. If unhealthy, suggest checking Railway logs

---

## Action: debug

Help debug common issues. Check for these problems:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `agent does not exist` | Wrong ELEVENLABS_AGENT_ID | Use the ID from the URL, not the name (format: `agent_xxxx`) |
| `Override not allowed` | Agent config locks overrides | Don't send config overrides, or enable in ElevenLabs Security tab |
| `MongoDB connection error` | Bad URI or whitespace | Ensure URI is a single line, no line breaks |
| Blank audio / silence | ElevenLabs not connected | Check agent ID and API key, check Railway logs |
| `wss://your-railway-app` in logs | WEBSOCKET_URL not set | Remove the placeholder — SDK auto-detects from RAILWAY_PUBLIC_DOMAIN |
| Stream duration=1 | WebSocket URL unreachable | Check the wss:// URL in logs matches your Railway domain |
| `Thank you goodbye` immediately | Post-stream default | Normal — this plays after AI conversation ends |
| Dashboard not showing calls | MongoDB disconnected | Set MONGODB_URI in Railway Variables (not .env file) |

---

## KooKoo Audio Format Reference

For debugging audio issues:

- **Format**: PCM Linear 16-bit, 8000 Hz, mono
- **Chunk**: 80 samples (10ms)
- **First packet**: 16kHz / 160 frames — must be ignored (SDK does this automatically)
- **Send back**: Same JSON format with `sampleRate: 8000`
- **Commands**: `{"command": "clearBuffer"}` for barge-in, `{"command": "callDisconnect"}` to end

## KooKoo IVR XML Tags

For `onPostStream` responses:

```xml
<!-- Play text and hang up -->
<playtext lang="en-IN" speed="3" quality="best" type="ggl">Hello</playtext>
<hangup/>

<!-- Transfer to number -->
<dial record="true">9001</dial>

<!-- Transfer to contact center queue -->
<cctransfer record="" moh="default" uui="sales" timeout="30" ringType="ring">general</cctransfer>
```

Use the `xml` helpers instead of raw XML:
```js
const { xml } = require('kookoo-voicebot');
xml.playAndHangup('Goodbye!');
xml.transfer('9001');
xml.ccTransfer('general', 'sales');
xml.hangup();
```
