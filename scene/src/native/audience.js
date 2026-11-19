// scene.audience (native, every doc): provides "audience" (NATIVE.md,
// "Audience", "The veil"). Who may see what a thing is, by every running
// extension's `audience` policy, and the veil, a stand-in for what is kept
// from this viewer. Only the public api; the merge is pure.
//
// Policies answer per object: { show?: "all" | viewer[], only?: viewer[] },
// or nothing. Two different things, so two fields:
//   show  exposes: face up, in your hand, turned toward you;
//   only  occludes: a screen, a hand's privacy.
// Over every policy's answer for one object:
//
//   shown    = ∪ show                 who it is turned toward
//   audience = shown ∩ (⋂ only)       who may see what it is
//
// "all" is the top (it includes someone who is nobody in particular: a
// spectator); with no `show` at all the answer is nobody. Both are unions
// and intersections of sets, so neither depends on the order the answers
// come in, and audience ⊆ shown always.

import { tie } from "./claims.js";
import { snapshot } from "./inspect.js";
import { DEFAULT_BOUNDS, veilBounds, veilGLB, veilKey } from "./veil.js";

export const ALL = "all";

const clean = (list) => [...new Set(list.filter((v) => typeof v === "string" && v))].sort();

/**
 * One policy's answer, made safe: `show` is "all", a list of viewers or
 * absent; `only` a list or absent. An `only` that isn't a list is read as
 * nobody (closed), never as no limit.
 * @returns {{ show?: "all" | string[], only?: string[] } | null}
 */
export function cleanAnswer(a) {
  if (!a || typeof a !== "object") return null;
  const out = {};
  if (a.show === ALL) out.show = ALL;
  else if (Array.isArray(a.show)) out.show = clean(a.show);
  if (a.only !== undefined && a.only !== null) out.only = Array.isArray(a.only) ? clean(a.only) : [];
  return out.show === undefined && out.only === undefined ? null : out;
}

/**
 * Who it is turned toward: the union of every `show`. "all", or viewers
 * sorted.
 * @param {Iterable<object | null | undefined>} answers
 * @returns {"all" | string[]}
 */
export function mergeShown(answers) {
  const out = new Set();
  for (const raw of answers ?? []) {
    const a = cleanAnswer(raw);
    if (!a || a.show === undefined) continue;
    if (a.show === ALL) return ALL;
    for (const v of a.show) out.add(v);
  }
  return [...out].sort();
}

/**
 * Who may see what it is: the union of every `show`, cut by every `only`.
 * "all" only when something shows it to all and nothing limits it; else
 * viewers, sorted ([]: nobody).
 * @param {Iterable<object | null | undefined>} answers
 * @returns {"all" | string[]}
 */
export function mergeAudience(answers) {
  const list = [...(answers ?? [])].map(cleanAnswer).filter(Boolean);
  const shown = mergeShown(list);
  let only = null; // null: no limit
  for (const a of list) {
    if (a.only === undefined) continue;
    only = only === null ? [...a.only] : only.filter((v) => a.only.includes(v));
  }
  if (only === null) return shown;
  return shown === ALL ? only.sort() : shown.filter((v) => only.includes(v));
}

/** Is `viewer` in an audience ("all" | viewer[] | null)? Unknown (null) is nobody. */
export const inAudience = (audience, viewer) => audience === ALL || (Array.isArray(audience) && typeof viewer === "string" && audience.includes(viewer));

// ─── the plugin ─────────────────────────────────────────────────────────────

const CLOSED = Object.freeze({ only: Object.freeze([]) });

function create(api) {
  // Every running extension's `audience(scene)` answer for an object, each
  // policy asked once per snapshot; null while anything the doc calls for
  // isn't in (a missing `only` would enlarge the audience). One that throws is
  // read as nobody: a broken screen hides, it never reveals.
  const asked = new WeakMap(); // policy → { scene, fn }
  function answers(id) {
    const s = api.settled();
    if (!s.ready || s.failed.length) return null;
    const snap = api.scene();
    if (!snap.objects[id]) return [];
    return api.collect("audience").flatMap(({ id: ext, value }) => {
      if (typeof value !== "function") return [];
      try {
        let p = asked.get(value);
        if (p?.scene !== snap) asked.set(value, (p = { scene: snap, fn: value(snap) }));
        return typeof p.fn === "function" ? [p.fn(id) ?? null] : [];
      } catch (err) {
        console.warn(`[scene] extension “${ext}”: audience failed`, err);
        return [CLOSED];
      }
    });
  }
  const merged = (merge) => (id) => ((a) => a && merge(a))(answers(id));

  // The veil: a frosted box with a padlock drawn from the object's bounds
  // alone (veil.js), in place of its content, none of which loads, while any
  // caller veils it.
  const veils = new Map(); // object id → { n: callers veiling it, key, release }
  const drawings = new Map(); // veilKey → its GLB
  function draw(id, v) {
    const o = api.scene().objects[id];
    if (!o) return;
    const b = veilBounds(o.hint?.bounds) ?? veilBounds(api.loadState(id)?.bounds) ?? veilBounds(api.content(id)?.box) ?? DEFAULT_BOUNDS;
    const k = veilKey(b);
    if (v.key === k) return;
    v.key = k;
    if (!drawings.has(k)) drawings.set(k, veilGLB(b));
    v.release = api.display(id, { content: drawings.get(k) });
  }
  function veil(caller, id) {
    if (caller.signal.aborted || !api.scene().objects[id]) return () => {};
    const v = veils.get(id) ?? { n: 0, key: null, release: null };
    veils.set(id, v);
    v.n++;
    draw(id, v);
    return tie(caller.signal, () => --v.n || veils.get(id) !== v || (veils.delete(id), v.release?.()));
  }

  return {
    provides: {
      audience: (caller) =>
        Object.freeze({
          /** "all" | viewer[] | null (unknown): who may see what `id` is */
          audience: merged(mergeAudience),
          /** "all" | viewer[] | null (unknown): who `id` is turned toward, before anything screens it */
          shown: merged(mergeShown),
          /** draw `id` as the veil for this viewer until released (or the caller stops) */
          veil: (id) => veil(caller, id),
        }),
    },
    // its bounds may have changed
    update: () => veils.forEach((v, id) => draw(id, v)),
    /**
     * CONVENTIONS.md, "Inspect": per object some policy answers for, who may
     * see what it is and who it is turned toward (who, never what), and
     * whether it is veiled here; null throughout while it is unknown.
     */
    inspect() {
      const objects = [];
      for (const id of Object.keys(api.scene().objects).sort()) {
        const a = answers(id);
        if (a && !a.some(Boolean) && !veils.has(id)) continue;
        objects.push({ id, audience: a && mergeAudience(a), shown: a && mergeShown(a), veiled: veils.has(id) });
      }
      return snapshot({ objects });
    },
  };
}

export default { create };
