// The shortcut table against the frame: every key the sheet lists, pressed
// on a Mac and elsewhere, is answered by the matcher for what the sheet says
// it does, and is written as that platform writes it. Then the tooltip keys,
// and where ? opens the sheet.

import { describe, expect, it } from "vitest";
import { isQuickOpenKey, placementFor } from "./quickOpenItems";
import {
  isShortcutsKey,
  keyFor,
  SHORTCUT_GROUPS,
  tabNumberKey,
  withKey,
  type Chord,
  type ShortcutId,
} from "./shortcuts";
import { isGetAroundKey, tabCommandFor, type TabCommand } from "./tabKeys";

const event = (chord: Chord, key: string): KeyboardEvent =>
  new KeyboardEvent("keydown", {
    code: chord.code,
    key,
    ctrlKey: chord.mods.includes("ctrl"),
    altKey: chord.mods.includes("alt"),
    shiftKey: chord.mods.includes("shift"),
    metaKey: chord.mods.includes("meta"),
  });

/** The `key` a press of a listed chord reports (what the matchers don't read). */
const keyOf = (id: ShortcutId, chord: Chord): string =>
  id === "shortcuts" ? "?" : id.startsWith("open-choice") ? "Enter" : chord.cap.slice(0, 1).toLowerCase();

const tab = (command: TabCommand) => (e: KeyboardEvent, mac: boolean) =>
  expect(tabCommandFor(e, mac)).toEqual(command);
const placement = (want: ReturnType<typeof placementFor>) => (e: KeyboardEvent | MouseEvent) =>
  expect(placementFor(e)).toBe(want);

/** What each listed shortcut must do, checked on the press it lists. */
const answers: Record<ShortcutId, (e: KeyboardEvent, mac: boolean) => void> = {
  "quick-open": (e, mac) => expect(isQuickOpenKey(e, mac)).toBe(true),
  shortcuts: (e) => expect(isShortcutsKey(e)).toBe(true),
  "close-tab": tab({ kind: "close" }),
  "next-tab": tab({ kind: "step", by: 1 }),
  "previous-tab": tab({ kind: "step", by: -1 }),
  "tab-number": tab({ kind: "go", to: 0 }),
  "last-tab": tab({ kind: "go", to: -1 }),
  // The browser's: the frame only has to leave them alone (not engagement).
  back: (e, mac) => expect(isGetAroundKey(e, mac)).toBe(true),
  forward: (e, mac) => expect(isGetAroundKey(e, mac)).toBe(true),
  "open-choice": placement(undefined),
  "open-choice-keep": placement("stack"),
  "open-choice-beside": placement("horizontal"),
  "open-choice-below": placement("vertical"),
  "click-keep": placement("stack"),
  "click-beside": placement("horizontal"),
  "click-below": placement("vertical"),
  // A tab's auxclick handler, button 1: nothing to press here.
  "middle-click-close": () => {},
};

/** How each is written: Mac, then elsewhere. */
const spelled: Record<ShortcutId, [string, string]> = {
  "quick-open": ["⌘P", "Ctrl+P"],
  shortcuts: ["?", "?"],
  "close-tab": ["⌥W", "Alt+W"],
  "next-tab": ["⌃⇧]", "Ctrl+Shift+]"],
  "previous-tab": ["⌃⇧[", "Ctrl+Shift+["],
  "tab-number": ["⌃1–8", "Alt+1–8"],
  "last-tab": ["⌃9", "Alt+9"],
  back: ["⌘[", "Alt+←"],
  forward: ["⌘]", "Alt+→"],
  "open-choice": ["↩", "Enter"],
  "open-choice-keep": ["⇧↩", "Shift+Enter"],
  "open-choice-beside": ["⌥↩", "Alt+Enter"],
  "open-choice-below": ["⌥⇧↩", "Alt+Shift+Enter"],
  "click-keep": ["⇧-click", "Shift+click"],
  "click-beside": ["⌥-click", "Alt+click"],
  "click-below": ["⌥⇧-click", "Alt+Shift+click"],
  "middle-click-close": ["Middle-click", "Middle-click"],
};

const all = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

