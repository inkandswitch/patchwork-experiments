/* Distance analysis and quaternion frames on the same splat sculpture. */
function pathObservatory(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    { curve: C, V, Q } = K;
  const palette = [
    0x091623, 0x142b41, 0x25465b, 0x244b84, 0x3679be, 0x83c7dd, 0x633d40, 0xb6674a, 0xf0a563, 0xffdeab, 0xe5e5c8
  ];
  const controls = {
      shape: 0,
      tolerance: 0.006,
      adaptive: true,
      points: true,
      curvature: true,
      circle: true,
      playing: true,
      roll: false,
      query: [2.9, 1.45, 1]
    },
    cache = new Map();
  const names = ['Periodic ribbon', 'Euler transition', 'Torus knot'];
  const controlPoints = [
    [-2.8, 1.5, 0.1],
    [-2.7, 3, 0],
    [-1.4, 4.4, -0.5],
    [0.9, 4.5, 0.2],
    [2.6, 3.2, 0],
    [2.8, 1.3, 0.3],
    [0.6, 0.7, -0.5],
    [-1.2, 0.9, 0.2]
  ];
  const normalize = base => {
    const raw = C.create(base),
      lo = [0, 1, 2].map(k => Math.min(...raw.points.map(p => p[k]))),
      hi = [0, 1, 2].map(k => Math.max(...raw.points.map(p => p[k]))),
      scale = 5.2 / Math.max(...hi.map((v, k) => v - lo[k]));
    return { ...base, scale, origin: [0, 3, 0].map((v, k) => v - ((lo[k] + hi[k]) * scale) / 2) };
  };
  const definitions = [
    null,
    normalize({
      type: 'clothoid',
      axis: [0, 0, 1],
      sections: [
        { length: 2, curvature: 0 },
        { length: 3, curvature: 0.65 },
        { length: 2, curvature: 0.65 },
        { length: 3, curvature: 0 }
      ]
    }),
    normalize({ type: 'torusKnot', axis: [0, 0, 1] })
  ];
  const blue = { r: [2, 3, 4, 5] },
    bronze = { r: [6, 7, 8] },
    dark = { r: [1, 2] };
  const modelB = makeBuilder(32, palette),
    modelS = K.sculpt(makeSculpt(modelB));
  modelS.pixel = true;
  modelS.pixelSize(40);
  modelS.box([0, 0, 0], [0.19, 0.07, 0.09], bronze, { res: 0.035, rd: 0.025 });
  modelS.box([0.06, 0.06, 0], [0.08, 0.045, 0.07], { r: [9, 10] }, { res: 0.03, rd: 0.02 });
  modelS.box([-0.09, 0, 0], [0.04, 0.025, 0.2], blue, { res: 0.035, rd: 0.015 });
  modelS.bake();
  const drone = K.frameSplats.capture(modelB.finish());
  const roll = Q.spline(
    [0, 0.7, 1.6, 0.5, -0.6].map(a => Q.fromAxisAngle([1, 0, 0], a)),
    { closed: true }
  );
  let current,
    viewOffset = [0, 0, 0.16],
    time = 0;
  function build() {
    const key = JSON.stringify([controls.shape, controls.adaptive, controls.tolerance]);
    if (cache.has(key)) return cache.get(key);
    const adaptive = { tolerance: controls.tolerance, angle: 0.22, minSegments: 8, maxSegments: 768 };
    const path =
      controls.shape === 0
        ? C.interpolate(controlPoints, {
            closed: true,
            tension: 0.08,
            ...(controls.adaptive ? { adaptive } : { segmentsPerSpan: 4 })
          })
        : C.create({
            ...definitions[controls.shape],
            segments: 32,
            ...(controls.adaptive && { adaptive: { ...adaptive, minSegments: 24 } })
          });
    const B = makeBuilder(36, palette),
      S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.pixelSize(34);
    S.box([0, -0.22, 0], [3.6, 0.29, 2.6], dark, { res: 0.15, rd: 0.16 });
    for (const x of [-3.45, 3.45]) S.box([x, 0.075, 0], [0.018, 0.018, 2.45], bronze, { res: 0.05 });
    for (const z of [-2.45, 2.45]) S.box([0, 0.075, z], [3.45, 0.018, 0.018], bronze, { res: 0.05 });
    K.sweep(S, path.points, { shape: 'rect', w: 0.12, h: 0.042, round: 0.5, twist: path.closed ? 1 : 0.15 }, blue, {
      res: 0.042
    });
    for (const u of [0.07, 0.4, 0.71]) {
      const p = path.sample(u);
      S.tube([[p[0], 0.08, p[2]], p], 0.021, 0.016, dark, { res: 0.065 });
      S.box([p[0], 0.1, p[2]], [0.16, 0.055, 0.16], bronze, { res: 0.065, rd: 0.025 });
    }
    S.bake();
    let atlas;
    if (SpriteSurface && TexturedSurface) {
      atlas = SpriteSurface.make(256);
      atlas.mesh(
        TexturedSurface.heightfield({ bounds: [-3.4, 3.4, -2.4, 2.4], segments: [1, 1], height: () => 0.075 }),
        224,
        160,
        (x, y) => palette[x % 16 === 0 || y % 16 === 0 ? 2 : 1]
      );
    }
    const samples = [],
      bands = [];
    let along = 0;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i],
        length = V.dist(a, b),
        k = path.curvature(along + length * 0.5);
      bands.push({ a, b, along: along + length * 0.5, k: k.value ?? 0 });
      samples.push({ along, k: k.value ?? 0 });
      along += length;
    }
    const maximum = Math.max(0.1, ...samples.map(s => s.k)),
      color = k => (k / maximum > 0.65 ? 9 : k / maximum > 0.3 ? 8 : k / maximum > 0.1 ? 7 : 5);
    let probe, reading;
    const frame = K.frameSplats(B, 3 * path.points.length + drone.count + 200, (draw, dt, t) => {
      if (controls.curvature)
        for (const s of bands)
          draw.streak(V.add(s.a, viewOffset), V.add(s.b, viewOffset), { width: 0.012, color: color(s.k), depth: true });
      if (controls.points)
        for (const p of path.points) draw.point(V.add(p, viewOffset), { width: 0.019, color: 9, depth: true });
      probe = path.closest(controls.query);
      reading = path.curvature(probe.along);
      const f = path.frame(probe.along);
      draw.point(controls.query, { width: 0.05, color: 10, depth: true });
      draw.point(probe.p, { width: 0.04, color: 9, depth: true });
      for (let i = 0; i < 12; i += 2)
        draw.streak(V.lerp(controls.query, probe.p, i / 12), V.lerp(controls.query, probe.p, (i + 1) / 12), {
          width: 0.011,
          color: 10,
          depth: true
        });
      draw.streak(probe.p, V.mad(probe.p, f.T, 0.6), { width: 0.016, color: 5, depth: true });
      if (reading.normal)
        draw.streak(probe.p, V.mad(probe.p, reading.normal, 0.55), { width: 0.016, color: 8, depth: true });
      if (controls.circle && reading.defined && reading.normal && reading.radius < 4) {
        const R = reading.radius,
          center = V.mad(reading.p, reading.normal, R),
          points = Array.from({ length: 65 }, (_, i) => {
            const a = (i * Math.PI) / 32;
            return V.add(center, V.add(V.mul(reading.normal, -R * Math.cos(a)), V.mul(reading.tan, R * Math.sin(a))));
          });
        for (let i = 1; i < points.length; i++)
          draw.streak(points[i - 1], points[i], { width: 0.008, color: 7, depth: true });
      }
      const u = path.closed ? (t / 13) % 1 : 1 - Math.abs(((t / 8) % 2) - 1),
        pose = path.frame(u * path.length),
        rotation = controls.roll ? Q.mul(pose.rotation, roll.sample((t / 12) % 1)) : pose.rotation;
      draw.model(drone, pose.p, { matrix: Q.toMatrix(rotation) });
    });
    const world = B.finish({ ...(atlas && { spriteSurfaces: atlas.finish() }) });
    world.cam = { target: [0, 2.5, 0], dist: 13.9, yaw: 0.24, pitch: 0.27 };
    world.radius = 7;
    world.look = { pixelSize: 2, clean: 1 };
    world.fog = { c: 0, start: 1, max: 0 };
    const stage = K.stage(world);
    stage.t0 = 0;
    stage.add(frame);
    const data = {
      path,
      world,
      stage,
      samples,
      maximum,
      get probe() {
        return probe;
      },
      get reading() {
        return reading;
      }
    };
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    cache.set(key, data);
    return data;
  }
  current = build();
  return {
    names,
    controls,
    get current() {
      return current;
    },
    get time() {
      return time;
    },
    select() {
      current = build();
    },
    update(dt, camera = current.world.cam) {
      viewOffset = V.mul(
        [
          Math.sin(camera.yaw) * Math.cos(camera.pitch),
          Math.sin(camera.pitch),
          Math.cos(camera.yaw) * Math.cos(camera.pitch)
        ],
        0.16
      );
      if (controls.playing) time += dt;
      current.stage.update(controls.playing ? dt : 0, time);
      return current.world;
    }
  };
}
if (typeof module !== 'undefined') module.exports = pathObservatory;
