import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";
import { HIDDEN, SEATS, ZONE, hiddenBy, zones } from "./table/visibility.js";

// The table's traits, as the scene's inspector offers them ("Add behaviour…").
const table = plugins.find((p) => p.id === "tabletop");
const d = table.describes;

/** What the inspector writes for a new trait or entry: its init, then its fields' defaults. */
const fresh = (desc) => {
  const out = structuredClone(desc.init ?? {});
  for (const f of desc.fields ?? []) if (!(f.key in out) && f.default !== undefined) out[f.key] = f.default;
  return out;
};

describe("tabletop: activities", () => {
  it("runs in play and in edit, so hidden cards stay hidden while someone edits", () => {
    expect(table.activities).toEqual(["play", "edit"]);
    expect(plugins.some((p) => p.type === "scene:kit")).toBe(false);
  });

  it("requires the use prompt before the key map, so the prompt hears its verbs' keys first", () => {
    const r = table.requires;
    expect(r).toContain("scene.use");
    expect(r).toContain("scene.keys");
    expect(r.indexOf("scene.use")).toBeLessThan(r.indexOf("scene.keys"));
  });
});

describe("tabletop: describes its traits", () => {
  it("describes every trait it runs on, as plain data", () => {
    expect(Object.keys(d).sort()).toEqual([...table.traits].sort());
    expect(structuredClone(d)).toEqual(d);
    expect(d[SEATS].on).toBe("scene");
    expect(d[ZONE].on).toBe("object");
    expect(d[HIDDEN].on).toBe("object");
  });

  it("a seat added from the inspector has the shape setup.js writes: { name, player }", () => {
    expect(fresh(d[SEATS].entries)).toEqual({ player: null, name: "Seat" });
  });

  it("a new zone is a well-formed box once it has a seat, picked from the scene's seats", () => {
    const seat = d[ZONE].fields.find((f) => f.key === "seat");
    expect(seat).toMatchObject({ kind: "entry", of: SEATS });
    const z = fresh(d[ZONE]);
    const scene = (zone) => ({ objects: { tray: { traits: { [ZONE]: zone } } } });
    expect(zones(scene(z))).toEqual([]);
    expect(zones(scene({ ...z, seat: "north" }))).toEqual([{ id: "tray", seat: "north", min: z.min, max: z.max }]);
  });

  it("a hidden card names its deck by URL", () => {
    expect(d[HIDDEN].fields).toEqual([{ key: "by", label: "Deck", kind: "url" }]);
    expect(hiddenBy({ traits: { [HIDDEN]: { by: "automerge:2j9vHjM4kfgV7xYGVhQjNzr2Ucqh" } } })).toBe("automerge:2j9vHjM4kfgV7xYGVhQjNzr2Ucqh");
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

describe("tabletop: a die", () => {
  it("is a trait the table runs on, described with a d6's faces by default", async () => {
    const { DEFAULT_FACES, DIE } = await import("./table/dice.js");
    expect(table.traits).toContain(DIE);
    expect(d[DIE].on).toBe("object");
    expect(fresh(d[DIE])).toEqual({ faces: { ...DEFAULT_FACES } });
  });
});

describe("tabletop: parts", () => {
  const parts = plugins.filter((p) => p.type === "scene:part");

  it("offers a pawn, a token, a card spot and a die under Tabletop, as metadata the bin reads without loading anything", () => {
    expect(parts.map((p) => p.id)).toEqual(["tabletop.pawn", "tabletop.token", "tabletop.card-spot", "tabletop.die"]);
    for (const p of parts) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      expect(meta).toMatchObject({ category: "Tabletop", name: expect.any(String), icon: expect.any(String), description: expect.any(String) });
      // none fits a connector by tag: only cards fit card slots
      expect(meta.tags).toBeUndefined();
    }
  });

  it("says what each brings by a trait the table describes", () => {
    for (const p of parts) for (const t of p.traits ?? []) expect(d[t]).toBeDefined();
    expect(parts.find((p) => p.id === "tabletop.die").traits).toEqual(["tabletop.die"]);
  });

  it("each loads a module with create(ctx, at)", async () => {
    for (const p of parts) expect(typeof (await p.load()).create).toBe("function");
  });
});
