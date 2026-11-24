// @vitest-environment happy-dom
// The clock chips across links (EDITOR.md, "The interface"): the chips are the
// focus path's, outermost first, each named inside a link, and each pauses
// and resumes its own doc.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import clockPart from "./clock.js";

const J = JSON.stringify;
const at = (x, y, z) => ({ position: [x, y, z], rotation: [0, 0, 0], scale: 1 });
const link = (url, name, extra = {}) => object({ name, sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

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
  const s = await mountStage({ repo, viewerId: "viewer:me", natives: true, extensions: [PROC, CHIP], doc: { title: "A", objects, order: Object.keys(objects), traits: { "t.proc": {} } } });
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

describe("the clock chips across links", () => {
  it("every focus: the clock chips are the focus path's, outermost first, each named inside a link; none at all, no bar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { s, view } = await mountTree();
    cleanups.push(() => s.unmount());
    const chipStages = () => [...s.root.querySelectorAll(".clock-chip")].map((el) => view.stage(Number(el.dataset.stage)));
    const clocksAt = () => chipStages().map((st) => st?.path.join("/"));
    for (const f of ACTING) {
      expect(view.focusOn(pathOf(f)), f).toBe(true);
      const want = expectedClocks(f);
      await until(() => J(clocksAt()) === J(want), 4000).catch(() => expect([f, clocksAt()]).toEqual([f, want]));
      for (const st of chipStages()) expect(st.acts, f).toBe(true);
      const names = [...s.root.querySelectorAll(".clock-chip .clock-doc")].map((el) => (el.hidden ? "" : el.textContent));
      expect([f, names]).toEqual([f, want.map((p) => (f === "" ? "" : NAME[p]))]);
      expect([f, s.root.querySelector(".clock-bar").hidden]).toEqual([f, want.length === 0]);
    }
  });

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
});
