import {
  DecryptionKey,
  EncryptionKey,
  PublicKey,
  ShamirRivestAdleman,
} from "mental-poker-toolkit";

export type SerializedSra = {
  p: string;
  q: string;
  e: string;
  d: string;
};

export function bigintStrings(values: bigint[]): string[] {
  return values.map((value) => value.toString());
}

export function parseBigintStrings(values: string[]): bigint[] {
  return values.map((value) => BigInt(value));
}

export function publicKeyFromFields(fields: {
  p: string;
  q: string;
}): PublicKey {
  return new PublicKey(BigInt(fields.p), BigInt(fields.q));
}

export function publicKeyToFields(key: PublicKey): { p: string; q: string } {
  return { p: key.p.toString(), q: key.q.toString() };
}

export function serializeSra(sra: ShamirRivestAdleman): SerializedSra {
  return {
    p: sra.publicKey.p.toString(),
    q: sra.publicKey.q.toString(),
    e: sra.encryptionKey.e.toString(),
    d: sra.decryptionKey.d.toString(),
  };
}

export function deserializeSra(data: SerializedSra): ShamirRivestAdleman {
  const publicKey = new PublicKey(BigInt(data.p), BigInt(data.q));
  const encryptionKey = new EncryptionKey(BigInt(data.e), publicKey.n);
  const decryptionKey = new DecryptionKey(BigInt(data.d), publicKey.n);
  return new ShamirRivestAdleman({ publicKey, encryptionKey, decryptionKey });
}

export function decryptionMaterial(sra: ShamirRivestAdleman): {
  d: string;
  n: string;
} {
  return {
    d: sra.decryptionKey.d.toString(),
    n: sra.decryptionKey.n.toString(),
  };
}

export function decryptWithMaterial(
  cipher: bigint,
  material: { d: string; n: string },
): bigint {
  const key = new DecryptionKey(BigInt(material.d), BigInt(material.n));
  return key.decrypt(cipher);
}
