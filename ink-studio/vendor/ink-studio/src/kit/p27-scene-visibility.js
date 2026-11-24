(function(K) {
  const { V } = K;
  const { dot, sub, add, mul, len } = V;
  const finite = Number.isFinite;
  const xyz = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(finite);
  const screen = Object.freeze([-1, 1, -1, 1]);

  function camera({ eye, right, up, back, tangent, aspect, ortho = false, near = .4, far = 400, observer = eye } = {}) {
    if (![eye, right, up, back, observer].every(xyz) || ![tangent, aspect, near, far].every(finite) ||
        tangent <= 0 || aspect <= 0 || near <= 0 || far <= near || typeof ortho !== 'boolean')
      throw new TypeError('Streaming needs a finite camera pose, projection and depth range');
    if ([right, up, back].some(axis => Math.abs(len(axis) - 1) > 1e-4) ||
        Math.max(Math.abs(dot(right, up)), Math.abs(dot(right, back)), Math.abs(dot(up, back))) > 1e-4)
      throw new RangeError('Streaming camera axes must form an orthonormal basis');
    return Object.freeze({ ...Object.fromEntries(Object.entries({ eye, right, up, back, observer })
      .map(([key, value]) => [key, Object.freeze(value.slice())])), tangent, aspect, ortho, near, far });
  }

  function localPlanes(camera, [left, right, bottom, top]) {
    const x = camera.tangent * camera.aspect, y = camera.tangent;
    const side = (a, b, c) => camera.ortho ? [a, b, 0, c] : [a, b, c, 0];
    return [side(1, 0, -left * x), side(-1, 0, right * x),
      side(0, 1, -bottom * y), side(0, -1, top * y),
      [0, 0, 1, -camera.near], [0, 0, -1, camera.far]];
  }
  function planeValue([a, b, c, d], [x, y, z]) {
    return a*x + b*y + c*z + d;
  }
  function frustum(camera, window = screen, entrance) {
    const planes = localPlanes(camera, window).map(([a, b, c, d]) => {
      const normal = add(add(mul(camera.right, a), mul(camera.up, b)), mul(camera.back, -c));
      return [...normal, d - dot(normal, camera.eye)];
    });
    if (entrance) planes.push([...entrance.normal, -dot(entrance.normal, entrance.origin)]);
    return planes;
  }
  function bounds(value) {
    if (!xyz(value?.min) || !xyz(value.max) || value.min.some((v, axis) => v > value.max[axis]))
      throw new TypeError('Streaming chunks need ordered finite XYZ bounds');
    return Object.freeze({ min: Object.freeze(value.min.slice()), max: Object.freeze(value.max.slice()) });
  }
  function visible({ min, max }, planes) {
    return planes.every(([a, b, c, d]) =>
      d + a*(a < 0 ? min[0] : max[0]) + b*(b < 0 ? min[1] : max[1]) + c*(c < 0 ? min[2] : max[2]) >= -1e-7);
  }
  function distance({ min, max }, point) {
    return Math.hypot(...point.map((value, axis) => Math.max(min[axis] - value, value - max[axis], 0)));
  }
  function clip(polygon, plane) {
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const v = planeValue(plane, a), w = planeValue(plane, b);
      if (v >= 0) clipped.push(a);
      if ((v >= 0) !== (w >= 0)) clipped.push(V.mad(a, sub(b, a), v / (v - w)));
    }
    return clipped;
  }
  function aperture(camera, opening) {
    if (typeof opening?.camera !== 'function' || !opening.from || !opening.to ||
        !(opening.halfWidth > 0) || !(opening.halfHeight > 0))
      throw new TypeError('Streaming portal views need an oriented doorway');
    const { origin, normal, right, up } = opening.from;
    const front = camera.ortho ? dot(camera.back, normal) : dot(sub(camera.eye, origin), normal);
    if (front <= (camera.ortho ? 1e-7 : 1e-6)) return null;
    // The rectangle also conservatively encloses an elliptical opening.
    const corners = [[-1,-1], [1,-1], [1,1], [-1,1]].map(([x, y]) => {
      const p = sub(V.mad(V.mad(origin, right, x * opening.halfWidth), up, y * opening.halfHeight), camera.eye);
      return [dot(p, camera.right), dot(p, camera.up), -dot(p, camera.back)];
    });
    const polygon = localPlanes(camera, screen).reduce(clip, corners);
    if (polygon.length < 3) return null;
    const projected = polygon.map(([x, y, z]) => {
      const scale = camera.tangent * (camera.ortho ? 1 : z);
      return [x / (scale * camera.aspect), y / scale];
    });
    const area = Math.abs(projected.reduce((sum, [x, y], i) => {
      const [a, b] = projected[(i + 1) % projected.length];
      return sum + x*b - y*a;
    }, 0)) / 8;
    if (area <= 1e-9) return null;
    const x = projected.map(p => p[0]), y = projected.map(p => p[1]);
    return { area, window: Object.freeze([Math.min(...x), Math.max(...x), Math.min(...y), Math.max(...y)]) };
  }

  K.procedural.chunks.visibility = Object.freeze({ camera, bounds, frustum, visible, distance, aperture, screen });
})(KIT);
