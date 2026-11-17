// The pointer (TOOLS.md §4). Pure: the router holds the state and asks the
// browser for what this says.
//
// The top body asks for pointer lock (`lock`); the view grants it while
// nothing else wants the pointer (`wanted`: a held tool that says
// `pointer: true`, a selection, an open menu, dialog or drawer). The
// browser's Escape releases it unseen by the page (`released`): the next
// press on the world only relocks, and is nothing else. A lock the browser
// refuses (`refused`) leaves the body looking by drag, until the body
// changes. While the input is touch (`touch`: the last press on the view was
// a finger) there is no mouse to look with: the body looks by drag, as when
// refused, and nothing is released (there is no lock to take back). A mouse
// after a finger finds the lock released, as after the browser's Escape:
// wherever it pressed, the next press on the world only takes the lock back,
// so the lock is only ever taken by a press on the world that is nothing
// else (never by a press on the chip or a button, never mid-click).
//
//   locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch

/** Should the pointer be locked now? */
export const lockedNow = ({ lock = false, wanted = false, released = false, refused = false, touch = false } = {}) =>
  !!lock && !wanted && !released && !refused && !touch;

/**
 * Does the look go along the eye's ray (the middle of the view), not under
 * the pointer? Under lock; and for a lock body under touch, where a finger
 * never locks and never hovers (it only presses and drags, to look), so the
 * body looks where its eye does, as it would locked:
 *
 *   eye ⇔ locked ∨ (body.lock ∧ ¬wanted ∧ touch)
 * @param {{ locked?: boolean, lock?: boolean, wanted?: boolean, touch?: boolean } | null | undefined} p  the view's `pointer`
 */
export const looksFromEye = (p) => !!p?.locked || (!!p?.lock && !p?.wanted && !!p?.touch);

/**
 * One event on the pointer state, and what the router does about it.
 * Events: { type: "press" } (on the world), { type: "key" },
 * { type: "release" } (the browser let go: its Escape, the window losing
 * focus), { type: "refuse" } (a request was refused), { type: "body",
 * lock } (the top body changed), { type: "want", wanted }, { type: "input",
 * touch } (a press anywhere on the view, by a finger or not; it comes before
 * that press's own `press`).
 * @param {{ lock: boolean, wanted: boolean, released: boolean, refused: boolean, touch: boolean }} s
 * @param {object} ev
 * @returns {{ state: object, consumed: boolean }}  consumed: the press only relocked
 */
export function pointerStep(s, ev) {
  switch (ev?.type) {
    case "press":
      // a press after a release only takes the lock back (when the body
      // still wants it, nothing else wants the pointer and it isn't a finger)
      if (s.released && lockedNow({ ...s, released: false })) return { state: { ...s, released: false }, consumed: true };
      return { state: s, consumed: false };
    case "release":
      return { state: lockedNow(s) ? { ...s, released: true } : s, consumed: false };
    case "refuse":
      return { state: s.lock ? { ...s, refused: true } : s, consumed: false };
    case "body":
      // a new body starts afresh: nothing released or refused yet
      return { state: { ...s, lock: !!ev.lock, released: false, refused: false }, consumed: false };
    case "want":
      return { state: { ...s, wanted: !!ev.wanted }, consumed: false };
    case "input": {
      const touch = !!ev.touch;
      if (touch === !!s.touch) return { state: s, consumed: false };
      // a finger: no lock, and none to take back
      if (touch) return { state: { ...s, touch, released: false }, consumed: false };
      // a mouse after a finger: the lock it would take waits for a press on the world
      return { state: { ...s, touch, released: !!s.released || lockedNow({ ...s, touch }) }, consumed: false };
    }
    default:
      return { state: s, consumed: false };
  }
}
