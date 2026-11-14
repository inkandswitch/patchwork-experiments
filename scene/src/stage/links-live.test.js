// Links, open and live (COMPOSITION.md build step 12): a live link's doc
// gets a stage of its own in the view, which runs that doc's extensions in
// its own frame, on its own channel. Checked here without WebGL: the frame
// comes from the host's doc (a link's transform), hits are stubbed as the
// viewport would key them (paths.js).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { keyOf } from "./paths.js";
import { spy } from "../test/spy.js";
import keys from "../parts/keys.js";

const LINKED_AT = { position: [10, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** A game's extension: a holder on its cards (trait t.card) and one on its root (t.game), recording what reaches it. */
function gameExtensions(log) {
  const input = (who) => ({
    press(ev) {
      log.push({ who, id: ev.hit?.id ?? null, point: ev.hit?.point ?? null, holder: ev.holder ?? null });
      return null;
    },
  });
  return [
    { meta: { id: "t.card", traits: ["t.card"] }, module: { create: (api) => ({ input: input("t.card"), commands: [{ id: "draw", name: "Draw", key: "d", state: (t, ctx) => (t != null && ctx.scene.objects?.[t]?.traits?.["t.card"] ? { title: "Draw it" } : null), run: (t) => api.change((d) => (d.objects[t].name = "drawn")) }], go: () => api.change((d) => (d.objects.card.name = "touched")) }) } },
    { meta: { id: "t.game", traits: ["t.game"] }, module: { create: () => ({ input: input("t.game") }) } },
    { meta: { id: "t.host", traits: ["t.host"] }, module: { create: (api) => ({ input: input("t.host"), go: () => api.change((d) => (d.title = "host touched")) }) } },
    // a general one: it runs once, at the focus
    { meta: { id: "t.general" }, module: { create: () => ({ input: input("t.general") }) } },
    { meta: { id: "scene.keys" }, module: keys },
  ];
}

/** A game doc G (a card on its root, traits) and a host with a link to G at LINKED_AT, mounted. */
async function mountLinked({ log = [] } = {}) {
  const repo = new FakeRepo();
  const game = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"], traits: { "t.game": {} } }));
  const s = await mountStage({
    repo,
    extensions: gameExtensions(log),
    doc: { objects: { table: object({ name: "Table", traits: { "t.host": {} } }), L: object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null, parent: "table", transform: LINKED_AT }) }, order: ["table", "L"] },
  });
  await until(() => s.debug.view.stages().length === 2 && s.debug.view.stages()[1].debug.host.instanceOf("t.card"));
  const g = s.debug.view.stages().find((x) => x.n !== 0);
  return { s, repo, game, g, log };
}

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("a live link opens a stage for its doc", () => {
  it("the linked doc's extensions run in its stage, the host's in the host's, the general ones once, at the focus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    const ids = (st) => st.debug.host.running().map((r) => r.id).sort();
    expect(ids(m.g)).toEqual(["t.card", "t.game"]);
    expect(ids(s.debug.view.stage(0))).toEqual(["scene.keys", "t.general", "t.host"]);
    expect(m.g.path).toEqual(["L"]);
    expect(m.g.url).toBe(m.game.url);
    expect(s.api("t.host").link("L")).toEqual({ state: "open" });
    expect(s.api("t.host").link("table")).toBe(null);
    // the game's api is the game's: its url, its scene, its root at null
    const gapi = m.g.debug.host.record("t.card").api;
    expect(gapi.url).toBe(m.game.url);
    expect(Object.keys(gapi.scene().objects)).toEqual(["card"]);
  });

  it("I1 across a link: each extension writes only its own doc", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    const hostLog = spy(s.handle);
    const gameLog = spy(m.game);
    m.g.debug.host.instanceOf("t.card").go();
    expect(gameLog).toEqual(["change"]);
    expect(hostLog).toEqual([]);
    s.instance("t.host").go();
    expect(hostLog).toEqual(["change"]);
    expect(gameLog).toEqual(["change"]);
    expect(m.game.doc().objects.card.name).toBe("touched");
    expect(s.doc().title).toBe("host touched");
  });

  it("a press on a linked card: the game's segment first (its holders, then its root's), then the host's, each with its own element in its own frame", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    s.debug.viewport.pick = () => ({ id: keyOf(m.g.n, "card"), point: [10, 1, 0], normal: [0, 1, 0], distance: 3 });
    s.pointer("pointerdown", 20, 20);
    s.pointer("pointerup", 20, 20);
    await settle();
    expect(m.log.map((e) => e.who)).toEqual(["t.card", "t.game", "t.host", "t.general"]);
    expect(m.log[0]).toMatchObject({ id: "card", point: [0, 1, 0], holder: "card" });
    expect(m.log[1]).toMatchObject({ id: "card", holder: null });
    // the host sees the link it's in, at the world point (its frame is the world)
    expect(m.log[2]).toMatchObject({ id: "L", point: [10, 1, 0], holder: "table" });
  });

  it("a press on the host's table never reaches the game: the doc boundary is the scope", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    s.debug.viewport.pick = () => ({ id: "table", point: [9, 0.7, 0], normal: [0, 1, 0], distance: 3 });
    s.pointer("pointerdown", 20, 20);
    s.pointer("pointerup", 20, 20);
    await settle();
    expect(m.log.map((e) => e.who)).toEqual(["t.host", "t.general"]);
  });

  it("hover and selection are paths: each stage sees its own element; selecting from outside selects the link", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    const gapi = m.g.debug.host.record("t.card").api;
    const hapi = s.api("t.host");
    s.debug.viewport.pick = () => ({ id: keyOf(m.g.n, "card"), point: [10, 1, 0], normal: [0, 1, 0], distance: 3 });
    s.pointer("pointermove", 20, 20, { buttons: 0 });
    await settle();
    expect(s.debug.view.atom.get().hovered).toEqual(["L", "card"]);
    expect(gapi.view.get().hovered).toBe("card");
    expect(hapi.view.get().hovered).toBe("L");
    // the game selects its card: the host sees the link selected
    gapi.view.select("card");
    expect(s.debug.view.atom.get().selected).toEqual(["L", "card"]);
    expect(hapi.view.get().selected).toBe("L");
    // in Edit, a click on the card from outside selects the link (the focus is the host's)
    hapi.body.enter("edit");
    s.click(20, 20);
    await settle();
    expect(s.debug.view.atom.get().selected).toEqual(["L"]);
    expect(gapi.view.get().selected).toBe(null);
  });

  it("the key map reaches across a link: D on a linked card runs the game's Draw, in the game", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    s.debug.viewport.pick = () => ({ id: keyOf(m.g.n, "card"), point: [10, 1, 0], normal: [0, 1, 0], distance: 3 });
    s.pointer("pointermove", 20, 20, { buttons: 0 });
    await settle();
    s.key("d", { code: "KeyD" });
    await settle();
    expect(m.game.doc().objects.card.name).toBe("drawn");
    expect(s.doc().objects.card).toBeUndefined();
  });

  it("a link removed closes its stage; a link to a doc that can't be opened is closed, unavailable, and drawn as its hint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    s.change((d) => {
      delete d.objects.L;
      d.order.splice(d.order.indexOf("L"), 1);
    });
    await until(() => s.debug.view.stages().length === 1);
    s.change((d) => {
      d.objects.M = { name: "Gone", sourceUrl: "automerge:2222222222222222222222222222", providerId: LINK, renderUrl: null, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } };
      d.order.push("M");
    });
    await until(() => s.api("t.host").link("M")?.state === "closed");
    expect(s.api("t.host").link("M")).toEqual({ state: "closed", reason: "unavailable" });
  });
});

