// The body stack (STAGE.md, "Bodies"): Look at the bottom, always; the body
// on top is the one that lives (it hears every move and its keys; its eye and
// reach are every command's). Entering pushes; a body leaving takes every
// body over it with it (they stood on it). A body is told `suspended` when
// another goes over it and `resumed` when it is on top again.
//
// Pure: the router keeps the value and does what a change says, in its one
// order (router.js `restack`): the value is kept first, then the keys of what
// left or went under are let go, then each is told. A change's `tell` may
// change the stack again before the top settles (a body that enters another
// as it leaves), so the top's turn is its own step, `settleTop`, taken after
// the tells, from the stack as they left it.
//
// The value is { stack, live }: the bodies bottom first, and the one that was
// last told it is on top (or entered on top). Between changes `live` is the
// top; it is what makes the tells exact while a change is under way: a body
// is told `suspended` only while live, `resumed` only when it was not.

/**
 * A body as the stack keeps it: { owner, id, input, lock, keys, serial }; its
 * notices (`left`, `suspended`, `resumed`) are methods of its input.
 * @typedef {{ owner: string | null, id: string, input: object, lock: boolean, keys: { code: string, label?: string }[], serial: number }} Body
 * @typedef {{ stack: Body[], live: Body | null }} Bodies
 * @typedef {{ owner: string | null, to: object, what: string }} Tell  call `to[what]()` on behalf of `owner`
 * @typedef {{ bodies: Bodies, off: Body[], tell: Tell[] }} BodyChange  off: the bodies whose keys are let go
 */

const told = (b, what) => ({ owner: b.owner, to: b.input, what });

/** The stack with only its base. @returns {Bodies} */
export const baseOnly = (base) => ({ stack: [base], live: base });

/** The body on top. */
export const topBody = (s) => s.stack.at(-1);

/** The first body over the base that `owner` put there, or null. */
export const ownedBody = (s, owner) => s.stack.find((b, i) => i > 0 && b.owner === owner) ?? null;

/**
 * Entering `body`: it goes on top, live; the live body under it is
 * suspended (its keys let go first). @returns {BodyChange}
 */
export function withBody(s, body) {
  const stack = [...s.stack, body];
  const under = s.live && s.stack.includes(s.live) ? s.live : null;
  return { bodies: { stack, live: body }, off: under ? [under] : [], tell: under ? [told(under, "suspended")] : [] };
}

/**
 * `body` leaving, and every body over it, top first, each told `left` (its
 * keys let go first); the base never leaves. @returns {BodyChange | null}
 * null when `body` is the base or not on the stack
 */
export function withoutBody(s, body) {
  const i = s.stack.indexOf(body);
  if (i <= 0) return null;
  const gone = s.stack.slice(i).reverse();
  return { bodies: { stack: s.stack.slice(0, i), live: s.live }, off: gone, tell: gone.map((b) => told(b, "left")) };
}

/**
 * The top's turn, once a change's tells are done: when the top isn't the
 * live body, the live one (if it is still on the stack) is suspended and
 * the top resumed, and the top is live. A top that isn't live was told
 * `suspended` when something went over it, so `resumed` always answers one.
 * @returns {BodyChange | null} null when the top is live already
 */
export function settleTop(s) {
  const top = topBody(s);
  if (top === s.live) return null;
  const under = s.live && s.stack.includes(s.live) ? s.live : null;
  return { bodies: { stack: s.stack, live: top }, off: under ? [under] : [], tell: [...(under ? [told(under, "suspended")] : []), told(top, "resumed")] };
}
