// @vitest-environment happy-dom
// I6, a read-only stage writes nothing, through its api or its repo
// (STAGE.md, Invariants), checked over every read-only stage there is
// (a pin, and a live doc acting where its handle refuses writes)
// × every way an extension can write or speak: the api's writes, sends,
// holds, claims, processes, the editor's edits, parts, templates and
// drops (parts/editor.js, on its api), the handle and the repo it is handed, and, for the stages that are
// drawn, everything that would act (input, bodies, tools, commands, chrome,
// the camera). The docs these stages read are handed out with `change` and
// `broadcast` that throw and log: a read-only stage must never reach them,
// over its api's calls and over time (claims rechecked, the clock ticked,
// presence heartbeats, packages reconciled), and must never reach the
// refusal of the handle it was given (which would show as a warning or a
// throw).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
// Every refused method tried on a read-only handle the stage was given (its doc's, and so its
// presence's): a read-only stage's own output, told apart from an acting stage on the same doc.
const tried = vi.hoisted(() => []);
vi.mock("./readonly.js", async (importOriginal) => {
  const m = await importOriginal();
  const spied = new WeakSet();
  return {
    ...m,
    readOnlyHandle(h) {
      const ro = m.readOnlyHandle(h);
      if (!ro || ro === h || spied.has(ro)) return ro;
      const out = new Proxy(ro, {
        get(t, p) {
          const v = Reflect.get(t, p);
          return m.REFUSED.includes(p) ? (...a) => (tried.push(`${String(p)} ${h.url}`), v(...a)) : v;
        },
      });
      spied.add(out);
      return out;
    },
  };
});
import { mountStage, object, settle } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo, FakeHandle } from "../test/fake-repo.js";
import { LINK, linkOpener } from "../test/links.js";
import { editor } from "../parts/editor.js";
import { drop, part, template } from "../parts/making.js";
import { manualTime } from "./time.js";
import { CLOCK_HZ, CHECKPOINT_MS } from "../native/clock.js";
import { HEARTBEAT_MS } from "./presence.js";
import { readOnlyHandle, stageRepo, REFUSED } from "./readonly.js";

