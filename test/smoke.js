const { KooKooVoiceBot, xml, samplesToBase64, base64ToChunks, buildMediaPacket } = require('../src/index');

// Test exports exist
console.assert(typeof KooKooVoiceBot === 'function', 'KooKooVoiceBot should be a class');
console.assert(typeof xml.playAndHangup === 'function', 'xml.playAndHangup should be a function');
console.assert(typeof xml.transfer === 'function', 'xml.transfer should be a function');
console.assert(typeof xml.ccTransfer === 'function', 'xml.ccTransfer should be a function');
console.assert(typeof xml.hangup === 'function', 'xml.hangup should be a function');

// Test audio conversion roundtrip
const samples = [100, -200, 300, -400, 500, 0, 0, 0];
const b64 = samplesToBase64(samples);
console.assert(typeof b64 === 'string' && b64.length > 0, 'samplesToBase64 should return base64 string');

// Test media packet
const packet = buildMediaPacket('test-ucid', [1, 2, 3]);
const parsed = JSON.parse(packet);
console.assert(parsed.ucid === 'test-ucid', 'packet should have ucid');
console.assert(parsed.data.sampleRate === 8000, 'packet should be 8kHz');
console.assert(parsed.data.samples.length === 3, 'packet should have samples');

// Test XML helpers
const hangupXml = xml.playAndHangup('Hello');
console.assert(hangupXml.includes('<playtext'), 'should contain playtext tag');
console.assert(hangupXml.includes('<hangup/>'), 'should contain hangup tag');

const transferXml = xml.transfer('9001');
console.assert(transferXml.includes('<dial'), 'should contain dial tag');
console.assert(transferXml.includes('9001'), 'should contain number');

const ccXml = xml.ccTransfer('general', 'sales');
console.assert(ccXml.includes('<cctransfer'), 'should contain cctransfer tag');

// Test constructor
const bot = new KooKooVoiceBot({
  sipNumber: '1234',
  elevenlabs: { agentId: 'test', apiKey: 'test' },
}, {
  onCallStart: () => {},
  onTranscript: () => {},
});
console.assert(bot.config.sipNumber === '1234', 'config should be set');

console.log('All tests passed');
