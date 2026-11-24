// Mount the stage with some extensions, for an extension's tests (no WebGL).
//
//   vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
//   import { mountStage } from "../test/stage-harness.js";
//   const s = await mountStage({ extensions: [{ meta: { id: "scene.select" }, module }], doc: { objects: {…} } });
//   s.local.get().selected; s.api("scene.select"); s.press(...); s.unmount();
//
// `extensions` are [{ meta, module }]: meta is the plugin's metadata
// (without load), module what its load() resolves to. One of the scene's own
// parts registers as src/index.js says (a scene:view, or carry's and others'
// scene:extension); a test's own is a scene:extension, and one that declares
// no traits is a part of every doc (traits ["*"]), unless its meta says
// `type: "scene:view"`. They are registered in that order, which is the
// order the view plugins run in.
// Nothing else runs unless the test asks: `editor: true` registers the
// editor's hand (scene.edit) after them (s.edit(on) picks it up or puts it
// down), and `natives: true` the native services last (or a list of their
// ids, NATIVES). A kernel test brings small plugins of its own instead
// (src/test/links.js opens linked docs). The scene's own datatypes and
// sources are registered too, `templates` are
// [{ meta, module }] for scene:template plugins and `parts` the same for
// scene:part plugins.

import { FakeRepo, flush } from "./fake-repo.js";
import { emptyScene } from "./empty-scene.js";
import { realTime } from "../stage/time.js";
import { getRegistry, resetRegistries } from "./plugins-mock.js";
import { holding } from "../stage/bodies.js";
const editing = (view) => holding(view, "edit");

export { flush };

/**
 * Let a stage's work land: a flush (fake-repo.js), which returns only once
 * nothing is due now. A stage's flush is a microtask or its next frame, and
 * what it sets off is a promise, a frame or a timer set for now, so once none
 * is pending, what a change causes has landed. Time is stepped (manualTime),
 * not waited for.
 */
export const settle = () => flush();

/** Flush until fn() holds, failing after `ms` of the wall (performance.now: a test may fake Date and timers). */
export async function until(fn, ms = 1000) {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error("timed out");
    await flush();
  }
}

/** An object as the scene doc stores it. */
export const object = (extra = {}) => ({
  name: "Object",
  sourceUrl: null,
  providerId: "file-glb",
  renderUrl: null,
  parent: null,
  group: null,
  visible: true,
  color: null,
  opacity: 1,
  wireframe: false,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  ...extra,
});

/**
 * @param {{ extensions?: { meta: object, module: object }[], templates?: { meta: object, module: object }[], parts?: { meta: object, module: object }[], doc?: object, repo?: FakeRepo, handle?: object, viewerId?: string, packageSettleMs?: number }} o
 */
/** A stage's time (stage/time.js) whose now() is `get()`: the browser's frames and timers, a wall the test sets. */
export function wallAt(get) {
  const real = realTime();
  return Object.freeze({ manual: false, now: get, frame: real.frame, after: real.after });
}

/** How a test's extension registers: [type, meta] (see the header). */
async function asRegistered(meta) {
  const { plugins } = await import("../index.js");
  const own = plugins.find((p) => p.id === meta.id && (p.type === "scene:view" || p.type === "scene:extension"));
  const type = meta.type ?? own?.type ?? "scene:extension";
  const traits = type === "scene:extension" && !(Array.isArray(meta.traits) && meta.traits.length) ? ["*"] : meta.traits;
  const { load: _load, ...declared } = own ?? {}; // (what it provides and uses, as src/index.js declares)
  return [type, { ...declared, ...meta, ...(traits ? { traits } : {}) }];
}

// the view's keys (stage/view.js), and those of them that are paths
const VIEW_KEYS = new Set(["hovered", "selected", "body", "hands", "held", "gesture", "pointer", "escape", "theme", "focus"]);
const PATHS = new Set(["hovered", "selected"]);

/** The native services' ids (src/index.js): registered last when a test asks (`natives`). */
export const NATIVES = ["scene.claims", "scene.poses", "scene.audience", "scene.clock", "scene.telling", "scene.notices", "scene.prefs", "scene.drawer", "scene.links"];

/** A scene.poses in place of the native one, its facet `stub`'s hold, release and heldBy as they are when called (a test may swap them). */
export const posesBy = (stub) => ({ meta: { id: "scene.poses" }, module: { create: () => ({ provides: { poses: () => ({ hold: (...a) => stub.hold(...a), release: (...a) => stub.release(...a), heldBy: (...a) => stub.heldBy(...a) }) } }) } });

/**
 * Import the plugins every mount registers (the natives, the scene's sources
 * and datatypes) once per test file, before the first: a dynamic import is a
 * round trip to vitest's module server, real time a flush doesn't wait for.
 * Loaded, a plugin's load() is microtasks.
 */
let preloaded = null;
const preload = () =>
  (preloaded ??= import("../index.js").then(({ plugins }) =>
    Promise.all(plugins.filter((p) => NATIVES.includes(p.id) || p.type === "scene:source" || p.type === "patchwork:datatype").map((p) => Promise.resolve(p.load?.()).catch(() => null))),
  ));

