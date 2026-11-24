// The tab keys, case by case: which presses are which command on a Mac and
// elsewhere, and what each command does to every kind of panel there is (a
// stack of tabs, a lone document, an empty frame, the folder, none at all).

import { generateAutomergeUrl } from "@automerge/automerge-repo";
import { describe, expect, it } from "vitest";
import {
  isGetAroundKey,
  tabActionFor,
  tabCommandFor,
  type TabAction,
  type TabCommand,
} from "./tabKeys";
import type { LayoutNode, LeafNode, PanelView } from "./types";

describe("the keys", () => {
  const close: TabCommand = { kind: "close" };
  const next: TabCommand = { kind: "step", by: 1 };
  const prev: TabCommand = { kind: "step", by: -1 };
  const go = (to: number): TabCommand => ({ kind: "go", to });
  const cases: { name: string; init: KeyboardEventInit; mac: TabCommand | null; other: TabCommand | null }[] = [
    { name: "⌥W", init: { code: "KeyW", key: "∑", altKey: true }, mac: close, other: close },
    { name: "Alt+W", init: { code: "KeyW", key: "w", altKey: true }, mac: close, other: close },
    { name: "⌥⇧W", init: { code: "KeyW", key: "„", altKey: true, shiftKey: true }, mac: null, other: null },
    { name: "AltGr+W (Ctrl+Alt)", init: { code: "KeyW", key: "w", altKey: true, ctrlKey: true }, mac: null, other: null },
    { name: "⌘W", init: { code: "KeyW", key: "w", metaKey: true }, mac: null, other: null },
    { name: "Ctrl+W", init: { code: "KeyW", key: "w", ctrlKey: true }, mac: null, other: null },
    { name: "W", init: { code: "KeyW", key: "w" }, mac: null, other: null },
    { name: "Ctrl+Shift+]", init: { code: "BracketRight", key: "}", ctrlKey: true, shiftKey: true }, mac: next, other: next },
    { name: "Ctrl+Shift+[", init: { code: "BracketLeft", key: "{", ctrlKey: true, shiftKey: true }, mac: prev, other: prev },
    { name: "Ctrl+]", init: { code: "BracketRight", key: "]", ctrlKey: true }, mac: null, other: null },
    { name: "⌘⇧]", init: { code: "BracketRight", key: "}", metaKey: true, shiftKey: true }, mac: null, other: null },
    { name: "Ctrl+Alt+Shift+]", init: { code: "BracketRight", key: "}", ctrlKey: true, altKey: true, shiftKey: true }, mac: null, other: null },
    { name: "Ctrl+1", init: { code: "Digit1", key: "1", ctrlKey: true }, mac: go(0), other: null },
    { name: "Ctrl+8", init: { code: "Digit8", key: "8", ctrlKey: true }, mac: go(7), other: null },
    { name: "Ctrl+9", init: { code: "Digit9", key: "9", ctrlKey: true }, mac: go(-1), other: null },
    { name: "Alt+1", init: { code: "Digit1", key: "¡", altKey: true }, mac: null, other: go(0) },
    { name: "Alt+9", init: { code: "Digit9", key: "9", altKey: true }, mac: null, other: go(-1) },
    { name: "⌘1", init: { code: "Digit1", key: "1", metaKey: true }, mac: null, other: null },
    { name: "Ctrl+0", init: { code: "Digit0", key: "0", ctrlKey: true }, mac: null, other: null },
    { name: "Alt+0", init: { code: "Digit0", key: "0", altKey: true }, mac: null, other: null },
    { name: "Ctrl+Shift+1", init: { code: "Digit1", key: "!", ctrlKey: true, shiftKey: true }, mac: null, other: null },
    { name: "Ctrl+Alt+1", init: { code: "Digit1", key: "1", ctrlKey: true, altKey: true }, mac: null, other: null },
    { name: "Alt+numpad 1", init: { code: "Numpad1", key: "1", altKey: true }, mac: null, other: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const event = new KeyboardEvent("keydown", c.init);
      expect(tabCommandFor(event, true)).toEqual(c.mac);
      expect(tabCommandFor(event, false)).toEqual(c.other);
    });
  }
});

