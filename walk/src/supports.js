// The input adapter (DESIGN.md, "The bake, per support", Input): the
// walker's world, read from the stage. Which objects are supports (the
// trait `walk.support`; the ground, the stage's own frame, is the support of
// everything no support owns); what each one bakes (its objects' GLBs at
// their rest pose, placed by the doc's transforms, a `swept` part as the
// solid its turn sweeps; never what is loose or moves); its seeds (spawn
// points, stand spots, ladders); its bake key; the meshes, cached for the
// page by key and rebaked off the frame loop, the old one in use until the
// new one lands; the blockers, where they are drawn this frame; and the
// water, as the stage's `water` contribution answers it.

import { bake, sweptAbout } from "./navmesh.js";
import { apply, headingOf, invert, matrixOf, multiply, scaleOf } from "./frames.js";
import { BODY } from "./walk.js";

/** The traits walk reads (DESIGN.md, "The traits"). */
export const SPAWN = "walk.spawn";
export const SUPPORT = "walk.support";
export const MOVES = "walk.moves";
export const STAND = "walk.stand";
export const LADDER = "walk.ladder";
/** What can be carried (a die, a bag) is loose: never floor. */
const CARRY = "scene.carry";

const I4 = Object.freeze(matrixOf(null));
const AXES = { x: 0, y: 1, z: 2 };

// ─── the doc's tree ─────────────────────────────────────────────────────────

/** What an object is attached to: a snapshot's resolved parents, else the doc's field. */
export const parentOf = (scene, id) => (scene?.parents?.get ? (scene.parents.get(id) ?? null) : (scene?.objects?.[id]?.parent ?? null));

const traitsOf = (scene, id) => scene?.objects?.[id]?.traits ?? null;
const idsOf = (scene) => [...(scene?.ids ?? Object.keys(scene?.objects ?? {}))].filter((id) => scene.objects?.[id]).sort();

/** An object's owner: itself or its nearest ancestor with `walk.support`; null (the ground) if none. */
export function ownerOf(scene, id) {
  for (let at = id, n = 0; at != null && n < 64; at = parentOf(scene, at), n++) if (traitsOf(scene, at)?.[SUPPORT]) return at;
  return null;
}

/** Every support in the doc, by id. */
export const supportsOf = (scene) => idsOf(scene).filter((id) => traitsOf(scene, id)?.[SUPPORT]);

/**
 * Where `id` sits in `root`'s frame by the doc's transforms (not the poses
 * drawn: a door's rise and a wheel's turn are play's): the product of the
 * transforms from just under `root` down to `id`. `root` null: the stage's
 * frame. null if `id` isn't under `root`.
 */
export function placeIn(scene, id, root = null) {
  let m = null;
  for (let at = id, n = 0; at != null && n < 64; at = parentOf(scene, at), n++) {
    if (at === root) return m ?? I4;
    const o = scene?.objects?.[at];
    if (!o) return null;
    const own = matrixOf(o.transform);
    m = m ? multiply(own, m) : own;
  }
  return root == null ? (m ?? I4) : null;
}

/**
 * How an object stands to its owner's bake: `loose` (it or an ancestor up
 * to the owner is hidden or carried), or under a moving part (`moving`: the
 * nearest such ancestor or itself, with its `walk.moves`), or neither.
 */
function standing(scene, id, owner) {
  let moving = null;
  for (let at = id, n = 0; at != null && n < 64; at = parentOf(scene, at), n++) {
    const o = scene.objects?.[at];
    if (!o) break;
    if (o.visible === false || o.traits?.[CARRY]) return { loose: true, moving: null };
    if (at === owner) break;
    if (!moving && o.traits?.[MOVES]) moving = { id: at, moves: o.traits[MOVES] };
  }
  return { loose: false, moving };
}

/**
 * The objects baked into support s's mesh (null: the ground), in id order:
 * those it owns that aren't loose, groups left out (they have no geometry
 * of their own), and of the moving parts only the `swept` ones, as the
 * solid their turn about that axis of their own frame sweeps.
 * @returns {Array<{ id: string, swept: { part: string, axis: number } | null }>}
 */
export function bakedObjects(scene, s) {
  const out = [];
  for (const id of idsOf(scene)) {
    const o = scene.objects[id];
    if (o.kind === "group" || ownerOf(scene, id) !== s) continue;
    const { loose, moving } = standing(scene, id, s);
    if (loose) continue;
    if (!moving) out.push({ id, swept: null });
    else if (AXES[moving.moves?.swept] != null) out.push({ id, swept: { part: moving.id, axis: AXES[moving.moves.swept] } });
  }
  return out;
}

