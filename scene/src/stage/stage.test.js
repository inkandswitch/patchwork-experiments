// @vitest-environment happy-dom
// The stage, mounted (no WebGL): extensions registered as plugins, started by
// trait (`"*"`: every doc), in running order, as the doc calls
// for them; the api they get; presence between two mounted stages; prefs
// kept per scene; where the doc starts people; and the editor's templates,
// parts and drops (../parts/editor.js) run on an api.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo, flush } from "../test/fake-repo.js";
import { assoc } from "./atom.js";
import { wallAt } from "../test/stage-harness.js";
import { bestWidget, initialCamera, startOf, statusOf, widgetWins } from "./stage.js";
import { wholeStart } from "./view.js";
import { hitChain } from "./chain.js";
import { SEND } from "./presence.js";

vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map();
  function makeRegistry() {
    const plugins = new Map();
    const listeners = new Set();
    return {
      register(p) {
        plugins.set(p.id, { ...p });
      },
      // uninstalling: gone from the registry, and its listeners told
      unregister(id) {
        plugins.delete(id);
        for (const fn of [...listeners]) fn();
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
      on(ev, fn) {
        if (ev !== "changed") return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
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
const { emptyScene } = await import("../test/empty-scene.js");
const { default: Stage } = await import("./stage.js");
const { add, drop, editor, part, template: runTemplate } = await import("../parts/editor.js");
// the drop context (EDITOR.md, "Drops"), whole: what a drop, a part and a template get
const CTX = ["addObject", "change", "content", "doc", "file", "id", "local", "newId", "notify", "registry", "repo", "scene", "select", "url", "viewer", "worldOf"];
// (and the editor's hand, a view plugin: the start's `edit` picks it up; and the view's native services)
const VIEWS = ["scene.edit", "scene.notices", "scene.prefs", "scene.drawer", "scene.poses"];
for (const p of plugins) if (p.type === "scene:source" || p.type === "patchwork:datatype" || VIEWS.includes(p.id)) getRegistry(p.type).register(p);
/** what scene.notices shows */
const noticesOf = (m) => m.debug.view.plugins.instanceOf("scene.notices").notices;

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
  // registered far before near, so nearness (not running order) has to put near first
  { id: "t.far", traits: ["t.far"] },
  { id: "t.near", traits: ["t.near"] },
  { id: "t.edit", traits: ["*"] },
  { id: "t.always", traits: ["*"] },
  { id: "t.dropped", traits: ["t.dropped"], drops: ["t-deck"] },
];
const registerExt = (p) =>
  getRegistry("scene:extension").register({
    type: "scene:extension",
    name: p.id,
    ...p,
    // fresh every load, so each test's module is the one used
    load: async () => ext(p.id).module,
  });
for (const p of EXT_PLUGINS) registerExt(p);
/** Uninstall a test extension: it stops at once in every mounted stage (put back after each test). */
const uninstall = (id) => getRegistry("scene:extension").unregister(id);
// the mock registry caches a loaded module: forget it between tests
const forgetModules = () => {
  for (const p of EXT_PLUGINS) delete getRegistry("scene:extension").get(p.id).module;
};
// a template, whose create() is per test too
let template = null;
getRegistry("scene:template").register({ type: "scene:template", id: "t.template", name: "Test level", load: async () => ({ create: (ctx, params) => template?.(ctx, params) }) });
// a part, likewise
let partCreate = null;
getRegistry("scene:part").register({ type: "scene:part", id: "t.part", name: "Test part", load: async () => ({ create: (ctx, at) => partCreate?.(ctx, at) }) });

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
function mount(handle, viewerId, { time = null } = {}) {
  const element = document.createElement("div");
  element.repo = repo;
  if (viewerId) element.viewerId = viewerId;
  if (time) element.time = time;
  document.body.append(element);
  const cleanup = Stage(handle, element);
  const debug = element.querySelector(".scene-stage").__sceneDebug;
  const m = { element, cleanup, debug, local: debug.local, host: debug.host, root: element.querySelector(".scene-stage") };
  mounted.push(m);
  return m;
}
function newScene(extra = {}) {
  return repo.add(emptyScene(extra));
}
const running = (m) => m.local.get().running.filter((r) => r.id !== "scene.poses").map((r) => `${r.id}:${r.scope}`);

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
  // one uninstalled last test: all of them again, in their order (registry order is running order)
  if (EXT_PLUGINS.some((p) => !getRegistry("scene:extension").has(p.id))) {
    for (const p of EXT_PLUGINS) if (getRegistry("scene:extension").has(p.id)) getRegistry("scene:extension").unregister(p.id);
    for (const p of EXT_PLUGINS) registerExt(p);
  }
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
  it("the camera: this viewer's, else the doc's view.start.home, else none (a top-level doc.camera or an old view.home is not a home)", () => {
    const home = { position: [1, 1, 1], target: [0, 0, 0] };
    const stray = { position: [2, 2, 2], target: [0, 0, 0] };
    expect(initialCamera({ stored: { position: [3, 3, 3], target: [0, 1, 0], fov: 30 }, doc: { view: { start: { home } } } })).toEqual({ position: [3, 3, 3], target: [0, 1, 0], fov: 30 });
    expect(initialCamera({ stored: { position: "nope" }, doc: { view: { start: { home } } } })).toEqual(home);
    expect(initialCamera({ doc: { camera: stray } })).toBeNull();
    expect(initialCamera({ doc: { view: { home } } })).toBeNull();
    expect(initialCamera({ doc: {} })).toBeNull();
  });
  it("view.start: the kernel reads a body (look too: the stage's), a place, a home; anything else is nothing to it", () => {
    const home = { position: [1, 1, 1], target: [0, 0, 0] };
    expect(startOf({ view: { start: { body: "walk", place: "spawn1", home } } })).toEqual({ body: "walk", place: "spawn1", home });
    expect(startOf({ view: { start: { body: "walk", place: "x", edit: true } } })).toEqual({ body: "walk", place: "x", home: null });
    expect(startOf({ view: { start: { body: 3, place: "" } } })).toEqual({ body: null, place: null, home: null });
    expect(startOf({ view: { activity: "play" } })).toEqual({ body: null, place: null, home: null });
    expect(startOf(null)).toEqual({ body: null, place: null, home: null });
  });
  it("view.start whole, as view.arrived says it: a frozen plain copy, every key kept (the plugins'), {} for none", () => {
    const start = { body: "walk", "t.mine": { on: true, n: [1, 2] } };
    const whole = wholeStart({ view: { start } });
    expect(whole).toEqual(start);
    expect(whole).not.toBe(start);
    expect([Object.isFrozen(whole), Object.isFrozen(whole["t.mine"]), Object.isFrozen(whole["t.mine"].n)]).toEqual([true, true, true]);
    for (const doc of [{ view: {} }, { view: { start: "walk" } }, { view: { start: [1] } }, null]) expect(wholeStart(doc)).toEqual({});
  });
  it("status: what's loading, building or broken", () => {
    expect(statusOf(card(), null)).toBeNull();
    expect(statusOf(card(), { content: "file", phase: "finding" }).state).toBe("loading");
    expect(statusOf(card(), { content: "file", phase: "ready" })).toBeNull();
    expect(statusOf(card(), { phase: "no-provider", providerId: "x" }).state).toBe("warn");
    expect(statusOf({ kind: "group" }, { phase: "error" })).toBeNull();
    // a failed build that will be retried says so (contract v3 build retries)
    expect(statusOf(card(), { phase: "ready", status: "error", error: "boom", retryAt: 123 }).title).toBe("boom · retrying automatically");
    expect(statusOf(card(), { phase: "ready", status: "error", error: "boom", retryAt: null }).title).toBe("boom");
  });
});

// ─── mounted ────────────────────────────────────────────────────────────────

describe("the stage, mounted", () => {
  it("arriving: view.start's body is entered once, at its place, as soon as it's on offer; a later change moves nobody", async () => {
    const entered = [];
    exts["t.edit"] = recorder("t.edit", () => ({
      bodies: [{ id: "stroll", label: "Stroll", lock: false, enter: (place) => (entered.push(place), { input: {}, eye: () => null, label: place === "a" ? "At a" : undefined }) }],
    }));
    const h = newScene({ objects: { a: card() }, order: ["a"], view: { start: { body: "stroll", place: "a" } } });
    const m = mount(h);
    await until(() => entered.length > 0); // (the first mount in the file loads the view's modules)
    expect(entered).toEqual(["a"]);
    // the sitting's own label (a station's "Helm") is what the chip says
    expect(m.local.get().body).toMatchObject({ id: "stroll", label: "At a", depth: 1 });
    h.change((d) => {
      d.view.start.place = "b";
    });
    await settle();
    expect(entered).toEqual(["a"]);
    // a body nothing here offers: nothing is entered; the base is Look (a doc naming any body but Edit starts in Look)
    const other = mount(newScene({ view: { start: { body: "missing" } } }));
    await settle();
    expect(other.local.get().body.id).toBe("look");
  });

  it("arriving: with an extension that failed to start, a body offered only after everything else started is not entered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // what's on offer, read live (the list is the instance's own)
    const bodies = [];
    const LATE = { id: "late", label: "Late", lock: false, enter: () => ({ input: {}, eye: () => null }) };
    exts["t.edit"] = recorder("t.edit", () => ({ bodies }));
    // the doc calls for t.scene, which fails to start: the host never settles
    exts["t.scene"] = recorder("t.scene", () => {
      throw new Error("broken");
    });
    const h = newScene({ traits: { "t.scene": {} }, view: { start: { body: "late" } } });
    const b = mount(h);
    await settle();
    await new Promise((r) => setTimeout(r, 300)); // the wait looks again every 250 ms while something starts
    await settle();
    bodies.push(LATE);
    h.change((d) => (d.title = "Renamed")); // a flush, with the body now on offer
    await settle();
    expect(b.local.get().body.id).toBe("look");
  });

  it("stops an uninstalled extension at once: its overlay goes, then dispose", async () => {
    exts["t.edit"] = recorder("t.edit", (api) => {
      api.overlay().textContent = "edit overlay";
      api.edge("left").textContent = "edit edge";
      api.labels().set([{ key: "k", text: "label", screen: { x: 1, y: 1 } }]);
      return {};
    });
    const m = mount(newScene());
    await settle();
    const r = exts["t.edit"];
    expect(m.root.querySelector('.stage-overlay[data-owner="t.edit"]').textContent).toBe("edit overlay");
    expect(m.root.querySelector('[data-edge="left"]').textContent).toBe("edit edge");
    expect(m.root.querySelectorAll(".labels .label")).toHaveLength(1);
    uninstall("t.edit");
    expect(r.disposed).toBe(1);
    expect(r.api.signal.aborted).toBe(true);
    expect(m.root.querySelector('.stage-overlay[data-owner="t.edit"]')).toBeNull();
    expect(m.root.querySelector('[data-edge="left"]').children).toHaveLength(0);
    expect(m.root.querySelectorAll(".labels .label")).toHaveLength(0);
    expect(running(m)).toEqual(["t.always:scene"]);
    // after the abort, acquiring is a no-op
    expect(r.api.overlay().isConnected).toBe(false);
  });

  it("calls update(scene, local, prev) after a doc change and after a local swap", async () => {
    const h = newScene({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] });
    const m = mount(h);
    await settle();
    const r = exts["t.scene"];
    const first = r.updates[0];
    expect(first.prev).toEqual({ scene: null, local: null, view: null });
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
    r.api.use("poses").hold("a", { position: [0, 1, 0], rotation: [0, 0, 0], scale: 1 });
    m.local.swap(assoc("hovered", "a"));
    await settle();
    const after = r.updates.slice(n);
    expect(after.some((u) => u.prev.local !== u.local)).toBe(true);
    expect(after.some((u) => u.prev.scene === u.scene && u.prev.local === u.local && u.local.hovered === "a")).toBe(true);
  });

  it("display: overrides layer in running order, later per field; again replaces the caller's own; nameOf shows them; release (or stopping) restores", async () => {
    const m = mount(newScene({ traits: { "t.scene": {} }, objects: { a: card(), b: card() }, order: ["a", "b"] }));
    await settle();
    const [early, late, T] = [exts["t.scene"].api, exts["t.always"].api, { position: [0, 1, 0], rotation: [0, 0, 0], scale: 1 }];
    // t.always runs after t.scene: its fields win, whoever called first
    late.display("a", { name: "Late", hidden: true });
    const off = early.display("a", { name: "Early", transform: T });
    expect([early.nameOf("a"), m.debug.displayed().get("a"), m.debug.viewport.poses.get("a")]).toEqual(["Late", { name: "Late", hidden: true, transform: T }, T]);
    // again from the same extension replaces its override; the old release is spent
    const again = early.display("a", { transform: { ...T, scale: 2 } });
    off();
    expect(m.debug.viewport.poses.get("a").scale).toBe(2);
    again();
    expect([m.debug.displayed().get("a"), m.debug.viewport.poses.has("a"), early.nameOf("zz")]).toEqual([{ name: "Late", hidden: true }, false, null]);
    uninstall("t.always");
    await settle();
    expect([early.nameOf("a"), m.debug.displayed().size]).toEqual(["Card", 0]);
  });

  it("display: an override outlives its object's removal and applies again when it comes back (an undo)", async () => {
    const h = newScene({ traits: { "t.scene": {} }, objects: { a: card(), b: card() }, order: ["a", "b"] });
    const m = mount(h);
    await settle();
    const api = exts["t.scene"].api;
    api.display("a", { name: "Veiled" });
    h.change((d) => void (delete d.objects.a, d.order.splice(0, 1)));
    await settle();
    expect(m.debug.displayed().has("a")).toBe(false);
    h.change((d) => void ((d.objects.a = card()), d.order.unshift("a")));
    await settle();
    expect(api.nameOf("a")).toBe("Veiled");
  });

  it("an extension holding a pose is busy, so a peer's edit doesn't stop it mid-hold; let go, it isn't", async () => {
    const m = mount(newScene({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] }));
    await settle();
    const poses = exts["t.scene"].api.use("poses");
    expect([m.debug.busy("t.scene"), poses.hold("a", { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 }), m.debug.busy("t.scene")]).toEqual([false, true, true]);
    poses.release("a");
    expect(m.debug.busy("t.scene")).toBe(false);
  });

  it("ambients: the running extensions' offers stacked per name in running order, the later whole; the atmosphere among them is the viewport's; gone when its giver stops", async () => {
    exts["t.edit"] = recorder("t.edit", () => ({ ambient: () => ({ atmosphere: { sky: { top: "#336699" }, exposure: 1.2 }, "t.amb": { rain: 2 } }) }));
    exts["t.always"] = recorder("t.always", () => ({ ambient: () => ({ atmosphere: { sun: { direction: [0, 1, 0], shadows: true } }, "t.amb": null }) }));
    const m = mount(newScene());
    await settle();
    // t.edit runs before t.always: its atmosphere is replaced whole by the later one, its t.amb cleared by the later null
    expect(m.debug.ambients()).toEqual({ atmosphere: { sun: { direction: [0, 1, 0], shadows: true } } });
    expect(Object.isFrozen(m.debug.ambients().atmosphere.sun.direction)).toBe(true);
    expect(m.debug.viewport.atmosphere).toEqual({ sun: { direction: [0, 1, 0], color: "#ffffff", intensity: 1.5, shadows: true } });
    // the outermost stage's are the world's, to its own extensions too
    const a = exts["t.edit"].api.ambient("atmosphere");
    expect(a.value).toBe(m.debug.ambients().atmosphere);
    expect(a.mine).toBe(true);
    expect(exts["t.edit"].api.ambient("t.amb")).toBeNull();
    uninstall("t.always");
    await settle();
    expect(m.debug.ambients()).toEqual({ atmosphere: { sky: { top: "#336699" }, exposure: 1.2 }, "t.amb": { rain: 2 } });
    expect(m.debug.viewport.atmosphere.sky.top).toBe("#336699");
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

  it("remove(ids): a change function running every extension's beforeRemove before the removal; change(fn) says what it wrote", async () => {
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
    expect(seen).toEqual([]);
    expect(api.change(plan).map((p) => p.path.join("."))).toEqual(expect.arrayContaining(["objects.g", "objects.a", "dimensions.d1"]));
    expect(api.change(null)).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0].ids.sort()).toEqual(["a", "g"]);
    expect(seen[0].stillThere).toBe(true);
    expect(Object.keys(h.doc().objects)).toEqual(["b"]);
    expect(h.doc().dimensions).toEqual({});
    expect(h.doc().order).toEqual(["b"]);
    expect(api.remove("nope")).toBeNull();
  });

  it("prefs are this viewer's, kept per scene; the body isn't kept: opening again starts where the doc says", async () => {
    const h = newScene({ view: { units: "m" } });
    const m = mount(h);
    await settle();
    const api = exts["t.always"].api;
    expect(api.use("prefs").get("units", "cm")).toBe("m");
    expect(api.use("prefs").get("nothing", 7)).toBe(7);
    api.use("prefs").set("units", "mm");
    expect(api.use("prefs").get("units", "cm")).toBe("mm");
    expect(JSON.parse(localStorage.getItem(`scene-prefs:${h.url}`))).toEqual({ units: "mm" });
    expect(Object.keys(localStorage).filter((k) => k.includes(h.url) && !k.startsWith("scene-prefs:") && !k.startsWith("scene-camera:"))).toEqual([]);
    // a second open of the same scene starts with the prefs, and where the doc says (made new: holding the editor), not where the last left
    m.cleanup();
    mounted.splice(mounted.indexOf(m), 1);
    m.element.remove();
    const again = mount(h);
    await settle();
    expect(again.local.get()["scene.prefs"]).toEqual({ units: "mm" });
    expect(again.local.get().hands.map((h) => h.kind)).toEqual(["edit"]);
  });

  it("template(id): the template writes the doc through a drop context", async () => {
    const seen = [];
    template = (ctx) => {
      seen.push(Object.keys(ctx).sort());
      ctx.change((d) => {
        d.view.start = { body: "stroll" };
        d.traits["t.scene"] = {};
      });
    };
    exts["t.edit"] = recorder("t.edit", () => ({ bodies: [{ id: "stroll", label: "Stroll", enter: () => ({ input: {}, eye: () => null }) }] }));
    try {
      const m = mount(newScene());
      await settle();
      // a scene made new: its maker holds the editor (the datatype's init says so)
      expect(m.local.get().hands.map((h) => h.kind)).toEqual(["edit"]);
      const api = exts["t.always"].api;
      expect(await runTemplate(api, "t.template")).toBe(true);
      await settle();
      expect(seen[0]).toEqual(expect.arrayContaining(["addObject", "change", "doc", "local", "newId", "notify", "registry", "repo", "scene"]));
      expect(api.doc().view.start).toEqual({ body: "stroll" });
      expect(running(m)).toEqual(["t.scene:scene", "t.edit:scene", "t.always:scene"]);
      expect(await runTemplate(api, "nope")).toBe(false);
      template = () => {
        throw new Error("no room");
      };
      expect(await runTemplate(api, "t.template")).toBe(false);
      expect(noticesOf(m).at(-1)).toMatchObject({ text: "That template failed: no room", kind: "error" });
    } finally {
      template = null;
    }
  });

  // spec {none, players 2|3|4} × value {untouched, each of 2/3/4, out of range, an extra key} → what create gets
  it("template(id, params): create gets exactly the params its metadata declares, coerced, defaults filled, other keys dropped; {} where it declares none", async () => {
    const PLAYERS = { key: "players", label: "Players", kind: "enum", options: [2, 3, 4].map((n) => ({ value: n, label: String(n) })), default: 2 };
    const got = { none: [], players: [] };
    template = (ctx, params) => void got.none.push(params);
    getRegistry("scene:template").register({ type: "scene:template", id: "t.players", name: "For some", params: [PLAYERS], load: async () => ({ create: (ctx, params) => void got.players.push(params) }) });
    const VALUES = [undefined, { players: 2 }, { players: 3 }, { players: 4 }, { players: 5 }, { players: 3, seats: 9 }];
    try {
      mount(newScene());
      await settle();
      const api = exts["t.always"].api;
      for (const v of VALUES) {
        expect(await runTemplate(api, "t.template", v)).toBe(true);
        expect(await runTemplate(api, "t.players", v)).toBe(true);
      }
      expect(got.none).toEqual(VALUES.map(() => ({})));
      expect(got.players).toEqual([{ players: 2 }, { players: 2 }, { players: 3 }, { players: 4 }, { players: 2 }, { players: 3 }]);
    } finally {
      template = null;
      getRegistry("scene:template").unregister("t.players");
    }
  });

  it("part(id, at): create(ctx, at) with the parent checked and the transform filled in; what it returns is selected", async () => {
    const seen = [];
    partCreate = async (ctx, at) => {
      seen.push({ keys: Object.keys(ctx).sort(), at, parentContent: ctx.content(at.parent ?? "") });
      const { url } = await ctx.file("t/block@1", () => ({ name: "block.glb", bytes: new Uint8Array([1, 2, 3]), extension: "glb", mimeType: "model/gltf-binary", hint: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } }));
      const id = ctx.newId("o");
      ctx.change((d) => {
        d.objects[id] = card({ name: "Block", sourceUrl: url, parent: at.parent, transform: at.transform });
        d.order.push(id);
      });
      return id;
    };
    try {
      const h = newScene({ objects: { hull: card({ name: "Hull", transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: 2 } }), g: { kind: "group", name: "G", visible: true, opacity: 1 } }, order: ["hull", "g"] });
      const m = mount(h);
      await settle();
      const api = exts["t.always"].api;
      const id = await part(api, "t.part", { parent: "hull", transform: { position: [1, 2, 3] } });
      expect(seen[0].keys).toEqual(CTX);
      // what it's dropped on can be read (a hull's stated bow), as api.content
      expect(seen[0].parentContent).toEqual(api.content("hull"));
      // and the same place in the world, for a part that would rather not ride along
      expect(seen[0].at).toEqual({ parent: "hull", transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 }, world: { position: [12, 4, 6], rotation: [0, 0, 0], scale: 2 } });
      expect(h.doc().objects[id]).toMatchObject({ name: "Block", parent: "hull" });
      expect(m.local.get().selected).toBe(id);
      // its writes are one step, the last made after its awaits: undo takes the block out; the file it made stays the scene's
      expect([editor(api).undo(), h.doc().objects[id], editor(api).labels().undo, !!h.doc().assets["t/block@1"]]).toEqual([true, undefined, null, true]);
      // a parent that's gone or a group: the scene root
      await part(api, "t.part", { parent: "nope", transform: {} });
      await part(api, "t.part", { parent: "g" });
      expect(seen.slice(1).map((s) => s.at.parent)).toEqual([null, null]);
      // nothing returned, or no such part: null, nothing selected anew
      partCreate = () => null;
      expect(await part(api, "t.part", null)).toBe(null);
      expect(await part(api, "nope", null)).toBe(null);
      partCreate = () => {
        throw new Error("no room");
      };
      expect(await part(api, "t.part", null)).toBe(null);
      expect(noticesOf(m).at(-1)).toMatchObject({ text: "That part failed: no room", kind: "error" });
    } finally {
      partCreate = null;
    }
  });

  it("ctx.file(key, make): one file doc per key, made once and remembered in doc.assets", async () => {
    const h = newScene();
    expect(h.doc().assets).toEqual({});
    mount(h);
    await settle();
    let made = 0;
    let ctx = null;
    template = (c) => {
      ctx = c;
    };
    try {
      await runTemplate(exts["t.always"].api, "t.template");
    } finally {
      template = null;
    }
    const make = async () => {
      made++;
      return { name: "buoy.glb", bytes: new Uint8Array([9]), extension: "glb", mimeType: "model/gltf-binary", hint: { bounds: { min: [0, 0, 0], max: [1, 2, 1] } } };
    };
    // two at once, then one later: one file
    const [a, b] = await Promise.all([ctx.file("t/buoy@1", make), ctx.file("t/buoy@1", make)]);
    const c = await ctx.file("t/buoy@1", make);
    expect(made).toBe(1);
    expect(a.url).toBe(b.url);
    expect(c).toEqual(a);
    expect(a.hint).toEqual({ bounds: { min: [0, 0, 0], max: [1, 2, 1] } });
    expect(h.doc().assets["t/buoy@1"]).toEqual({ url: a.url, hint: a.hint });
    const file = await repo.find(a.url);
    expect(file.doc()).toMatchObject({ "@patchwork": { type: "file" }, name: "buoy.glb", extension: "glb", mimeType: "model/gltf-binary" });
    // another key is another file
    const other = await ctx.file("t/mast@1", async () => ({ name: "mast.glb", bytes: new Uint8Array([1]), extension: "glb", mimeType: "model/gltf-binary" }));
    expect(other.url).not.toBe(a.url);
    expect(other.hint).toBe(null);
    expect(h.doc().assets["t/mast@1"]).toEqual({ url: other.url });
    await expect(ctx.file("", make)).rejects.toThrow();
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
    expect(await drop(api, { url: deck.url, doc: deck.doc(), handle: deck, group: null, at: null })).toBe(true);
    await settle();
    expect(dropped).toHaveLength(1);
    expect(dropped[0].ctx).toEqual(CTX);
    expect(editor(api).labels().undo).toBe("Add");
    expect(running(m)).toContain("t.dropped:scene");
    expect(await drop(api, { url: deck.url, doc: { "@patchwork": { type: "other" } } })).toBe(false);
  });

  it("addObject: a GLB file (a \"file\" source) becomes an object with no render doc, where it's asked to go", async () => {
    const h = newScene({ objects: { p: card(), g: { kind: "group", name: "G", visible: true, group: null } }, order: ["p", "g"] });
    mount(h);
    await settle();
    const api = exts["t.always"].api;
    const file = repo.add({ "@patchwork": { type: "file" }, name: "part.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array([1]) });
    expect((await api.providersFor(file.url, file.doc())).map((p) => p.id)).toEqual(["file-glb"]);
    const id = await add(api, file.url, { name: "Part", group: "g", before: "p", transform: { position: [1, 2, 3] } });
    const o = h.doc().objects[id];
    expect(o).toMatchObject({ name: "Part", sourceUrl: file.url, providerId: "file-glb", renderUrl: null, group: "g", parent: null });
    expect(o.transform).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 });
    expect(h.doc().order).toEqual([id, "p", "g"]);
    const attached = await add(api, file.url, { parent: "p" });
    expect(h.doc().objects[attached].parent).toBe("p");
    // an id made beforehand (a copy maps its ids first): that one, and never one the scene has
    const mine = api.newId("o");
    expect(await add(api, file.url, { id: mine })).toBe(mine);
    expect(h.doc().objects[mine]).toMatchObject({ sourceUrl: file.url, visible: true, wireframe: false });
    await expect(add(api, file.url, { id: "p" })).rejects.toThrow(/already has an object/);
    expect(h.doc().objects.p).toEqual(card());
    await expect(add(api, "not a url")).rejects.toThrow(/automerge URL/);
    // (a scene in itself is a link its expansion closes, a cycle: links.test.js)
    const txt = repo.add({ "@patchwork": { type: "essay" } });
    await expect(add(api, txt.url)).rejects.toThrow(/No scene provider/);
  });

  it("schedule(fn) runs in the next flush", async () => {
    mount(newScene());
    await settle();
    const fn = vi.fn();
    exts["t.always"].api.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    await settle();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a notice is the notifier's: from a running extension as it says, else the caller's", async () => {
    const m = mount(newScene());
    await settle();
    const api = exts["t.always"].api;
    api.use("notices").notify("Hello", "error", { from: "t.edit" });
    api.use("notices").notify("Hi", "info", { from: "t.nobody" });
    expect(noticesOf(m).slice(-2)).toMatchObject([{ text: "Hello", kind: "error", from: "t.edit" }, { text: "Hi", from: "t.always" }]);
  });

  it("offers the holders nearest first, the scene last of them, every doc's part among the scene's (STAGE.md, “The input chain”)", async () => {
    const offered = [];
    const pass = (id) => () => ({ input: { click: (ev) => (offered.push([id, ev.holder, ev.hit?.id ?? null]), null) } });
    for (const id of ["t.scene", "t.far", "t.near", "t.always"]) exts[id] = recorder(id, pass(id));
    const h = newScene({
      traits: { "t.scene": {} },
      objects: { p: card({ traits: { "t.far": {} } }), c: card({ parent: "p", traits: { "t.near": {} } }) },
      order: ["p", "c"],
      view: { start: { body: "look" } }, // the chain alone: in Edit a click goes to Select first
    });
    const m = mount(h);
    await settle();
    // running order puts the scene's first and far before near: the chain mustn't
    expect(running(m).filter((r) => r !== "t.edit:scene")).toEqual(["t.scene:scene", "t.always:scene", "t.far:objects", "t.near:objects"]);
    const canvas = m.root.querySelector(".canvas");
    const vp = m.debug.viewport;
    const click = (id) => {
      vp.pick = () => (id ? { id, point: [0, 0, 0], normal: null, distance: 1, snapped: false } : null);
      const opts = { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0, pointerId: 1, pointerType: "mouse" };
      canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    };
    click("c");
    expect(offered.splice(0)).toEqual([
      ["t.near", "c", "c"],
      ["t.far", "p", "c"],
      ["t.scene", null, "c"],
      ["t.always", null, "c"],
    ]);
    click(null);
    expect(offered.splice(0)).toEqual([
      ["t.scene", null, null],
      ["t.always", null, null],
    ]);
  });

  it("bodies: entering pushes one over Look (local.body says which), the editor held on; its keys are its; its extension stopping pops it", async () => {
    const order = [];
    const left = [];
    exts["t.edit"] = recorder("t.edit", () => ({
      bodies: [
        {
          id: "walk",
          label: "Walk",
          keys: [{ code: "KeyW", label: "Forward" }],
          lock: false,
          reach: 2,
          enter: (place) => ({ input: { key: (ev) => (order.push(["walk", ev.key, place]), true) }, eye: () => ({ position: [1, 2, 3], direction: [0, 0, -1] }), leave: () => left.push("walk") }),
        },
        { id: "nowhere", label: "Nowhere", enter: () => null },
      ],
    }));
    exts["t.always"] = recorder("t.always", (api) => ({ input: { key: (ev) => (order.push(["always", ev.key]), true) } }));
    const m = mount(newScene());
    await settle();
    const api = m.debug.host.record("t.always").api;
    expect(m.local.get().body).toMatchObject({ id: "look", label: "Look", depth: 0, reach: Infinity });
    expect(api.body.enter("nowhere")).toBe(false);
    expect(api.body.enter("missing")).toBe(false);
    expect(api.body.enter("walk", "here")).toBe(true);
    expect(m.local.get().body).toMatchObject({ id: "walk", label: "Walk", ext: "t.edit", depth: 1, reach: 2, keys: [{ code: "KeyW", label: "Forward" }] });
    expect(api.body.eye()).toEqual({ position: [1, 2, 3], direction: [0, 0, -1] });
    expect(m.debug.view.stage(0).reader.context(null)).toMatchObject({ from: [1, 2, 3], reach: 2 });
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true }));
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }));
    // the body's extension stops (uninstalled): its body goes with it
    uninstall("t.edit");
    await settle();
    // walking was over Look, and Look is what's left; the editor was held throughout
    expect(m.local.get().body).toMatchObject({ id: "look", label: "Look", depth: 0 });
    expect(m.local.get().hands.map((h) => h.kind)).toEqual(["edit"]);
    expect(left).toEqual(["walk"]);
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true }));
    expect(order).toEqual([
      ["walk", "w", "here"],
      ["always", "b"],
      ["always", "w"],
    ]);
  });

  // H1: what runs is the doc's. Over three fixture docs (nothing, a scene
  // trait, an object trait), every change this viewer can make that isn't
  // the doc (entering and leaving a body, holding and putting down a tool,
  // selecting, a pref, pausing and resuming the clock: a doc change that
  // carries no trait) starts and stops nothing.
  it("H1: no change to body, held tool, selection, prefs or clock starts or stops anything", async () => {
    const docs = [{}, { traits: { "t.scene": {} } }, { objects: { a: card({ traits: { "t.obj": {} } }) }, order: ["a"] }];
    for (const fixture of docs) {
      for (const id of Object.keys(exts)) exts[id] = recorder(id);
      exts["t.edit"] = recorder("t.edit", () => ({
        bodies: [{ id: "stroll", label: "Stroll", enter: () => ({ input: {}, eye: () => null }) }],
        commands: [{ id: "gun", name: "Gun", tool: { keys: [] }, run: () => ({}) }],
      }));
      forgetModules();
      const m = mount(newScene(fixture));
      await settle();
      const before = running(m);
      const starts = () => Object.values(exts).reduce((n, r) => n + r.apis.length + r.disposed, 0);
      const was = starts();
      const api = exts["t.always"].api;
      const acts = [
        () => api.body.enter("stroll"),
        () => api.run({ ext: "t.edit", command: "gun" }),
        () => m.local.swap((v) => ({ ...v, selected: "a" })),
        () => api.use("prefs").set("grid", false),
        () => api.change((d) => void (d.clock.running = false)),
        () => api.change((d) => void (d.clock.running = true)),
        () => api.run({ ext: "t.edit", command: "gun" }),
        () => api.body.leave(),
        () => m.local.swap((v) => ({ ...v, selected: null })),
      ];
      for (const act of acts) {
        act();
        await settle();
        expect(running(m)).toEqual(before);
        expect(starts()).toBe(was);
      }
    }
  });

  it("a tool command's run puts it on top of the hands, over whatever is held; running it again puts down that one, wherever it is; Escape the top one", async () => {
    const put = [];
    exts["t.always"] = recorder("t.always", () => ({
      commands: [
        { id: "gun", name: "Gun", key: "g", tool: { keys: [{ code: "KeyR", label: "Reload" }] }, run: () => ({ put: () => put.push("gun") }) },
        { id: "brush", name: "Brush", tool: { pointer: true }, run: () => ({ put: () => put.push("brush") }) },
      ],
    }));
    const m = mount(newScene());
    await settle();
    const api = m.debug.host.record("t.always").api;
    const names = () => m.local.get().held.map((t) => t.command);
    // (not editing: the Edit hand wants the pointer too)
    m.debug.view.plugins.record("scene.edit").api.run({ ext: "scene.edit", command: "edit", value: false });
    expect(api.run({ ext: "t.always", command: "gun" })).toBe(true);
    expect(m.local.get().held).toEqual([{ ext: "t.always", command: "gun", name: "Gun", handKind: null, keys: [{ code: "KeyR", label: "Reload" }], pointer: false, serial: expect.any(Number) }]);
    const serials = [m.local.get().held[0].serial];
    expect(m.local.get().pointer.wanted).toBe(false);
    // another tool goes on top: the gun stays held
    api.run({ ext: "t.always", command: "brush" });
    serials.push(m.local.get().held[1].serial);
    expect(put).toEqual([]);
    expect(names()).toEqual(["gun", "brush"]);
    expect(m.local.get().pointer.wanted).toBe(true);
    // the gun again puts the gun down, from under the brush
    api.run({ ext: "t.always", command: "gun" });
    expect(put).toEqual(["gun"]);
    expect(names()).toEqual(["brush"]);
    // value true only picks up (held: nothing), false only puts down (not held: nothing)
    api.run({ ext: "t.always", command: "brush", value: true });
    api.run({ ext: "t.always", command: "gun", value: false });
    expect([put, names()]).toEqual([["gun"], ["brush"]]);
    api.run({ ext: "t.always", command: "brush" });
    expect(put).toEqual(["gun", "brush"]);
    expect(m.local.get().held).toEqual([]);
    api.run({ ext: "t.always", command: "gun" });
    api.run({ ext: "t.always", command: "brush" });
    serials.push(m.local.get().held[0].serial);
    // Escape puts down the top one only
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    expect([put, names()]).toEqual([["gun", "brush", "brush"], ["gun"]]);
    // a tool held directly, not through a command: its declaration, and no command; on top of the gun
    const putDown = api.hold({ name: "Drawn piece", keys: [{ code: "KeyQ", label: "Turn" }], pointer: true }, { put: () => put.push("piece") });
    expect(m.local.get().held[1]).toEqual({ ext: "t.always", command: null, name: "Drawn piece", handKind: null, keys: [{ code: "KeyQ", label: "Turn" }], pointer: true, serial: expect.any(Number) });
    serials.push(m.local.get().held[1].serial);
    // each tool held is its own (the gun held again is a new one)
    expect(new Set(serials).size).toBe(4);
    putDown();
    expect([put, names()]).toEqual([["gun", "brush", "brush", "piece"], ["gun"]]);
    m.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    expect([put, m.local.get().held]).toEqual([["gun", "brush", "brush", "piece", "gun"], []]);
    // one with no name isn't a tool
    api.hold({}, { put() {} });
    expect(m.local.get().held).toEqual([]);
  });

  it("a reach: true command runs only within the body's reach; Look reaches everything", async () => {
    const ran = [];
    exts["t.always"] = recorder("t.always", () => ({
      bodies: [{ id: "walk", label: "Walk", reach: 2, enter: () => ({ input: {}, eye: () => ({ position: [0, 0, 0], direction: [0, 0, -1] }), leave() {} }) }],
      commands: [{ id: "open", name: "Open", reach: true, state: (t) => (t === "a" ? {} : null), run: (t, _v, ctx) => ran.push([t, ctx.hit?.distance ?? null, ctx.reach]) }],
    }));
    const m = mount(newScene({ objects: { a: card({ transform: { position: [0, 0, -5], rotation: [0, 0, 0], scale: 1 } }) }, order: ["a"] }));
    await settle();
    const api = m.debug.host.record("t.always").api;
    expect(api.run({ ext: "t.always", command: "open", target: "a" })).toBe(true);
    api.body.enter("walk");
    // with a hit, its distance; without, from the eye to the target (its origin, with no box drawn)
    expect(api.run({ ext: "t.always", command: "open", target: "a", hit: { id: "a", distance: 1.5 } })).toBe(true);
    expect(api.run({ ext: "t.always", command: "open", target: "a", hit: { id: "a", distance: 2.5 } })).toBe(false);
    expect(api.run({ ext: "t.always", command: "open", target: "a" })).toBe(false);
    expect(m.debug.view.stage(0).reader.context(null).distance("a")).toBeCloseTo(5);
    // run gets the context its state was asked in
    expect(ran).toEqual([
      ["a", null, Infinity],
      ["a", 1.5, 2],
    ]);
  });

  // keyboard focus comes back to the view when what held it goes or is
  // blurred in place, unless the press that took it was outside
  it("focus left for nowhere comes back to the root, unless the press was outside: a clicked button that went away; one blurred while connected (Chrome, when it's moved); one blurred after a press outside", async () => {
    const m = mount(newScene());
    await settle();
    const ROWS = [
      ["clicked, then gone", (b) => (b.addEventListener("click", () => b.remove()), b.click()), true],
      ["blurred in place", (b) => b.blur(), true],
      ["a press outside, then blurred", (b) => (document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })), b.blur()), false],
    ];
    for (const [how, act, back] of ROWS) {
      const button = document.createElement("button");
      m.root.append(button);
      button.focus();
      act(button);
      await settle();
      expect([how, document.activeElement === m.root]).toEqual([how, back]);
      button.remove();
      m.root.focus();
    }
  });

  it("widgetAt: the widget's owner is offered the press first; its open session keeps it busy", async () => {
    const got = [];
    exts["t.edit"] = recorder("t.edit", () => ({
      input: {
        widgetAt: () => ({ onTop: true, handle: "h1" }),
        press: (ev) => (got.push(["edit", ev.widget.handle, ev.widget.owner]), { move() {}, end() {}, cancel: () => got.push(["cancel"]) }),
      },
    }));
    exts["t.always"] = recorder("t.always", () => ({ input: { press: () => (got.push(["always"]), {}) } }));
    const m = mount(newScene());
    await settle();
    const canvas = m.root.querySelector(".canvas");
    const opts = { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0, pointerId: 1, pointerType: "mouse" };
    expect(m.debug.busy("t.edit")).toBe(false);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
    expect(got).toEqual([["edit", "h1", "t.edit"]]);
    expect(m.debug.busy("t.edit")).toBe(true);
    // released under the slop with no tap: cancelled, and no longer busy
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
    expect(got.at(-1)).toEqual(["cancel"]);
    expect(m.debug.busy("t.edit")).toBe(false);
  });
});

