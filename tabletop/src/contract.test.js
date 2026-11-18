// The tabletop-game format (GAME-FORMAT.md): its validator against every
// fixture, each invalid one failing at the stage and with the code its
// manifest names; every game this package ships valid; and a valid game
// with one of everything laid out whole.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate, everyThing } from "../contract/v2/validate.js";
import { applyRecipe, combinations, conditionProblem, describeOptions, holds, parseCondition } from "../contract/v2/recipe.js";
import schema from "../contract/v2/schema.json" with { type: "json" };
import manifest from "../contract/v2/fixtures/manifest.json" with { type: "json" };
import { kindsUsed, tableLayout, writeTable, LOOSE } from "./setup.js";
import { prepareTable } from "./table/made-with.js";
import { emptyScene } from "./empty-scene.js";
import { BAG, inBag, keptIn, registries, seatsPlugin } from "./test/stand-ins.js";
import { fakeRepo } from "./test/games.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), "utf8"));

describe("the validator", () => {
  it("knows every JSON Schema keyword the schema uses", () => {
    const known = new Set(["$schema", "$id", "title", "description", "type", "const", "enum", "required", "properties", "additionalProperties", "propertyNames", "items", "minItems", "maxItems", "minLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "anyOf", "$ref", "$defs"]);
    const used = new Set();
    const walk = (s, inProps = false) => {
      if (!s || typeof s !== "object") return;
      if (Array.isArray(s)) return s.forEach((x) => walk(x));
      for (const [k, v] of Object.entries(s)) {
        if (!inProps) used.add(k);
        walk(v, k === "properties" || k === "$defs");
      }
    };
    walk(schema);
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
  });

  for (const f of manifest) {
    it(`${f.file}: ${f.stage === "valid" ? "valid" : `fails ${f.stage}, ${f.code}`} (${f.about})`, () => {
      const r = validate(read(`../contract/v2/fixtures/${f.file}`));
      if (f.stage === "valid") expect(r).toEqual({ ok: true, stage: null, errors: [] });
      else {
        expect(r.stage).toBe(f.stage);
        expect(r.errors.map((e) => e.code)).toContain(f.code);
        // a semantic fixture breaks one rule only
        if (f.stage === "semantic") expect(new Set(r.errors.map((e) => e.code))).toEqual(new Set([f.code]));
      }
    });
  }

  it("every fixture on disk is in the manifest, once", () => {
    const files = ["valid", "invalid"].flatMap((d) => readdirSync(here(`../contract/v2/fixtures/${d}`)).map((n) => `${d}/${n}`));
    expect(files.sort()).toEqual(manifest.map((f) => f.file).sort());
  });

  it("the example is the minimal valid fixture", () => {
    expect(read("../contract/v2/examples/minimal.json")).toEqual(read("../contract/v2/fixtures/valid/minimal.json"));
  });
});

describe("the games this package ships", () => {
  const files = readdirSync(here("../games")).filter((n) => n.endsWith(".json"));
  it("are four JSON files", () => expect(files.sort()).toEqual(["draw-dominoes.json", "liars-dice.json", "lost-cities.json", "santorini.json"]));
  for (const n of files) it(`${n} is a valid tabletop-game`, () => expect(validate(read(`../games/${n}`))).toEqual({ ok: true, stage: null, errors: [] }));
});

describe("recipes (GAME-FORMAT.md §6)", () => {
  const g = read("../contract/v2/fixtures/valid/recipe.json");

  it("lays the game out for the values given, a default for each not given, leaving the game as it was", () => {
    const before = structuredClone(g);
    const two = applyRecipe(g);
    expect(g).toEqual(before);
    expect(Object.keys(two.seats)).toEqual(["a", "b"]);
    expect(two.setup.map((t) => t.id ?? t.name ?? t.piece)).toEqual(["board", "market", "deck", "extras", "tray.a", "A's pawn", "tray.b", "B's pawn"]);
    // nothing left to choose: its start steps that apply, unconditional
    expect(two.recipe).toEqual({ start: [{ shuffle: "deck" }, { deal: "deck", count: 2 }, { deal: "deck", count: 1 }, { draw: "deck", count: 3, to: "market" }, { first: true }] });
    expect(applyRecipe(g, { players: 2, extras: false })).toEqual(two);
    expect(applyRecipe(g, { players: "2" })).toEqual(two); // as a form gives it
    expect(applyRecipe(g, { players: 4 })).toBe(null);
    expect(applyRecipe(g, { extras: "maybe" })).toBe(null);
  });

  it("for three: the third seat and its pawn kept, B's seat moved to its spot with everything that's its, a kit at each seat", () => {
    const three = applyRecipe(g, { players: 3, extras: true });
    expect(Object.keys(three.seats)).toEqual(["a", "b", "c"]);
    expect(three.seats.b.at).toEqual(g.recipe.spots.west);
    expect(three.setup.find((t) => t.id === "third")).toBeTruthy();
    // out of its bag onto the table, at its spot; the bag holds nothing now
    expect(three.setup.find((t) => t.id === "spare").at).toEqual(g.recipe.spots.spare);
    expect(three.setup.find((t) => t.id === "extras").contents).toEqual([]);
    // each kit in its seat's frame: the tray on the seat's area, the pawn 6 cm toward the table
    expect(three.setup.find((t) => t.id === "tray.c")).toEqual({ id: "tray.c", piece: "tray", name: "C's tray", seat: "c", at: g.seats.c.at });
    expect(three.setup.find((t) => t.name === "C's pawn").at.position).toEqual([0.14, 0.01, 0]);
    expect(three.recipe.start.map((x) => Object.keys(x)[0])).toEqual(["shuffle", "deal", "draw", "first"]);
  });

  it("a seat that moves takes its hands and its camera with it, rigidly", () => {
    const d = read("../games/draw-dominoes.json");
    // Player 2 sits west for three and four; north for two, as the two-player table always had them
    const two = applyRecipe(d, { players: 2 });
    expect(two.seats.p2).toEqual({ name: "Player 2", at: { position: [0, 0, -0.42], rotation: [0, Math.PI, 0] }, camera: { position: [0, 0.5, -0.86], target: [0, 0, -0.18] } });
    const moved = structuredClone(d);
    moved.setup.push({ piece: "rack", seat: "p2", at: { position: [-0.33, 0, 0.1], rotation: [0, -Math.PI / 2, 0] } });
    moved.recipe.layout = moved.recipe.layout.filter((s) => !s.kit);
    expect(applyRecipe(moved, { players: 2 }).setup.at(-1).at).toEqual({ position: [-0.1, 0, -0.42], rotation: [0, Math.PI, 0] });
  });

  it("conditions: one comparison on an option, with a value of its", () => {
    const options = g.recipe.options;
    expect(parseCondition("players >= 3")).toEqual({ key: "players", op: ">=", literal: "3" });
    expect(parseCondition("layout == 'c9b6a8'")).toEqual({ key: "layout", op: "==", literal: "c9b6a8" });
    expect(parseCondition("extras")).toEqual({ key: "extras", op: null, literal: null });
    for (const bad of ["", "players >", "players >= 3 and extras", "3 <= players"]) expect(conditionProblem(bad, options)).toMatch(/isn't a condition/);
    expect(conditionProblem("players", options)).toMatch(/isn't a boolean option/);
    expect(conditionProblem("extras < true", options)).toMatch(/only an integer option is ordered/);
    expect(conditionProblem("extras == maybe", options)).toMatch(/is no value/);
    expect(conditionProblem("players >= 9", options)).toBe(null); // past its range, an order still says something
    const cases = { "players == 2": [true, false], "players != 2": [false, true], "players < 3": [true, false], "players <= 2": [true, false], "players > 2": [false, true], "players >= 3": [false, true], extras: [false, false], "extras == false": [true, true] };
    for (const [c, want] of Object.entries(cases)) expect([2, 3].map((players) => holds(c, { players, extras: false }, options)), c).toEqual(want);
  });

  it("checks every way the options can be set, and says which one an error is in", () => {
    expect(combinations(g)).toEqual([
      { players: 2, extras: false },
      { players: 2, extras: true },
      { players: 3, extras: false },
      { players: 3, extras: true },
    ]);
    const errors = validate(read("../contract/v2/fixtures/invalid/laid-unknown-thing.json")).errors;
    expect(errors.map((e) => e.code)).toEqual(["unknown-thing"]);
    expect(errors[0].message).toMatch(/laid out with players = 2, extras = false/);
  });

  it("Draw Dominoes is one game: a seat, a rack and a deal for each who plays", () => {
    const d = read("../games/draw-dominoes.json");
    expect(d.recipe.options).toEqual([{ key: "players", label: "Players", kind: "integer", min: 2, max: 4, default: 2 }]);
    for (const n of [2, 3, 4]) {
      const v = applyRecipe(d, { players: n });
      expect(Object.keys(v.seats)).toHaveLength(n);
      expect(v.setup.filter((t) => t.seat)).toHaveLength(n);
      expect(v.recipe.start).toEqual([{ deal: "boneyard", count: n === 4 ? 6 : 7 }]);
      expect(validate(v).ok).toBe(true);
      expect(describeOptions(d, { players: n })).toBe(`${n} players`);
    }
  });
});

describe("a game with one of everything, laid out", () => {
  const g = read("../contract/v2/fixtures/valid/every-feature.json");
  const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.0005, 0.04] } } });

  it("asks for every kind its setup uses, and nothing else", () => {
    expect(kindsUsed(g).sort()).toEqual(Object.keys(g.pieces).sort());
  });

  it("keeps every card, wherever it is: dealt, stacked, spread, loose or in a bag; and puts a bag's things in it", async () => {
    const layout = tableLayout(g, { fileOf, rng: () => 0.5 });
    const repo = fakeRepo();
    const made = await prepareTable({ repo, registry: async () => null }, layout);
    const scene = emptyScene({ title: "T" });
    writeTable(scene, layout, made);
    // the draw pile's 6, the jumble's 4 (one of another back), the loose card, and in the bag one more loose card and the bagged deck's 2
    expect(Object.fromEntries(Object.entries(layout.containers).map(([k, c]) => [k, [c.title, c.secure, c.items.length]]))).toEqual({
      deck0: ["Every feature: Draw pile", true, 6],
      deck1: ["Every feature: Jumble", false, 4],
      [LOOSE]: ["Every feature: Cards", false, 2],
      deck2: ["Every feature: Bagged", false, 2],
    });
    expect(made.kinds).toEqual({ deck0: "joint", deck1: "plain", [LOOSE]: "plain", deck2: "plain" });
    const onTable = Object.values(scene.objects).filter((o) => keptIn(o));
    expect(onTable).toHaveLength(6 + 4 + 1);
    // each card shows its own back
    expect(new Set(onTable.map((o) => o.sourceUrl))).toEqual(new Set(["automerge:back", "automerge:back2"]));
    const bagDoc = inBag([...repo.docs.values()].find((d) => d["@patchwork"].type === "bag"));
    expect(bagDoc.map((o) => o.name)).toEqual(["Token 1", "Token 2", "Token 3", "Card", "Card", "Card"]);
    expect(bagDoc.filter((o) => keptIn(o))).toHaveLength(3);
    const bag = Object.values(scene.objects).find((o) => o.name === "Bag");
    expect(bag.traits[BAG].doc).toMatch(/^automerge:/);
    // the hands are their seats', the die is a die by its trait, the figure carries
    const hands = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.zone"]);
    expect(hands.map((o) => [o.name, o.traits["tabletop.zone"].seat])).toEqual([["A's tray", "a"], ["B's tray", "b"]]);
    expect(Object.values(scene.objects).filter((o) => o.traits?.["dice.die"])).toHaveLength(2);
    expect(scene.origin).toEqual(g.origin);
    expect(scene.view.start.body).toBe("seat");
  });

  it("everyThing walks contents too, saying which are in a bag", () => {
    const all = everyThing(g.setup);
    expect(all).toHaveLength(g.setup.length + 3);
    expect(all.filter((a) => a.inBag).map((a) => a.path)).toEqual(["$.setup[10].contents[0]", "$.setup[10].contents[1]", "$.setup[10].contents[2]"]);
  });
});

