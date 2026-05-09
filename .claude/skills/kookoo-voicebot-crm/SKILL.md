---
name: kookoo-voicebot-crm
description: "Wire dynamic CRM/customer data into a KooKoo voicebot built with the kookoo-voicebot SDK or the multilingualHandler reference implementation. Use when the user wants to personalize their AI receptionist with caller-specific data — name, last order, open tickets, account tier, custom field, anything from HubSpot, Salesforce, Zendesk, MongoDB, Postgres, a REST API, Google Sheets, or their own database. Covers both (a) static context injected into the system prompt at call start and (b) dynamic tool/function calls the model triggers mid-conversation to look up data on demand. Pairs with the kookoo-voicebot skill — use kookoo-voicebot first to scaffold the project, then this skill to add CRM personalization."
argument-hint: "[describe what CRM data and which CRM]"
allowed-tools: Bash(npm *) Bash(node *) Bash(git *) Bash(curl *) Read Write Edit Grep Glob WebFetch
---

# KooKoo Voicebot — CRM Integration

You are wiring CRM data into a phone-based AI receptionist that is already built or scaffolded with `kookoo-voicebot` (multilingual mode preferred). The user describes which CRM and what data they want personalized. You implement both static context injection and dynamic tool calls so the AI knows the caller and can fetch data on demand.

## What the user said

**$ARGUMENTS**

## Decision tree

**Step 0 — Confirm the prerequisite.** This skill assumes:
- A working voicebot project already exists (scaffolded via `/kookoo-voicebot` or the reference implementation in the `kookoo-ai-receptionist` backend).
- It's running in `MODE=multilingual` (single `gpt-realtime-2` session) OR using `provider: 'openai'` in the npm SDK.
- If it's in `MODE=elevenlabs`, redirect them: ElevenLabs handles dynamic data via `custom_llm_extra_body` and the agent's dashboard, NOT via this skill.
- If it's in `MODE=translate`, suggest moving to `multilingual` first — translate-bridge code paths don't have CRM hooks.

