// Edit in context (STAGE.md build step 14): Enter moves the focus into
// a link whose doc acts, Leave moves it out, and H10 holds across docs: a
// selection is always an element of the focus stage. Checked in a real view
// with nested stages (no WebGL: hits are stubbed as the viewport keys them).
//
// The harness is exhaustive over the view's state, not over sequences: the
// view's focus and selection are its whole state as far as selection goes
// (where the view plugins' facets are is a function of the focus, checked), so
// every reachable state × every event covers every sequence of any length.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { NATIVES, mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import { editing } from "./bodies.js";
import { elementOf, keyOf } from "./paths.js";
import { spy } from "../test/spy.js";
import { atFocus, focusSteps, selectionAtFocus, selectionStep } from "../selection.js";
import inspector from "../parts/inspector.js";
import toolbar from "../parts/toolbar.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const J = JSON.stringify;

/** Trait parts that record what reaches them, a view plugin, and Enter (scene.links, native). */
function extensions(log) {
  const input = (who) => ({ press: (ev) => (log.push(`${who} ${ev.hit?.id ?? "-"}`), null), click: (ev) => (log.push(`click ${who} ${ev.hit?.id ?? "-"}`), null) });
  return [
    { meta: { id: "t.card", traits: ["t.card"] }, module: { create: () => ({ input: input("t.card") }) } },
    { meta: { id: "t.host", traits: ["t.host"] }, module: { create: () => ({ input: input("t.host") }) } },
    { meta: { id: "t.general", type: "scene:view" }, module: { create: () => ({ input: input("t.general") }) } },
  ];
}

/**
 * Parts that hold something (STAGE.md, "Bodies"): a part of every doc
 * offering a body (as walk is), a view plugin offering a tool (as Measure
 * does), and the host's trait part offering a seat. Each counts its starts.
 */
function holders(started) {
  const count = (id) => (started[id] = (started[id] ?? 0) + 1);
  const body = (id) => ({ id, label: id, enter: () => ({ input: {} }) });
  return [
    { meta: { id: "t.walk", traits: ["*"] }, module: { create: () => (count("t.walk"), { bodies: [body("t.walk")] }) } },
    { meta: { id: "t.measure", type: "scene:view" }, module: { create: () => (count("t.measure"), { commands: [{ id: "measure", name: "Measure", tool: {}, run: () => ({ press: () => null }) }] }) } },
    { meta: { id: "t.seat", traits: ["t.host"] }, module: { create: () => (count("t.seat"), { bodies: [body("t.seat")] }) } },
  ];
}

/**
 * Host A: a table, L and R both live links to B (L acts, the first in path
 * order; R is closed, a repeat), P a pin of B, X a link to a doc that can't
 * be opened. B: a card and M, a live link to C. C: a piece. So the stages
 * are A [], B [L], C [L, M], and B pinned [P] (its M closed: unpinned, the
 * pin holds no C).
 */
async function mountNested({ repo = new FakeRepo(), log = [], extra = [], time = null } = {}) {
  const c = repo.add(emptyScene({ title: "C", objects: { piece: object({ name: "Piece", traits: { "t.card": {} } }) }, order: ["piece"] }));
  const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card", traits: { "t.card": {} } }), M: link(c.url, { name: "C" }) }, order: ["card", "M"] }));
  const objects = {
    table: object({ name: "Table", traits: { "t.host": {} } }),
    L: link(b.url, { name: "B" }),
    R: link(b.url, { name: "B again" }),
    P: link(b.url, { name: "B fixed", at: { heads: b.heads() } }),
    X: link("automerge:2222222222222222222222222222", { name: "Gone" }),
  };
  const s = await mountStage({ repo, time, extensions: [...extensions(log), ...extra], doc: { title: "A", objects, order: Object.keys(objects) } });
  const view = s.debug.view;
  await until(() => ["L", "L/M", "P"].every((p) => stageOf(view, p)?.debug.host.instanceOf("t.card")) && s.api("t.host")?.use("links").role("X")?.role === "closed" && s.api("t.host")?.use("links").role("R")?.reason === "repeat", 3000);
  return { s, view, repo, b, c, log };
}

