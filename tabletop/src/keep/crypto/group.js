// Commutative encryption for a shuffled deck (Pohlig–Hellman / SRA mental
// poker), over one fixed, published group. Pure BigInt, no dependencies.
//
// - The group is the quadratic residues of RFC 3526's 2048-bit MODP prime P, a
//   safe prime (P = 2Q + 1, Q prime), so every element but 1 has order Q.
// - A card is encoded as a square, (i + 2)² mod P, so it is a quadratic
//   residue, and so is anything it encrypts to: nothing about a card's
//   residuosity or order survives encryption (the leak in the old card table,
//   where cards were small integers mod public primes; Lipton 1981).
// - A key is an exponent e with its inverse d = e⁻¹ mod Q. Encrypting is
//   m^e mod P; keys commute, so players can encrypt in turn and decrypt in
//   any order.
// - Randomness is crypto.getRandomValues, never Math.random. Players' keys
//   are derived from their secret (derive.js), not drawn here.

/** RFC 3526 §3, the 2048-bit MODP group (group 14). */
export const P = BigInt(
  "0x" +
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74" +
    "020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437" +
    "4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05" +
    "98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB" +
    "9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718" +
    "3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF",
);
export const Q = (P - 1n) / 2n;
/** RFC 3526's generator: 2 is a quadratic residue mod P, so it generates the order-Q subgroup. */
export const G = 2n;
export const GROUP_ID = "rfc3526-2048";

export function modpow(base, exp, mod = P) {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** a⁻¹ mod m (m prime or a coprime to m). */
export function modinv(a, m) {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return ((s0 % m) + m) % m;
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** A uniformly random BigInt in [0, bound). */
export function randomBelow(bound) {
  const bits = bound.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    let v = 0n;
    for (const b of randomBytes(bytes)) v = (v << 8n) | BigInt(b);
    v &= mask;
    if (v < bound) return v;
  }
}

/** A uniformly random integer in [0, n), for shuffling. */
export function randomInt(n) {
  return Number(randomBelow(BigInt(n)));
}

/** Fisher–Yates with crypto randomness: a new array. */
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh key: { e, d } with e·d ≡ 1 (mod Q), e uniformly random in [2, Q). */
export function newKey() {
  const e = 2n + randomBelow(Q - 2n);
  return { e, d: modinv(e, Q) };
}

export const encrypt = (m, key) => modpow(m, key.e);
export const decrypt = (c, key) => modpow(c, key.d);
export const decryptWith = (c, d) => modpow(c, d);

/** Card i of a deck, as a group element. */
export const encodeCard = (i) => modpow(BigInt(i) + 2n, 2n);

/** Group element → card index, for a deck of n cards (null if it's none of them). */
export function cardDecoder(n) {
  const table = new Map();
  for (let i = 0; i < n; i++) table.set(encodeCard(i).toString(16), i);
  return (m) => table.get(m.toString(16)) ?? null;
}

/** Is x a quadratic residue mod P (Euler's criterion)? */
export const isResidue = (x) => modpow(x, Q) === 1n;

export const toHex = (v) => v.toString(16);
export const fromHex = (s) => BigInt(`0x${s}`);