**Step 1 — Identify the CRM.** Ask if not stated: which CRM?
- Real CRMs: HubSpot, Salesforce, Zendesk, Pipedrive, Intercom, Freshdesk, Zoho.
- Database-as-CRM: MongoDB, Postgres, MySQL, SQLite.
- Spreadsheet-as-CRM: Google Sheets, Airtable.
- API-as-CRM: their own REST/GraphQL backend.
- File-as-CRM: CSV / JSON file (cache it; don't read per call).

**Step 2 — Identify what data to inject.** Common asks:
- Caller's name, tier, account status (great for greeting personalization)
- Last order / last appointment / last interaction (great for quick context)
- Open tickets, pending tasks, unpaid invoices (great for issue triage)
- Account-tier-specific behavior (priority callers get faster transfer; trial users get upsell prompt)

**Step 3 — Identify what data the AI may fetch mid-call.** Common asks:
- Look up an order by ID the caller mentions
- Check appointment availability
- Create / update a ticket
- Verify an OTP, account number, etc.
- Schedule a callback
- Hand off to a department / human

## Two patterns — usually you want both

### Pattern 1 — Static context at call start

Inject CRM data into the **system prompt** before the OpenAI session opens. The AI knows the caller from turn one.

This is the cheapest, lowest-latency way to personalize. Add ~5–20 lines to `_onStart`:

```js
// src/services/multilingualHandler.js (or your equivalent)
const crm = require('./crmService');

async _onStart(message) {
  // ... existing parsing of ucid, did, callerNumber, etc. ...

  const crmCaller = await crm.lookupByPhone(this.callerNumber);  // your lookup
  const recentActivity = crmCaller ? await crm.recentActivity(crmCaller.id, { limit: 3 }) : [];

  const callerContext = crmCaller
    ? `\nCALLER CONTEXT (from CRM, do not read aloud verbatim):
- Name: ${crmCaller.name}
- Account tier: ${crmCaller.tier}
- Status: ${crmCaller.status}
- Recent activity:
${recentActivity.map(a => `  · ${a.timestamp} — ${a.summary}`).join('\n')}

Greet by name. Reference recent activity only if it's relevant to what they say.`
    : `\nCALLER CONTEXT: This phone number is not in our CRM yet — treat as a new caller.`;

  this.realtime = new OpenAIRealtimeSession({
    ucid: this.ucid,
    audioInputMode: true,
    instructions: `${MULTILINGUAL_PROMPT}${callerContext}`,
    // ... rest of the config
  });
  this.realtime.connect();
}
```

**Trade-offs:**
- ✅ Zero added latency per turn — context is in the prompt.
- ✅ Works even if the caller never explicitly references the data.
- ❌ Snapshot at call start; if CRM data changes mid-call (e.g. someone closes a ticket while they're on the line) the AI doesn't see it.
- ❌ Don't dump *all* CRM data — limit to ~500 tokens. Long prompts slow first-turn latency.

**Token-budget rule of thumb:** if your CRM context exceeds ~300 tokens, paginate or summarize. Use Pattern 2 below for the rest.

### Pattern 2 — Dynamic tools (model fetches data on demand)

Define function-calling tools the AI invokes mid-conversation. The model decides when based on what the caller says.

```js
// In _openRealtime() — pass tools alongside instructions
this.realtime = new OpenAIRealtimeSession({
  // ...
  instructions: dynamicInstructions,
  tools: [
    {
      type: 'function',
      name: 'lookup_order',
      description: 'Get the status of an order by order number. Use when the caller mentions an order ID like 12345 or asks about an order they placed.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string', description: 'The order number, digits only' } },
        required: ['orderId'],
      },
    },
    {
      type: 'function',
      name: 'create_ticket',
      description: 'Create a support ticket when the caller has an issue we cannot resolve immediately.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['subject', 'description'],
      },
    },
    {
      type: 'function',
      name: 'transfer_to_agent',
      description: 'Transfer the caller to a human agent. Use when caller explicitly asks for a human, or when we cannot help.',
      parameters: {
        type: 'object',
        properties: { department: { type: 'string', enum: ['sales', 'support', 'billing'] } },
        required: ['department'],
      },
    },
  ],
});
```

Then handle the tool call event in `OpenAIRealtimeSession._handleMessage`:

```js
case 'response.function_call_arguments.done': {
  const args = JSON.parse(msg.arguments || '{}');
  let result;
  try {
    result = await this.onToolCall({ name: msg.name, args, id: msg.call_id });
  } catch (err) {
    result = { error: err.message };
  }

  // Send the tool's result back to the model
  this._send({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: msg.call_id,
      output: JSON.stringify(result || { success: true }),
    },
  });
  this._send({ type: 'response.create' });
  break;
}
```

In the bridge handler, route the tool calls to your CRM service:

```js
this.realtime = new OpenAIRealtimeSession({
  // ...
  onToolCall: async ({ name, args }) => {
    if (name === 'lookup_order')      return await crm.getOrder(args.orderId);
    if (name === 'create_ticket')     return await crm.createTicket(this.callerProfile?._id, args);
    if (name === 'transfer_to_agent') {
      this._transferToDepartment(args.department);
      return { success: true };
    }
    return { error: `unknown_tool: ${name}` };
  },
});
```

**Trade-offs:**
- ✅ Real-time CRM access; AI can handle arbitrarily complex flows.
- ✅ Caller-mentioned IDs (orders, tickets) get verified against the CRM.
- ❌ Adds 200–500 ms latency per tool call.
- ❌ Tool descriptions matter — vague descriptions = AI doesn't call when it should.
- ❌ Function-call output must be JSON-serializable. Don't return circular references.

## CRM service skeleton

Create `src/services/crmService.js`. Same pattern regardless of which CRM — only the implementations of `lookupByPhone`, `getOrder`, etc. change.

```js
// Switchable adapter pattern. The handler always calls these methods;
// only the backing CRM client changes.

