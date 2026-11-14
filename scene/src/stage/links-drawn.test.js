// Pins and mirrors (COMPOSITION.md §7, build step 13): every occurrence of
// a linked doc that isn't closed is opened. A live doc acts at one
// occurrence (the first in path order) and is a mirror at the others: a
// read-only stage on the same live handle, drawn at its own placement,
// hearing the acting stage over the page bus, never acted on and never
// computing. A pinned link is a read-only stage on its doc at the pinned
// heads; fixing a link holds the heads of every doc reached through it, so a
// pin is whole. Checked here without WebGL (frames from the docs' transforms,
// hits stubbed as the viewport would key them).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { keyOf } from "./paths.js";
import inspector from "../parts/inspector.js";

const at = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });
const link = (url, extra = {}) => object({ name: "G", sourceUrl: url, providerId: LINK, renderUrl: null, parent: "table", ...extra });

/**
 * G's extensions: t.card (a holder on its cards, recording presses; a kept
 * process, counting starts and steps per role; the container it reads by
 * URL, as a keeper does), and the host's t.host (recording presses).
 */
function extensions(log) {
  return [
    {
      meta: { id: "t.card", traits: ["t.card"] },
      module: {
        create: (api) => {
          api.clock.process({ start: () => log.push(`start ${api.role}`), step: () => {} });
          const box = api.scene().traits["t.game"]?.box;
          if (box) api.repo.find(box).then((h) => log.push(`box ${api.role} ${h.doc().n}`));
          return { input: { press: (ev) => (log.push(`press ${api.role} ${ev.hit?.id}`), null) } };
        },
      },
    },
    { meta: { id: "t.host", traits: ["t.host"] }, module: { create: () => ({ input: { press: (ev) => (log.push(`host ${ev.hit?.id}`), null) } }) } },
  ];
}

/** A repo with G (a card at x = 0; a container doc it reads) and a host with `objects`, mounted. */
async function mountWith(makeObjects, { log = [] } = {}) {
  const repo = new FakeRepo();
  const box = repo.add({ n: 1 });
  const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": { box: box.url } } }));
  const objects = { table: object({ name: "Table", traits: { "t.host": {} } }), ...makeObjects(game) };
  const s = await mountStage({ repo, extensions: extensions(log), doc: { objects, order: Object.keys(objects) } });
  return { s, repo, game, box, log };
}

const stageAt = (s, ...path) => s.debug.view.stages().find((x) => x.path.join("/") === path.join("/")) ?? null;
const running = (st) => st?.debug.host.instanceOf("t.card");

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("a live doc linked twice: one acting, one mirror", () => {
  it("both are open and drawn; the first in path order acts, the other mirrors; each runs G's extensions, and only the acting one computes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && running(stageAt(s, "L2")));
    const host = s.api("t.host");
    expect(host.link("L1")).toEqual({ role: "acting", open: true });
    expect(host.link("L2")).toEqual({ role: "mirror", open: true });
    expect(stageAt(s, "L1").role).toBe("acting");
    expect(stageAt(s, "L2").role).toBe("mirror");
    // the same doc, at two placements
    expect(stageAt(s, "L2").url).toBe(m.game.url);
    expect(stageAt(s, "L2").frame().pointOut([0, 0, 0])).toEqual([5, 0, 0]);
    await settle();
    expect(m.log.filter((e) => e.startsWith("start"))).toEqual(["start acting"]);
  });

  it("an edit to G shows in both; a carry held in the acting stage shows in the mirror, over the page bus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && running(stageAt(s, "L2")));
    const acting = stageAt(s, "L1").debug.host.record("t.card").api;
    const mirror = stageAt(s, "L2").debug.host.record("t.card").api;
    acting.change((d) => (d.objects.card.name = "Red 7"));
    await settle();
    expect(mirror.scene().objects.card.name).toBe("Red 7");
    expect(acting.pose.hold("card", at(0.25))).toBe(true);
    await until(() => mirror.worldOf("card")?.[12] === 0.25);
    // drawn at its own placement: G's frame, so the same local pose
    expect(stageAt(s, "L2").frame().pointOut(mirror.worldOf("card").slice(12, 15))).toEqual([5.25, 0, 0]);
    acting.pose.release("card");
    await until(() => mirror.worldOf("card")?.[12] === 0);
  });

  it("a press on the mirrored card reaches the host as the link, never G; on the acting one, G first", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && running(stageAt(s, "L2")));
    const press = async (st) => {
      m.log.length = 0;
      s.debug.viewport.pick = () => ({ id: keyOf(st.n, "card"), point: [5, 0, 0], normal: [0, 1, 0], distance: 3 });
      s.pointer("pointerdown", 20, 20);
      s.pointer("pointerup", 20, 20);
      await settle();
      return [...m.log];
    };
    expect(await press(stageAt(s, "L2"))).toEqual(["host L2"]);
    expect(await press(stageAt(s, "L1"))).toEqual(["press acting card", "host L1"]);
  });

  it("the acting link removed: the mirror's occurrence acts, in a stage of its own", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && running(stageAt(s, "L2")));
    const mirrorStage = stageAt(s, "L2");
    s.change((d) => {
      delete d.objects.L1;
      d.order.splice(d.order.indexOf("L1"), 1);
    });
    await until(() => stageAt(s, "L2")?.role === "acting" && running(stageAt(s, "L2")));
    expect(stageAt(s, "L2")).not.toBe(mirrorStage);
    expect(s.api("t.host").link("L2")).toEqual({ role: "acting", open: true });
    expect(s.debug.view.stages().length).toBe(2);
  });
});

