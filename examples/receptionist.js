/**
 * AI Receptionist — complete example in ~40 lines.
 *
 * 1. Create an ElevenLabs Conversational AI agent at elevenlabs.io
 * 2. Set your agent's system prompt to be a receptionist
 * 3. Set env vars: ELEVENLABS_AGENT_ID, ELEVENLABS_API_KEY, SIP_NUMBER
 * 4. Deploy to Railway and point your KooKoo IVR URL to /kookoo
 */

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
      console.log(`📞 Call started: ${ucid} from ${did}`);
    },

    onTranscript({ ucid, role, text }) {
      console.log(`💬 [${role}] ${text}`);
    },

    onToolCall({ name, params }) {
      console.log(`🔧 Tool: ${name}`, params);
      if (name === 'transfer_call') return { transferred: true };
      if (name === 'take_voicemail') return { recorded: true };
      return { success: true };
    },

    onCallEnd({ ucid }) {
      console.log(`📴 Call ended: ${ucid}`);
    },

    // What happens after the AI stream ends (call is still active)
    onPostStream({ params }) {
      return xml.playAndHangup('Thank you for calling. Have a great day!');
    },
  }
);

bot.start();
