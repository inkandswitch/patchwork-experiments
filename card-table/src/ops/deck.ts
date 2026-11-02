import type { CardTableDoc, CardZone } from "../types";

export const DEFAULT_DECK_ID = "deck";

/** Ensures the default deck zone (role: "deck") exists. */
export function ensureDeck(doc: CardTableDoc) {
  if (!doc.zones) doc.zones = [];
  if (doc.zones.some((zone) => zone.role === "deck")) return;
  doc.zones.push({
    "@patchwork": { type: "card-zone" },
    id: DEFAULT_DECK_ID,
    title: "Deck",
    cards: [],
    layout: "stack",
    role: "deck",
  });
}

/** Pure lookup of the deck zone — safe in render/read-only contexts. */
export function deckZone(doc: CardTableDoc): CardZone | undefined {
  return (
    doc.zones?.find((zone) => zone.role === "deck") ??
    doc.zones?.find((zone) => zone.id === DEFAULT_DECK_ID)
  );
}

/**
 * The primary deck zone — the shuffle's output, drawn from the front.
 * Creates it if missing, so only call inside an Automerge `change`.
 */
export function findDeck(doc: CardTableDoc): CardZone {
  ensureDeck(doc);
  const deck = deckZone(doc);
  if (!deck) throw new Error("Deck zone not found");
  return deck;
}

export function deckCardCount(doc: CardTableDoc): number {
  return deckZone(doc)?.cards.length ?? 0;
}

export function fillDeck(doc: CardTableDoc) {
  findDeck(doc).cards = Array.from({ length: doc.deckSize }, (_, index) => index);
}

export function clearDeck(doc: CardTableDoc) {
  findDeck(doc).cards = [];
}