describe("every valid game lays out with no code of its own", () => {
  // whoever owns seats, a stand-in found by its metadata
  const installed = async (t) => registries(seatsPlugin())[t] ?? null;
  const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.001, 0.04] } } });
  for (const f of manifest.filter((x) => x.stage === "valid")) {
    it(`${f.file}: every card kept, every bag filled, every hand a seat's, the seats laid`, async () => {
      const g = read(`../contract/v2/fixtures/${f.file}`);
      const layout = tableLayout(g, { fileOf, rng: () => 0.5 });
      const repo = fakeRepo();
      const made = await prepareTable({ repo, registry: installed }, layout);
      const scene = emptyScene({ title: "T" });
      writeTable(scene, layout, made);
      expect(made.notes).toEqual([]);
      // every card in the game, wherever it is, is kept: in the scene by its keeper's trait, in a bag likewise
      const cards = (things) => things.reduce((n, t) => n + (t.deck ? t.deck.cards.length : g.pieces[t.piece]?.back ? Math.max(1, t.count ?? 1) : 0) + cards(t.contents ?? []), 0);
      const bagged = [...repo.docs.values()].filter((d) => d["@patchwork"].type === "bag").flatMap(inBag);
      const kept = [...Object.values(scene.objects), ...bagged].filter((o) => o.traits?.["tabletop.card"]);
      expect(kept).toHaveLength(cards(g.setup));
      for (const o of kept) expect(keptIn(o)).not.toBe(null);
      // every bag is a bag of its own document
      const bags = Object.values(scene.objects).filter((o) => o.traits?.[BAG]);
      expect(bags.length).toBe(Object.keys(layout.bags).filter((id) => scene.objects[id]).length);
      // a hand for every seat that has one, and the seats laid
      for (const t of everyThing(g.setup).map((a) => a.thing).filter((t) => t.seat)) expect(Object.values(scene.objects).some((o) => o.traits?.["tabletop.zone"]?.seat === t.seat)).toBe(true);
      expect(Object.keys(scene.traits["t.seats"] ?? {})).toEqual(Object.keys(g.seats ?? {}));
    });
  }
});

