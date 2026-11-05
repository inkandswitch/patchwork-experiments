// The stage, mounted (no WebGL): extensions registered as plugins, started by
// trait, kit and `always`, in running order; the api they get; presence
// between two mounted stages; prefs and kits kept per scene.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo, flush } from "../test/fake-repo.js";
import { assoc } from "./atom.js";
import { bestWidget, hitChain, initialCamera, mergeAtmosphere, mergeLooks, sameTransform, statusOf, widgetWins } from "./stage.js";

vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map();
  function makeRegistry() {
    const plugins = new Map();
    return {
      register(p) {
        plugins.set(p.id, { ...p });
      },
      has: (id) => plugins.has(id),
      get: (id) => plugins.get(id),
      filter: (fn) => [...plugins.values()].filter(fn),
      async load(id) {
        const p = plugins.get(id);
        if (!p) return undefined;
        if (!p.module) p.module = await p.load();
        return p;
      },
      on: () => () => {},
    };
  }
  return {
    getRegistry(type) {
      if (!registries.has(type)) registries.set(type, makeRegistry());
      return registries.get(type);
    },
  };
});

const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
const { plugins } = await import("../index.js");
const { SceneDatatype } = await import("../datatype.js");
const { default: Stage } = await import("./stage.js");
for (const p of plugins) if (p.type === "scene:source" || p.type === "patchwork:datatype") getRegistry(p.type).register(p);

// ─── test extensions ────────────────────────────────────────────────────────
//
// Each plugin's module is looked up per test in `exts`, so a test can give an
// extension whatever instance it likes; every instance records what the
// stage did to it.

let exts = {};
const ext = (id) => exts[id];

function recorder(id, instance = () => ({}), moduleExtra = {}) {
  const r = { id, api: null, apis: [], updates: [], received: [], disposed: 0, instance: null };
  r.module = {
    create(api) {
      r.api = api;
      r.apis.push(api);
      r.instance = {
        update(scene, local, prev) {
          r.updates.push({ scene, local, prev });
        },
        receive(type, data, from) {
          r.received.push({ type, data, from });
        },
        dispose() {
          r.disposed++;
        },
        ...instance(api, r),
      };
      return r.instance;
    },
    ...moduleExtra,
  };
  return r;
}

const EXT_PLUGINS = [
  { id: "t.scene", traits: ["t.scene"] },
  { id: "t.obj", traits: ["t.obj"] },
  { id: "t.kit" },
  { id: "t.always", always: true },
  { id: "t.dropped", traits: ["t.dropped"], drops: ["t-deck"] },
];
for (const p of EXT_PLUGINS) {
  getRegistry("scene:extension").register({
    type: "scene:extension",
    name: p.id,
    ...p,
    // fresh every load, so each test's module is the one used
    load: async () => ext(p.id).module,
  });
}
// the mock registry caches a loaded module: forget it between tests
const forgetModules = () => {
  for (const p of EXT_PLUGINS) delete getRegistry("scene:extension").get(p.id).module;
};
getRegistry("scene:kit").register({ type: "scene:kit", id: "t.kit", name: "Test kit", extensions: ["t.kit"] });

// ─── mounting ───────────────────────────────────────────────────────────────

const card = (extra = {}) => ({ name: "Card", sourceUrl: null, providerId: "file-glb", renderUrl: null, parent: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });

const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await flush();
};
async function until(fn, ms = 1000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let repo;
const mounted = [];
function mount(handle, viewerId) {
  const element = document.createElement("div");
  element.repo = repo;
  if (viewerId) element.viewerId = viewerId;
  document.body.append(element);
  const cleanup = Stage(handle, element);
  const debug = element.querySelector(".scene-stage").__sceneDebug;
  const m = { element, cleanup, debug, local: debug.local, host: debug.host, root: element.querySelector(".scene-stage") };
  mounted.push(m);
  return m;
}
function newScene(extra = {}) {
  const doc = {};
  SceneDatatype.init(doc);
  return repo.add({ "@patchwork": { type: "scene" }, ...doc, ...extra, view: { ...doc.view, ...(extra.view ?? {}) } });
}
const running = (m) => m.local.get().running.map((r) => `${r.id}:${r.scope}`);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    localStorage.clear();
  } catch {
    // none
  }
  repo = new FakeRepo();
  exts = {};
  for (const p of EXT_PLUGINS) exts[p.id] = recorder(p.id);
  forgetModules();
});
afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    m.cleanup();
    m.element.remove();
  }
  vi.restoreAllMocks();
});

