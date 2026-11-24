// @vitest-environment happy-dom
// Members of the kernel's contract (STAGE.md) checked on a mounted stage with
// small plugins of the test's own: `api.loop` renders every frame while it
// runs and caps dt ("`api`"); `api.box` of each kind of target; the one stop rule (H2, "Stopping"); what wants
// the pointer (H5); keys in an embedded document are its own ("Keys"); and
// `api.page` ("`api`").
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));

// happy-dom has no WebGL. A test that asks (`gl.on`) gets a renderer that
// draws nothing and counts its passes, so the viewport's frames (what it
// renders, and when) run as they do in a browser; every other test gets none,
// as happy-dom gives.
const gl = vi.hoisted(() => ({ on: false }));
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal();
  function WebGLRenderer() {
    if (!gl.on) throw new Error("no WebGL here");
    const r = {
      domElement: document.createElement("canvas"),
      info: { autoReset: true, reset() {}, render: { calls: 0, triangles: 0, lines: 0, points: 0 }, memory: { geometries: 0, textures: 0 } },
      shadowMap: {},
      autoClear: true,
      outputColorSpace: null,
    };
    for (const k of ["setPixelRatio", "setSize", "setClearColor", "setScissorTest", "setViewport", "clearDepth", "render", "dispose", "forceContextLoss"]) r[k] = () => {};
    return r;
  }
  function PMREMGenerator() {
    return { fromScene: () => ({ texture: { dispose() {} } }), dispose() {} };
  }
  return { ...three, WebGLRenderer, PMREMGenerator };
});

import { mountStage, object } from "../test/stage-harness.js";
import { manualTime } from "./time.js";
import { LINGER_MS, BUSY_RECHECK_MS } from "./host.js";
import { EMBED_ATTR } from "../embed.js";

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  gl.on = false;
  vi.restoreAllMocks();
});
const mount = async (o) => {
  const s = await mountStage(o);
  mounted.push(s);
  return s;
};

/** An extension that keeps its api in `seen.api` (and counts its creates and disposes). */
function keeper(id, meta = {}, instance = () => ({})) {
  const seen = { api: null, creates: 0, disposes: 0 };
  const ext = {
    meta: { id, ...meta },
    module: {
      create(api) {
        seen.api = api;
        seen.creates++;
        return { ...instance(api), dispose: () => seen.disposes++ };
      },
    },
  };
  return { ext, seen };
}

describe("api.loop (API.md, “`api`”)", () => {
  it("while a loop runs the stage renders every frame; a quiet stage renders none; after its cancel, frames stop rendering", async () => {
    gl.on = true;
    const time = manualTime({ yieldTo: () => Promise.resolve() });
    const { ext, seen } = keeper("t.loop");
    const s = await mount({ extensions: [ext], time });
    expect(s.debug.viewport.ok).toBe(true);
    const renders = () => s.debug.stats().render.frames;
    // whatever opening drew, it's drawn: a quiet stage then renders nothing
    await time.step(5);
    let r0 = renders();
    for (let i = 0; i < 5; i++) time.tick();
    expect(renders()).toBe(r0);
    // a loop: every frame renders, and the loop runs once a frame with that frame's dt
    const dts = [];
    const cancel = seen.api.loop((dt) => dts.push(dt));
    r0 = renders();
    for (let i = 1; i <= 5; i++) {
      time.tick();
      expect([i, renders() - r0]).toEqual([i, i]);
    }
    expect(dts.length).toBe(5);
    for (const dt of dts) expect(dt).toBeCloseTo(time.frameMs / 1000, 9);
    // cancelled: no more renders, no more calls
    cancel();
    time.tick();
    r0 = renders();
    for (let i = 0; i < 5; i++) time.tick();
    expect([renders() - r0, dts.length]).toEqual([0, 5]);
  });

  it("dt is capped at 0.1 s however long it has been since the last frame", async () => {
    // frames a second apart: each is a stall a loop must not take as one step
    const time = manualTime({ frameMs: 1000, yieldTo: () => Promise.resolve() });
    const { ext, seen } = keeper("t.loop");
    const s = await mount({ extensions: [ext], time });
    expect(s.api("t.loop")).toBe(seen.api);
    const dts = [];
    seen.api.loop((dt) => dts.push(dt));
    for (let i = 0; i < 4; i++) time.tick();
    expect(dts.length).toBe(4);
    expect(dts.every((dt) => dt >= 0 && dt <= 0.1)).toBe(true);
    // (measured from the last frame all the same: once there is one, the cap is what it gets)
    expect(dts.slice(1)).toEqual([0.1, 0.1, 0.1]);
  });
});

