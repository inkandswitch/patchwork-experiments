// I4, placement independence (STAGE.md, "Views, stages and links", Invariants): a stage's
// snapshot, running set, audience, looks and shown are functions of its doc
// and the registry, never of its host, the focus, the viewer's body or held
// tool. Checked over the finite case the
// invariant names: a synthetic game G in the shape of Lost Cities' (two
// extensions: seats, which contributes the roster and a seat body; a table
// whose audience reads the roster, and a lens showing this viewer what its
// audience lets it see) × seats {none, p1, p1 + p2} × clock {running,
// paused} × card state {dealt, p2's card played to the table}, open
//   - alone,
//   - linked into a host X at 0°,
//   - linked into a host X' at 20° of heel,
//   - linked into Y through X (two links deep),
//   - pinned in a host P at G's heads when the case starts (checked in the
//     first state only, the one its heads hold, with no tool held and no
//     seat taken, as a pin acts for nobody),
// five views of one page on one repo, and in each view × body {look, edit,
// walk, seat} × held tool {none, one} × focus {outside, inside the link (a
// view with a link to enter)}: every one of G's stages agrees with G alone,
// every time, the doc's clock and what each stage's clock says among it.
// The one read that does depend on placement, api.ambient (W7), is checked
// beside it: its value is the world's (G's own alone, its outermost host's
// linked), and `mine`, `frame` and `clock` say where G sits.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { keyOf } from "./paths.js";
import { readClock } from "./clock.js";

const ME = "automerge:ana";
const BEN = "automerge:ben";
const HEEL = { position: [0, 0, 0], rotation: [(20 * Math.PI) / 180, 0, 0], scale: 1 };
const FLAT = { position: [3, 0, 0], rotation: [0, 0, 0], scale: 1 };

const EXTENSIONS = [
  {
    meta: { id: "t.seats", traits: ["t.game"] },
    module: {
      create: () => ({
        roster: {
          viewers: (snap) => Object.values(snap.traits["t.game"].seats ?? {}).filter(Boolean),
          playerAt: (snap, seat) => snap.traits["t.game"].seats?.[seat] ?? null,
        },
        bodies: [{ id: "t.sit", label: "Player 1", here: false, enter: () => ({ input: {} }) }],
      }),
    },
  },
  {
    meta: { id: "t.table", traits: ["t.game"] },
    module: {
      create: (api) => {
        const roster = () => api.collect("roster").map((r) => r.value).find((r) => typeof r?.playerAt === "function") ?? null;
        return {
          // G offers an ambient of its own, which counts only where G is the world
          ambient: () => ({ "t.x": { by: api.doc().title } }),
          audience: (snap) => (id) => {
            const seat = snap.objects[id]?.traits?.["t.hand"]?.seat;
            if (!seat) return snap.objects[id]?.traits?.["t.card"] ? { show: "all" } : null;
            const who = roster()?.playerAt(snap, seat);
            return { show: who ? [who] : [], only: who ? [who] : [] };
          },
          looks: () => {
            const out = new Map();
            for (const id of Object.keys(api.scene().objects)) {
              if (!api.scene().objects[id].traits?.["t.card"]) continue;
              const a = api.audience(id);
              out.set(id, a === "all" || (Array.isArray(a) && a.includes(api.viewer)) ? { name: `face ${id}` } : { veil: true });
            }
            return out;
          },
        };
      },
    },
  },
  // what every host offers as its world's ambient "t.x"
  { meta: { id: "t.host", traits: ["t.host"] }, module: { create: (api) => ({ ambient: () => ({ "t.x": { by: api.doc().title } }) }) } },
  // a body anyone can take anywhere (a general part's, as walk's is)
  { meta: { id: "t.walk" }, module: { create: () => ({ bodies: [{ id: "t.walk", label: "Walk", enter: () => ({ input: {}, leave() {} }) }] }) } },
];

