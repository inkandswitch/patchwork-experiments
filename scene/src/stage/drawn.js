// A stage's api built from what it allows (STAGE.md, "Views, stages and
// links": a drawn stage's extensions run and draw, nothing more). The stage
// gives two pieces: what every stage's extension has (reads, drawing, time,
// its doc's writes, which I6 refuses where it may not write), and what only
// an acting stage's has. A drawn stage's api carries each acting member's
// inert form, from INERT, in its place. An acting member with no inert form
// can't be built into a drawn stage: apiOf throws, naming it, so a new acting
// member is inert in a drawn stage only once someone says how.

const noop = () => {};
const detached = (className) => Object.assign(document.createElement("div"), { className });

/**
 * Each acting member's inert form: a noop, an element kept out of the DOM, or
 * the answer the acting member gives when it can't.
 */
export const INERT = Object.freeze({
  view: Object.freeze({ select: noop }),
  overlay: (side) => detached(side ? "stage-edge-part" : "stage-overlay"),
  popover: () => noop,
  listen: () => noop,
  camera: Object.freeze({ set: noop, frame: noop, hold: () => noop, ride: () => noop }),
  body: Object.freeze({ enter: () => false, leave: () => false }),
  hold: () => noop,
  run: () => false,
});

const isPlain = (v) => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** `acting`'s shape with `inert`'s forms; throws for a member that has none. */
export function inertOf(acting, inert = INERT, at = "api") {
  const out = {};
  for (const k of Object.keys(acting)) {
    const form = inert?.[k];
    if (form === undefined) throw new Error(`${at}.${k} acts, and has no inert form for a drawn stage (stage/drawn.js INERT)`);
    out[k] = isPlain(Object.getOwnPropertyDescriptor(acting, k).value) ? inertOf(acting[k], form, `${at}.${k}`) : form;
  }
  return out;
}

/** `a` and `b` merged (b's member winning, two plain objects merged member by member), by descriptor so getters stay getters; each nested object frozen. */
function merge(a, b) {
  const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(a));
  for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(b))) {
    const was = Object.getOwnPropertyDescriptor(out, k)?.value;
    if (isPlain(was) && isPlain(d.value)) Object.defineProperty(out, k, { ...d, value: merge(was, d.value) });
    else Object.defineProperty(out, k, d);
  }
  for (const k of Object.keys(out)) {
    const v = Object.getOwnPropertyDescriptor(out, k).value;
    if (isPlain(v)) Object.freeze(v);
  }
  return out;
}

/**
 * A stage's api: `drawn`, what every stage's extension has, with `acting`
 * where the stage acts and its inert forms where it is drawn (frozen whole).
 * @param {object} drawn  @param {object} acting  @param {boolean} acts
 */
export function apiOf(drawn, acting, acts, inert = INERT) {
  return acts ? merge(drawn, acting) : Object.freeze(merge(drawn, inertOf(acting, inert)));
}
