// A key held by a finger (TOOLS.md §5): the touch pad's controls and the
// use prompt's held verbs. It presses what a keyboard presses for a code
// (keydown, then keyup, with the US layout's key: keymap.js keyOfCode) at the
// view's root, where the router hears keys, so it goes the one key order.
//
// Fingers on an element hold its key: down with the first, up with the last
// (its pointerup, its cancel or its capture lost). The pointerdown is
// default-prevented, so focus stays where it is (the key map cancels held
// verbs when focus leaves the view), and the pointer is captured, so a finger
// that slides off still holds until it lifts. letGo() lets every finger go at
// once (its key up) and leaves the element: a finger still on it presses
// nothing until it comes down again, as after a keyboard's blur.

import { keyOfCode } from "./keymap.js";

/**
 * Press `code` at `root`: its keydown now.
 * @param {EventTarget} root  @param {string} code
 * @returns {() => void} its keyup (once; again is nothing)
 */
export function pressKey(root, code) {
  const init = { code, key: keyOfCode(code), bubbles: true, cancelable: true };
  root.dispatchEvent(new KeyboardEvent("keydown", init));
  let up = false;
  return () => {
    if (up) return;
    up = true;
    root.dispatchEvent(new KeyboardEvent("keyup", init));
  };
}

/**
 * Fingers on `el` hold `code` at `root`.
 * @param {HTMLElement} el  @param {EventTarget} root  @param {string} code
 * @param {(held: boolean) => void} [onHeld]  told when the key goes down and comes up
 * @returns {{ letGo(): void }}
 */
export function holdKey(el, root, code, onHeld = () => {}) {
  const fingers = new Set(); // pointerIds
  let release = null;
  const up = () => {
    if (!release) return;
    const r = release;
    release = null;
    r();
    onHeld(false);
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer can't be captured
    }
    if (fingers.has(e.pointerId)) return;
    fingers.add(e.pointerId);
    if (fingers.size > 1) return;
    release = pressKey(root, code);
    onHeld(true);
  });
  const off = (e) => {
    if (!fingers.delete(e.pointerId) || fingers.size) return;
    up();
  };
  el.addEventListener("pointerup", off);
  el.addEventListener("pointercancel", off);
  el.addEventListener("lostpointercapture", off);
  return {
    letGo() {
      fingers.clear();
      up();
    },
  };
}
