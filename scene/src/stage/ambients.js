// A world's ambients (STAGE.md, "Views, stages and links", STAGE.md "Ambients"): the named
// values a world has once, however many things it holds (its atmosphere, its
// water). Each running extension may offer some (`instance.ambient()`); a
// stage stacks its extensions' offers per name in running order; and the
// view's are its outermost stage's alone, which every stage reads with
// `api.ambient(name)` and its own code.
//
// Only data crosses, by construction: an offer is copied here into frozen
// plain JSON, so what a reader gets can't call back into the provider, can't
// change under it, and outlives the provider's stage unchanged. A value that
// isn't plain JSON (a function, a cycle, a handle, a Map, a non-finite
// number) is refused whole. The stage never reads inside a value.
//
// Pure.

const PLAIN = new Set([Object.prototype, null]);

/**
 * A frozen plain-JSON copy of `v`: objects whose prototype is Object's (or
 * null), arrays, strings, finite numbers, booleans and null. A property
 * whose value is undefined is left out, and an array element that is
 * undefined (or a hole) is null, as JSON writes them. Throws a TypeError
 * naming the path for anything else.
 * @param {any} v  @param {string} [at]
 */
export function frozenJSON(v, at = "", seen = new Set()) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError(`${at || "value"} is ${v}, not a finite number`);
    return v;
  }
  if (typeof v !== "object") throw new TypeError(`${at || "value"} is a ${typeof v}, not plain JSON`);
  if (seen.has(v)) throw new TypeError(`${at || "value"} refers back to itself`);
  seen.add(v);
  let out;
  if (Array.isArray(v)) {
    out = [];
    // a hole or an undefined element is null, as JSON writes it
    for (let i = 0; i < v.length; i++) out.push(v[i] === undefined ? null : frozenJSON(v[i], `${at}[${i}]`, seen));
  } else {
    if (!PLAIN.has(Object.getPrototypeOf(v))) throw new TypeError(`${at || "value"} is a ${v.constructor?.name ?? "non-plain object"}, not plain JSON`);
    out = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x !== undefined) out[k] = frozenJSON(x, at ? `${at}.${k}` : k, seen);
    }
  }
  seen.delete(v);
  return Object.freeze(out);
}

/**
 * The ambients a stage offers: each extension's `ambient()` answer, stacked
 * in running order per name, a later value winning whole and `null` clearing
 * an earlier one (mergeLooks' and the old atmosphere's rule, one level up).
 * An offer that isn't plain JSON is refused and reported through
 * `refuse(id, name, error)`, and stacks as null: it clears what came before
 * it under that name, so a broken override leaves no value rather than
 * quietly falling back to someone else's (never the wrong value). A value equal (as JSON) to the one in `prev`
 * under the same name is `prev`'s, so a reader comparing identities sees a
 * change only when there is one.
 * @param {Iterable<{ id: string, offer: object | null }>} offers
 * @param {Readonly<Record<string, any>>} [prev]
 * @param {(id: string, name: string, err: Error) => void} [refuse]
 * @returns {Readonly<Record<string, any>>}  frozen; a name with no value is absent
 */
export function mergeAmbients(offers, prev = EMPTY, refuse = () => {}) {
  const out = {};
  for (const { id, offer } of offers ?? []) {
    if (!offer || typeof offer !== "object") continue;
    for (const name of Object.keys(offer)) {
      const v = offer[name];
      if (v === undefined) continue;
      if (v === null) {
        out[name] = null;
        continue;
      }
      try {
        out[name] = frozenJSON(v, name);
      } catch (err) {
        out[name] = null;
        refuse(id, name, err);
      }
    }
  }
  const names = Object.keys(out).filter((k) => out[k] !== null);
  if (!names.length) return EMPTY;
  const merged = {};
  let same = names.length === Object.keys(prev).length;
  for (const k of names.sort()) {
    const was = prev[k];
    merged[k] = was !== undefined && JSON.stringify(was) === JSON.stringify(out[k]) ? was : out[k];
    if (merged[k] !== was) same = false;
  }
  return same ? prev : Object.freeze(merged);
}

/** No ambients. */
export const EMPTY = Object.freeze({});
