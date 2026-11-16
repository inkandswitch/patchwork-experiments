// Edit in context (COMPOSITION.md build step 14): Enter moves the focus into
// a link whose doc acts, Leave moves it out, and H10 holds across docs: a
// selection is always an element of the focus stage. Checked in a real view
// with nested stages (no WebGL: hits are stubbed as the viewport keys them).
//
// The harness is exhaustive over the view's state, not over sequences: the
// view's focus and selection are its whole state as far as selection goes
// (the general parts' placement is a function of the focus, checked), so
// every reachable state × every event covers every sequence of any length.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until, wallAt } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { elementOf, keyOf } from "./paths.js";
import { spy } from "../test/spy.js";
import { atFocus, focusSteps, selectionAtFocus, selectionStep } from "../selection.js";
import { EDIT } from "./bodies.js";
import focusPart from "../parts/focus.js";
import outline from "../parts/outline.js";
import toolbar from "../parts/toolbar.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const J = JSON.stringify;

/** Trait parts that record what reaches them, a general one (it runs at the focus), and Enter (scene.focus). */
function extensions(log) {
  const input = (who) => ({ press: (ev) => (log.push(`${who} ${ev.hit?.id ?? "-"}`), null), click: (ev) => (log.push(`click ${who} ${ev.hit?.id ?? "-"}`), null) });
  return [
    { meta: { id: "t.card", traits: ["t.card"] }, module: { create: () => ({ input: input("t.card") }) } },
    { meta: { id: "t.host", traits: ["t.host"] }, module: { create: () => ({ input: input("t.host") }) } },
    { meta: { id: "t.general" }, module: { create: () => ({ input: input("t.general") }) } },
    { meta: { id: "scene.focus" }, module: focusPart },
  ];
}

/**
 * Parts that hold something (TOOLS.md §4): a general one offering a body
 * (as walk does), a general one offering a tool (as Measure does), and the
 * host's trait part offering a seat. Each counts its starts.
 */
function holders(started) {
  const count = (id) => (started[id] = (started[id] ?? 0) + 1);
  const body = (id) => ({ id, label: id, enter: () => ({ input: {} }) });
  return [
    { meta: { id: "t.walk" }, module: { create: () => (count("t.walk"), { bodies: [body("t.walk")] }) } },
    { meta: { id: "t.measure" }, module: { create: () => (count("t.measure"), { commands: [{ id: "measure", name: "Measure", tool: {}, run: () => ({ press: () => null }) }] }) } },
    { meta: { id: "t.seat", traits: ["t.host"] }, module: { create: () => (count("t.seat"), { bodies: [body("t.seat")] }) } },
  ];
}

/**
 * Host A: a table, L and R both live links to B (L acts, R mirrors it: the
 * first in path order acts), P a pin of B, X a link to a doc that can't be
 * opened. B: a card and M, a live link to C. C: a piece. So the stages are
 * A [], B [L], C [L, M], B again [R] and C again [R, M] (mirrors), and B
 * pinned [P] (its M closed: unpinned, the pin holds no C).
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
  await until(() => ["L", "L/M", "R", "R/M", "P"].every((p) => stageOf(view, p)?.debug.host.instanceOf("t.card")) && s.api("t.host")?.link("X")?.role === "closed", 3000);
  return { s, view, repo, b, c, log };
}

const stageOf = (view, p) => view.stages().find((x) => x.path.join("/") === p) ?? null;
// the stages, by path, and what each holds
const STAGES = { "": ["table", "L", "R", "P", "X"], L: ["card", "M"], "L/M": ["piece"], R: ["card", "M"], "R/M": ["piece"], P: ["card", "M"] };
const ACTING = new Set(["", "L", "L/M"]);
// where Enter on a link goes: where its doc acts (a mirror's: where it's live); a pin and a closed link nowhere
const ENTERS = { L: ["L"], R: ["L"], "L/M": ["L", "M"], "R/M": ["L", "M"] };
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
  // value, nor in a way to leave (the view's), nor what moving the focus closed (a general part's alone)
  for (const x of view.stages()) {
    const api = x.debug.host.record(x.path.length ? "t.card" : "t.host")?.api;
    expect(api.view.get().selected ?? null, why(`stage ${J(x.path)} sees its element`)).toBe(elementOf(st.selected, x.path));
    expect("focus" in api.view.get(), why("no stage sees the focus")).toBe(false);
    expect(["leave", "reopened"].filter((k) => k in api.view), why("a stage's view has no way out and no reopen")).toEqual([]);
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

/** The general parts run in the focus stage, and nowhere else. */
const generalsAt = (view) => view.stages().filter((x) => x.generals().length).map((x) => x.path.join("/"));
async function placed(view) {
  const want = view.atom.get().focus.join("/");
  await until(() => J(generalsAt(view)) === J([want]) && view.focusStage().debug.host.instanceOf("scene.focus") && view.focusStage().debug.host.instanceOf("t.general"), 2000);
}

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("H10 across docs: the selection is always an element of the focus stage", () => {
  it("every reachable focus and selection × every press, Select, Enter, Leave and Escape, over nested links, mirrors, a pin and a closed link: as the model says, and nothing written", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    view.enterBody(EDIT.id);
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
    expect(evs.length).toBe(37); // 13 presses, 13 Selects, 7 Enters, press nothing, select nothing, Leave, Escape
    // focus and selection are the viewer's: no doc was written
    expect(writes.map((w) => w())).toEqual([[], [], []]);
  }, 60_000);
});

