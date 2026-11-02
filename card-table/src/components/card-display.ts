import type { DecryptedCard } from "../types";

export function displayRank(rank: string): string {
  return rank === "T" ? "10" : rank;
}

export function isRedSuit(suit: string): boolean {
  return suit === "Heart" || suit === "Diamond";
}

export function suitGlyph(suit: string): string {
  switch (suit) {
    case "Heart":
      return "♥";
    case "Diamond":
      return "♦";
    case "Club":
      return "♣";
    case "Spade":
      return "♠";
    default:
      return suit[0] ?? "?";
  }
}

export function centerGlyph(card: DecryptedCard): string {
  if (card.rank === "A") return suitGlyph(card.suit);
  if (["J", "Q", "K"].includes(card.rank)) {
    return { J: "J", Q: "Q", K: "K" }[card.rank] ?? card.rank;
  }
  return suitGlyph(card.suit);
}
