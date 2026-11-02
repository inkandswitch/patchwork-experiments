import type { ExchangePublicKey, IndividualKeyShare } from "../types";

const ALGORITHM: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export type ExchangeKeyPair = {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  privateKey: CryptoKey;
};

export async function generateExchangeKeyPair(): Promise<ExchangeKeyPair> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["encrypt", "decrypt"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicJwk, privateJwk, privateKey: pair.privateKey };
}

export function exchangePublicKeyFromJwk(jwk: JsonWebKey): ExchangePublicKey {
  return { jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e } };
}

export async function importExchangePublicKey(
  fields: ExchangePublicKey,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    fields.jwk,
    ALGORITHM,
    true,
    ["encrypt"],
  );
}

export async function importExchangePrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ALGORITHM, true, ["decrypt"]);
}

export async function encryptKeyShare(
  recipientPublicKey: CryptoKey,
  material: IndividualKeyShare,
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(material));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    recipientPublicKey,
    encoded,
  );
  return bytesToBase64(new Uint8Array(ciphertext));
}

export async function decryptKeyShare(
  privateKey: CryptoKey,
  ciphertext: string,
): Promise<IndividualKeyShare> {
  const decoded = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBytes(ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decoded)) as IndividualKeyShare;
  if (!parsed?.d || !parsed?.n) {
    throw new Error("Invalid decrypted key share");
  }
  return parsed;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): BufferSource {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