export async function mountStage({ extensions = [], templates = [], parts = [], doc = {}, repo, handle, viewerId, packageSettleMs = 0, time = null, editor = false, natives = false } = {}) {
  repo ??= new FakeRepo();
  await preload();
  if (!handle) {
    resetRegistries();
    const { plugins } = await import("../index.js");
    for (const p of plugins) if (p.type === "scene:source" || p.type === "patchwork:datatype") getRegistry(p.type).register(p);
    const all = editor && !extensions.some((x) => x.meta.id === "scene.edit") ? [...extensions, { meta: { id: "scene.edit" }, module: (await import("../parts/edit.js")).default }] : extensions;
    for (const { meta: m, module } of all) {
      const [type, meta] = await asRegistered(m);
      getRegistry(type).register({ type, name: meta.id, ...meta, load: async () => module });
    }
    // the native services last: providers start first whatever the registry order (STAGE.md, "Activation")
    const wanted = natives === true ? NATIVES : Array.isArray(natives) ? natives : [];
    for (const p of plugins) if (wanted.includes(p.id) && !extensions.some((x) => x.meta.id === p.id)) getRegistry(p.type).register(p);
    for (const { meta, module } of templates) getRegistry("scene:template").register({ type: "scene:template", name: meta.id, ...meta, load: async () => module });
    for (const { meta, module } of parts) getRegistry("scene:part").register({ type: "scene:part", name: meta.id, ...meta, load: async () => module });
    handle = repo.add(emptyScene(doc));
  }
  const { default: Stage } = await import("../stage/stage.js");
  const element = document.createElement("div");
  element.repo = repo;
  if (viewerId) element.viewerId = viewerId;
  if (time) element.time = time;
  // (no waiting for the registry to go quiet before packages are offered, unless a test asks)
  element.packageSettleMs = packageSettleMs;
  document.body.append(element);
  const cleanup = Stage(handle, element);
  const root = element.querySelector(".scene-stage");
  const debug = root.__sceneDebug;
  await settle();
  const canvas = root.querySelector("canvas");
  const port = canvas?.parentElement;
  const s = {
    repo,
    handle,
    element,
    root,
    debug,
    canvas,
    port,
    // the outermost stage's atom and the view's as it sees it, read as one; a
    // swap's changes go where each key lives (the selection and hover as
    // paths of the outermost stage's)
    local: Object.freeze({
      get: debug.local.get,
      swap(fn) {
        const before = debug.local.get();
        const next = fn(before);
        if (next === before) return;
        debug.view.atom.swap((v) => {
          let o = v;
          for (const k of VIEW_KEYS) if (next[k] !== before[k]) o = { ...o, [k]: PATHS.has(k) ? (next[k] == null ? null : Object.freeze([next[k]])) : next[k] };
          return o;
        });
        debug.stageLocal.swap((m) => {
          let o = m;
          for (const k of Object.keys(next)) if (!VIEW_KEYS.has(k) && next[k] !== before[k]) o = { ...o, [k]: next[k] };
          return o;
        });
      },
      watch: (fn) => debug.stageLocal.watch(fn),
    }),
    host: debug.host,
    /** the api an extension of the outermost stage, or a view plugin, got */
    api: (id) => debug.host.record(id)?.api ?? debug.view.plugins.record(id)?.api ?? null,
    instance: (id) => debug.host.instanceOf(id) ?? debug.view.plugins.instanceOf(id),
    /** what scene.notices shows: [{ id, text, kind, at, from }] */
    notices: () => debug.view.plugins.instanceOf("scene.notices")?.notices ?? [],
    /** scene.drawer's docked elements in tab order, and the one shown */
    drawer: () => debug.view.plugins.instanceOf("scene.drawer")?.panes() ?? { order: [], shown: null },
    /** a view plugin's facet of the focus stage (its api.focus()) */
    facet: (id) => debug.view.plugins.record(id)?.api?.focus() ?? null,
    /** pick up the editor (scene.edit's Edit hand) or put it down; → whether the viewer is editing now */
    edit: (on = true) => {
      debug.view.plugins.record("scene.edit")?.api.run({ ext: "scene.edit", command: "edit", target: null, value: !!on });
      return editing(debug.view.atom.get());
    },
    doc: () => handle.doc(),
    change: (fn) => handle.change(fn),
    settle,
    /** dispatch a pointer event on the canvas (port-local x, y) */
    pointer(type, x, y, extra = {}) {
      const rect = canvas.getBoundingClientRect();
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, pointerType: "mouse", ...extra });
      canvas.dispatchEvent(e);
      return e;
    },
    /** a press and release in place: a click */
    click(x = 10, y = 10, extra) {
      s.pointer("pointerdown", x, y, extra);
      s.pointer("pointerup", x, y, extra);
    },
    /** uninstall an extension (it stops at once, in every stage of this test), and let that settle */
    async uninstall(id) {
      for (const type of ["scene:extension", "scene:view"]) if (getRegistry(type).has?.(id)) getRegistry(type).unregister(id);
      await settle();
    },
    key(key, extra = {}) {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: extra.code ?? `Key${key.toUpperCase()}`, ...extra });
      root.dispatchEvent(e);
      root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key, code: extra.code ?? `Key${key.toUpperCase()}`, ...extra }));
      return e;
    },
    unmount() {
      cleanup();
      element.remove();
    },
  };
  return s;
}