const stageOf = (view, p) => view.stages().find((x) => x.path.join("/") === p) ?? null;
// the stages, by path, and what each holds
const STAGES = { "": ["table", "L", "R", "P", "X"], L: ["card", "M"], "L/M": ["piece"], P: ["card", "M"] };
const ACTING = new Set(["", "L", "L/M"]);
// where Enter on a link goes: where its doc acts; a pin and a closed link (a repeat among them) nowhere
const ENTERS = { L: ["L"], "L/M": ["L", "M"] };
const pathOf = (p) => (p === "" ? [] : p.split("/"));

/** Every event, as [name, model step, do it]. */
function events(m) {
  const { s, view } = m;
  const out = [];
  const act = (p) => ACTING.has(p.join("/"));
  for (const [sp, ids] of Object.entries(STAGES)) {
    const at = pathOf(sp);
    for (const id of ids) {
      const path = [...at, id];
      out.push([
        `press ${path.join("/")}`,
        (st) => (atFocus(st.focus, path) ? selectionStep(st, { type: "press", path }) : st),
        async () => {
          view.viewport.pick = () => ({ id: keyOf(stageOf(view, sp).n, id), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 });
          s.click(20, 20);
        },
      ]);
      out.push([
        `select ${sp}:${id}`,
        (st) => (act(at) ? selectionStep(st, { type: "select", path }) : st),
        async () => stageOf(view, sp).debug.host.record("t.card")?.api.view.select(id) ?? hostApi(m, sp).view.select(id),
      ]);
      if (ids === STAGES[""] ? id !== "table" : id === "M") {
        out.push([
          `enter ${sp}:${id}`,
          (st) => {
            const to = act(at) ? ENTERS[path.join("/")] : null;
            if (!to) return st;
            return focusSteps(st.focus, to, act).reduce((x, ev) => selectionStep(x, ev), st);
          },
          async () => apiIn(m, sp).view.enter(id),
        ]);
      }
    }
  }
  out.push([
    "press nothing",
    (st) => selectionStep(st, { type: "press", path: [] }),
    async () => {
      view.viewport.pick = () => null;
      s.click(20, 20);
    },
  ]);
  out.push(["select nothing", (st) => selectionStep(st, { type: "clear" }), async () => s.api("t.host").view.select(null)]);
  out.push(["leave", (st) => selectionStep(st, { type: "leave" }), async () => view.leave()]);
  out.push(["escape", (st) => selectionStep(st, { type: "escape" }), async () => s.key("Escape", { code: "Escape" })]);
  return out;
}

/** The api of an extension in the stage at `sp` (t.card where it runs, else the host's). */
function apiIn(m, sp) {
  return stageOf(m.view, sp).debug.host.record(sp === "" ? "t.host" : "t.card").api;
}
const hostApi = (m, sp) => apiIn(m, sp);

/** The view's state, and every invariant step 14 promises of it. */
function check(m, label) {
  const { view } = m;
  const v = view.atom.get();
  const st = { focus: v.focus, selected: v.selected };
  const why = (x) => `${label}: ${x} (${J(st)})`;
  // H10
  expect(selectionAtFocus(st), why("the selection is an element of the focus stage")).toBe(true);
  // the focus is a stage that acts, and so is every stage on the way to it
  for (let i = 0; i <= st.focus.length; i++) expect(view.stageAt(st.focus.slice(0, i)), why(`a stage acts at ${J(st.focus.slice(0, i))}`)).not.toBe(null);
  // each stage sees its own element of the selection, and never where the focus is: not in the view's
  // value, nor in a way to leave (the view's)
  for (const x of view.stages()) {
    const api = x.debug.host.record(x.path.length ? "t.card" : "t.host")?.api;
    expect(api.view.get().selected ?? null, why(`stage ${J(x.path)} sees its element`)).toBe(elementOf(st.selected, x.path));
    expect("focus" in api.view.get(), why("no stage sees the focus")).toBe(false);
    expect("leave" in api.view, why("a stage's view has no way out")).toBe(false);
  }
  return st;
}