const adapter = (() => {
  const kind = process.env.CRM_ADAPTER || 'mock';
  switch (kind) {
    case 'hubspot':    return require('./crm-adapters/hubspot');
    case 'salesforce': return require('./crm-adapters/salesforce');
    case 'mongo':      return require('./crm-adapters/mongo');
    case 'rest':       return require('./crm-adapters/rest');   // your own backend
    case 'mock':
    default:           return require('./crm-adapters/mock');
  }
})();

module.exports = {
  lookupByPhone:  (phone)            => adapter.lookupByPhone(phone),
  recentActivity: (callerId, opts)   => adapter.recentActivity(callerId, opts),
  getOrder:       (orderId)          => adapter.getOrder(orderId),
  createTicket:   (callerId, ticket) => adapter.createTicket(callerId, ticket),
};
```

### Adapter examples

**`crm-adapters/mock.js`** — for early testing without a real CRM:
```js
module.exports = {
  async lookupByPhone(phone) {
    if (phone.endsWith('5032')) return { id: 'demo-1', name: 'Anil', tier: 'premium', status: 'active' };
    return null;
  },
  async recentActivity()      { return []; },
  async getOrder(orderId)     { return { orderId, status: 'shipped', eta: '2026-05-12' }; },
  async createTicket(_, t)    { return { ticketId: 'TKT-' + Date.now(), ...t }; },
};
```

**`crm-adapters/hubspot.js`** — HubSpot via their REST API:
```js
const axios = require('axios');
const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE  = 'https://api.hubapi.com';

