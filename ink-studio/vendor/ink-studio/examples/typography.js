/* The shape of words: original outlines, native SDF lettering and live bitmap surfaces. */
function typographySpecimen(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface } = kit,
    { typography: T, V } = K;
  const colors = [
    0x080f21, 0x142b48, 0x235277, 0x438db0, 0x93cee0, 0xe3f3ed, 0x4c2925, 0x9e5839, 0xe39b58, 0xffcb80, 0xffe5ae
  ];
  const B = makeBuilder(29, colors),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S);
  S.pixel = true;
  S.pixelSize(52);
  S.sun = V.norm([-0.6, 0.9, 1]);
  S.amb = 0.23;
  S.sky = 0.26;
  S.sunK = 0.8;
  S.wob = 0.015;
  const ink = { r: [0, 1, 2] },
    blue = { r: [1, 2, 3, 4] },
    gold = { r: [6, 7, 8, 9, 10] },
    light = { r: [3, 4, 5] };
  // A stepped specimen plinth, finely ribbed faces and brass registration marks.
  S.box([0, -0.18, 0], [5.7, 0.22, 3.15], ink, { res: 0.16, rd: 0.12 });
  S.box([0, 0.1, 0], [5.3, 0.12, 2.8], blue, { res: 0.13, rd: 0.09 });
  S.box([0, 0.28, 0.05], [4.95, 0.08, 2.5], ink, { res: 0.13, rd: 0.06 });
  for (let i = 0; i < 23; i++) {
    const x = -4.8 + i * 0.435;
    S.box([x, -0.18, 3.16], [0.012, 0.13, 0.018], i % 5 === 0 ? gold : blue, { res: 0.035 });
  }
  for (const x of [-4.5, 4.5]) {
    S.box([x, 0.48, 0], [0.29, 0.12, 1.65], blue, { res: 0.08, rd: 0.04 });
    for (const z of [-1.6, 1.6]) {
      S.tube(
        [
          [x, 0.515, z],
          [x, 1.165, z]
        ],
        0.075,
        0.075,
        gold,
        { res: 0.06 }
      );
      S.ball([x, 1.22, z], [0.105, 0.105, 0.105], light, { res: 0.055 });
    }
  }
  const run = T.layout('FORM', { size: 2.75, align: 'center', tracking: 0.12 }),
    base = [0, 1.25, 0.65],
    settings = { wave: 0.45, held: false, outline: true },
    state = { time: 0, writeStart: -10, scrambleStart: -10, detached: false };
  const title = T.extrude(B, S, run, {
    id: 'specimen',
    rig,
    position: base,
    depth: 0.47,
    res: 0.056,
    material: g => (g.index % 2 ? { r: [7, 8, 9, 10] } : gold)
  });
  const subtitle = T.layout('IN MOTION', { size: 0.7, align: 'center', tracking: 0.055 });
  T.extrude(B, S, subtitle, {
    id: 'subtitle',
    rig,
    position: [0, 0.48, 1.35],
    depth: 0.15,
    res: 0.043,
    material: light
  });
  const rail = K.curve.interpolate(
    [
      [-4.6, 3.8, -1.7],
      [-2.7, 4.4, -1.95],
      [0, 4.7, -2.15],
      [2.7, 4.4, -1.95],
      [4.6, 3.8, -1.7]
    ],
    { segmentsPerSpan: 24 }
  );
  S.tube(rail.points, 0.025, 0.025, blue, { res: 0.07 });
  for (const x of [-4.6, 4.6]) {
    S.tube(
      [
        [x, 0.4, -1.7],
        [x, 3.8, -1.7]
      ],
      0.032,
      0.032,
      blue,
      { res: 0.085 }
    );
    S.box([x, 0.43, -1.7], [0.26, 0.06, 0.28], gold, { res: 0.07, rd: 0.035 });
  }
  S.bake();
  const atlas = SpriteSurface.make(1024),
    bitmap = T.fonts.bitmap();
  const label = (text, at, size = 0.22, color = colors[4]) =>
    T.sprites(atlas, T.layout(text, { font: bitmap, size, align: 'center' }), { position: at, pixelsPerEm: 8, color });
  label('01 / OUTLINE → SDF', [0, 0.1, 3.18], 0.18, colors[9]);
  label('1000 UPM / INK SANS', [-2.7, 0.48, 2.5], 0.16);
  label('COUNTERS / KERNING', [2.7, 0.48, 2.5], 0.16);
  const curved = T.sprites(atlas, T.layout('LETTERS BECOME LANDSCAPES', { size: 0.46, tracking: 0.018 }), {
    color: colors[4],
    pixelsPerEm: 56
  });
  const signalRun = T.layout('MAKE IT MOVE', { font: bitmap, size: 0.27, align: 'center', tracking: 0.018 }),
    signal = T.sprites(atlas, signalRun, {
      position: [0, 3.48, 0.2],
      pixelsPerEm: 8,
      color: colors[9],
      scrambleChars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    });
  // Crisp top-facing registration print on the plinth, kept separate from the SDF body.
  const grid = atlas.reserve(160, 88, (x, y) => {
    if (x === 0 || x === 159 || y === 0 || y === 87) return colors[3];
    if ((x % 16 === 0 || y % 16 === 0) && !((x + y) % 3)) return colors[2];
    if ((x < 7 || x > 152) && (y < 7 || y > 80)) return colors[8];
    return colors[0];
  });
  atlas.faceRegion([-4.8, 0.375, 2.35], [9.6, 0, 0], [0, 0, -4.8], grid);
  const glyphPose = t =>
    T.pose(run, t, {
      position: base,
      writeOn: { start: state.writeStart, duration: 0.7, stagger: 0.18 },
      transform: (g, time) => ({
        position: [
          0,
          settings.wave * 0.22 * Math.sin(time * 1.5 + g.index * 0.8),
          settings.wave * 0.08 * Math.cos(time + g.index)
        ],
        rotation: [
          0,
          settings.wave * 0.12 * Math.sin(time + g.index),
          settings.wave * 0.045 * Math.sin(time * 1.5 + g.index)
        ]
      })
    });
  const traces = K.frameSplats(B, 2600, (draw, dt, t) => {
    if (!settings.outline) return;
    for (const f of T.outlineStrokes(run, t, {
      position: base,
      writeOn: { start: state.writeStart, duration: 0.7, stagger: 0.18 },
      transform: (g, time) => ({
        position: [
          0,
          settings.wave * 0.22 * Math.sin(time * 1.5 + g.index * 0.8),
          0.25 + settings.wave * 0.08 * Math.cos(time + g.index)
        ],
        rotation: [
          0,
          settings.wave * 0.12 * Math.sin(time + g.index),
          settings.wave * 0.045 * Math.sin(time * 1.5 + g.index)
        ]
      })
    })) {
      // During write-on this is the actual partial contour, including separate counters.
      if (t - state.writeStart > 2) continue;
      for (const stroke of f.strokes)
        for (let i = 1; i < stroke.length; i++) {
          const a = stroke[i - 1],
            b = stroke[i],
            segments = Math.max(1, Math.ceil(V.dist(a, b) / 0.06));
          // Bound Gaussian support along straight contour edges as well as curves.
          for (let j = 0; j < segments; j++)
            draw.streak(V.lerp(a, b, j / segments), V.lerp(a, b, (j + 1) / segments), {
              width: 0.012,
              color: 10,
              density: 3,
              depth: true
            });
        }
    }
    for (let i = 0; i < 9; i++) {
      const f = rail.frame(((i + 0.5) * rail.length) / 9);
      draw.streak(V.mad(f.p, f.N, -0.09), V.mad(f.p, f.N, 0.09), { width: 0.009, color: 8, density: 2, depth: true });
    }
  });
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 2, 0], yaw: 0.24, pitch: 0.18, dist: 15.7, focalLength: 32 };
  world.radius = 18;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const stage = K.stage(world);
  stage.t0 = 0;
  rig.bind(stage);
  const textBinding = stage.add(title.bind(stage, { sample: glyphPose }));
  stage.add(
    curved.bind(world.spriteSurfaces, {
      sample: t => T.pose(curved.layout, t, { path: rail, fit: true, transform: g => ({ position: [0, 0.14, 0] }) })
    })
  );
  stage.add(
    signal.bind(world.spriteSurfaces, {
      sample: t =>
        T.pose(signalRun, t, {
          position: [0, 3.48, 0.2],
          scramble: { start: state.scrambleStart, duration: 1.2, stagger: 0.055, seed: 31, rate: 22 }
        })
    })
  );
  stage.add(traces);
  let matter = null;
  const createMatter = () =>
    (matter ??= stage.add(
      textBinding.materialise({
        flow: K.flow.sum(K.flow.wind([0.8, 0.28, 0]), K.flow.curl(0.38, 0.22)),
        drag: 2,
        width: 0.017,
        length: 0.045,
        paths: [K.materialisation.paths.arc({ height: 0.7 })]
      })
    ));
  // Prepare the real carrier binding while building the scene, and retain it
  // between releases. Reallocating thousands of particle records on a button
  // click, then disposing/restoring the entire surface again on arrival, stalls
  // otherwise smooth simulation frames.
  createMatter();
  stage.update(0, 0);
  const control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.7 });
  control.update(0, 0);
  return {
    world,
    stage,
    settings,
    state,
    run,
    title,
    get matter() {
      return matter;
    },
    control,
    rail,
    update(dt) {
      if (!settings.held) {
        state.time += dt;
        stage.update(dt, state.time);
      }
      control.update(dt, state.time);
      return world;
    },
    write() {
      if (matter && matter.stats.home !== title.ids.length) {
        matter.dispose();
        matter = null;
      }
      createMatter();
      settings.held = false;
      state.detached = false;
      state.writeStart = state.time;
    },
    scramble() {
      settings.held = false;
      state.scrambleStart = state.time;
    },
    materialise() {
      settings.held = false;
      createMatter();
      if (state.detached) {
        matter.rejoin({ duration: 1.9, stagger: 0.25 });
        state.detached = false;
      } else {
        matter.release({ velocity: [0.4, 0.2, 0], normalImpulse: 0.3, stagger: 0.85 });
        state.detached = true;
      }
    },
    seek(t) {
      state.time = t;
      settings.held = true;
      stage.update(0, t);
    },
    inspect: () => ({
      time: state.time,
      glyphs: run.glyphs.length,
      splats: title.ids.length,
      materialisation: matter?.stats,
      poses: textBinding.inspect()
    })
  };
}
if (typeof module !== 'undefined') module.exports = typographySpecimen;