/** What each stage's extension sees of the view, but its element of the selection: a focus move changes none of it. */
const projections = (view) =>
  J(
    view.stages().map((x) => {
      const { selected: _s, ...rest } = x.debug.host.record(x.path.length ? "t.card" : "t.host").api.view.get();
      return [x.path, rest];
    }),
  );

/** The stages the view plugins have facets of (api.focus()): the focus stage's, once one asks, and no other. */
const facetsAt = (view) => view.stages().filter((x) => x.debug.facets().length).map((x) => x.path.join("/"));
function placed(view) {
  view.plugins.record("scene.links").api.focus();
  expect(facetsAt(view)).toEqual([view.atom.get().focus.join("/")]);
}

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("H10 across docs: the selection is always an element of the focus stage", () => {
  it("every reachable focus and selection × every press, Select, Enter, Leave and Escape, over nested links, a repeat, a pin and a closed link: as the model says, and nothing written", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    s.edit(true);
    const writes = [spy(s.handle), spy(m.b), spy(m.c)].map((log) => () => log.filter((x) => x === "change"));
    const evs = events(m);
    const key = (st) => J([st.focus, st.selected]);
    const seen = new Map([[key({ focus: [], selected: null }), { focus: [], selected: null }]]);
    const queue = [...seen.values()];
    let transitions = 0;
    while (queue.length) {
      const from = queue.shift();
      for (const [name, model, run] of evs) {
        // reach `from` by the view's own moves, then the event; the focus moving shows no stage anything but
        // its element of the selection
        // (an Escape with nothing to clear or leave puts the editor down: picked up again for every event)
        s.edit(true);
        const seenBefore = projections(view);
        view.focusOn(from.focus);
        await placed(view);
        expect(projections(view), `moving the focus to ${J(from.focus)}`).toBe(seenBefore);
        view.select(from.selected);
        await placed(view);
        expect(check(m, `reaching ${key(from)}`)).toEqual(from);
        await run();
        await settle();
        await placed(view);
        const got = check(m, `${key(from)} then ${name}`);
        const want = model(from);
        expect([key(from), name, key(got)]).toEqual([key(from), name, key(want)]);
        transitions++;
        if (!seen.has(key(got))) {
          seen.set(key(got), got);
          queue.push(got);
        }
      }
    }
    // every focus and every selection at it was reached: 6 at A (nothing, or one of its 5), 3 in B, 2 in C
    expect(seen.size).toBe(11);
    expect(transitions).toBe(11 * evs.length);
    expect(evs.length).toBe(30); // 10 presses, 10 Selects, 6 Enters, press nothing, select nothing, Leave, Escape
    // focus and selection are the viewer's: no doc was written
    expect(writes.map((w) => w())).toEqual([[], [], []]);
  }, 60_000);
});

