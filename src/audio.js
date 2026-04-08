/**
 * Audio format conversion between KooKoo (JSON samples, 8kHz PCM16)
 * and ElevenLabs (base64 PCM16, 16kHz).
 */

function upsample8kTo16k(samples) {
  const out = new Int16Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    out[i * 2] = samples[i];
    out[i * 2 + 1] = i < samples.length - 1
      ? Math.round((samples[i] + samples[i + 1]) / 2)
      : samples[i];
  }
  return out;
}

function downsample16kTo8k(samples16k) {
  const out = [];
  for (let i = 0; i < samples16k.length; i += 2) {
    out.push(samples16k[i]);
  }
  return out;
}

function samplesToBase64(samples) {
  const up = upsample8kTo16k(samples);
  return Buffer.from(up.buffer, up.byteOffset, up.byteLength).toString('base64');
}

function base64ToChunks(base64Str, chunkSize = 80) {
  const buf = Buffer.from(base64Str, 'base64');
  const s16 = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const s8k = downsample16kTo8k(s16);

  const chunks = [];
  for (let i = 0; i < s8k.length; i += chunkSize) {
    const chunk = s8k.slice(i, i + chunkSize);
    while (chunk.length < chunkSize) chunk.push(0);
    chunks.push(chunk);
  }
  return chunks;
}

function buildMediaPacket(ucid, samples) {
  return JSON.stringify({
    type: 'media',
    ucid,
    data: {
      samples,
      bitsPerSample: 16,
      sampleRate: 8000,
      channelCount: 1,
      numberOfFrames: samples.length,
      type: 'data',
    },
  });
}

module.exports = { samplesToBase64, base64ToChunks, buildMediaPacket };
