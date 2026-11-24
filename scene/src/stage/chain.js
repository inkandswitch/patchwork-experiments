// Who is offered an input event, in order (STAGE.md, "The input chain";
// STAGE.md, "The input chain"). Pure: the router asks each in turn until one claims it.
//
// Precedence is nearness. The hit chain runs from the hit object outward (what
// it's attached to, then its groups) and ends at the scene, its last link. An
// extension's holder is the nearest link carrying one of its traits, and the
// holders are offered in that order: an object's holder goes before the holder
// of what it's attached to, and both before the scene's. Running order breaks
// ties only between extensions holding the same link.

import { groupChain } from "../shared/groups.js";

/**
 * @param {{
 *   running: { id: string, meta: object, scope: "scene" | "objects" }[],  // running order
 *   widgetOwner?: string | null,    // the extension whose widget is under the pointer
 *   holders?: Map<string, { id: string | null, depth: number }>,  // holdersFor(…)
 * }} o
 * @returns {string[]} extension ids, each once, at its earliest step: the
 *   widget's owner, then the holders nearest first (the view adds its view
 *   plugins after every stage's, the router offers the hands before these
 *   and the top body after them)
 */
export function chainOrder({ running, widgetOwner = null, holders = new Map() }) {
  const ids = new Set(running.map((r) => r.id));
  const out = [];
  const push = (id) => {
    if (id && ids.has(id) && !out.includes(id)) out.push(id);
  };
  push(widgetOwner);
  // a stable sort, so equal depths keep running order
  const held = running.filter((r) => holders.has(r.id));
  held.sort((a, b) => holders.get(a.id).depth - holders.get(b.id).depth);
  for (const r of held) push(r.id);
  return out;
}

/**
 * The hit chain (STAGE.md, "The input chain", step 3): the hit object, then what it's attached
 * to (nearest first), then its groups (nearest first).
 * @param {string} id  @param {Map} parents  resolveParents  @param {Map} groups  resolveGroups
 * @returns {string[]}
 */
export function hitChain(id, parents, groups, objects = null) {
  if (id == null) return [];
  const up = [];
  const seen = new Set([id]);
  for (let p = parents.get(id); p != null && !seen.has(p); p = parents.get(p)) {
    seen.add(p);
    up.push(p);
  }
  return [id, ...up, ...groupChain(groups, id).filter((g) => !objects || objects[g])];
}

/**
 * For each running extension with traits, its holder: the nearest link of the
 * hit chain (the hit object, what it's attached to, then its groups, nearest
 * first, and last the scene) that carries one of them, with that link's depth
 * (0 for the hit object; the scene's is the chain's length). The scene's id
 * is null.
 * @param {{ id: string, meta: object }[]} running
 * @param {string[]} hitChain  object ids, nearest first; empty when nothing is hit
 * @param {(id: string | null) => string[]} traitsOf  a link's trait keys (null: the scene's own)
 * @returns {Map<string, { id: string | null, depth: number }>} extension id → its holder
 */
export function holdersFor(running, hitChain, traitsOf) {
  const links = [...(hitChain ?? []), null];
  const keys = links.map((id) => traitsOf(id));
  const out = new Map();
  for (const r of running) {
    const mine = Array.isArray(r.meta?.traits) ? r.meta.traits : [];
    if (!mine.length) continue;
    // (a part of every doc, traits ["*"], is the scene's: activation.js)
    const depth = mine.includes("*") ? links.length - 1 : keys.findIndex((ks) => ks.some((t) => mine.includes(t)));
    if (depth >= 0) out.set(r.id, { id: links[depth], depth });
  }
  return out;
}

/**
 * Offer an event down the chain: the first handler that returns something
 * truthy claims it. Returns { id, result } or null.
 * @param {string[]} order
 * @param {(id: string) => object | undefined} inputOf  an extension's `input` (or a body's or a held tool's)
 * @param {string} type  "press" | "click" | …
 * @param {object | ((id: string) => object)} ev  the event, or a function giving it per extension (to add `holder`)
 */
export function offer(order, inputOf, type, ev) {
  for (const id of order) {
    const fn = inputOf(id)?.[type];
    if (typeof fn !== "function") continue;
    let result;
    try {
      result = fn(typeof ev === "function" ? ev(id) : ev);
    } catch (err) {
      console.warn(`[scene] ${id}: input.${type} failed`, err);
      continue;
    }
    if (result) return { id, result };
  }
  return null;
}

/**
 * The widget under the pointer from several candidates: an onTop one beats
 * any other, else the nearest (a widget that gives no distance counts as
 * nearest of all: it says "I have something here").
 * @param {{ owner: string, onTop?: boolean, distance?: number }[]} candidates
 */
export function bestWidget(candidates) {
  let best = null;
  const dist = (w) => (Number.isFinite(w?.distance) ? w.distance : 0);
  for (const w of candidates) {
    if (!w || w.owner == null) continue;
    if (!best) best = w;
    else if (!!w.onTop !== !!best.onTop) best = w.onTop ? w : best;
    else if (dist(w) < dist(best)) best = w;
  }
  return best;
}

/** Does this widget come before the object hit (onTop, or no further away)? */
export function widgetWins(widget, hit) {
  if (!widget || widget.owner == null) return false;
  if (widget.onTop || !hit) return true;
  const d = Number.isFinite(widget.distance) ? widget.distance : 0;
  return d <= (hit.distance ?? Infinity);
}