module.exports = {
  async lookupByPhone(phone) {
    const r = await axios.post(`${BASE}/crm/v3/objects/contacts/search`, {
      filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }],
      properties: ['firstname','lastname','customer_tier','lifecyclestage'],
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const c = r.data.results[0];
    if (!c) return null;
    return {
      id: c.id,
      name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
      tier: c.properties.customer_tier || 'standard',
      status: c.properties.lifecyclestage || 'unknown',
    };
  },
  async recentActivity(callerId, { limit = 3 } = {}) {
    const r = await axios.get(`${BASE}/crm/v3/objects/contacts/${callerId}/associations/notes?limit=${limit}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } });
    // ... fetch each note's body, return [{timestamp, summary}, ...]
  },
  // getOrder, createTicket — call HubSpot's deals / tickets APIs
};
```

**`crm-adapters/mongo.js`** — your own MongoDB collection:
```js
const mongoose = require('mongoose');
const Customer = mongoose.model('Customer', new mongoose.Schema({
  phone: { type: String, index: true, unique: true },
  name: String, tier: String, status: String, /* ... */
}));

module.exports = {
  async lookupByPhone(phone) { return await Customer.findOne({ phone }); },
  async recentActivity()     { return []; /* or query an Activities collection */ },
  // ...
};
```

**`crm-adapters/rest.js`** — your own backend service:
```js
const axios = require('axios');
const BASE = process.env.CRM_API_URL;
const KEY  = process.env.CRM_API_KEY;
const headers = { 'Authorization': `Bearer ${KEY}` };

module.exports = {
  async lookupByPhone(phone) {
    const r = await axios.get(`${BASE}/customers/by-phone/${encodeURIComponent(phone)}`, { headers });
    return r.data.customer || null;
  },
  // ...
};
```

## Integration steps in order

1. **Add the adapter directory:** `src/services/crm-adapters/` with `mock.js` and the real adapter for the user's CRM (`hubspot.js`, `salesforce.js`, `mongo.js`, `rest.js`, etc.).
2. **Add the dispatcher:** `src/services/crmService.js` switching on `CRM_ADAPTER` env var.
3. **Update `multilingualHandler._onStart`** to look up the caller and inject context into instructions before opening the OpenAI session.
4. **Update `OpenAIRealtimeSession`** to accept a `tools` array and an `onToolCall` callback, and to handle `response.function_call_arguments.done` events (see code above).
5. **Update `multilingualHandler._openRealtime`** to pass `tools` and `onToolCall`.
6. **Add env vars** to `.env.example`: `CRM_ADAPTER=hubspot` (or whichever) plus the credential vars.
7. **Test with mock first** (`CRM_ADAPTER=mock`), then flip to the real CRM.
8. **Persist tool calls** to MongoDB if you want them visible on the dashboard. Add a `toolCalls` array to the CallSession schema and append on each call.

## Test plan

For each integration the user wants:

| Test | Steps |
|---|---|
| Unknown caller (no CRM hit) | Call from a number not in CRM. Greeting should NOT use a name. |
| Known caller (static context works) | Call from a phone that's in CRM. Greeting should reference name and tier. |
| Tool call fires when expected | Mention an order ID — model should call `lookup_order` and quote the status. |
| Tool call doesn't fire when not expected | Just chitchat with no order mention — `lookup_order` should not be called. |
| Tool error handling | Pass an invalid order ID; CRM throws; AI should apologize, not crash. |
| Latency budget | Track `[Tool] start … done` timings — keep tool round-trip under 500 ms. |

Add `[Tool]` log lines around the `onToolCall` invocation so you can read latency in Railway logs.

## Common pitfalls

| Pitfall | Fix |
|---|---|
| AI greets by wrong name | CRM lookup matched a stale or wrong record. Add confidence threshold; if `tier=null && status=null`, treat as no-match. |
| AI hallucinates orders / tickets that don't exist | Tool descriptions weren't strict enough — model invents IDs. Tighten description: "Only call this if the caller mentions an actual order number consisting of 5+ digits." |
| AI never calls a tool | Description doesn't match how callers phrase it. Add common phrasings to the description. Test with `--openai-en` first if the multilingual model gets confused. |
| Tool call returns huge payload, AI gets stuck | Trim the result before returning. The model has to read it; keep results under ~1 KB. |
| Sensitive data leaks into transcript | Don't put full PAN / SSN / passwords into static context or tool results. Only inject what the AI actually needs to be helpful. |
| Tool latency makes call feel laggy | Cache CRM lookups per call (`crmCaller` is fetched once at start; reuse). Use `Promise.all` for parallel lookups in `_onStart`. |
| Tool call fires but model doesn't speak the result | The `response.create` after `function_call_output` is essential. Without it, the model has the data internally but doesn't generate a reply. |
| AI replies in English even though CRM context is in caller's language | Static context is just a hint to the model. The system prompt's language instruction wins. Keep CRM data labels in English; the AI will translate naturally for the caller. |

## What NOT to put in CRM context

- Full payment details (PAN, CVV, full card number)
- Passwords, OTPs older than 60 seconds, security answers
- Other customers' data
- Anything you wouldn't email to the caller

The OpenAI Realtime API logs prompts at the API edge for safety. Treat the system prompt as "internal but auditable."

## Where the SDK already helps

If you're using the npm `kookoo-voicebot` SDK with `provider: 'openai'`, the hooks make CRM injection painless:

```js
new KooKooVoiceBot({ provider: 'openai', openai: { /* base config */ } }, {
  async getInitData({ did, ucid, metadata }) {
    const phone = metadata.cid_e164 || metadata.call_id;
    const crmCaller = await crm.lookupByPhone(phone);
    return {
      instructions: `${BASE_PROMPT}${formatCallerContext(crmCaller)}`,
      voice: crmCaller?.preferred_voice || 'alloy',
      tools: buildToolsForCaller(crmCaller),
    };
  },
  onToolCall: async ({ name, params }) => {
    if (name === 'lookup_order') return crm.getOrder(params.orderId);
    // ... etc
  },
});
```

Same patterns apply, just plugged into the SDK's hooks instead of writing your own handler. See voxa (`github.com/anoopk405/voice-exp`) for a reference of `getInitData` driving per-tenant config.

## Hand-off

Once the integration is done, update the relevant project's `docs/multilingual-call-flow.md` (if it exists) with a new section pointing to the CRM integration. Don't duplicate this skill's content there — just link.

If the user is still on `MODE=elevenlabs`, this skill doesn't apply — direct them to ElevenLabs's `custom_llm_extra_body` mechanism instead.
