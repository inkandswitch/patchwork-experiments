// The drawer (drawer.js): the pure model over every sequence of up to five
// acts on three keys, and the DOM that follows it; its width, as finite
// tables and every sequence of up to three acts on two kinds of pane.
import { describe, it, expect, vi } from "vitest";
import { EMPTY, KINDS, MAX_PX, MIN_PX, createDrawer, docked, dockedBehind, dragged, prefKey, shown, shownOf, stepped, undocked, widthFor } from "./drawer.js";
import { EMBED_ATTR } from "../embed.js";

// Does a stage-scoped style rule reach `el`? Every one is `.scene-tool <x>:where(:not(.about-embed *),
// .about-embed .scene-tool *)` (embed-css.test.js); spelled out, since happy-dom can't match a complex
// selector inside :not
const sceneStyled = (el) => el.matches(".scene-tool *") && (!el.parentElement.closest(".about-embed") || el.matches(".about-embed .scene-tool *"));

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
  it("over every sequence of ≤3 acts on two chrome panes and an editor, retitled, with prefs set and reset (1110 cases): the width is the shown kind's pref", () => {
    const ACTS = ["dock A", "dock B", "dock E", "show A", "show E", "retitle A", "close shown", "chrome 500", "editor 900", "reset editor"];
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
        } else if (act === "retitle A") {
          if (m.order.includes("A")) drawer.dock("o", els.A, { title: "A, renamed", show: false });
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
      if (els[on].parentElement.hasAttribute(EMBED_ATTR) !== (kindOfKey[on] === "editor")) return "embedded ⇎ an editor";
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
    expect(n).toBe(10 + 100 + 1000);
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
    const content = document.createElement("div");
    const close = drawer.dock("o", content, { title: "P", embed: kind === "editor" });
    // (the button is down from the press until its release)
    const ptr = (type, x, extra = {}) => {
      const buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0;
      const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0, buttons, pointerId: 7, ...extra });
      drawer.grip.dispatchEvent(e);
      return e;
    };
    const key = (k, extra = {}, type = "keydown") => {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, code: k, ...extra });
      drawer.grip.dispatchEvent(e);
      return e;
    };
    const width = () => drawer.el.style.getPropertyValue("--stage-drawer-width");
    return { parent, drawer, content, close, calls, ptr, key, width, prefs: () => prefs, done: () => parent.remove() };
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

  it("a key held elsewhere is let go elsewhere: its auto-repeats and its keyup on the grip are not the grip's; a key the grip took is the grip's until its keyup", () => {
    const g = mount({ seen: 300 });
    const outside = [];
    for (const t of ["keydown", "keyup"]) g.parent.addEventListener(t, (e) => outside.push(`${t} ${e.key}${e.repeat ? " repeat" : ""}`));
    // ArrowLeft went down at the stage; focus came to the grip while it is held
    const rep = g.key("ArrowLeft", { repeat: true });
    const up = g.key("ArrowLeft", {}, "keyup");
    expect([rep.defaultPrevented, g.calls]).toEqual([false, []]);
    expect(outside).toEqual(["keydown ArrowLeft repeat", "keyup ArrowLeft"]);
    // pressed on the grip: its repeats step too, and its keyup stops here
    g.key("ArrowRight");
    g.key("ArrowRight", { repeat: true });
    g.key("ArrowRight", {}, "keyup");
    expect(g.calls).toEqual([
      [prefKey("chrome"), 284],
      [prefKey("chrome"), 284],
    ]);
    expect(outside).toHaveLength(2);
    // and once let go, it isn't the grip's any more
    g.key("ArrowRight", { repeat: true });
    g.key("ArrowRight", {}, "keyup");
    expect(outside).toEqual(["keydown ArrowLeft repeat", "keyup ArrowLeft", "keydown ArrowRight repeat", "keyup ArrowRight"]);
    expect(g.calls).toHaveLength(2);
    g.done();
  });

  // Every way a key the grip took stops being the grip's: then its
  // auto-repeats and its keyup on the grip go on (it may be held at the stage
  // by then), and resize nothing.
  it("a key the grip took stops being its own on its keyup, the grip's blur, or its drawer going (3 rows)", () => {
    const ENDS = [
      ["its keyup", (g) => g.key("ArrowRight", {}, "keyup")],
      ["the grip's blur", (g) => g.drawer.grip.dispatchEvent(new FocusEvent("blur"))],
      ["its drawer going", (g) => (g.close(), g.drawer.dock("o", g.content, { title: "P", embed: false }))],
    ];
    const rows = ENDS.map(([name, end]) => {
      const g = mount({ seen: 300 });
      g.key("ArrowRight");
      end(g);
      const stored = g.calls.length;
      const outside = [];
      for (const t of ["keydown", "keyup"]) g.parent.addEventListener(t, () => outside.push(t));
      const rep = g.key("ArrowRight", { repeat: true });
      g.key("ArrowRight", {}, "keyup");
      const row = [name, stored, rep.defaultPrevented, g.calls.length, outside];
      g.done();
      return row;
    });
    expect(rows).toEqual(ENDS.map(([name]) => [name, 1, false, 1, ["keydown", "keyup"]]));
  });

  // Every way a drag ends. Only its own release stores; after any of them a
  // move without the button (a hover) and a later release are nobody's.
  it("a drag ends on its release, a cancel, lost capture, a move with the button up, its drawer going, or its kind no longer shown; then a hover does nothing (6 rows)", () => {
    const ENDS = [
      ["pointerup", (g) => g.ptr("pointerup", 400), 400],
      ["pointercancel", (g) => g.ptr("pointercancel", 400), null],
      ["lostpointercapture", (g) => g.ptr("lostpointercapture", 400), null],
      ["a move with the button up", (g) => g.ptr("pointermove", 400, { buttons: 0 }), null],
      ["its drawer going", (g) => (g.close(), g.drawer.dock("o", g.content, { title: "P", embed: false })), null],
      ["its kind no longer shown", (g) => g.drawer.dock("q", document.createElement("div"), { title: "E" }), null],
    ];
    const rows = ENDS.map(([name, end]) => {
      const g = mount({ seen: 300 });
      g.ptr("pointerdown", 500);
      g.ptr("pointermove", 450);
      // a retitle mid-drag keeps the drag's width showing
      g.drawer.dock("o", g.content, { title: "P2", embed: false });
      const live = g.width();
      end(g);
      const stored = g.calls.map(([, px]) => px);
      const after = g.width();
      g.ptr("pointermove", 100, { buttons: 0 });
      g.ptr("pointerup", 100);
      const row = [name, live, stored, g.width() === after, g.calls.length === stored.length];
      g.done();
      return row;
    });
    expect(rows).toEqual(ENDS.map(([name, , px]) => [name, "350px", px == null ? [] : [px], true, true]));
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
  it("onChange({ tabs, shown, docs }) on every dock, show and close", () => {
    const seen = [];
    const drawer = createDrawer({ parent: document.createElement("div"), onChange: (d) => seen.push(JSON.stringify(d)) });
    const a = document.createElement("div");
    const b = document.createElement("div");
    const closeA = drawer.dock("x", a, { title: "A" });
    drawer.dock("y", b, { title: "B", show: false });
    closeA();
    expect(seen).toEqual([JSON.stringify({ tabs: ["A"], shown: "A", docs: [] }), JSON.stringify({ tabs: ["A", "B"], shown: "A", docs: [] }), JSON.stringify({ tabs: ["B"], shown: "B", docs: [] })]);
  });
});

