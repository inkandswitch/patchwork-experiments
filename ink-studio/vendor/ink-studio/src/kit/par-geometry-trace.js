/* Bounded standalone signed-field rendering on the native art camera grid. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, V = K.V;
  const { integer, range, pixels, color, sdfExtent, sdfSampler } = P.sceneGraphSupport;
  const clamp = n => Math.max(0, Math.min(1, n));

  function rasterFrame({ w, h, rgb, alpha }) {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      data[j] = rgb[i * 3];
      data[j + 1] = rgb[i * 3 + 1];
      data[j + 2] = rgb[i * 3 + 2];
      data[j + 3] = alpha?.[i] ?? 255;
    }
    return { width: w, height: h, channels: 4, data };
  }

  function sdfRender(source, { width = 128, height = 128, time = 0, camera, lights = [], bounds,
    color: tint = '#b88964', background = '#171e31', transparent = false, steps = 104, epsilon,
    stepScale = .76, shades = 8, shadows = true } = {}) {
    const size = pixels(width, height, 524288), domain = sdfExtent(source, bounds);
    const radius = V.dist(domain.min, domain.max) / 2;
    epsilon ??= Math.min(.0012, radius / Math.max(width, height) * .28);
    if (!integer(steps, 4, 256) || !range(epsilon, 1e-9, radius * .25) || !range(stepScale, .001, 1) ||
        !integer(shades, 0, 256) || typeof transparent !== 'boolean' || typeof shadows !== 'boolean' ||
        size * steps > 36e6) throw new RangeError('Signed-field render exceeds its settings or work budget');
    const sample = sdfSampler(source, time), target = V.lerp(domain.min, domain.max, .5);
    const perspective = A.camera({ target, dist: Math.max(.6, radius * 3.7), yaw: .42, pitch: .25, ...camera });
    const view = CameraLens.frame({ cam: perspective, radius }, { t: time }, width, height);
    const focal = height / (2 * view.tangent * (view.ortho ? view.dist : 1));
    const rays = CameraLens.rays(view.view, view.pose.eye, width, height, focal, view.ortho);
    const illumination = A.lightOptions(lights);
    const sun = illumination.liveSun ?? A.light('sun').settings;
    const locals = AreaLights.prepare(illumination.areaLights, { time });
    if (size * steps * (2 + locals.length) > 84e6) throw new RangeError('Signed-field lights exceed the ray work budget');
    const base = color(tint), backdrop = color(background).map(n => Math.round(n * 255));
    const rgb = new Uint8Array(size * 3), alpha = transparent ? new Uint8Array(size) : undefined;
    const coverage = new Float32Array(size), depth = new Float32Array(size).fill(Infinity);
    const normal = new Float32Array(size * 3), position = new Float32Array(size * 3);
    const objectId = new Uint32Array(size), materialId = new Uint32Array(size);

    let queries = 0, hits = 0;
    function trace(origin, direction, start, end) {
      const span = [start, end];
      for (let axis = 0; axis < 3; axis++) if (!SceneOptics.slab(span, origin[axis], direction[axis],
        domain.min[axis] - epsilon, domain.max[axis] + epsilon)) return Infinity;
      let distance = span[0];
      for (let step = 0; step < steps && distance <= span[1]; step++) {
        const sd = sample(origin[0] + distance * direction[0], origin[1] + distance * direction[1], origin[2] + distance * direction[2]);
        queries++;
        if (Math.abs(sd) <= epsilon) return distance;
        distance += Math.max(epsilon * .3, Math.abs(sd) * stepScale);
      }
      return Infinity;
    }

    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const { origin, direction, axial } = rays(x + .5, height - y - .5);
      const at = trace(origin, direction, view.clipNear / axial, view.clipFar / axial);
      if (!Number.isFinite(at)) {
        if (!transparent) rgb.set(backdrop, p * 3);
        continue;
      }
      const point = V.mad(origin, direction, at), [u, v, w] = point;
      const n = V.norm([sample(u + epsilon, v, w) - sample(u - epsilon, v, w),
        sample(u, v + epsilon, w) - sample(u, v - epsilon, w), sample(u, v, w + epsilon) - sample(u, v, w - epsilon)],
      V.mul(direction, -1));
      const originBias = V.mad(point, n, epsilon * 5), sunDot = Math.max(0, V.dot(n, sun.direction));
      const visible = sunDot > 0 && (!shadows || !sun.shadows ||
        trace(originBias, sun.direction, 0, radius * 2.5) === Infinity);
      const level = sun.ambient + (visible ? sun.intensity * sunDot : 0), lit = [level, level, level];
      for (const light of locals) {
        const delta = V.sub(light.at, point), range = V.len(delta);
        if (range < 1e-7 || range >= light.radius) continue;
        const heading = V.mul(delta, 1 / range);
        let facing = V.dot(n, heading);
        if (light.shape !== 'line') {
          const incidence = -V.dot(light.normal, heading);
          facing *= Math.max(0, light.twoSided ? Math.abs(incidence) : incidence);
        }
        if (facing <= 0 || shadows && light.shadows && trace(originBias, heading, 0, range - epsilon * 2) < Infinity) continue;
        const gain = facing * (1 - range / light.radius) ** 2 * light.intensity;
        for (let i = 0; i < 3; i++) lit[i] += gain * light.rgb[i];
      }
      for (let i = 0; i < 3; i++) {
        const resolved = shades > 1 ? Math.round(clamp(lit[i]) * (shades - 1)) / (shades - 1) : clamp(lit[i]);
        rgb[p * 3 + i] = Math.round(255 * clamp(base[i] * (.23 + resolved * 1.05)));
      }
      hits++;
      if (alpha) alpha[p] = 255;
      coverage[p] = 1;
      depth[p] = at * axial;
      position.set(point, p * 3);
      normal.set(n, p * 3);
      objectId[p] = materialId[p] = 1;
    }
    const objects = ['', 'signed-field'], materials = ['', 'signed-field'];
    const frame = { w: width, h: height, rgb, ...(alpha && { alpha }), passes: {
      w: width, h: height, coverage, depth, normal, position, objectPosition: position, objectId, materialId, objects, materials
    } };
    return { value: rasterFrame(frame), frame, report: { width, height, hits, queries, projection: view.ortho ? 'orthographic' : 'perspective' } };
  }

  Object.assign(A, { renderSDF: sdfRender, rasterFrame });
})(KIT);