describe("pinned: its doc at the pinned heads", () => {
  it("shows G as it was, whatever G does live; read-only, never computing, its extensions reading what it reached at the pin's deps", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const box = repo.add({ n: 1 });
    const boxThen = box.heads();
    const game = repo.add(emptyScene({ title: "G then", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": { box: box.url } } }));
    const then = game.heads();
    game.change((d) => (d.title = "G now"));
    box.change((d) => (d.n = 2));
    s = await mountStage({ repo, extensions: extensions(log), doc: { objects: { P: link(game.url, { at: { heads: then, deps: { [box.url]: boxThen } } }) }, order: ["P"] } });
    await until(() => running(stageAt(s, "P")));
    const pin = stageAt(s, "P");
    expect(pin.role).toBe("pinned");
    expect(s.debug.view.linkState(["P"])).toEqual({ role: "pinned", open: true });
    expect(pin.doc().title).toBe("G then");
    game.change((d) => (d.title = "G later"));
    await settle();
    expect(pin.doc().title).toBe("G then");
    expect(stageAt(s, "P")).toBe(pin);
    await until(() => log.some((e) => e.startsWith("box")));
    expect(log).toEqual(["box pinned 1"]);
  });

  it("a pin at heads not here yet is drawn as its hint until they arrive", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ P: link(g.url, { at: { heads: ["Hnothere"] } }) }));
    s = m.s;
    await until(() => s.debug.view.linkState(["P"]) != null);
    expect(s.debug.view.linkState(["P"])).toEqual({ role: "pinned", open: false });
    expect(stageAt(s, "P")).toBe(null);
  });
});

describe("fixing a link at a version, and following latest again", () => {
  it("fixPoint holds G's heads and every doc reached through it (a doc it links, the container its extension read); a pin of it is whole", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const box = repo.add({ n: 1 });
    const inner = repo.add(emptyScene({ title: "K", objects: {}, order: [] }));
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }), K: link(inner.url) }, order: ["card", "K"], traits: { "t.game": { box: box.url } } }));
    s = await mountStage({ repo, extensions: extensions(log), doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(game.url) }, order: ["table", "L"] } });
    await until(() => running(stageAt(s, "L")) && stageAt(s, "L", "K") && log.some((e) => e.startsWith("box acting")));
    const host = s.api("t.host");
    const point = host.fixPoint("L");
    expect(point).toEqual({ heads: game.heads(), deps: { [box.url]: box.heads(), [inner.url]: inner.heads() } });
    // fixed: G, K and the box are held there; each goes on live and the pin doesn't
    host.change((d) => (d.objects.L.at = JSON.parse(JSON.stringify(point))));
    await until(() => stageAt(s, "L")?.role === "pinned" && stageAt(s, "L", "K")?.role === "pinned");
    expect(host.link("L")).toEqual({ role: "pinned", open: true });
    expect(host.fixPoint("L")).toBe(null); // fixed already: Follow latest first
    game.change((d) => (d.title = "G later"));
    inner.change((d) => (d.title = "K later"));
    box.change((d) => (d.n = 2));
    await settle();
    expect(stageAt(s, "L").doc().title).toBe("G");
    expect(stageAt(s, "L", "K").doc().title).toBe("K");
    await until(() => log.includes("box pinned 1"));
    // Follow latest: live again, acting, as G is now
    host.change((d) => delete d.objects.L.at);
    await until(() => stageAt(s, "L")?.role === "acting" && running(stageAt(s, "L")));
    expect(stageAt(s, "L").doc().title).toBe("G later");
    expect(stageAt(s, "L", "K").role).toBe("acting");
    await until(() => log.includes("box acting 2"));
  });

  it("a link not open here has no version to fix", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith(() => ({ M: link("automerge:2222222222222222222222222222") }));
    s = m.s;
    await until(() => s.api("t.host").link("M")?.role === "closed");
    expect(s.api("t.host").fixPoint("M")).toBe(null);
  });

  it("the inspector's Fix at this version and Follow latest, on a link: in Edit, from the menu, as for built content", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": {} } }));
    s = await mountStage({ repo, extensions: [...extensions(log), { meta: { id: "scene.inspector" }, module: inspector }], doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(game.url) }, order: ["table", "L"] } });
    await until(() => running(stageAt(s, "L")));
    const api = s.api("scene.inspector");
    api.body.enter("edit");
    const ids = () => api.collect("commands").flatMap(({ id: ext, value }) => (value ?? []).filter((c) => c.state?.("L", { scene: api.scene(), local: api.local.get(), view: api.view.get() })).map((c) => `${ext}:${c.id}`));
    expect(ids()).toContain("scene.inspector:fix-version");
    expect(ids()).not.toContain("scene.inspector:follow-latest");
    // (G's heads as fixed: closing its acting stage then checkpoints its clock, which moves G on)
    const heads = game.heads();
    expect(api.run({ ext: "scene.inspector", command: "fix-version", target: "L" })).toBe(true);
    await until(() => stageAt(s, "L")?.role === "pinned");
    expect(s.doc().objects.L.at).toEqual({ heads });
    expect(ids()).toContain("scene.inspector:follow-latest");
    expect(ids()).not.toContain("scene.inspector:fix-version");
    expect(api.run({ ext: "scene.inspector", command: "follow-latest", target: "L" })).toBe(true);
    await until(() => stageAt(s, "L")?.role === "acting");
    expect("at" in s.doc().objects.L).toBe(false);
  });
});