const T = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** The game doc G: a card on its root; a claim on the scene by a session long gone; `packages` naming nothing (reconcile would list what it uses). */
const gameDoc = (title) => emptyScene({ title, objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": {} }, claims: { held: { viewer: "viewer:old", session: "s-old" } } });

/** Make a handle's change and broadcast throw while `armed.on`, and log every call. */
function armed(h, log, armed) {
  const change = h.change.bind(h);
  const broadcast = h.broadcast.bind(h);
  h.change = (...a) => {
    log.push(`change ${h.url}`);
    if (armed.on) throw new Error(`I6: a write reached ${h.url}`);
    return change(...a);
  };
  h.broadcast = (m) => {
    log.push(`broadcast ${h.url} ${m?.type} ${JSON.stringify(m?.keys ?? {})}`);
    if (armed.on) throw new Error(`I6: a send reached ${h.url}`);
    return broadcast(m);
  };
}

// The extensions G runs: t.probe (a package's: it keeps its api, and offers a
// body, a command, a widget and an input, so a drawn stage is seen to offer
// none of them), a part and a template that write.
const PROBE = {
  meta: { id: "t.probe", traits: ["t.game"] },
  module: {
    create: (api) => {
      return {
        bodies: [{ id: "t.sit", label: "Sitting", enter: () => ({ input: {} }) }],
        commands: [{ id: "poke", name: "Poke", key: "p", run: () => api.change((d) => (d.title = "poked")) }],
        input: { press: () => null, widgetAt: () => ({ distance: 0 }) },
      };
    },
  },
};
/** A general part (no trait: it runs in the focus, the host here), as the command bar or the menu is. */
const GENERAL = { meta: { id: "t.general" }, module: { create: () => ({}) } };
/** Every doc's: the outermost's offers the world's ambient "t.world" (G's own offer is never the world's). */
const WORLD = { meta: { id: "t.world", traits: ["*"] }, module: { create: () => ({ ambient: () => ({ "t.world": { here: true } }) }) } };
const PART = { meta: { id: "t.part" }, module: { create: (ctx) => ctx.addObject(ctx.url) } };
const TEMPLATE = { meta: { id: "t.template" }, module: { create: (ctx) => ctx.change((d) => (d.title = "templated")) } };

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

/**
 * Mount a host with G linked as `role`: "pinned" (G at an older version),
 * "readonly" (G linked once, live, its handle refusing writes as a viewer
 * who may only read would have it). → the stage under test and what's
 * logged.
 */
async function mount(role) {
  tried.length = 0;
  const repo = new FakeRepo();
  const time = manualTime({ yieldTo: () => Promise.resolve() });
  const g = repo.add(gameDoc("G then"));
  const then = g.heads();
  g.change((d) => (d.title = "G now"));
  const log = [];
  const arm = { on: false };
  armed(g, log, arm);
  if (role === "readonly") g.isReadOnly = () => true;
  // a pin's handle is G's view at those heads: it refuses as G does
  const view = g.view.bind(g);
  g.view = (heads) => {
    const v = view(heads);
    v.change = () => {
      log.push(`change ${v.url}`);
      throw new Error(`I6: a write reached ${v.url}`);
    };
    v.broadcast = (m) => {
      log.push(`broadcast ${v.url} ${m?.type}`);
      throw new Error(`I6: a send reached ${v.url}`);
    };
    return v;
  };
  const link = (extra) => object({ name: "G", sourceUrl: g.url, providerId: LINK, renderUrl: null, transform: T, ...extra });
  const objects = role === "pinned" ? { P: link({ at: { heads: then } }) } : { L1: link() };
  s = await mountStage({ repo, time, natives: true, extensions: [PROBE, GENERAL, WORLD, linkOpener()], parts: [PART], templates: [TEMPLATE], doc: { objects, order: Object.keys(objects) } });
  const want = role === "pinned" ? ["P"] : ["L1"];
  for (let i = 0; i < 200 && !s.debug.view.stages().some((x) => x.path.join() === want.join() && x.debug.host.instanceOf("t.probe")); i++) await settle();
  const stage = s.debug.view.stages().find((x) => x.path.join() === want.join());
  return { repo, time, g, then, log, arm, stage, api: stage.debug.host.record("t.probe").api };
}

/** Everything the stage logged as a warning or an error, from now. */
function watchConsole() {
  const said = [];
  vi.spyOn(console, "warn").mockImplementation((...a) => said.push(`warn: ${a.map(String).join(" ")}`));
  vi.spyOn(console, "error").mockImplementation((...a) => said.push(`error: ${a.map(String).join(" ")}`));
  return said;
}

const ROLES = ["pinned", "readonly"];

describe("I6: a read-only stage writes nothing", () => {
  for (const role of ROLES) {
    it(`${role}: every write, send, hold, claim and process through the api is refused, and nothing reaches a doc`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const m = await mount(role);
      const { api, g } = m;
      expect(m.stage.acts).toBe(role === "readonly");
      expect("role" in api).toBe(false); // where it's placed is the view's, never an extension's to branch on (I4)
      expect(api.writable()).toBe(false);
      // since it opened: nothing of its own tried on its handle (its presence's hello and keys included)
      await m.time.advance(HEARTBEAT_MS + 1, { draw: false });
      expect(tried).toEqual([]);
      const docBefore = JSON.stringify(api.doc());
      const hostBefore = JSON.stringify(s.doc());
      const gBefore = g.heads().join();
      m.arm.on = true;
      const said = watchConsole();
      const steps = []; // [what, ok]
      const ok = (what, v) => steps.push([what, !!v]);

      api.change((d) => (d.title = "written"));
      ok("change writes nothing", api.doc().title !== "written");
      ok("remove refuses", api.remove(["card"]) === null);
      const claims = api.use("claims");
      const clock = api.use("clock");
      ok("claim on the scene refuses", claims.claim(null, "seat:p1") === null);
      ok("claim on an object refuses", claims.claim("card", "carry") === null);
      api.channel.send("t", { x: 1 });
      api.use("tell").tell("t", { x: 1 });
      ok("pose.hold refuses", api.use("poses").hold("card", { ...T, position: [1, 0, 0] }) === false);
      api.channel.set("here", role);
      api.channel.rate(30);
      let started = 0;
      let stepped = 0;
      const off = clock.process({ start: () => started++, step: () => stepped++, save: (d) => (d.title = "saved") });
      clock.pause();
      clock.resume();
      editor(api).edit((d) => (d.title = "edited"), { label: "Edit" });
      const step = editor(api).edits("Several");
      step.change((d) => (d.title = "edited twice"));
      step.end();
      ok("undo refuses", editor(api).undo() === false);
      ok("part refuses", (await part(api, "t.part")) === null);
      ok("template refuses", (await template(api, "t.template")) === false);
      ok("drop refuses", (await drop(api, { url: g.url, datatype: "scene" })) === false);
      ok("addObject refuses", await api.addObject(g.url).then(() => false, (e) => /read-only/.test(e.message)));
      // the repo it was handed refuses (from here, anything tried on its handle is the stage's own)
      tried.length = 0;
      const found = await api.repo.find(s.handle.url);
      ok("a handle the repo gives out refuses", (() => { try { found.change((d) => (d.title = "through the repo")); return false; } catch (e) { return /read-only/.test(e.message); } })());
      ok("the repo makes no doc", await api.repo.create2({}).then(() => false, (e) => /read-only/.test(e.message)));
      // a pin has no channel: no claim counts there; elsewhere one by a session long gone counts only for the grace
      if (role === "pinned") ok("a pin's claims count for nobody", claims.claimedBy(null, "held") === null);
      else ok("a claim by a session not heard from counts for the grace", claims.claimedBy(null, "held")?.session === "s-old");

      // over time: claims rechecked, the clock ticked past a checkpoint, heartbeats, a pose's keepalive
      await m.time.advance(CHECKPOINT_MS + HEARTBEAT_MS + 1000 / CLOCK_HZ, { draw: false });
      await settle();
      ok("the process is never started or stepped", started === 0 && stepped === 0);
      off();
      ok("a claim by a session long gone has lapsed", claims.claimedBy(null, "held") === null);

      m.arm.on = false;
      const failed = steps.filter(([, v]) => !v).map(([w]) => w);
      expect(failed).toEqual([]);
      expect(JSON.stringify(api.doc())).toBe(docBefore);
      expect(g.heads().join()).toBe(gBefore);
      expect(JSON.stringify(s.doc())).toBe(hostBefore);
      // nothing it did reached G's handle, nor tried to
      expect(tried).toEqual([]);
      expect(m.log).toEqual([]);
      // and the stage never reached its own refusal: nothing warned or threw on its way
      expect(said).toEqual([]);
      expect(m.time.errors()).toEqual([]);
    });
  }

  for (const role of ["pinned"]) {
    it(`${role}: drawn, never acted on: no segment, body, tool, command, widget, chrome, listener, camera, selection, notice or pref; its extensions still collect from it`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const m = await mount(role);
      const { api, stage } = m;
      const view = s.debug.view;
      const before = view.atom.get();
      const steps = [];
      const ok = (what, v) => steps.push([what, !!v]);
      const hit = { id: `\u001f${stage.n}\u001fcard`, point: [0, 0, 0], distance: 1 };
      ok("no segment in the chain, even for a hit on its own card", !view.chainFor({ hit, widget: null }).order.some((k) => k.startsWith(`\u001f${stage.n}\u001f`)));
      ok("no bodies", view.bodyDefs().get("t.sit")?.stage !== stage && view.bodyDefs(stage).get("t.sit")?.stage !== stage);
      ok("no commands", !view.collect("commands").some((c) => c.stage === stage.n));
      ok("no widgets", !String(view.pickWidget({ x: 1, y: 1 })?.owner ?? "").startsWith(`\u001f${stage.n}\u001f`));
      // what its own extensions read of it, they read as anywhere (I4: a roster, a keymap, a lens)
      ok("its extensions collect from their own stage", api.collect("commands").some((c) => c.id === "t.probe"));
      ok("not acting", !view.acting().includes(stage));
      ok("off the input path", !view.onPath([...stage.path, "card"]).includes(stage));
      ok("body.enter refuses", api.body.enter("t.sit") === false);
      ok("hold refuses", api.hold({ name: "Tool" }, {}) && view.router.tools().length === 0);
      ok("run refuses", api.run({ ext: "t.probe", command: "poke" }) === false);
      const general = view.stage(0).debug.host.record("t.general").api;
      ok("a general part can't run one of its commands either", general.run({ stage: stage.n, ext: "t.probe", command: "poke" }) === false && api.doc().title !== "poked");
      const el = api.overlay();
      const edge = api.overlay("right");
      ok("overlay and edge stay out of the DOM", !el.isConnected && !edge.isConnected);
      ok("no notices, drawer or prefs", ["notices", "drawer", "prefs"].every((n) => api.use(n) === null));
      api.view.select("card");
      ok("the selection stays the viewer's", view.atom.get().selected === before.selected);
      const ride = api.camera.ride("card");
      api.camera.set({ position: [9, 9, 9], target: [0, 0, 0] });
      ok("the camera is not its to move", typeof ride === "function" && view.viewport.held === false);
      // what it draws into the world, it may: its styles too
      let heard = 0;
      api.listen(document, "keydown", () => heard++);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      ok("a listener hears nothing", heard === 0);
      // the same api as an acting stage's, member for member (each acting one in its inert form: stage/drawn.js)
      const shape = (o, at = "") => Object.keys(o).flatMap((k) => { const v = Object.getOwnPropertyDescriptor(o, k).value; return v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype ? shape(v, `${at}${k}.`) : [`${at}${k}`]; }).sort();
      ok("the api has the acting api's shape", JSON.stringify(shape(api)) === JSON.stringify(shape(s.debug.host.record("t.world").api)));
      ok("a style goes in", api.style(".x{}").isConnected);
      ok("its world layer is there", !!api.world());
      expect(steps.filter(([, v]) => !v).map(([w]) => w)).toEqual([]);
    });
  }
});