// ─── pure helpers ───────────────────────────────────────────────────────────

describe("the stage's pure helpers", () => {
  it("hit chain: the object, what it's attached to (nearest first), then its groups", () => {
    const parents = new Map([["a", "b"], ["b", "c"], ["c", null]]);
    const groups = new Map([["a", "g1"], ["g1", "g2"], ["g2", null]]);
    expect(hitChain("a", parents, groups)).toEqual(["a", "b", "c", "g1", "g2"]);
    expect(hitChain(null, parents, groups)).toEqual([]);
  });
  it("widgets: onTop beats any other, else the nearest; and against the object hit", () => {
    expect(bestWidget([{ owner: "a", distance: 2 }, { owner: "b", distance: 1 }]).owner).toBe("b");
    expect(bestWidget([{ owner: "a", distance: 1 }, { owner: "b", distance: 9, onTop: true }]).owner).toBe("b");
    expect(bestWidget([])).toBeNull();
    expect(widgetWins({ owner: "a", distance: 3 }, { distance: 2 })).toBe(false);
    expect(widgetWins({ owner: "a", distance: 3, onTop: true }, { distance: 2 })).toBe(true);
    expect(widgetWins({ owner: "a", distance: 1 }, { distance: 2 })).toBe(true);
    expect(widgetWins({ owner: "a" }, null)).toBe(true);
  });
  it("lenses stack in running order, later fields over earlier ones, missing objects dropped", () => {
    const objects = { a: {}, b: {} };
    const m = mergeLooks([new Map([["a", { name: "x", sourceUrl: "s" }], ["zz", { name: "gone" }]]), new Map([["a", { name: "y", sourceUrl: undefined }]])], objects);
    expect([...m]).toEqual([["a", { name: "y", sourceUrl: "s" }]]);
  });
  it("compares transforms by number", () => {
    expect(sameTransform({ position: [1, 2, 3] }, { position: [1, 2, 3 + 1e-9], rotation: [0, 0, 0], scale: 1 })).toBe(true);
    expect(sameTransform({ position: [1, 2, 3] }, { position: [1, 2, 3.1] })).toBe(false);
    expect(sameTransform(null, {})).toBe(false);
  });
  it("the camera: this viewer's, else the doc's home, else the old shared camera", () => {
    const home = { position: [1, 1, 1], target: [0, 0, 0] };
    const old = { position: [2, 2, 2], target: [0, 0, 0] };
    expect(initialCamera({ stored: { position: [3, 3, 3], target: [0, 1, 0], fov: 30 }, doc: { view: { home }, camera: old } })).toEqual({ position: [3, 3, 3], target: [0, 1, 0], fov: 30 });
    expect(initialCamera({ stored: { position: "nope" }, doc: { view: { home }, camera: old } })).toEqual(home);
    expect(initialCamera({ doc: { camera: old } })).toEqual(old);
    expect(initialCamera({ doc: {} })).toBeNull();
  });
  it("status: what's loading, building or broken", () => {
    expect(statusOf(card(), null)).toBeNull();
    expect(statusOf(card(), { passthrough: true, phase: "finding" }).state).toBe("loading");
    expect(statusOf(card(), { passthrough: true, phase: "ready" })).toBeNull();
    expect(statusOf(card(), { phase: "no-provider", providerId: "x" }).state).toBe("warn");
    expect(statusOf({ kind: "group" }, { phase: "error" })).toBeNull();
    // a failed build that will be retried says so (contract v3 build retries)
    expect(statusOf(card(), { phase: "ready", status: "error", error: "boom", retryAt: 123 }).title).toBe("boom · retrying automatically");
    expect(statusOf(card(), { phase: "ready", status: "error", error: "boom", retryAt: null }).title).toBe("boom");
  });
});

