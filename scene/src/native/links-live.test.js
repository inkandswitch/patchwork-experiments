// Links, open and live (STAGE.md build step 12): a live link's doc
// gets a stage of its own in the view, which runs that doc's extensions in
// its own frame, on its own channel. Checked here without WebGL: the frame
// comes from the host's doc (a link's transform), hits are stubbed as the
// viewport would key them (paths.js). Also here: I1 on the outermost stage
// (every write and send through an api goes to its own stage's handle), and
// adding a scene doc as a link.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { NATIVES, mountStage, object, settle, wallAt } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo, fakeHead } from "../test/fake-repo.js";
import { LINK } from "./link-graph.js";
import { ARRIVE_WAIT_MS, startArrival } from "../stage/view.js";
import { keyOf } from "../stage/paths.js";
import { spy } from "../test/spy.js";
import keys from "../parts/keys.js";
import { add } from "../parts/editor.js";

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
    // a view plugin: it runs once, seated at the focus
    { meta: { id: "t.view", type: "scene:view" }, module: { create: () => ({ input: input("t.view") }) } },
    { meta: { id: "scene.keys" }, module: keys },
  ];
}

/** An extension that writes and sends through every api that does, once it has run `go`. */
const WRITER = {
  meta: { id: "t.writer", traits: ["t.writer"] },
  module: {
    create(api) {
      return {
        go() {
          api.change((d) => {
            d.objects.a.name = "written";
          });
          api.use("claims").claim("a", "t.hold");
          api.channel.send("t.ping", { n: 1 });
          api.channel.set("here", true);
          api.use("poses").hold("a", { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 });
          api.use("poses").release("a");
          api.change(api.remove(["b"]));
        },
      };
    },
  },
};

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
// Arrival polls on the page's timers (its retries until ARRIVE_WAIT_MS): faked, and moved on while a test waits
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());
/** Until fn() holds, the fake timers moving on 25 ms a step. */
const until = async (fn, ms = 1000) => {
  for (let waited = 0; !fn(); waited += 25) {
    if (waited > ms) throw new Error("timed out");
    await vi.advanceTimersByTimeAsync(25);
  }
};
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("I1: one doc per extension", () => {
  it("an extension of the outermost stage writes and sends only on its own handle", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    // another doc the repo holds: nothing may touch it
    const other = repo.add({ objects: { a: object() }, order: ["a"] });
    const otherLog = spy(other);
    s = await mountStage({ repo, extensions: [WRITER], doc: { objects: { a: object(), b: object() }, order: ["a", "b"], traits: { "t.writer": {} } } });
    await until(() => s.instance("t.writer"));
    const ownLog = spy(s.handle);
    s.instance("t.writer").go();
    await settle();
    expect(otherLog).toEqual([]);
    expect(ownLog).toContain("change");
    expect(ownLog.some((e) => e.startsWith("broadcast:"))).toBe(true);
    expect(s.doc().objects.a.name).toBe("written");
    expect(s.doc().objects.b).toBeUndefined();
  });
});

