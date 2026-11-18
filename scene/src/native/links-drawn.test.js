// Pins, and a live doc linked twice (STAGE.md, "Views, stages and links", build step 13):
// every occurrence of a linked doc that isn't closed is opened. A live doc
// acts at one occurrence (the first in path order); every other live
// occurrence of it is closed, "repeat", with no stage, drawn as its hint. A
// pinned link is a read-only stage on its doc at the pinned heads; fixing a
// link holds the heads of every doc reached through it, so a pin is whole.
// Checked here without WebGL (frames from the docs' transforms, hits stubbed
// as the viewport would key them).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./link-graph.js";
import { keyOf } from "../stage/paths.js";
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
          // (an extension can't tell where it is placed: it can tell whether it may write)
          const as = () => (api.writable() ? "writable" : "read-only");
          api.use("clock").process({ start: () => log.push(`start ${as()}`), step: () => {} });
          const box = api.scene().traits["t.game"]?.box;
          if (box) api.repo.find(box).then((h) => log.push(`box ${as()} ${h.doc().n}`));
          return { input: { press: (ev) => (log.push(`press ${as()} ${ev.hit?.id}`), null) } };
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

describe("a live doc linked twice: one acting, one closed", () => {
  it("the first in path order acts; the other is closed, a repeat, with no stage of its own; only the acting one computes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && s.api("t.host").use("links").role("L2")?.role === "closed");
    const host = s.api("t.host");
    expect(host.use("links").role("L1")).toEqual({ role: "acting", open: true });
    expect(host.use("links").role("L2")).toEqual({ role: "closed", open: false, reason: "repeat" });
    expect(stageAt(s, "L1").role).toBe("acting");
    expect(stageAt(s, "L2")).toBe(null);
    expect(s.debug.view.stages().length).toBe(2);
    await settle();
    expect(m.log.filter((e) => e.startsWith("start"))).toEqual(["start writable"]);
  });

  it("a press on the repeat reaches the host as the link, never G; on the acting one, G first", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && s.api("t.host").use("links").role("L2")?.role === "closed");
    const press = async (key) => {
      m.log.length = 0;
      s.debug.viewport.pick = () => ({ id: key, point: [5, 0, 0], normal: [0, 1, 0], distance: 3 });
      s.pointer("pointerdown", 20, 20);
      s.pointer("pointerup", 20, 20);
      await settle();
      return [...m.log];
    };
    expect(await press(keyOf(0, "L2"))).toEqual(["host L2"]);
    expect(await press(keyOf(stageAt(s, "L1").n, "card"))).toEqual(["press writable card", "host L1"]);
  });

  it("the acting link removed: the repeat's occurrence opens and acts, in a stage of its own", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ L1: link(g.url, { transform: at(0) }), L2: link(g.url, { transform: at(5) }) }));
    s = m.s;
    await until(() => running(stageAt(s, "L1")) && s.api("t.host").use("links").role("L2")?.role === "closed");
    s.change((d) => {
      delete d.objects.L1;
      d.order.splice(d.order.indexOf("L1"), 1);
    });
    await until(() => stageAt(s, "L2")?.role === "acting" && running(stageAt(s, "L2")));
    expect(s.api("t.host").use("links").role("L2")).toEqual({ role: "acting", open: true });
    expect(stageAt(s, "L2").frame().pointOut([0, 0, 0])).toEqual([5, 0, 0]);
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
    expect(s.api("scene.links").use("links").role("P")).toEqual({ role: "pinned", open: true });
    expect(pin.doc().title).toBe("G then");
    game.change((d) => (d.title = "G later"));
    await settle();
    expect(pin.doc().title).toBe("G then");
    expect(stageAt(s, "P")).toBe(pin);
    await until(() => log.some((e) => e.startsWith("box")));
    expect(log).toEqual(["box read-only 1"]);
  });

  it("a pin at heads not here yet is drawn as its hint until they arrive", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith((g) => ({ P: link(g.url, { at: { heads: ["Hnothere"] } }) }));
    s = m.s;
    await until(() => s.api("t.host").use("links").role("P") != null);
    expect(s.api("t.host").use("links").role("P")).toEqual({ role: "pinned", open: false });
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
    await until(() => running(stageAt(s, "L")) && stageAt(s, "L", "K") && log.some((e) => e.startsWith("box writable")));
    const host = s.api("t.host");
    const point = host.use("links").fixPoint("L");
    expect(point).toEqual({ heads: game.heads(), deps: { [box.url]: box.heads(), [inner.url]: inner.heads() } });
    // fixed: G, K and the box are held there; each goes on live and the pin doesn't
    host.change((d) => (d.objects.L.at = JSON.parse(JSON.stringify(point))));
    await until(() => stageAt(s, "L")?.role === "pinned" && stageAt(s, "L", "K")?.role === "pinned");
    expect(host.use("links").role("L")).toEqual({ role: "pinned", open: true });
    expect(host.use("links").fixPoint("L")).toBe(null); // fixed already: Follow latest first
    game.change((d) => (d.title = "G later"));
    inner.change((d) => (d.title = "K later"));
    box.change((d) => (d.n = 2));
    await settle();
    expect(stageAt(s, "L").doc().title).toBe("G");
    expect(stageAt(s, "L", "K").doc().title).toBe("K");
    await until(() => log.includes("box read-only 1"));
    // Follow latest: live again, acting, as G is now
    host.change((d) => delete d.objects.L.at);
    await until(() => stageAt(s, "L")?.role === "acting" && running(stageAt(s, "L")));
    expect(stageAt(s, "L").doc().title).toBe("G later");
    expect(stageAt(s, "L", "K").role).toBe("acting");
    await until(() => log.includes("box writable 2"));
  });

  it("fixPoint holds only what the pin's docs name: a doc found that nothing names (a player's secret) is never recorded, one a named doc names (a deck's card file) is, and a listed package's folder is never reached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const file = repo.add({ "@patchwork": { type: "file" }, name: "red-7.glb" });
    const deck = repo.add({ faces: [{ sourceUrl: file.url }] });
    const secret = repo.add({ deckSecret: "00" });
    const pkgFile = repo.add({ content: JSON.stringify({ name: "a-package" }) });
    const folder = repo.add({ docs: [{ name: "package.json", url: pkgFile.url }] });
    const found = [];
    const find = repo.find.bind(repo);
    repo.find = (url, ...rest) => (found.push(url), find(url, ...rest));
    const keeper = {
      meta: { id: "t.keep", traits: ["t.game"] },
      module: {
        create: (api) => {
          (async () => {
            const d = await api.repo.find(api.scene().traits["t.game"].deck);
            await api.repo.find(d.doc().faces[0].sourceUrl);
            await api.repo.find(secret.url); // the viewer's own: named by no doc of the game's
            log.push("kept");
          })();
          return {};
        },
      },
    };
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card" }) }, order: ["card"], traits: { "t.game": { deck: deck.url } }, packages: [{ url: folder.url }] }));
    s = await mountStage({ repo, extensions: [keeper, ...extensions(log)], doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(game.url) }, order: ["table", "L"] } });
    await until(() => log.includes("kept") && found.includes(pkgFile.url));
    expect(s.api("t.host").use("links").fixPoint("L")).toEqual({ heads: game.heads(), deps: { [deck.url]: deck.heads(), [file.url]: file.heads() } });
  });

  // A find still on its way when Fix is asked: a pin made then would leave
  // that doc out of deps and show it live. So there's no fix point while a
  // doc the game names is still being found; once it's in, the whole one.
  it("no fix point while a doc the game names is still on its way; once found, it is held too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const deck = repo.add({ cards: 3 });
    let arrive = null;
    const find = repo.find.bind(repo);
    repo.find = (url, ...rest) => (url === deck.url ? new Promise((r) => (arrive = () => r(find(url, ...rest)))) : find(url, ...rest));
    const keeper = { meta: { id: "t.keep", traits: ["t.game"] }, module: { create: (api) => (void api.repo.find(api.scene().traits["t.game"].deck), {}) } };
    const game = repo.add(emptyScene({ title: "G", objects: {}, order: [], traits: { "t.game": { deck: deck.url } } }));
    s = await mountStage({ repo, extensions: [keeper, ...extensions([])], doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(game.url) }, order: ["table", "L"] } });
    await until(() => arrive != null && stageAt(s, "L")?.debug.host.instanceOf("t.keep"));
    expect(s.api("t.host").use("links").fixPoint("L")).toBe(null);
    arrive();
    await until(() => s.api("t.host").use("links").fixPoint("L") != null);
    expect(s.api("t.host").use("links").fixPoint("L")).toEqual({ heads: game.heads(), deps: { [deck.url]: deck.heads() } });
  });

  it("a pin is a function of its whole occurrence: its deps changed under the same heads, it opens again at them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const box = repo.add({ n: 1 });
    const boxThen = box.heads();
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": { box: box.url } } }));
    box.change((d) => (d.n = 2));
    const heads = game.heads();
    s = await mountStage({ repo, extensions: extensions(log), doc: { objects: { P: link(game.url, { at: { heads, deps: { [box.url]: boxThen } } }) }, order: ["P"] } });
    await until(() => log.includes("box read-only 1"));
    const pin = stageAt(s, "P");
    s.change((d) => (d.objects.P.at.deps[box.url] = box.heads()));
    await until(() => log.includes("box read-only 2"));
    expect(stageAt(s, "P")).not.toBe(pin);
    // and the same deps written in another order are the same occurrence: nothing reopens
    const now = stageAt(s, "P");
    s.change((d) => (d.objects.P.at.deps = { [box.url]: [...box.heads()].reverse() }));
    await settle();
    expect(stageAt(s, "P")).toBe(now);
  });

  it("a link not open here has no version to fix", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountWith(() => ({ M: link("automerge:2222222222222222222222222222") }));
    s = m.s;
    await until(() => s.api("t.host").use("links").role("M")?.role === "closed");
    expect(s.api("t.host").use("links").fixPoint("M")).toBe(null);
  });

  it("the inspector's Fix at this version and Follow latest, on a link: in Edit, from the menu, as for built content", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = [];
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": {} } }));
    s = await mountStage({ repo, extensions: [...extensions(log), { meta: { id: "scene.inspector" }, module: inspector }], doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(game.url) }, order: ["table", "L"] } });
    await until(() => running(stageAt(s, "L")));
    const api = s.api("scene.inspector");
    s.edit(true);
    const ids = () => api.collect("commands").flatMap(({ id: ext, value }) => (value ?? []).filter((c) => c.state?.("L", { scene: s.facet("scene.inspector").scene(), local: s.facet("scene.inspector").local.get(), view: s.facet("scene.inspector").view.get() })).map((c) => `${ext}:${c.id}`));
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
