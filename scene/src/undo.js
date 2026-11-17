// Undo (HISTORY.md, TOOLS Decisions 2): the editor's own writes only (the
// halo's handles, the inspector, transfer, add, remove), per person and per
// focus doc, as inverse changes. Package verbs, clock acts and process saves
// are never on it, so undo can't un-roll a die, un-shuffle a deck or rewind
// a process. Pure: the editor records and applies (parts/editor.js).
//
// A step is what one edit changed, as leaves: { path, before, after }, one
// per place it wrote, recorded from the change's own patches. A path stops
// at the first list index (a list is one value: a transform's position, the
// doc's `order`), and a leaf under another of the same step is folded into
// it, so no two leaves of a step overlap.
//
// Undoing a step writes every leaf's `before` back, in one change, but only
// when the doc still holds every leaf's `after`: if anything the step wrote
// has been written since (a die rolled after it was moved, a deck shuffled,
// a hull a process sailed on), the step is left as it is, whole, and said.
// So undo reverts only what is still as this edit left it, never anyone's
// later write, and never half an edit (an object back without its place in
// the order). The undo is recorded the same way, and is the redo step; redo
// is undo of that.
//
// One more rule, from what the editor judges a step to have done when it is
// recorded (`judge`, parts/editor.js): kept contents don't come back. A step that
// removed something a keeper holds the contents of (outside the doc) is
// undone as the doc held it, and the undo says what it couldn't put back:
// what is kept comes back as the keeper has it now. Undo never invents state
// it didn't see.

/** A plain copy of a doc value (Automerge's are frozen, and a value can be written into a doc only once). */
export function plain(v) {
  if (v == null || typeof v !== "object") return v;
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v.toJSON === "function" && Object.getPrototypeOf(v) !== Object.prototype) return plain(v.toJSON());
  const out = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = plain(x);
  return out;
}