describe("Enter and Leave", () => {
  it("Enter moves the general parts into the linked doc's stage; Leave moves them back; a mirror enters where it's live; a pin and a closed link don't", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    const host = s.api("t.host");
    expect(generalsAt(view)).toEqual([""]);
    // Enter's verb says what each link does
    const enterOf = (id) => view.stage(0).debug.host.instanceOf("scene.focus").commands[0].state(id);
    expect(enterOf("table")).toBe(null);
    expect(enterOf("L").disabled).toBeFalsy();
    expect(enterOf("R").disabled).toBeFalsy();
    expect(enterOf("P")).toMatchObject({ disabled: true, title: expect.stringMatching(/Follow latest/) });
    expect(enterOf("X")).toMatchObject({ disabled: true, title: expect.stringMatching(/unavailable/) });
    expect(host.view.enter("P")).toBe(false);
    expect(host.view.enter("X")).toBe(false);
    expect(host.view.enter("table")).toBe(false);
    // nobody has placed the camera yet: something may frame it on opening (scene.autoframe)
    expect(host.camera.touched()).toBe(false);
    // the mirror R enters B where it acts, at L
    expect(host.view.enter("R")).toBe(true);
    expect(view.atom.get().focus).toEqual(["L"]);
    await placed(view);
    expect(generalsAt(view)).toEqual(["L"]);
    // the camera came along: the general parts started in B (autoframe among them) find it placed and leave
    // it be; a stage's part learns nothing of the move (B's, or the host's: sailing's quarter view still waits
    // for a camera nobody placed)
    const touched = () => [host.camera.touched(), apiIn(m, "L").camera.touched(), stageOf(view, "L").debug.host.record("scene.focus").api.camera.touched()];
    expect(touched()).toEqual([false, false, true]);
    // what the doc runs is untouched (H1): only the general parts moved
    const traitRun = (p) => stageOf(view, p).debug.host.running().filter((r) => r.scope !== "general").map((r) => r.id);
    expect(traitRun("")).toEqual(["t.host"]);
    expect(traitRun("L")).toEqual(["t.card"]);
    // deeper, then the trail's way out, then Leave
    expect(apiIn(m, "L").view.enter("M")).toBe(true);
    await placed(view);
    expect(generalsAt(view)).toEqual(["L/M"]);
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
    expect(generalsAt(view)).toEqual([""]);
    // a general part, the view's own, is told what the move closed of its; a stage's part isn't
    expect("reopened" in s.api("scene.focus").view).toBe(true);
    expect("reopened" in host.view).toBe(false);
  });

  it("a double-click on a link enters it (scene.focus); on anything else it doesn't", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view } = m;
    const dbl = (n, id) => {
      view.viewport.pick = () => ({ id: keyOf(n, id), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 });
      const rect = s.canvas.getBoundingClientRect();
      s.canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 20 }));
    };
    dbl(0, "table");
    expect(view.atom.get().focus).toEqual([]);
    dbl(0, "P");
    expect(view.atom.get().focus).toEqual([]);
    // a card of B's, from outside: the host's element is the link, so it enters B
    dbl(stageOf(view, "L").n, "card");
    expect(view.atom.get().focus).toEqual(["L"]);
    await placed(view);
    // inside B, a double-click on its card isn't a link: nothing
    dbl(stageOf(view, "L").n, "card");
    expect(view.atom.get().focus).toEqual(["L"]);
    dbl(stageOf(view, "L/M").n, "piece");
    expect(view.atom.get().focus).toEqual(["L", "M"]);
  });

  it("a double-click resolves to its first press's hit: kept when the first click removed its object, cast again when its stage closed between the clicks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 5000;
    const m = await mountNested({ time: wallAt(() => now) });
    s = m.s;
    const { view, b } = m;
    const under = (n, id) => (view.viewport.pick = () => ({ id: keyOf(n, id), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 }));
    const dbl = () => {
      const rect = s.canvas.getBoundingClientRect();
      s.canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 20 }));
    };
    // B's card under the first press, which (as a first click may) is gone by the second; the host's table under the second
    const L = stageOf(view, "L").n;
    under(L, "card");
    s.click(20, 20);
    b.change((d) => {
      delete d.objects.card;
      d.order = d.order.filter((x) => x !== "card");
    });
    await until(() => !stageOf(view, "L").doc().objects.card);
    now += 200;
    under(0, "table");
    s.click(20, 20);
    now += 10;
    dbl();
    // the double-click was on the card, whose element here is the link L, still there: it enters L (a new ray, on the table, would not)
    expect(view.atom.get().focus).toEqual(["L"]);
    expect(view.leave()).toBe(true);
    await placed(view);
    // L closed and opened again between the clicks: the first press's key names a stage that is gone, so the dblclick casts again
    under(L, "M");
    s.click(20, 20);
    const A = s.handle;
    const was = JSON.parse(JSON.stringify(A.doc().objects.L));
    A.change((d) => delete d.objects.L);
    await until(() => !view.stages().some((x) => x.n === L));
    A.change((d) => (d.objects.L = was));
    await until(() => stageOf(view, "L") && stageOf(view, "L").n !== L && s.api("t.host")?.link("L")?.open, 3000);
    const L2 = stageOf(view, "L").n;
    expect(L2).not.toBe(L);
    now += 200;
    under(L2, "M");
    s.click(20, 20);
    now += 10;
    dbl();
    expect(view.atom.get().focus).toEqual(["L"]);
  });

  it("a double-click the page meets late (busy 1 s after the first press) is still one: the gate times the events' own stamps", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 5000;
    const m = await mountNested({ time: wallAt(() => now) });
    s = m.s;
    const { view } = m;
    const under = (n, id) => (view.viewport.pick = () => ({ id: keyOf(n, id), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 }));
    // B's card (from outside, the link L) under the first press; the page then busy a second on the stage's clock
    // (the inspector opening), the table under the second press; the events themselves stamped as made, ms apart
    under(stageOf(view, "L").n, "card");
    s.click(20, 20);
    now += 1000;
    under(0, "table");
    s.click(20, 20);
    now += 1000;
    const rect = s.canvas.getBoundingClientRect();
    s.canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 20 }));
    expect(view.atom.get().focus).toEqual(["L"]);
  });

  it("outside an entered link stays live: a press out there reaches its own parts, then the general ones (the focus's); in Edit a click there isn't Edit's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await mountNested();
    s = m.s;
    const { view, log } = m;
    view.enterBody(EDIT.id);
    s.api("t.host").view.enter("L");
    await placed(view);
    view.viewport.pick = () => ({ id: "table", point: [0, 0, 0], normal: [0, 1, 0], distance: 3 });
    log.length = 0;
    s.click(20, 20);
    await settle();
    // the host's table: its holder, then the general parts, now B's (their element of the path: nothing)
    expect(log).toEqual(["t.host table", "t.general -", "click t.host table", "click t.general -"]);
    expect(view.atom.get().selected).toBe(null);
    // a card of B's: B's holder, the host's root, the general parts; Edit's click selects it first (it's at the focus)
    view.viewport.pick = () => ({ id: keyOf(stageOf(view, "L").n, "card"), point: [0, 0, 0], normal: [0, 1, 0], distance: 3 });
    log.length = 0;
    s.click(20, 20);
    await settle();
    expect(log).toEqual(["t.card card", "t.general card"]);
    expect(view.atom.get().selected).toEqual(["L", "card"]);
  });

  it("the focus leaves a link that goes, is pinned, or stops acting there; the selection goes with it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases = [
      ["B's M removed, entered at C", ["L", "M"], (m) => m.b.change((d) => void delete d.objects.M), ["L"]],
      ["A's L removed, entered at C", ["L", "M"], (m) => m.s.change((d) => void delete d.objects.L), []],
      ["A's L removed, entered at B", ["L"], (m) => m.s.change((d) => void delete d.objects.L), []],
      ["A's L pinned, entered at B", ["L"], (m) => m.s.change((d) => void (d.objects.L.at = { heads: m.b.heads() })), []],
      ["B's M pinned, entered at C", ["L", "M"], (m) => m.b.change((d) => void (d.objects.M.at = { heads: m.c.heads() })), ["L"]],
      // a link ahead of L in path order: B acts there now, and L is a mirror
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
      const runs = (v) => J(v.stages().map((x) => [x.path, x.role, x.debug.host.running().filter((r) => r.scope !== "general").map((r) => r.id)]));
      const before = { mine: runs(m.view), theirs: runs(ov), focus: ov.atom.get().focus, generals: generalsAt(ov) };
      const writes = [spy(s.handle), spy(m.b), spy(m.c)];
      s.api("t.host").view.enter("L");
      apiIn(m, "L").view.enter("M");
      apiIn(m, "L/M").view.select("piece");
      await placed(m.view);
      expect(m.view.atom.get().selected).toEqual(["L", "M", "piece"]);
      expect({ mine: runs(m.view), theirs: runs(ov), focus: ov.atom.get().focus, generals: generalsAt(ov) }).toEqual(before);
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
    s = await mountStage({ repo, extensions: [HOST, { meta: { id: "scene.focus" }, module: focusPart }, { meta: { id: "scene.toolbar" }, module: toolbar }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug, 3000);
    view.enterBody(EDIT.id);
    expect(s.api("t.host").view.enter("L")).toBe(true);
    await until(() => stageOf(view, "L").debug.host.instanceOf("scene.toolbar"), 2000);
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

describe("the drawer follows the focus", () => {
  it("the Objects tab open as the focus moves opens again inside, on the linked doc's objects; link rows say what they are and enter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const c = repo.add(emptyScene({ title: "C", objects: { piece: object({ name: "Piece" }) }, order: ["piece"] }));
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }), M: link(c.url, { name: "C" }) }, order: ["card", "M"] }));
    const objects = { table: object({ name: "Table" }), L: link(b.url, { name: "B" }), P: link(b.url, { name: "B fixed", at: { heads: b.heads() } }) };
    s = await mountStage({ repo, extensions: [{ meta: { id: "scene.focus" }, module: focusPart }, { meta: { id: "scene.outline" }, module: outline }], doc: { title: "A", objects, order: Object.keys(objects) } });
    const view = s.debug.view;
    await until(() => stageOf(view, "L")?.debug && s.instance("scene.focus") && view.linkState(["P"])?.open, 3000);
    view.enterBody(EDIT.id);
    s.instance("scene.outline").tab.open();
    await settle();
    const rows = () => [...view.root.querySelectorAll(".scene-outline .object-row")].map((li) => [li.dataset.id, li.querySelector(".link-mark")?.textContent ?? null, !!li.querySelector(".enter-link")]);
    await until(() => J(rows()) === J([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["table", null, false], ["L", "linked", true], ["P", "fixed", false]]);
    // its Enter goes in; the tab opens again there, on B's objects
    view.root.querySelector('.object-row[data-id="L"] .enter-link').click();
    expect(view.atom.get().focus).toEqual(["L"]);
    await until(() => J(rows()) === J([["card", null, false], ["M", "linked", true]]), 2000).catch(() => {});
    expect(rows()).toEqual([["card", null, false], ["M", "linked", true]]);
    // a double-click on a link row enters it too
    view.root.querySelector('.object-row[data-id="M"] .row-main').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(view.atom.get().focus).toEqual(["L", "M"]);
    await until(() => J(rows()) === J([["piece", null, false]]), 2000).catch(() => {});
    expect(rows()).toEqual([["piece", null, false]]);
  });
});