describe("api.box (API.md, “`api`”)", () => {
  it("one box for an object, a group (its members') and the scene (null), in the stage's frame; nothing for an id it lacks", async () => {
    gl.on = true;
    // (no provider: each is drawn as its hint)
    const unit = { bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
    const at = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });
    const doc = {
      objects: {
        a: object({ name: "A", providerId: null, hint: unit }),
        g: { kind: "group", name: "G", group: null, visible: true },
        b: object({ name: "B", providerId: null, group: "g", hint: unit, transform: at(2) }),
        c: object({ name: "C", providerId: null, group: "g", hint: unit, transform: at(4) }),
      },
      order: ["a", "g", "b", "c"],
    };
    const { ext, seen } = keeper("t.box");
    await mount({ extensions: [ext], doc });
    const box = (t) => ((b) => b && { min: b.min.map((v) => +v.toFixed(9)), max: b.max.map((v) => +v.toFixed(9)) })(seen.api.box(t));
    expect([box("a"), box("g"), box(null), box("gone")]).toEqual([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [2, 0, 0], max: [5, 1, 1] },
      { min: [0, 0, 0], max: [5, 1, 1] },
      null,
    ]);
  });
});

describe("H2: the one stop rule (STAGE.md, “Stopping”)", () => {
  const T = "t.ling";
  const doc = { objects: { a: object({ name: "A", traits: { [T]: {} } }) }, order: ["a"] };
  const unwant = (s) => s.change((d) => void delete d.objects.a.traits[T]);
  const state = (s) => s.host.record(T)?.state ?? "stopped";

  /** t.ling (a trait on `a`) with a seat it offers; t.keep, which says t.ling is busy while `keep` holds it. */
  async function lingering() {
    const keep = new Set();
    const ling = keeper(T, { traits: [T] }, () => ({ bodies: [{ id: "t.seat", label: "Seat", enter: () => ({ input: {}, leave() {} }) }] }));
    const other = keeper("t.keep", {}, () => ({ busy: (id) => keep.has(id) }));
    const time = manualTime({ yieldTo: () => Promise.resolve() });
    const s = await mount({ extensions: [ling.ext, other.ext], doc, time });
    expect(state(s)).toBe("running");
    return { s, time, seen: ling.seen, keep };
  }

  it("leaving the running set, an extension lingers LINGER_MS, then stops: its signal aborts, then dispose", async () => {
    const { s, time, seen } = await lingering();
    unwant(s);
    await s.settle();
    await time.advance(LINGER_MS - 50);
    expect([state(s), s.host.lingering(T), seen.api.signal.aborted, seen.disposes]).toEqual(["running", true, false, 0]);
    await time.advance(100);
    expect([state(s), seen.api.signal.aborted, seen.disposes]).toEqual(["stopped", true, 1]);
  });

  // a finite case list: each way of being busy holds it past the linger, and it stops once that ends
  const CASES = {
    "a body it put on the stack": (api) => (api.body.enter("t.seat"), () => api.body.leave()),
    "a held tool": (api) => api.hold({ name: "Piece" }, { press: () => null }),
    "an instance's busy(id)": (api, keep) => (keep.add(T), () => keep.delete(T)),
  };
  for (const [what, take] of Object.entries(CASES))
    it(`it stays past the linger while it holds ${what}, and stops once that ends`, async () => {
      const { s, time, seen, keep } = await lingering();
      const end = take(seen.api, keep);
      expect(s.debug.busy(T)).toBe(true);
      unwant(s);
      await s.settle();
      await time.advance(LINGER_MS + 1000);
      expect([state(s), seen.disposes]).toEqual(["running", 0]);
      end();
      expect(s.debug.busy(T)).toBe(false);
      await time.advance(BUSY_RECHECK_MS + 50);
      expect([state(s), seen.disposes]).toEqual(["stopped", 1]);
    });

  it("one still loading (its module a pending promise) when it leaves stops at once, and is never created", async () => {
    let open;
    const gate = new Promise((r) => (open = r));
    let creates = 0;
    const time = manualTime({ yieldTo: () => Promise.resolve() });
    const s = await mount({ extensions: [{ meta: { id: T, traits: [T] }, module: gate }], doc, time });
    expect(state(s)).toBe("loading");
    unwant(s);
    await s.settle();
    // (no time stepped: at once)
    expect(state(s)).toBe("stopped");
    open({ create: () => (creates++, {}) });
    await s.settle();
    await time.advance(LINGER_MS + 100);
    expect([state(s), creates]).toEqual(["stopped", 0]);
  });
});