describe("Enter and Leave", () => {
  it("Enter moves the view plugins' facets to the linked doc's stage, Leave moves them back, and the plugins never start again; a repeat, a pin and a closed link don't", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    const host = s.api("t.host");
    await placed(view);
    // Enter's verb says what each link does
    const plugins = ["scene.links", "t.general"].map((id) => s.instance(id));
    const enterOf = (id) => s.instance("scene.links").commands[0].state(id);
    expect(enterOf("table")).toBe(null);
    expect(enterOf("L").disabled).toBeFalsy();
    expect(enterOf("R")).toMatchObject({ disabled: true, title: expect.stringMatching(/repeat/) });
    expect(enterOf("P")).toMatchObject({ disabled: true, title: expect.stringMatching(/Follow latest/) });
    expect(enterOf("X")).toMatchObject({ disabled: true, title: expect.stringMatching(/unavailable/) });
    expect(host.view.enter("R")).toBe(false);
    expect(host.view.enter("P")).toBe(false);
    expect(host.view.enter("X")).toBe(false);
    expect(host.view.enter("table")).toBe(false);
    // nobody has placed the camera yet: something may frame it on opening (scene.autoframe)
    expect(host.camera.touched()).toBe(false);
    expect(host.view.enter("L")).toBe(true);
    expect(view.atom.get().focus).toEqual(["L"]);
    await placed(view);
    // the camera came along, and nobody learns it was placed: not a stage's part (B's, or the host's: sailing's
    // quarter view still waits for a camera nobody placed), nor a view plugin (scene.autoframe knows the focus moved)
    const touched = () => [host.camera.touched(), apiIn(m, "L").camera.touched(), s.facet("scene.links").camera.touched()];
    expect(touched()).toEqual([false, false, false]);
    // what the doc runs is untouched (H1): only the view plugins' facets moved
    const traitRun = (p) => stageOf(view, p).debug.host.running().map((r) => r.id).filter((id) => !NATIVES.includes(id));
    expect(traitRun("")).toEqual(["t.host"]);
    expect(traitRun("L")).toEqual(["t.card"]);
    // deeper, then the trail's way out, then Leave
    expect(apiIn(m, "L").view.enter("M")).toBe(true);
    await placed(view);
    const trail = view.root.querySelector(".stage-trail");
    expect([...trail.querySelectorAll(".trail-crumb, .trail-here")].map((e) => e.textContent)).toEqual(["A", "B", "C"]);
    trail.querySelector(".trail-crumb").click(); // "A": out to the scene itself
    expect(view.atom.get().focus).toEqual([]);
    expect(view.root.querySelector(".stage-trail")).toBe(null);
    await placed(view);
    host.view.enter("L");
    expect(view.leave()).toBe(true);
    expect(view.leave()).toBe(false);
    await placed(view);
    // the same instances all along
    expect(["scene.links", "t.general"].map((id) => s.instance(id))).toEqual(plugins);
  });

  it("the focus leaves a link that goes, is pinned, or stops acting there; the selection goes with it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases = [
      ["B's M removed, entered at C", ["L", "M"], (m) => m.b.change((d) => void delete d.objects.M), ["L"]],
      ["A's L removed, entered at C", ["L", "M"], (m) => m.s.change((d) => void delete d.objects.L), []],
      ["A's L removed, entered at B", ["L"], (m) => m.s.change((d) => void delete d.objects.L), []],
      ["A's L pinned, entered at B", ["L"], (m) => m.s.change((d) => void (d.objects.L.at = { heads: m.b.heads() })), []],
      ["B's M pinned, entered at C", ["L", "M"], (m) => m.b.change((d) => void (d.objects.M.at = { heads: m.c.heads() })), ["L"]],
      // a link ahead of L in path order: B acts there now, and L is a repeat
      ["B linked again ahead of L, entered at B", ["L"], (m) => m.s.change((d) => void (d.objects.A0 = link(m.b.url, { name: "B first" }))), []],
      // L pointed at another doc: a new occurrence at the same path is the link going. C is open in this
      // view already (at L/M), so its stage opens at [L] in the same relink; a doc not yet found opens later
      ["A's L pointed at C (open here), entered at B", ["L"], (m) => m.s.change((d) => void (d.objects.L.sourceUrl = m.c.url)), []],
      ["A's L pointed at C (open here), entered at C", ["L", "M"], (m) => m.s.change((d) => void (d.objects.L.sourceUrl = m.c.url)), []],
      ["A's L pointed at a doc not found yet, entered at B", ["L"], (m) => m.s.change((d) => void (d.objects.L.sourceUrl = m.repo.add(emptyScene({ title: "D", objects: { card: object({ name: "Card", traits: { "t.card": {} } }) }, order: ["card"] })).url)), []],
      ["B's M pointed at B's own sibling doc, entered at C", ["L", "M"], (m) => m.b.change((d) => void (d.objects.M.sourceUrl = m.repo.add(emptyScene({ title: "E", objects: { piece: object({ name: "Piece", traits: { "t.card": {} } }) }, order: ["piece"] })).url)), ["L"]],
    ];
    for (const [label, focus, change, after] of cases) {
      const m = await mountNested();
      s = m.s;
      const { view } = m;
      expect(view.focusOn(focus), label).toBe(true);
      view.select([...focus, focus.length === 2 ? "piece" : "card"]);
      await placed(view);
      change(m);
      await until(() => J(view.atom.get().focus) === J(after), 2000).catch(() => {});
      expect([label, view.atom.get().focus], label).toEqual([label, after]);
      expect(view.atom.get().selected, label).toBe(null);
      await placed(view);
      // and stays left once whatever opens at the old path has opened
      await settle();
      expect([label, view.atom.get().focus], label).toEqual([label, after]);
      check(m, label);
      s.unmount();
      s = null;
    }
  });

  it("entering changes nothing for anyone else: another view of the same scene, the docs and what each stage runs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const other = await mountStage({ repo: m.repo, handle: m.s.handle, viewerId: "viewer:other" });
    try {
      const ov = other.debug.view;
      await until(() => stageOf(ov, "L/M")?.debug.host.instanceOf("t.card"), 3000);
      const runs = (v) => J(v.stages().map((x) => [x.path, x.role, x.debug.host.running().map((r) => r.id)]));
      const before = { mine: runs(m.view), theirs: runs(ov), focus: ov.atom.get().focus, facets: facetsAt(ov) };
      const writes = [spy(s.handle), spy(m.b), spy(m.c)];
      s.api("t.host").view.enter("L");
      apiIn(m, "L").view.enter("M");
      apiIn(m, "L/M").view.select("piece");
      await placed(m.view);
      expect(m.view.atom.get().selected).toEqual(["L", "M", "piece"]);
      expect({ mine: runs(m.view), theirs: runs(ov), focus: ov.atom.get().focus, facets: facetsAt(ov) }).toEqual(before);
      expect(ov.atom.get().selected).toBe(null);
      expect(writes.map((w) => w.filter((x) => x === "change"))).toEqual([[], [], []]);
    } finally {
      other.unmount();
    }
  });
});

