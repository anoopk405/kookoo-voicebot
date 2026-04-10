/**
 * Audio format conversion between KooKoo (JSON samples, 8kHz PCM16)
 * and AI providers:
 *   - ElevenLabs: base64 PCM16, 16kHz
 *   - OpenAI Realtime: base64 PCM16, 24kHz
 */

// ── Resampling ──────────────────────────────────────────────────────────────

function upsample(samples, fromRate, toRate) {
  const ratio = toRate / fromRate;
  const outLen = Math.round(samples.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = Math.round(samples[lo] * (1 - frac) + samples[hi] * frac);
  }
  return out;
}

function downsample(samples, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = [];
  for (let i = 0; i < outLen; i++) {
    out.push(samples[Math.round(i * ratio)]);
  }
  return out;
}

// ── ElevenLabs (16kHz) ──────────────────────────────────────────────────────

function samplesToBase64(samples, targetRate = 16000) {
  const up = upsample(samples, 8000, targetRate);
  return Buffer.from(up.buffer, up.byteOffset, up.byteLength).toString('base64');
}

function base64ToChunks(base64Str, sourceRate = 16000, chunkSize = 80) {
  const buf = Buffer.from(base64Str, 'base64');
  const srcSamples = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const s8k = downsample(srcSamples, sourceRate, 8000);

  const chunks = [];
  for (let i = 0; i < s8k.length; i += chunkSize) {
    const chunk = s8k.slice(i, i + chunkSize);
    while (chunk.length < chunkSize) chunk.push(0);
    chunks.push(chunk);
  }
  return chunks;
}

// ── OpenAI Realtime (24kHz) ─────────────────────────────────────────────────

function samplesToBase64_24k(samples) {
  return samplesToBase64(samples, 24000);
}

function base64ToChunks_24k(base64Str, chunkSize = 80) {
  return base64ToChunks(base64Str, 24000, chunkSize);
}

// ── KooKoo packet ───────────────────────────────────────────────────────────

function buildMediaPacket(ucid, samples, seqid) {
  const packet = {
    event: 'media',
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
  };
  if (seqid) packet.seqid = seqid;
  return JSON.stringify(packet);
}

module.exports = {
  samplesToBase64, base64ToChunks, buildMediaPacket,
  samplesToBase64_24k, base64ToChunks_24k,
  upsample, downsample,
};
