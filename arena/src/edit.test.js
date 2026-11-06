// Making and editing a level against a stand-in for the scene: the template
// (what an empty scene's start screen runs), the parts (what the parts bin
// runs) and the edit extension's command.
import { describe, it, expect, beforeEach } from "vitest";
import { plugins } from "./index.js";
import { KINDS, sampleArena } from "./level.js";
import { ART, kindKey } from "./layout.js";
import edit from "./edit.js";
import template from "./template.js";

/**
 * The stage's drop context, as a template or a part gets it: what layout.js
 * and parts.js use. file() keeps a file doc per key in doc.assets, made once,
 * and addObject() writes an object as the stage's does (parent, and the
 * parent's group).
 */
function fakeScene(doc) {
  const calls = { created: [], notices: [], added: [] };
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
    async file(key, make) {
      if (doc.assets?.[key]) return doc.assets[key];
      const { name, bytes, extension, mimeType, hint = null } = make();
      const h = await ctx.repo.create2({ "@patchwork": { type: "file" }, name, extension, mimeType, content: bytes });
      doc.assets ??= {};
      doc.assets[key] ??= { url: h.url, hint };
      return doc.assets[key];
    },
    async addObject(url, opts) {
      calls.added.push({ url, opts });
      const id = ctx.newId("o");
      const parent = opts.parent && doc.objects[opts.parent] ? opts.parent : null;
      doc.objects[id] = { name: opts.name, sourceUrl: url, providerId: opts.providerId, parent, group: parent ? doc.objects[parent].group ?? null : null, transform: opts.transform, ...(opts.hint ? { hint: opts.hint } : {}) };
      doc.order.push(id);
      return id;
    },
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
    // one GLB doc per kind, kept in the scene's assets; the level trait holds only its look
    expect(calls.created).toHaveLength(kinds.length);
    expect(Object.keys(doc.assets).sort()).toEqual(kinds.map(kindKey).sort());
    expect(calls.created[0]).toMatchObject({ "@patchwork": { type: "file" }, extension: "glb", mimeType: "model/gltf-binary" });
    expect(calls.created[0].content).toBeInstanceOf(Uint8Array);
    expect(doc.traits["arena.level"]).toEqual({ look: "arena" });
    expect(doc.view.activity).toBe("play");
    const objects = Object.values(doc.objects);
    const group = objects.find((o) => o.kind === "group");
    expect(group.name).toBe("Arena");
    expect(objects.filter((o) => o.group === Object.keys(doc.objects).find((id) => doc.objects[id] === group))).toHaveLength(blocks.length);
    expect(objects.filter((o) => o.traits?.["arena.target"])).toHaveLength(blocks.filter((b) => b.traits?.["arena.target"]).length);
    expect(objects.filter((o) => o.traits?.["arena.spawn"])).toHaveLength(4);
    expect(doc.order).toHaveLength(blocks.length + 1);
    // every block has its kind's box as a hint, so the level frames and loads biggest-first before any GLB is in
    expect(objects.filter((o) => o.kind !== "group").every((o) => o.hint?.bounds?.max)).toBe(true);
    expect(calls.notices.at(-1).kind).toBe("info");
  });

  it("reuses the scene's GLBs when it already has them", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    const made = calls.created.length;
    await template.create(ctx);
    expect(calls.created).toHaveLength(made);
  });
});

