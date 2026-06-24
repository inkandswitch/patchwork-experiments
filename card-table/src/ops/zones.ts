import type { CardTableDoc, CardZone, ZoneLayout, ZoneRef } from "../types";
import { deckCardCount, findDeck } from "./deck";
import { assertReady, findZone } from "./validate";

export function addZone(
  doc: CardTableDoc,
  props: {
    id: string;
    title: string;
    ownerId?: string;
    faceUp?: boolean;
    layout?: ZoneLayout;
  },
) {
  if (!doc.zones) doc.zones = [];
  if (doc.zones.some((zone) => zone.id === props.id)) {
    throw new Error(`Zone already exists: ${props.id}`);
  }
  const zone: CardZone = {
    "@patchwork": { type: "card-zone" },
    id: props.id,
    title: props.title,
    cards: [],
    ownerId: props.ownerId ?? "",
    revealedOffsets: [],
    faceUp: props.faceUp ?? false,
    layout: props.layout ?? (props.ownerId === undefined ? "row" : "fan"),
  };
  doc.zones.push(zone);
}

export function removeZone(doc: CardTableDoc, id: string) {
  const index = doc.zones.findIndex((zone) => zone.id === id);
  if (index === -1) throw new Error(`Zone not found: ${id}`);
  if (doc.zones[index].role === "deck") {
    throw new Error("Cannot remove the deck zone");
  }
  doc.zones.splice(index, 1);
}

export function removeZoneIfEmpty(doc: CardTableDoc, id: string): boolean {
  const index = doc.zones.findIndex((zone) => zone.id === id);
  if (index === -1) return false;
  const zone = doc.zones[index];
  if (zone.role === "deck" || zone.cards.length > 0 || zone.ownerId) return false;
  doc.zones.splice(index, 1);
  return true;
}

/** Claim an unowned (non-deck) zone as your private hand. */
export function claimZone(doc: CardTableDoc, id: string, ownerId: string) {
  const zone = findZone(doc, id);
  if (zone.role === "deck") throw new Error("The deck cannot be claimed");
  if (zone.ownerId && zone.ownerId !== ownerId) {
    throw new Error("This zone is already claimed");
  }
  zone.ownerId = ownerId;
}

export function setZoneFaceUp(doc: CardTableDoc, id: string, faceUp: boolean) {
  const zone = findZone(doc, id);
  if (zone.role === "deck") throw new Error("The deck is always face down");
  zone.faceUp = faceUp;
}

/** Deal `count` cards from the deck into a target zone. */
export function dealCards(doc: CardTableDoc, targetId: string, count: number) {
  assertReady(doc);
  if (count <= 0) throw new Error("Deal count must be positive");
  if (deckCardCount(doc) < count) {
    throw new Error(`Not enough cards in deck (${deckCardCount(doc)} left)`);
  }

  const deck = findDeck(doc);
  const target = findZone(doc, targetId);
  if (target.id === deck.id) throw new Error("Cannot deal onto the deck");

  for (let i = 0; i < count; i++) {
    const offset = deck.cards.shift();
    if (offset == null) break;
    target.cards.push(offset);
  }
}

/** Drop a card's revealed-offset marker when it leaves a zone. */
function dropRevealedOffset(zone: CardZone, offset: number) {
  if (!zone.revealedOffsets) return;
  const at = [...zone.revealedOffsets].indexOf(offset);
  if (at !== -1) zone.revealedOffsets.splice(at, 1);
}

/** Move a single card between any two zones by id. */
export function moveCardByRef(
  doc: CardTableDoc,
  from: ZoneRef,
  to: ZoneRef,
  fromIndex: number,
) {
  assertReady(doc);
  if (from.id === to.id) return;

  const source = findZone(doc, from.id);
  const target = findZone(doc, to.id);
  if (fromIndex < 0 || fromIndex >= source.cards.length) {
    throw new Error("Invalid source index");
  }

  const [offset] = source.cards.splice(fromIndex, 1);
  if (offset == null) throw new Error("Failed to move card");

  dropRevealedOffset(source, offset);
  target.cards.push(offset);
}
