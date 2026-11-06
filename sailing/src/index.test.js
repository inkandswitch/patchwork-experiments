// The plugin metadata: plain data that survives the worker's structuredClone,
// every trait described for "Add behaviour…", and modules that load.
import { describe, it, expect } from "vitest";
import { plugins } from "./index.js";

const byId = (id) => plugins.find((p) => p.id === id);
const TRAITS = ["sailing.sea", "sailing.ship", "sailing.helm", "sailing.sail", "sailing.anchor"];

describe("sailing's plugins", () => {
  it("are two scene extensions and a template, and nothing else", () => {
    expect(plugins.map((p) => [p.type, p.id])).toEqual([
      ["scene:extension", "sailing"],
      ["scene:extension", "sailing.edit"],
      ["scene:template", "ship-at-sea"],
    ]);
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
    expect(byId("sailing").requires).toEqual(["scene.keys", "scene.notices", "scene.autoframe", "scene.use"]);
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
  });

  it("offers the template with an icon and a description", () => {
    expect(byId("ship-at-sea")).toMatchObject({ name: "Ship at sea", icon: "Sailboat" });
    expect(byId("ship-at-sea").description).toMatch(/anchor/);
  });

  it("loads modules with create()", async () => {
    for (const p of plugins) expect(typeof (await p.load()).create).toBe("function");
  });
});
