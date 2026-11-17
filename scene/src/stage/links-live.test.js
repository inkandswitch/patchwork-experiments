// Links, open and live (STAGE.md build step 12): a live link's doc
// gets a stage of its own in the view, which runs that doc's extensions in
// its own frame, on its own channel. Checked here without WebGL: the frame
// comes from the host's doc (a link's transform), hits are stubbed as the
// viewport would key them (paths.js).

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until, wallAt } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { ARRIVE_WAIT_MS, startArrival } from "./view.js";
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
    expect(s.api("t.host").link("L")).toEqual({ role: "acting", open: true });
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
    // the game selects its card with the focus on the host: the selection is the element of the focus stage it's in, the link (H10)
    gapi.view.select("card");
    expect(s.debug.view.atom.get().selected).toEqual(["L"]);
    expect(hapi.view.get().selected).toBe("L");
    expect(gapi.view.get().selected).toBe(null);
    gapi.view.select(null);
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
    await until(() => s.api("t.host").link("M")?.role === "closed");
    expect(s.api("t.host").link("M")).toEqual({ role: "closed", open: false, reason: "unavailable" });
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
              const got = startArrival(stages[0], { doc: (s) => s.doc, next: (s) => (xs[s.i] === "stage" ? stages[s.i + 1] : xs[s.i] === "pending" ? undefined : null) });
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