// ─── mounted ────────────────────────────────────────────────────────────────

describe("the stage, mounted", () => {
  it("lays out four edges around a port; the root is focusable", async () => {
    const m = mount(newScene());
    await settle();
    expect(m.root.classList.contains("scene-tool")).toBe(true);
    expect(m.root.tabIndex).toBe(0);
    expect([...m.root.children].filter((c) => c.tagName === "DIV").map((c) => c.dataset.edge ?? c.className)).toEqual(["top", "left", "viewport", "right", "bottom"]);
    expect(m.root.querySelector(".viewport > .canvas")).toBeTruthy();
    expect(m.root.querySelector(".viewport > .labels")).toBeTruthy();
    expect(m.element.querySelector("style")).toBeTruthy(); // stage.css (vitest inlines CSS as "")
  });

  it("runs what the doc's traits, the kits and `always` call for, in running order", async () => {
    // the scene extension loads last
    let release;
    const slow = new Promise((r) => (release = r));
    const scene = exts["t.scene"].module;
    exts["t.scene"].module = { create: async () => null };
    getRegistry("scene:extension").get("t.scene").load = async () => {
      await slow;
      return scene;
    };
    try {
      const h = newScene({ traits: { "t.scene": {} }, objects: { a: card({ traits: { "t.obj": {} } }) }, order: ["a"], view: { kits: ["t.kit"] } });
      const m = mount(h);
      await settle();
      expect(running(m)).toEqual(["t.obj:objects", "t.kit:viewer", "t.always:viewer"]);
      release();
      await settle();
      expect(running(m)).toEqual(["t.scene:scene", "t.obj:objects", "t.kit:viewer", "t.always:viewer"]);
      expect(m.debug.host.collect("update").map((x) => x.id)).toEqual(["t.scene", "t.obj", "t.kit", "t.always"]);
    } finally {
      getRegistry("scene:extension").get("t.scene").load = async () => ext("t.scene").module;
    }
  });

  it("stops a kit's extension at once when the viewer turns the kit off: its overlay goes, then dispose", async () => {
    exts["t.kit"] = recorder("t.kit", (api) => {
      api.overlay().textContent = "kit overlay";
      api.edge("left").textContent = "kit edge";
      api.labels().set([{ key: "k", text: "label", screen: { x: 1, y: 1 } }]);
      return {};
    });
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    await settle();
    const r = exts["t.kit"];
    expect(m.root.querySelector(".stage-overlay").textContent).toBe("kit overlay");
    expect(m.root.querySelector('[data-edge="left"]').textContent).toBe("kit edge");
    expect(m.root.querySelectorAll(".labels .label")).toHaveLength(1);
    m.local.swap((v) => ({ ...v, kits: { on: [], off: ["t.kit"] } }));
    expect(r.disposed).toBe(1);
    expect(r.api.signal.aborted).toBe(true);
    expect(m.root.querySelector(".stage-overlay")).toBeNull();
    expect(m.root.querySelector('[data-edge="left"]').children).toHaveLength(0);
    expect(m.root.querySelectorAll(".labels .label")).toHaveLength(0);
    expect(running(m)).toEqual(["t.always:viewer"]);
    // after the abort, acquiring is a no-op
    expect(r.api.overlay().isConnected).toBe(false);
    expect(typeof r.api.camera.limit({ minPolar: 0 })).toBe("function");
  });

  it("calls update(scene, local, prev) after a doc change and after a local swap", async () => {
    const h = newScene({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] });
    const m = mount(h);
    await settle();
    const r = exts["t.scene"];
    const first = r.updates.at(-1);
    expect(first.prev).toEqual({ scene: null, local: null });
    expect(first.scene.objects.a.name).toBe("Card");
    expect(first.scene.world("a")[0]).toBe(1);
    const n = r.updates.length;
    h.change((d) => {
      d.objects.a.name = "Renamed";
    });
    await settle();
    expect(r.updates.length).toBe(n + 1);
    const u = r.updates.at(-1);
    expect(u.scene.objects.a.name).toBe("Renamed");
    expect(u.prev.scene).toBe(first.scene);
    m.local.swap(assoc("selected", "a"));
    await settle();
    expect(r.updates.length).toBe(n + 2);
    expect(r.updates.at(-1).local.selected).toBe("a");
    expect(r.updates.at(-1).prev.local.selected).toBeUndefined();
    // nothing changed: no update
    await settle();
    expect(r.updates.length).toBe(n + 2);
  });

  it("what's shown changing in the same flush as local state still gets a content update (prev === scene, local)", async () => {
    const h = newScene({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] });
    const m = mount(h);
    await settle();
    const r = exts["t.scene"];
    const n = r.updates.length;
    // one tick: a pose held (what's shown changes) and a local swap (a status, say)
    r.api.pose.hold("a", { position: [0, 1, 0], rotation: [0, 0, 0], scale: 1 });
    m.local.swap(assoc("hovered", "a"));
    await settle();
    const after = r.updates.slice(n);
    expect(after.some((u) => u.prev.local !== u.local)).toBe(true);
    expect(after.some((u) => u.prev.scene === u.scene && u.prev.local === u.local && u.local.hovered === "a")).toBe(true);
  });

  it("lenses: nameOf shows what this viewer sees", async () => {
    exts["t.scene"] = recorder("t.scene", () => ({ looks: () => new Map([["a", { name: "Ace of spades" }]]) }));
    exts["t.always"] = recorder("t.always", () => ({ looks: () => new Map([["a", { sourceUrl: null }], ["b", { name: "B!" }]]) }));
    const m = mount(newScene({ traits: { "t.scene": {} }, objects: { a: card(), b: card() }, order: ["a", "b"] }));
    await settle();
    const api = exts["t.scene"].api;
    expect(api.nameOf("a")).toBe("Ace of spades");
    expect(api.nameOf("b")).toBe("B!");
    expect(api.nameOf("zz")).toBeNull();
    expect(m.debug.looks().get("a")).toEqual({ name: "Ace of spades", sourceUrl: null });
  });

  it("atmosphere: the running extensions' merged in running order, handed to the viewport; gone when its giver stops", async () => {
    exts["t.kit"] = recorder("t.kit", () => ({ atmosphere: () => ({ sky: { top: "#336699" }, fog: { color: "#ffffff", near: 10, far: 90 }, exposure: 1.2 }) }));
    exts["t.always"] = recorder("t.always", () => ({ atmosphere: () => ({ fog: null, sun: { direction: [0, 1, 0], shadows: true } }) }));
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    await settle();
    // t.kit runs before t.always: its fog is cleared by the later null, its sky and exposure kept
    const merged = { sky: { top: "#336699" }, exposure: 1.2, sun: { direction: [0, 1, 0], shadows: true } };
    expect(m.debug.atmosphere()).toEqual(merged);
    expect(m.debug.viewport.atmosphere).toEqual({ sky: { top: "#336699", horizon: "#336699", bottom: "#336699" }, sun: { direction: [0, 1, 0], color: "#ffffff", intensity: 1.5, shadows: true }, exposure: 1.2 });
    m.local.swap((v) => ({ ...v, kits: { on: [], off: ["t.kit"] } }));
    await settle();
    expect(m.debug.atmosphere()).toEqual({ sun: { direction: [0, 1, 0], shadows: true } });
    expect(m.debug.viewport.atmosphere.sky).toBeUndefined();
  });

  it("no extension gives an atmosphere: the viewport is never told one", async () => {
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    const spy = vi.spyOn(m.debug.viewport, "setAtmosphere");
    await settle();
    expect(m.debug.atmosphere()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(m.debug.viewport.atmosphere).toBeNull();
  });

  it("collect() and run(invocation): commands by target, state decides", async () => {
    const ran = [];
    exts["t.scene"] = recorder("t.scene", () => ({
      commands: [
        { id: "poke", name: "Poke", state: (t) => (t ? { title: "Poke it" } : null), run: (t, v) => ran.push(["poke", t, v]) },
        { id: "reset", name: "Reset", run: (t) => ran.push(["reset", t]) },
        { id: "off", name: "Off", state: () => ({ disabled: true }), run: () => ran.push(["off"]) },
      ],
    }));
    exts["t.always"] = recorder("t.always", () => ({ commands: [{ id: "x", name: "X", run: () => {} }] }));
    mount(newScene({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] }));
    await settle();
    const api = exts["t.always"].api;
    expect(api.collect("commands").map((c) => [c.id, c.value.map((k) => k.id)])).toEqual([
      ["t.scene", ["poke", "reset", "off"]],
      ["t.always", ["x"]],
    ]);
    expect(api.run({ ext: "t.scene", command: "poke", target: "a", value: 3 })).toBe(true);
    expect(api.run({ ext: "t.scene", command: "poke", target: null })).toBe(false); // doesn't apply to the scene
    expect(api.run({ ext: "t.scene", command: "reset", target: null })).toBe(true);
    expect(api.run({ ext: "t.scene", command: "reset", target: "a" })).toBe(false); // no state: the scene only
    expect(api.run({ ext: "t.scene", command: "off", target: null })).toBe(false);
    expect(api.run({ ext: "nope", command: "poke" })).toBe(false);
    expect(ran).toEqual([
      ["poke", "a", 3],
      ["reset", null],
    ]);
  });

  it("remove(ids): every extension's beforeRemove in the same change, before the removal", async () => {
    const seen = [];
    exts["t.scene"] = recorder("t.scene", () => ({
      beforeRemove(draft, ids) {
        seen.push({ ids: [...ids], stillThere: !!draft.objects.g, dims: draft.dimensions });
        delete draft.dimensions.d1;
      },
    }));
    const h = newScene({
      traits: { "t.scene": {} },
      objects: { g: { kind: "group", name: "G", visible: true, group: null }, a: card({ group: "g" }), b: card() },
      order: ["g", "a", "b"],
      dimensions: { d1: { a: { objectId: "a" } } },
    });
    mount(h);
    await settle();
    const api = exts["t.scene"].api;
    const plan = api.remove("g");
    expect(plan.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].ids.sort()).toEqual(["a", "g"]);
    expect(seen[0].stillThere).toBe(true);
    expect(Object.keys(h.doc().objects)).toEqual(["b"]);
    expect(h.doc().dimensions).toEqual({});
    expect(h.doc().order).toEqual(["b"]);
    expect(api.remove("nope")).toBeNull();
  });

  it("prefs and kits are this viewer's, kept per scene", async () => {
    const h = newScene({ view: { units: "m" } });
    const m = mount(h);
    await settle();
    const api = exts["t.always"].api;
    expect(api.pref("units", "cm")).toBe("m");
    expect(api.pref("nothing", 7)).toBe(7);
    api.setPref("units", "mm");
    expect(api.pref("units", "cm")).toBe("mm");
    m.local.swap((v) => ({ ...v, kits: { on: ["t.kit"], off: [] } }));
    await settle();
    expect(running(m)).toContain("t.kit:viewer");
    expect(JSON.parse(localStorage.getItem(`scene-prefs:${h.url}`))).toEqual({ units: "mm" });
    expect(JSON.parse(localStorage.getItem(`scene-kits:${h.url}`))).toEqual({ on: ["t.kit"], off: [] });
    // a second open of the same scene starts with them
    m.cleanup();
    mounted.splice(mounted.indexOf(m), 1);
    m.element.remove();
    const again = mount(h);
    await settle();
    expect(again.local.get().prefs).toEqual({ units: "mm" });
    expect(running(again)).toContain("t.kit:viewer");
  });

  it("drop(): the module that takes the datatype lays it out; its trait starts it", async () => {
    const dropped = [];
    exts["t.dropped"] = recorder("t.dropped", () => ({}), {
      async drop(ctx, info) {
        if (info.doc?.["@patchwork"]?.type !== "t-deck") return false;
        dropped.push({ url: info.url, ctx: Object.keys(ctx).sort() });
        ctx.change((d) => {
          d.traits = { ...(d.traits ?? {}), "t.dropped": { deck: info.url } };
        });
        return true;
      },
    });
    const h = newScene();
    const m = mount(h);
    await settle();
    expect(running(m)).not.toContain("t.dropped:scene");
    const deck = repo.add({ "@patchwork": { type: "t-deck" }, title: "Deck" });
    const api = exts["t.always"].api;
    expect(await api.drop({ url: deck.url, doc: deck.doc(), handle: deck, group: null, at: null })).toBe(true);
    await settle();
    expect(dropped).toHaveLength(1);
    expect(dropped[0].ctx).not.toContain("overlay");
    expect(dropped[0].ctx).toEqual(expect.arrayContaining(["addObject", "change", "doc", "local", "newId", "registry", "repo"]));
    expect(running(m)).toContain("t.dropped:scene");
    expect(await api.drop({ url: deck.url, doc: { "@patchwork": { type: "other" } } })).toBe(false);
  });

  it("addObject: a passthrough GLB file becomes an object, where it's asked to go", async () => {
    const h = newScene({ objects: { p: card(), g: { kind: "group", name: "G", visible: true, group: null } }, order: ["p", "g"] });
    mount(h);
    await settle();
    const api = exts["t.always"].api;
    const file = repo.add({ "@patchwork": { type: "file" }, name: "part.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array([1]) });
    expect((await api.providersFor(file.url, file.doc())).map((p) => p.id)).toEqual(["file-glb"]);
    const id = await api.addObject(file.url, { name: "Part", group: "g", before: "p", transform: { position: [1, 2, 3] } });
    const o = h.doc().objects[id];
    expect(o).toMatchObject({ name: "Part", sourceUrl: file.url, providerId: "file-glb", renderUrl: null, group: "g", parent: null });
    expect(o.transform).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 });
    expect(h.doc().order).toEqual([id, "p", "g"]);
    const attached = await api.addObject(file.url, { parent: "p" });
    expect(h.doc().objects[attached].parent).toBe("p");
    await expect(api.addObject("not a url")).rejects.toThrow(/automerge URL/);
    await expect(api.addObject(h.url)).rejects.toThrow(/itself/);
    const txt = repo.add({ "@patchwork": { type: "essay" } });
    await expect(api.addObject(txt.url)).rejects.toThrow(/No scene provider/);
  });

  it("schedule(fn) runs in the next flush; notify() reaches local.notices", async () => {
    mount(newScene());
    await settle();
    const api = exts["t.always"].api;
    const fn = vi.fn();
    api.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    await settle(1);
    expect(fn).toHaveBeenCalledTimes(1);
    api.notify("Hello", "error");
    expect(api.local.get().notices.at(-1)).toMatchObject({ text: "Hello", kind: "error", from: "t.always" });
  });

  it("routes input down the chain: an objects extension gets a click on its object, with holder", async () => {
    const clicks = [];
    exts["t.obj"] = recorder("t.obj", () => ({ input: { click: (ev) => (clicks.push(["obj", ev.holder, ev.hit?.id]), true) } }));
    exts["t.always"] = recorder("t.always", () => ({ input: { click: (ev) => (clicks.push(["always", ev.holder]), true), key: (ev) => (clicks.push(["key", ev.key]), true) } }));
    const h = newScene({ objects: { p: card({ traits: { "t.obj": {} } }), c: card({ parent: "p" }) }, order: ["p", "c"] });
    const m = mount(h);
    await settle();
    const canvas = m.root.querySelector(".canvas");
    const vp = m.debug.viewport;
    const click = (id) => {
      vp.pick = () => (id ? { id, point: [0, 0, 0], normal: null, distance: 1, snapped: false } : null);
      const opts = { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0, pointerId: 1, pointerType: "mouse" };
      canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    };
    click("c"); // attached to p, which carries the trait
    click(null); // nothing hit: the objects extension isn't offered it
    expect(clicks).toEqual([
      ["obj", "p", "c"],
      ["always", null],
    ]);
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true }));
    expect(clicks.at(-1)).toEqual(["key", "k"]);
  });

  it("an armed extension is local.armed and has the input first; stopping it disarms", async () => {
    const order = [];
    exts["t.kit"] = recorder("t.kit", (api) => {
      api.arm({ key: (ev) => (order.push(["armed", ev.key]), true) });
      return {};
    });
    exts["t.always"] = recorder("t.always", () => ({ input: { key: (ev) => (order.push(["always", ev.key]), true) } }));
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    await settle();
    expect(m.local.get().armed).toBe("t.kit");
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true }));
    m.local.swap((v) => ({ ...v, kits: { on: [], off: ["t.kit"] } }));
    expect(m.local.get().armed).toBeNull();
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }));
    expect(order).toEqual([
      ["armed", "a"],
      ["always", "b"],
    ]);
  });

  it("an immersive arm is local.immersive while it's on", async () => {
    let disarm = null;
    exts["t.kit"] = recorder("t.kit", (api) => {
      disarm = api.arm({}, { immersive: true });
      return {};
    });
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    await settle();
    expect(m.local.get().immersive).toBe(true);
    disarm();
    expect(m.local.get().immersive).toBe(false);
  });

  it("focus left for nowhere (a clicked button that went away) comes back to the root", async () => {
    const m = mount(newScene());
    await settle();
    const button = document.createElement("button");
    m.root.append(button);
    button.addEventListener("click", () => button.remove());
    button.focus();
    button.click();
    await settle();
    expect(document.activeElement).toBe(m.root);
  });

  it("a focused element blurred while it stays connected (Chrome, when it's moved) gives focus back, unless the press was outside", async () => {
    const m = mount(newScene());
    await settle();
    const button = document.createElement("button");
    m.root.append(button);
    // moved: Chrome blurs it, still connected, with focus on <body>, and fires no click
    button.focus();
    button.blur();
    await settle();
    expect(document.activeElement).toBe(m.root);
    // someone clicked the page outside: that's theirs
    button.focus();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.blur();
    await settle();
    expect(document.activeElement).not.toBe(m.root);
  });

  it("widgetAt: the widget's owner is offered the press first; its open session keeps it busy", async () => {
    const got = [];
    exts["t.kit"] = recorder("t.kit", () => ({
      input: {
        widgetAt: () => ({ onTop: true, handle: "h1" }),
        press: (ev) => (got.push(["kit", ev.widget.handle, ev.widget.owner]), { move() {}, end() {}, cancel: () => got.push(["cancel"]) }),
      },
    }));
    exts["t.always"] = recorder("t.always", () => ({ input: { press: () => (got.push(["always"]), {}) } }));
    const m = mount(newScene({ view: { kits: ["t.kit"] } }));
    await settle();
    const canvas = m.root.querySelector(".canvas");
    const opts = { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0, pointerId: 1, pointerType: "mouse" };
    expect(m.debug.busy("t.kit")).toBe(false);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
    expect(got).toEqual([["kit", "h1", "t.kit"]]);
    expect(m.debug.busy("t.kit")).toBe(true);
    // released under the slop with no tap: cancelled, and no longer busy
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    expect(got.at(-1)).toEqual(["cancel"]);
    expect(m.debug.busy("t.kit")).toBe(false);
  });
});