describe("keys that only move you around (not engagement)", () => {
  const cases: { name: string; init: KeyboardEventInit; mac: boolean; other: boolean }[] = [
    { name: "a letter", init: { code: "KeyA", key: "a" }, mac: false, other: false },
    { name: "Enter", init: { code: "Enter", key: "Enter" }, mac: false, other: false },
    { name: "⌘Z", init: { code: "KeyZ", key: "z", metaKey: true }, mac: false, other: false },
    { name: "an arrow", init: { code: "ArrowLeft", key: "ArrowLeft" }, mac: false, other: false },
    { name: "Shift alone", init: { code: "ShiftLeft", key: "Shift", shiftKey: true }, mac: true, other: true },
    { name: "⌘ alone", init: { code: "MetaLeft", key: "Meta", metaKey: true }, mac: true, other: true },
    { name: "Ctrl alone", init: { code: "ControlLeft", key: "Control", ctrlKey: true }, mac: true, other: true },
    { name: "⌥ alone", init: { code: "AltLeft", key: "Alt", altKey: true }, mac: true, other: true },
    { name: "⌥W", init: { code: "KeyW", key: "∑", altKey: true }, mac: true, other: true },
    { name: "Ctrl+Shift+]", init: { code: "BracketRight", key: "}", ctrlKey: true, shiftKey: true }, mac: true, other: true },
    { name: "Ctrl+2", init: { code: "Digit2", key: "2", ctrlKey: true }, mac: true, other: false },
    { name: "Alt+2", init: { code: "Digit2", key: "™", altKey: true }, mac: false, other: true },
    { name: "? (the shortcuts)", init: { code: "Slash", key: "?", shiftKey: true }, mac: true, other: true },
    { name: "⌘P", init: { code: "KeyP", key: "p", metaKey: true }, mac: true, other: false },
    { name: "Ctrl+P", init: { code: "KeyP", key: "p", ctrlKey: true }, mac: false, other: true },
    { name: "⌘[ (Back)", init: { code: "BracketLeft", key: "[", metaKey: true }, mac: true, other: false },
    { name: "⌘] (Forward)", init: { code: "BracketRight", key: "]", metaKey: true }, mac: true, other: false },
    { name: "⌘⇧[", init: { code: "BracketLeft", key: "{", metaKey: true, shiftKey: true }, mac: false, other: false },
    { name: "Alt+← (Back)", init: { code: "ArrowLeft", key: "ArrowLeft", altKey: true }, mac: false, other: true },
    { name: "Alt+→ (Forward)", init: { code: "ArrowRight", key: "ArrowRight", altKey: true }, mac: false, other: true },
    { name: "Alt+Shift+← (select a word)", init: { code: "ArrowLeft", key: "ArrowLeft", altKey: true, shiftKey: true }, mac: false, other: false },
    { name: "Ctrl+[ ", init: { code: "BracketLeft", key: "[", ctrlKey: true }, mac: false, other: false },
  ];
  for (const c of cases) {
    it(`${c.name}: ${c.mac ? "yes" : "no"} on a Mac, ${c.other ? "yes" : "no"} elsewhere`, () => {
      const event = new KeyboardEvent("keydown", c.init);
      expect(isGetAroundKey(event, true)).toBe(c.mac);
      expect(isGetAroundKey(event, false)).toBe(c.other);
    });
  }
});