describe("surfaces across docs", () => {
  it("entered in B, the toolbar holds the focus path's commands, the host's among them (worked out in the host's context), runs each where it's from, and doesn't change under the pointer", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const ran = [];
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
    const HOST = { meta: { id: "t.host", traits: ["t.host"] }, module: { create: (api) => ({ commands: [{ id: "ring", name: "Ring", show: ["toolbar"], state: (t, ctx) => (t == null && ctx.scene.objects.table ? { title: "Ring the bell" } : null), run: () => ran.push(api.url) }] }) } };
    const objects = { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(b.url, { name: "B" }) };
    s = await mountStage({ repo, extensions: [HOST, { meta: { id: "scene.toolbar" }, module: toolbar }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug, 3000);
    s.edit(true);
    expect(s.api("t.host").view.enter("L")).toBe(true);
    const labels = () => [...view.root.querySelectorAll(".toolbar button")].map((x) => x.textContent);
    await until(() => labels().includes("Ring"), 2000);
    const before = labels();
    // the pointer over B's card, then the host's table: the bar stays as it is
    for (const [i, hit] of [{ id: keyOf(stageOf(view, "L").n, "card") }, { id: "table" }, null].entries()) {
      view.viewport.pick = () => (hit ? { ...hit, point: [0, 0, 0], normal: [0, 1, 0], distance: 3 } : null);
      s.pointer("pointermove", 20 + i * 3, 20, { buttons: 0 });
      await settle();
      expect(labels()).toEqual(before);
    }
    [...view.root.querySelectorAll(".toolbar button")].find((x) => x.textContent === "Ring").click();
    expect(ran).toEqual([s.handle.url]);
  });
});

describe("the bar of tools across docs, not editing", () => {
  it("looking, entered in B: the game's and the host's world commands are on the bar, the game's first, and each runs where it's from; no editor command shows", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const ran = [];
    const world = (id, name) => (api) => ({ commands: [{ id, name, show: ["world"], run: () => ran.push([id, api.url]) }, { id: `${id}-edit`, name: `${name} (editor)`, show: ["toolbar"], run() {} }] });
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card", traits: { "t.game": {} } }) }, order: ["card"] }));
    const HOST = { meta: { id: "t.host", traits: ["t.host"] }, module: { create: world("ring", "Ring") } };
    const GAME = { meta: { id: "t.game", traits: ["t.game"] }, module: { create: world("deal", "Deal") } };
    const objects = { table: object({ name: "Table", traits: { "t.host": {} } }), L: link(b.url, { name: "B" }) };
    s = await mountStage({ repo, extensions: [HOST, GAME, { meta: { id: "scene.toolbar" }, module: toolbar }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug.host.instanceOf("t.game"), 3000);
    s.edit(false);
    const buttons = (cluster) => [...view.root.querySelectorAll(`.toolbar .${cluster} button`)];
    const labels = (cluster) => buttons(cluster).map((x) => x.textContent);
    await until(() => J(labels("world")) === J(["Ring"]), 2000);
    // outside the game, its command isn't on the focus path
    expect([labels("tools"), labels("world")]).toEqual([[], ["Ring"]]);
    expect(s.api("t.host").view.enter("L")).toBe(true);
    await until(() => J(labels("world")) === J(["Deal", "Ring"]), 2000);
    expect(s.local.get().body.id).toBe("look");
    expect(labels("tools")).toEqual([]);
    for (const x of buttons("world")) x.click();
    expect(ran).toEqual([
      ["deal", b.url],
      ["ring", s.handle.url],
    ]);
  });
});

describe("the drawer follows the focus", () => {
  it("the inspector's pane open as the focus moves stays open, its tree on the linked doc's objects; link rows say what they are and enter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const c = repo.add(emptyScene({ title: "C", objects: { piece: object({ name: "Piece" }) }, order: ["piece"] }));
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }), M: link(c.url, { name: "C" }) }, order: ["card", "M"] }));
    const objects = { table: object({ name: "Table" }), L: link(b.url, { name: "B" }), P: link(b.url, { name: "B fixed", at: { heads: b.heads() } }) };
    s = await mountStage({ repo, extensions: [{ meta: { id: "scene.inspector" }, module: inspector }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug && s.instance("scene.links") && s.api("scene.links")?.use("links").role("P")?.open, 3000);
    s.edit(true);
    s.instance("scene.inspector").tab.open();
    await settle();
    const rows = () => [...view.root.querySelectorAll(".scene-outline .object-row")].map((li) => [li.dataset.id, li.querySelector(".link-mark")?.textContent ?? null, !!li.querySelector(".enter-link")]);
    await until(() => J(rows()) === J([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]);
    // its Enter goes in; the tab stays, now on B's objects
    view.root.querySelector('.object-row[data-id="L"] .enter-link').click();
    expect(view.atom.get().focus).toEqual(["L"]);
    await until(() => J(rows()) === J([["card", null, false], ["M", "linked", true]]), 2000).catch(() => {});
    expect(rows()).toEqual([["card", null, false], ["M", "linked", true]]);
    // one pane, the tree and the fields together, in the focus doc
    expect(view.root.querySelectorAll('.stage-drawer [data-panel="inspector"]').length).toBe(1);
    expect(view.root.querySelector('.stage-drawer [data-panel="inspector"] .inspector-body .inspector')?.dataset.kind).toBe("scene");
    // a double-click on a link row enters it too
    view.root.querySelector('.object-row[data-id="M"] .row-main').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(view.atom.get().focus).toEqual(["L", "M"]);
    await until(() => J(rows()) === J([["piece", null, false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["piece", null, false]]);
  });
});

describe("what the viewer holds across a focus move", () => {
  // A view plugin never starts again. A body is a stage's extension's, held where it was entered; what a
  // view plugin acquired through a facet (here a tool picked up through its command) goes with the focus.
  // ("edit": Look holding the editor, which is a hand, not a body)
  const BODIES = ["look", "edit", "t.walk", "t.seat"];
  const MOVES = [
    ["Enter", [], ["L"]],
    ["Enter deeper", ["L"], ["L", "M"]],
    ["Leave", ["L"], []],
    ["Leave out of two", ["L", "M"], []],
  ];
  const bodyId = (view) => (editing(view.atom.get()) ? "edit" : (view.atom.get().body?.id ?? null));
  const offered = (view, name, id) => view.collect(name).flatMap((x) => x.value).filter((v) => v?.id === id).length;

  it("every body × every move: the body stays, held by the same stage; the view plugins never start again and offer each command once; a tool held through one is put down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const body of BODIES) {
      for (const [label, from, to] of MOVES) {
        const started = {};
        const m = await mountNested({ extra: holders(started) });
        s = m.s;
        const { view } = m;
        const name = `${body} × ${label}`;
        expect(view.focusOn(from), name).toBe(true);
        await placed(view);
        await until(() => s.instance("t.measure"), 2000);
        s.edit(body === "edit");
        expect(view.enterBody(body === "edit" ? "look" : body), name).toBe(true);
        expect(bodyId(view), name).toBe(body);
        const holder = view.atom.get().body?.ext ?? null;
        expect(s.api("t.measure").run({ ext: "t.measure", command: "measure" }), name).toBe(true);
        expect(view.router.held()?.owner, name).toBe(keyOf(view.focusStage().n, "t.measure"));
        expect(view.focusOn(to), name).toBe(true);
        await placed(view);
        // the body is the one entered, held where it was; the tool went with the focus
        expect([name, bodyId(view), view.atom.get().body?.ext ?? null, view.router.held()]).toEqual([name, body, holder, null]);
        expect([name, started["t.measure"], offered(view, "commands", "measure")]).toEqual([name, 1, 1]);
        s.unmount();
        s = null;
      }
    }
  }, 60_000);
});

