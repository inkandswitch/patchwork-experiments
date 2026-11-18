// A stand-in stage for the walk body's tests: a doc of objects (traits,
// transforms, parents), each with its model's triangles as a content root
// (as api.content(id).root reads), drawn where the doc puts it unless a pose
// is held (`pose(id, M)`: a deck under way), a camera, presence, loops, the
// stage's timers (run before the loops each frame: off the frame loop),
// notices, and, optionally, water at a height everywhere. Its content(id) is
// the real stage's (viewport.contentOf): every object has one, `loaded`
// only once its model has (`tris`, unless `loaded: false`), so an object
// with no model is `{ loaded: false, root: null }` forever; `links` are the
// ids api.link answers for, and `status` is local.status.

import { matrixOf, multiply } from "../frames.js";
import { boxTriangles } from "../navmesh.js";

/** A model: a box's triangles, from min to max, in its own frame. */
export const model = (min, max) => boxTriangles(min, max);

/** A content root as three.js would hand it: one mesh of the triangles, unindexed. */
export const meshRoot = (tris) => ({ isMesh: true, geometry: { attributes: { position: { array: [...tris], itemSize: 3, count: tris.length / 3 } }, index: null }, children: [] });

const boxOf = (tris) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) (min[i % 3] = Math.min(min[i % 3], tris[i])), (max[i % 3] = Math.max(max[i % 3], tris[i]));
  return { min, max };
};

/**
 * @param {{ objects: object, camera?: object, water?: number | null, session?: string, url?: string, links?: string[], status?: object }} o
 *   objects: { id: { traits?, transform?, parent?, kind?, visible?, sourceUrl?, tris?, loaded? } }
 */
export function stage({ objects, camera = { position: [0, 1.6, 5], target: [0, 1.6, 0] }, water = null, session = "me", url = "automerge:here", links = [], status = {} }) {
  const calls = { holds: 0, released: 0, presence: {}, rate: [], camera: [], waterNot: [], notices: [] };
  const loops = [];
  let timers = [];
  const poses = new Map();
  const roots = new Map();
  let now = 0;
  const scene = () => {
    const ids = Object.keys(objects);
    return { objects, ids, parents: new Map(ids.map((id) => [id, objects[objects[id].parent] ? objects[id].parent : null])) };
  };
  const worldOf = (id) => {
    const o = objects[id];
    if (!o) return null;
    if (poses.has(id)) return [...poses.get(id)];
    const own = matrixOf(o.transform);
    return o.parent && objects[o.parent] ? multiply(worldOf(o.parent), own) : own;
  };
  const api = {
    url,
    now: () => now,
    after(ms, fn) {
      const t = { fn };
      timers.push(t);
      return () => (timers = timers.filter((x) => x !== t));
    },
    use: (name) => (name === "clock" ? { t: () => now / 1000 } : name === "notices" ? { notify: (text) => calls.notices.push(text) } : null),
    scene,
    worldOf,
    content(id) {
      const o = objects[id];
      if (!o) return null;
      if (!o.tris || o.loaded === false) return { loaded: false, root: null, box: o.tris ? boxOf(o.tris) : null };
      if (!roots.has(id) || roots.get(id).tris !== o.tris) roots.set(id, { tris: o.tris, root: meshRoot(o.tris) });
      return { loaded: true, root: roots.get(id).root, box: boxOf(o.tris) };
    },
    link: (id) => (links.includes(id) ? { role: "acting", open: true } : null),
    local: { get: () => ({ status }) },
    nameOf: (id) => objects[id]?.name ?? id,
    collect: (name) =>
      name === "water" && water != null
        ? [{ id: "water", value: { at: (p, { not } = {}) => (calls.waterNot.push(not), { heightAt: () => water }) } }]
        : [],
    camera: {
      get: () => camera,
      set: (c) => (calls.camera.push(c), (camera = c)),
      hold: () => (calls.holds++, () => calls.released++),
    },
    channel: { session, set: (k, v) => (calls.presence[k] = v), rate: (hz) => calls.rate.push(hz) },
    loop(fn) {
      loops.push(fn);
      return () => loops.splice(loops.indexOf(fn), 1);
    },
  };
  return {
    api,
    calls,
    loops,
    /** Run n frames of 1/60 s: the timers set before each (bakes), then the loops. */
    frames(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        const due = timers;
        timers = [];
        for (const t of due) t.fn();
        for (const fn of [...loops]) fn(1 / 60);
      }
    },
    /** Hold a drawn pose (a world matrix) on an object, or let it go (null). */
    pose: (id, M) => (M ? poses.set(id, [...M]) : poses.delete(id)),
  };
}