describe("what the viewer holds goes on across a focus move", () => {
  // A general part holding something (a body, the held tool) finishes it where it was: the view's move
  // takes H2's busy half (host.setGeneral). Its successor at the focus offers the same; it offers nothing.
  const BODIES = ["look", "edit", "t.walk", "t.seat"];
  const MOVES = [
    ["Enter", [], ["L"]],
    ["Enter deeper", ["L"], ["L", "M"]],
    ["Leave", ["L"], []],
    ["Leave out of two", ["L", "M"], []],
  ];
  const bodyId = (view) => view.atom.get().body?.id ?? null;
  const offered = (view, name, id) => view.collect(name).flatMap((x) => x.value).filter((v) => v?.id === id).length;

  it("every body × every move: the body stays, the walk part holding it isn't started again, and nothing is offered twice", async () => {
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
        await until(() => view.focusStage().debug.host.instanceOf("t.walk"), 2000);
        expect(view.enterBody(body), name).toBe(true);
        expect(bodyId(view), name).toBe(body);
        const walks = started["t.walk"];
        const holder = body === "t.walk" ? view.focusStage() : null;
        expect(view.focusOn(to), name).toBe(true);
        await placed(view);
        await until(() => view.focusStage().debug.host.instanceOf("t.walk"), 2000);
        await settle();
        // the body is the one entered, held by the same instance as before
        expect([name, bodyId(view)]).toEqual([name, body]);
        if (holder) {
          expect(holder.debug.host.instanceOf("t.walk"), `${name}: the walk holding the body runs on`).not.toBe(null);
          expect(holder.debug.host.lingering("t.walk"), `${name}: lingering, out of offer`).toBe(true);
          // the one at the focus started, the one holding didn't again
          expect(started["t.walk"], name).toBe(walks + 1);
        }
        // whatever's held, the view offers each body and command once: the focus stage's
        expect([name, offered(view, "bodies", "t.walk"), offered(view, "commands", "measure")]).toEqual([name, 1, 1]);
        expect([name, view.bodyDefs().get("t.walk")?.stage]).toEqual([name, view.focusStage()]);
        // the general parts are offered from the focus stage alone
        expect(generalsAt(view), name).toEqual([to.join("/")]);
        if (holder) {
          // leaving the body, the walk that held it goes (a busy recheck later); back at Look
          view.enterBody("look");
          await until(() => !holder.debug.host.record("t.walk"), 2000);
          expect(holder.debug.host.record("t.walk"), name).toBe(null);
          expect(bodyId(view), name).toBe("look");
        }
        s.unmount();
        s = null;
      }
    }
  }, 60_000);

  it("back where a busy part still runs, it is kept, not started again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = {};
    const m = await mountNested({ extra: holders(started) });
    s = m.s;
    const { view } = m;
    await until(() => s.instance("t.walk"), 2000);
    const first = s.instance("t.walk");
    expect(view.enterBody("t.walk")).toBe(true);
    view.focusOn(["L"]);
    await placed(view);
    view.focusOn([]);
    await placed(view);
    expect(s.instance("t.walk")).toBe(first);
    expect(view.stage(0).debug.host.lingering("t.walk")).toBe(false);
    expect(bodyId(view)).toBe("t.walk");
    // started once here, once in B (stopped again as the focus left it, holding nothing)
    expect(started["t.walk"]).toBe(2);
    expect(stageOf(view, "L").debug.host.record("t.walk")).toBe(null);
  });

  // the held tool × every move: kept while its stage is on the focus path (TOOLS.md §3), put down
  // when it leaves it, and the part holding it finishes there
  const TOOL_MOVES = [
    // [label, held from, from, to, still held]
    ["held at the scene, Enter", [], [], ["L"], true],
    ["held at the scene, Enter two deep", [], [], ["L", "M"], true],
    ["held in B, Enter deeper", ["L"], ["L"], ["L", "M"], true],
    ["held in B, Leave", ["L"], ["L"], [], false],
    ["held in C, Leave out of two", ["L", "M"], ["L", "M"], [], false],
    ["held in C, Leave one", ["L", "M"], ["L", "M"], ["L"], false],
  ];
  it("the held tool × every move: held while its stage is on the focus path, else put down; never offered twice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [label, heldAt, from, to, still] of TOOL_MOVES) {
      const started = {};
      const m = await mountNested({ extra: holders(started) });
      s = m.s;
      const { view } = m;
      expect(view.focusOn(from), label).toBe(true);
      await placed(view);
      await until(() => view.focusStage().debug.host.instanceOf("t.measure"), 2000);
      const at = view.stageAt(heldAt);
      expect(at.reader.run({ ext: "t.measure", command: "measure" }), label).toBe(true);
      expect(view.router.held()?.owner, label).toBe(keyOf(at.n, "t.measure"));
      view.focusOn(to);
      await placed(view);
      await until(() => view.focusStage().debug.host.instanceOf("t.measure"), 2000);
      await settle();
      expect([label, view.router.held()?.owner ?? null]).toEqual([label, still ? keyOf(at.n, "t.measure") : null]);
      // the part that held it: running on (lingering) while it holds; gone at once once the tool's put down
      const rec = at.debug.host.record("t.measure");
      if (still) expect([label, !!rec, at.debug.host.lingering("t.measure")]).toEqual([label, true, true]);
      else expect([label, rec]).toEqual([label, null]);
      expect([label, offered(view, "commands", "measure")]).toEqual([label, 1]);
      if (still) {
        view.router.putDown();
        await until(() => !at.debug.host.record("t.measure"), 2000);
        expect([label, at.debug.host.record("t.measure")]).toEqual([label, null]);
      }
      s.unmount();
      s = null;
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

describe("leaving Edit puts the selection down (TOOLS.md Decisions 6)", () => {
  // Attention is the selection, so a selection kept from Edit would aim F and
  // the use prompt at what was last edited. Every body changed from × to
  // (Look, Edit, a walk and a seat over Look) × the focus (the scene, one
  // link in, two) × a selection or none: the selection goes exactly when the
  // body leaves Edit; the focus never moves. 4 × 4 × 3 × 2 = 96 cases.
  const BODIES = ["look", "edit", "t.walk", "t.seat"];
  const FOCI = [[], ["L"], ["L", "M"]];
  const ELEMENT = { "": "table", L: "card", "L/M": "piece" };
  it("every body × every body × every focus × a selection or none: cleared exactly on leaving Edit, the focus kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const started = {};
    const m = await mountNested({ extra: holders(started) });
    s = m.s;
    const { view } = m;
    let cases = 0;
    for (const focus of FOCI) {
      expect(view.focusOn(focus)).toBe(true);
      await placed(view);
      await until(() => view.focusStage().debug.host.instanceOf("t.walk"), 2000);
      for (const from of BODIES)
        for (const to of BODIES)
          for (const withSel of [false, true]) {
            const name = `${J(focus)} ${from} → ${to}${withSel ? " selected" : ""}`;
            view.enterBody("look");
            expect(view.enterBody(from), name).toBe(true);
            const sel = withSel ? [...focus, ELEMENT[focus.join("/")]] : null;
            view.select(sel);
            expect(J(view.atom.get().selected), name).toBe(J(sel));
            if (from !== to) expect(view.enterBody(to), name).toBe(true);
            const want = from === "edit" && to !== "edit" ? null : sel;
            expect([name, J(view.atom.get().selected), J(view.atom.get().focus)]).toEqual([name, J(want), J(focus)]);
            cases++;
          }
    }
    expect(cases).toBe(96);
  }, 60_000);
});
