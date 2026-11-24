/* Headless terrain streaming with independent collision, camera and portal interests. */
module.exports = function streamedPlaces(K, makeSculpt) {
  const { chunks, biomeWorld, biomeRecipes } = K.procedural;
  const grid = chunks.grid({ dimensions: 2, size: 6 });
  const planes = [
    { id: 'heath', seed: 17, normal: [0, 0, 1], colors: [
      0x243949, 0x394a4a, 0x5f7660, 0x8a9d70, 0xc9c087, 0x294749, 0x416b5e, 0x73927a, 0xd8ab70, 0xffe3a4
    ] },
    { id: 'mesa', seed: 51, normal: [0, 0, -1], colors: [
      0x57465e, 0x5c3e4e, 0x90545b, 0xbd7466, 0xdc9a77, 0x5c3e4e, 0x955a62, 0xd48670, 0xf0ba85, 0xffdfac
    ] }
  ];
  const spaces = new Map();
  for (const { id, seed, normal, colors } of planes) {
    const arch = { origin: [0, 1.42, 0], normal };
    const author = biomeRecipes.create({
      fallback: 'terrain', seed,
      regions: [{ id: 'gateway', biome: 'gateway', bounds: { min: [-2.2, -0.4, -5], max: [2.2, 3, 5] } }],
      recipes: [
        { id: 'terrain', materials: { ground: colors.slice(1, 5) }, populations: [{ id: 'grove', density: 0.56 }] },
        { id: 'gateway', materials: { ground: colors.slice(1, 5) },
          landmarks: [{ id: 'arch', asset: 'arch', at: [0.5, 0.15, 0.5] }] }
      ]
    });
    function emit(builder, item) {
      const [x, y, z] = item.point, palette = builder.P;
      if (item.kind === 'landmark') {
        const S = K.sculpt(makeSculpt(builder));
        const stone = { r: [1, 2, 3, 4, 8], mod: (x, y, z) => builder.n3(x * 3, y * 7, z * 3) * 0.3 };
        for (const side of [-1, 1]) {
          S.box([side * 1.23, 1.52, 0], [0.25, 1.53, 0.28], stone, { res: 0.1 });
          for (const level of [0.16, 0.86, 1.56, 2.26, 2.96])
            S.box([side * 1.23, level, 0], [0.28, 0.035, 0.32], { r: [2, 3, 4] }, { res: 0.078 });
          S.box([side * 1.65, 0.29, side * 0.72], [0.2, 0.28, 0.2], stone, { res: 0.08 });
          builder.iso(side * 1.65, 0.65, side * 0.72, 0.13, palette[9], 1);
        }
        S.box([0, 2.94, 0], [1.5, 0.18, 0.32], stone, { res: 0.09 });
        S.box([0, 0.04, 0], [1.03, 0.055, 0.54], { r: [2, 3, 4] }, { res: 0.09 });
        S.bake();
        return;
      }
      const roll = K.grow.dice(item.seed), scale = 0.45 + item.scale * 0.55;
      const turn = roll() * Math.PI * 2;
      if (id === 'heath') {
        const height = scale * (0.65 + roll() * 1.45);
        builder.axial(x, y + height * 0.32, z, [0, 1, 0], height * 0.29, 0.042 * scale, palette[2], 1);
        for (let tier = 0; tier < 6; tier++) for (let i = 0; i < 8; i++) {
          const angle = turn + (i + tier * 0.35) / 8 * Math.PI * 2;
          const dx = Math.cos(angle), dz = Math.sin(angle), radius = scale * (0.25 - tier * 0.04);
          const lit = dx * -0.5 + dz * 0.35 + tier * 0.07;
          builder.disc(x + dx * radius, y + height * (0.36 + tier * 0.105), z + dz * radius,
            [dx * 0.8, 0.6, dz * 0.8], radius * 0.58 + 0.04, 0.026, palette[lit < 0 ? 5 : lit < 0.38 ? 6 : 7], 1);
        }
      } else {
        const height = scale * (0.28 + 1.75 * roll());
        for (let band = 0; band < 10; band++) {
          const radius = scale * (0.32 - 0.021 * band + Math.sin(band * 1.25) * 0.045);
          const h = y + height * (band + 0.15) / 10;
          for (let side = 0; side < 9; side++) {
            const angle = turn + side / 9 * Math.PI * 2, dx = Math.cos(angle), dz = Math.sin(angle);
            const lit = dx * -0.5 + dz * 0.32, tone = Math.min(8, 5 + Math.floor(band / 3) + (lit > 0.37 ? 1 : 0));
            builder.disc(x + dx * radius + band * 0.004, h, z + dz * radius,
              [dx, 0, dz], radius * 0.43 + height * 0.04, 0.031, palette[tone], 1);
          }
        }
      }
    }
    const compiler = biomeWorld.create({
      height(x, z) {
        const rise = 1 - Math.exp(-(x * x + z * z) / 20);
        const hills = Math.sin(x * 0.23 + seed * 0.1) * Math.cos(z * 0.25) +
          Math.sin(x * 0.08 + z * 0.19) * 0.72 + Math.cos((x - z) * 0.39) * 0.22;
        return hills * rise * (id === 'mesa' ? 1.44 : 0.84);
      },
      cell: 0.375, chunkCells: 16, verticalCells: [-9, 11], surfaceScatter: 0.19,
      palette: colors, layers: [{ id: 'plants', options: { spacing: 1.6, slots: 2, exclusion: { distance: 0.7 } } }], emit
    });
    spaces.set(id, { arch, compiler, frame: compiler.prepare(author.view()) });
  }

  const scheduler = chunks.createScheduler({
    budgetBytes: 34 * 512 * 1024,
    describe(key) {
      const { place, index } = grid.address(key);
      return spaces.has(place) ? { revision: 1, bytes: 512 * 1024, input: { place, index } } : null;
    },
    load({ input: { place, index } }) {
      const { compiler, frame } = spaces.get(place);
      return { place, chunk: compiler.build(frame, index) };
    }
  });
  function ring(place, point, radius) {
    const center = grid.index([point[0], point[2]]), requests = [];
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++)
      requests.push({ key: grid.key(place, [center[0] + x, center[1] + z]), priority: -Math.hypot(x, z) });
    return requests;
  }
  let tag = 0;
  async function prepare({ id, anchor, signal, reason }) {
    const serial = ++tag, camera = scheduler.interest('camera/' + serial), body = scheduler.interest('collision/' + serial);
    const space = spaces.get(id);
    let preview = reason === 'preview', lastSnapshot, lastChunks = [], world;
    const close = () => { camera.close(); body.close(); };
    const track = (player, focus = player) => {
      body.update(ring(id, player, preview ? 0 : 1), { priority: preview ? 60 : 100 });
      camera.update(ring(id, focus, preview ? 1 : 2), { priority: preview ? 40 : 30 });
    };
    const ready = async options => {
      const [collision, view] = await Promise.all([body.ready(options), camera.ready(options)]);
      return collision && view ? view : null;
    };
    try {
      track(anchor?.origin ?? space.arch.origin);
      if (!await ready({ signal })) { close(); return null; }
      return {
        get world() {
          const snapshot = scheduler.snapshot();
          if (snapshot !== lastSnapshot) {
            const next = snapshot.entries.filter(entry => entry.value.place === id).map(entry => entry.value.chunk);
            if (!world || next.length !== lastChunks.length || next.some((chunk, i) => chunk !== lastChunks[i]))
              world = space.compiler.makeWorld(space.frame, next, { radius: 23, fog: { c: 0, start: 0.62, max: 0.57 } });
            lastChunks = next;
            lastSnapshot = snapshot;
          }
          return world;
        },
        track, ready, dispose: close,
        promote(point) { preview = false; track(point); },
        canArrive({ position: [x, y, z] }) {
          const entry = scheduler.get(grid.key(id, grid.index([x, z])));
          return (entry?.value.chunk.field.sample(x, y, z) ?? -1) > 0.07;
        }
      };
    } catch (error) {
      close();
      throw error;
    }
  }
  const session = K.world.portals.create({
    places: [...spaces].map(([id, { arch }]) => ({ id, anchors: { arch }, prepare })),
    links: planes.map(({ id }, i) => ({
      id: 'to-' + planes[1 - i].id, from: { place: id, anchor: 'arch' },
      to: { place: planes[1 - i].id, anchor: 'arch' }, aperture: { halfWidth: 1, halfHeight: 1.36 }
    }))
  });
  session.onCross(({ place, actor }) => place.asset.promote(actor.position));
  return { grid, scheduler, session, dispose() { session.dispose(); scheduler.dispose(); } };
};
