// The frame's shortcuts, written down once: the shortcuts sheet (? or the
// top bar's keyboard button) lists them, and the buttons that do the same
// things name their keys in their tooltips. Each key is the one its matcher
// reads (`tabKeys.ts`, `quickOpenItems.ts`, the frame's click rule), and the
// tests press every key listed here through those matchers, so the sheet
// can't say a key the frame doesn't answer to.
//
// Spelling follows the platform: ⌃⌥⇧⌘ run together in Apple's order on a
// Mac ("⌃⇧]"), Ctrl+Alt+Shift+ elsewhere ("Ctrl+Shift+]").

import { isMac } from "./quickOpenItems";

export type Mod = "ctrl" | "alt" | "shift" | "meta";

/** One key (or click) with its modifiers. */
export type Chord = {
  mods: Mod[];
  /** The physical key (`KeyboardEvent.code`); none for a click. */
  code?: string;
  /** The key cap as shown: "W", "]", "1–8", "click". */
  cap: string;
};

export type ShortcutId =
  | "quick-open"
  | "shortcuts"
  | "close-tab"
  | "next-tab"
  | "previous-tab"
  | "tab-number"
  | "last-tab"
  | "back"
  | "forward"
  | "open-choice"
  | "open-choice-keep"
  | "open-choice-beside"
  | "open-choice-below"
  | "click-keep"
  | "click-beside"
  | "click-below"
  | "middle-click-close";

export type Shortcut = { id: ShortcutId; label: string; mac: Chord; other: Chord };

export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

const both = (id: ShortcutId, label: string, chord: Chord): Shortcut => ({
  id,
  label,
  mac: chord,
  other: chord,
});

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Finding",
    shortcuts: [
      {
        id: "quick-open",
        label: "Quick Open: a document by name",
        mac: { mods: ["meta"], code: "KeyP", cap: "P" },
        other: { mods: ["ctrl"], code: "KeyP", cap: "P" },
      },
      both("shortcuts", "Show these shortcuts", { mods: ["shift"], code: "Slash", cap: "?" }),
    ],
  },
  {
    title: "Tabs",
    shortcuts: [
      both("close-tab", "Close the tab (at a panel's last, the panel)", {
        mods: ["alt"],
        code: "KeyW",
        cap: "W",
      }),
      both("next-tab", "Next tab", { mods: ["ctrl", "shift"], code: "BracketRight", cap: "]" }),
      both("previous-tab", "Previous tab", { mods: ["ctrl", "shift"], code: "BracketLeft", cap: "[" }),
      {
        id: "tab-number",
        label: "Tab 1 to 8",
        mac: { mods: ["ctrl"], code: "Digit1", cap: "1–8" },
        other: { mods: ["alt"], code: "Digit1", cap: "1–8" },
      },
      {
        id: "last-tab",
        label: "The last tab",
        mac: { mods: ["ctrl"], code: "Digit9", cap: "9" },
        other: { mods: ["alt"], code: "Digit9", cap: "9" },
      },
      both("middle-click-close", "Close a tab", { mods: [], cap: "Middle-click" }),
    ],
  },
  {
    title: "Back and Forward (the browser's)",
    shortcuts: [
      {
        id: "back",
        label: "Back to the document opened before",
        mac: { mods: ["meta"], code: "BracketLeft", cap: "[" },
        other: { mods: ["alt"], code: "ArrowLeft", cap: "←" },
      },
      {
        id: "forward",
        label: "Forward again",
        mac: { mods: ["meta"], code: "BracketRight", cap: "]" },
        other: { mods: ["alt"], code: "ArrowRight", cap: "→" },
      },
    ],
  },
  {
    title: "Opening from the folder or a link",
    shortcuts: [
      both("click-keep", "Open, keeping the tab it would replace", { mods: ["shift"], cap: "click" }),
      both("click-beside", "Open beside", { mods: ["alt"], cap: "click" }),
      both("click-below", "Open below", { mods: ["alt", "shift"], cap: "click" }),
    ],
  },
  {
    title: "In Quick Open",
    shortcuts: [
      both("open-choice", "Open the choice", { mods: [], code: "Enter", cap: "Enter" }),
      both("open-choice-keep", "…keeping the tab it would replace", {
        mods: ["shift"],
        code: "Enter",
        cap: "Enter",
      }),
      both("open-choice-beside", "…beside", { mods: ["alt"], code: "Enter", cap: "Enter" }),
      both("open-choice-below", "…below", { mods: ["alt", "shift"], code: "Enter", cap: "Enter" }),
    ],
  },
];

const BY_ID = new Map(
  SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).map((s) => [s.id, s] as const),
);

const MAC_ORDER: Mod[] = ["ctrl", "alt", "shift", "meta"];
const MAC_GLYPH: Record<Mod, string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
const OTHER_ORDER: Mod[] = ["ctrl", "alt", "shift", "meta"];
const OTHER_NAME: Record<Mod, string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" };

/** A chord as it's written on this platform. "?" is just "?", Shift and all. */
export const spell = (chord: Chord, mac = isMac()): string => {
  const mods = chord.cap === "?" ? chord.mods.filter((m) => m !== "shift") : chord.mods;
  const isClick = !chord.code;
  if (mac) {
    const glyphs = MAC_ORDER.filter((m) => mods.includes(m)).map((m) => MAC_GLYPH[m]).join("");
    const cap = chord.cap === "Enter" ? "↩" : chord.cap;
    return isClick && glyphs ? `${glyphs}-${cap}` : `${glyphs}${cap}`;
  }
  return [...OTHER_ORDER.filter((m) => mods.includes(m)).map((m) => OTHER_NAME[m]), chord.cap].join("+");
};

/** A shortcut's key as written on this platform. */
export const keyFor = (id: ShortcutId, mac = isMac()): string => {
  const shortcut = BY_ID.get(id)!;
  return spell(mac ? shortcut.mac : shortcut.other, mac);
};

/** A tooltip naming its key: "Close tab (⌥W)". */
export const withKey = (label: string, id: ShortcutId, mac = isMac()): string =>
  `${label} (${keyFor(id, mac)})`;

/** The key for tab `index` (from 0) of `count`: 1–8 by number, the last by 9. */
export const tabNumberKey = (index: number, count: number, mac = isMac()): string | null => {
  const digit = index < 8 ? index + 1 : index === count - 1 ? 9 : null;
  if (digit === null) return null;
  const chord = BY_ID.get("tab-number")![mac ? "mac" : "other"];
  return spell({ ...chord, code: `Digit${digit}`, cap: String(digit) }, mac);
};

const isEditable = (node: EventTarget | undefined): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable || node.closest('[contenteditable]:not([contenteditable="false"])'))
    return true;
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  if (!(node instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(
    node.type,
  );
};

/**
 * ? opens the shortcuts sheet, but only where it isn't typing: not in a text
 * field or editable text, looked for inside shadow roots too.
 */
export const isShortcutsKey = (event: KeyboardEvent): boolean =>
  event.key === "?" &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !isEditable(event.composedPath()[0]);
