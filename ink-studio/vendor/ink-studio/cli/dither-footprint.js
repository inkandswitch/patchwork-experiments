/* Long axis of one native art pixel on the surface tangent plane. */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function ditherFootprint(rayAt, x, y, point, normal, step, toRest) {
  if (!point) return undefined;
  const plane = normal || rayAt(x, y).direction.slice();
  function at(px, py) {
    const { origin, direction } = rayAt(px, py);
    const facing = dot(plane, direction);
    if (Math.abs(facing) < 1e-8) return null;
    const distance = dot(plane, point) - dot(plane, origin);
    const reach = distance / facing;
    return reach >= 0 ? point.map((_, i) => origin[i] + direction[i] * reach) : null;
  }
  const half = step * .5;
  const a = at(x - half, y), b = at(x + half, y), c = at(x, y - half), d = at(x, y + half);
  if (!a || !b || !c || !d) return Infinity;
  const along = b.map((value, i) => value - a[i]), across = d.map((value, i) => value - c[i]);
  const u = toRest ? toRest(...along) : along, v = toRest ? toRest(...across) : across;
  const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v);
  return Math.sqrt(.5 * (uu + vv + Math.hypot(uu - vv, 2 * uv)));
}

module.exports = { ditherFootprint };
