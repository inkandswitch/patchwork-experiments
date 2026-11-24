/* Headless walk, dive, swim, climb and travel with one character and camera. */
module.exports = async function canalTraversal(K, makeBuilder, makeSculpt) {
  const W = K.world, P = K.procedural;
  const controller = W.characters.create({ tuning: {
    height: 0.84, radius: 0.145, stepUp: 0.24, walkSpeed: 2.7, swimSpeed: 2.1,
    jumpSpeed: 3.7, climbHeight: 0.82, climbReach: 0.54
  } });
  const rig = W.cameras.follow({ tuning: { distance: 5.2, yaw: 0.43, pitch: 0.27, height: 0.36,
    jumpRoom: 0.74, fallRoom: 0.2, snapDistance: 8 } });
  const canalPal = [0x132c36, 0x2b4349, 0x455d60, 0x5d7773, 0x8a9c81, 0xb8b487,
    0x536f65, 0x7c9a88, 0xacc3a1, 0x263e49, 0x32575d, 0x59928a, 0xda965e, 0xf7d18c, 0xffebb2];
  const courtPal = [0x232539, 0x38324b, 0x50445d, 0x6f5870, 0x946d78, 0xc5988b,
    0x4f4057, 0x71617d, 0xad8991, 0x364450, 0x486370, 0x6e9b96, 0xc58765, 0xf1bf7d, 0xffe4af];
  const canalArch = { origin: [0, 1.42, -4.85], normal: [0, 0, 1] };
  const courtArch = { origin: [-2.45, 1.42, 0], normal: [1, 0, 0] };
  const water = P.waterBodies.scene([P.waterBodies.create({
    id: 'canal', bounds: { min: [-3.9, -3.15], max: [3.9, 1.6] }, resolution: [8, 8],
    sample: () => ({ bed: -1.64, surface: 0.15, current: [0.11, -0.08] }),
    optics: { tint: [0.035, 0.22, 0.24], extinction: [0.58, 0.24, 0.18],
      surface: 0.27, refraction: 0.11, foam: 0.43, caustics: 0.42 }
  })]);
  const box = (at, half, material) => ({ at, half, material });
  const axis = (anchor, x, y, depth) => K.V.add(anchor.origin, anchor.normal[2] ? [x, y, depth] : [depth, y, -x]);
  function arch(anchor) {
    const along = (x, y, z, hx, hy, hz, material) => box(axis(anchor, x, y, z),
      anchor.normal[2] ? [hx, hy, hz] : [hz, hy, hx], material);
    const shapes = [along(0, 1.28, 0, 1.43, 0.22, 0.34, 'carved'),
      along(0, 1.49, 0, 1.52, 0.065, 0.41, 'metal')];
    for (const side of [-1, 1]) {
      shapes.push(along(side * 1.14, 0.15, 0, 0.27, 1.11, 0.31, 'carved'));
      for (const h of [-0.64, 0.28, 0.96]) shapes.push(along(side * 1.15, h, 0, 0.31, 0.06, 0.36, 'metal'));
    }
    return shapes;
  }
  async function build(palette, floor, shapes, wet) {
    const author = P.biomeRecipes.create({ fallback: 'ground',
      recipes: [{ id: 'ground', materials: { bed: palette.slice(1, 6) } }] });
    const view = author.view();
    const compiler = P.biomeWorld.create({
      height: () => floor, terrainSlope: 0, cell: 0.125, chunkCells: 32, verticalCells: [-15, 28],
      surfaceScatter: 0.08, palette, materialRamps: { masonry: palette.slice(1, 6), carved: palette.slice(2, 6),
        rail: palette.slice(6, 9), metal: palette.slice(11, 15), bed: palette.slice(9, 12) },
      shadeSurface(color, { point: [x, y, z] }) {
        const joints = Math.sin(Math.floor(x * 2.1) * 12.29 + Math.floor(z * 2.1) * 7.29);
        return y < 0.55 && joints < -0.2 ? color.map(value => Math.round(value * 0.90)) : color;
      }
    });
    const dry = compiler.prepare(view);
    let bricks = P.sparseBricks.create({ base: dry.distance, cell: 0.125, brickSize: 4 });
    for (const { at, half, material } of shapes) {
      const bounds = { min: at.map((value, i) => value - half[i] - 0.32),
        max: at.map((value, i) => value + half[i] + 0.32) };
      const sdf = (x, y, z) => {
        const q = [x, y, z].map((value, i) => Math.abs(value - at[i]) - half[i]);
        return Math.hypot(...q.map(value => Math.max(0, value))) + Math.min(0, Math.max(...q));
      };
      bricks = bricks.edit({ bounds, sdf, operation: 'union', material });
    }
    const frame = compiler.prepare(view, wet ? { water, bricks } : { bricks });
    const indices = [-2, -1, 0, 1].flatMap(x => [-2, -1, 0, 1].map(z => [x, z]));
    const patch = await compiler.realize(frame, indices);
    return { world: compiler.makeWorld(frame, patch.chunks, { radius: 15,
      fog: { c: 0, start: 0.54, max: 0.63 }, cam: { dist: 5.2 } }),
    queries: W.characters.fromBiome(frame, { supportPadding: 0.08 }) };
  }

  const harbor = [
    box([0, -0.57, 4.6], [4.12, 1.02, 3], 'masonry'),
    box([0, -0.57, -5.16], [4.12, 1.02, 2.01], 'masonry'),
    ...arch(canalArch)
  ];
  for (const side of [-1, 1]) {
    harbor.push(box([side * 2.68, -0.55, -0.78], [0.55, 0.32, 2.24], 'bed'));
    for (const z of [-5.8, -3.8, 2.3, 4.1, 5.9]) {
      harbor.push(box([side * 2.53, 0.83, z], [0.19, 0.39, 0.19], 'rail'));
      harbor.push(box([side * 2.53, 1.22, z], [0.21, 0.065, 0.21], 'metal'));
    }
  }
  for (let i = 0; i < 11; i++) {
    const x = ((i * 11 % 17) - 8) * 0.42, z = 0.95 - (i % 5) * 0.79;
    harbor.push(box([x, -1.49, z], [0.1 + (i % 3) * 0.13, 0.24 + (i % 4) * 0.11, 0.21], 'rail'));
  }
  const gallery = [...arch(courtArch),
    box([3.4, 1.1, 0], [0.25, 0.65, 0.85], 'metal'),
    box([4.1, 1.7, 0], [0.32, 1.35, 2.6], 'carved')];
  for (const side of [-1, 1]) for (const x of [-0.75, 0.75, 2.25, 3.75]) {
    gallery.push(box([x, 1.31, side * 1.92], [0.21, 0.88, 0.21], 'rail'));
    gallery.push(box([x, 2.2, side * 1.92], [0.29, 0.1, 0.29], 'metal'));
  }
  const canal = await build(canalPal, -1.65, harbor, true);
  const court = await build(courtPal, 0.45, gallery, false);
  const session = W.portals.create({ places: [
    { id: 'canal', anchors: { door: canalArch }, prepare: () => ({ ...canal,
      canArrive: actor => controller.fits(canal.queries, actor.position) }) },
    { id: 'court', anchors: { door: courtArch }, prepare: () => ({ ...court,
      canArrive: actor => controller.fits(court.queries, actor.position) }) }
  ], links: [{ id: 'to-court', from: { place: 'canal', anchor: 'door' }, to: { place: 'court', anchor: 'door' },
    aperture: { halfWidth: 0.91, halfHeight: 1.03 } }] });
  await session.enter('canal');
  await session.prepare('to-court');
  function drawActor(world, actor) {
    const B = makeBuilder(9, world.pal), S = K.sculpt(makeSculpt(B));
    const [x, y, z] = actor.position;
    const point = (side, dy, depth) => [x - actor.forward[2] * side + actor.forward[0] * depth, y + dy,
      z + actor.forward[0] * side + actor.forward[2] * depth];
    const cloth = { r: [9, 10, 11] }, leather = { r: [1, 2, 3] }, bronze = { r: [12, 13, 14] };
    S.ball(point(0, -0.075, 0), [0.13, 0.21, 0.13], cloth, { res: 0.041 });
    S.ball(point(0, 0.21, 0), [0.135, 0.15, 0.135], bronze, { res: 0.04 });
    S.ball(point(0, 0.205, 0.1), [0.083, 0.074, 0.074], leather, { res: 0.032 });
    for (const sign of [-1, 1]) {
      S.ball(point(sign * 0.071, -0.31, 0.03), [0.054, 0.095, 0.066], leather, { res: 0.033 });
      S.ball(point(sign * 0.153, -0.06, 0.036), [0.059, 0.115, 0.062], cloth, { res: 0.034 });
    }
    S.ball(point(0.23, -0.1, 0.09), [0.062, 0.082, 0.061], bronze, { res: 0.03 });
    S.bake();
    const avatar = B.finish(), data = new Float32Array(world.data.length + avatar.data.length);
    data.set(world.data);
    data.set(avatar.data, world.data.length);
    return { ...world, data, count: world.count + avatar.count };
  }
  let actor = controller.state({ position: [0, 0.872, 4.26], mode: 'ground', inventory: ['lantern'] });
  let camera = rig.start(actor), traveled = false, dived = false;
  const events = [];
  async function advance() {
    const { asset } = session.current();
    const inCanal = !traveled;
    const vertical = actor.mode !== 'swim' ? 0 : !dived ? -0.85 : actor.position[2] > -1.54 ? 0 :
      Math.max(-1, Math.min(1, (0.155 - actor.position[1]) * 4 - actor.velocity[1] * 0.64));
    const frame = controller.step(actor, { move: inCanal ? [0, -1] : [1, 0], vertical }, 1 / 60, asset.queries);
    actor = frame.actor;
    camera = rig.step(camera, actor, 1 / 60, { clearance: asset.queries.clearance });
    dived ||= frame.eyes.kind === 'water';
    events.push(...frame.events);
    const crossing = inCanal && await controller.cross(session, 'to-court', frame, { camera: camera.pose });
    const arrival = crossing?.arrival;
    if (crossing) actor = crossing.actor;
    if (arrival) {
      traveled = true;
      camera = rig.handoff(camera, arrival);
    }
    return { actor, camera, frame, arrival };
  }
  function picture() {
    const { asset } = session.current(), world = drawActor(asset.world, actor);
    const preview = !traveled && session.view();
    return { world, camera: camera.pose, portal: preview ? { ...preview, source: world } : undefined };
  }
  return { session, controller, rig, advance, picture, events, actor: () => actor, camera: () => camera };
};
