// Sealing a key share for one player: ECDH (P-256) with a fresh key per
// envelope, then AES-GCM. WebCrypto only, so it runs in browsers and in node.
//
// The old card table used RSA-OAEP, which can't carry a 2048-bit exponent in
// one block; a hybrid scheme carries anything.

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" };

const b64 = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A player's exchange keypair, as JWKs (the public one is published, the private one stays local). */
export async function newExchangeKeys() {
  const pair = await subtle().generateKey(ECDH, true, ["deriveKey"]);
  return {
    publicJwk: await subtle().exportKey("jwk", pair.publicKey),
    privateJwk: await subtle().exportKey("jwk", pair.privateKey),
  };
}

/** Only the curve point of a public JWK: what goes in the doc. */
export function publicPart(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function aesKey(privateKey, publicKey, usage) {
  return subtle().deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, [usage]);
}

/** Seal a string for whoever holds the private half of `recipientJwk`. → { epk, iv, ct } */
export async function seal(recipientJwk, text) {
  const recipient = await subtle().importKey("jwk", publicPart(recipientJwk), ECDH, false, []);
  const eph = await subtle().generateKey(ECDH, true, ["deriveKey"]);
  const key = await aesKey(eph.privateKey, recipient, "encrypt");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { epk: publicPart(await subtle().exportKey("jwk", eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

/** Open an envelope with our private JWK. Throws if it isn't for us (or was tampered with). */
export async function open(privateJwk, envelope) {
  const mine = await subtle().importKey("jwk", privateJwk, ECDH, false, ["deriveKey"]);
  const eph = await subtle().importKey("jwk", envelope.epk, ECDH, false, []);
  const key = await aesKey(mine, eph, "decrypt");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ct));
  return new TextDecoder().decode(pt);
}