describe("every shortcut the sheet lists", () => {
  it("is listed once", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all.map((s) => s.id).sort()).toEqual(Object.keys(spelled).sort());
  });
  for (const s of all) {
    for (const mac of [true, false]) {
      const chord = mac ? s.mac : s.other;
      it(`${s.id} on ${mac ? "a Mac" : "other platforms"}: ${spelled[s.id][mac ? 0 : 1]}, and the frame answers to it`, () => {
        expect(keyFor(s.id, mac)).toBe(spelled[s.id][mac ? 0 : 1]);
        if (chord.code) {
          answers[s.id](event(chord, keyOf(s.id, chord)), mac);
        } else if (s.id !== "middle-click-close") {
          const click = new MouseEvent("click", {
            altKey: chord.mods.includes("alt"),
            shiftKey: chord.mods.includes("shift"),
          });
          placement(
            { "click-keep": "stack", "click-beside": "horizontal", "click-below": "vertical" }[
              s.id as "click-keep"
            ] as ReturnType<typeof placementFor>,
          )(click);
        }
      });
    }
  }
});

describe("the tooltips' keys", () => {
  it("a label with its key", () => {
    expect(withKey("Close tab", "close-tab", true)).toBe("Close tab (⌥W)");
    expect(withKey("Close tab", "close-tab", false)).toBe("Close tab (Alt+W)");
  });
  it.each([
    [0, 3, "⌃1", "Alt+1"],
    [2, 3, "⌃3", "Alt+3"],
    [7, 12, "⌃8", "Alt+8"],
    [8, 12, null, null], // ninth of twelve: no key reaches it
    [11, 12, "⌃9", "Alt+9"], // the last
    [8, 9, "⌃9", "Alt+9"], // ninth and last
  ])("tab %i of %i: %s, %s", (index, count, mac, other) => {
    expect(tabNumberKey(index, count, true)).toBe(mac);
    expect(tabNumberKey(index, count, false)).toBe(other);
  });
  it("the numbered key is the one that shows that tab", () => {
    for (const [index, count] of [[0, 3], [7, 12], [11, 12]]) {
      for (const mac of [true, false]) {
        const digit = tabNumberKey(index, count, mac)!.slice(-1);
        const e = new KeyboardEvent("keydown", {
          code: `Digit${digit}`,
          key: digit,
          ctrlKey: mac,
          altKey: !mac,
        });
        const command = tabCommandFor(e, mac);
        expect(command?.kind).toBe("go");
        const to = (command as { to: number }).to;
        expect(to < 0 ? count - 1 : to).toBe(index);
      }
    }
  });
});

describe("where ? opens the sheet", () => {
  const press = (target: HTMLElement, init: KeyboardEventInit = {}) => {
    // Asked while the event is on its way, as the frame's listener asks: its
    // path is gone once it has been dispatched.
    let opens: boolean | undefined;
    const listen = (e: Event) => (opens = isShortcutsKey(e as KeyboardEvent));
    window.addEventListener("keydown", listen);
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, composed: true, ...init }));
    window.removeEventListener("keydown", listen);
    return opens;
  };
  const place = (html: string) => {
    document.body.innerHTML = html;
    return document.getElementById("t")!;
  };
  it.each([
    ["the page", "<div id=t></div>", true],
    ["a button", "<button id=t>b</button>", true],
    ["a checkbox", "<input id=t type=checkbox>", true],
    ["a text field", "<input id=t>", false],
    ["a search field", "<input id=t type=search>", false],
    ["a textarea", "<textarea id=t></textarea>", false],
    ["editable text", "<div id=t contenteditable>x</div>", false],
    ["inside editable text", "<div contenteditable><p id=t>x</p></div>", false],
    ["text editing switched off", "<div contenteditable=false><p id=t>x</p></div>", true],
  ])("in %s: %s", (_, html, opens) => {
    expect(press(place(html))).toBe(opens);
  });
  it("a text field inside a shadow root", () => {
    const host = place("<div id=t></div>");
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(input);
    expect(press(input)).toBe(false);
  });
  it("not with ⌘, Ctrl or Alt", () => {
    const target = place("<div id=t></div>");
    expect(press(target, { metaKey: true })).toBe(false);
    expect(press(target, { ctrlKey: true })).toBe(false);
    expect(press(target, { altKey: true })).toBe(false);
  });
});
