/* Native little-endian RIFF/WAVE I/O for normalized, interleaved audio. */
const fs = require('node:fs');

const maxSamples = 32000000;
const maxBytes = 8 * maxSamples + 65536;
const pcmSubtypeTail = Buffer.from([0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113]);
const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function shape({ sampleRate, channels, samples } = {}) {
  if (!int(sampleRate, 1, 768000) || !int(channels, 1, 64) ||
      !(Array.isArray(samples) || ArrayBuffer.isView(samples)) ||
      !int(samples.length, 0, maxSamples) || samples.length % channels)
    throw new TypeError('Audio needs a sample rate, channel count and bounded interleaved samples');
  return { sampleRate, channels, samples };
}

function decode(source) {
  if (!(source instanceof Uint8Array)) throw new TypeError('WAV decoding needs bytes');
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.length < 12 || bytes.length > maxBytes || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE') throw new TypeError('Expected a bounded little-endian RIFF/WAVE file');
  const end = bytes.readUInt32LE(4) + 8;
  if (end < 12 || end > bytes.length) throw new RangeError('Truncated WAV container');
  const chunks = [];
  let format;
  for (let at = 12, count = 0; at < end;) {
    if (at + 8 > end || ++count > 65536) throw new RangeError('Invalid WAV chunk table');
    const tag = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    at = start + size + (size & 1);
    if (at > end) throw new RangeError('Truncated or unpadded WAV chunk ' + tag);
    if (tag === 'fmt ') {
      if (format || size < 16) throw new RangeError('Invalid WAV format chunk');
      let kind = bytes.readUInt16LE(start);
      const channels = bytes.readUInt16LE(start + 2), sampleRate = bytes.readUInt32LE(start + 4);
      const align = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14);
      if (kind === 65534) {
        if (size < 40 || bytes.readUInt16LE(start + 16) < 22 || bytes.readUInt16LE(start + 18) > bits ||
            !bytes.subarray(start + 28, start + 40).equals(pcmSubtypeTail))
          throw new RangeError('Unsupported WAVEFORMATEXTENSIBLE subtype');
        kind = bytes.readUInt32LE(start + 24);
      }
      if (!int(channels, 1, 64) || !int(sampleRate, 1, 768000) || align !== bits / 8 * channels ||
          bytes.readUInt32LE(start + 8) !== sampleRate * align ||
          !(kind === 1 && [8, 16, 24, 32].includes(bits) || kind === 3 && [32, 64].includes(bits)))
        throw new RangeError('Unsupported WAV format. Use PCM or IEEE floating point');
      format = { kind, bits, align, sampleRate, channels };
    }
    if (tag === 'data') chunks.push([start, size]);
  }
  if (!format || !chunks.length) throw new RangeError('WAV needs format and data chunks');
  const { kind, bits, align, sampleRate, channels } = format, stride = bits / 8;
  let count = 0;
  for (const [, length] of chunks) {
    if (length % align || (count += length / stride) > maxSamples) throw new RangeError('Invalid WAV frame alignment or audio budget');
  }
  const samples = new Float64Array(count), signedScale = 2 ** (bits - 1);
  let i = 0;
  for (const [start, length] of chunks) for (let at = start; at < start + length; at += stride) {
    const n = kind === 3 ? bits === 32 ? bytes.readFloatLE(at) : bytes.readDoubleLE(at) :
      bits === 8 ? (bytes[at] - 128) / 128 : bytes.readIntLE(at, stride) / signedScale;
    if (!Number.isFinite(n)) throw new RangeError('WAV contains a nonfinite PCM sample');
    samples[i++] = Math.max(-1, Math.min(1, n));
  }
  return { sampleRate, channels, samples };
}

const encodings = Object.freeze({ pcm8: [1, 8], pcm16: [1, 16], pcm24: [1, 24], pcm32: [1, 32],
  float32: [3, 32], float64: [3, 64] });

function encode(source, { encoding = 'pcm16' } = {}) {
  const { sampleRate, channels, samples } = shape(source);
  if (!Object.hasOwn(encodings, encoding)) throw new RangeError('Unsupported WAV encoding ' + encoding);
  const [kind, bits] = encodings[encoding], stride = bits / 8, align = stride * channels;
  const extensible = channels > 2, fmtSize = extensible ? 40 : kind === 3 ? 18 : 16;
  const dataLength = samples.length * stride, hasFact = kind === 3, header = 12 + 8 + fmtSize + (hasFact ? 12 : 0) + 8;
  const bytes = Buffer.alloc(header + dataLength + (dataLength & 1));
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(fmtSize, 16);
  bytes.writeUInt16LE(extensible ? 65534 : kind, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * align, 28);
  bytes.writeUInt16LE(align, 32);
  bytes.writeUInt16LE(bits, 34);
  if (extensible) {
    bytes.writeUInt16LE(22, 36);
    bytes.writeUInt16LE(bits, 38);
    bytes.writeUInt32LE(kind, 44);
    pcmSubtypeTail.copy(bytes, 48);
  }
  if (hasFact) {
    bytes.write('fact', header - 20);
    bytes.writeUInt32LE(4, header - 16);
    bytes.writeUInt32LE(samples.length / channels, header - 12);
  }
  bytes.write('data', header - 8);
  bytes.writeUInt32LE(dataLength, header - 4);
  const signedScale = 2 ** (bits - 1);
  for (let i = 0, at = header; i < samples.length; i++, at += stride) {
    const n = samples[i];
    if (!Number.isFinite(n) || Math.abs(n) > 1) throw new RangeError('WAV encode needs finite normalized samples');
    if (kind === 3) {
      if (bits === 32) bytes.writeFloatLE(n, at);
      else bytes.writeDoubleLE(n, at);
    } else {
      const value = Math.min(signedScale - 1, Math.round(n * signedScale));
      if (bits === 8) bytes[at] = 128 + value;
      else bytes.writeIntLE(value, at, stride);
    }
  }
  return bytes;
}

function read(file) {
  if (fs.statSync(file).size > maxBytes) throw new RangeError('WAV file exceeds the audio budget');
  return decode(fs.readFileSync(file));
}

module.exports = { decode, encode, read, maxSamples, maxBytes, encodings: Object.freeze(Object.keys(encodings)) };