describe("two stages on one scene", () => {
  // one handle, its broadcasts delivered as ephemeral messages to everyone listening
  function shared(extra) {
    const h = newScene(extra);
    h.broadcast = (message) => h.emit("ephemeral-message", { message });
    return h;
  }

  // (the only mounted test of a landed release settling when the doc agrees: native/poses.js sameTransform)
  it("a peer's hold shows here, and its landed release lets go once this view's doc agrees", async () => {
    const h = shared({ traits: { "t.scene": {} }, objects: { a: card() }, order: ["a"] });
    const A = mount(h, "viewer:alice");
    await settle();
    const apiA = exts["t.scene"].api;
    // the second mount gets its own instances
    exts["t.scene"] = recorder("t.scene");
    forgetModules();
    const B = mount(h, "viewer:bob");
    await settle();
    const apiB = exts["t.scene"].api;
    // A holds the card: B shows it there
    apiA.use("poses").hold("a", { position: [1, 2, 3] });
    await until(() => B.debug.viewport.poses.has("a"));
    expect(B.debug.viewport.poses.get("a").position).toEqual([1, 2, 3]);
    expect(apiB.use("poses").heldBy("a")).toBe(A.debug.presence.session);
    // A puts it down: the doc, then a landed release; B lets go once its doc agrees
    h.change((d) => {
      d.objects.a.transform = { position: [1, 2, 3], rotation: [0, 0, 0], scale: 1 };
    });
    apiA.use("poses").release("a", { landed: true });
    await until(() => !B.debug.viewport.poses.has("a"));
    expect(apiB.use("poses").heldBy("a")).toBeNull();
  });

  it("a hold dropped by the extension stopping is put back on the peer", async () => {
    const h = shared({ objects: { a: card() }, order: ["a"] });
    const A = mount(h, "viewer:alice");
    await settle();
    const apiA = exts["t.edit"].api;
    exts["t.edit"] = recorder("t.edit");
    forgetModules();
    const B = mount(h, "viewer:bob");
    await settle();
    apiA.use("poses").hold("a", { position: [5, 0, 0] });
    await until(() => B.debug.viewport.poses.has("a"));
    // A's extension stops (uninstalled): the hold is released as a put-back
    uninstall("t.edit");
    await until(() => !B.debug.viewport.poses.has("a"));
    expect(A.debug.viewport.poses.has("a")).toBe(false);
  });
});

