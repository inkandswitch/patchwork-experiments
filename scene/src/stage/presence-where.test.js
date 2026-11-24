// @vitest-environment happy-dom
// Presence where it is (STAGE.md, "Views, stages and links", EDITOR.md, "The interface"): what a doc's
// people are is drawn wherever the doc is drawn with its channel, each in
// its own stage's frame, whatever the focus; and the clock chips are the
// focus path's.
//
// The people are drawn by a part of every doc (traits ["*"]): it runs in
// every stage, as that doc's own part, and never restarts when the focus
// moves; it also offers the body, held where it was entered, and a view
// plugin says where its viewer is through its focus facet. The harness is exhaustive over what decides
// it: every focus (each acting stage, depth ≤3) × where the viewer's body is
// held (nowhere, or in each acting stage) × before and after the body is let
// go, on one view of a tree with every stage role: acting at depths 0–3, a
// sibling acting off the focus path, and a pin (its link closed). Each doc
// has one other person present in it, each from a view of their own on that
// doc alone (the page bus carries between them), so who is drawn where is
// exact: in each stage that acts, the one person of its doc, at the point
// they said, in a layer of that stage's (hung under its root, so in its
// frame: I7); nobody in a pin (it has no channel); never this view; and
// nobody twice.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import { keyOf } from "./paths.js";
import clockPart from "../parts/clock.js";