/** Deep equality of plain values (undefined only equals undefined). */
export function same(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

/** The value at `path` in a doc, as a plain copy; undefined when it (or anything on the way) isn't there. */
export function valueAt(doc, path) {
  let v = doc;
  for (const k of path) {
    if (v == null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return plain(v);
}

/** A patch's path cut at its first list index: the value an edit counts as having written. */
export const leafOf = (path) => {
  const i = path.findIndex((k) => typeof k === "number");
  return i < 0 ? [...path] : path.slice(0, i);
};

const key = (path) => JSON.stringify(path);
/** Is `a` a proper prefix of `b`? */
const under = (a, b) => a.length < b.length && a.every((k, i) => k === b[i]);

/**
 * The leaves one change wrote, from its patches (each { path }): cut at
 * list indices, each once, none under another. Empty paths (the root) are
 * left out: an edit writes into the doc, never replaces it.
 * @param {{ path: (string|number)[] }[]} patches
 * @returns {(string)[][]}
 */
export function leafPaths(patches) {
  const all = new Map();
  for (const p of patches ?? []) {
    if (!Array.isArray(p?.path)) continue;
    const leaf = leafOf(p.path);
    if (leaf.length) all.set(key(leaf), leaf);
  }
  const list = [...all.values()];
  return list.filter((a) => !list.some((b) => under(b, a)));
}

/** Set (or, for undefined, delete) the value at `path` inside a plain value, in place. */
function setIn(target, path, value) {
  let v = target;
  for (const k of path.slice(0, -1)) {
    if (v[k] == null || typeof v[k] !== "object") v[k] = {};
    v = v[k];
  }
  const last = path.at(-1);
  if (value === undefined) delete v[last];
  else v[last] = plain(value);
}

/**
 * Fold one change into a step's leaves: { path, before, after }[]. A leaf
 * already there keeps its first `before` and takes the new `after`; a new
 * leaf over earlier ones takes them in (its `before` is the doc before this
 * change with their earlier befores put back); a new leaf under an earlier
 * one only moves that one's `after`. Leaves whose before and after agree
 * are dropped. Pure (returns a new list).
 * @param {{ path, before, after }[]} leaves
 * @param {{ path }[]} patches  the change's patches
 * @param {object} beforeDoc    the doc before the change
 * @param {object} afterDoc     the doc after it
 */
export function fold(leaves, patches, beforeDoc, afterDoc) {
  let out = leaves.map((l) => ({ ...l }));
  for (const path of leafPaths(patches)) {
    const over = out.find((l) => l.path.length <= path.length && (key(l.path) === key(path) || under(l.path, path)));
    if (over) {
      over.after = valueAt(afterDoc, over.path);
      continue;
    }
    const inside = out.filter((l) => under(path, l.path));
    let before = valueAt(beforeDoc, path);
    if (inside.length) {
      const box = { v: before };
      for (const l of inside) setIn(box, ["v", ...l.path.slice(path.length)], l.before);
      before = box.v;
      out = out.filter((l) => !inside.includes(l));
    }
    out.push({ path, before, after: valueAt(afterDoc, path) });
  }
  return out.filter((l) => !same(l.before, l.after));
}

/**
 * What undoing a step's leaves writes now: every leaf's `before`, when `doc`
 * still holds every leaf's `after` (and each leaf's parent is there: a field
 * of an object since removed has nowhere to go); else nothing, and which
 * leaves were changed since. All or nothing. Pure.
 * @param {{ path, before, after }[]} leaves
 * @param {object} doc  the doc as it is now
 * @returns {{ writes: { path, value }[], changed: string[][] }}
 */
export function inverse(leaves, doc) {
  const changed = leaves.filter((l) => !(l.path.length === 1 || valueAt(doc, l.path.slice(0, -1)) !== undefined) || !same(valueAt(doc, l.path), l.after)).map((l) => l.path);
  return { writes: changed.length ? [] : leaves.map((l) => ({ path: l.path, value: l.before })), changed };
}

/** Write these into an Automerge draft (value undefined deletes). Parents are there (inverse checked). */
export function apply(draft, writes) {
  for (const { path, value } of writes) {
    let v = draft;
    for (const k of path.slice(0, -1)) {
      v = v?.[k];
      if (v == null || typeof v !== "object") break;
    }
    if (v == null || typeof v !== "object") continue;
    const last = path.at(-1);
    if (value === undefined) {
      if (Object.prototype.hasOwnProperty.call(v, last)) delete v[last];
    } else v[last] = plain(value);
  }
}

// ─── the stacks ─────────────────────────────────────────────────────────────

/** How many steps each stack keeps. */
export const DEPTH = 100;

/**
 * One viewer's stacks, per focus doc: { [docUrl]: { undo: step[], redo: step[] } }.
 * A step is { label, parts: [{ handle, leaves }], kept?: string[] }: the
 * names of the kept things it removed (`judge`). Pure updates.
 */
export const EMPTY = Object.freeze({});

const stacksOf = (s, url) => s[url] ?? { undo: [], redo: [] };

/** A new edit: on top of the undo stack, and the redo stack is gone. */
export function pushed(s, url, step) {
  const { undo } = stacksOf(s, url);
  return { ...s, [url]: { undo: [...undo, step].slice(-DEPTH), redo: [] } };
}

/** The step undo (or redo) would take, or null. */
export const topOf = (s, url, which) => stacksOf(s, url)[which].at(-1) ?? null;

/**
 * After undoing (which "undo") or redoing ("redo") the top step: it leaves
 * its stack, and what applying it wrote (its own recorded step, or null when
 * nothing could be written) goes on the other.
 */
export function moved(s, url, which, done) {
  const st = stacksOf(s, url);
  const other = which === "undo" ? "redo" : "undo";
  const next = { ...st, [which]: st[which].slice(0, -1) };
  if (done) next[other] = [...st[other], done].slice(-DEPTH);
  return { ...s, [url]: next };
}

// ─── the recorder: what the editor runs (parts/editor.js) ────────────────────

/** The kept things a step removed, said: up to three by name, else how many. */
export const keptNames = (names) => (names.length <= 3 ? names.map((n) => `“${n}”`).join(", ") : `${names.length} things`);

/**
 * One viewer's edits in one doc. A doc here is { url, doc(), change(fn) →
 * patches } (a stage's api is one); `handle` is the focus doc, whose url keys
 * the stacks, kept in `store` ({ get, swap }). begin(label) opens a step,
 * whose change(fn, doc?) writes and records from the patches it returns, and
 * end() puts it on the undo stack; take("undo" | "redo") applies the top
 * step's inverse, recorded the same way onto the other stack. Nothing
 * written except through a step is ever on a stack.
 *
 * `judge({ handle, before, after })` says what a step did to one doc (the doc
 * before its first change and after its last): { kept?: name[] (kept things
 * it removed) }.
 * @param {{ handle: object, store?: { get(): object, swap(fn): void }, writable?: () => boolean, notify?: (text: string) => void, judge?: (part: { handle, before, after }) => { kept?: string[] } | null }} o
 */
export function createEdits({ handle, store = boxed(EMPTY), writable = () => true, notify = () => {}, judge = () => null }) {
  const url = handle.url;
  const labels = () => ({ undo: topOf(store.get(), url, "undo")?.label ?? null, redo: topOf(store.get(), url, "redo")?.label ?? null });
  /** A step being made: change(fn, doc?) records into it; step() is what it holds. */
  function recording(label) {
    const parts = new Map(); // doc url → { handle, leaves, before, after }
    return {
      change(fn, h = handle) {
        if (typeof fn !== "function" || fn.ok === false || !h) return;
        const before = h.doc();
        const patches = h.change(fn);
        if (!patches?.length) return;
        const p = parts.get(h.url) ?? { handle: h, leaves: [], before };
        p.after = h.doc();
        p.leaves = fold(p.leaves, patches, before, p.after);
        parts.set(h.url, p);
      },
      step() {
        const list = [...parts.values()].filter((p) => p.leaves.length);
        if (!list.length) return null;
        const kept = [...new Set(list.flatMap((p) => judge(p)?.kept ?? []))];
        return { label: String(label ?? "Edit"), parts: list.map((p) => ({ handle: p.handle, leaves: p.leaves })), ...(kept.length ? { kept } : {}) };
      },
    };
  }
  return {
    /** { change(fn, doc?), end() }: a step of several writes; after end, change writes unrecorded; where this view may not write, nothing */
    begin(label) {
      const rec = recording(label);
      let open = true;
      return Object.freeze({
        change: (fn, h = handle) => {
          if (!writable()) return;
          if (open) rec.change(fn, h);
          else if (typeof fn === "function" && fn.ok !== false) h.change(fn);
        },
        end: () => {
          if (!open) return;
          open = false;
          const step = rec.step();
          if (step) store.swap((s) => pushed(s, url, step));
        },
      });
    },
    /**
     * Undo ("undo") or redo ("redo") the last step: false when there's none,
     * the doc isn't writable, or something it wrote has been written since
     * (then it's dropped, whole, and said).
     */
    take(which) {
      const step = topOf(store.get(), url, which);
      if (!step || !writable()) return false;
      const plans = step.parts.map(({ handle: h, leaves }) => ({ h, inv: inverse(leaves, h.doc()) }));
      const ok = plans.every((p) => !p.inv.changed.length);
      const rec = recording(step.label);
      if (ok) for (const { h, inv } of plans) rec.change((d) => apply(d, inv.writes), h);
      const done = ok ? rec.step() : null;
      store.swap((s) => moved(s, url, which, done));
      if (!done) notify(`Nothing to ${which}: “${step.label}” has been changed since.`);
      else if (step.kept?.length) notify(`${which === "undo" ? "Undid" : "Redid"} “${step.label}”: what is kept for ${keptNames(step.kept)} comes back as its keeper has it now, not as it was.`);
      return !!done;
    },
    labels,
    /** the stacks, for tests */
    stacks: () => store.get(),
  };
}

/** A value in a box: { get, swap } (the store a recorder keeps its stacks in by default). */
function boxed(v) {
  return { get: () => v, swap: (fn) => void (v = fn(v)) };
}
