// @vitest-environment happy-dom
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
import { LINK } from "../test/links.js";
import { holding } from "./bodies.js";
import { elementOf, keyOf } from "./paths.js";
import { spy } from "../test/spy.js";
import { atFocus, focusSteps, selectionAtFocus, selectionStep } from "./selection.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const J = JSON.stringify;
/** Holding the Edit hand (a hand of kind "edit", the editor's). */
const editing = (v) => holding(v, "edit");

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
  const s = await mountStage({ repo, time, editor: true, natives: true, extensions: [...extensions(log), ...extra], doc: { title: "A", objects, order: Object.keys(objects) } });
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
          async () => view.enter(path),
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
    expect(["enter", "leave", "arrive"].some((k) => k in api.view), why("a stage's view has no way in or out")).toBe(false);
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
  it("Enter moves the view plugins' facets to the linked doc's stage, the trail and Leave move them back, and the plugins never start again; a repeat, a pin, a closed link and a plain object move nothing; the camera comes along untouched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    const host = s.api("t.host");
    await placed(view);
    const plugins = ["scene.links", "t.general"].map((id) => s.instance(id));
    // (what Enter's verb says of each link is links.test.js's)
    for (const id of ["R", "P", "X", "table"]) {
      expect([id, view.enter([id])]).toEqual([id, false]);
      expect([id, view.atom.get().focus]).toEqual([id, []]);
      await placed(view);
    }
    // nobody has placed the camera yet: something may frame it on opening (scene.autoframe)
    expect(host.camera.touched()).toBe(false);
    expect(view.enter(["L"])).toBe(true);
    expect(view.atom.get().focus).toEqual(["L"]);
    await placed(view);
    // the camera came along, and nobody learns it was placed: not a stage's part (B's, or the host's, which
    // may still be waiting to frame a camera nobody placed), nor a view plugin (scene.autoframe knows the focus moved)
    const touched = () => [host.camera.touched(), apiIn(m, "L").camera.touched(), s.facet("scene.links").camera.touched()];
    expect(touched()).toEqual([false, false, false]);
    // what the doc runs is untouched (H1): only the view plugins' facets moved
    const traitRun = (p) => stageOf(view, p).debug.host.running().map((r) => r.id).filter((id) => !NATIVES.includes(id));
    expect(traitRun("")).toEqual(["t.host"]);
    expect(traitRun("L")).toEqual(["t.card"]);
    // deeper, then the trail's way out, then Leave
    expect(view.enter(["L", "M"])).toBe(true);
    await placed(view);
    const trail = view.root.querySelector(".stage-trail");
    expect([...trail.querySelectorAll(".trail-crumb, .trail-here")].map((e) => e.textContent)).toEqual(["A", "B", "C"]);
    trail.querySelector(".trail-crumb").click(); // "A": out to the scene itself
    expect(view.atom.get().focus).toEqual([]);
    expect(view.root.querySelector(".stage-trail")).toBe(null);
    await placed(view);
    view.enter(["L"]);
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
      const runs = (v) => J(v.stages().map((x) => [x.path, x.acts, x.debug.host.running().map((r) => r.id)]));
      const before = { mine: runs(m.view), theirs: runs(ov), focus: ov.atom.get().focus, facets: facetsAt(ov) };
      const writes = [spy(s.handle), spy(m.b), spy(m.c)];
      m.view.enter(["L"]);
      m.view.enter(["L", "M"]);
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
        expect(view.router.tools().map((t) => t.owner), name).toEqual([keyOf(view.focusStage().n, "t.measure")]);
        expect(view.focusOn(to), name).toBe(true);
        await placed(view);
        // the body is the one entered, held where it was; the tool went with the focus
        expect([name, bodyId(view), view.atom.get().body?.ext ?? null, view.router.tools()]).toEqual([name, body, holder, []]);
        expect([name, started["t.measure"], offered(view, "commands", "measure")]).toEqual([name, 1, 1]);
        s.unmount();
        s = null;
      }
    }
  }, 60_000);
});

describe("a holder going takes its bodies off the stack", () => {
  // A body is its extension's (STAGE.md, "Bodies"): when the stage it was entered from closes, or the extension
  // stops, it leaves the stack, and every body over it with it (they stood on it); the view then shows the body
  // under it, with its reach, and nothing of what left is anywhere to lock the pointer. The
  // router pops them (stopOwner, as each extension stops), so the view never has a body the router doesn't.
  const body = (id, reach) => ({ id, label: id, reach, lock: true, keys: [{ code: "KeyW" }], enter: () => ({ input: {}, leave: () => left.push(id) }) });
  let left = [];
  const bodies = [
    { meta: { id: "t.walk", traits: ["*"] }, module: { create: () => ({ bodies: [body("t.walk", 3)] }) } },
    { meta: { id: "t.seat", traits: ["t.host"] }, module: { create: () => ({ bodies: [body("t.seat", 1)] }) } },
  ];
  const CASES = [
    ["L closes under its walk", [["L", "t.walk"]], (m) => m.s.change((d) => void delete d.objects.L), ["t.walk"]],
    ["L closes under its walk, A's seat over it", [["L", "t.walk"], ["", "t.seat"]], (m) => m.s.change((d) => void delete d.objects.L), ["t.seat", "t.walk"]],
    ["A's seat under L's walk, L closes: the walk goes, the seat stays", [["", "t.seat"], ["L", "t.walk"]], (m) => m.s.change((d) => void delete d.objects.L), ["t.walk"]],
    ["t.seat uninstalled", [["", "t.seat"]], (m) => m.s.uninstall("t.seat"), ["t.seat"]],
    ["t.walk uninstalled, in every stage", [["", "t.walk"], ["L", "t.walk"]], (m) => m.s.uninstall("t.walk"), ["t.walk", "t.walk"]],
  ];
  it("a stage closing or an extension stopping, under every arrangement of two bodies: the router's stack and the view agree", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [label, entered, go, gone] of CASES) {
      left = [];
      const m = await mountNested({ extra: bodies });
      s = m.s;
      const { view } = m;
      await until(() => stageOf(view, "L")?.debug.host.instanceOf("t.walk") && s.instance("t.seat"), 2000);
      for (const [sp, id] of entered) expect(view.enterBody(id, null, stageOf(view, sp), true), label).toBe(true);
      const stillThere = entered.slice(0, entered.length - gone.length).map(([, id]) => id);
      await go(m);
      await until(() => view.router.bodies().length === 1 + stillThere.length, 2000).catch(() => {});
      const top = stillThere.at(-1) ?? "look";
      expect([label, view.router.bodies().map((x) => x.id), view.router.state().body.lock]).toEqual([label, ["look", ...stillThere], top !== "look"]);
      expect([label, view.atom.get().body.id, view.bodyReach(), left]).toEqual([label, top, { look: Infinity, "t.seat": 1, "t.walk": 3 }[top], gone]);
      s.unmount();
      s = null;
    }
  });
});

describe("the camera's rides don't depend on the focus (I8)", () => {
  it("a sibling link's stage rides while the focus is inside another link: the latest base ride of any acting stage applies, wherever the focus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const card = () => object({ name: "Card", traits: { "t.card": {} } });
    const b = repo.add(emptyScene({ title: "B", objects: { card: card() }, order: ["card"] }));
    const d = repo.add(emptyScene({ title: "D", objects: { card: card() }, order: ["card"] }));
    const objects = { L: link(b.url, { name: "B" }), N: link(d.url, { name: "D" }) };
    s = await mountStage({ repo, editor: true, natives: true, extensions: extensions([]), doc: { title: "A", objects, order: Object.keys(objects) } });
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

