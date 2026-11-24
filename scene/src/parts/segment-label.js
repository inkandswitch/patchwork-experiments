// Where a label that measures a segment goes (a dimension's, Measure's
// preview): at the segment's middle on screen, or off it when the segment
// is too short there to show past its label. Pure: the label layer's
// `place` (STAGE.md, `labels()`) is built from it.

/**
 * Where a segment's label goes, in screen pixels. At its midpoint, unless
 * the segment is short on screen (under 2½ label widths), where the label
 * would sit on top of the very thing it measures. Then it moves off the
 * line, perpendicular to it and upward where it can, far enough for its box
 * to clear the line by `gap`, and gets a leader back to the midpoint.
 * @returns {{ x: number, y: number, leader: null | { x0: number, y0: number, x1: number, y1: number } }}
 */
export function placeOffSegment(pa, pb, w, h, gap = 14) {
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (len >= 2.5 * w) return { x: mx, y: my, leader: null };
  // perpendicular, pointing up the screen (or right, for a vertical line)
  let nx = len > 1e-6 ? -dy / len : 0;
  let ny = len > 1e-6 ? dx / len : -1;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) (nx = -nx), (ny = -ny);
  const d = gap + Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
  const x = mx + nx * d;
  const y = my + ny * d;
  return { x, y, leader: { x0: mx, y0: my, x1: x, y1: y } };
}

/**
 * The `place` of a label for the segment from a to b (points in the label's
 * frame): placeOffSegment from its ends as they're seen; hidden while its
 * middle can't be seen; at its middle while an end can't be.
 */
export const placeBetween = (a, b) => ({ project, w, h }) => {
  const mid = project([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  if (!mid) return null;
  const pa = project(a);
  const pb = project(b);
  if (!pa || !pb) return mid;
  const p = placeOffSegment(pa, pb, w, h);
  return { x: p.x, y: p.y, leader: p.leader && { x: p.leader.x0, y: p.leader.y0 } };
};