/** The objects with `walk.moves { blocks }`, wherever they are: obstacles drawn where they are each frame. */
export const blockersOf = (scene) => idsOf(scene).filter((id) => traitsOf(scene, id)?.[MOVES]?.blocks === true);

// ─── geometry ───────────────────────────────────────────────────────────────

/** A node's own matrix (three.js position, quaternion, scale; any scale). */
function nodeMatrix(node) {
  const p = node.position ?? {};
  const q = node.quaternion ?? null;
  const s = node.scale ?? {};
  const [x, y, z, w] = q ? [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1] : [0, 0, 0, 1];
  const [sx, sy, sz] = [s.x ?? 1, s.y ?? 1, s.z ?? 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    p.x ?? 0, p.y ?? 0, p.z ?? 0, 1,
  ];
}

/**
 * The triangles of a content root (api.content(id).root, a three.js node:
 * read, never changed), in the object's own frame, at the GLB's rest pose
 * (each node's own transform, from the root down), 9 numbers each. Hidden
 * nodes are left out. An instanced mesh is one copy per instance, each
 * through its instance matrix (terrain's trees).
 */
export function trianglesOf(root) {
  const out = [];
  const visit = (node, parent, depth) => {
    if (!node || depth > 64 || node.visible === false) return;
    const m = multiply(parent, nodeMatrix(node));
    const pos = node.isMesh ? node.geometry?.attributes?.position : null;
    if (pos) {
      const size = pos.itemSize ?? 3;
      const get = (i) => (typeof pos.getX === "function" ? [pos.getX(i), pos.getY(i), pos.getZ(i)] : [pos.array[i * size], pos.array[i * size + 1], pos.array[i * size + 2]]);
      const index = node.geometry.index;
      const count = index ? (index.count ?? index.array.length) : (pos.count ?? pos.array.length / size);
      const at = index ? (k) => (typeof index.getX === "function" ? index.getX(k) : index.array[k]) : (k) => k;
      const inst = node.isInstancedMesh && node.instanceMatrix?.array;
      const copies = inst ? Array.from({ length: node.count ?? inst.length / 16 }, (_, i) => multiply(m, Array.from(inst.slice(i * 16, i * 16 + 16)))) : [m];
      for (const mc of copies) for (let k = 0; k + 2 < count; k += 3) for (let j = 0; j < 3; j++) out.push(...apply(mc, get(at(k + j))));
    }
    for (const ch of Array.isArray(node.children) ? node.children : []) visit(ch, m, depth + 1);
  };
  visit(root, I4, 0);
  return out;
}

const scaled = (k) => matrixOf({ scale: k });

/** A rigid frame: the matrix with its (uniform) scale divided out. */
function rigid(m) {
  const k = scaleOf(m);
  return m.map((v, i) => (i < 12 && i % 4 !== 3 ? v / k : v));
}

/**
 * A support's frame as drawn (DESIGN.md, Words): its object's world matrix
 * with the scale divided out; the ground's is the identity. null when the
 * object is gone or isn't a support any more.
 */
export function frameOf(api, id) {
  if (id == null) return I4;
  if (!traitsOf(api.scene?.(), id)?.[SUPPORT]) return null;
  const w = api.worldOf?.(id);
  return w ? rigid(w) : null;
}

/** A support's scale: its drawn matrix's (metres per unit of its own frame); the ground's is 1. */
const scaleIn = (api, s) => (s == null ? 1 : scaleOf(api.worldOf?.(s) ?? I4));

/** Object o's own frame into support s's (metres): placed by the doc, at s's scale. */
const toSupport = (scene, o, s, k) => {
  const m = o === s ? I4 : placeIn(scene, o, s);
  return m ? multiply(scaled(k), m) : null;
};

/** A yaw (0 looks down −Z) for a direction in plan. */
const yawTo = (d) => Math.atan2(-d[0], -d[2]);

/**
 * Support s's seeds, in its frame: every spawn point (at its origin, facing
 * the way it faces), stand spot (`at`, facing `facing`, default its origin)
 * and ladder (`top`, hanging at its origin, facing from there to the top:
 * inboard) it owns.
 */
