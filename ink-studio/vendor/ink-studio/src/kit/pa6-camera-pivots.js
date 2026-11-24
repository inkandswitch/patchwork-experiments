/* Renderer-independent camera pivot selection and orbit transforms. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const offsets = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

  function choose(mode, { cursor = [.5, .5], pick, fallback = null, radius = .12 } = {}) {
    if (!pick || !['cursor', 'center', 'region'].includes(mode)) return fallback;
    if (mode === 'cursor') return pick(...cursor) ?? fallback;
    const center = pick(.5, .5);
    if (center != null || mode === 'center') return center ?? fallback;
    const step = K.clamp(radius, 0, .5);
    if (step > 0) for (const [x, y] of offsets) {
      const point = pick(.5 + x * step, .5 + y * step);
      if (point != null) return point;
    }
    return fallback;
  }

  function axes(yaw, pitch) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw), flat = Math.cos(pitch);
    const back = [sin * flat, Math.sin(pitch), cos * flat], right = [cos, 0, -sin];
    return [right, V.cross(back, right), back];
  }

  function orbit(view, yaw, pitch, pivot) {
    if (!pivot || (yaw === view.yaw && pitch === view.pitch)) return { ...view, yaw, pitch };
    const from = axes(view.yaw, view.pitch), to = axes(yaw, pitch), offset = V.sub(view.target, pivot);
    const target = V.add(pivot, V.add(
      V.mul(to[0], V.dot(from[0], offset)),
      V.add(V.mul(to[1], V.dot(from[1], offset)), V.mul(to[2], V.dot(from[2], offset)))
    ));
    return { ...view, yaw, pitch, target };
  }

  function zoom(view, dist, pivot) {
    const target = pivot && dist !== view.dist
      ? V.add(pivot, V.mul(V.sub(view.target, pivot), dist / view.dist))
      : view.target;
    return { ...view, dist, target };
  }

  P.cameraPivots = { choose, orbit, zoom };
})(KIT);
