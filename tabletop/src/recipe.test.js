// Every built-in game's recipe (GAME-FORMAT.md §6), laid out every way its
// options can be set: valid; every seat gets its kit; the components counted
// against the box (written down here, not worked out from the game); nothing
// laid on top of anything else, and no two hands overlapping; and a start's
// deals each into its own seat's hand, every card to a slot of its own.
import { describe, it, expect } from "vitest";
import santorini from "../games/santorini.json" with { type: "json" };
import lostCities from "../games/lost-cities.json" with { type: "json" };
import dominoes from "../games/draw-dominoes.json" with { type: "json" };
import liarsDice from "../games/liars-dice.json" with { type: "json" };
import { tableLayout } from "./setup.js";
import { seatAt, zones } from "./table/visibility.js";
import { testScene } from "./table/test-scene.js";
import { seeded } from "./test/games.js";
import { applyRecipe, combinations, optionsOf } from "../contract/v2/recipe.js";
import { validate } from "../contract/v2/validate.js";

const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.01, 0, -0.015], max: [0.01, 0.008, 0.015] } } });

/** What each game's box holds, laid out with these values: every thing, card and tile (bags' contents too); and each seat's own things. */
const GAMES = {
  santorini: { game: santorini, things: (v) => 1 + 22 + 18 + 14 + 18 + 2 * v.players, seats: (v) => v.players, hands: 0 },
  "lost-cities": { game: lostCities, things: () => 1 + 2 + 60, seats: () => 2, hands: 1 },
  "draw-dominoes": { game: dominoes, things: (v) => 1 + 28 + v.players, seats: (v) => v.players, hands: 1 },
  "liars-dice": { game: liarsDice, things: () => 1 + 1 + 6 + 30, seats: () => 6, hands: 0 },
};

const CASES = Object.entries(GAMES).flatMap(([id, c]) => combinations(c.game).map((values) => ({ id, ...c, values })));

describe("every built-in game, laid out every way its options can be set", () => {
  it("is every combination of the options: Draw Dominoes for 2, 3 and 4; Santorini for 2 and 3; the others one way", () => {
    expect(CASES.map((c) => `${c.id} ${JSON.stringify(c.values)}`)).toEqual([
      'santorini {"players":2}',
      'santorini {"players":3}',
      'lost-cities {}',
      'draw-dominoes {"players":2}',
      'draw-dominoes {"players":3}',
      'draw-dominoes {"players":4}',
      'liars-dice {}',
    ]);
  });

  for (const c of CASES) {
    describe(`${c.id} ${JSON.stringify(c.values)}`, () => {
      const g = applyRecipe(c.game, c.values);
      const layout = tableLayout(g, { fileOf, rng: seeded(11) });
      const objects = Object.entries(layout.objects).filter(([, o]) => o.kind !== "group");
      const snap = testScene(Object.fromEntries(objects));
      const hands = zones(snap);

      it("is pure: laid out again from a frozen copy of the game with the same seed, it is the same table", () => {
        const freeze = (v) => (v && typeof v === "object" ? Object.freeze(Object.values(v).forEach(freeze) ?? v) : v);
        expect(tableLayout(applyRecipe(freeze(structuredClone(c.game)), c.values), { fileOf, rng: seeded(11) })).toEqual(layout);
      });

      it("is a valid game with nothing left to choose", () => {
        expect(validate(g)).toEqual({ ok: true, stage: null, errors: [] });
        expect(optionsOf(g)).toEqual([]);
      });

      it("has every component in the box, once", () => {
        const inBags = Object.values(layout.bags).reduce((n, b) => n + b.items.length, 0);
        expect(objects.length + inBags).toBe(c.things(c.values));
      });

      it("seats as many as play, each with its own hands (a kit's: named for the seat)", () => {
        expect(Object.keys(layout.seats)).toHaveLength(c.seats(c.values));
        for (const [sid, seat] of Object.entries(layout.seats)) {
          const own = hands.filter((z) => z.seat === sid);
          expect(own).toHaveLength(c.hands);
          if (c.id === "draw-dominoes") expect(layout.objects[own[0].id].name).toBe(`${seat.name}'s rack`);
        }
        // and none for a seat that isn't there
        for (const z of hands) expect(layout.seats[z.seat]).toBeDefined();
      });

      it("lays nothing on top of anything else (but onto the table or board, as everything is), and no two hands overlap", () => {
        // what lies loose: not a card (a pile shares its spot), not the furniture things are laid on (locked, no hand)
        const loose = objects.filter(([, o]) => !o.traits?.["tabletop.card"] && !(o.locked && !o.traits?.["tabletop.zone"]));
        const at = loose.map(([id]) => snap.world(id).slice(12, 15));
        for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][2] - at[j][2]), `${loose[i][1].name} and ${loose[j][1].name}`).toBeGreaterThan(0.001);
        // each hand's box, in plan, in the world
        const plan = hands.map((z) => {
          const m = snap.world(z.id);
          const pts = [[z.min[0], z.min[2]], [z.max[0], z.min[2]], [z.min[0], z.max[2]], [z.max[0], z.max[2]]].map(([x, zz]) => [m[0] * x + m[8] * zz + m[12], m[2] * x + m[10] * zz + m[14]]);
          return { lo: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], hi: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
        });
        for (let i = 0; i < plan.length; i++)
          for (let j = i + 1; j < plan.length; j++) {
            const apart = plan[i].hi[0] <= plan[j].lo[0] || plan[j].hi[0] <= plan[i].lo[0] || plan[i].hi[1] <= plan[j].lo[1] || plan[j].hi[1] <= plan[i].lo[1];
            expect(apart, `${hands[i].seat}'s and ${hands[j].seat}'s hands`).toBe(true);
          }
      });

      it("starts by dealing each seat its own, each card into a slot of its own hand", () => {
        const deals = (g.recipe?.start ?? []).filter((s) => s.deal);
        if (!deals.length) return void expect(layout.start).toBe(null);
        const moves = layout.start.steps.flatMap((s) => s.moves ?? []);
        const each = deals.reduce((n, s) => n + s.count, 0);
        expect(moves).toHaveLength(each * Object.keys(layout.seats).length);
        const moved = structuredClone(Object.fromEntries(objects));
        for (const [id, t] of moves) moved[id].transform = { ...t, scale: 1 };
        const after = testScene(moved);
        const per = {};
        for (const [id] of moves) {
          const s = seatAt(after, zones(after), after.world(id).slice(12, 15));
          per[s] = (per[s] ?? 0) + 1;
        }
        expect(per).toEqual(Object.fromEntries(Object.keys(layout.seats).map((s) => [s, each])));
        expect(new Set(moves.map(([, t]) => t.position.join())).size).toBe(moves.length);
      });
    });
  }
});
