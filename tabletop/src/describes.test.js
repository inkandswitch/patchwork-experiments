import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { CARD, ZONE, isCard, zones } from "./table/visibility.js";
import { START } from "./table/start.js";
import { valuesOf } from "../contract/v2/recipe.js";

// The table's traits, as the scene's inspector offers them ("Add behaviour…").
const table = plugins.find((p) => p.id === "tabletop");
// the table's own plugins (dice, bags, keepers and the importer have their own tests)
const own = plugins.filter((p) => /^tabletop\b/.test(p.id) || p.type === "tabletop:game");
const d = table.describes;

/** What the inspector writes for a new trait or entry: its init, then its fields' defaults. */
const fresh = (desc) => {
  const out = structuredClone(desc.init ?? {});
  for (const f of desc.fields ?? []) if (!(f.key in out) && f.default !== undefined) out[f.key] = f.default;
  return out;
};

describe("tabletop: what runs", () => {
  it("one extension, by its traits alone: the verbs and the policy run wherever there's a hand or a card, whatever anyone is doing", () => {
    expect(plugins.filter((p) => p.type === "scene:extension").map((p) => p.id)).toEqual(["tabletop", "dice", "dice.cup", "dice.lots", "bag", "keep.plain", "card-table"]);
    expect(table.traits).toEqual([ZONE, CARD]);
    for (const k of ["activities", "requires", "always", "general"]) expect(k in table).toBe(false);
  });

  it("names nobody else's traits: seats and keepers are met through the stage", () => {
    const said = JSON.stringify(own.map(({ load, ...p }) => p));
    // (the seats' trait is `seats`: as a key or a value, it would be quoted)
    for (const other of ['"seats"', "keep.", "card-table", "secure-deck", "plain-deck"]) expect(said.includes(other)).toBe(false);
  });
});

describe("tabletop: describes its traits", () => {
  it("describes every trait it runs on, and the scene's start it reads (not one it runs for: its cards and hands run it), as plain data", () => {
    expect(Object.keys(d).sort()).toEqual([...table.traits, START].sort());
    expect(d[START]).toMatchObject({ on: "scene", runtime: ["started"] });
    expect(structuredClone(d)).toEqual(d);
    expect(d[ZONE].on).toBe("object");
    expect(d[CARD].on).toBe("object");
  });

  it("a new hand is a well-formed box once it names a seat, by the seat's id", () => {
    const seat = d[ZONE].fields.find((f) => f.key === "seat");
    expect(seat).toMatchObject({ kind: "string" });
    const z = fresh(d[ZONE]);
    const scene = (zone) => ({ objects: { tray: { traits: { [ZONE]: zone } } } });
    expect(zones(scene({ ...z, seat: 3 }))).toEqual([]);
    expect(zones(scene({ ...z, seat: "north" }))).toEqual([{ id: "tray", seat: "north", min: z.min, max: z.max }]);
  });

  it("a card is a bare marker: nothing in it says what it is, so a copy is a card and nothing more", () => {
    expect(d[CARD].fields).toBeUndefined();
    expect(fresh(d[CARD])).toEqual({});
    expect(isCard({ traits: { [CARD]: fresh(d[CARD]) } })).toBe(true);
    expect(isCard({ traits: {} })).toBe(false);
    expect(isCard({})).toBe(false);
  });
});

describe("tabletop: templates", () => {
  const templates = own.filter((p) => p.type === "scene:template");

  it("offers Lost Cities, Santorini and Draw Dominoes, as metadata the start screen can list without loading anything", () => {
    expect(templates.map((t) => t.id)).toEqual(["tabletop.lost-cities", "tabletop.santorini", "tabletop.dominoes"]);
    for (const t of templates) {
      const { load, ...meta } = t;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      expect(meta).toMatchObject({ name: expect.any(String), icon: expect.any(String), description: expect.any(String) });
    }
  });

  it("only Draw Dominoes takes params: how many play, 2, 3 or 4 (2 untouched), each a value of the registered game's option", async () => {
    expect(templates.map((t) => t.params ?? null)).toEqual([null, null, [{ key: "players", label: "Players", kind: "enum", options: [2, 3, 4].map((n) => ({ value: n, label: String(n) })), default: 2 }]]);
    const game = await plugins.find((p) => p.type === "tabletop:game" && p.id === "draw-dominoes").load();
    const players = game.recipe.options.find((o) => o.key === "players");
    expect(templates[2].params[0].options.map((o) => o.value)).toEqual(valuesOf(players));
    expect(templates[2].params[0].default).toBe(players.default);
  });

});

describe("tabletop: parts", () => {
  const parts = plugins.filter((p) => p.category === "Tabletop");

  it("offers a pawn, a token, a card spot, a card table, Lost Cities, Santorini and Draw Dominoes for 2, 3 and 4 under Tabletop, as metadata the bin reads without loading anything", () => {
    expect(parts.map((p) => p.id)).toEqual(["tabletop.pawn", "tabletop.token", "tabletop.card-spot", "tabletop.table", "tabletop.lost-cities", "tabletop.santorini", "tabletop.dominoes-2", "tabletop.dominoes-3", "tabletop.dominoes-4"]);
    for (const p of parts) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      expect(meta).toMatchObject({ category: "Tabletop", name: expect.any(String), icon: expect.any(String), description: expect.any(String) });
      // only a game fits a connector by tag (a card table's top); only cards fit card slots
      if (/^tabletop\.(lost-cities|santorini|dominoes-\d)$/.test(p.id)) expect(meta.tags).toEqual(["tabletop.game"]);
      else expect(meta.tags).toBeUndefined();
    }
  });

  it("says what each brings by a trait the table describes", () => {
    for (const p of parts) for (const t of p.traits ?? []) expect(d[t]).toBeDefined();
    expect(table.traits).toEqual(["tabletop.zone", "tabletop.card"]);
    expect(Object.keys(d)).toEqual([...table.traits, "tabletop.start"]);
  });
});
