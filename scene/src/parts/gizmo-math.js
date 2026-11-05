// The transform gizmo's arithmetic, apart from three.js and the stage, so it
// can be tested on its own: which tool is in effect, what the gizmo is on, a
// group's movable members, and world poses back into the doc's local ones.
// Matrices are 16 numbers, column-major (transform.js, api.worldOf).

import { IDENTITY_MATRIX, decomposeMatrix, invertMatrix, multiplyMatrices } from "../transform.js";
import { groupChain, isGroup } from "../groups.js";

/** Old docs' view.defaultMode / defaultGizmo values, as tools. */
const LEGACY = { translate: "move", move: "move", rotate: "rotate", hand: "hand", select: "select" };

/**
 * What a plain drag does for this viewer: the local choice, else the doc's
 * suggestion (view.tool, view.defaultMode, the old view.defaultGizmo), else
 * "move". "translate" reads as "move".
 */
export function effectiveTool(local, doc) {
  const v = local?.tool ?? doc?.view?.tool ?? doc?.view?.defaultMode ?? doc?.view?.defaultGizmo ?? "move";
  return LEGACY[v] ?? v;
}

/** The gizmo's three.js mode for a tool, or null when the tool has no gizmo. */
export const modeFor = (tool) => (tool === "move" ? "translate" : tool === "rotate" ? "rotate" : null);

/** Every object filed in group `gid`, at any depth (groups themselves left out). */
export function groupMembers(scene, gid) {
  const out = [];
  for (const id of Object.keys(scene?.objects ?? {})) {
    const o = scene.objects[id];
    if (!o || isGroup(o)) continue;
    if (groupChain(scene.groups, id).includes(gid)) out.push(id);
  }
  return out;
}

/**
 * What a group's move moves (old viewport groupRoots): its members that
 * aren't locked and aren't attached to another member (those follow their
 * parent).
 */
export function groupRoots(scene, gid) {
  const members = new Set(groupMembers(scene, gid));
  const out = [];
  for (const id of members) {
    if (scene.objects[id]?.locked) continue;
    const p = scene.parents?.get(id);
    if (p != null && members.has(p)) continue;
    out.push(id);
  }
  return out;
}

/**
 * What the gizmo is on: { kind: "object" | "group", id, mode }, or null.
 * Shown only for the move and rotate tools, while nothing is armed, on a
 * selected object that isn't locked, or a selected group with something it can move.
 */
export function gizmoTarget(scene, local) {
  const mode = modeFor(effectiveTool(local, scene?.d));
  if (!mode || local?.armed != null) return null;
  const id = local?.selected;
  const o = id != null ? scene?.objects?.[id] : null;
  if (!o) return null;
  if (isGroup(o)) return groupRoots(scene, id).length ? { kind: "group", id, mode } : null;
  if (o.locked) return null;
  return { kind: "object", id, mode };
}

const matrix = (m) => (Array.isArray(m) && m.length === 16 ? m : IDENTITY_MATRIX);

/** A world matrix as a local transform under a parent whose world matrix is `parentWorld` (null: the scene). */
export function localFrom(parentWorld, world) {
  if (!parentWorld) return decomposeMatrix(matrix(world));
  const inv = invertMatrix(matrix(parentWorld));
  return decomposeMatrix(inv ? multiplyMatrices(inv, matrix(world)) : matrix(world));
}

/**
 * Where each root of a group move goes: the pivot went from `pivotStart` to
 * `pivotNow` (world matrices), and each root keeps its pose relative to it.
 * @param {{ id: string, world: number[], parentWorld: number[] | null }[]} roots  as they were at the start
 * @returns {Map<string, { position, rotation, scale }>} id → its new local transform
 */
export function groupMove(pivotStart, pivotNow, roots) {
  const inv = invertMatrix(matrix(pivotStart)) ?? IDENTITY_MATRIX;
  const delta = multiplyMatrices(matrix(pivotNow), inv);
  const out = new Map();
  for (const r of roots) out.set(r.id, localFrom(r.parentWorld, multiplyMatrices(delta, matrix(r.world))));
  return out;
}
