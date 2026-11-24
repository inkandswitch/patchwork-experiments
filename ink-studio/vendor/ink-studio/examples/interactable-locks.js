/* A headless place whose interactables control shared terrain, routes and splats. */
module.exports = function interactableLocks(K) {
  const P = K.procedural, I = K.world.interactions;
  const wall = { at: [0, 1.13, 1.65], half: [1.24, 1.18, 0.31] };
  const gate = { at: [0, 1.13, -2], half: [1.24, 1.18, 0.23] };
  const lever = [1.94, 1, 2.65], ash = [60, 51, 56], life = 0.92;
  const palette = [0x18232d, 0x3c3338, 0x51444b, 0x675667, 0x857389, 0xb3a598, 0xdac395,
    0x51696c, 0x7f9892, 0x334450, 0x406370, 0x6ba49b, 0xa7d6ad, 0x482f3b, 0x734a4e,
    0xa16c54, 0xd59a65, 0xefd18f, 0x5a9e8f, 0xa9e7c4, 0xdfefb7, 0x956b81];
  const mats = {
    lintel: palette.slice(2, 7), brass: palette.slice(13, 18),
    stone: palette.slice(1, 6), gate: palette.slice(9, 13),
    idle: palette.slice(13, 17), lit: palette.slice(18, 21)
  };
  const author = P.biomeRecipes.create({ fallback: 'floor',
    recipes: [{ id: 'floor', materials: { ground: [palette[1], palette[3], palette[4], palette[8], palette[7]] } }] });
  const view = author.view();
  const indices = [-1, 0].flatMap(x => [-2, -1, 0, 1].map(z => [x, z]));
  const tiles = [-2, -1, 0, 1].map(z => ({ id: 'walk/' + z, resolution: [14, 16],
    bounds: { min: [-1.75, -1, z * 3], max: [1.75, 3.5, (z + 1) * 3] } }));
  const compiler = P.biomeWorld.create({
    cell: 0.125, chunkCells: 32, verticalCells: [-12, 28], surfaceScatter: 0.11, palette, materialRamps: mats,
    height(x, z) {
      return -0.07 + Math.max(0, Math.abs(x) - 2.2) * (0.22 + Math.sin(z * 1.15) * 0.075) +
        Math.sin(x * 0.76) * Math.cos(z * 0.84) * 0.06;
    },
    shadeSurface(color, { point: [x, y, z] }) {
      const crack = 0.12 + 0.32 * Math.sin(y * 3.2) + 0.09 * Math.sin(y * 10);
      if (y > 0.25 && y < 2.23 && Math.abs(z - 1.96) < 0.14 && Math.abs(x - crack) < 0.14) return ash;
      if (y < 0.12 && (Math.abs(x) <= 2.1) && Math.sin(Math.floor(x * 2.2) * 7.2 + Math.floor(z * 1.6) * 2.7) > 0.42)
        return color.map(channel => Math.round(channel * 0.84));
      return color;
    }
  });
  const base = compiler.prepare(view);
  let stone = P.sparseBricks.create({ cell: 0.1, brickSize: 5, base: base.distance });
  const distance = (values) => {
    const outside = values.map(value => Math.max(0, value));
    return Math.hypot(...outside) + Math.min(0, Math.max(...values));
  };
  function solid(bricks, { at, half }, material, ellipsoid = false) {
    const bounds = { min: at.map((value, i) => value - half[i] - 0.21),
      max: at.map((value, i) => value + half[i] + 0.21) };
    const sdf = (x, y, z) => {
      const q = [x, y, z].map((value, i) => Math.abs(value - at[i]));
      return ellipsoid ? (Math.hypot(...q.map((value, i) => value / half[i])) - 1) * Math.min(...half) :
        distance(q.map((value, i) => value - half[i]));
    };
    return bricks.edit({ bounds, operation: 'union', sdf, material });
  }
  for (const z of [wall.at[2], gate.at[2]]) {
    for (const sign of [-1, 1]) {
      stone = solid(stone, { at: [sign * 1.61, 1.29, z], half: [0.43, 1.34, 0.45] }, 'lintel');
      stone = solid(stone, { at: [sign * 1.93, 0.21, z], half: [0.59, 0.24, 0.57] }, 'stone');
      for (const y of [0.52, 1.49, 2.17])
        stone = solid(stone, { at: [sign * 1.64, y, z], half: [0.47, 0.075, 0.51] }, 'brass');
    }
    stone = solid(stone, { at: [0, 2.51, z], half: [2.06, 0.23, 0.49] }, 'lintel');
    stone = solid(stone, { at: [0, 2.75, z], half: [2.14, 0.075, 0.55] }, 'brass');
  }
  for (const sign of [-1, 1]) {
    stone = solid(stone, { at: [sign * 2.35, 0.29, -0.8], half: [0.28, 0.32, 3.64] }, 'stone');
    stone = solid(stone, { at: [sign * 2.35, 0.63, -0.8], half: [0.32, 0.075, 3.64] }, 'brass');
  }
  stone = solid(stone, { at: [lever[0], 0.38, lever[2]], half: [0.33, 0.43, 0.33] }, 'stone');
  stone = solid(stone, { at: [lever[0], 0.72, lever[2]], half: [0.4, 0.1, 0.4] }, 'brass');
  const crystal = { at: lever, half: [0.19, 0.29, 0.19] };

  const renderMeta = { radius: 11, fog: { c: 0, start: 0.6, max: 0.45 },
    cam: { target: [0.18, 1.43, 0.85], dist: 6.9, yaw: -0.22, pitch: 0.17 } };
  const endpoints = [[0.1, 0.46, 4.1], [0.1, 0.46, -4.3]];

  async function prepare({ state }) {
    const scene = P.biomeRevisions.create({ compiler, tiles, indices, meta: renderMeta, historyLimit: 0,
      span: { step: 0.12 }, agent: { radius: 0.16, height: 0.66, stepUp: 0.22 } });
    const interactions = I.create({ id: 'locks', interactables: [
      I.breakable({ id: 'cracked-wall', point: wall.at, integrity: 2, breakCue: 'masonry-break' }),
      I.latch({ id: 'gate-switch', point: lever, ticks: 90, onCue: 'gate-open', offCue: 'gate-close' })
    ], realize({ states }, before) {
      const broken = states['cracked-wall'].remaining === 0, open = states['gate-switch'].active;
      if (before && broken === (before.states['cracked-wall'].remaining === 0) &&
          open === before.states['gate-switch'].active) return before.revision;
      let bricks = stone;
      if (!broken) bricks = solid(bricks, wall, 'stone');
      if (!open) {
        bricks = solid(bricks, gate, 'gate');
        for (const x of [-0.8, -0.4, 0, 0.4, 0.8])
          bricks = solid(bricks, { at: [x, gate.at[1], gate.at[2] + 0.23], half: [0.068, 1.13, 0.11] }, 'brass');
      }
      bricks = solid(bricks, crystal, open ? 'lit' : 'idle', true);
      return scene.commit({ view, bricks });
    } });
    let effect = null;
    interactions.onEvent((event, next, before) => {
      if (event.cue !== 'masonry-break') return;
      const fragments = [], frame = next.revision.frame;
      for (const chunk of before.revision.chunks) {
        const { data } = chunk.splats;
        for (let i = 0; i < data.length; i += 16) {
          const [x, y, z] = data.subarray(i, i + 3);
          if (Math.abs(x) <= 1.27 && y >= 0.25 && y < 2.23 && Math.abs(z - wall.at[2]) < 0.35 &&
              frame.distance(x, y, z) > 0.06) fragments.push(data.subarray(i, i + 16));
        }
      }
      const stride = Math.max(1, Math.ceil(fragments.length / 180));
      const rows = fragments.filter((_, index) => index % stride === 0);
      if (rows.length) effect = { rows, motion: K.deform.burst({
        pieces: rows.map(row => Array.from(row.slice(0, 3))), from: event.point, speed: 4.2,
        gravity: -7.2, drag: 1.4, life, shrink: 0.1
      }) };
    });
    await interactions.restore(state);
    function frameAt(seconds) {
      const { world } = interactions.current().revision;
      if (!effect || !(seconds >= 0 && seconds < life)) return world;
      const data = new Float32Array(world.data.length + effect.rows.length * 16);
      data.set(world.data);
      effect.rows.forEach((row, i) => {
        const { point, scale } = effect.motion.piece(i, seconds);
        const at = world.data.length + i * 16;
        data.set(row, at);
        data.set(point, at);
        data[at + 2] += seconds * 0.7;
        data[at + 3] *= Math.min(1, (life - seconds) / 0.32);
        for (const offset of [4, 5, 6, 8, 9, 10]) data[at + offset] *= scale * scale * 0.62;
      });
      return { ...world, data, count: data.length / 16 };
    }
    return { interactions, checkpoint: interactions.checkpoint,
      get world() { return interactions.current().revision.world; },
      route() { return interactions.current().revision.graph.route(...endpoints, { maxSnap: 0.6, allow: ['walk'] }); },
      frameAt };
  }
  const session = K.world.portals.create({ places: [
    { id: 'locks', prepare }, { id: 'landing', prepare: () => ({}) }
  ] });
  return { session, wall: wall.at, gate: gate.at };
};
