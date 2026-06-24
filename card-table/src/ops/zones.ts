import type {
  CardTableDoc,
  SecureHandZone,
  SecurePileZone,
  ZoneRef,
} from "../types";
import { deckCardCount, findDeck } from "./deck";
import { assertReady } from "./validate";

/** The mutable card array backing a zone (deck, hand, or pile). */
function zoneCards(doc: CardTableDoc, ref: ZoneRef): number[] {
  if (ref.kind === "deck") return findDeck(doc, ref.id).cards;
  if (ref.kind === "hand") {
    const hand = doc.hands.find((entry) => entry.id === ref.id);
    if (!hand) throw new Error(`Hand not found: ${ref.id}`);
    return hand.cards;
  }
  const pile = doc.piles.find((entry) => entry.id === ref.id);
  if (!pile) throw new Error(`Pile not found: ${ref.id}`);
  return pile.cards;
}

export function addHand(
  doc: CardTableDoc,
  props: {
    id: string;
    title: string;
    ownerId?: string;
  },
) {
  if (doc.hands.some((hand) => hand.id === props.id)) {
    throw new Error(`Hand already exists: ${props.id}`);
  }
  const hand: SecureHandZone = {
    "@patchwork": { type: "secure-hand" },
    id: props.id,
    title: props.title,
    ownerId: props.ownerId ?? "",
    cards: [],
    revealedOffsets: [],
  };
  doc.hands.push(hand);
}

export function claimHand(
  doc: CardTableDoc,
  handId: string,
  ownerId: string,
) {
  const hand = doc.hands.find((entry) => entry.id === handId);
  if (!hand) throw new Error(`Hand not found: ${handId}`);
  if (hand.ownerId && hand.ownerId !== ownerId) {
    throw new Error("This hand is already claimed");
  }
  hand.ownerId = ownerId;
}

export function removeHandIfEmpty(doc: CardTableDoc, handId: string) {
  const index = doc.hands.findIndex((hand) => hand.id === handId);
  if (index === -1) return false;
  const hand = doc.hands[index];
  if (hand.cards.length > 0 || hand.ownerId) return false;
  doc.hands.splice(index, 1);
  return true;
}

export function addPile(
  doc: CardTableDoc,
  props: {
    id: string;
    title: string;
    faceUp?: boolean;
  },
) {
  if (doc.piles.some((pile) => pile.id === props.id)) {
    throw new Error(`Pile already exists: ${props.id}`);
  }
  const pile: SecurePileZone = {
    "@patchwork": { type: "secure-pile" },
    id: props.id,
    title: props.title,
    faceUp: props.faceUp ?? false,
    cards: [],
  };
  doc.piles.push(pile);
}

export function removeHand(doc: CardTableDoc, id: string) {
  const index = doc.hands.findIndex((hand) => hand.id === id);
  if (index === -1) throw new Error(`Hand not found: ${id}`);
  doc.hands.splice(index, 1);
}

export function removePile(doc: CardTableDoc, id: string) {
  const index = doc.piles.findIndex((pile) => pile.id === id);
  if (index === -1) throw new Error(`Pile not found: ${id}`);
  doc.piles.splice(index, 1);
}

export function setPileFaceUp(doc: CardTableDoc, id: string, faceUp: boolean) {
  const pile = doc.piles.find((entry) => entry.id === id);
  if (!pile) throw new Error(`Pile not found: ${id}`);
  pile.faceUp = faceUp;
}

export function dealCards(
  doc: CardTableDoc,
  target: { handId?: string; pileId?: string },
  count: number,
) {
  assertReady(doc);
  if (count <= 0) throw new Error("Deal count must be positive");
  if (!target.handId && !target.pileId) {
    throw new Error("Specify handId or pileId");
  }
  if (deckCardCount(doc) < count) {
    throw new Error(`Not enough cards in deck (${deckCardCount(doc)} left)`);
  }

  const deck = findDeck(doc);
  const cards: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = deck.cards.shift();
    if (offset == null) break;
    cards.push(offset);
  }

  if (target.handId) {
    const hand = doc.hands.find((entry) => entry.id === target.handId);
    if (!hand) throw new Error(`Hand not found: ${target.handId}`);
    for (const offset of cards) hand.cards.push(offset);
    return;
  }

  const pile = doc.piles.find((entry) => entry.id === target.pileId);
  if (!pile) throw new Error(`Pile not found: ${target.pileId}`);
  for (const offset of cards) pile.cards.push(offset);
}

/** Drop a card's revealed-offset marker when it leaves a hand. */
function dropRevealedOffset(hand: SecureHandZone, offset: number) {
  if (!hand.revealedOffsets) return;
  const at = [...hand.revealedOffsets].indexOf(offset);
  if (at !== -1) hand.revealedOffsets.splice(at, 1);
}

/** Move a single card between any two zones (deck, hand, pile). */
export function moveCardByRef(
  doc: CardTableDoc,
  from: ZoneRef,
  to: ZoneRef,
  fromIndex: number,
) {
  assertReady(doc);
  if (from.kind === to.kind && from.id === to.id) return;

  const source = zoneCards(doc, from);
  if (fromIndex < 0 || fromIndex >= source.length) {
    throw new Error("Invalid source index");
  }

  const [offset] = source.splice(fromIndex, 1);
  if (offset == null) throw new Error("Failed to move card");

  if (from.kind === "hand") {
    const hand = doc.hands.find((entry) => entry.id === from.id);
    if (hand) dropRevealedOffset(hand, offset);
  }

  zoneCards(doc, to).push(offset);
}
