// An event of the router's (STAGE.md, "The input chain"; router.js buildEvent)
// as one listener hears it: in a stage's frame (stage.js), or with the path of
// its hit (a view plugin's hand, view.js). Pure.

/** Is this one of the router's events? */
export const isEvent = (a) => !!a && typeof a === "object" && typeof a.type === "string" && "locked" in a;

/** `obj` (an input or a session) whose every method hears each event among its arguments as `as(ev)`. */
export const mapEvents = (obj, as) =>
  new Proxy(obj, {
    get(target, k) {
      const v = Reflect.get(target, k, target);
      return typeof v === "function" ? (...args) => v.apply(target, args.map((a) => (isEvent(a) ? as(a) : a))) : v;
    },
  });

/** A copy of `ev` with each of `fields` ({ name: () => value }) worked out when first read, once. */
export function lazyCopy(ev, fields) {
  const memo = {};
  const lazy = (k, fn) => ({ enumerable: true, configurable: true, get: () => (k in memo ? memo[k] : (memo[k] = fn())) });
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(ev), ...Object.fromEntries(Object.entries(fields).map(([k, fn]) => [k, lazy(k, fn)])) });
}
