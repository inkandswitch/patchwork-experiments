// What a table writer tells its maker (table/made-with.js prepareTable: the
// warnings come with what the table is made with), as a finite table run
// through both writers: the template (template.test.js, its notices) and the
// game page (tool.test.js, its status line). Every combination of the four
// inputs that could decide them:
//
//   the deck is secure            yes | no
//   the game has seats            yes | no
//   something owns seats          yes | no
//   the game has a bag of things  yes | no
//
// 16 cases. Expected, by the rule and nothing else: the table is laid out
// (a secure deck by the joint keeper, any other by the plain one; the bag's
// things in a bag doc), and the maker is warned that the table has no seats
// iff the game has seats and nothing owns them. (The game page never sets
// a table up without them: it loads the seats package first, table/session.js;
// it's the template, inside a scene, that warns.)

import { NO_SEATS } from "../table/made-with.js";

const slab = (color) => [{ shape: "slab", outline: "rect", size: [0.06, 0.09], thickness: 0.0005, color }];

/** A game of one deck of three cards, secure or not, with one seat or none, and a bag of two pawns or none. */
export function cardsGame({ secure, seats, bag = false }) {
  return {
    format: "tabletop-game",
    version: 2,
    title: "Three cards",
    about: "",
    pieces: {
      back: { name: "Back", parts: slab("#224488") },
      card: { name: "Card", back: "back", parts: slab("#eeeeee") },
      ...(bag
        ? {
            bag: { name: "Bag", parts: [{ shape: "box", size: [0.1, 0.1, 0.1], color: "#7a5a3a" }], bag: { rule: "random" } },
            pawn: { name: "Pawn", parts: [{ shape: "box", size: [0.02, 0.03, 0.02], color: "#0000ff" }] },
          }
        : {}),
    },
    setup: [
      { deck: { name: "Deck", cards: ["card", "card", "card"], faceDown: true, ...(secure ? { secure: true } : {}) } },
      ...(bag ? [{ piece: "bag", at: { position: [0.2, 0, 0] }, contents: [{ piece: "pawn", count: 2 }] }] : []),
    ],
    ...(seats ? { seats: { p1: { name: "Player 1" } } } : {}),
  };
}

/** The deck's container's title (setup.js: the game's title and the deck's name). */
export const DECK = "Three cards: Deck";
export const CASES = [];
const yn = (b) => (b ? "yes" : "no");
for (const secure of [true, false])
  for (const seats of [true, false])
    for (const owner of [true, false])
      for (const bag of [true, false])
        CASES.push({
          name: `secure ${yn(secure)}, seats ${yn(seats)}, owner ${yn(owner)}, bag ${yn(bag)}`,
          secure,
          seats,
          owner,
          bag,
          expected: seats && !owner ? [NO_SEATS] : [],
        });