describe("H5: what wants the pointer", () => {
  it("wanted while a selection exists, a hand asking for the pointer is held, or a view plugin's wantPointer() asks; not otherwise", async () => {
    const ext = keeper("t.ext");
    const vp = keeper("t.vp", { type: "scene:view" });
    const s = await mount({ extensions: [vp.ext, ext.ext], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    const api = ext.seen.api;
    const wanted = () => api.view.get().pointer.wanted;
    expect(wanted()).toBe(false);
    // a selection
    api.view.select("a");
    expect(wanted()).toBe(true);
    api.view.select(null);
    expect(wanted()).toBe(false);
    // a hand: one that asks wants it; one that doesn't, doesn't
    let put = api.hold({ name: "Quiet" }, { press: () => null });
    expect(wanted()).toBe(false);
    put();
    put = api.hold({ name: "Pointer", pointer: true }, { press: () => null });
    expect(wanted()).toBe(true);
    put();
    expect(wanted()).toBe(false);
    // wantPointer(), until its release
    const release = vp.seen.api.wantPointer();
    expect(wanted()).toBe(true);
    release();
    expect(wanted()).toBe(false);
    expect(s.debug.view.atom.get().pointer.wanted).toBe(false);
  });
});

describe("keys in an embedded document (STAGE.md, “Keys”)", () => {
  it("a key typed inside a data-stage-embed element reaches no extension's input.key; the same key outside it does", async () => {
    const heard = [];
    const ext = keeper("t.keys", {}, () => ({ input: { key: (ev) => (heard.push(["key", ev.key]), true), keyup: (ev) => (heard.push(["keyup", ev.key]), true) } }));
    const s = await mount({ extensions: [ext.ext] });
    const embed = document.createElement("div");
    embed.setAttribute(EMBED_ATTR, "");
    const inside = embed.appendChild(document.createElement("div"));
    const outside = document.createElement("div");
    s.root.append(embed, outside);
    const type = (el, key) => {
      for (const t of ["keydown", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}` }));
    };
    type(inside, "q");
    expect(heard).toEqual([]);
    type(outside, "q");
    expect(heard).toEqual([["key", "q"], ["keyup", "q"]]);
  });
});

describe("api.page (API.md, “`api`”)", () => {
  it("the view's pagehide (“hide”) and pageshow (“show”); an off works; what it registered goes as it stops", async () => {
    const log = [];
    const listen = (name) => (api) => {
      const offs = Object.fromEntries(["hide", "show"].map((t) => [t, api.page.on(t, () => log.push(`${name} ${t}`))]));
      return { offs };
    };
    const a = keeper("t.a", {}, listen("a"));
    const b = keeper("t.b", {}, listen("b"));
    const s = await mount({ extensions: [a.ext, b.ext] });
    const back = () => {
      const e = new Event("pageshow");
      Object.defineProperty(e, "persisted", { value: true });
      globalThis.dispatchEvent(e);
    };
    // leaving the page says "hide" (last first, as extensions stop); back from the cache, "show"
    globalThis.dispatchEvent(new Event("pagehide"));
    expect(log.splice(0)).toEqual(["b hide", "a hide"]);
    back();
    expect(log.splice(0)).toEqual(["a show", "b show"]);
    // an off takes that one listener away
    s.instance("t.a").offs.show();
    globalThis.dispatchEvent(new Event("pagehide"));
    back();
    expect(log.splice(0)).toEqual(["b hide", "a hide", "b show"]);
    // stopped, none of t.b's is called again
    await s.uninstall("t.b");
    globalThis.dispatchEvent(new Event("pagehide"));
    expect(log.splice(0)).toEqual(["a hide"]);
  });
});
