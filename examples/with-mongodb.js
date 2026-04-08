/**
 * Voice agent with MongoDB persistence — stores calls and transcripts.
 */

const mongoose = require('mongoose');
const { KooKooVoiceBot, xml } = require('kookoo-voicebot');

// Simple call log schema
const CallLog = mongoose.model('CallLog', new mongoose.Schema({
  ucid: String,
  did: String,
  transcript: [{ role: String, text: String, time: { type: Date, default: Date.now } }],
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
}));

const bot = new KooKooVoiceBot(
  {
    sipNumber: process.env.SIP_NUMBER,
    elevenlabs: {
      agentId: process.env.ELEVENLABS_AGENT_ID,
      apiKey: process.env.ELEVENLABS_API_KEY,
    },
  },
  {
    async onCallStart({ ucid, did }) {
      await CallLog.create({ ucid, did });
    },

    async onTranscript({ ucid, role, text, isFinal }) {
      if (!isFinal) return;
      await CallLog.updateOne({ ucid }, { $push: { transcript: { role, text } } });
    },

    async onCallEnd({ ucid }) {
      await CallLog.updateOne({ ucid }, { endedAt: new Date() });
    },

    onPostStream() {
      return xml.playAndHangup('Goodbye!');
    },
  }
);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  await bot.start();
}

main();
