// What a table writer tells its maker (table/made-with.js prepareTable: the
// warnings come with what the table is made with), as a finite table run
// through both writers: the template (template.test.js, its notices) and the
// game page (tool.test.js, its status line). Every combination of the six
// inputs that decide them:
//
//   the deck is secure            yes | no
//   keepers installed             joint and plain | plain only | joint only
//   the game has seats            yes | no
//   something owns seats          yes | no
//   the game has a bag of things  yes | no
//   a bag maker is installed      yes | no
//
// 96 cases. Expected, by the rule and nothing else:
// - a deck that isn't secure, with only a joint keeper, has nothing to keep
//   it: nothing is laid out, and the maker is told why (an error);
// - otherwise the table is laid out, and the maker is warned, in this order:
//   the bag's things weren't laid out iff the game has a bag and nothing
//   fills bags; the deck is kept in the open iff it is secure and no joint
//   keeper is installed; the table has no seats iff the game has seats and
//   nothing owns them.
// (No keeper at all is the joint-only row's error again, for every deck:
// template.test.js checks it on its own.)

import { NO_SEATS, keptInTheOpen, notLaidOut } from "../table/made-with.js";

const slab = (color) => [{ shape: "slab", outline: "rect", size: [0.06, 0.09], thickness: 0.0005, color }];

/** A game of one deck of three cards, secure or not, with one seat or none, and a bag of two pawns or none. */
export function cardsGame({ secure, seats, bag = false }) {
  return {
    format: "tabletop-game",
    version: 1,
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
/** What a writer says when nothing keeps the deck (made-with.js containDecks). */
export const UNKEPT = `“${DECK}” has cards in it, and nothing installed here keeps them: add a keeper package`;

export const CASES = [];
const yn = (b) => (b ? "yes" : "no");
for (const secure of [true, false])
  for (const keepers of [["joint", "plain"], ["plain"], ["joint"]])
    for (const seats of [true, false])
      for (const owner of [true, false])
        for (const bag of [true, false])
          for (const bagMaker of [true, false]) {
            const unkept = !secure && !keepers.includes("plain");
            const expected = [];
            if (!unkept) {
              if (bag && !bagMaker) expected.push(notLaidOut(2));
              if (secure && !keepers.includes("joint")) expected.push(keptInTheOpen([DECK]));
              if (seats && !owner) expected.push(NO_SEATS);
            }
            CASES.push({
              name: `secure ${yn(secure)}, keepers ${keepers.join("+")}, seats ${yn(seats)}, owner ${yn(owner)}, bag ${yn(bag)}, bag maker ${yn(bagMaker)}`,
              secure,
              keepers,
              seats,
              owner,
              bag,
              bagMaker,
              error: unkept ? UNKEPT : null,
              expected,
            });
          }
