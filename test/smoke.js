const {
  KooKooVoiceBot, xml, ElevenLabsSession, OpenAIRealtimeSession,
  samplesToBase64, base64ToChunks, samplesToBase64_24k, base64ToChunks_24k, buildMediaPacket,
} = require('../src/index');

// Test exports
console.assert(typeof KooKooVoiceBot === 'function', 'KooKooVoiceBot');
console.assert(typeof ElevenLabsSession === 'function', 'ElevenLabsSession');
console.assert(typeof OpenAIRealtimeSession === 'function', 'OpenAIRealtimeSession');
console.assert(typeof xml.playAndHangup === 'function', 'xml.playAndHangup');
console.assert(typeof xml.transfer === 'function', 'xml.transfer');
console.assert(typeof xml.ccTransfer === 'function', 'xml.ccTransfer');
console.assert(typeof xml.hangup === 'function', 'xml.hangup');

// Test audio 16kHz (ElevenLabs)
const samples = [100, -200, 300, -400, 500, 0, 0, 0];
const b64_16 = samplesToBase64(samples);
console.assert(typeof b64_16 === 'string' && b64_16.length > 0, 'samplesToBase64 16k');

// Test audio 24kHz (OpenAI)
const b64_24 = samplesToBase64_24k(samples);
console.assert(typeof b64_24 === 'string' && b64_24.length > 0, 'samplesToBase64_24k');
console.assert(b64_24.length > b64_16.length, '24k should be larger than 16k');

// Test media packet
const packet = buildMediaPacket('test-ucid', [1, 2, 3]);
const parsed = JSON.parse(packet);
console.assert(parsed.ucid === 'test-ucid', 'packet ucid');
console.assert(parsed.data.sampleRate === 8000, 'packet 8kHz');

// Test XML helpers
console.assert(xml.playAndHangup('Hello').includes('<playtext'), 'playtext tag');
console.assert(xml.transfer('9001').includes('9001'), 'dial number');
console.assert(xml.ccTransfer('general', 'sales').includes('<cctransfer'), 'cctransfer tag');

// Test ElevenLabs constructor (default provider)
const bot1 = new KooKooVoiceBot({ sipNumber: '1234', elevenlabs: { agentId: 'test' } });
console.assert(bot1.config.provider === 'elevenlabs', 'default provider elevenlabs');

// Test OpenAI constructor (auto-detect provider)
const bot2 = new KooKooVoiceBot({ sipNumber: '1234', openai: { apiKey: 'sk-test' } });
console.assert(bot2.config.provider === 'openai', 'auto-detect openai provider');

// Test explicit provider
const bot3 = new KooKooVoiceBot({ sipNumber: '1234', provider: 'openai', openai: { apiKey: 'sk-test' } });
console.assert(bot3.config.provider === 'openai', 'explicit openai provider');

console.log('All tests passed');
