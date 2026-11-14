// What a stage holds of its doc, and of every doc it reaches (COMPOSITION.md
// §7, invariant I6). A stage is read-only when its handle is, or when it
// doesn't act: a pin (a value: its doc at fixed heads) or a mirror (a live
// doc acting at another placement in the same view). A read-only stage is
// given its doc and its repo through these wrappers, so nothing it runs can
// write any doc, whatever it calls: the refusal is the handle's, not each
// caller's. The stage checks `writable()` before it writes, so it never
// reaches a refusal; one that does throws, as automerge-repo's handle at
// fixed heads does, and the I6 harness (readonly-stage.test.js) counts that
// as a failure.
//
// A stage's repo also notes every doc it finds (`reached`): the docs a doc's
// extensions read through it (render docs, files, a keeper's container).
// Fixing a link at a version holds the heads of every doc reached through it
// (`fixPoint`), so a pin is whole.

import { pinnedRepo } from "../build.js";

/** What a read-only handle refuses: every write and every send automerge-repo's DocHandle has. */
export const REFUSED = Object.freeze(["change", "changeAt", "update", "merge", "begin", "delete", "remove", "broadcast"]);

const refusal = (url, what) => () => {
  throw new Error(`Cannot ${what} ${url ?? "a document"}: it is read-only here.`);
};

const READ_ONLY = Symbol("read-only");

/** Is this a handle (it can be changed)? */
const isHandle = (v) => !!v && typeof v === "object" && typeof v.change === "function" && typeof v.doc === "function";

/** A handle as given to a read-only stage: reads as `handle` does, refuses every write and send, and says it is read-only. */
export function readOnlyHandle(handle) {
  if (!isHandle(handle)) return handle;
  if (handle[READ_ONLY]) return handle;
  return new Proxy(handle, {
    get(target, prop) {
      if (prop === READ_ONLY) return true;
      if (prop === "isReadOnly") return () => true;
      if (REFUSED.includes(prop)) return refusal(target.url, String(prop));
      const v = Reflect.get(target, prop, target);
      if (typeof v !== "function") return v;
      // a handle it gives out (a view at other heads, a sub-handle) is read-only too
      return (...args) => {
        const out = v.apply(target, args);
        return isHandle(out) ? readOnlyHandle(out) : out;
      };
    },
  });
}
/** Is this handle one a read-only stage was given? */
export const isReadOnlyHandle = (h) => !!h?.[READ_ONLY];

/** Does this handle refuse writes (its own say, or this module's wrapper)? */
export const handleReadOnly = (h) => isReadOnlyHandle(h) || (typeof h?.isReadOnly === "function" && !!h.isReadOnly());

/**
 * The repo a stage gives its extensions and its content: `find` notes each
 * doc found in `reached` (url → handle); with `deps` ({ url: heads }, a pin's)
 * a listed doc is found at those heads (build.js pinnedRepo: an unlisted one is
 * found as it is now); read-only, every handle it gives out refuses writes and
 * it makes no docs.
 * @param {object} repo
 * @param {{ readOnly?: boolean, deps?: object | null, reached?: Map<string, object> }} o
 */
export function stageRepo(repo, { readOnly = false, deps = null, reached = null } = {}) {
  if (!repo) return repo;
  const base = deps ? pinnedRepo(repo, deps) : repo;
  async function find(url, ...rest) {
    const h = await base.find(url, ...rest);
    if (reached && typeof url === "string" && isHandle(h)) reached.set(url, h);
    return readOnly ? readOnlyHandle(h) : h;
  }
  const refuse = (what) => () => Promise.reject(new Error(`Cannot ${what}: this stage is read-only.`));
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "find") return find;
      if (readOnly && (prop === "create" || prop === "create2" || prop === "import" || prop === "clone" || prop === "delete")) return refuse(`${String(prop)} a document`);
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
