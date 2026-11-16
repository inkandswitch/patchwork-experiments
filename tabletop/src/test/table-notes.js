// The warnings a table writer owes its maker (table/made-with.js
// tableNotes), as a finite table run through both writers: the template
// (template.test.js, its notices) and the game page (tool.test.js, its
// status line). Every combination of the four inputs that decide them:
//
//   the deck is secure            yes | no
//   keepers installed             joint and plain | plain only
//   the game has seats            yes | no
//   something owns seats          yes | no
//
// 16 cases. Expected, by the rule and nothing else: the deck is kept in the
// open iff it is secure and only a plain keeper is installed; the table has
// no seats iff the game has seats and nothing owns them. (A keeper of some
// kind is always installed: with none, nothing is laid out at all, which
// template.test.js checks on its own.)

import { KEPT_IN_THE_OPEN, NO_SEATS } from "../table/made-with.js";

const slab = (color) => [{ shape: "slab", outline: "rect", size: [0.06, 0.09], thickness: 0.0005, color }];

/** A game of one deck of three cards, secure or not, with one seat or none. */
export function cardsGame({ secure, seats }) {
  return {
    format: "tabletop-game",
    version: 1,
    title: "Three cards",
    about: "",
    pieces: {
      back: { name: "Back", parts: slab("#224488") },
      card: { name: "Card", back: "back", parts: slab("#eeeeee") },
    },
    setup: [{ deck: { name: "Deck", cards: ["card", "card", "card"], faceDown: true, ...(secure ? { secure: true } : {}) } }],
    ...(seats ? { seats: { p1: { name: "Player 1" } } } : {}),
  };
}

export const CASES = [];
for (const secure of [true, false])
  for (const keepers of [["joint", "plain"], ["plain"]])
    for (const seats of [true, false])
      for (const owner of [true, false]) {
        const expected = [];
        if (secure && !keepers.includes("joint")) expected.push(KEPT_IN_THE_OPEN);
        if (seats && !owner) expected.push(NO_SEATS);
        CASES.push({ name: `secure ${secure ? "yes" : "no"}, keepers ${keepers.join("+")}, seats ${seats ? "yes" : "no"}, owner ${owner ? "yes" : "no"}`, secure, keepers, seats, owner, expected });
      }
