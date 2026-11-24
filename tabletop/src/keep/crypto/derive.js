// A player's keys, derived from one secret: nothing is stored per deck, so
// every device that has the player's secret holds the same keys (see
// player-secret.js for where the secret lives).
//
//   card(deck, offset, epoch)  the key on one card of a deck, until it's next shuffled
//   unify(deck, op), mix(deck, op)   one-shuffle keys (see deck.js)
//   exchange(deck)             a Diffie–Hellman key in the same group, for sealing
//                              shares to one player: x secret, X = G^x published
//
// HKDF-SHA-256 (WebCrypto) from the secret, with the purpose as `info`.

import { G, P, Q, modinv, modpow, randomBelow } from "./group.js";

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

async function hkdf(secret, info, bits = 512) {
  const key = await subtle().importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, key, bits));
}

const toBig = (bytes) => bytes.reduce((v, b) => (v << 8n) | BigInt(b), 0n);

/** An exponent in [2, Q) from 512 derived bits (the bias mod a 2047-bit Q is negligible). */
async function exponent(secret, info) {
  return 2n + (toBig(await hkdf(secret, info)) % (Q - 2n));
}

/** A fresh random secret: 32 bytes. */
export function newSecret() {
  const s = new Uint8Array(32);
  globalThis.crypto.getRandomValues(s);
  return s;
}

/**
 * A player's keys for decks, from their secret. Cached: the same key is asked
 * for many times.
 * @param {Uint8Array} secret
 */
export function playerKeys(secret) {
  const cache = new Map();
  const key = async (info) => {
    if (!cache.has(info)) {
      cache.set(
        info,
        exponent(secret, info).then((e) => ({ e, d: modinv(e, Q) })),
      );
    }
    return cache.get(info);
  };
  return {
    card: (deck, offset, epoch) => key(`secure-deck/card/${deck}/${offset}/${epoch}`),
    unify: (deck, op) => key(`secure-deck/unify/${deck}/${op}`),
    mix: (deck, op) => key(`secure-deck/mix/${deck}/${op}`),
    async exchange(deck) {
      const { e: x } = await key(`secure-deck/exchange/${deck}`);
      return { x, X: modpow(G, x, P) };
    },
  };
}

// ─── sealing a share for one player ─────────────────────────────────────────
// Diffie–Hellman in the deck's group with a fresh key per envelope, then
// AES-GCM under a key derived from the shared element.

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const elementBytes = (v) => enc.encode(v.toString(16));

async function aes(shared, usage) {
  const raw = await hkdf(elementBytes(shared), "secure-deck/seal", 256);
  return subtle().importKey("raw", raw, "AES-GCM", false, [usage]);
}

/** Seal text for whoever holds x where X = G^x. → { Y, iv, ct } */
export async function seal(X, text) {
  const y = 2n + randomBelow(Q - 2n);
  const key = await aes(modpow(X, y, P), "encrypt");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return { Y: modpow(G, y, P).toString(16), iv: b64(iv), ct: b64(ct) };
}

/** Open an envelope with our x. Throws if it isn't for us (or was tampered with). */
export async function open(x, envelope) {
  const key = await aes(modpow(BigInt(`0x${envelope.Y}`), x, P), "decrypt");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ct));
  return new TextDecoder().decode(pt);
}
