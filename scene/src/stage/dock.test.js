// The drawer (dock.js): the pure model over every sequence of up to five
// acts on three keys, and the DOM that follows it; its width, as finite
// tables and every sequence of up to three acts on two kinds of pane.
import { describe, it, expect, vi } from "vitest";
import { EMPTY, KINDS, MAX_PX, MIN_PX, createDrawer, docked, dockedBehind, dragged, kindOf, prefKey, shown, shownOf, stepped, undocked, widthFor } from "./dock.js";
import { EMBED_ATTR } from "../embed.js";

const KEYS = ["a", "b", "c"];
const ACTS = { docked, dockedBehind, shown, undocked };
const STEPS = Object.keys(ACTS).flatMap((act) => KEYS.map((key) => [act, key]));

/** What the model must say, kept the obvious way: a list of tabs, and a history of what was shown. */
function reference(ref, [act, key]) {
  let { tabs, history } = ref;
  if (act === "docked") {
    if (!tabs.includes(key)) tabs = [...tabs, key];
    history = [...history, key];
  } else if (act === "dockedBehind") {
    // the least recently shown: shown only when it's the only one
    if (!tabs.includes(key)) {
      tabs = [...tabs, key];
      history = [key, ...history];
    }
  } else if (act === "shown") {
    if (tabs.includes(key)) history = [...history, key];
  } else {
    tabs = tabs.filter((k) => k !== key);
    history = history.filter((k) => k !== key);
  }
  return { tabs, history };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What's wrong with `s`, reached from `before` by one step and kept beside the reference `ref`; null if nothing. */
function wrong(before, [act, key], s, ref) {
  if (new Set(s.order).size !== s.order.length) return "a key docked twice";
  if (!same([...s.recent].sort(), [...s.order].sort())) return "recent and order differ";
  if (act === "docked" && shownOf(s) !== key) return "docking didn't show it";
  if (act === "dockedBehind" && before.order.length && shownOf(s) !== shownOf(before)) return "docking behind took over what was shown";
  if (act === "dockedBehind" && !s.order.includes(key)) return "docking behind didn't dock it";
  if (act === "undocked" && s.order.includes(key)) return "undocking left it";
  if (act === "shown" && !before.order.includes(key) && s !== before) return "showing an undocked key changed something";
  if (!same(s.order.filter((k) => k !== key), before.order.filter((k) => k !== key))) return "the others' tab order changed";
  if (!(Object.isFrozen(s) && Object.isFrozen(s.order) && Object.isFrozen(s.recent))) return "not frozen";
  if (!same(s.order, ref.tabs)) return "tabs differ from the reference";
  if (shownOf(s) !== (ref.history.at(-1) ?? null)) return "shown differs from the reference";
  if ((shownOf(s) === null) !== (s.order.length === 0)) return "nothing shown ⇎ nothing docked";
  return null;
}

describe("the drawer's model, exhaustively", () => {
  it("over every sequence of ≤5 of dock, dock behind, show and undock on three keys: tabs in docking order, the last shown still docked is shown, and nothing else", () => {
    const failures = [];
    let n = 0;
    // depth first, so each prefix is computed once
    (function walk(s, ref, seq) {
      n++;
      if (seq.length === 5) return;
      for (const step of STEPS) {
        const next = ACTS[step[0]](s, step[1]);
        const nextRef = reference(ref, step);
        const bad = wrong(s, step, next, nextRef);
        if (bad && failures.length < 5) failures.push({ seq: [...seq, step], bad });
        walk(next, nextRef, [...seq, step]);
      }
    })(EMPTY, { tabs: [], history: [] }, []);
    expect(failures).toEqual([]);
    expect(n).toBe(1 + 12 + 144 + 1728 + 20736 + 248832);
  });
});

describe("the drawer's DOM", () => {
  const mount = () => {
    const parent = document.createElement("div");
    const before = document.createElement("div");
    parent.append(before);
    return { parent, before, drawer: createDrawer({ parent }) };
  };
  const tabNames = (d) => [...d.el.querySelectorAll(".stage-drawer-tab-name")].map((b) => b.textContent);
  const shownPane = (d) => [...d.el.querySelectorAll(".stage-drawer-pane")].filter((p) => !p.hidden);

  it("is in its parent, last, only while something is docked; each element in an embedded pane under a tab; one pane shown", () => {
    const { parent, before, drawer } = mount();
    expect(drawer.el.parentNode).toBe(null);
    const a = document.createElement("div");
    const b = document.createElement("div");
    const closeA = drawer.dock("x", a, { title: "Die d20" });
    expect([...parent.children]).toEqual([before, drawer.el]);
    expect(a.parentElement.hasAttribute(EMBED_ATTR)).toBe(true);
    drawer.dock("y", b, { title: "Bag" });
    expect(tabNames(drawer)).toEqual(["Die d20", "Bag"]);
    expect(shownPane(drawer)).toEqual([b.parentElement]);
    expect(drawer.el.querySelector('[aria-selected="true"] .stage-drawer-tab-name').textContent).toBe("Bag");
    // the first tab shows the first
    drawer.el.querySelector(".stage-drawer-tab-name").click();
    expect(shownPane(drawer)).toEqual([a.parentElement]);
    expect(drawer.state()).toEqual({ order: [a, b], shown: a });
    // the caller's close: idempotent; the one shown before shows
    closeA();
    closeA();
    expect(a.isConnected).toBe(false);
    expect(drawer.state()).toEqual({ order: [b], shown: b });
    expect(shownPane(drawer)).toEqual([b.parentElement]);
    drawer.closeOwner("y");
    expect(drawer.el.parentNode).toBe(null);
    expect([...parent.children]).toEqual([before]);
  });

  it("the × closes its pane and calls onClose, once; the caller's close and its owner stopping don't call it", () => {
    const { drawer } = mount();
    const els = [0, 1, 2].map(() => document.createElement("div"));
    const calls = [];
    const closes = els.map((el, i) => drawer.dock(i < 2 ? "x" : "y", el, { title: `p${i}`, onClose: () => calls.push(i) }));
    // ×
    drawer.el.querySelectorAll(".stage-drawer-tab-close")[1].click();
    expect(calls).toEqual([1]);
    expect(drawer.state().order).toEqual([els[0], els[2]]);
    closes[1](); // after the ×: nothing more
    expect(calls).toEqual([1]);
    // the caller
    closes[2]();
    expect(calls).toEqual([1]);
    // its owner stopping
    drawer.closeOwner("x");
    expect(calls).toEqual([1]);
    expect(drawer.state()).toEqual({ order: [], shown: null });
  });

  it("an onClose that throws still closes the pane", () => {
    const { drawer } = mount();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement("div");
    drawer.dock("x", el, {
      title: "t",
      onClose: () => {
        throw new Error("no");
      },
    });
    drawer.el.querySelector(".stage-drawer-tab-close").click();
    expect(el.isConnected).toBe(false);
    expect(drawer.state().order).toEqual([]);
    warn.mockRestore();
  });

  it("docking an element again shows it under its new title and returns the same close", () => {
    const { drawer } = mount();
    const a = document.createElement("div");
    const b = document.createElement("div");
    const close = drawer.dock("x", a, { title: "one" });
    drawer.dock("x", b, { title: "two" });
    expect(drawer.dock("x", a, { title: "uno" })).toBe(close);
    expect(tabNames(drawer)).toEqual(["uno", "two"]);
    expect(drawer.state()).toEqual({ order: [a, b], shown: a });
    expect(drawer.el.querySelectorAll(".stage-drawer-pane")).toHaveLength(2);
  });
});

describe("the drawer's width", () => {
  it("is a side panel's while the stage's own chrome (embed: false) is shown, and a docked editor's room otherwise", () => {
    const parent = document.createElement("div");
    const drawer = createDrawer({ parent });
    const chrome = document.createElement("div");
    const editor = document.createElement("div");
    drawer.dock("x", chrome, { title: "Inspector", embed: false });
    expect(drawer.el.dataset.kind).toBe("chrome");
    expect(chrome.parentElement.hasAttribute("data-stage-embed")).toBe(false);
    drawer.dock("y", editor, { title: "Shape" });
    expect(drawer.el.dataset.kind).toBe("editor");
    drawer.dock("x", chrome, { title: "Inspector", embed: false });
    expect(drawer.el.dataset.kind).toBe("chrome");
  });

  it("kinds: embed false is the stage's chrome; anything else (true, absent) an editor", () => {
    expect(KINDS).toEqual(["chrome", "editor"]);
    expect([false, true, undefined].map(kindOf)).toEqual(["chrome", "editor", "editor"]);
    expect(KINDS.map(prefKey)).toEqual(["drawer.chrome", "drawer.editor"]);
  });

  // (a) what a stored pref means: a px in [MIN, MAX], or nothing (the kind's default); never clamped
  it("widthFor: every kind × every stored value (18 rows)", () => {
    const ABSENT = Symbol("absent");
    const VALUES = [
      [ABSENT, null],
      [300, 300],
      [MIN_PX, MIN_PX],
      [MAX_PX, MAX_PX],
      [MIN_PX - 1, null],
      [MAX_PX + 1, null],
      [NaN, null],
      ["400", null],
      [null, null],
    ];
    const rows = [];
    for (const kind of KINDS)
      for (const [v, want] of VALUES) {
        const prefs = v === ABSENT ? { other: 1 } : { [prefKey(kind)]: v };
        // the other kind's pref is never read
        const other = { ...prefs, [prefKey(KINDS.find((k) => k !== kind))]: 500 };
        rows.push([kind, String(v === ABSENT ? "absent" : v), widthFor(prefs, kind), widthFor(other, kind), want]);
      }
    expect(rows).toHaveLength(18);
    for (const [kind, v, got, gotWithOther, want] of rows) expect([kind, v, got, gotWithOther]).toEqual([kind, v, want, want]);
    expect(widthFor(undefined, "chrome")).toBe(null);
  });

  // (b) a drag: the drawer is at the right, so left widens; always in [MIN, MAX]
  it("dragged: every start × every move (15 rows)", () => {
    const want = {
      [MIN_PX]: { "-10000": MAX_PX, "-1": MIN_PX + 1, 0: MIN_PX, 1: MIN_PX, 10000: MIN_PX },
      400: { "-10000": MAX_PX, "-1": 401, 0: 400, 1: 399, 10000: MIN_PX },
      [MAX_PX]: { "-10000": MAX_PX, "-1": MAX_PX, 0: MAX_PX, 1: MAX_PX - 1, 10000: MIN_PX },
    };
    let n = 0;
    for (const start of [MIN_PX, 400, MAX_PX])
      for (const dx of [-10000, -1, 0, 1, 10000]) {
        n++;
        // the pointer starts at 600 and moves by dx
        expect([start, dx, dragged(start, 600, 600 + dx)]).toEqual([start, dx, want[start][dx]]);
      }
    expect(n).toBe(15);
  });

  // (c) a key on the grip: arrows step (left widens), Shift steps more, Home/End go to the ends; other keys aren't the grip's
  it("stepped: every width × every key × Shift (36 rows)", () => {
    const want = (px, key, shift) => {
      const step = shift ? 64 : 16;
      return {
        ArrowLeft: Math.min(MAX_PX, px + step),
        ArrowRight: Math.max(MIN_PX, px - step),
        Home: MIN_PX,
        End: MAX_PX,
        Enter: null,
        a: null,
      }[key];
    };
    const table = {
      [MIN_PX]: { ArrowLeft: [236, 284], ArrowRight: [MIN_PX, MIN_PX] },
      400: { ArrowLeft: [416, 464], ArrowRight: [384, 336] },
      [MAX_PX]: { ArrowLeft: [MAX_PX, MAX_PX], ArrowRight: [1184, 1136] },
    };
    let n = 0;
    for (const px of [MIN_PX, 400, MAX_PX])
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "a"])
        for (const shift of [false, true]) {
          n++;
          const got = stepped(px, key, shift);
          expect([px, key, shift, got]).toEqual([px, key, shift, want(px, key, shift)]);
          if (table[px][key]) expect(got).toBe(table[px][key][shift ? 1 : 0]);
        }
    expect(n).toBe(36);
  });

  // (d) the DOM: every sequence of ≤3 acts, against the obvious model —
  // no drawer and no grip with nothing docked; else the shown kind's pref or
  // nothing (I1: docking, closing and switching within a kind never move it;
  // I4: no drawer, no grip)
  it("over every sequence of ≤3 acts on two chrome panes and an editor, with prefs set and reset (819 cases): the width is the shown kind's pref", () => {
    const ACTS = ["dock A", "dock B", "dock E", "show A", "show E", "close shown", "chrome 500", "editor 900", "reset editor"];
    const failures = [];
    let n = 0;
    function run(seq) {
      const parent = document.createElement("div");
      let prefs = {};
      const drawer = createDrawer({ parent, prefs: () => prefs, setPref: () => {} });
      const els = { A: document.createElement("div"), B: document.createElement("div"), E: document.createElement("div") };
      const kindOfKey = { A: "chrome", B: "chrome", E: "editor" };
      let m = EMPTY;
      const pref = (k, v) => {
        prefs = { ...prefs };
        if (v === undefined) delete prefs[prefKey(k)];
        else prefs[prefKey(k)] = v;
        drawer.refreshWidth();
      };
      for (const act of seq) {
        if (act === "dock A" || act === "dock B" || act === "dock E") {
          const k = act.at(-1);
          drawer.dock("o", els[k], { title: k, embed: kindOfKey[k] === "editor" });
          m = docked(m, k);
        } else if (act === "show A" || act === "show E") {
          const k = act.at(-1);
          if (m.order.includes(k)) drawer.el.querySelectorAll(".stage-drawer-tab-name")[m.order.indexOf(k)].click();
          m = shown(m, k);
        } else if (act === "close shown") {
          const on = shownOf(m);
          if (on) drawer.el.querySelector('.stage-drawer-tab[aria-selected="true"] .stage-drawer-tab-close').click();
          m = on ? undocked(m, on) : m;
        } else if (act === "chrome 500") pref("chrome", 500);
        else if (act === "editor 900") pref("editor", 900);
        else pref("editor", undefined);
      }
      // the model
      const on = shownOf(m);
      const want = on ? (prefs[prefKey(kindOfKey[on])] ?? null) : null;
      const has = drawer.el.parentNode === parent;
      const grip = parent.querySelector(".stage-drawer-grip");
      const v = drawer.el.style.getPropertyValue("--stage-drawer-width");
      const now = grip?.getAttribute("aria-valuenow") ?? null;
      if (has !== (m.order.length > 0)) return "drawer there ⇎ something docked";
      if (!!grip !== has) return "grip there ⇎ drawer there";
      if (!has) return null;
      if (drawer.el.dataset.kind !== kindOfKey[on]) return `kind ${drawer.el.dataset.kind}, not ${kindOfKey[on]}`;
      if (v !== (want == null ? "" : `${want}px`)) return `width ${JSON.stringify(v)}, not ${want}`;
      if (now !== (want == null ? null : String(want))) return `aria-valuenow ${now}, not ${want}`;
      return null;
    }
    (function walk(seq) {
      if (seq.length) {
        n++;
        const bad = run(seq);
        if (bad && failures.length < 5) failures.push({ seq, bad });
      }
      if (seq.length === 3) return;
      for (const a of ACTS) walk([...seq, a]);
    })([]);
    expect(failures).toEqual([]);
    expect(n).toBe(9 + 81 + 729);
  });
});

