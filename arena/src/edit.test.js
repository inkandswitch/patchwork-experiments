// Making and editing a level against a stand-in for the scene: the template
// (what an empty scene's start screen runs) and the edit extension's commands.
import { describe, it, expect, beforeEach } from "vitest";
import { plugins } from "./index.js";
import { sampleArena } from "./level.js";
import { kindKey } from "./layout.js";
import edit from "./edit.js";
import template from "./template.js";

/** A template's context (the stage's drop context) or an extension's api: just what layout.js uses, and a notify. */
function fakeScene(doc) {
  const calls = { created: [], notices: [], local: {} };
  let n = 0;
  const ctx = {
    repo: {
      async create2(d) {
        calls.created.push(d);
        return { url: `automerge:glb${calls.created.length}` };
      },
    },
    doc: () => doc,
    change: (fn) => fn(doc),
    newId: (prefix) => `${prefix}${++n}`,
    notify: (text, kind) => calls.notices.push({ text, kind }),
    // the extension's extras
    camera: { get: () => ({ position: [0, 5, 10], target: [2, 0, 3] }) },
    raycast: () => ({ point: [2, 1.2, 3], id: "deck" }),
    local: { swap: (fn) => (calls.local = fn(calls.local)) },
  };
  return { ctx, calls };
}

const emptyScene = () => ({ objects: {}, order: [], traits: {}, view: {}, dimensions: {} });

describe("the Arena level template", () => {
  it("is a scene:template plugin, plain metadata with a Crosshair", () => {
    const t = plugins.find((p) => p.type === "scene:template");
    expect(t).toMatchObject({ id: "arena-level", name: "Arena level", icon: "Crosshair" });
    const { load, ...meta } = t;
    expect(structuredClone(meta)).toEqual(meta);
    expect(typeof load).toBe("function");
  });

  it("lays out the sample arena in a group, with the arena's look, and starts the scene in play", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    const blocks = sampleArena();
    const kinds = [...new Set(blocks.map((b) => b.kind))];
    // one GLB doc per kind, remembered in the level trait
    expect(calls.created).toHaveLength(kinds.length);
    expect(Object.keys(doc.traits["arena.level"].kinds).sort()).toEqual(kinds.map(kindKey).sort());
    expect(doc.traits["arena.level"].look).toBe("arena");
    expect(doc.view.activity).toBe("play");
    const objects = Object.values(doc.objects);
    const group = objects.find((o) => o.kind === "group");
    expect(group.name).toBe("Arena");
    expect(objects.filter((o) => o.group === Object.keys(doc.objects).find((id) => doc.objects[id] === group))).toHaveLength(blocks.length);
    expect(objects.filter((o) => o.traits?.["arena.target"])).toHaveLength(blocks.filter((b) => b.traits?.["arena.target"]).length);
    expect(objects.filter((o) => o.traits?.["arena.spawn"])).toHaveLength(4);
    expect(doc.order).toHaveLength(blocks.length + 1);
    expect(calls.notices.at(-1).kind).toBe("info");
  });

  it("reuses the level's GLBs when it already has them", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    const made = calls.created.length;
    await template.create(ctx);
    expect(calls.created).toHaveLength(made);
  });
});

describe("editing a level (arena.edit)", () => {
  let doc, f, x;
  beforeEach(() => {
    doc = emptyScene();
    doc.traits["arena.level"] = { kinds: { [kindKey("crate")]: "automerge:crate" } };
    f = fakeScene(doc);
    x = edit.create(f.ctx);
  });

  it("offers adding a target, crate or spawn point, and standing targets up", () => {
    expect(x.commands.map((c) => c.id)).toEqual(["add-target", "add-crate", "add-spawn", "reset"]);
  });

  it("puts a target where you're looking, on what's there, facing you, and selects it", async () => {
    await x.commands.find((c) => c.id === "add-target").run(null);
    const [id, o] = Object.entries(doc.objects)[0];
    expect(o.traits).toEqual({ "arena.target": {} });
    expect(o.transform.position).toEqual([2, 1.2, 3]);
    expect(o.transform.rotation[1]).toBeCloseTo(Math.atan2(-2, 7));
    expect(f.calls.local.selected).toBe(id);
    expect(doc.traits["arena.level"].kinds[kindKey("target")]).toBe("automerge:glb1");
  });

  it("a crate reuses the level's crate GLB", async () => {
    await x.commands.find((c) => c.id === "add-crate").run(null);
    expect(f.calls.created).toHaveLength(0);
    expect(Object.values(doc.objects)[0].sourceUrl).toBe("automerge:crate");
  });

  it("stands knocked-over targets up, and only offers to when one is down", () => {
    const reset = x.commands.find((c) => c.id === "reset");
    doc.objects.t = { traits: { "arena.target": {} }, transform: { position: [0, 0, 0], rotation: [0, 1, 0], scale: 1 } };
    expect(reset.state(null, { scene: { objects: doc.objects } })).toBeNull();
    doc.objects.t.traits["arena.target"] = { down: { by: "p", at: 1 }, stand: { position: [0, 0, 0], rotation: [0, 1, 0], scale: 1 } };
    doc.objects.t.transform.rotation = [1.5, 1, 0];
    expect(reset.state(null, { scene: { objects: doc.objects } })).toBeTruthy();
    reset.run(null);
    expect(doc.objects.t.transform.rotation).toEqual([0, 1, 0]);
    expect(doc.objects.t.traits["arena.target"]).toEqual({});
  });
});

describe("the arena's activities", () => {
  const byId = (id) => plugins.find((p) => p.id === id);

  it("plays only in play, edits only in edit, on the same traits", () => {
    expect(byId("arena").activities).toEqual(["play"]);
    expect(byId("arena.edit").activities).toEqual(["edit"]);
    expect(byId("arena.edit").traits).toEqual(byId("arena").traits);
  });

  it("has no kits and no old build extension", () => {
    expect(plugins.some((p) => p.type === "scene:kit")).toBe(false);
    expect(byId("arena.build")).toBeUndefined();
  });
});
