// The unload guard asks before the page goes unless the page sent it. Every
// gesture that can come just before an unload is listed with whether the
// browser should ask, and each is checked at once and after the moment has
// passed (when it must always ask).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELIBERATE_UNLOAD_MS, installUnloadGuard } from "./unloadGuard";

let clock = 0;
let uninstall: () => void;

beforeEach(() => {
  clock = 10_000;
  document.body.innerHTML = `
    <button id="reload">Reload</button>
    <a id="out" href="https://example.com/">out</a>
    <a id="nohref">no href</a>
    <div id="fake" role="button"><span id="inner">fake button</span></div>
    <div id="doc" contenteditable>text</div>`;
  uninstall = installUnloadGuard(window, () => clock);
});
afterEach(() => uninstall());

/** Whether the browser would ask: the unload was cancelled. */
const asks = (): boolean => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const key = (init: KeyboardEventInit) => () =>
  document.getElementById("doc")!.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, composed: true, ...init }),
  );
const click = (id: string) => () =>
  document.getElementById(id)!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );

const gestures: { name: string; act: () => void; asks: boolean }[] = [
  { name: "nothing (the browser closed the tab)", act: () => {}, asks: true },
  { name: "⌘R", act: key({ key: "r", metaKey: true }), asks: false },
  { name: "Ctrl-R", act: key({ key: "r", ctrlKey: true }), asks: false },
  { name: "⇧⌘R", act: key({ key: "R", metaKey: true, shiftKey: true }), asks: false },
  { name: "F5", act: key({ key: "F5" }), asks: false },
  { name: "⌘W seen as a key", act: key({ key: "w", metaKey: true }), asks: true },
  { name: "Ctrl-W seen as a key", act: key({ key: "w", ctrlKey: true }), asks: true },
  { name: "typing r", act: key({ key: "r" }), asks: true },
  { name: "⌥⌘R", act: key({ key: "r", metaKey: true, altKey: true }), asks: true },
  { name: "a click on a button", act: click("reload"), asks: false },
  { name: "a click on a link", act: click("out"), asks: false },
  { name: "a click inside a role=button", act: click("inner"), asks: false },
  { name: "a click on an anchor with no href", act: click("nohref"), asks: true },
  { name: "a click in a document", act: click("doc"), asks: true },
];

describe("asking before the page unloads", () => {
  for (const g of gestures) {
    it(`${g.name}: ${g.asks ? "asks" : "doesn't ask"}`, () => {
      g.act();
      clock += DELIBERATE_UNLOAD_MS - 1;
      expect(asks()).toBe(g.asks);
    });

    it(`${g.name}, a moment later: asks`, () => {
      g.act();
      clock += DELIBERATE_UNLOAD_MS;
      expect(asks()).toBe(true);
    });
  }

  it("asks for nothing once uninstalled", () => {
    uninstall();
    expect(asks()).toBe(false);
    uninstall = () => {};
  });
});
