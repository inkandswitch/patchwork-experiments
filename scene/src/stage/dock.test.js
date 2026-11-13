// The drawer (dock.js): the pure model over every sequence of up to five
// acts on three keys, and the DOM that follows it.
import { describe, it, expect, vi } from "vitest";
import { EMPTY, createDrawer, docked, shown, shownOf, undocked } from "./dock.js";
import { EMBED_ATTR } from "../embed.js";

const KEYS = ["a", "b", "c"];
const ACTS = { docked, shown, undocked };
const STEPS = Object.keys(ACTS).flatMap((act) => KEYS.map((key) => [act, key]));

/** What the model must say, kept the obvious way: a list of tabs, and a history of what was shown. */
function reference(ref, [act, key]) {
  let { tabs, history } = ref;
  if (act === "docked") {
    if (!tabs.includes(key)) tabs = [...tabs, key];
    history = [...history, key];
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
  it("over every sequence of ≤5 of dock, show and undock on three keys: tabs in docking order, the last shown still docked is shown, and nothing else", () => {
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
    expect(n).toBe(1 + 9 + 81 + 729 + 6561 + 59049);
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