describe("a live link opens a stage for its doc", () => {
  it("adding a scene doc makes a live link: no render doc, routed as a scene, drawn as its hint; with heads, a pinned one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "Lost Cities" }));
    const EXT = { meta: { id: "t.any" }, module: { create: () => ({}) } };
    s = await mountStage({ repo, extensions: [EXT], doc: { objects: {}, order: [] } });
    const api = s.api("t.any");
    const id = await add(api, game.url, { hint: { bounds: { min: [-0.4, 0, -0.3], max: [0.4, 0.1, 0.3] } } });
    await settle();
    const o = s.doc().objects[id];
    expect(o).toMatchObject({ name: "Lost Cities", sourceUrl: game.url, providerId: LINK, renderUrl: null });
    expect(o.at).toBeUndefined();
    expect(api.loadState(id)).toMatchObject({ content: "scene" });
    expect(s.local.get().status[id]).toBeUndefined();
    const head = fakeHead();
    const pinned = await add(api, `${game.url}#${head}`);
    expect(s.doc().objects[pinned].at).toEqual({ heads: [head] });
    // a scene of itself, live: the expansion closes it (a cycle), so adding it is no error
    const self = await add(api, s.handle.url);
    expect(s.doc().objects[self].providerId).toBe(LINK);
  });

  it("the linked doc's extensions run in its stage, the host's in the host's, the view plugins once, offered at the focus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountLinked();
    s = m.s;
    const ids = (st) => st.debug.host.running().map((r) => r.id).filter((id) => !NATIVES.includes(id)).sort();
    expect(ids(m.g)).toEqual(["t.card", "t.game"]);
    expect(ids(s.debug.view.stage(0))).toEqual(["t.host"]);
    const at = (st) => s.debug.view.pluginsAt(st).map((p) => p.id).filter((id) => !NATIVES.includes(id));
    expect([at(s.debug.view.stage(0)), at(m.g)]).toEqual([["t.view", "scene.keys", "scene.edit"], []]);
    expect(m.g.path).toEqual(["L"]);
    expect(m.g.url).toBe(m.game.url);
    expect(s.api("t.host").use("links").role("L")).toEqual({ role: "acting", open: true });
    expect(s.api("t.host").use("links").role("table")).toBe(null);
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
    expect(m.log.map((e) => e.who)).toEqual(["t.card", "t.game", "t.host", "t.view"]);
    expect(m.log[0]).toMatchObject({ id: "card", point: [0, 1, 0], holder: "card" });
    expect(m.log[1]).toMatchObject({ id: "card", holder: null });
    // the host sees the link it's in, at the world point (its frame is the world)
    expect(m.log[2]).toMatchObject({ id: "L", point: [10, 1, 0], holder: "table" });
  });

  // I10: each stage sees its own element of the selection and the hover, or null
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
    // the game selects its card with the focus on the host: the selection is the element of the focus stage it's in, the link (H10)
    gapi.view.select("card");
    expect(s.debug.view.atom.get().selected).toEqual(["L"]);
    expect(hapi.view.get().selected).toBe("L");
    expect(gapi.view.get().selected).toBe(null);
    gapi.view.select(null);
    // editing, a click on the card from outside selects the link (the focus is the host's)
    s.edit(true);
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
    await until(() => s.api("t.host").use("links").role("M")?.role === "closed");
    expect(s.api("t.host").use("links").role("M")).toEqual({ role: "closed", open: false, reason: "unavailable" });
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

  // A start whose place is a link arrives through it, as the linked doc
  // starts people (STAGE.md, "Arriving"): the second of two games, named by its link,
  // whatever the first offers; the game's own start body and place.
  it("a start placed on a link arrives as the linked doc starts people, in its stage, whichever link comes first", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const entered = [];
    const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: (api) => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: (place) => (entered.push([api.scene().traits["t.game"].name, place]), { input: {} }) }] }) } };
    const repo = new FakeRepo();
    const ga = repo.add(emptyScene({ title: "GA", objects: {}, order: [], traits: { "t.game": { name: "GA" } }, view: { start: { body: "t.sit" } } }));
    const gb = repo.add(emptyScene({ title: "GB", objects: {}, order: [], traits: { "t.game": { name: "GB" } }, view: { start: { body: "t.sit", place: "p2" } } }));
    s = await mountStage({
      repo,
      extensions: [SEATISH],
      doc: {
        objects: { "link-a": object({ name: "A", sourceUrl: ga.url, providerId: LINK, renderUrl: null }), "link-b": object({ name: "B", sourceUrl: gb.url, providerId: LINK, renderUrl: null }) },
        order: ["link-a", "link-b"],
        // the host's own body is no part of it: the linked doc says
        view: { start: { place: "link-b" } },
      },
    });
    await until(() => s.debug.view.atom.get().body.id === "t.sit");
    expect(entered).toEqual([["GB", "p2"]]);
  });

  // A place is the linked doc's (I2: nothing crosses docs), so arriving
  // through a link enters that doc's stage's body or none. Another linked
  // game offering the same body never takes it: not when the named doc
  // offers no such body, and not while the named doc's stage is starting
  // (the sibling started first).
  for (const gb of ["offers no such body", "is still starting"]) {
    it(`a start placed on a link whose doc ${gb}: never a sibling's body with that doc's place`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const entered = [];
      const seat = { create: (api) => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: (place) => (entered.push([api.url, place]), { input: {} }) }] }) };
      let open = () => {};
      // (the harness's load returns this: GB's extension loads when the gate opens)
      const gated = new Promise((r) => (open = () => r(seat)));
      const repo = new FakeRepo();
      const ga = repo.add(emptyScene({ title: "GA", objects: {}, order: [], traits: { "t.game": {} } }));
      const gbDoc = repo.add(emptyScene({ title: "GB", objects: {}, order: [], traits: gb === "is still starting" ? { "t.gb": {} } : {}, view: { start: { body: "t.sit", place: "p2" } } }));
      s = await mountStage({
        repo,
        extensions: [
          { meta: { id: "t.seatish", traits: ["t.game"] }, module: seat },
          { meta: { id: "t.gbseat", traits: ["t.gb"] }, module: gated },
        ],
        doc: {
          objects: { "link-a": object({ name: "A", sourceUrl: ga.url, providerId: LINK, renderUrl: null }), "link-b": object({ name: "B", sourceUrl: gbDoc.url, providerId: LINK, renderUrl: null }) },
          order: ["link-a", "link-b"],
          view: { start: { place: "link-b" } },
        },
      });
      await until(() => s.debug.view.stages().length === 3);
      const ga1 = s.debug.view.stages().find((x) => x.url === ga.url);
      await until(() => ga1.debug.host.instanceOf("t.seatish"));
      await settle();
      await settle();
      expect(entered).toEqual([]);
      expect(s.debug.view.atom.get().body.id).toBe("look");
      if (gb === "offers no such body") {
        // settled without it: nobody arrives
        expect(s.debug.view.arriving()).toBe(null);
        return;
      }
      // still waiting on GB; once its extension is in, GB's body, GB's place
      expect(s.debug.view.arriving()).not.toBe(null);
      open();
      await until(() => s.debug.view.atom.get().body.id === "t.sit");
      expect(entered).toEqual([[gbDoc.url, "p2"]]);
    });
  }

  it("a start placed on a pinned link, a repeat or a closed one arrives nowhere: Look, nothing entered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const kind of ["pinned", "repeat", "closed"]) {
      const entered = [];
      const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: () => (entered.push(1), { input: {} }) }] }) } };
      const repo = new FakeRepo();
      const g = repo.add(emptyScene({ title: "G", objects: {}, order: [], traits: { "t.game": {} }, view: { start: { body: "t.sit" } } }));
      const link = (extra = {}) => object({ name: "G", sourceUrl: g.url, providerId: LINK, renderUrl: null, ...extra });
      const objects =
        kind === "pinned" ? { m: link({ at: { heads: g.heads() } }) } : kind === "repeat" ? { a: link(), m: link() } : { m: link({ sourceUrl: "automerge:2j9knnaaaaaaaaaaaaaaaaaaaaaa" }) };
      // (in the repeat's case, link "a" comes first in path order: the doc acts there, and "m" is closed, a repeat)
      s = await mountStage({ repo, extensions: [SEATISH], doc: { objects, order: Object.keys(objects), view: { start: { body: "t.sit", place: "m" } } } });
      await settle();
      await settle();
      expect(entered, kind).toEqual([]);
      expect(s.debug.view.atom.get().body.id, kind).toBe("look");
      expect(s.debug.view.arriving(), kind).toBe(null);
      s.unmount();
      s = null;
    }
  });

  // api.open is any view plugin's: a doc another opened acting first doesn't act at its link too (the
  // kernel refuses), and links holds arriving only while a doc is on its way, not for a stage that never comes.
  it("a start placed on a link whose doc another view plugin opened acting first arrives nowhere, and arriving ends", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const entered = [];
    const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: () => (entered.push(1), { input: {} }) }] }) } };
    let open;
    const gate = new Promise((r) => (open = r));
    class GatedRepo extends FakeRepo {
      async find(url) {
        if (url === g.url) await gate;
        return super.find(url);
      }
    }
    const repo = new GatedRepo();
    const g = repo.add(emptyScene({ title: "G", objects: {}, order: [], traits: { "t.game": {} }, view: { start: { body: "t.sit" } } }));
    const taker = { meta: { id: "t.taker", type: "scene:view" }, module: { create: () => ({}) } };
    const objects = { x: object({ name: "X" }), m: object({ name: "G", sourceUrl: g.url, providerId: LINK, renderUrl: null }) };
    s = await mountStage({ repo, extensions: [SEATISH, taker], doc: { objects, order: ["x", "m"], view: { start: { body: "t.sit", place: "m" } } } });
    await until(() => s.instance("t.taker"));
    expect(!!s.api("t.taker").open(g, { under: [[], "x"] })).toBe(true);
    expect(s.debug.view.arriving()).toEqual({ pending: true });
    open();
    await until(() => s.debug.view.arriving() === null, 2000);
    expect([entered, s.debug.view.atom.get().body.id, s.api("t.taker").use("links").role("m")]).toEqual([[], "look", { role: "acting", open: false }]);
  });

  // A body may refuse at the moment it's offered (a seat not yet laid, its
  // doc not yet in). The start stays pending and the body is asked again
  // until ARRIVE_WAIT_MS after the offer; past that, nobody arrives. Every
  // case: refusals 0, 1, 2 or past the wait, × a start the host's stage
  // answers or one placed on a link (answered in the linked doc's stage).
  for (const through of [false, true])
    for (const refusals of [0, 1, 2, "past the wait"]) {
      it(`a body that refuses ${refusals === "past the wait" ? "until past ARRIVE_WAIT_MS" : `${refusals} time(s)`} when offered${through ? ", through a link" : ""}: ${refusals === "past the wait" ? "nobody arrives" : "entered on the next try"}`, async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        let clockNow = 1_000_000;
        const asked = [];
        const enter = (place) => {
          asked.push(place);
          if (refusals === "past the wait") {
            clockNow += ARRIVE_WAIT_MS / 2; // each refusal takes half the wait
            return null;
          }
          return asked.length > refusals ? { input: {} } : null;
        };
        const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: () => ({ bodies: [{ id: "t.sit", label: "Sitting", enter }] }) } };
        const repo = new FakeRepo();
        const game = repo.add(emptyScene({ title: "G", objects: {}, order: [], traits: { "t.game": {} }, view: { start: { body: "t.sit", place: "p1" } } }));
        const doc = through
          ? { objects: { L: object({ name: "Game", sourceUrl: game.url, providerId: LINK, renderUrl: null }) }, order: ["L"], view: { start: { place: "L" } } }
          : { objects: {}, order: [], traits: { "t.game": {} }, view: { start: { body: "t.sit", place: "p1" } } };
        s = await mountStage({ repo, extensions: [SEATISH], doc, time: wallAt(() => clockNow) });
        if (refusals === "past the wait") {
          await until(() => s.debug.view.arriving() === null, 3000);
          expect(s.debug.view.atom.get().body.id).toBe("look");
          // asked at the offer, again within the wait, once at its end, then no more
          expect(asked).toEqual(["p1", "p1", "p1"]);
          return;
        }
        await until(() => s.debug.view.atom.get().body.id === "t.sit", 3000);
        expect(asked).toEqual(Array(refusals + 1).fill("p1"));
        expect(s.debug.view.arriving()).toBe(null);
      });
    }

  // Two linked games offer the start body. Which one a viewer arrives in is
  // the doc's structure (links in path order), never which game's doc came
  // over the network first: both arrival orders, the same game.
  for (const first of ["A", "B"]) {
    it(`two linked games offering the start body: the first link's, whichever doc loads first (${first} first)`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const entered = [];
      const SEATISH = { meta: { id: "t.seatish", traits: ["t.game"] }, module: { create: (api) => ({ bodies: [{ id: "t.sit", label: "Sitting", enter: () => (entered.push(api.scene().traits["t.game"].name), { input: {} }) }] }) } };
      const gates = new Map();
      class GatedRepo extends FakeRepo {
        async find(url) {
          await gates.get(url)?.promise;
          return super.find(url);
        }
      }
      const repo = new GatedRepo();
      const ga = repo.add(emptyScene({ title: "GA", objects: {}, order: [], traits: { "t.game": { name: "GA" } } }));
      const gb = repo.add(emptyScene({ title: "GB", objects: {}, order: [], traits: { "t.game": { name: "GB" } } }));
      const late = first === "A" ? gb : ga;
      let open;
      gates.set(late.url, { promise: new Promise((r) => (open = r)) });
      s = await mountStage({
        repo,
        extensions: [SEATISH],
        doc: {
          objects: { "link-a": object({ name: "A", sourceUrl: ga.url, providerId: LINK, renderUrl: null }), "link-b": object({ name: "B", sourceUrl: gb.url, providerId: LINK, renderUrl: null }) },
          order: ["link-b", "link-a"],
          view: { start: { body: "t.sit" } },
        },
      });
      await until(() => s.debug.view.stages().length === 2);
      await settle();
      expect(entered).toEqual([]); // the other link is still on its way
      open();
      await until(() => s.debug.view.atom.get().body.id === "t.sit");
      expect(entered).toEqual(["GA"]);
    });
  }
});

