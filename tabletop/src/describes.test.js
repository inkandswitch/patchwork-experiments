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