describe("the arena's parts", () => {
  const parts = plugins.filter((p) => p.type === "scene:part");
  const load = async (id) => parts.find((p) => p.id === id).load();
  const AT = { parent: null, transform: { position: [2, 1.2, 3], rotation: [0, 0.4, 0], scale: 1 } };
  let doc, f;
  beforeEach(() => {
    doc = emptyScene();
    f = fakeScene(doc);
  });

  it("are a target, a crate and a spawn point in the Arena category, plain metadata", () => {
    expect(parts.map((p) => [p.id, p.name, p.category])).toEqual([
      ["arena.target", "Target", "Arena"],
      ["arena.crate", "Crate", "Arena"],
      ["arena.spawn", "Spawn point", "Arena"],
    ]);
    for (const { load, ...meta } of parts) {
      expect(structuredClone(meta)).toEqual(meta);
      expect(typeof load).toBe("function");
    }
  });

  it("a target goes where the bin says, makes the scene a level, and returns its id to select", async () => {
    delete doc.traits;
    const id = await (await load("arena.target")).create(f.ctx, AT);
    const o = doc.objects[id];
    expect(o).toMatchObject({ name: "Target", providerId: "file-glb", sourceUrl: "automerge:glb1", parent: null });
    expect(o.transform).toEqual(AT.transform);
    expect(o.traits).toEqual({ "arena.target": {} });
    // a bare level: the scene keeps its own look
    expect(doc.traits["arena.level"]).toEqual({});
    expect(doc.assets[kindKey("target")].url).toBe("automerge:glb1");
    // its box stands in until the GLB loads: a target is about 2 m tall, standing on its foot
    expect(o.hint).toEqual(doc.assets[kindKey("target")].hint);
    expect(o.hint.bounds.min[1]).toBeCloseTo(0, 1);
    expect(o.hint.bounds.max[1]).toBeGreaterThan(1.5);
  });

  it("a level's settings survive a part dropped into it", async () => {
    doc.traits["arena.level"] = { look: "arena" };
    await (await load("arena.spawn")).create(f.ctx, AT);
    expect(doc.traits["arena.level"]).toEqual({ look: "arena" });
    expect(Object.values(doc.objects)[0].traits).toEqual({ "arena.spawn": {} });
  });

  it("dropped on an object, it goes under that object", async () => {
    doc.objects.deck = { name: "Deck", group: "g", transform: AT.transform };
    doc.order.push("deck");
    const at = { parent: "deck", transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: 1 } };
    const id = await (await load("arena.target")).create(f.ctx, at);
    expect(doc.objects[id]).toMatchObject({ parent: "deck", group: "g", transform: at.transform });
  });

  it("a crate is only a crate: no traits, and no level", async () => {
    const id = await (await load("arena.crate")).create(f.ctx, AT);
    expect(doc.objects[id].traits).toBeUndefined();
    expect(doc.traits["arena.level"]).toBeUndefined();
  });

  it("ten of a kind share one GLB doc, and the template's too", async () => {
    await template.create(f.ctx);
    const made = f.calls.created.length;
    const crate = await load("arena.crate");
    for (let i = 0; i < 10; i++) await crate.create(f.ctx, AT);
    expect(f.calls.created).toHaveLength(made);
    const crates = Object.values(doc.objects).filter((o) => o.name === KINDS.crate.name && !o.locked);
    expect(crates).toHaveLength(10);
    expect(new Set(crates.map((o) => o.sourceUrl))).toEqual(new Set([doc.assets[kindKey("crate")].url]));
  });

  it("puts the object, its traits and the level in one change, and nothing if its parent went meanwhile", async () => {
    let changes = 0;
    const change = f.ctx.change;
    f.ctx.change = (fn) => (changes++, change(fn));
    const id = await (await load("arena.target")).create(f.ctx, AT);
    expect(changes).toBe(1);
    expect(doc.objects[id]).toMatchObject({ traits: { "arena.target": {} }, locked: false, providerId: "file-glb" });
    doc.objects.deck = { name: "Deck", transform: AT.transform };
    const file = f.ctx.file;
    f.ctx.file = async (key, make) => (delete doc.objects.deck, file(key, make));
    expect(await (await load("arena.target")).create(f.ctx, { ...AT, parent: "deck" })).toBe(null);
    expect(f.calls.notices.at(-1).text).toMatch(/gone/);
  });

  it("a level from before the scene kept files has its GLBs moved into them, not drawn again", async () => {
    doc.traits["arena.level"] = { kinds: { [`target@${ART}`]: "automerge:oldTarget", "crate@1": "automerge:oldCrate" } };
    const id = await (await load("arena.target")).create(f.ctx, AT);
    expect(doc.objects[id].sourceUrl).toBe("automerge:oldTarget");
    expect(doc.assets[kindKey("target")]).toMatchObject({ url: "automerge:oldTarget", hint: { bounds: { min: expect.any(Array) } } });
    expect(f.calls.created).toHaveLength(0);
    // older art stays where it was, and nothing else of the level is touched
    expect(doc.traits["arena.level"]).toEqual({ kinds: { "crate@1": "automerge:oldCrate" } });
  });
});

describe("editing a level (arena.edit)", () => {
  let doc, f, x;
  beforeEach(() => {
    doc = emptyScene();
    doc.traits["arena.level"] = {};
    f = fakeScene(doc);
    x = edit.create(f.ctx);
  });

  it("offers only standing targets up: putting things is the parts bin's", () => {
    expect(x.commands.map((c) => c.id)).toEqual(["reset"]);
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

  it("brings what playing needs without the editor: keys, notices, and framing as the level loads", () => {
    expect(byId("arena").requires).toEqual(["scene.keys", "scene.notices", "scene.autoframe"]);
    expect(byId("arena.edit").requires).toBeUndefined();
  });

  it("has no kits and no old build extension", () => {
    expect(plugins.some((p) => p.type === "scene:kit")).toBe(false);
    expect(byId("arena.build")).toBeUndefined();
  });
});