describe("the drawer's grip", () => {
  /** A drawer in the document, its chrome pane or editor shown, measuring `seen` px wide. */
  function mount({ kind = "chrome", seen = 300, prefs: start = {} } = {}) {
    const parent = document.createElement("div");
    document.body.append(parent);
    let prefs = { ...start };
    const calls = [];
    const drawer = createDrawer({
      parent,
      prefs: () => prefs,
      setPref: (key, px) => {
        calls.push([key, px]);
        prefs = { ...prefs };
        if (px === undefined) delete prefs[key];
        else prefs[key] = px;
      },
    });
    drawer.el.getBoundingClientRect = () => ({ width: seen, height: 400, x: 0, y: 0, top: 0, left: 0, right: seen, bottom: 400 });
    drawer.dock("o", document.createElement("div"), { title: "P", embed: kind === "editor" });
    const ptr = (type, x, extra = {}) => {
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0, pointerId: 7, ...extra });
      drawer.grip.dispatchEvent(e);
      return e;
    };
    const key = (k, extra = {}) => {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k, ...extra });
      drawer.grip.dispatchEvent(e);
      return e;
    };
    const width = () => drawer.el.style.getPropertyValue("--stage-drawer-width");
    return { parent, drawer, calls, ptr, key, width, prefs: () => prefs, done: () => parent.remove() };
  }

  it("is the drawer's first child: a focusable vertical separator", () => {
    const g = mount();
    const grip = g.drawer.el.firstElementChild;
    expect(grip).toBe(g.drawer.grip);
    expect([grip.getAttribute("role"), grip.getAttribute("aria-orientation"), grip.tabIndex, grip.getAttribute("aria-label")]).toEqual(["separator", "vertical", 0, "Drawer width"]);
    expect(grip.getAttribute("aria-valuenow")).toBe("300");
    g.done();
  });

  it("a drag sets the shown kind's width live and stores it once, at the end, clamped; left widens", () => {
    for (const kind of KINDS) {
      const g = mount({ kind });
      const down = g.ptr("pointerdown", 500);
      expect(down.defaultPrevented).toBe(true);
      g.ptr("pointermove", 450);
      expect(g.width()).toBe("350px");
      g.ptr("pointermove", -5000);
      expect(g.width()).toBe(`${MAX_PX}px`);
      expect(g.calls).toEqual([]);
      g.ptr("pointerup", 400);
      expect(g.calls).toEqual([[prefKey(kind), 400]]);
      expect(g.width()).toBe("400px");
      // a move after the press is over does nothing
      g.ptr("pointermove", 100);
      expect(g.calls).toHaveLength(1);
      expect(g.width()).toBe("400px");
      g.done();
    }
  });

  it("a press that doesn't move (a click, half a double-click) stores nothing; a cancelled drag stores nothing and puts the width back", () => {
    const g = mount({ prefs: { [prefKey("chrome")]: 300 } });
    g.ptr("pointerdown", 500);
    g.ptr("pointerup", 500);
    g.ptr("pointerdown", 500);
    g.ptr("pointermove", 500);
    g.ptr("pointerup", 500);
    expect(g.calls).toEqual([]);
    g.ptr("pointerdown", 500);
    g.ptr("pointermove", 300);
    expect(g.width()).toBe("500px");
    g.ptr("pointercancel", 300);
    expect(g.calls).toEqual([]);
    expect(g.width()).toBe("300px");
    // another pointer's events, and a press of another button, are not the drag's
    g.ptr("pointerdown", 500, { button: 2 });
    g.ptr("pointermove", 300);
    g.ptr("pointerup", 300);
    g.ptr("pointerdown", 500);
    g.ptr("pointermove", 300, { pointerId: 8 });
    g.ptr("pointerup", 300, { pointerId: 8 });
    expect(g.calls).toEqual([]);
    g.done();
  });

  it("a key of the grip's stores once and goes no further; any other key isn't its own", () => {
    const g = mount({ seen: 300 });
    const outside = [];
    g.parent.addEventListener("keydown", (e) => outside.push(e.key));
    const left = g.key("ArrowLeft");
    expect([left.defaultPrevented, g.calls]).toEqual([true, [[prefKey("chrome"), 316]]]);
    g.key("End", { shiftKey: true });
    expect(g.calls.at(-1)).toEqual([prefKey("chrome"), MAX_PX]);
    const enter = g.key("Enter");
    const a = g.key("a");
    expect([enter.defaultPrevented, a.defaultPrevented]).toEqual([false, false]);
    expect(g.calls).toHaveLength(2);
    expect(outside).toEqual(["Enter", "a"]);
    g.done();
  });

  it("a double-click gives the shown kind its default back", () => {
    for (const kind of KINDS) {
      const g = mount({ kind, prefs: { [prefKey("chrome")]: 500, [prefKey("editor")]: 900 } });
      expect(g.width()).toBe(kind === "chrome" ? "500px" : "900px");
      g.drawer.grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      expect(g.calls).toEqual([[prefKey(kind), undefined]]);
      expect(g.width()).toBe("");
      // the other kind's is kept
      expect(widthFor(g.prefs(), kind === "chrome" ? "editor" : "chrome")).toBe(kind === "chrome" ? 900 : 500);
      g.done();
    }
  });

  it("starts from what's seen: a drag or a key from the measured width, not the pref the CSS clamped", () => {
    const g = mount({ seen: 448, prefs: { [prefKey("chrome")]: 1000 } });
    g.key("ArrowRight");
    expect(g.calls).toEqual([[prefKey("chrome"), 432]]);
    g.done();
  });
});

describe("the drawer tells what's docked and shown", () => {
  it("onChange({ tabs, shown }) on every dock, show and close", () => {
    const seen = [];
    const drawer = createDrawer({ parent: document.createElement("div"), onChange: (d) => seen.push(JSON.stringify(d)) });
    const a = document.createElement("div");
    const b = document.createElement("div");
    const closeA = drawer.dock("x", a, { title: "A" });
    drawer.dock("y", b, { title: "B", show: false });
    closeA();
    expect(seen).toEqual([JSON.stringify({ tabs: ["A"], shown: "A" }), JSON.stringify({ tabs: ["A", "B"], shown: "A" }), JSON.stringify({ tabs: ["B"], shown: "B" })]);
  });
});