describe("one game in two views of one page: claims and presence per doc, over the page bus", () => {
  it("a claim taken in the game linked into one view is held for the game open alone in another; presence crosses too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    // a second view on the same repo: the game alone (the same handle, so the network never carries between them)
    const { default: Stage } = await import("./stage.js");
    const el = document.createElement("div");
    el.repo = m.repo;
    el.viewerId = "viewer:cara";
    document.body.append(el);
    const unmount = Stage(m.game, el);
    try {
      const alone = el.querySelector(".scene-stage").__sceneDebug;
      await until(() => alone.host.instanceOf("t.card"));
      const linkedApi = m.g.debug.host.record("t.card").api;
      const aloneApi = alone.host.record("t.card").api;
      expect(linkedApi.claim("card", "seat:p1")).toBeTypeOf("function");
      await settle();
      // the game alone hears the linked view's presence on the game's channel, so the claim counts there
      await until(() => Object.keys(aloneApi.presence.get()).includes(linkedApi.session));
      expect(aloneApi.claimedBy("card", "seat:p1")).toMatchObject({ session: linkedApi.session, mine: false });
      // and it can't take it
      expect(aloneApi.claim("card", "seat:p1")).toBe(null);
      // the host's channel is another doc's: the game alone hears nothing of it
      s.api("t.host").presence.set("here", true);
      await settle();
      expect(Object.values(aloneApi.presence.get()).some((p) => p.keys?.["t.host"])).toBe(false);
    } finally {
      unmount();
      el.remove();
    }
  });
});

describe("arriving through a link", () => {
  it("a host whose view.start names a body its linked doc offers waits for that doc, and enters it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: () => ({ input: {} }) }] }) } };
    const game = repo.add(emptyScene({ title: "G", objects: {}, order: [], traits: { "t.game": {} } }));
    s = await mountStage({
      repo,
      extensions: [SEATISH],
      doc: { objects: { L: object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null }) }, order: ["L"], view: { start: { body: "t.sit" } } },
    });
    await until(() => s.debug.view.atom.get().body.id === "t.sit");
    expect(s.debug.view.atom.get().body.label).toBe("Sitting");
  });
});
