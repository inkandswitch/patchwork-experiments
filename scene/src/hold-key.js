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
//
// Only a primary press holds the key (a finger, a pen's tip, a mouse's
// main button): a right or middle press on the element presses nothing, as
// it clicks nothing on a button.
//
// The code can be asked for as each press comes (a function): the use
// prompt's button presses the key that does its verb now, if any. A press
// that finds none isn't the key's: it isn't default-prevented, captured or
// counted, so the element's click is what it does. holds(pointerId) says
// whether a press is the key's (its pointer is one holding it).

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
 * @param {HTMLElement} el  @param {EventTarget} root
 * @param {string | (() => string | null)} code  the code, or asked as the first finger comes down (null: not a key now)
 * @param {(held: boolean) => void} [onHeld]  told when the key goes down and comes up
 * @returns {{ letGo(): void, holds(pointerId: number): boolean }}
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
    if (e.button > 0) return; // not the primary press
    const now = fingers.size ? null : typeof code === "function" ? code() : code;
    if (!fingers.size && !now) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer can't be captured
    }
    if (fingers.has(e.pointerId)) return;
    fingers.add(e.pointerId);
    if (fingers.size > 1) return;
    release = pressKey(root, now);
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
    holds: (pointerId) => fingers.has(pointerId),
  };
}

/**
 * Put `els` in `parent`, in order, moving as few as can be: an element a
 * finger holds has its pointer captured, and taking it out of the document,
 * even to put it back, can lose that (and its key is let go). So a kept
 * element moves only when the order among kept ones changes; one added or
 * gone moves none. (Those gone are removed: let go of them first.)
 * @param {Element} parent  @param {Element[]} els
 */
export function arrange(parent, els) {
  for (const el of [...parent.children]) if (!els.includes(el)) el.remove();
  els.forEach((el, i) => {
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
}