describe("the camera's rides don't depend on the focus (I8)", () => {
  it("a sibling link's stage rides while the focus is inside another link: the latest base ride of any acting stage applies, wherever the focus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const card = () => object({ name: "Card", traits: { "t.card": {} } });
    const b = repo.add(emptyScene({ title: "B", objects: { card: card() }, order: ["card"] }));
    const d = repo.add(emptyScene({ title: "D", objects: { card: card() }, order: ["card"] }));
    const objects = { L: link(b.url, { name: "B" }), N: link(d.url, { name: "D" }) };
    s = await mountStage({ repo, extensions: extensions([]), doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => ["L", "N"].every((p) => stageOf(view, p)?.debug.host.instanceOf("t.card")), 3000);
    const rideOf = (p) => stageOf(view, p).debug.host.record("t.card").api.camera.ride("card");
    const current = () => view.viewport.rides.current()?.id ?? null;
    const keyIn = (p) => keyOf(stageOf(view, p).n, "card");
    expect(view.focusOn(["L"])).toBe(true);
    // N is off the focus path: its ride applies all the same
    const offN = rideOf("N");
    for (const focus of [["L"], [], ["N"], ["L"]]) {
      view.focusOn(focus);
      await settle();
      expect([J(focus), current()]).toEqual([J(focus), keyIn("N")]);
    }
    // a later ride, from the focus stage, is the latest; off again, N's applies again, wherever the focus
    const offL = rideOf("L");
    expect(current()).toBe(keyIn("L"));
    offL();
    for (const focus of [["L"], ["N"], []]) {
      view.focusOn(focus);
      await settle();
      expect([J(focus), current()]).toEqual([J(focus), keyIn("N")]);
    }
    offN();
    expect(current()).toBe(null);
  });
});