describe("another view's hold, played back", () => {
  // A peer's poses, injected with the peer's clock stamps; our clock is Date.now, pinned.
  let clockNow = 0;
  const T = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });
  const x = (m) => m[12]; // a world matrix's x translation (column-major)
  // a peer's pose, as scene.poses sends it on the channel
  let n = 0;
  const say = (h, data, session = "peer") => h.emit("ephemeral-message", { message: { type: SEND, session, viewer: `viewer:${session}`, ext: "scene.poses", kind: "pose", n: ++n, data } });
  const tick = (M, t) => M.debug.host.instanceOf("scene.poses").tick(t);

  it("worldOf (and what's attached) follows what's shown of a peer's stream, not the doc", async () => {
    const h = newScene({ objects: { hull: card({ name: "Hull" }), deck: card({ name: "Deck", parent: "hull", transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: 1 } }) }, order: ["hull", "deck"] });
    const M = mount(h, "viewer:me", { time: wallAt(() => clockNow) });
    await settle();
    const api = exts["t.edit"].api;
    // the sender's clock reads 0 when ours reads 1000; it sends every 50 ms (smooth.test.js has the curve)
    let seq = 0;
    const pose = (at, transform) => {
      clockNow = at + 1000;
      say(h, { id: "hull", parent: null, transform, since: 1, seq: ++seq, at, every: 50 });
    };
    pose(0, T(0));
    pose(50, T(1));
    pose(100, T(2));
    tick(M, 1130);
    const shown = M.debug.viewport.poses.get("hull").position[0];
    expect(shown).toBeGreaterThan(0);
    expect(x(api.worldOf("hull"))).toBeCloseTo(shown);
    // the deck rides on the hull as it's drawn, not as the doc has it
    const deck = api.worldOf("deck");
    expect([deck[12], deck[13], deck[14]].map((v) => +v.toFixed(6))).toEqual([+shown.toFixed(6), 1, 0]);
    expect(x(api.scene().world("deck"))).toBe(0);
  });

});

