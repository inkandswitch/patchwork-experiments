import type { CardTableDoc, CardZone, ZoneRef } from "../types";

export function assertReady(doc: CardTableDoc) {
  if (doc.phase !== "ready") {
    throw new Error("Deck is not ready — finish the shuffle first");
  }
  if (!doc.publishedDeck?.length) {
    throw new Error("Published deck is missing");
  }
}

export function findZone(doc: CardTableDoc, id: string): CardZone {
  const zone = doc.zones.find((entry) => entry.id === id);
  if (!zone) throw new Error(`Zone not found: ${id}`);
  return zone;
}

export function zoneCardCount(doc: CardTableDoc, ref: ZoneRef): number {
  return findZone(doc, ref.id).cards.length;
}
