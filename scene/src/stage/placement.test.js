// I4, placement independence (COMPOSITION.md §2, Invariants): a stage's
// snapshot, running set, audience, looks and shown are functions of its doc
// and the registry, never of its host, the focus, the viewer's body or held
// tool, or whether it acts or mirrors. Checked over the finite case the
// invariant names: a synthetic game G in the shape of Lost Cities' (two
// extensions: seats, which contributes the roster and a seat body; a table
// whose audience reads the roster, and a lens showing this viewer what its
// audience lets it see) × seats {none, p1, p1 + p2} × clock {running,
// paused} × card state {dealt, p2's card played to the table}, open
//   - alone,
//   - linked into a host X at 0°, and mirrored there at 20° of heel,
//   - linked into a host X' at 20° of heel,
//   - linked into Y through X (two links deep),
// four views of one page on one repo, and in each view × body {look, edit,
// walk, seat} × held tool {none, one} × focus {outside, inside the link (a
// view with a link to enter)}: every one of G's stages agrees with G alone,
// every time, the doc's clock and what each stage's clock says among it.

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

describe("placement independence (I4): G alone, linked, heeled, mirrored, two links deep", () => {
  for (const [name, seats] of [["none", {}], ["p1", { p1: ME }], ["p1 + p2", { p1: ME, p2: BEN }]]) {
    it(`seats ${name}: every stage of G agrees with G alone, × clock × card state × body × held tool × focus`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const repo = new FakeRepo();
      const G = repo.add(emptyScene({ title: "G", objects: { h1: card("p1"), h2: card("p2"), t: card(null) }, order: ["h1", "h2", "t"], traits: { "t.game": { seats } } }));
      const X = repo.add(emptyScene({ title: "X", objects: { L: link(G.url, { transform: FLAT }), M: link(G.url, { transform: HEEL }) }, order: ["L", "M"] }));
      const X2 = repo.add(emptyScene({ title: "X'", objects: { L: link(G.url, { transform: HEEL }) }, order: ["L"] }));
      const Y = repo.add(emptyScene({ title: "Y", objects: { LX: link(X.url, { transform: HEEL }) }, order: ["LX"] }));
      // the first view registers the extensions (the harness's), on G itself
      const s = await mountStage({ repo, handle: undefined, viewerId: ME, extensions: EXTENSIONS, doc: { objects: {}, order: [] } });
      cleanups.push(() => s.unmount());
      const views = {
        alone: { v: await view(repo, G), into: [] },
        X: { v: await view(repo, X), into: ["L"] },
        "X'": { v: await view(repo, X2), into: ["L"] },
        Y: { v: await view(repo, Y), into: ["LX", "L"] },
      };
      const gStages = (v) => v.stages().filter((st) => st.url === G.url);
      const ready = (st) => st.debug.host.instanceOf("t.table") && st.debug.host.instanceOf("t.seats") && st.debug.looks().size === 3;
      await until(() => Object.values(views).every(({ v }) => gStages(v).length >= 1 && gStages(v).every(ready)) && gStages(views.X.v).length === 2, 4000);
      expect(gStages(views.X.v).map((st) => st.role).sort()).toEqual(["acting", "mirror"]);
      expect(gStages(views.Y.v).map((st) => st.role).sort()).toEqual(["acting", "mirror"]);
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
          await checkAll(want, `paused ${paused}, played ${played}`);
        }
      async function checkAll(want, state) {
        for (const [where, { v, into }] of Object.entries(views))
          for (const focus of into.length ? ["outside", "inside"] : ["outside"]) {
            if (focus === "inside") expect(v.enter(into)).toBe(true);
            for (const body of ["look", "edit", "t.walk", "t.sit"])
              for (const held of [false, true]) {
                expect(v.enterBody(body, null)).toBeTruthy();
                const acting = gStages(v).find((st) => st.acts);
                const release = held ? v.holdTool(keyOf(acting.n, "t.table"), { name: "Measure" }, {}) : null;
                await settle();
                for (const st of gStages(v)) {
                  const got = seen(st);
                  if (got !== want) throw new Error(`${where} ${st.role}, focus ${focus}, body ${body}, held ${held}, ${state}:\n${got}\n≠\n${want}`);
                  checked++;
                }
                release?.();
                v.enterBody("look", null);
              }
            if (focus === "inside") v.leave();
            await settle();
          }
      }
      // (alone: 1 stage, outside only; X, Y: acting + mirror; X': 1 — each × 2 foci) × 4 bodies × 2 held × 2 clock × 2 card states
      expect(checked).toBe((1 + 2 * 2 + 1 * 2 + 2 * 2) * 4 * 2 * 2 * 2);
    }, 90_000);
  }
});
