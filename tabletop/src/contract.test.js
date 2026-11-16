// The tabletop-game format (GAME-FORMAT.md): its validator against every
// fixture, each invalid one failing at the stage and with the code its
// manifest names; every game this package ships valid; and a valid game
// with one of everything laid out whole.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate, everyThing } from "../contract/v1/validate.js";
import schema from "../contract/v1/schema.json" with { type: "json" };
import manifest from "../contract/v1/fixtures/manifest.json" with { type: "json" };
import { kindsUsed, tableLayout, writeTable, LOOSE } from "./setup.js";
import { prepareTable } from "./table/made-with.js";
import { emptyScene } from "./empty-scene.js";
import { BAG, bagPlugin, keeperPlugin, keptIn, registries, seatsPlugin } from "./test/stand-ins.js";
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
      const r = validate(read(`../contract/v1/fixtures/${f.file}`));
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
    const files = ["valid", "invalid"].flatMap((d) => readdirSync(here(`../contract/v1/fixtures/${d}`)).map((n) => `${d}/${n}`));
    expect(files.sort()).toEqual(manifest.map((f) => f.file).sort());
  });

  it("the example is the minimal valid fixture", () => {
    expect(read("../contract/v1/examples/minimal.json")).toEqual(read("../contract/v1/fixtures/valid/minimal.json"));
  });
});

describe("the games this package ships", () => {
  const files = readdirSync(here("../games")).filter((n) => n.endsWith(".json"));
  it("are five JSON files", () => expect(files.sort()).toEqual(["draw-dominoes-2.json", "draw-dominoes-3.json", "draw-dominoes-4.json", "lost-cities.json", "santorini.json"]));
  for (const n of files) it(`${n} is a valid tabletop-game`, () => expect(validate(read(`../games/${n}`))).toEqual({ ok: true, stage: null, errors: [] }));
});

describe("a game with one of everything, laid out", () => {
  const g = read("../contract/v1/fixtures/valid/every-feature.json");
  const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.0005, 0.04] } } });

  it("asks for every kind its setup uses, and nothing else", () => {
    expect(kindsUsed(g).sort()).toEqual(Object.keys(g.pieces).sort());
  });

  it("keeps every card, wherever it is: dealt, stacked, spread, loose or in a bag; and puts a bag's things in it", async () => {
    const layout = tableLayout(g, { fileOf, rng: () => 0.5 });
    const repo = fakeRepo();
    const made = await prepareTable({ repo, registry: async (t) => registries(keeperPlugin("joint"), keeperPlugin("plain"), bagPlugin())[t] ?? null }, layout);
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
    const bagDoc = [...repo.docs.values()].find((d) => d["@patchwork"].type === "t-bag");
    expect(bagDoc.items.map((i) => i.object.name)).toEqual(["Token 1", "Token 2", "Token 3", "Card", "Card", "Card"]);
    expect(bagDoc.items.filter((i) => keptIn(i.object))).toHaveLength(3);
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
  // what a table is made with, as stand-ins found by their metadata: two keepers, a bag maker, whoever owns seats
  const installed = async (t) => registries(keeperPlugin("joint"), keeperPlugin("plain"), bagPlugin(), seatsPlugin())[t] ?? null;
  const fileOf = (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.001, 0.04] } } });
  for (const f of manifest.filter((x) => x.stage === "valid")) {
    it(`${f.file}: every card kept, every bag filled, every hand a seat's, the seats laid`, async () => {
      const g = read(`../contract/v1/fixtures/${f.file}`);
      const layout = tableLayout(g, { fileOf, rng: () => 0.5 });
      const repo = fakeRepo();
      const made = await prepareTable({ repo, registry: installed }, layout);
      const scene = emptyScene({ title: "T" });
      writeTable(scene, layout, made);
      expect(made.notes).toEqual([]);
      // every card in the game, wherever it is, is kept: in the scene by its keeper's trait, in a bag likewise
      const cards = (things) => things.reduce((n, t) => n + (t.deck ? t.deck.cards.length : g.pieces[t.piece]?.back ? Math.max(1, t.count ?? 1) : 0) + cards(t.contents ?? []), 0);
      const bagged = [...repo.docs.values()].filter((d) => d["@patchwork"].type === "t-bag").flatMap((d) => d.items.map((i) => i.object));
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
