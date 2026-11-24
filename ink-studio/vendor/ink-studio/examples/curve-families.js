/* One bounded curve drives the sculpture, route, particles, typography and camera. */
function curveConservatory(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    C = K.curve,
    V = K.V;
  const specs = [
    { name: 'Torus knot', type: 'torusKnot', p: 2, q: 3, segments: 192, axis: [0, 0, 1] },
    {
      name: 'Euler transition',
      type: 'clothoid',
      axis: [0, 0, 1],
      sections: [
        { length: 2, curvature: 0 },
        { length: 3, curvature: 0.65 },
        { length: 2, curvature: 0.65 },
        { length: 3, curvature: 0 }
      ],
      segments: 144
    },
    { name: 'Lissajous', type: 'lissajous', segments: 192, axis: [0, 0, 1] },
    { name: 'Logarithmic spiral', type: 'logSpiral', turns: 2.2, height: 0.65, axis: [0, 0, 1], segments: 160 },
    { name: 'Superellipse', type: 'superellipse', exponent: 4, axis: [0, 0, 1], segments: 128 },
    { name: 'Parametric flower', type: 'flower', petals: 7, height: 0.45, axis: [0, 0, 1], segments: 224 },
    { name: 'Archimedean spiral', type: 'archimedeanSpiral', turns: 2.3, axis: [0, 0, 1] },
    { name: 'Fermat spiral', type: 'fermatSpiral', turns: 2.3, height: .32, axis: [0, 0, 1] },
    { name: 'Cycloid', type: 'cycloid', turns: 3, axis: [0, 0, 1] },
    { name: 'Epitrochoid', type: 'epitrochoid', fixedTeeth: 5, rollingTeeth: 3, pen: .65, axis: [0, 0, 1] },
    { name: 'Hypotrochoid', type: 'hypotrochoid', fixedTeeth: 7, rollingTeeth: 3, pen: .85, axis: [0, 0, 1] }
  ];
  const controls = { family: 0, ribbon: true, text: true, tracers: true, playing: true, ride: false },
    cache = new Map();
  const palette = [0x08191e, 0x102b33, 0x1c4852, 0x317c83, 0x55b8b6, 0xabe1ce, 0x5e422a, 0xa7783a, 0xe8ad54, 0xffdfa1];
  function definition(index) {
    const { name, ...base } = specs[index],
      raw = C.create(base),
      lo = [0, 1, 2].map(k => Math.min(...raw.points.map(p => p[k]))),
      hi = [0, 1, 2].map(k => Math.max(...raw.points.map(p => p[k]))),
      scale = 5.25 / Math.max(...hi.map((v, k) => v - lo[k]));
    return { ...base, scale, origin: [0, 3.05, 0].map((v, k) => v - ((lo[k] + hi[k]) * scale) / 2) };
  }
  function build() {
    const key = controls.family + ':' + controls.ribbon + ':' + controls.text;
    if (cache.has(key)) return cache.get(key);
    const path = C.create(definition(controls.family)),
      B = makeBuilder(27, palette),
      S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.pixelSize(32);
    S.box([0, -0.24, 0], [3.6, 0.3, 2.7], { r: [1, 2] }, { res: 0.16, rd: 0.18 });
    for (const x of [-3.4, 3.4]) S.box([x, 0.08, 0], [0.025, 0.025, 2.5], { r: [7, 8] }, { res: 0.055 });
    for (const z of [-2.5, 2.5]) S.box([0, 0.08, z], [3.4, 0.025, 0.025], { r: [7, 8] }, { res: 0.055 });
    for (const u of [0.06, 0.38, 0.72]) {
      const p = path.sample(u);
      if (p[1] > 0.4) {
        S.tube([[p[0], 0.06, p[2]], p], 0.025, 0.018, { r: [1, 2, 3] }, { res: 0.07 });
        S.box([p[0], 0.11, p[2]], [0.16, 0.06, 0.16], { r: [6, 7, 8] }, { res: 0.07, rd: 0.02 });
      }
    }
    K.sweep(
      S,
      path.points,
      controls.ribbon
        ? { shape: 'rect', w: 0.13, h: 0.038, round: 0.4, twist: path.closed ? 1 : 0.25 }
        : { shape: 'round', w: 0.09, h: 0.09 },
      { r: [2, 3, 4, 5] },
      { res: 0.042 }
    );
    if (controls.text) {
      const label = C.text(path, specs[controls.family].name.toUpperCase(), {
        size: 0.19,
        lift: 0.3,
        fit: true,
        maxStep: 0.055
      });
      for (const line of label.strokes) if (line.length > 1) S.tube(line, 0.012, 0.012, { r: [8, 9] }, { res: 0.032 });
    }
    for (let d = 0; d < path.length; d += 0.35) {
      const f = path.frame(d);
      S.ball(V.mad(f.p, f.B, -0.18), [0.022, 0.022, 0.022], { r: [7, 8] }, { res: 0.04 });
    }
    S.bake();
    let atlas;
    if (SpriteSurface && TexturedSurface) {
      atlas = SpriteSurface.make(256);
      atlas.mesh(
        TexturedSurface.heightfield({ bounds: [-3.4, 3.4, -2.5, 2.5], segments: [1, 1], height: () => 0.075 }),
        224,
        160,
        (x, y) => palette[x % 16 === 0 || y % 16 === 0 ? 2 : (x + y) % 43 === 0 ? 3 : 1]
      );
    }
    const route = K.anim.route(path, { speed: 1.8, mode: path.closed ? 'loop' : 'pingpong' }),
      pool = K.pool(B, 96);
    const movers = K.frameSplats(B, 40, (draw, dt, t) => {
      for (let i = 0; i < 4; i++) {
        const pose = route.vehicle(t + i * 0.36);
        draw.streak(V.mad(pose.p, pose.tan, -0.09), V.mad(pose.p, pose.tan, 0.09), {
          width: 0.055,
          color: i ? 8 : 9,
          depth: true
        });
      }
    });
    const world = B.finish({ ...(atlas && { spriteSurfaces: atlas.finish() }) });
    world.cam = { target: [0, 2.4, 0], dist: 13.5, yaw: 0.33, pitch: 0.3 };
    world.radius = 7;
    world.look = { pixelSize: 2, clean: 1 };
    world.fog = { c: 0, start: 1, max: 0 };
    const stage = K.stage(world),
      ps = K.particles(stage, pool);
    stage.add(movers);
    stage.add(ps);
    const camDef = path.snapshot();
    camDef.origin = V.add(camDef.origin, [0, 0.65, 1]);
    const rig = K.cameraRig.compile({
      rails: { track: { family: camDef } },
      shots: {
        follow: {
          target: [0, 3, 0],
          rail: 'track',
          progress: [
            { time: 0, value: 0 },
            { time: 16, value: 1 }
          ]
        }
      }
    });
    const out = { world, path, route, stage, ps, rig };
    cache.set(key, out);
    return out;
  }
  let current = build(),
    time = 0,
    emission = 0;
  return {
    controls,
    specs,
    get current() {
      return current;
    },
    get time() {
      return time;
    },
    select() {
      current = build();
      current.stage.t0 = 0;
    },
    update(dt) {
      if (controls.playing) {
        time += dt;
        if (controls.tracers) {
          emission += dt;
          while (emission > 0.03) {
            emission -= 0.03;
            const f = current.route.vehicle(time);
            current.ps.emit({
              p: f.p,
              v: V.mul(f.tan, 0.55),
              life: 0.7,
              size: 0.017,
              cols: [9, 8, 7],
              fade: 0.7,
              drag: 0.2
            });
          }
        }
        current.stage.update(dt, time);
      }
      return current.world;
    },
    camera() {
      return controls.ride ? current.rig.sample(time % 16).camera : null;
    }
  };
}
if (typeof module !== 'undefined') module.exports = curveConservatory;