const card = (seat) => object({ name: "Card", traits: { "t.card": {}, ...(seat ? { "t.hand": { seat } } : {}) } });
const link = (url, extra = {}) => object({ name: "Game", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

/** Another view of `handle` on the same page and repo (the harness registered the extensions). */
async function view(repo, handle) {
  const { default: Stage } = await import("./stage.js");
  const el = document.createElement("div");
  el.repo = repo;
  el.viewerId = ME;
  el.packageSettleMs = 0;
  document.body.append(el);
  const unmount = Stage(handle, el);
  cleanups.push(() => {
    unmount();
    el.remove();
  });
  await settle();
  return el.querySelector(".scene-stage").__sceneDebug.view;
}

/** What I4 says is G's own, as one of G's stages has it. */
function seen(st) {
  const api = st.debug.host.record("t.table").api;
  const snap = st.scene();
  return JSON.stringify({
    objects: snap.objects,
    traits: snap.traits,
    running: st.debug.host.running().filter((r) => r.scope !== "general").map((r) => r.id).sort(),
    // the doc's clock, and the stage's own reading of it (its t moves with each view's frames, so only whether it runs)
    clock: { doc: readClock(st.doc()).running, api: api.clock.running() },
    cards: ["h1", "h2", "t"].map((id) => [id, api.audience(id), api.shown(id), st.debug.looks().get(id) ?? null]),
  });
}

/**
 * The reads that do depend on placement, and only as I4 says (W7): what
 * api.ambient gives one of G's stages. Its value is the world's (G's own
 * alone, its outermost host's when linked, whatever G offers), `mine` holds
 * exactly where G is the world, its frame is the stage's own and its clock
 * the outermost's world time.
 */
function ambientSeen(st, world) {
  const a = st.debug.host.record("t.table").api.ambient("t.x");
  return { value: a.value, mine: a.mine, frame: a.frame?.matrix ?? null, running: a.clock.running, want: { value: world.ambients()["t.x"], mine: world === st, frame: st.frame()?.matrix ?? null, running: world.worldTime().running } };
}

describe("placement independence (I4): G alone, linked, heeled, two links deep", () => {
  for (const [name, seats] of [["none", {}], ["p1", { p1: ME }], ["p1 + p2", { p1: ME, p2: BEN }]]) {
    it(`seats ${name}: every stage of G agrees with G alone, × clock × card state × body × held tool × focus`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const repo = new FakeRepo();
      const G = repo.add(emptyScene({ title: "G", objects: { h1: card("p1"), h2: card("p2"), t: card(null) }, order: ["h1", "h2", "t"], traits: { "t.game": { seats } } }));
      const host = { "t.host": {} };
      const X = repo.add(emptyScene({ title: "X", traits: host, objects: { L: link(G.url, { transform: FLAT }) }, order: ["L"] }));
      const X2 = repo.add(emptyScene({ title: "X'", traits: host, objects: { L: link(G.url, { transform: HEEL }) }, order: ["L"] }));
      const Y = repo.add(emptyScene({ title: "Y", traits: host, objects: { LX: link(X.url, { transform: HEEL }) }, order: ["LX"] }));
      const P = repo.add(emptyScene({ title: "P", traits: host, objects: { L: link(G.url, { transform: FLAT, at: { heads: G.heads() } }) }, order: ["L"] }));
      // the first view registers the extensions (the harness's), on G itself
      const s = await mountStage({ repo, handle: undefined, viewerId: ME, extensions: EXTENSIONS, doc: { objects: {}, order: [] } });
      cleanups.push(() => s.unmount());
      const views = {
        alone: { v: await view(repo, G), into: [] },
        X: { v: await view(repo, X), into: ["L"] },
        "X'": { v: await view(repo, X2), into: ["L"] },
        Y: { v: await view(repo, Y), into: ["LX", "L"] },
        P: { v: await view(repo, P), into: [], pinned: true },
      };
      // (a pin's url carries its heads)
      const gStages = (v) => v.stages().filter((st) => st.url.split("#")[0] === G.url);
      const ready = (st) => st.debug.host.instanceOf("t.table") && st.debug.host.instanceOf("t.seats") && st.debug.looks().size === 3;
      await until(() => Object.values(views).every(({ v }) => gStages(v).length === 1 && gStages(v).every(ready)), 4000);
      for (const { v, pinned } of Object.values(views)) expect(gStages(v).map((st) => st.role)).toEqual([pinned ? "pinned" : "acting"]);
      // G's extensions see G: no other stage's reader (api.path is a general part's only)
      for (const { v } of Object.values(views)) for (const st of gStages(v)) for (const ext of ["t.table", "t.seats"]) expect(st.debug.host.record(ext).api.path).toBeUndefined();

      let checked = 0;
      for (const paused of [false, true])
        for (const played of [false, true]) {
          if (paused && !played) {
            gStages(views.alone.v)[0].debug.host.record("t.table").api.clock.pause();
            await settle();
          }
          // p2's card played to the table (its hand trait gone), or back in p2's hand
          G.change((d) => {
            if (played) delete d.objects.h2.traits["t.hand"];
            else d.objects.h2.traits["t.hand"] = { seat: "p2" };
          });
          await settle();
          const want = seen(gStages(views.alone.v)[0]);
          // (what that is: my hand's face is mine exactly when I sit at p1; a played card's is everyone's; the clock as set)
          const w = JSON.parse(want);
          expect(w.cards[0][3]).toEqual(seats.p1 ? { name: "face h1" } : { veil: true });
          expect(w.cards[1][1]).toEqual(played ? "all" : seats.p2 ? [seats.p2] : []);
          expect(w.clock).toEqual({ doc: !paused, api: !paused });
          await checkAll(want, `paused ${paused}, played ${played}`, !paused && !played);
        }
      async function checkAll(want, state, first) {
        for (const [where, { v, into, pinned }] of Object.entries(views)) {
          if (pinned && !first) continue;
          for (const focus of into.length ? ["outside", "inside"] : ["outside"]) {
            if (focus === "inside") expect(v.enter(into)).toBe(true);
            // (a pin offers no seat: it acts for nobody)
            // ("edit": Look holding the editor, which is no body)
            for (const body of pinned ? ["look", "edit", "t.walk"] : ["look", "edit", "t.walk", "t.sit"])
              for (const held of pinned ? [false] : [false, true]) {
                v.setEditing(body === "edit");
                expect(v.enterBody(body === "edit" ? "look" : body, null)).toBeTruthy();
                const acting = gStages(v).find((st) => st.acts);
                const release = held ? v.holdTool(keyOf(acting.n, "t.table"), { name: "Measure" }, {}) : null;
                await settle();
                for (const st of gStages(v)) {
                  const got = seen(st);
                  if (got !== want) throw new Error(`${where} ${st.role}, focus ${focus}, body ${body}, held ${held}, ${state}:\n${got}\n≠\n${want}`);
                  // W7: the ambient read is the world's, and says where G sits
                  const amb = ambientSeen(st, v.outermost());
                  expect(amb.value).toBe(amb.want.value);
                  expect(amb.value).toEqual({ by: where === "alone" ? "G" : where });
                  expect(amb.mine).toBe(where === "alone");
                  expect(amb.mine).toBe(amb.want.mine);
                  expect(amb.frame).toEqual(amb.want.frame);
                  expect(amb.running).toBe(amb.want.running);
                  checked++;
                }
                release?.();
                v.enterBody("look", null);
              }
            if (focus === "inside") v.leave();
            await settle();
          }
        }
      }
      // (alone: 1 stage, outside only; X, X', Y: 1 stage each × 2 foci) × 4 bodies × 2 held × 2 clock × 2 card states; P: 3 bodies, in the first state
      expect(checked).toBe((1 + 3 * 2) * 4 * 2 * 2 * 2 + 3);
    }, 90_000);
  }
});