// What an extension of a drawn or read-only stage reaches of the world through api.ambient(name).use: the
// outermost's services, made for a read-only caller, so it reads (the world's time, who holds what) and acts on
// nothing there: no write, send, hold, veil or process, whatever it calls.
describe("I6 through the world: a read-only stage's ambient services only read", () => {
  for (const role of ROLES) {
    it(`${role}: the outermost's clock, claims, poses, tell and audience read, and refuse whatever would act`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const m = await mount(role);
      await m.time.advance(100);
      await settle();
      const world = m.api.ambient("t.world");
      expect(world?.mine).toBe(false);
      const host = s.handle;
      const out = [];
      const change = host.change.bind(host);
      const broadcast = host.broadcast.bind(host);
      host.change = (...a) => (out.push("change"), change(...a));
      host.broadcast = (msg) => (out.push(`broadcast ${msg?.type} ${JSON.stringify(msg?.keys ?? {})}`), broadcast(msg));
      const before = JSON.stringify(s.doc());
      const id = role === "pinned" ? "P" : "L1";
      const clock = world.use("clock");
      const steps = [];
      const ok = (what, v) => steps.push([what, !!v]);
      const running = clock.running();
      ok("the clock reads", typeof clock.t() === "number" && typeof running === "boolean");
      if (running) clock.pause();
      else clock.resume();
      let started = 0;
      clock.process({ start: () => started++, step: () => started++ });
      ok("a claim refuses", world.use("claims").claim(null, "seat:p1") === null);
      ok("claims read", world.use("claims").claimedBy(null, "seat:p1") === null);
      ok("a pose refuses", world.use("poses").hold(id, { ...T, position: [1, 0, 0] }) === false);
      world.use("tell").tell("t", { x: 1 });
      const veil = world.use("audience").veil(id);
      ok("a veil draws nothing", typeof veil === "function" && !s.debug.displayed().has(id));
      ok("the audience reads", world.use("audience").audience(id) !== undefined);
      await m.time.advance(HEARTBEAT_MS + 1, { draw: false });
      await settle();
      ok("no process started", started === 0);
      ok("the clock as it was", clock.running() === running);
      expect(steps.filter(([, v]) => !v).map(([w]) => w)).toEqual([]);
      expect(JSON.stringify(s.doc())).toBe(before);
      expect(out.filter((o) => !o.startsWith("broadcast scene:presence {"))).toEqual([]);
    });
  }
});

