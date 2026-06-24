import type { Player } from "mental-poker-toolkit";
import { publicKeyFromFields } from "./serialize";
import type { CardTableDoc, IndividualKeyShare } from "../types";

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
  return material.shuffleId === doc.shuffleId;
}

export function keyShareIsValid(
  doc: CardTableDoc,
  material: IndividualKeyShare,
): boolean {
  return keyShareMatchesTable(doc, material) && keyShareMatchesShuffle(doc, material);
}