const J = JSON.stringify;
const at = (x, y, z) => ({ position: [x, y, z], rotation: [0, 0, 0], scale: 1 });
const link = (url, name, extra = {}) => object({ name, sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

/**
 * Where the viewer is: a view plugin, shaped as walk's. It says on the focus
 * doc's channel where its viewer is (`here`: a point in its doc's frame, one
 * per doc, from its title), through its facet there.
 */
const POINT = { A: [1, 0, 0], B: [0, 2, 0], C: [0, 0, 3], D: [4, 4, 0], E: [0, 5, 5] };
const WALK = {
  meta: { id: "t.walk", type: "scene:view" },
  module: {
    create(api) {
      const said = new WeakSet(); // the focus facets it has said where it is through
      return {
        update() {
          const f = api.focus();
          if (!f || said.has(f)) return;
          said.add(f);
          const title = f.doc().title;
          if (POINT[title]) f.channel.set("here", POINT[title]);
        },
      };
    },
  },
};
/**
 * The people: a part of every doc, shaped as walk.people. It draws everyone
 * else who says where they are (under the walk's key) on its doc's channel,
 * a marker per person in its world layer, and offers the body.
 */
const PEOPLE = {
  meta: { id: "t.people", traits: ["*"] },
  module: {
    create(api) {
      const layer = api.world();
      const marks = new Map(); // session → Object3D
      function draw() {
        const seen = new Set();
        for (const [session, p] of Object.entries(api.channel.peers())) {
          const here = p?.keys?.["t.walk"]?.here;
          if (session === api.channel.session || !Array.isArray(here)) continue;
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
      api.channel.watch(draw);
      draw();
      return {
        /** who it draws, where in its layer, and what its layer hangs under (the viewport's key of its stage's root: null, the outermost's) */
        drawn: () => [...marks.values()].map((m) => ({ viewer: m.userData.viewer, here: m.position.toArray(), under: m.parent?.userData.under ?? null })),
        update: draw,
        bodies: [{ id: "t.walk", label: "Walk", enter: () => ({ input: {} }) }],
      };
    },
  },
};
/** A process, where the doc says (a scene trait): so the doc has a clock to show. */
const PROC = { meta: { id: "t.proc", traits: ["t.proc"] }, module: { create: (api) => (api.use("clock").process({ step() {}, save() {} }), {}) } };
const CHIP = { meta: { id: "scene.clock-chip" }, module: clockPart };

/**
 * A: L a live link to B, P a pin of B, S a live
 * link to E (a sibling of L, off any focus inside L). B: M, live, to C. C: N,
 * live, to D. So the stages are A [], B [L], C [L/M], D [L/M/N] (three
 * deep), E [S], and the pin [P] (its M
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
    P: link(b.url, "B fixed", { transform: at(0, 0, -100), at: { heads: b.heads() } }),
    S: link(e.url, "E", { transform: at(0, -50, 0) }),
  };
  const s = await mountStage({ repo, viewerId: "viewer:me", extensions: [WALK, PEOPLE, PROC, CHIP], doc: { title: "A", objects, order: Object.keys(objects), traits: { "t.proc": {} } } });
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
  P: ["pinned", "B"],
};
const ACTING = Object.keys(ROLE).filter((p) => ROLE[p][0] === "acting");
const pathOf = (p) => (p === "" ? [] : p.split("/"));
const stageOf = (view, p) => view.stages().find((x) => x.path.join("/") === p) ?? null;
const PROCS = new Set(["A", "B", "D"]);

/** One view per doc, each alone on it and present there (its body part at its focus says where it is). */
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

/** What the view draws, and runs, where: the walk's facet, the body, its people part (which instance), and who that draws. */
function picture(view) {
  const out = {};
  // (in the model's order, so equal pictures are equal strings)
  for (const p of Object.keys(ROLE)) {
    const x = stageOf(view, p);
    const people = x.debug.host.record("t.people");
    out[p] = {
      walk: x.debug.facets().includes("t.walk"),
      body: view.atom.get().body?.ext === keyOf(x.n, "t.people"),
      people: people?.state === "running" ? people.scope : null,
      drawn: people?.state === "running" ? people.instance.drawn().sort((a, b) => (a.viewer < b.viewer ? -1 : 1)) : [],
    };
  }
  return out;
}
/** Each stage's people part instance, by path. */
const peopleOf = (view) => Object.fromEntries(Object.keys(ROLE).map((p) => [p, stageOf(view, p)?.debug.host.instanceOf("t.people") ?? null]));

/** The viewport's key of the root of the stage at `p` (its link's node in its host's stage), null for the outermost: where its layers hang, so what they hold is in its frame (I7). */
function rootOf(view, p) {
  const path = pathOf(p);
  if (!path.length) return null;
  return keyOf(stageOf(view, path.slice(0, -1).join("/")).n, path.at(-1));
}

/** What the model says the picture is, at focus `f`, with the body held by the people part at `held` (or null). */
function expected(view, f, held) {
  const out = {};
  for (const [p, [role, title]] of Object.entries(ROLE)) {
    const acts = role === "acting";
    out[p] = {
      walk: acts && p === f,
      body: p === held,
      // in every stage, as its doc's own part
      people: "scene",
      // the one other person of this doc, where they said, in this stage's frame; a pin has no channel
      drawn: role !== "pinned" ? [{ viewer: `viewer:${title}`, here: POINT[title], under: rootOf(view, p) }] : [],
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

// I12: every acting stage draws its doc's people in its frame; a pin draws nobody; nobody draws this view
describe("presence where it is", () => {
  it("every focus × where the body is held (nowhere, or each acting stage, then let go): every stage but the pin draws its doc's people in its own frame, by the one instance of its part of every doc; the walk's facet is the focus's, the body where it was entered; the chips are the focus path's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view, repo, docs } = await mountTree();
    cleanups.push(() => s.unmount());
    cleanups.push(await others(repo, docs));
    await until(() => Object.values(peopleOf(view)).every(Boolean), 4000);
    // the people parts, started once: no focus move or body ever restarts one
    const first = peopleOf(view);
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
          expect(view.enterBody("t.walk", undefined, view.focusStage()), label).toBe(true);
        }
        expect(view.focusOn(pathOf(f)), label).toBe(true);
        await settled(f, held)();
        expect([label, peopleOf(view)]).toEqual([label, first]);
        // the clocks: the focus path's, outermost first, each named inside a link
        const want = expectedClocks(f);
        const chipStages = () => [...s.root.querySelectorAll(".clock-chip")].map((el) => view.stage(Number(el.dataset.stage)));
        const clocksAt = () => chipStages().map((st) => st?.path.join("/"));
        await until(() => J(clocksAt()) === J(want), 4000).catch(() => expect([label, clocksAt()]).toEqual([label, want]));
        for (const st of chipStages()) expect(st.acts, label).toBe(true);
        await until(() => [...s.root.querySelectorAll(".clock-chip")].length === want.length, 4000);
        const names = [...s.root.querySelectorAll(".clock-chip .clock-doc")].map((el) => (el.hidden ? "" : el.textContent));
        expect([label, names]).toEqual([label, want.map((p) => (f === "" ? "" : NAME[p]))]);
        expect([label, s.root.querySelector(".clock-bar").hidden]).toEqual([label, want.length === 0]);
        cases++;
        // let the body go: nothing else changes
        if (held != null) {
          view.enterBody("look");
          await settled(f, null)();
          expect([label, peopleOf(view)]).toEqual([label, first]);
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

  it("a chip names its doc as the trail does, at once when a link is renamed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view, docs } = await mountTree();
    cleanups.push(() => s.unmount());
    expect(view.focusOn(["L", "M", "N"])).toBe(true);
    const names = () => [...s.root.querySelectorAll(".clock-chip .clock-doc")].map((el) => el.textContent);
    const trail = () => [...s.root.querySelectorAll(".stage-trail .trail-crumb, .stage-trail .trail-here")].map((el) => el.textContent);
    await until(() => J(names()) === J(["A", "B", "D"]), 4000);
    // rename the links on the path, one at a time: the chip of the doc each leads to says so with the trail, with no clock news meanwhile
    for (const [host, id, name] of [["A", "L", "Boat"], ["C", "N", "Table"]]) {
      docs[host].change((d) => {
        d.objects[id].name = name;
      });
      const want = host === "A" ? ["A", "Boat", "D"] : ["A", "Boat", "Table"];
      await until(() => J(names()) === J(want), 4000).catch(() => expect([name, names()]).toEqual([name, want]));
      expect(trail()).toEqual(host === "A" ? ["A", "Boat", "C", "D"] : ["A", "Boat", "C", "Table"]);
    }
  });
});
