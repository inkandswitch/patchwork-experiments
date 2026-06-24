import type { Player } from "mental-poker-toolkit";
import { cryptoLog } from "./debug-log";
import { publicKeyFromFields } from "./serialize";
import type { CardTableDoc, IndividualKeyShare } from "../types";

const log = cryptoLog("validate-keys");

export function expectedModulus(doc: CardTableDoc): bigint | null {
  if (!doc.publicKey) return null;
  return publicKeyFromFields(doc.publicKey).n;
}

export function playerMatchesTablePublicKey(
  doc: CardTableDoc,
  player: Player,
): boolean {
  if (!doc.publicKey) return true;
  const actual = player.publicKey;
  return (
    actual.p.toString() === doc.publicKey.p &&
    actual.q.toString() === doc.publicKey.q
  );
}

export function keyShareMatchesTable(
  doc: CardTableDoc,
  material: IndividualKeyShare,
): boolean {
  const n = expectedModulus(doc);
  if (!n) return true;
  return BigInt(material.n) === n;
}

export function keyShareMatchesShuffle(
  doc: CardTableDoc,
  material: IndividualKeyShare,
): boolean {
  const current = doc.shuffleId ?? 0;
  if (current === 0) return true;
  if (material.shuffleId === undefined) return false;
  return material.shuffleId === current;
}

export function keyShareIsValid(
  doc: CardTableDoc,
  material: IndividualKeyShare,
): boolean {
  return keyShareMatchesTable(doc, material) && keyShareMatchesShuffle(doc, material);
}

export function logPlayerMismatch(
  doc: CardTableDoc,
  player: Player,
  peerId: string,
): void {
  log.error("player public key does not match table", {
    peerId,
    tableP: doc.publicKey?.p,
    tableQ: doc.publicKey?.q,
    playerP: player.publicKey.p.toString(),
    playerQ: player.publicKey.q.toString(),
  });
}

export function logKeyShareMismatch(
  doc: CardTableDoc,
  material: IndividualKeyShare,
  participantId: string,
  offset: number,
  reason: "modulus" | "shuffleId" = "modulus",
): void {
  const n = expectedModulus(doc);
  log.warn(
    reason === "shuffleId"
      ? "foreign key share is from a prior shuffle"
      : "foreign key share has wrong modulus",
    {
      participantId,
      offset,
      expectedN: n?.toString(),
      actualN: material.n,
      expectedShuffleId: doc.shuffleId,
      actualShuffleId: material.shuffleId,
    },
  );
}