describe("Draw Dominoes on the Card table (TABLE: 0.76 m across x, 1.2 m along z)", () => {
  // Every rack's footprint (its zone, turned by its yaw) lies on the table's top and no two overlap,
  // for 2, 3 and 4 players: side racks at ±0.33 m, not ±0.42 (which hung 7.5 cm off a 0.76 m top).
  it("every rack on the top, none overlapping, for every player count", async () => {
    const { TABLE } = await import("./table/parts.js");
    const { GAMES } = await import("./test/games.js");
    for (const n of [2, 3, 4]) {
      const g = GAMES[`draw-dominoes-${n}`];
      const zone = g.pieces.rack.zone;
      const boxes = g.setup
        .filter((s) => s.piece === "rack")
        .map((s) => {
          const [x, , z] = s.at.position;
          const yaw = s.at.rotation?.[1] ?? 0;
          const across = Math.abs(Math.sin(yaw)) > 0.5; // turned a quarter: its length along z
          const [hx, hz] = across ? [(zone.max[2] - zone.min[2]) / 2, (zone.max[0] - zone.min[0]) / 2] : [(zone.max[0] - zone.min[0]) / 2, (zone.max[2] - zone.min[2]) / 2];
          return { id: s.id, min: [x - hx, z - hz], max: [x + hx, z + hz] };
        });
      expect(boxes, `${n} players`).toHaveLength(n);
      for (const b of boxes) {
        expect(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), `${n}: ${b.id} across`).toBeLessThanOrEqual(TABLE.w / 2);
        expect(Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])), `${n}: ${b.id} along`).toBeLessThanOrEqual(TABLE.l / 2);
      }
      for (const a of boxes) for (const b of boxes) if (a !== b) expect(a.max[0] <= b.min[0] || b.max[0] <= a.min[0] || a.max[1] <= b.min[1] || b.max[1] <= a.min[1], `${n}: ${a.id} and ${b.id}`).toBe(true);
    }
  });
});
