// @vitest-environment happy-dom
// The kernel's reads for visible gears (STAGE.md, "`api`" owners, "View
// plugins" routes and tap, "`api`" change's provenance; PLANS.md section 4):
// who draws what, each event's route through the input chain, a read-only
// tap on the channel, and who wrote what.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as A from "@automerge/automerge";
import { mountStage, object, settle } from "../test/stage-harness.js";
import { ROUTES } from "./router.js";
import { lastWriter, stamp, writerOf, writers } from "./provenance.js";

let s = null;
const extra = [];
afterEach(() => {
  for (const c of extra.splice(0)) c();
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

const T = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** t.a holds `a` (draws, labels, displays, takes presses on what it holds, hears sends); t.b holds the scene (`*`) and takes nothing; t.view is a view plugin that taps. */
function plugins(log) {
  const A_ = {
    meta: { id: "t.a", traits: ["t.a"] },
    module: {
      create: (api) => {
        log.a = api;
        return {
          input: { press: (ev) => (ev.holder === "x" ? {} : null), click: () => false },
          receive: (type, data) => log.heard.push([type, data]),
        };
      },
    },
  };
  const B = { meta: { id: "t.b" }, module: { create: (api) => ((log.b = api), {}) } };
  const V = {
    meta: { id: "t.view", type: "scene:view" },
    module: { create: (api) => ((log.view = api), { input: { press: () => null } }) },
  };
  return [A_, B, V];
}

async function mount() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = { heard: [] };
  const objects = { x: object({ name: "X", traits: { "t.a": {} } }), y: object({ name: "Y" }) };
  s = await mountStage({ extensions: plugins(log), doc: { objects, order: ["x", "y"] } });
  await settle();
  return log;
}

describe("owners: who draws what in a stage", () => {
  it("layers with their meshes, labels with their objects, and display overrides by author in layering order, each released as its owner stops", async () => {
    const log = await mount();
    const { a, b } = log;
    const g = a.world({ onTop: true });
    g.add(new a.THREE.Mesh(new a.THREE.BoxGeometry(), new a.THREE.MeshBasicMaterial()), new a.THREE.Mesh());
    b.world();
    a.labels().set([{ key: "k", text: "Hello", on: "x" }, { key: "free", text: 2 }]);
    // t.b runs before t.a (a scene extension, then an objects one: STAGE.md, "Activation"), so t.b's override is under t.a's
    expect(s.debug.local.get().running.map((r) => r.id).filter((id) => id.startsWith("t."))).toEqual(["t.b", "t.a"]);
    a.display("x", { hidden: true, name: "A's" });
    b.display("x", { transform: T, hidden: undefined });
    const o = a.owners();
    expect(o.layers).toEqual([
      { ext: "t.b", onTop: false, meshes: 0 },
      { ext: "t.a", onTop: true, meshes: 2 },
    ]);
    expect(o.labels).toEqual([
      { ext: "t.a", key: "k", text: "Hello", on: "x" },
      { ext: "t.a", key: "free", text: "2", on: null },
    ]);
    expect(o.display).toEqual({ x: [{ ext: "t.b", fields: ["transform"] }, { ext: "t.a", fields: ["hidden", "name"] }] });
    expect(Object.isFrozen(o) && Object.isFrozen(o.layers[0]) && Object.isFrozen(o.display.x)).toBe(true);
    // the view plugin reads the focus stage's
    expect(log.view.focus().owners()).toEqual(o);
    await s.uninstall("t.a");
    expect(b.owners()).toEqual({ layers: [{ ext: "t.b", onTop: false, meshes: 0 }], labels: [], display: { x: [{ ext: "t.b", fields: ["transform"] }] } });
  });
});

describe("display's looks: tint, opacity and outline", () => {
  it("merge per field in layering order with the others, and go as their owner releases them", async () => {
    const { a, b } = await mount();
    const off = a.display("x", { tint: "#999", opacity: 0.5, outline: ["red", "blue"] });
    b.display("x", { opacity: 0.2 });
    expect(s.debug.displayed().get("x")).toEqual({ tint: "#999", opacity: 0.5, outline: ["red", "blue"] });
    expect(a.owners().display.x.map((o) => [o.ext, o.fields])).toEqual([["t.b", ["opacity"]], ["t.a", ["tint", "opacity", "outline"]]]);
    off();
    expect(s.debug.displayed().get("x")).toEqual({ opacity: 0.2 });
    await s.uninstall("t.b");
    expect(s.debug.displayed().has("x")).toBe(false);
  });
});

describe("routes: each dispatched event's way through the input chain", () => {
  it("the hands, then the widget, the holders nearest first, the view plugins, the body; who took it; the last ROUTES kept", async () => {
    const log = await mount();
    const { view } = s.debug;
    const at = (id) => () => ({ id, point: [0, 0, 0], normal: [0, 1, 0], distance: 2 });
    view.viewport.pick = at("x");
    s.edit(false);
    s.pointer("pointerdown", 20, 20);
    s.pointer("pointerup", 20, 20);
    let r = log.view.routes().filter((x) => x.type === "press").at(-1);
    // t.a holds x (its own trait) and takes the press; nothing after it is offered
    expect(r.path).toEqual(["x"]);
    expect(r.steps.map((st) => [st.step, st.ext, st.holder ?? null])).toEqual([
      ["holder", "t.a", "x"],
    ]);
    expect(r.took).toBe(0);
    expect(r.steps[0].stage).toBe(0);
    // on y nobody's holder takes it: t.a is not y's, t.b and the natives hold the scene, then the view plugins, then Look (the default)
    view.viewport.pick = at("y");
    s.pointer("pointerdown", 20, 20);
    s.pointer("pointerup", 20, 20);
    r = log.view.routes().filter((x) => x.type === "press").at(-1);
    expect(r.path).toEqual(["y"]);
    expect(r.took).toBe(-1);
    const kinds = r.steps.map((st) => st.step);
    expect(kinds.at(-1)).toBe("default");
    expect(r.steps.some((st) => st.ext === "t.a")).toBe(false);
    expect(r.steps.filter((st) => st.step === "holder").every((st) => st.holder === null)).toBe(true);
    expect(r.steps.find((st) => st.ext === "t.b").step).toBe("holder");
    expect(r.steps.find((st) => st.ext === "t.view").step).toBe("plugin");
    // holders, then plugins, then the default: in that order
    const rank = { hand: 0, widget: 1, holder: 2, plugin: 3, body: 4, default: 4 };
    expect(kinds.map((k) => rank[k])).toEqual([...kinds.map((k) => rank[k])].sort((p, q) => p - q));
    // the Edit hand held: it is offered first, a hand of the view plugin's
    s.edit(true);
    s.pointer("pointerdown", 20, 20);
    s.pointer("pointerup", 20, 20);
    r = log.view.routes().filter((x) => x.type === "press").at(-1);
    expect(r.steps[0]).toMatchObject({ step: "hand", view: true, ext: "scene.edit", kind: "edit" });
    // a key nothing reserves goes down the chain (no hit: the scene's holders), and nobody takes it here
    s.key("q");
    r = log.view.routes().at(-1);
    expect([r.type, r.path, r.took, r.steps.every((st) => st.step === "holder" ? st.holder === null : st.step === "plugin")]).toEqual(["key", null, -1, true]);
    // at most ROUTES kept, oldest first
    for (let i = 0; i < ROUTES; i++) s.pointer("pointerdown", 20, 20), s.pointer("pointerup", 20, 20);
    const all = log.view.routes();
    expect(all.length).toBe(ROUTES);
    expect(all.every((x, i) => i === 0 || x.at >= all[i - 1].at)).toBe(true);
    expect(Object.isFrozen(all) && Object.isFrozen(all[0].steps)).toBe(true);
  });
});

describe("the channel tap", () => {
  it("off with nobody listening; then every message out and in, with its namespace, session, type and where it went or why it was dropped", async () => {
    const log = await mount();
    const { view } = s.debug;
    const said = [];
    const tapSay = vi.spyOn(view, "tapSay");
    // nobody listens: nothing is made
    log.a.channel.send("ping", { n: 1 });
    log.a.channel.set("k", 1);
    await settle();
    expect(tapSay).not.toHaveBeenCalled();
    const off = log.view.tap((e) => said.push(e));
    log.a.channel.send("ping", { n: 2 });
    await settle();
    expect(said.find((e) => e.kind === "send")).toMatchObject({ stage: 0, url: s.handle.url, dir: "out", ext: "t.a", type: "ping", data: { n: 2 }, session: log.a.channel.session });
    // a second view of the doc in this page: the page bus carries between them
    const { default: Stage } = await import("./stage.js");
    const el = document.createElement("div");
    el.repo = s.repo;
    el.viewerId = "viewer:ben";
    el.packageSettleMs = 0;
    document.body.append(el);
    const unmount = Stage(s.handle, el);
    extra.push(() => (unmount(), el.remove()));
    await settle();
    const other = el.querySelector(".scene-stage").__sceneDebug;
    const ben = other.host.record("t.a").api;
    said.length = 0;
    ben.channel.send("ping", { n: 3 });
    ben.channel.send("nobody", {});
    other.presence.send("t.gone", "x", {});
    await settle();
    const heard = said.filter((e) => e.dir === "in" && e.kind === "send");
    expect(heard.map((e) => [e.ext, e.type, e.to ?? null, e.dropped ?? null, e.session === ben.channel.session, e.viewer])).toEqual([
      ["t.a", "ping", "extension", null, true, "viewer:ben"],
      ["t.a", "nobody", "extension", null, true, "viewer:ben"],
      ["t.gone", "x", null, "not running here", true, "viewer:ben"],
    ]);
    expect(log.heard).toEqual([["ping", { n: 3 }], ["nobody", {}]]);
    // a pose's sample is a service's (scene.poses provides "poses")
    said.length = 0;
    ben.use("poses").hold("x", T);
    await settle();
    expect(said.find((e) => e.dir === "in" && e.ext === "scene.poses")).toMatchObject({ type: "pose", to: "service", data: { id: "x" } });
    // presence: heard and routed to the stage, with its namespaces; one repeated is stale
    said.length = 0;
    ben.channel.set("hello", true);
    await settle();
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    const p = said.find((e) => e.dir === "in" && e.kind === "presence" && e.keys?.["t.a"]);
    expect(p).toMatchObject({ to: "stage", changed: true, viewer: "viewer:ben" });
    // (ben's last state, heard again as the network might deliver it: no newer than what this view has)
    const last = s.handle.broadcasts.findLast((m) => m.type === "scene:presence" && m.session === ben.channel.session && !m.bye);
    s.handle.emit("ephemeral-message", { message: structuredClone(last), senderId: "network" });
    expect(said.at(-1)).toMatchObject({ dir: "in", kind: "presence", dropped: "stale" });
    // off: nothing more
    off();
    tapSay.mockClear();
    ben.channel.send("ping", { n: 4 });
    await settle();
    expect(tapSay).not.toHaveBeenCalled();
  });
});

describe("write provenance", () => {
  it("every change through an api carries its writer's id; the stage's own writes say they are the kernel's", async () => {
    const log = await mount();
    const before = s.handle.messages.length;
    log.a.change((d) => void (d.objects.x.name = "by a"));
    log.view.focus().change((d) => void (d.objects.y.name = "by the view"));
    const mine = s.handle.messages.slice(before);
    expect(mine.map(writerOf)).toEqual([{ ext: "t.a" }, { ext: "t.view" }]);
    // every stamped message the stage wrote is an extension's, a view plugin's, or the kernel's
    expect(s.handle.messages.filter(Boolean).map(writerOf).every((w) => w && (typeof w.ext === "string" || w.kernel === "packages"))).toBe(true);
    // (the kernel's own write, the packages list: packages.test.js)
  });

  it("lastWriter: the change whose op a path shows (a conflict's winner), the latest under a map or list, a peer's included", () => {
    const by = (ext) => ({ message: stamp({ ext }) });
    let d = A.from({ objects: { o: { name: "x", transform: { position: [0, 0, 0], scale: 1 } } } });
    d = A.change(d, by("t.one"), (x) => void (x.objects.o.transform.scale = 2));
    let peer = A.clone(d);
    peer = A.change(peer, by("t.two"), (x) => void (x.objects.o.transform.position = [1, 2, 3]));
    d = A.change(d, by("t.three"), (x) => void (x.objects.o.name = "mine"));
    d = A.merge(d, peer);
    const w = (p) => lastWriter(d, p)?.by ?? null;
    expect(w(["objects", "o", "transform", "scale"])).toEqual({ ext: "t.one" });
    expect(w(["objects", "o", "transform", "position"])).toEqual({ ext: "t.two" });
    expect(w(["objects", "o", "transform", "position", 1])).toEqual({ ext: "t.two" });
    expect(w(["objects", "o", "name"])).toEqual({ ext: "t.three" });
    // a map: the latest op anywhere under it (Lamport order)
    // (t.two wrote after it had t.one's change, so its ops come later; t.three wrote the name, not under the transform)
    expect(writers(d).lastWriter(["objects", "o", "transform"]).by).toEqual({ ext: "t.two" });
    expect(writers(d).lastWriter(["objects", "o"]).by).not.toEqual({ ext: "t.one" });
    // a conflict: both write the same field; the doc's winner's writer is the answer
    let a = A.change(A.clone(d), by("t.a"), (x) => void (x.objects.o.transform.scale = 5));
    let b = A.change(A.clone(d), by("t.b"), (x) => void (x.objects.o.transform.scale = 6));
    const m = A.merge(a, b);
    const winner = m.objects.o.transform.scale === 5 ? "t.a" : "t.b";
    expect(lastWriter(m, ["objects", "o", "transform", "scale"]).by).toEqual({ ext: winner });
    // unstamped, missing, not an Automerge doc
    expect(lastWriter(A.from({ v: 1 }), ["v"]).by).toBe(null);
    expect(lastWriter(d, ["objects", "nope"])).toBe(null);
    expect(lastWriter({ objects: {} }, ["objects"])).toBe(null);
    expect(writerOf("hello")).toBe(null);
  });
});

describe("settled() says why an extension failed", () => {
  it("errors: each failed extension's message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { meta: { id: "t.bad" }, module: { create: () => { throw new Error("no luck"); } } };
    s = await mountStage({ extensions: [bad, { meta: { id: "t.ok" }, module: { create: () => ({}) } }], doc: { objects: { x: object() }, order: ["x"] } });
    await settle();
    const st = s.api("t.ok").settled();
    expect(st.failed).toEqual(["t.bad"]);
    expect(st.errors).toEqual({ "t.bad": "no luck" });
  });
});

