/**
 * Voice agent that can transfer calls to different departments.
 *
 * Set up ElevenLabs agent tools:
 *   - transfer_call(department: string) — transfers the caller
 *   - take_voicemail(message: string)   — records a voicemail
 */

const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const EXTENSIONS = {
  sales: '9001',
  support: '9002',
  billing: '9003',
};

// Track transfer decisions per call
const callState = new Map();

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    elevenlabs: {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      apiKey: process.env.ELEVENLABS_API_KEY,
    },
  },
  {
    onToolCall({ ucid, name, params }) {
      if (name === 'transfer_call') {
        const dept = (params.department || '').toLowerCase();
        const number = EXTENSIONS[dept];
        if (number) {
          callState.set(ucid, { action: 'transfer', number, dept });
          return { success: true, message: `Transferring to ${dept}` };
        }
        return { success: false, message: 'Unknown department' };
      }

      if (name === 'take_voicemail') {
        callState.set(ucid, { action: 'voicemail', message: params.message });
        return { success: true };
      }

      return { success: true };
    },

    onPostStream({ ucid }) {
      const state = callState.get(ucid);
      callState.delete(ucid);

      if (state?.action === 'transfer') {
        return xml.transfer(state.number);
      }

      if (state?.action === 'voicemail') {
        return xml.playAndHangup('Your message has been recorded. We will call you back shortly.');
      }

      return xml.playAndHangup('Thank you for calling. Goodbye!');
    },

    onCallEnd({ ucid }) {
      callState.delete(ucid);
    },
  }
);

bot.start();