// ─── documents in the drawer (STAGE.md, "The interface", "Documents in the drawer") ──────

const A = "automerge:2j9vHjM4kfgV7xYGVhQjNzr2Ucqh";
const B = "automerge:3k9vHjM4kfgV7xYGVhQjNzr2Ucqh";

/** A drag event carrying `data` ({ mime: value }), as the browser hands it to a listener. */
function dragEvent(type, data = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), files: [], dropEffect: "none", getData: (t) => data[t] ?? "" } });
  return e;
}

describe("documents docked in the drawer", () => {
  // a stand-in for the host's embed element: dockDocument shows a document in one, as the inspector does
  if (!customElements.get("patchwork-view")) customElements.define("patchwork-view", class extends HTMLElement {});

  function mount() {
    const seen = [];
    // inside the view's root, as the stage mounts it (view.js), so the scene's style rules could reach in
    const parent = document.createElement("div");
    parent.className = "scene-tool scene-stage";
    document.body.append(parent);
    const drawer = createDrawer({ parent, onChange: (d) => seen.push(d) });
    // the stage's own chrome, already there (the inspector): the scene's styles are its own
    const chrome = document.createElement("div");
    drawer.dock("t.inspector", chrome, { title: "Inspector", embed: false });
    expect(sceneStyled(chrome)).toBe(true);
    return { drawer, seen, parent };
  }
  const tabNames = (d) => [...d.el.querySelectorAll(".stage-drawer-tab-name")].map((b) => b.textContent);
  /** each docked document's pane: [its view's doc-url|tool-id, is it embedded (its keys its own) and unstyled by the scene (its look its own)?] */
  const docPanes = (d) =>
    [...d.el.querySelectorAll(".stage-drawer-pane")]
      .filter((p) => p.querySelector(".stage-drawer-doc"))
      .map((p) => {
        const v = p.querySelector(".stage-drawer-doc > patchwork-view");
        return [`${v.getAttribute("doc-url")}|${v.getAttribute("tool-id") ?? ""}`, p.hasAttribute(EMBED_ATTR) && !sceneStyled(v)];
      });
  const shownTab = (d) => d.el.querySelector('[aria-selected="true"] .stage-drawer-tab-name')?.textContent ?? null;

  // a sequence, each act on the drawer as the last left it: [act, then the tabs, the tab shown, view.drawer.docs]
  const closes = {};
  const SEQUENCE = [
    ["dock A", (d) => (closes.A = d.dockDocument({ url: A, title: "A" })), ["Inspector", "A"], "A", [`${A}|`]],
    ["dock A again as \"A2\" (the Inspector shown meanwhile): its tab shows, under its first title, no second pane", (d) => (d.el.querySelector(".stage-drawer-tab-name").click(), d.dockDocument({ url: A, title: "A2" })), ["Inspector", "A"], "A", [`${A}|`]],
    ["dock A with tool X: another pane", (d) => (closes.AX = d.dockDocument({ url: A, toolId: "x", title: "A in X" })), ["Inspector", "A", "A in X"], "A in X", [`${A}|`, `${A}|x`]],
    ["dock A with tool Y: another pane", (d) => d.dockDocument({ url: A, toolId: "y", title: "A in Y" }), ["Inspector", "A", "A in X", "A in Y"], "A in Y", [`${A}|`, `${A}|x`, `${A}|y`]],
    ["× on A", (d) => d.el.querySelectorAll(".stage-drawer-tab-close")[1].click(), ["Inspector", "A in X", "A in Y"], "A in Y", [`${A}|x`, `${A}|y`]],
    ["close() of A in X, twice", () => (closes.AX(), closes.AX()), ["Inspector", "A in Y"], "A in Y", [`${A}|y`]],
    ["dock A again after its ×: a new pane, under the title given now", (d) => d.dockDocument({ url: A, title: "A again" }), ["Inspector", "A in Y", "A again"], "A again", [`${A}|y`, `${A}|`]],
  ];
  it("one pane per document and tool: every act of the sequence (7 rows) → the tabs, the one shown, and docs", () => {
    const { drawer, seen } = mount();
    for (const [name, act, tabs, on, docs] of SEQUENCE) {
      act(drawer);
      expect([name, tabNames(drawer)]).toEqual([name, tabs]);
      expect([name, shownTab(drawer)]).toEqual([name, on]);
      // what the view publishes (view.drawer.docs) is what's docked, in docking order
      expect([name, seen.at(-1).docs]).toEqual([name, docs]);
      // a pane each, each the host's view of its doc and tool, embedded: its keys and its look its own, as inline
      expect([name, docPanes(drawer)]).toEqual([name, docs.map((k) => [k, true])]);
    }
    // its pane is an editor's (the width it docks at)
    expect(drawer.el.dataset.kind).toBe("editor");
  });

  it("a url that isn't a document's docks nothing; a version's heads are dropped (a pane follows the latest)", () => {
    const { drawer, seen } = mount();
    const n = seen.length;
    drawer.dockDocument({ url: "https://example.com", title: "web" });
    drawer.dockDocument({ title: "nothing" });
    expect(seen.length).toBe(n);
    expect(tabNames(drawer)).toEqual(["Inspector"]);
    drawer.dockDocument({ url: `${A}#2j9vHjM4kfgV7xYGVhQjNzr2Ucqh2j9vHjM4kfgV7xYGVhQjNzr2Ucqh` });
    expect(seen.at(-1).docs).toEqual([`${A}|`]);
    expect(tabNames(drawer)).toEqual(["Inspector", "Document"]);
  });

  it("no owner closing reaches them (they're the view's); dispose takes everything, docs [] last", () => {
    const { drawer, seen } = mount();
    drawer.dockDocument({ url: A, title: "A" });
    drawer.closeOwner("t.inspector");
    expect(tabNames(drawer)).toEqual(["A"]);
    const view = drawer.el.querySelector("patchwork-view");
    drawer.dispose();
    expect(seen.at(-1)).toEqual({ tabs: [], shown: null, docs: [] });
    expect(view.isConnected).toBe(false);
    expect(drawer.el.isConnected).toBe(false);
  });

  // a drop on the tab strip: [payload, then the docs docked by it (each `${url}|${toolId}`)]
  const ROW = JSON.stringify({ scene: A, ids: ["x"] });
  const DROPS = [
    ["one item with a tool", { "text/x-patchwork-dnd": JSON.stringify({ source: "scene", items: [{ url: A, name: "Source", toolId: "notes" }] }), "text/x-patchwork-urls": JSON.stringify([A]), "text/plain": A }, [`${A}|notes`]],
    ["two items", { "text/x-patchwork-dnd": JSON.stringify({ items: [{ url: A, name: "One" }, { url: B, name: "Two" }] }) }, [`${A}|`, `${B}|`]],
    ["the url list", { "text/x-patchwork-urls": JSON.stringify([B]) }, [`${B}|`]],
    ["a url as text", { "text/plain": B }, [`${B}|`]],
    ["text that isn't a url", { "text/plain": "just words" }, []],
    ["an outline row (its row payload and its document)", { "application/x-scene-object": ROW, "text/x-patchwork-dnd": JSON.stringify({ source: "scene", items: [{ url: B, name: "Hull" }] }), "text/x-patchwork-urls": JSON.stringify([B]), "text/plain": B }, [`${B}|`]],
    ["nothing", {}, []],
  ];
  it.each(DROPS)("a drop of %s on the tab strip docks exactly those, and goes no further", (_name, data, want) => {
    const { drawer, seen, parent } = mount();
    const strip = drawer.el.querySelector(".stage-drawer-tabs");
    const beyond = vi.fn();
    for (const type of ["dragenter", "dragover", "drop"]) parent.addEventListener(type, beyond);
    const over = dragEvent("dragover", data);
    strip.dispatchEvent(over);
    // it may drop here exactly when it carries something a document could be (only the types are readable yet)
    const carries = ["text/x-patchwork-dnd", "text/x-patchwork-urls", "text/plain"].some((t) => t in data);
    expect(over.defaultPrevented).toBe(carries);
    expect(strip.classList.contains("drop-over")).toBe(carries);
    const drop = dragEvent("drop", data);
    strip.dispatchEvent(drop);
    expect(strip.classList.contains("drop-over")).toBe(false);
    expect(seen.at(-1).docs).toEqual(want);
    // none of it reaches the stage (the scene's add, a row's copy): the strip's drags are its own
    expect(beyond).not.toHaveBeenCalled();
    parent.remove();
  });

  it("a drag leaving the strip unmarks it; one moving between its tabs doesn't", () => {
    const { drawer } = mount();
    const strip = drawer.el.querySelector(".stage-drawer-tabs");
    strip.dispatchEvent(dragEvent("dragenter", { "text/plain": A }));
    expect(strip.classList.contains("drop-over")).toBe(true);
    const inside = dragEvent("dragleave");
    Object.defineProperty(inside, "relatedTarget", { value: strip.querySelector(".stage-drawer-tab-name") });
    strip.dispatchEvent(inside);
    expect(strip.classList.contains("drop-over")).toBe(true);
    strip.dispatchEvent(dragEvent("dragleave"));
    expect(strip.classList.contains("drop-over")).toBe(false);
  });
});
