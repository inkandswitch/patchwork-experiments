// Where things are set down beside a bag: spots on rings round it, in the
// frame the bag stands in (its doc parent's; the world at the root), so
// what comes out of a bag on a table aboard a ship rides along. Pure.

/** How many spots the first ring has; each ring out has this many more. */
const PER_RING = 8;

/**
 * The k-th spot round a bag (k = 0, 1, 2…): an offset [x, z] from its
 * middle. The first ring starts toward +Z (the bag's front) and each ring
 * is one step further out.
 * @param {number} k  @param {number} reach  the bag's radius  @param {number} step  how far apart things go
 */
export function spot(k, reach, step) {
  let ring = 0;
  let i = Math.max(0, Math.floor(k));
  while (i >= PER_RING * (ring + 1)) {
    i -= PER_RING * (ring + 1);
    ring++;
  }
  const n = PER_RING * (ring + 1);
  const a = (i / n) * Math.PI * 2;
  const r = reach + step * (ring + 0.75);
  return [+(r * Math.sin(a)).toFixed(5), +(r * Math.cos(a)).toFixed(5)];
}

/** How far below its origin a record's thing reaches, at a scale: what to raise it by so it rests on its base. */
export function baseLift(record, scale = 1) {
  const y = Number(record?.hint?.bounds?.min?.[1]);
  return Number.isFinite(y) ? -y * scale : 0;
}

/** Half a record's width in plan, at a scale; `fallback` when it has no bounds. */
export function halfWidth(record, scale = 1, fallback = 0.015) {
  const b = record?.hint?.bounds;
  if (!Array.isArray(b?.min) || !Array.isArray(b?.max)) return fallback;
  const w = Math.max(Number(b.max[0]) - Number(b.min[0]), Number(b.max[2]) - Number(b.min[2]));
  return Number.isFinite(w) && w > 0 ? (w * scale) / 2 : fallback;
}

/**
 * The pose (position, rotation; in the bag's parent's frame) for the k-th
 * thing set down beside a bag whose own transform there is `bagTransform`.
 */
export function poseBeside(bagTransform, reach, k, entry) {
  const [bx, by, bz] = (bagTransform?.position ?? [0, 0, 0]).map(Number);
  const half = halfWidth(entry.object, entry.scale);
  const [dx, dz] = spot(k, reach + half, Math.max(2 * half + 0.004, 0.02));
  return { position: [+(bx + dx).toFixed(5), +(by + baseLift(entry.object, entry.scale)).toFixed(5), +(bz + dz).toFixed(5)], rotation: [0, 0, 0] };
}