describe("startArrival: where a start leads, over every chain of up to two links", () => {
  // a stage per depth, each doc's start placed on nothing, an object, or its link to the next;
  // the link's stage there, not yet, or nobody arrives through it
  const link = (url) => ({ providerId: LINK, sourceUrl: url });
  it("ends at the first start not placed on a link; undefined while a link's stage is on its way; null through a pin or a closed link", () => {
    const places = ["none", "object", "link"];
    const nexts = ["stage", "pending", "refused"];
    let n = 0;
    for (const p0 of places)
      for (const p1 of places)
        for (const p2 of ["none", "object"])
          for (const x0 of nexts)
            for (const x1 of nexts) {
              const stages = [0, 1, 2].map((i) => ({
                i,
                doc: {
                  objects: { thing: { name: "Thing" }, L: link(`automerge:d${i + 1}`) },
                  view: { start: { body: `b${i}`, ...([p0, p1, p2][i] === "none" ? {} : { place: [p0, p1, p2][i] === "object" ? "thing" : "L" }) } },
                },
              }));
              const xs = [x0, x1];
              const got = startArrival(stages[0], { doc: (s) => s.doc, next: (s, id) => (id !== "L" ? false : xs[s.i] === "stage" ? stages[s.i + 1] : xs[s.i] === "pending" ? undefined : null) });
              // the model: walk while the place is a link
              let want;
              for (let i = 0; ; i++) {
                const place = [p0, p1, p2][i];
                if (place !== "link") {
                  want = { stage: stages[i], body: `b${i}`, place: place === "object" ? "thing" : null, through: i > 0 };
                  break;
                }
                if (xs[i] !== "stage") {
                  want = xs[i] === "pending" ? undefined : null;
                  break;
                }
              }
              expect(got, `${p0}/${p1}/${p2} ${x0}/${x1}`).toEqual(want);
              n++;
            }
    expect(n).toBe(3 * 3 * 2 * 3 * 3);
  });
});