export function seedsOf(scene, s, k = 1) {
  const out = [];
  for (const id of idsOf(scene)) {
    const t = traitsOf(scene, id);
    if (!(t?.[SPAWN] || t?.[STAND] || t?.[LADDER]) || ownerOf(scene, id) !== s) continue;
    const m = toSupport(scene, id, s, k);
    if (!m) continue;
    const origin = apply(m, [0, 0, 0]);
    if (t[SPAWN]) out.push({ kind: "spawn", id, at: origin, yaw: headingOf(m) });
    const st = t[STAND];
    if (Array.isArray(st?.at)) {
      const at = apply(m, st.at);
      const f = Array.isArray(st.facing) ? apply(m, st.facing) : origin;
      out.push({ kind: "stand", id, at, yaw: yawTo([f[0] - at[0], 0, f[2] - at[2]]) });
    }
    if (Array.isArray(t[LADDER]?.top)) {
      const top = apply(m, t[LADDER].top);
      out.push({ kind: "ladder", id, at: top, yaw: yawTo([top[0] - origin[0], 0, top[2] - origin[2]]), hook: origin });
    }
  }
  return out;
}

const fnv = (str) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).padStart(14, "0");
};
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Support s's bake key: a hash of its scale and, for each baked object and
 * each seed, its id, files, transform in s, swept axis, traits (their keys;
 * a seed's values too) and whether its model has loaded. s's own drawn pose
 * is not in it (a deck never rebakes because it moved), nor are the
 * blockers (read each frame). null until every baked object that has a
 * model has loaded it: nothing to bake yet.
 */
export function bakeKey(api, s) {
  const scene = api.scene?.();
  if (!scene || (s != null && !traitsOf(scene, s)?.[SUPPORT])) return null;
  const k = scaleIn(api, s);
  const parts = [];
  for (const { id, swept } of bakedObjects(scene, s)) {
    const c = api.content?.(id);
    if (c && !c.loaded) return null;
    const o = scene.objects[id];
    parts.push([id, o.sourceUrl ?? null, o.renderUrl ?? null, (toSupport(scene, id, s, 1) ?? I4).map(r6), !!c, swept ? [swept.part, swept.axis] : null, Object.keys(o.traits ?? {}).sort()]);
  }
  const seeds = seedsOf(scene, s, 1).map((sd) => [sd.kind, sd.id, sd.at.map(r6), r6(sd.yaw ?? 0), sd.hook?.map(r6) ?? null]);
  return fnv(JSON.stringify([r6(k), parts, seeds]));
}

/**
 * What support s's bake is made of: its triangles and seeds in its frame
 * (metres), with every component kept (`prune: false`: DESIGN.md, the
 * pruning by passable sides is still owed). null while bakeKey is.
 * @returns {{ key: string, triangles: number[], seeds: object[], prune: false } | null}
 */
export function bakeInput(api, s) {
  const key = bakeKey(api, s);
  if (!key) return null;
  const scene = api.scene();
  const k = scaleIn(api, s);
  const triangles = [];
  for (const { id, swept } of bakedObjects(scene, s)) {
    const root = api.content?.(id)?.root;
    if (!root) continue;
    let tris = trianglesOf(root);
    let m = toSupport(scene, id, s, k);
    if (swept) {
      // into the moving part's frame, swept about its axis, then placed as the part is
      const inPart = swept.part === id ? I4 : placeIn(scene, id, swept.part);
      if (!inPart) continue;
      const placed = [];
      for (let i = 0; i < tris.length; i += 3) placed.push(...apply(inPart, [tris[i], tris[i + 1], tris[i + 2]]));
      tris = sweptAbout(placed, swept.axis);
      m = toSupport(scene, swept.part, s, k);
    }
    if (!m) continue;
    for (let i = 0; i < tris.length; i += 3) triangles.push(...apply(m, [tris[i], tris[i + 1], tris[i + 2]]));
  }
  return { key, triangles, seeds: seedsOf(scene, s, k), prune: false };
}

/** Baked meshes by key, shared by every walker in the page (a mesh is never changed once baked). */
const MESHES = new Map();
const KEEP = 8;

/** The bytes a mesh keeps (its typed arrays). */
export function meshBytes(mesh) {
  let n = 0;
  const add = (o) => {
    for (const v of Object.values(o ?? {})) if (ArrayBuffer.isView(v)) n += v.byteLength;
  };
  add(mesh);
  add(mesh?.cells);
  add(mesh?.side);
  add(mesh?.intervals);
  return n;
}

/**
 * Bake an input, or the cached mesh with its key. A page that keeps an
 * array at globalThis.__WALK_BAKES__ (the probes) is told each bake's cost,
 * against the 500 ms budget (DESIGN.md, "When it runs, and the budget").
 */
export function meshFor(input, P = BODY) {
  let mesh = MESHES.get(input.key);
  if (!mesh) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    mesh = bake(input, P);
    const log = globalThis.__WALK_BAKES__;
    if (Array.isArray(log)) log.push({ key: input.key, ms: Math.round((globalThis.performance?.now?.() ?? Date.now()) - t0), triangles: input.triangles.length / 9, columns: mesh.nx * mesh.nz, cells: mesh.count, MB: +(meshBytes(mesh) / 1e6).toFixed(1) });
    MESHES.set(input.key, mesh);
    while (MESHES.size > KEEP) MESHES.delete(MESHES.keys().next().value);
  }
  return mesh;
}

