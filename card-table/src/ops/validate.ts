import type { CardTableDoc, ZoneRef } from "../types";

export function assertReady(doc: CardTableDoc) {
  if (doc.phase !== "ready") {
    throw new Error("Deck is not ready — finish the shuffle first");
  }
  if (!doc.publishedDeck?.length) {
    throw new Error("Published deck is missing");
  }
}

export function findHand(doc: CardTableDoc, id: string) {
  const hand = doc.hands.find((entry) => entry.id === id);
  if (!hand) throw new Error(`Hand not found: ${id}`);
  return hand;
}

export function findPile(doc: CardTableDoc, id: string) {
  const pile = doc.piles.find((entry) => entry.id === id);
  if (!pile) throw new Error(`Pile not found: ${id}`);
  return pile;
}

export function zoneCardCount(doc: CardTableDoc, zone: ZoneRef): number {
  if (zone.kind === "hand") return findHand(doc, zone.id).cards.length;
  return findPile(doc, zone.id).cards.length;
}
