// The bodies of water a doc holds, as boxes a publisher frames (frame.mjs):
// what the water package draws (water/WATER.md, "Water bodies" and
// "Clipped open water") and no hint states. A body's box is its `size` (a
// basin) or, for open water, its `clip` (the block it brings into a world
// with no open water of its own), centred on the object's x and z, turned
// with it, from its floor (y = −depth) to its surface (y = 0), the object's
// uniform scale multiplying it (bodies.js). Here it goes on up to the top of
// everything its doc draws, the `lid`: a boat under way, or swinging at
// anchor, stays inside her block (clip-check.mjs), so the air over the block
// up to her masthead (or the islet's lighthouse) is where she can be seen.
// Calm water: a dry world has no weather, so no wave stands over the top.
// Pure.
import { IDENTITY, apply, corners, drawnBoxes, multiply, worldOf } from "./frame.mjs";

const isBox = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isFinite(v) && v > 0);
const tidy = (v) => Math.round(v * 1e4) / 1e4 + 0;

/** The top of everything doc draws (its frame's y), or −Infinity when it draws nothing. */
export function drawnTop(doc) {
  let top = -Infinity;
  for (const b of drawnBoxes(doc)) for (const p of b.points) top = Math.max(top, p[1]);
  return top;
}

/**
 * Each body of water in doc as a box, carried by m: a visible water object
 * with a valid size, or with no size and a valid clip, and not tilted (a
 * tilted body is no water). `spec` is the box in doc's own frame as
 * publish-links' --box takes it: centre, size and yaw (degrees); `yaw` is
 * that turn alone, which way its length runs in doc.
 * @returns {{ id: string, name: string, kind: "size" | "clip", lid: number, yaw: number, points: number[][], spec: string }[]}
 */
export function waterBoxes(doc, m = IDENTITY) {
  const top = drawnTop(doc);
  const out = [];
  for (const [id, o] of Object.entries(doc?.objects ?? {})) {
    const w = o?.traits?.water;
    if (!w || o.visible === false) continue;
    const kind = isBox(w.size) ? "size" : w.size == null && isBox(w.clip) ? "clip" : null;
    if (!kind) continue;
    const r = o.transform?.rotation ?? [0, 0, 0];
    if ((r[0] ?? 0) !== 0 || (r[2] ?? 0) !== 0) continue;
    const [bw, depth, bl] = w[kind];
    const W = worldOf(doc, id);
    const s = Math.hypot(W[0], W[1], W[2]);
    const lid = Math.max(0, (top - W[13]) / s);
    const centre = apply(W, [0, (lid - depth) / 2, 0]);
    const yaw = (Math.atan2(-W[2], W[0]) * 180) / Math.PI;
    out.push({
      id,
      name: o.name ?? id,
      kind,
      lid,
      yaw: tidy(yaw),
      points: corners([-bw / 2, -depth, -bl / 2], [bw / 2, lid, bl / 2], multiply(m, W)),
      spec: `${centre.map(tidy).join(",")}:${[bw * s, (depth + lid) * s, bl * s].map(tidy).join(",")}@${tidy(yaw)}`,
    });
  }
  return out;
}
