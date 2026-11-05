// Mount the stage with some extensions, for an extension's tests (no WebGL).
//
//   vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
//   import { mountStage } from "../test/stage-harness.js";
//   const s = await mountStage({ extensions: [{ meta: { id: "scene.select" }, module }], doc: { objects: {…} } });
//   s.local.get().selected; s.api("scene.select"); s.press(...); s.unmount();
//
// `extensions` are [{ meta, module }]: meta is the scene:extension plugin's
// metadata (without load), module what its load() resolves to. They are
// registered in that order, which is the order the general ones run in. An
// extension that declares no traits runs in every scene. The scene's own
// datatypes and sources are registered too, and `templates` are
// [{ meta, module }] for scene:template plugins.
//
// To see something stop when this viewer switches activity, give it
// `activities: ["edit"]`, mount PLAY alongside (it offers "play") and call
// s.activity("play").

import { FakeRepo, flush } from "./fake-repo.js";
import { getRegistry, resetRegistries } from "./plugins-mock.js";

export { flush };

/** An extension that does nothing but offer the "play" activity, so a test can switch to it. */
export const PLAY = Object.freeze({ meta: { id: "t.play", activities: ["play"] }, module: { create: () => ({}) } });

export const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await flush();
};

export async function until(fn, ms = 1000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
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
 * @param {{ extensions?: { meta: object, module: object }[], templates?: { meta: object, module: object }[], doc?: object, repo?: FakeRepo, handle?: object, viewerId?: string }} o
 */
export async function mountStage({ extensions = [], templates = [], doc = {}, repo, handle, viewerId } = {}) {
  repo ??= new FakeRepo();
  if (!handle) {
    resetRegistries();
    const { plugins } = await import("../index.js");
    for (const p of plugins) if (p.type === "scene:source" || p.type === "patchwork:datatype") getRegistry(p.type).register(p);
    for (const { meta, module } of extensions) getRegistry("scene:extension").register({ type: "scene:extension", name: meta.id, ...meta, load: async () => module });
    for (const { meta, module } of templates) getRegistry("scene:template").register({ type: "scene:template", name: meta.id, ...meta, load: async () => module });
    const { SceneDatatype } = await import("../datatype.js");
    const init = {};
    SceneDatatype.init(init);
    handle = repo.add({ "@patchwork": { type: "scene" }, ...init, ...doc, view: { ...init.view, ...(doc.view ?? {}) } });
  }
  const { default: Stage } = await import("../stage/stage.js");
  const element = document.createElement("div");
  element.repo = repo;
  if (viewerId) element.viewerId = viewerId;
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
    local: debug.local,
    host: debug.host,
    /** the api an extension got */
    api: (id) => debug.host.record(id)?.api ?? null,
    instance: (id) => debug.host.instanceOf(id),
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
    /** switch this viewer's activity, and let what it starts settle */
    async activity(id) {
      s.local.swap((m) => ({ ...m, activity: id }));
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