describe("putting the editor down puts the selection down; a body doesn't (HISTORY.md, Kernel step 1)", () => {
  // Attention is the selection, so a selection kept from editing would aim F
  // and the use prompt at what was last edited. Every state changed from × to
  // (Look and a walk, each holding the editor or not; a seat over Look) × the
  // focus (the scene, one link in, two) × a selection or none: the selection
  // goes exactly when the editor is put down; the focus never moves.
  // 5 × 5 × 3 × 2 = 150 cases.
  const STATES = [["look", false], ["look", true], ["t.walk", false], ["t.walk", true], ["t.seat", false]];
  const FOCI = [[], ["L"], ["L", "M"]];
  const ELEMENT = { "": "table", L: "card", "L/M": "piece" };
  it("every state × every state × every focus × a selection or none: cleared exactly on putting the editor down, the focus kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = {};
    const m = await mountNested({ extra: holders(started) });
    s = m.s;
    const { view } = m;
    let cases = 0;
    for (const focus of FOCI) {
      expect(view.focusOn(focus)).toBe(true);
      await placed(view);
      for (const from of STATES)
        for (const to of STATES)
          for (const withSel of [false, true]) {
            const name = `${J(focus)} ${from} → ${to}${withSel ? " selected" : ""}`;
            view.enterBody("look");
            s.edit(from[1]);
            expect(view.enterBody(from[0]), name).toBe(true);
            const sel = withSel ? [...focus, ELEMENT[focus.join("/")]] : null;
            view.select(sel);
            expect(J(view.atom.get().selected), name).toBe(J(sel));
            if (from[0] !== to[0]) expect(view.enterBody(to[0]), name).toBe(true);
            s.edit(to[1]);
            const want = from[1] && !to[1] ? null : sel;
            expect([name, J(view.atom.get().selected), J(view.atom.get().focus)]).toEqual([name, J(want), J(focus)]);
            cases++;
          }
    }
    expect(cases).toBe(150);
  }, 60_000);
});

