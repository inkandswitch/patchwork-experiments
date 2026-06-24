import type { CardTableDoc, SecureDeckZone } from "../types";

export const DEFAULT_DECK_ID = "deck";

/** Ensures the default deck sub-zone exists. */
export function ensureDecks(doc: CardTableDoc) {
  if (!doc.decks) doc.decks = [];

  if (doc.decks.some((entry) => entry.id === DEFAULT_DECK_ID)) return;

  doc.decks.push({
    "@patchwork": { type: "secure-deck" },
    id: DEFAULT_DECK_ID,
    title: "Deck",
    cards: [],
  });
}

export function findDeck(
  doc: CardTableDoc,
  id: string = DEFAULT_DECK_ID,
): SecureDeckZone {
  ensureDecks(doc);
  const deck = doc.decks.find((entry) => entry.id === id);
  if (!deck) throw new Error(`Deck not found: ${id}`);
  return deck;
}

export function deckCardCount(doc: CardTableDoc): number {
  return findDeck(doc).cards.length;
}

export function fillDeck(doc: CardTableDoc) {
  findDeck(doc).cards = Array.from({ length: doc.deckSize }, (_, index) => index);
}

export function clearDeck(doc: CardTableDoc) {
  findDeck(doc).cards = [];
}
