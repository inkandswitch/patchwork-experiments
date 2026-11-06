// The plugin metadata: plain data that survives the worker's structuredClone,
// every trait described for "Add behaviour…", and modules that load.
import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";

const byId = (id) => plugins.find((p) => p.id === id);
const TRAITS = ["sailing.sea", "sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor", "sailing.hook", "sailing.ladder", "sailing.float"];

describe("sailing's plugins", () => {
  it("are two scene extensions, parts for the bin and two templates, and nothing else", () => {
    expect(plugins.map((p) => [p.type, p.id])).toEqual([
      ["scene:extension", "sailing"],
      ["scene:extension", "sailing.edit"],
      ...["sloop", "mast", "wheel", "windlass", "ladder", "redBuoy", "greenBuoy", "islet"].map((id) => ["scene:part", `sailing.${id}`]),
      ["scene:template", "ship-at-sea"],
      ["scene:template", "ship-at-anchor"],
    ]);
  });

  it("offers its parts under Sailing, each saying what it does, the rig's pieces with their connector tags", () => {
    const parts = plugins.filter((p) => p.type === "scene:part");
    for (const p of parts) {
      expect(p.category).toBe("Sailing");
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      for (const t of p.traits ?? []) expect(TRAITS).toContain(t);
    }
    expect(byId("sailing.mast").tags).toEqual(["sailing.mast"]);
    expect(byId("sailing.wheel").tags).toEqual(["sailing.helm"]);
    expect(byId("sailing.windlass").tags).toEqual(["sailing.windlass"]);
    expect(byId("sailing.ladder").tags).toEqual(["sailing.ladder"]);
    expect(byId("sailing.sloop").traits).toContain("sailing.ship");
  });

  it("are plain data apart from load()", () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(structuredClone(meta)).toEqual(meta);
      const fns = [];
      JSON.stringify(meta, (k, v) => (typeof v === "function" ? fns.push(k) : v));
      expect(fns).toEqual([]);
    }
  });

  it("plays only in play and edits only in edit, on the same traits", () => {
    expect(byId("sailing").traits).toEqual(TRAITS);
    expect(byId("sailing").activities).toEqual(["play"]);
    expect(byId("sailing.edit").traits).toEqual(TRAITS);
    expect(byId("sailing.edit").activities).toEqual(["edit"]);
  });

  it("brings what playing needs without the editor: keys, notices, framing and the use prompt", () => {
    expect(byId("sailing").requires).toEqual(["scene.use", "scene.keys", "scene.notices"]);
    expect(byId("sailing.edit").requires).toBeUndefined();
  });

  it("describes every trait it runs on, the sea on the scene and the rest on objects", () => {
    const d = byId("sailing").describes;
    expect(Object.keys(d).sort()).toEqual([...TRAITS].sort());
    expect(d["sailing.sea"].on).toBe("scene");
    for (const k of TRAITS.slice(1)) expect(d[k].on).toBe("object");
    const fields = (k) => Object.fromEntries(d[k].fields.map((f) => [f.key, f]));
    expect(fields("sailing.sea").wind.default).toEqual({ speed: 7, from: 45 });
    expect(fields("sailing.helm").angle).toMatchObject({ kind: "number", default: 0, min: -1, max: 1 });
    expect(fields("sailing.sail").raised.default).toBe(1);
    expect(fields("sailing.sail").sheet.default).toBe(0.5);
    expect(fields("sailing.anchor").down).toMatchObject({ kind: "boolean", default: true });
    // the ship's spec is optional: no default, so adding the trait writes nothing to override its box
    expect(fields("sailing.ship").spec.default).toBeUndefined();
    // her frame: one field, a transform (unset: as her model says)
    expect(fields("sailing.ship").frame.kind).toBe("json");
    expect(fields("sailing.ship").frame.default).toBeUndefined();
    expect(fields("sailing.ship").bow).toBeUndefined();
  });

  it("offers the template with an icon and a description", () => {
    expect(byId("ship-at-sea")).toMatchObject({ name: "Ship at sea", icon: "Sailboat" });
    expect(byId("ship-at-sea").description).toMatch(/under way/);
  });

  it("loads modules with create()", async () => {
    for (const p of plugins) expect(typeof (await p.load()).create).toBe("function");
  });
});