describe("the read-only handle and repo, over everything they refuse", () => {
  for (const what of REFUSED) {
    it(`${what}: refused on the handle, on a view it gives out, and on a handle its repo finds; reads pass`, async () => {
      const repo = new FakeRepo();
      const h = repo.add({ title: "x" });
      const heads = h.heads();
      h.change((d) => (d.title = "y"));
      const calls = [];
      for (const k of REFUSED) if (typeof h[k] === "function") { const f = h[k].bind(h); h[k] = (...a) => (calls.push(k), f(...a)); } else h[k] = () => calls.push(k);
      const ro = readOnlyHandle(h);
      expect(ro.isReadOnly()).toBe(true);
      expect(ro.doc().title).toBe("y");
      expect(ro.url).toBe(h.url);
      expect(() => ro[what](() => {})).toThrow(/read-only/);
      const v = ro.view(heads);
      expect(v.isReadOnly()).toBe(true);
      expect(v.doc().title).toBe("x");
      expect(() => v[what](() => {})).toThrow(/read-only/);
      const found = await stageRepo(repo, { readOnly: true }).find(h.url);
      expect(() => found[what](() => {})).toThrow(/read-only/);
      expect(calls).toEqual([]);
      expect(readOnlyHandle(ro)).toBe(ro);
    });
  }

  it("the repo is an allowlist: find, create, create2 and peerId, and no other door to a handle (handles, findWithProgress)", async () => {
    const repo = new FakeRepo();
    repo.peerId = "peer:x";
    repo.findWithProgress = () => ({ handle: null });
    for (const readOnly of [false, true]) {
      const r = stageRepo(repo, { readOnly });
      expect(Object.keys(r).sort()).toEqual(["create", "create2", "find", "peerId"]);
      expect(r.peerId).toBe("peer:x");
      expect(r.handles).toBe(undefined);
      expect(r.findWithProgress).toBe(undefined);
      if (readOnly) await expect(r.create2({ n: 1 })).rejects.toThrow(/read-only/);
      else expect((await r.create2({ n: 1 })).doc().n).toBe(1);
    }
  });

  it("the repo notes what it finds; with a pin's deps a listed doc is found at its heads, an unlisted one as it is", async () => {
    const repo = new FakeRepo();
    const a = repo.add({ n: 1 });
    const then = a.heads();
    a.change((d) => (d.n = 2));
    const b = repo.add({ n: 10 });
    const reached = new Map();
    const r = stageRepo(repo, { readOnly: true, deps: { [a.url]: then }, reached });
    expect((await r.find(a.url)).doc().n).toBe(1);
    expect((await r.find(b.url)).doc().n).toBe(10);
    expect([...reached.keys()]).toEqual([a.url, b.url]);
    // a writable stage's repo notes too, and hands out what it found
    const w = new Map();
    expect(await stageRepo(repo, { reached: w }).find(b.url)).toBe(b);
    expect([...w.keys()]).toEqual([b.url]);
    await expect(stageRepo(repo, { readOnly: true }).create2({})).rejects.toThrow(/read-only/);
    expect(FakeHandle).toBeTypeOf("function");
  });
});