describe("holding the editor, a click is its wherever it lands (HISTORY.md, COMPOSITION Decisions, Edit's click is Edit's)", () => {
  // HISTORY.md, Kernel step 1: holding the editor a plain click selects, before any package's click verb. Inside an entered
  // link a click on the host (the boat round a game linked aboard her) can't select, and it used to go down
  // the chain, where the boat's click verb came aboard: the body left Edit for "aboard" under a card missed on
  // her moving table (presence-check.nopause, 2026-11-16). Editing or not × every focus × a selection or
  // none × every thing a click can land on (each stage's objects, a pin's and a closed link's, and
  // nothing, and a stale hit, which editInput takes as nothing): the click goes down the chain exactly without the
  // editor, or holding it on nothing (or a stale hit) with nothing selected; the selection is selectionStep's
  // (outside the focus: unchanged); the body and the focus never move. 2 × 3 × 2 × 17 = 204 cases.
  const FOCI = [[], ["L"], ["L", "M"]];
  const ELEMENT = { "": "table", L: "card", "L/M": "piece" };
  // a hit is { key: (view) => the viewport's key, path: the hit's path, or null for nothing }. Stale hits: an id
  // its stage no longer has (removed between the pick and the click), in every stage; a stage no longer there;
  // a malformed key.
  const live = Object.entries(STAGES).flatMap(([sp, ids]) => ids.map((id) => ({ name: `${sp}:${id}`, key: (view) => keyOf(stageOf(view, sp).n, id), path: [...pathOf(sp), id] })));
  const stale = [
    ...Object.keys(STAGES).map((sp) => ({ name: `${sp}:gone (stale)`, key: (view) => keyOf(stageOf(view, sp).n, "gone"), path: null })),
    { name: "a stage no longer there (stale)", key: () => keyOf(999, "card"), path: null },
    { name: "a malformed key (stale)", key: () => "\u001fx\u001fcard", path: null },
    { name: "nothing", key: null, path: null },
  ];
  const HITS = [...live, ...stale];
  it("editing or not × every focus × a selection or none × every hit: down the chain only without the editor or on nothing with nothing selected", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view, log } = m;
    let cases = 0;
    for (const focus of FOCI) {
      expect(view.focusOn(focus)).toBe(true);
      await placed(view);
      for (const base of ["look", "edit"])
        for (const withSel of [false, true])
          for (const hit of HITS) {
            const name = `${base} ${J(focus)}${withSel ? " selected" : ""} click on ${hit.name}`;
            view.enterBody("look");
            s.edit(base === "edit");
            const sel = withSel ? [...focus, ELEMENT[focus.join("/")]] : null;
            view.select(sel);
            expect(J(view.atom.get().selected), name).toBe(J(sel));
            view.viewport.pick = hit.key ? () => ({ id: hit.key(view), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 }) : () => null;
            log.length = 0;
            s.click(20, 20);
            await settle();
            const down = base === "look" || (!hit.path && !withSel);
            const want = base === "look" ? sel : selectionStep({ focus, selected: sel }, { type: "press", path: hit.path ?? [] }).selected;
            expect([name, log.some((x) => x.startsWith("click ")), J(view.atom.get().selected), view.atom.get().body?.id, J(view.atom.get().focus)]).toEqual([name, down, J(want), "look", J(focus)]);
            cases++;
          }
    }
    expect(cases).toBe(204);
  }, 60_000);

});
