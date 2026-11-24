/* The material atelier: native SDF objects, crisp atlas print and live finishes. */
function materialAtelier({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const colors = [
    0x070e18, 0x101e2c, 0x1b3041, 0x2d495a, 0x466373, 0x67818c, 0x8ea6ac, 0x183444, 0x245569, 0x387b91, 0x69a5b6,
    0xa0c9d0, 0xe0ece5, 0x39221f, 0x653729, 0x995538, 0xc57d49, 0xeab16d, 0xffd99a, 0xffedc6
  ];
  const B = makeBuilder(83, colors),
    S = K.sculpt(makeSculpt(B));
  Object.assign(S, { pixel: true, sun: K.V.norm([-0.55, 0.75, 1]), amb: 0.28, sky: 0.3, sunK: 0.8 });
  S.pixelSize(56);
  const stone = { r: [1, 2, 3, 4] },
    trim = { r: [13, 14, 15, 16, 17] },
    ink = { r: [0, 1, 2] },
    porcelain = { r: [7, 8, 9, 10, 11, 12] };
  const recipes = {
    ceramic: { roughness: 0.72, metalness: 0, ior: 1.5, coating: { weight: 0.9, roughness: 0.08 } },
    bronze: { roughness: [0.12, 0.48], metalness: 1, ior: 1.5, coating: 0.15 },
    glass: { roughness: 0.1, metalness: 0, ior: 1.52, transmission: 1, thickness: 0.12 }
  };
  const controlled = (name, r) => K.material.apply({ r, materialId: name, surface: { name } }, recipes[name]);
  const ceramic = controlled('ceramic', porcelain.r),
    bronze = controlled('bronze', [13, 14, 15, 16, 17, 18]),
    glass = controlled('glass', [7, 8, 9, 10, 11]);
  S.box([0, -0.2, 0], [5.8, 0.24, 3.1], ink, { res: 0.15, rd: 0.15 });
  S.box([0, 0.065, 0], [5.5, 0.075, 2.85], stone, { res: 0.115, rd: 0.08 });
  for (const x of [-3.25, 0, 3.25]) {
    S.box([x, 0.27, -0.2], [1.23, 0.13, 1.25], stone, { res: 0.1, rd: 0.07 });
    S.box([x, 0.415, -0.2], [1.12, 0.025, 1.15], trim, { res: 0.075, rd: 0.025 });
  }
  S.lathe(
    [-3.25, 0.45, -0.3],
    1.95,
    t => 0.46 + 0.25 * Math.sin(Math.PI * t) - 0.2 * Math.exp(-(((t - 0.87) / 0.12) ** 2)),
    ceramic,
    { res: 0.047 }
  );
  S.torus([-3.25, 2.4, -0.3], 0.46, 0.035, ceramic, { res: 0.04 });
  S.torus([0, 1.45, -0.3], 0.79, 0.205, bronze, { res: 0.046, ax: S.AZ });
  S.ball([0, 1.45, -0.3], 0.39, bronze, { res: 0.046 });
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const mat = (x + y) % 2 ? { r: [17, 18, 19] } : { r: [1, 2, 3] };
      S.box([2.45 + x * 0.265, 0.63 + y * 0.265, -0.58], [0.124, 0.124, 0.035], mat, { res: 0.075 });
    }
  S.box([3.25, 1.45, 0.1], [0.97, 0.97, 0.045], glass, { res: 0.047, rd: 0.08, ghost: true });
  for (const x of [2.2, 4.3]) S.box([x, 1.4, -0.48], [0.035, 1.01, 0.045], trim, { res: 0.05 });
  S.box([3.25, 2.43, -0.48], [1.085, 0.035, 0.045], trim, { res: 0.05 });
  const samples = [
    { roughness: 0.92 },
    { roughness: 0.08 },
    { roughness: 0.15, metalness: 1 },
    { roughness: [0.09, 0.62], metalness: 1 },
    { roughness: 0.7, coating: 1 },
    { roughness: 0.12, transmission: 0.8, ior: 1.7 }
  ];
  for (let i = 0; i < 6; i++) {
    const x = -4.6 + i * 1.84;
    S.lathe([x, 0.16, 1.88], 0.15, 0.41, stone, { res: 0.07 });
    S.ball(
      [x, 0.64, 1.88],
      0.31,
      K.material.apply(
        { r: i === 2 || i === 3 ? [14, 15, 16, 17, 18] : [7, 8, 9, 10, 11, 12], surface: { name: 'sample-' + i } },
        samples[i]
      ),
      { res: 0.055, ghost: i === 5 }
    );
  }
  for (let x = -5.1; x <= 5.1; x += 0.34) S.box([x, -0.2, 3.11], [0.008, 0.12, 0.012], trim, { res: 0.035 });
  S.bake();
  const atlas = SpriteSurface.make(1024),
    font = K.typography.fonts.bitmap();
  function label(text, at, size = 0.18, c = colors[11]) {
    K.typography.sprites(atlas, K.typography.layout(text, { font, size, align: 'center' }), {
      position: at,
      color: c,
      pixelsPerEm: 8
    });
  }
  label('PORCELAIN', [-3.25, 2.72, -0.18], 0.28);
  label('BRONZE', [0, 2.72, -0.18], 0.28, colors[18]);
  label('GLASS', [3.25, 2.72, -0.18], 0.28);
  ['MATTE', 'POLISHED', 'METAL', 'GRAIN', 'COATED', 'CLEAR'].forEach((s, i) =>
    label(s, [-4.6 + i * 1.84, 0.19, 2.54], 0.23)
  );
  label('MATERIAL / ATELIER', [0, -0.19, 3.13], 0.28, colors[17]);
  const world = B.finish({
    spriteSurfaces: atlas.finish(),
    look: { pixel: true, pixelSize: 2, clean: 1, splatCoverage: 'continuous' },
    dither: 0.1,
    cam: { target: [0, 1.25, 0.1], yaw: 0.2, pitch: 0.29, dist: 15, focalLength: 34 },
    radius: 15,
    fog: { c: 0, start: 1, max: 0 }
  });
  const bindings = Object.fromEntries(
    Object.keys(recipes).map(name => [
      name,
      world.surfaces.flatMap((s, i) => (s.settings.name === name ? [i + 1] : []))
    ])
  );
  const settings = { selected: 'ceramic', animate: true, finish: true },
    state = { time: 0, angle: -28 },
    control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.6 });
  control.update(0, 0);
  return {
    world,
    settings,
    state,
    bindings,
    recipes,
    control,
    get controls() {
      return world.surfaces[bindings[settings.selected][0] - 1].settings.materialControls;
    },
    change(patch) {
      for (const id of bindings[settings.selected]) K.material.update(world, id, patch);
    },
    reset() {
      for (const id of bindings[settings.selected])
        K.material.update(world, id, recipes[settings.selected], { replace: true });
    },
    update(dt) {
      if (settings.animate) state.time += dt;
      control.update(dt, state.time);
      return world;
    },
    light() {
      const a = ((settings.animate ? state.angle + 22 * Math.sin(state.time * 0.55) : state.angle) * Math.PI) / 180;
      return K.V.norm([Math.sin(a), 0.65, Math.cos(a)]);
    },
    inspect() {
      return { bindings, selected: settings.selected, ...K.material.inspect({ controls: this.controls }) };
    }
  };
}
if (typeof module !== 'undefined') module.exports = materialAtelier;
