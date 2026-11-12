// Envelopes: one viewer's nonce, readable by one other viewer alone, through
// a document everyone can read. ECDH on P-256 between the sealer's key and
// the recipient's (each published with its commit, so neither can be
// swapped later), the shared secret hashed with what the envelope is for
// into an AES-GCM key. WebCrypto only: nothing here is home-made but the
// framing.
//
// A round's keys are made per attempt and kept by their owner's client
// (lots-ext.js); a private key never goes in a doc.

import { sha256Bytes } from "./sha256.js";

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" };

export const toB64 = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A new key pair: the public key as base64 (raw point), the private key as a JWK to keep. */
export async function makeKeys() {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const pub = toB64(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  return { pub, jwk };
}

const privateKey = (jwk) => subtle().importKey("jwk", jwk, ECDH, false, ["deriveBits"]);
const publicKey = (b64) => subtle().importKey("raw", fromB64(b64), ECDH, false, []);

/** The AES key two parties share for one envelope: H(ECDH secret ‖ what it's for). */
async function boxKey(jwk, theirPub, label) {
  const shared = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: await publicKey(theirPub) }, await privateKey(jwk), 256));
  const tag = new TextEncoder().encode(label);
  const both = new Uint8Array(shared.length + tag.length);
  both.set(shared);
  both.set(tag, shared.length);
  return subtle().importKey("raw", sha256Bytes(both), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const labelOf = (id, recipient) => `dice.lots/seal/1|${id}|${recipient}`;

/**
 * Seal `text` (a nonce) to `recipient` for round `id`.
 * @returns {Promise<{ iv: string, ct: string }>}
 */
export async function seal({ id, recipient, text, jwk, theirPub }) {
  const key = await boxKey(jwk, theirPub, labelOf(id, recipient));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Open an envelope sealed to me (`recipient`), or null when it won't open. */
export async function unseal({ id, recipient, envelope, jwk, theirPub }) {
  try {
    const key = await boxKey(jwk, theirPub, labelOf(id, recipient));
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(envelope.iv) }, key, fromB64(envelope.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
