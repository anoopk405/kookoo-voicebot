/**
 * AI Receptionist using OpenAI Realtime API (GPT-4o).
 *
 * No ElevenLabs needed — OpenAI handles STT + LLM + TTS in one connection.
 *
 * Set env vars: OPENAI_API_KEY, SIP_NUMBER
 */

const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    provider: 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-realtime-preview',
      voice: 'nova', // alloy, echo, fable, onyx, nova, shimmer
      instructions: `You are a professional, friendly AI receptionist answering phone calls.

RULES:
- Keep responses SHORT (1-3 sentences) — this is a phone call
- Greet callers warmly and ask how you can help
- If they want sales, support, or billing, use the transfer_call function
- If no one is available, use take_voicemail to record a message
- Try to learn the caller's name
- Be polite, patient, and empathetic
- Speak naturally — no markdown or formatting`,
      tools: [
        {
          type: 'function',
          name: 'transfer_call',
          description: 'Transfer the caller to a department',
          parameters: {
            type: 'object',
            properties: {
              department: {
                type: 'string',
                enum: ['sales', 'support', 'billing'],
                description: 'Department to transfer to',
              },
            },
            required: ['department'],
          },
        },
        {
          type: 'function',
          name: 'take_voicemail',
          description: 'Record a voicemail message from the caller',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'The voicemail message summary' },
            },
            required: ['message'],
          },
        },
      ],
    },
  },
  {
    onCallStart({ ucid, callerId }) {
      console.log(`Call started: ${ucid} from ${callerId}`);
    },

    onTranscript({ role, text }) {
      console.log(`[${role}] ${text}`);
    },

    onToolCall({ name, params }) {
      console.log(`Tool: ${name}`, params);
      return { success: true };
    },

    onCallEnd({ ucid }) {
      console.log(`Call ended: ${ucid}`);
    },

    onPostStream() {
      return xml.playAndHangup('Thank you for calling. Have a great day!');
    },
  }
);

bot.start();
