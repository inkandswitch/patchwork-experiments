// Keys for a panel's tabs. The browser keeps the ones you'd reach for first —
// ⌘W / Ctrl-W, Ctrl-Tab, ⌘⇧[ ] and ⌘⌥←/→ (Chrome reserves close-tab and
// next/previous-tab outright) — and ⌘1–9 / Ctrl-1–9 pick browser tabs. So
// these are the stand-ins editors that live in a browser already use:
//
//  - close the tab:          ⌥W / Alt+W            (JupyterLab)
//  - next / previous tab:    Ctrl+Shift+] / [      (JupyterLab; Ctrl on a Mac too)
//  - tab 1–8, 9 the last:    ⌃1–9 on a Mac, Alt+1–9 elsewhere (VS Code)
//
// They're read by physical key (`code`), since ⌥ on a Mac changes the
// character (⌥W is "∑"). Back and Forward need nothing: the browser's own
// (⌘[ ⌘], Alt+←/→) walk your opens (see the history entries in the frame).
// None of these, pressed in a document, counts as engaging with it.

import { findLeaf, isContentLeaf, leafTabs } from "./layout";
import { isMac, isQuickOpenKey } from "./quickOpenItems";
import { isShortcutsKey } from "./shortcuts";
import type { LayoutNode } from "./types";

export type TabCommand =
  | { kind: "close" }
  | { kind: "step"; by: 1 | -1 }
  /** Show tab `to` (from 0); -1 is the last. */
  | { kind: "go"; to: number };

/** The tab command a key press is, if any. */
export const tabCommandFor = (event: KeyboardEvent, mac = isMac()): TabCommand | null => {
  const { altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, code } = event;
  if (meta) return null;
  if (alt && !ctrl && !shift && code === "KeyW") return { kind: "close" };
  if (ctrl && shift && !alt && (code === "BracketRight" || code === "BracketLeft")) {
    return { kind: "step", by: code === "BracketRight" ? 1 : -1 };
  }
  const digit = /^Digit([1-9])$/.exec(code)?.[1];
  if (digit && !shift && (mac ? ctrl && !alt : alt && !ctrl)) {
    return { kind: "go", to: digit === "9" ? -1 : Number(digit) - 1 };
  }
  return null;
};

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"]);

/** The browser's Back and Forward keys: ⌘[ ⌘] on a Mac, Alt+←/→ elsewhere. */
const isHistoryKey = (event: KeyboardEvent, mac: boolean): boolean => {
  const { altKey: alt, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, code } = event;
  if (shift || ctrl) return false;
  return mac
    ? meta && !alt && (code === "BracketLeft" || code === "BracketRight")
    : alt && !meta && (code === "ArrowLeft" || code === "ArrowRight");
};

/**
 * Whether a key pressed in a document only moves you around — a tab key,
 * Quick Open's, ? for the shortcuts, Back or Forward, or a modifier on its
 * own (held for a ⌘-click) — rather than working in it. Those aren't
 * engagement: stepping past a preview mustn't keep it.
 */
export const isGetAroundKey = (event: KeyboardEvent, mac = isMac()): boolean =>
  MODIFIERS.has(event.key) ||
  tabCommandFor(event, mac) !== null ||
  isQuickOpenKey(event, mac) ||
  isShortcutsKey(event) ||
  isHistoryKey(event, mac);

export type TabAction =
  | { op: "closeTab"; leafId: string; index: number }
  /** A panel's last tab goes with its panel, as the panel's × does. */
  | { op: "closePanel"; leafId: string }
  | { op: "showTab"; leafId: string; index: number };

/**
 * What a tab command does: to the focused panel if it's a document panel,
 * else to the one showing the selected document (so a click in the folder
 * doesn't leave the keys with nothing to act on). Null when there's nothing
 * to do: no such panel, one tab to step through, a tab number past the end,
 * the tab already showing, or the frame's only panel to close.
 */
export const tabActionFor = (
  layout: LayoutNode | null,
  focusedLeafId: string | null,
  selectedLeafId: string | null,
  command: TabCommand,
): TabAction | null => {
  if (!layout) return null;
  const focused = focusedLeafId ? findLeaf(layout, focusedLeafId) : null;
  const leaf = isContentLeaf(focused)
    ? focused
    : selectedLeafId
      ? findLeaf(layout, selectedLeafId)
      : null;
  if (!leaf || !isContentLeaf(leaf)) return null;
  const { tabs, active } = leafTabs(leaf);
  const n = tabs.length;
  switch (command.kind) {
    case "close":
      if (n > 1) return { op: "closeTab", leafId: leaf.id, index: active };
      return layout.kind === "split" ? { op: "closePanel", leafId: leaf.id } : null;
    case "step":
      if (n < 2) return null;
      return { op: "showTab", leafId: leaf.id, index: (active + command.by + n) % n };
    case "go": {
      const index = command.to < 0 ? n - 1 : command.to;
      if (index >= n || index === active) return null;
      return { op: "showTab", leafId: leaf.id, index };
    }
  }
};
