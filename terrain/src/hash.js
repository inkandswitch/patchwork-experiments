// Hashes: SHA-256 for what the doc records about its data (so a build can
// check it read what was fetched), and a fast synchronous one for
// fingerprints, which the scene asks for synchronously.

/** SHA-256 of bytes, lower-case hex. */
export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256's round constants and first hash: the first 32 bits of the
// fractional parts of the cube roots of the first 64 primes, and of the square
// roots of the first 8 (FIPS 180-4, 4.2.2 and 5.3.3). Each root is below 312,
// so a double holds more than 40 bits of its fraction and the 32 kept are exact.
const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p)) PRIMES.push(n);
const fraction32 = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(PRIMES, (p) => fraction32(Math.cbrt(p)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => fraction32(Math.sqrt(p)));
const ror = (x, n) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of bytes, lower-case hex, computed here and at once: the same
 * digest as sha256Hex, for what must be read synchronously (whether a doc's
 * data fits what it asks for, read while a view draws).
 */
export function sha256HexNow(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 2 ** 29));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = Uint32Array.from(H0);
  const w = new Uint32Array(64);
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** A 53-bit hash of bytes (cyrb53), as hex: quick, synchronous, for fingerprints only. */
export function quickHash(bytes, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
