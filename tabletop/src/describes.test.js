import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { CARD, ZONE, isCard, zones } from "./table/visibility.js";

// The table's traits, as the scene's inspector offers them ("Add behaviour…").
const table = plugins.find((p) => p.id === "tabletop");
const rule = plugins.find((p) => p.id === "tabletop.rule");
const d = table.describes;

/** What the inspector writes for a new trait or entry: its init, then its fields' defaults. */
const fresh = (desc) => {
  const out = structuredClone(desc.init ?? {});
  for (const f of desc.fields ?? []) if (!(f.key in out) && f.default !== undefined) out[f.key] = f.default;
  return out;
};

describe("tabletop: activities", () => {
  it("the table's verbs run in play and in edit", () => {
    expect(table.activities).toEqual(["play", "edit"]);
    expect(plugins.some((p) => p.type === "scene:kit")).toBe(false);
  });

  it("its policy declares no activities, so who may see what holds whatever a viewer is doing", () => {
    expect(rule.type).toBe("scene:extension");
    expect(rule.activities).toBeUndefined();
    // on exactly what the table runs on: wherever there's a hand or a card, there's the rule
    expect(rule.traits).toEqual(table.traits);
    expect(rule.requires).toBeUndefined();
  });

  it("requires the use prompt before the key map, so the prompt hears its verbs' keys first", () => {
    const r = table.requires;
    expect(r).toContain("scene.use");
    expect(r).toContain("scene.keys");
    expect(r.indexOf("scene.use")).toBeLessThan(r.indexOf("scene.keys"));
  });

  it("registers no plugin type of its own for decks, and no deck datatype: what a card is, is a keeper's", () => {
    expect([...new Set(plugins.map((p) => p.type))].sort()).toEqual(["patchwork:datatype", "patchwork:tool", "scene:extension", "scene:part", "scene:template", "tabletop:game"]);
    expect(plugins.filter((p) => p.type === "patchwork:datatype").map((p) => p.id)).toEqual(["tabletop-game"]);
    expect(table.drops).toBeUndefined();
  });

  it("names nobody else's traits: seats and keepers are met through the stage", () => {
    const said = JSON.stringify(plugins.map(({ load, ...p }) => p));
    for (const other of ["scene.seats", "keep.", "card-table", "secure-deck", "plain-deck"]) expect(said.includes(other)).toBe(false);
  });
});

describe("tabletop: describes its traits", () => {
  it("describes every trait it runs on, as plain data", () => {
    expect(Object.keys(d).sort()).toEqual([...table.traits].sort());
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
  const templates = plugins.filter((p) => p.type === "scene:template");

  it("offers Lost Cities and Santorini, as metadata the start screen can list without loading anything", () => {
    expect(templates.map((t) => t.id)).toEqual(["tabletop.lost-cities", "tabletop.santorini"]);
    for (const t of templates) {
      const { load, ...meta } = t;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      expect(meta).toMatchObject({ name: expect.any(String), icon: expect.any(String), description: expect.any(String) });
    }
  });

  it("each loads a module with create(ctx)", async () => {
    for (const t of templates) expect(typeof (await t.load()).create).toBe("function");
  });
});

describe("tabletop: parts", () => {
  const parts = plugins.filter((p) => p.type === "scene:part");

  it("offers a pawn, a token, a card spot, a card table and Lost Cities under Tabletop, as metadata the bin reads without loading anything", () => {
    expect(parts.map((p) => p.id)).toEqual(["tabletop.pawn", "tabletop.token", "tabletop.card-spot", "tabletop.table", "tabletop.lost-cities"]);
    for (const p of parts) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      expect(meta).toMatchObject({ category: "Tabletop", name: expect.any(String), icon: expect.any(String), description: expect.any(String) });
      // only a game fits a connector by tag (a card table's top); only cards fit card slots
      if (p.id === "tabletop.lost-cities") expect(meta.tags).toEqual(["tabletop.game"]);
      else expect(meta.tags).toBeUndefined();
    }
  });

  it("says what each brings by a trait the table describes", () => {
    for (const p of parts) for (const t of p.traits ?? []) expect(d[t]).toBeDefined();
    // dice are the dice package's: no die trait, no die part here
    expect(table.traits).toEqual(["tabletop.zone", "tabletop.card"]);
    expect(Object.keys(d)).toEqual(table.traits);
    expect(parts.some((p) => /die|dice/.test(p.id))).toBe(false);
  });

  it("each loads a module with create(ctx, at)", async () => {
    for (const p of parts) expect(typeof (await p.load()).create).toBe("function");
  });
});
