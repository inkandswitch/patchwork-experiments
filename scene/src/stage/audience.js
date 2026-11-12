// Who may see what a thing is (STAGE.md, "Audience"). Pure.
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
