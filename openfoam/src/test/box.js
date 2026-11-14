// A box hull, x 0…4, y −0.5…0.5, z −0.5…0.5, as a flat triangle list wound
// outward; `open` leaves the bow face (x = 4) out, as a shell with no transom.
// Below z = 0: volume 2, wetted area 4·1 (bottom) + 2·4·0.5 (sides) + 1·0.5
// (stern) + 1·0.5 (bow) = 9, LCB 2, waterline 4 × 1, draft 0.5.
export function boxTriangles({ open = false } = {}) {
  const out = [];
  const q = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const P = (x, y, z) => [x, y, z];
  const [x0, x1, y0, y1, z0, z1] = [0, 4, -0.5, 0.5, -0.5, 0.5];
  q(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)); // bottom, normal −z
  q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)); // top, +z
  q(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)); // y0 side, −y
  q(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)); // y1 side, +y
  q(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)); // stern, −x
  if (!open) q(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)); // bow, +x
  return Float64Array.from(out);
}