describe("two stages on one scene", () => {
  // one handle, its broadcasts delivered as ephemeral messages to everyone listening
  function shared(extra) {
    const h = newScene(extra);
    h.broadcast = (message) => h.emit("ephemeral-message", { message });
    return h;
  }

  it("presence keys, sends and pose holds go round", async () => {
    const h = shared({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] });
    const A = mount(h, "viewer:alice");
    await settle();
    const recA = exts["t.scene"];
    const apiA = recA.api;
    // the second mount gets its own instances
    exts["t.scene"] = recorder("t.scene");
    forgetModules();
    const B = mount(h, "viewer:bob");
    await settle();
    const recB = exts["t.scene"];
    const apiB = recB.api;
    expect(apiB).not.toBe(apiA);

    apiA.presence.set("pointer", { x: 1 });
    await until(() => Object.values(apiB.presence.get()).some((p) => p.keys["t.scene"]?.pointer?.x === 1));
    const peer = Object.entries(apiB.presence.get()).find(([, p]) => p.viewer === "viewer:alice");
    expect(peer[1].keys).toEqual({ "t.scene": { pointer: { x: 1 } } });

    apiA.send("ping", { n: 1 });
    expect(recB.received).toEqual([{ type: "ping", data: { n: 1 }, from: { session: A.debug.presence.session, viewer: "viewer:alice" } }]);
    expect(recA.received).toEqual([]);

    // A holds the card: B shows it there
    apiA.pose.hold("a", { position: [1, 2, 3] });
    await until(() => B.debug.viewport.poses.has("a"));
    expect(B.debug.viewport.poses.get("a").position).toEqual([1, 2, 3]);
    expect(apiB.heldBy("a")).toBe(A.debug.presence.session);
    // A puts it down: the doc, then a landed release; B lets go once its doc agrees
    h.change((d) => {
      d.objects.a.transform = { position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 };
    });
    apiA.pose.release("a", { landed: true });
    await until(() => !B.debug.viewport.poses.has("a"));
    expect(apiB.heldBy("a")).toBeNull();

    // stopping A's extension clears its keys on B
    A.cleanup();
    mounted.splice(mounted.indexOf(A), 1);
    await until(() => !Object.values(apiB.presence.get()).some((p) => p.viewer === "viewer:alice"));
  });

  it("a hold dropped by the extension stopping is put back on the peer", async () => {
    const h = shared({ view: { kits: ["t.kit"] }, objects: { a: card() }, order: ["a"] });
    const A = mount(h, "viewer:alice");
    await settle();
    const apiA = exts["t.kit"].api;
    exts["t.kit"] = recorder("t.kit");
    forgetModules();
    const B = mount(h, "viewer:bob");
    await settle();
    apiA.pose.hold("a", { position: [5, 0, 0] });
    await until(() => B.debug.viewport.poses.has("a"));
    // A's viewer turns the kit off: the hold is released as a put-back
    A.local.swap((v) => ({ ...v, kits: { on: [], off: ["t.kit"] } }));
    await until(() => !B.debug.viewport.poses.has("a"));
    expect(A.debug.viewport.poses.has("a")).toBe(false);
  });
});

describe("mergeAtmosphere", () => {
  it("later fields win per field, whole; undefined keeps, null clears; nothing is null", () => {
    expect(mergeAtmosphere([])).toBeNull();
    expect(mergeAtmosphere([null, undefined, 3])).toBeNull();
    expect(mergeAtmosphere([{ sky: { top: "#000" } }, { sky: { horizon: "#fff" } }])).toEqual({ sky: { horizon: "#fff" } });
    expect(mergeAtmosphere([{ fog: { color: "#fff", far: 9 }, exposure: 2 }, { fog: undefined, sun: { direction: [1, 1, 0] } }])).toEqual({ fog: { color: "#fff", far: 9 }, exposure: 2, sun: { direction: [1, 1, 0] } });
    expect(mergeAtmosphere([{ fog: { color: "#fff", far: 9 } }, { fog: null }])).toBeNull();
    // only the fields the stage knows
    expect(mergeAtmosphere([{ weather: "rain" }])).toBeNull();
  });
});