describe("what a command does", () => {
  const [A, B, C, D] = [0, 1, 2, 3].map(() => generateAutomergeUrl());
  const leaf = (id: string, tabs: PanelView[], shown = 0): LeafNode => {
    const rest = tabs.filter((_, i) => i !== shown);
    return { kind: "leaf", id, view: tabs[shown], ...(rest.length ? { stack: rest, stackAt: shown } : {}) };
  };
  const split = (...children: [LayoutNode, LayoutNode]): LayoutNode => ({
    kind: "split",
    id: `s-${children.map((c) => c.id).join("-")}`,
    direction: "horizontal",
    sizes: [50, 50],
    children,
  });
  const folder = leaf("folder", [{ role: "root-folder" }]);
  /** folder | stack (A B C, `shown` showing) | lone D | empty frame */
  const frame = (shown: number) =>
    split(
      folder,
      split(split(leaf("stack", [{ url: A }, { url: B }, { url: C }], shown), leaf("lone", [{ url: D }])), leaf("empty", [{}])),
    );

  const close: TabCommand = { kind: "close" };
  const next: TabCommand = { kind: "step", by: 1 };
  const prev: TabCommand = { kind: "step", by: -1 };
  const go = (to: number): TabCommand => ({ kind: "go", to });
  const show = (leafId: string, index: number): TabAction => ({ op: "showTab", leafId, index });

  const cases: {
    name: string;
    layout: LayoutNode | null;
    focused: string | null;
    selected?: string | null;
    command: TabCommand;
    want: TabAction | null;
  }[] = [
    // Close.
    { name: "close in a stack: the tab showing", layout: frame(1), focused: "stack", command: close, want: { op: "closeTab", leafId: "stack", index: 1 } },
    { name: "close a lone document: its panel", layout: frame(1), focused: "lone", command: close, want: { op: "closePanel", leafId: "lone" } },
    { name: "close an empty frame: the frame", layout: frame(1), focused: "empty", command: close, want: { op: "closePanel", leafId: "empty" } },
    { name: "close the frame's only panel: nothing", layout: leaf("only", [{ url: A }]), focused: "only", command: close, want: null },
    { name: "close in the only panel's stack: the tab", layout: leaf("only", [{ url: A }, { url: B }], 1), focused: "only", command: close, want: { op: "closeTab", leafId: "only", index: 1 } },
    // Which panel.
    { name: "focus in the folder: the selected panel", layout: frame(1), focused: "folder", selected: "stack", command: close, want: { op: "closeTab", leafId: "stack", index: 1 } },
    { name: "focus in the folder, nothing selected: nothing", layout: frame(1), focused: "folder", selected: null, command: close, want: null },
    { name: "no focus: the selected panel", layout: frame(1), focused: null, selected: "lone", command: close, want: { op: "closePanel", leafId: "lone" } },
    { name: "focus on a panel since closed: the selected one", layout: frame(1), focused: "gone", selected: "stack", command: next, want: show("stack", 2) },
    { name: "the focused panel over the selected one", layout: frame(1), focused: "lone", selected: "stack", command: close, want: { op: "closePanel", leafId: "lone" } },
    { name: "no layout: nothing", layout: null, focused: "stack", command: close, want: null },
    // Step.
    { name: "next", layout: frame(1), focused: "stack", command: next, want: show("stack", 2) },
    { name: "previous", layout: frame(1), focused: "stack", command: prev, want: show("stack", 0) },
    { name: "next from the last wraps to the first", layout: frame(2), focused: "stack", command: next, want: show("stack", 0) },
    { name: "previous from the first wraps to the last", layout: frame(0), focused: "stack", command: prev, want: show("stack", 2) },
    { name: "next with one tab: nothing", layout: frame(1), focused: "lone", command: next, want: null },
    { name: "next in an empty frame: nothing", layout: frame(1), focused: "empty", command: next, want: null },
    // Go.
    { name: "tab 1", layout: frame(1), focused: "stack", command: go(0), want: show("stack", 0) },
    { name: "tab 3", layout: frame(1), focused: "stack", command: go(2), want: show("stack", 2) },
    { name: "the tab already showing: nothing", layout: frame(1), focused: "stack", command: go(1), want: null },
    { name: "a tab past the end: nothing", layout: frame(1), focused: "stack", command: go(3), want: null },
    { name: "the last", layout: frame(0), focused: "stack", command: go(-1), want: show("stack", 2) },
    { name: "the last, already showing: nothing", layout: frame(2), focused: "stack", command: go(-1), want: null },
    { name: "tab 1 of one: nothing", layout: frame(1), focused: "lone", command: go(0), want: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(tabActionFor(c.layout, c.focused, c.selected ?? null, c.command)).toEqual(c.want);
    });
  }
});
