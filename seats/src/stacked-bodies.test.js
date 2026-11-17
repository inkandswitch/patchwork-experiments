// Another doc's seat body stacked over this doc's (scene's COMPOSITION.md,
// Decisions, N7, 14; README, Still open). Every stage's seat body has the id
// "seat"; the stage gives a body's `ext` as this extension's id only when the
// body is its own. In a mashup the stack can reach [look, seat(G), walk,
// seat(dice)] (walk off from G's seat, then F at the dice doc's seat), or a
// second package's `roster.sit` can push its seat over G's. The fake world
// stands the other doc's seat body in as a collected body (ext "other").
//
// What this file pins:
// - G's picker hides while the body on top isn't G's (`pickerOwner` checks
//   `ext`), so Watching in G's picker can't be pressed then;
// - the known gap, as an expected failure: the README's roster contract says
//   `sitting()` is "the seat body on top", so under another doc's seat body
//   G's `sitting()` should be null, but `seated()` compares the top body's id
//   alone and G still reports its seat. When `seated()` checks `ext` too
//   (as `pickerOwner` does), the `it.fails` below starts failing: flip it to
//   `it` then, and decide what G's `getUp` (via `downToSeat`) does with the
//   other doc's body above its own, which it would pop to get down.
import { describe, it, expect, vi, afterEach } from "vitest";
import Seats from "./seats.js";
import { SEATS } from "./model.js";
import * as fakes from "./test/fake-world.js";
import { emptyScene } from "./test/empty-scene.js";

afterEach(() => vi.useRealTimers());
const T = (position) => ({ position, rotation: [0, 0, 0], scale: 1 });
const doc = () =>
  emptyScene({
    objects: { board: { name: "Board", transform: T([0, 0, 0]) } },
    order: ["board"],
    traits: {
      [SEATS]: {
        p1: { name: "Player 1", player: null, camera: { position: [0, 1.2, 1], target: [0, 0, 0.5] } },
        p2: { name: "Player 2", player: null, camera: { position: [0, 1.2, -1], target: [0, 0, -0.5] } },
      },
    },
  });

/** Seated at G's p1, then another doc's seat body pushed over G's. */
async function stacked() {
  vi.useFakeTimers();
  const w = fakes.fakeWorld(doc());
  const api = w.join("C", { viewer: "carol", ext: "seats" });
  const foreign = { id: "seat", label: "Seat", enter: () => ({ label: "Dice seat", leave() {} }) };
  w.view("C").collected = { bodies: [foreign] };
  const x = w.attach("C", Seats.create(api));
  const step = async () => {
    for (let i = 0; i < 3; i++) {
      w.flush();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  await step();
  expect(x.roster.sit({ of: null, seat: "p1" })).toBe(true);
  await step();
  const v = w.view("C");
  const bar = v.overlay.querySelector(".seats-bar");
  expect(x.roster.sitting()).toEqual({ of: null, seat: "p1" });
  expect(bar.hidden).toBe(false);
  // (the other doc's body: the one def with id "seat" left once G's own is out of the way)
  const inst = v.instance;
  v.instance = { ...inst, bodies: [] };
  expect(api.body.enter("seat")).toBe(true);
  v.instance = inst;
  await step();
  expect(v.bodies.map((b) => [b.id, b.ext ?? null])).toEqual([["look", null], ["seat", "seats"], ["seat", "other"]]);
  return { x, bar };
}

describe("another doc's seat body stacked over this doc's", () => {
  it("hides this doc's picker (its Watching can't be pressed)", async () => {
    const { bar } = await stacked();
    expect(bar.hidden).toBe(true);
  });

  // Known gap (README, Still open): seated() reads the top body's id alone.
  it.fails("sitting() is null: the body on top is the other doc's seat, not this doc's", async () => {
    const { x } = await stacked();
    expect(x.roster.sitting()).toBe(null);
  });
});
