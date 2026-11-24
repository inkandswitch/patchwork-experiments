// The moves between a scene and a bag: put in, draw, pour, and what a view
// does once the docs have merged (settle). Each is the same few writes
// whoever makes them, with the doc effects handed in, so the scene extension
// (through the stage's api), the 2D tool (no scene at all) and the tests
// (real Automerge docs, every interleaving: moves.test.js) run the same
// code. The argument for why these writes merge safely is contents.js's.
//
// `bag` is { doc(), change(fn) } (a DocHandle is one). The scene side is
// handed in as plain functions, since the stage owns how a scene is written.

import { choose, inside, itemKey, putIn, takeOut, verdict } from "./contents.js";
import { replaces } from "./draw.js";
import { isGroup, objectFrom, recordOf, scaleOf } from "./object.js";

/**
 * Put scene objects in a bag: they leave the scene in one change, then go
 * into the bag in one change.
 * @param {{
 *   objects: Record<string, object>,   // the scene's, now
 *   ids: string[],                     // which (groups already replaced by their members)
 *   sceneUrl: string | null,
 *   remove: (ids: string[]) => void,   // take them out of the scene, in one change
 *   bag: { change: (fn: (d: object) => void) => void },
 * }} o
 * @returns {string[]} their item keys
 */
export function putObjects({ objects, ids, sceneUrl, remove, bag, tag }) {
  const things = [...new Set(ids)].filter((id) => objects?.[id] && !isGroup(objects[id])).map((id) => ({ id, object: recordOf(objects[id]), scale: scaleOf(objects[id]) }));
  if (!things.length) return [];
  // The bag first: both writes are made here in one tick, but should only
  // one of them ever reach anyone (this tab dies between two sends), an item
  // in both places is a stray the readers' rule settles, and an item in
  // neither is gone.
  let keys = [];
  bag.change((d) => (keys = putIn(d, things, { from: sceneUrl, ...(tag ? { tag } : {}) })));
  remove(things.map((t) => t.id));
  return keys;
}

/**
 * Draw one item by the bag's rule: its object goes into the scene (when
 * there is one) and the bag says who took it. Without replacement the object
 * is the one that went in, under its own id where this is the scene it came
 * from, so two draws of one item at once are one object (contents.js, 2).
 * With replacement the item stays in and `copy` makes a copy of it.
 * @param {{
 *   bag: { doc: () => object, change: (fn: (d: object) => void) => void },
 *   rule: string, by: string, random?: () => number,
 *   shadow?: (key: string, entry: object) => boolean,
 *   scene?: {                                    // absent: drawn outside any scene (the tool)
 *     url: string, has: (id: string) => boolean, newId: () => string,
 *     insert: (id: string, entry: object) => void,   // write objects[id] in one change
 *     copy?: (entry: object) => void,                // a copy of it, the stage's way
 *   } | null,
 * }} o
 * @returns {{ key: string, entry: object, id: string | null, fresh: boolean, copy: boolean, take: object | null } | null}
 *   what was drawn (`id`: its object in the scene; `fresh`: under an id this
 *   view made, which it alone may remove; `take`: what settleDraw needs), or
 *   null when nothing is inside
 */
export function drawOne({ bag, rule, by, random = Math.random, shadow = null, scene = null }) {
  const pick = choose(bag.doc(), rule, { random, shadow });
  if (!pick) return null;
  const entry = JSON.parse(JSON.stringify(pick.entry));
  if (replaces(rule)) {
    scene?.copy?.(entry);
    return { key: pick.key, entry, id: null, fresh: false, copy: true, take: null };
  }
  let id = null;
  let fresh = false;
  if (scene) {
    const home = !!entry.from && itemKey(entry.from, entry.id) === itemKey(scene.url, entry.id) && !scene.has(entry.id);
    id = home ? entry.id : scene.newId();
    fresh = !home;
    scene.insert(id, entry);
  }
  let take = null;
  bag.change((d) => (take = takeOut(d, pick.key, by)));
  return { key: pick.key, entry, id, fresh, copy: false, take };
}

/**
 * After a merge: is this draw still this view's? "mine", or "lost" when the
 * bag now says another view took that item at the same moment, or when its
 * object has left the scene under this view (the other drawer put it away
 * again before this view heard of either). The loser removes the object only
 * if it was under an id of its own making (`fresh`), and draws again.
 * @param {(id: string) => boolean} [has]  is that object in the scene now
 */
export function settleDraw(bagDoc, drawn, by, has = null) {
  if (drawn.copy || !drawn.take) return "mine";
  if (verdict(bagDoc, drawn.take, by) === "lost") return "lost";
  return has && drawn.id != null && !has(drawn.id) ? "lost" : "mine";
}

/**
 * Pour everything inside one bag into another: each item is put into `to`
 * (a new put there), then taken out of `from`. (Two docs again: an item drawn
 * from `from` at the same moment ends up in the scene and listed in `to`,
 * which is a stray there, and the scene wins.)
 * @returns {number} how many went over
 */
export function pour({ from, to, by, shadow = null, tag }) {
  const list = inside(from.doc(), shadow);
  if (!list.length) return 0;
  to.change((d) => putIn(d, list.map(({ entry }) => ({ id: entry.id, from: entry.from, object: entry.object, scale: entry.scale })), tag ? { tag } : {}));
  from.change((d) => {
    for (const { key } of list) takeOut(d, key, by);
  });
  return list.length;
}

/** The object an entry goes back into a scene as, at a pose (object.js). */
export const objectOf = (entry, pose) => objectFrom(entry.object, entry.scale, pose);