// ─── the walker's world ─────────────────────────────────────────────────────

const unit = (M, i) => {
  const l = Math.hypot(M[i * 4], M[i * 4 + 1], M[i * 4 + 2]) || 1;
  return [M[i * 4] / l, M[i * 4 + 1] / l, M[i * 4 + 2] / l];
};

/** A local box { min, max } through a matrix: an oriented box { o, A, h }. */
export function orientedBox(M, { min, max }) {
  const o = apply(M, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
  const A = [unit(M, 0), unit(M, 1), unit(M, 2)];
  const h = [0, 1, 2].map((i) => ((max[i] - min[i]) / 2) * Math.hypot(M[i * 4], M[i * 4 + 1], M[i * 4 + 2]));
  return { o, A, h };
}

/**
 * The walker's env on one stage (walker.js): its supports, their frames
 * and meshes, the water and the blockers. A support's first mesh is baked
 * when first needed (asked for: entering, a walker on it) once its models
 * have loaded (null until then: the walker waits); each later one, when
 * its key changes, off the frame loop (the stage's clock.after), the old
 * mesh answered until it lands. `changed()` says the doc or what's shown
 * changed (the extension's update), so keys are looked at again;
 * `frame()` starts a frame (blockers are read once in each).
 */
export function createSupports(api, P = BODY) {
  const entries = new Map(); // id (null: the ground) → { key, mesh, want, seen, timer }
  let version = 0;
  let frameNo = 0;
  const boxes = new Map(); // on → [box], this frame
  let boxesAt = -1;

  const ids = () => [...supportsOf(api.scene?.()), null];

  function land(id, e) {
    e.timer = null;
    const input = bakeInput(api, id);
    if (!input) return;
    e.mesh = meshFor(input, P);
    e.key = input.key;
  }
  function entryOf(id) {
    let e = entries.get(id);
    if (!e) entries.set(id, (e = { key: null, mesh: null, want: null, seen: -1, timer: null }));
    if (e.seen !== version) {
      e.want = bakeKey(api, id);
      e.seen = version;
    }
    if (e.want && e.want !== e.key && !e.timer) {
      const cached = MESHES.get(e.want);
      if (cached) (e.mesh = cached), (e.key = e.want);
      else if (!e.mesh) land(id, e); // the first: baked when first needed
      else e.timer = api.clock.after(0, () => land(id, e)) ?? true; // a rebake: off the frame loop, the old mesh in use until it lands
    }
    return e;
  }

  const env = {
    supports: ids,
    frame: (id) => frameOf(api, id),
    mesh: (id) => (id == null || frameOf(api, id) ? entryOf(id).mesh : null),
    water(x, z) {
      const w = api.collect?.("water")?.find((c) => c.value?.at)?.value;
      const r = w ? w.at([x, null, z], { not: supportsOf(api.scene?.()) }) : null;
      const y = r?.heightAt?.(x, z, api.clock?.t?.() ?? 0);
      return Number.isFinite(y) ? y : null;
    },
    blockers(on) {
      if (boxesAt !== frameNo) (boxes.clear(), (boxesAt = frameNo));
      if (!boxes.has(on)) {
        const F = frameOf(api, on);
        const into = F ? invert(F) : null;
        const list = [];
        for (const id of into ? blockersOf(api.scene?.()) : []) {
          const box = api.content?.(id)?.box;
          const w = api.worldOf?.(id);
          if (box && w) list.push(orientedBox(multiply(into, w), box));
        }
        boxes.set(on, list);
      }
      return boxes.get(on);
    },
  };

  return {
    env,
    /** Has every support (the ground included) its first mesh? */
    ready: () => ids().every((id) => env.mesh(id) != null),
    changed: () => void version++,
    frame: () => void frameNo++,
  };
}
