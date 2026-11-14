// Presence where it is (COMPOSITION.md §3, TOOLS.md §6): what a general part
// draws of a doc's people is drawn in every doc that acts in the view, each
// in its own stage's frame, and the clock chips are the focus path's.
//
// A general part runs at the focus (create); in every other stage that acts
// the view runs its half (elsewhere), never alongside the whole part in one
// stage (a whole part lingering, holding a body, keeps its half out until it
// lets go). A pin and a mirror run neither. The harness is exhaustive over
// what decides it: every focus (each acting stage, depth ≤3) × where the
// viewer's body is held (nowhere, or in each acting stage) × before and after
// the body is let go, on one view of a tree with every stage role: acting at
// depths 0–3, a sibling acting off the focus path, a mirror (and its links,
// mirrors too) and a pin (its link closed). Each doc has one other person
// present in it, each from a view of their own on that doc alone (the page
// bus carries between them), so who is drawn where is exact: in each acting
// stage, the one person of its doc, at the point they said, in a layer of
// that stage's (hung under its root, so in its frame: I7); nobody in a mirror
// or a pin; and nobody twice.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { keyOf } from "./paths.js";
import clockPart from "../parts/clock.js";

const J = JSON.stringify;
const at = (x, y, z) => ({ position: [x, y, z], rotation: [0, 0, 0], scale: 1 });
const link = (url, name, extra = {}) => object({ name, sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

/**
 * The people part: a general part shaped as walk is. At the focus it offers
 * a body and says where its viewer is (`here`: a point in its doc's frame,
 * one per doc, from its title); whole or half, it draws everyone else who
 * says so on its doc's channel, a marker per person in its world layer.
 */
const POINT = { A: [1, 0, 0], B: [0, 2, 0], C: [0, 0, 3], D: [4, 4, 0], E: [0, 5, 5] };
function people(api, whole) {
  const layer = api.world();
  const marks = new Map(); // session → Object3D
  function draw() {
    const seen = new Set();
    for (const [session, p] of Object.entries(api.presence.get() ?? {})) {
      const here = p?.keys?.[api.id]?.here;
      if (session === api.session || !Array.isArray(here)) continue;
      seen.add(session);
      let m = marks.get(session);
      if (!m) {
        m = new api.THREE.Object3D();
        m.userData.viewer = p.viewer;
        layer.add(m);
        marks.set(session, m);
      }
      m.position.set(here[0], here[1], here[2]);
    }
    for (const [session, m] of marks) if (!seen.has(session)) (m.removeFromParent(), marks.delete(session));
  }
  api.presence.watch(draw);
  draw();
  return {
    whole,
    /** who it draws, where in its layer, and what its layer hangs under (the viewport's key of its stage's root: null, the outermost's) */
    drawn: () => [...marks.values()].map((m) => ({ viewer: m.userData.viewer, here: m.position.toArray(), under: m.parent?.userData.under ?? null })),
    update: draw,
  };
}
const PEOPLE = {
  meta: { id: "t.people" },
  module: {
    create(api) {
      const title = api.doc().title;
      if (POINT[title]) api.presence.set("here", POINT[title]);
      return { bodies: [{ id: "t.walk", label: "Walk", enter: () => ({ input: {} }) }], ...people(api, true) };
    },
    elsewhere: (api) => people(api, false),
  },
};
/** A process, where the doc says (a scene trait): so the doc has a clock to show. */
const PROC = { meta: { id: "t.proc", traits: ["t.proc"] }, module: { create: (api) => (api.clock.process({ step() {}, save() {} }), {}) } };
/** A general part with no half: it runs at the focus and nowhere else. */
const PLAIN = { meta: { id: "t.plain" }, module: { create: () => ({}) } };
const CHIP = { meta: { id: "scene.clock" }, module: clockPart };

/**
 * A: L and R live links to B (L acts, R mirrors it), P a pin of B, S a live
 * link to E (a sibling of L, off any focus inside L). B: M, live, to C. C: N,
 * live, to D. So the stages are A [], B [L], C [L/M], D [L/M/N] (three
 * deep), E [S], the mirrors [R], [R/M], [R/M/N], and the pin [P] (its M
 * closed: the pin holds no C). A, B and D have a process. Each link is
 * placed off its host's origin, so every stage's frame is its own.
 */
async function mountTree() {
  const repo = new FakeRepo();
  const d = repo.add(emptyScene({ title: "D", objects: { thing: object({ name: "Thing" }) }, order: ["thing"], traits: { "t.proc": {} } }));
  const c = repo.add(emptyScene({ title: "C", objects: { N: link(d.url, "D", { transform: at(0, 0, 30) }) }, order: ["N"] }));
  const b = repo.add(emptyScene({ title: "B", objects: { M: link(c.url, "C", { transform: at(0, 20, 0) }) }, order: ["M"], traits: { "t.proc": {} } }));
  const e = repo.add(emptyScene({ title: "E", objects: { thing: object({ name: "Thing" }) }, order: ["thing"] }));
  const objects = {
    L: link(b.url, "B", { transform: at(100, 0, 0) }),
    R: link(b.url, "B again", { transform: at(-100, 0, 0) }),
    P: link(b.url, "B fixed", { transform: at(0, 0, -100), at: { heads: b.heads() } }),
    S: link(e.url, "E", { transform: at(0, -50, 0) }),
  };
  const s = await mountStage({ repo, viewerId: "viewer:me", extensions: [PEOPLE, PROC, PLAIN, CHIP], doc: { title: "A", objects, order: Object.keys(objects), traits: { "t.proc": {} } } });
  const view = s.debug.view;
  await until(() => Object.keys(ROLE).every((p) => stageOf(view, p)), 4000);
  return { s, view, repo, docs: { A: s.handle, B: b, C: c, D: d, E: e } };
}

// every stage of the tree, by path: its role and its doc
const ROLE = {
  "": ["acting", "A"],
  L: ["acting", "B"],
  "L/M": ["acting", "C"],
  "L/M/N": ["acting", "D"],
  S: ["acting", "E"],
  R: ["mirror", "B"],
  "R/M": ["mirror", "C"],
  "R/M/N": ["mirror", "D"],
  P: ["pinned", "B"],
};
const ACTING = Object.keys(ROLE).filter((p) => ROLE[p][0] === "acting");
const pathOf = (p) => (p === "" ? [] : p.split("/"));
const stageOf = (view, p) => view.stages().find((x) => x.path.join("/") === p) ?? null;
const PROCS = new Set(["A", "B", "D"]);

/** One view per doc, each alone on it and present there (its people part at its focus says where it is). */
async function others(repo, docs) {
  const { default: Stage } = await import("./stage.js");
  const out = [];
  for (const [title, handle] of Object.entries(docs)) {
    const el = document.createElement("div");
    el.repo = repo;
    el.viewerId = `viewer:${title}`;
    el.packageSettleMs = 0;
    document.body.append(el);
    out.push({ title, unmount: Stage(handle, el), el });
  }
  return () => {
    for (const o of out) (o.unmount(), o.el.remove());
  };
}

/** What the view draws, and runs, where: each stage's whole part, its half, and who they draw. */
function picture(view) {
  const out = {};
  // (in the model's order, so equal pictures are equal strings)
  for (const p of Object.keys(ROLE)) {
    const x = stageOf(view, p);
    const whole = x.debug.host.record("t.people");
    const half = x.debug.host.halfRecord("t.people");
    const inst = whole?.state === "running" ? whole.instance : half?.state === "running" ? half.instance : null;
    out[p] = {
      whole: whole?.state === "running",
      lingering: x.debug.host.lingering("t.people"),
      half: half?.state === "running",
      drawn: inst ? inst.drawn().sort((a, b) => (a.viewer < b.viewer ? -1 : 1)) : [],
      // a part with no half is never run elsewhere: its half's record is inert
      plain: [x.debug.host.record("t.plain")?.state === "running", x.debug.host.halfRecord("t.plain")?.state ?? null],
    };
  }
  return out;
}

/** The viewport's key of the root of the stage at `p` (its link's node in its host's stage), null for the outermost: where its layers hang, so what they hold is in its frame (I7). */
function rootOf(view, p) {
  const path = pathOf(p);
  if (!path.length) return null;
  const host = view.stages().find((x) => x.path.join("/") === path.slice(0, -1).join("/") && x.acts);
  return keyOf(host.n, path.at(-1));
}

/** What the model says the picture is, at focus `f`, with the body held by the whole part at `held` (or null). */
function expected(view, f, held) {
  const out = {};
  for (const [p, [role, title]] of Object.entries(ROLE)) {
    const acts = role === "acting";
    const whole = acts && (p === f || p === held);
    out[p] = {
      whole,
      lingering: whole && p !== f,
      half: acts && !whole,
      // the one other person of this doc, where they said, in this stage's frame
      drawn: acts ? [{ viewer: `viewer:${title}`, here: POINT[title], under: rootOf(view, p) }] : [],
      plain: [acts && p === f, acts && p !== f ? "none" : null],
    };
  }
  return out;
}

/** The focus path's clocks, outermost first, as the model says: the stages from the outermost to `f` whose doc has a process. */
function expectedClocks(f) {
  const path = pathOf(f);
  const out = [];
  for (let i = 0; i <= path.length; i++) {
    const p = path.slice(0, i).join("/");
    if (PROCS.has(ROLE[p][1])) out.push(p);
  }
  return out;
}
/** The names the chips show: none at the outermost alone; each doc's, as the trail names it, inside a link. */
const NAME = { "": "A", L: "B", "L/M": "C", "L/M/N": "D", S: "E" };

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

describe("presence where it is", () => {
  it("every focus × where the body is held (nowhere, or each acting stage, then let go): each acting stage draws its doc's people in its own frame, by its whole part or its half and never both; a mirror and a pin draw nobody; the chips are the focus path's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view, repo, docs } = await mountTree();
    cleanups.push(() => s.unmount());
    cleanups.push(await others(repo, docs));
    const settled = (f, held) => async () => {
      const want = J(expected(view, f, held));
      try {
        await until(() => J(picture(view)) === want, 4000);
      } catch {
        expect(picture(view), `focus ${J(f)}, held ${J(held)}`).toEqual(expected(view, f, held));
      }
    };
    let cases = 0;
    for (const held of [null, ...ACTING]) {
      for (const f of ACTING) {
        const label = `focus ${J(f)}, held ${J(held)}`;
        // hold the body where it's held: enter it at the focus there
        if (held != null) {
          expect(view.focusOn(pathOf(held)), label).toBe(true);
          await until(() => view.focusStage().debug.host.instanceOf("t.people")?.whole, 4000);
          expect(view.enterBody("t.walk"), label).toBe(true);
        }
        expect(view.focusOn(pathOf(f)), label).toBe(true);
        await settled(f, held)();
        // the view offers the body once: the focus stage's whole part's
        expect([label, view.collect("bodies").flatMap((x) => x.value).filter((b) => b?.id === "t.walk").length]).toEqual([label, 1]);
        // the clocks: the focus path's, outermost first, each named inside a link
        const want = expectedClocks(f);
        const clocksAt = () => view.atom.get().clocks.map((c) => view.stage(c.stage)?.path.join("/"));
        await until(() => J(clocksAt()) === J(want), 4000).catch(() => expect([label, clocksAt()]).toEqual([label, want]));
        for (const c of view.atom.get().clocks) expect(view.stage(c.stage).acts, label).toBe(true);
        await until(() => [...s.root.querySelectorAll(".clock-chip")].length === want.length, 4000);
        const names = [...s.root.querySelectorAll(".clock-chip .clock-doc")].map((el) => (el.hidden ? "" : el.textContent));
        expect([label, names]).toEqual([label, want.map((p) => (f === "" ? "" : NAME[p]))]);
        expect([label, s.root.querySelector(".clock-bar").hidden]).toEqual([label, want.length === 0]);
        cases++;
        // let the body go: a lingering whole part stops, and its half draws there instead
        if (held != null) {
          view.enterBody("look");
          await settled(f, null)();
          cases++;
        }
      }
    }
    // 5 foci with nothing held, 5 × 5 held and then let go
    expect(cases).toBe(5 + 25 * 2);
  }, 120_000);

  it("each chip pauses and resumes its own doc, and only it: inside three links, every chip on the path", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view, docs } = await mountTree();
    cleanups.push(() => s.unmount());
    expect(view.focusOn(["L", "M", "N"])).toBe(true);
    const chips = () => [...s.root.querySelectorAll(".clock-chip")];
    await until(() => chips().length === 3 && chips().every((c) => c.querySelector(".clock-text").textContent.startsWith("▶")), 4000);
    const running = () => ["A", "B", "D"].map((t) => docs[t].doc().clock?.running !== false);
    for (const [i, title] of ["A", "B", "D"].entries()) {
      const chip = chips()[i];
      expect(chip.querySelector(".clock-doc").textContent).toBe(title);
      chip.querySelector(".clock-toggle").click();
      await until(() => !running()[i], 4000);
      expect([title, running()]).toEqual([title, ["A", "B", "D"].map((t) => t !== title)]);
      await until(() => chips()[i].querySelector(".clock-text").textContent === "⏸ Paused by you", 4000);
      chips()[i].querySelector(".clock-toggle").click();
      await until(() => running().every(Boolean), 4000);
    }
  });

  it("a half's api is the drawn facet: no path, no packages, no chrome in the view, no body or command offered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view } = await mountTree();
    cleanups.push(() => s.unmount());
    await until(() => stageOf(view, "L")?.debug.host.halfRecord("t.people")?.state === "running", 4000);
    const api = stageOf(view, "L").debug.host.halfRecord("t.people").api;
    expect(api.path).toBeUndefined();
    expect("packages" in api.view.get()).toBe(false);
    expect("clocks" in api.view.get()).toBe(false);
    expect(api.edge("top").isConnected).toBe(false);
    expect(api.body.enter("t.walk")).toBe(false);
    // and nothing of a half is offered: the stage's generals, bodies and commands are the focus's alone
    expect(stageOf(view, "L").generals()).toEqual([]);
    expect(view.collect("bodies").map((x) => x.stage)).toEqual([0]);
    // a non-general stage never sees the clocks either
    expect("clocks" in stageOf(view, "").debug.host.record("t.proc").api.view.get()).toBe(false);
  });
});
