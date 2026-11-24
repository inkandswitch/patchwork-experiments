/* A moving scanner deposits pigment in a wall chart and ionizes the air in front of it. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'persistent-spatial-fields',
  name: 'Trace Harbor',
  seed: 38,
  build(seed, { controls } = {}) {
    const palette = [
      0x050915, 0x0b1424, 0x122137, 0x1c3049, 0x2d4b61, 0x43697b, 0x659aa3,
      0x2c2537, 0x573646, 0x9c554c, 0xe27353, 0xfcb678, 0xffecc0,
      0x20365c, 0x305185, 0x356ea4, 0x34aab7, 0x60e4dd, 0xc6fff0
    ];
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.pixelSize(26);
    Object.assign(S, { sun: K.V.norm([-.65, .65, .52]), amb: .35, sky: .18, sunK: .75, aoK: .34 });

    const keys = [
      [.55, -2.65, 1.13], [1.05, -1.92, 1.32], [1.59, -.9, 1.79],
      [2.11, .34, 2.34], [2.62, 1.69, 2.57], [3.04, 3.27, 2.34],
      [3.47, 2.65, 1.31], [3.96, 1.49, 1.58], [4.40, .55, 2.21],
      [4.78, .37, 2.4], [5.2, .61, 2.35], [5.60, 1.54, 2.68]
    ];
    const start = keys[0][0], end = keys.at(-1)[0];
    const target = time => K.anim.poseAt(time, keys);
    const depositKeys = Array.from({ length: 97 }, (_, i) => {
      const time = K.mix(start, end, i / 96);
      return [time, ...target(time)];
    });
    const wall = K.deposition.create({
      bounds: { min: [-4.5, .18], max: [4.6, 3.8] },
      counts: [140, 64],
      channels: { trace: { decay: .47, diffusion: .019 } }
    });
    const air = K.deposition.create({
      bounds: { min: [-3.8, .7, .12], max: [3.9, 3.29, 1.18] },
      counts: [38, 16, 10],
      channels: { ions: { decay: 1.7, diffusion: .018 } }
    });
    const enabled = controls?.field !== false;
    if (enabled) {
      wall.stroke({ keys: depositKeys, interval: .055, sigma: .22, values: { trace: 3.7 } });
      air.stroke({ keys: depositKeys.map(([t, x, y]) => [t, x, y, .45 + .18 * Math.sin(2 * t)]),
        interval: .07, sigma: .16, lifetime: 2.3, values: { ions: 2.8 } });
    }

    const scan = {
      type: 'projected', space: 'world', field: 'wall',
      projection: { along: [1, 0, 0], across: [0, 1, 0] },
      maskChannel: 'trace'
    };
    const ceramic = K.surface.material(K.pixel.masonry({
      r: [1, 2, 3, 4], joint: 1, stone: [12, 7], seed
    }), { name: 'signal ceramic', layers: {
      glow: { ...scan, pattern: 'solid', range: [.025, .83], colors: [13, 14, 15, 16],
        outputPalette: [1, 2, 3, 4, 13, 14, 15, 16] },
      contours: { ...scan, pattern: 'contour', contourChannel: 'trace', range: [.065, .33],
        scale: .245, width: .32, colors: [15, 16, 17, 18], outputPalette: [13, 14, 15, 16, 17, 18], ink: true }
    } });
    const steel = { r: [1, 2, 3, 4, 5] };
    const stone = K.pixel.masonry({ r: [0, 1, 2, 3, 4], joint: 1, stone: [9, 6], seed: seed + 1 });
    const copper = { r: [7, 8, 9, 10] };
    const lamp = { r: [9, 10, 11, 12], em: true };
    const marker = { r: [4, 5, 6, 16], em: true };

    S.box([0, -.12, -.18], [5.8, .22, 2.4], stone, { rd: .095, res: .15 });
    S.box([.05, 1.9, -.54], [4.63, 1.93, .34], steel, { rd: .12, res: .105 });
    for (const x of [-3.33, -1.1, 1.13, 3.36]) {
      S.box([x, 1.86, -.135], [1.067, 1.44, .17], ceramic, { rd: .065, res: .067 });
      S.box([x, .43, .15], [1.07, .06, .14], steel, { rd: .035, res: .078 });
      S.box([x, 3.39, .075], [1.075, .116, .14], steel, { rd: .045, res: .08 });
      for (const dx of [-.72, -.53, -.34]) {
        S.box([x + dx, 3.418, .229], [.042, .016, .024], dx === -.72 ? lamp : marker, { res: .033 });
      }
    }

    for (const x of [-4.58, -2.23, 0, 2.23, 4.58]) {
      S.box([x, 1.87, .027], [.052, 1.56, .145], steel, { res: .067, rd: .025 });
      for (const y of [.67, 1.15, 2.72, 3.1])
        S.box([x, y, .207], [.075, .032, .037], copper, { res: .047, rd: .012 });
    }
    S.box([0, 3.73, -.15], [4.72, .15, .62], steel, { rd: .09, res: .11 });
    S.box([0, 3.71, .468], [4.63, .021, .042], copper, { res: .102, rd: .014 });
    S.box([0, 3.88, -.4], [4.6, .12, .48], stone, { rd: .045, res: .12 });
    for (const x of [-3.57, -.94, 1.83, 3.69]) {
      const height = .85 + .7 * Math.abs(Math.sin(x * 1.8));
      S.box([x, 3.84 + height / 2, -1.04], [.39, height / 2, .46], stone, { rd: .05, res: .11 });
      for (let i = 0; i < 3; i++) {
        S.box([x + .15, 4.04 + i * .13, -.558], [.1, .026, .022], i === 0 ? lamp : copper, { res: .045 });
      }
    }

    for (const side of [-1, 1]) {
      const x = 5.23 * side;
      S.box([x, 1.57, -.27], [.35, 1.63, .52], stone, { rd: .08, res: .112 });
      S.box([x, .14, .58], [.58, .29, .83], steel, { rd: .10, res: .11 });
      S.box([x, 2.65, .348], [.166, .34, .11], copper, { rd: .074, res: .07 });
      S.box([x, 2.67, .473], [.06, .191, .052], lamp, { rd: .034, res: .048 });
      for (const y of [.64, .84, 1.04, 1.24]) {
        S.box([x, y, .295], [.18, .027, .048], steel, { res: .07, rd: .013 });
      }
    }

    for (let i = -10; i <= 10; i++) {
      const x = i * .53;
      S.box([x, .105, 1.82], [.248, .06, .167], i % 5 ? steel : copper, { rd: .027, res: .095 });
      if (i % 2 === 0) S.box([x, .148, 1.67], [.067, .018, .03], lamp, { res: .04 });
    }
    S.tube([[-5.58, .13, 1.55], [5.58, .13, 1.55]], .031, .03, copper, { res: .101 });
    S.tube([[-4.91, .3, .6], [-4.85, .5, .44], [-4.85, 2.04, .44], [-4.73, 2.15, .27]],
      .063, .055, copper, { res: .067 });
    S.bake();

    const scanSplat = K.frameSplats(B, 274, (draw, _dt, time) => {
      const [x, y] = target(time);
      const hit = [x, y, .081];
      const eye = [-4.47 + .14 * Math.sin(time * .7), 4.30 + .12 * Math.sin(time * 2.2), 1.23];
      const warm = [1, .50, .27], bright = [1, .83, .52], cyan = [.42, 1, .92];
      const power = K.clamp(Math.min((time - start) * 7, (end - time) * 7), 0, 1);
      for (const side of [-1, 1]) {
        let a = [eye[0] - .57, eye[1], eye[2]];
        for (let i = 1; i <= 22; i++) {
          const t = i / 22, b = [eye[0] + (t - .5) * 1.14, eye[1] + side * Math.sin(Math.PI * t) * .23, eye[2]];
          draw.streak(a, b, { rgb: i % 5 === 0 ? bright : warm, width: .015, density: .43 + .15 * power });
          a = b;
        }
      }
      const iris = [eye[0] + .19 * Math.tanh((x - eye[0]) * .22), eye[1] - .062, eye[2] + .018];
      for (let i = 0; i < 22; i++) {
        const angle = Math.PI * 2 * i / 22;
        draw.point([iris[0] + .144 * Math.cos(angle), iris[1] + .144 * Math.sin(angle), iris[2]],
          { rgb: i % 4 === 0 ? cyan : bright, width: .016, density: .38 + .25 * power });
      }
      draw.point(iris, { rgb: warm, width: .044, density: .75 });

      if (power > 0) {
        for (let i = 0; i < 20; i++) {
          const u = i / 20, u2 = (i + .64) / 20;
          const flicker = .5 + .5 * Math.sin(i * 1.3 - time * 26);
          draw.streak(K.V.lerp(iris, hit, u), K.V.lerp(iris, hit, u2), {
            rgb: i < 9 ? warm : cyan, width: .013, density: (.10 + .24 * flicker) * power, depth: false
          });
        }
        draw.point(hit, { rgb: [.74, 1, .94], width: .047, density: 1.2 * power });
        for (let i = 0; i < 4; i++) {
          const angle = Math.PI * i / 2;
          draw.streak(K.V.add(hit, [.085 * Math.cos(angle), .085 * Math.sin(angle), .018]),
            K.V.add(hit, [.15 * Math.cos(angle), .15 * Math.sin(angle), .018]),
            { rgb: cyan, width: .012, density: .63 * power });
        }
      }

      const cloud = air.frame(time), random = K.grow.dice(seed ^ 481);
      for (let i = 0; i < 100; i++) {
        const sample = cloud.pick('ions', random, { threshold: .035 });
        if (!sample) break;
        const [px, py, pz] = sample.at;
        const offset = i * 2.399;
        draw.point([px + .065 * Math.sin(offset + time * 3), py + .064 * Math.cos(offset + time * 1.9), pz],
          { width: i % 12 === 0 ? .022 : .014, rgb: i % 9 === 0 ? bright : cyan,
            density: Math.min(.69, sample.value * 1.42) * (.48 + .48 * Math.sin(offset + time * 8) ** 2), depth: true });
      }
    });

    const world = B.finish({
      cam: { target: [-.12, 2.28, .02], dist: 12.7, yaw: -.13, pitch: .16, fov: .64, sway: 0 },
      radius: 9, detail: 28, dither: .18, look: { pixelSize: 2, splatCoverage: 'continuous' },
      surfaceEffects: { fields: { wall } }
    });
    K.stage(world).add(scanSplat);
    return world;
  }
});
