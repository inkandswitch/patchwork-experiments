module.exports = ({ makeBuilder, KIT: K }) => ({
  id: 'graph-study',
  name: 'Floodgate signal and cached surface growth',
  seed: 14,
  build(seed) {
    const P = K.procedural, G = P.graph;
    const colors = [0x101722, 0x24313d, 0x354b58, 0x59696e, 0x7d8b86, 0x293b4b,
      0x356c70, 0x66a99a, 0x91cdb3, 0xd4f0c3, 0x5c403e, 0xab6950, 0xffd097];
    const B = makeBuilder(seed, colors);
    const material = G.material({ height: (u, v) => .06 * B.n3(u * 1.2, v * 1.1, 0),
      wetness: (u, v) => B.n3(u, v, 2), ink: (u, v) => B.n3(u * 4, v * 4, 7) });
    const operations = {
      tiles: {
        inputs: { size: 'vec2', wetness: 'number' },
        outputs: { value: 'points' },
        run({ size, wetness }, context) {
          return { value: G.tiles({ bounds: { min: [-3, -1.75], max: [3, 1.75] }, cell: size, seed: context.seed,
            mask: (u, v) => .86 + wetness * Math.exp(-.8 * (u * u + v * v)),
            vector: (u, v) => [1, .58 * Math.sin(u * 1.8) + .26 * Math.cos(v * 2)],
            scale: (u, v) => .73 + .23 * B.n3(u, 3, v), jitter: .21 }) };
        }
      }
    };
    const substrate = G.group({
      inputs: { wetness: { type: 'number', default: .26 } },
      nodes: { tile: { op: 'tiles', inputs: { size: [.54, .42], wetness: { input: 'wetness' } } } },
      outputs: { value: { node: 'tile' } }
    }, { operations, outputs: { value: 'points' } });
    const graph = G.create({
      nodes: { plaza: { op: 'substrate', params: { wetness: .32 } } },
      outputs: { tiles: { node: 'plaza' } }
    }, { groups: { substrate } });
    const layout = graph.evaluate({}, { seed });
    const patch = P.surface.plane({ id: 'approach', origin: [-3, 0, -1.75], u: [6, 0, 0], v: [0, 0, 3.5] });
    const cover = P.attributes.carrier(patch, hit => {
      const [x, , z] = hit.p;
      return { wetness: material.wetness(x, z), surface: 'approach' };
    });
    const tiles = P.attributes.transfer(cover, 'instance', layout.outputs.tiles);
    B.box(0, -.35, 0, 6.22, .34, 3.83, [1, 2, 2, 3]);
    const adjustable = [];
    G.each(layout.outputs.tiles, (tile, { index }) => {
      const [x, , z] = tile.point, wet = tiles[index].attributes.wetness ?? 0;
      const first = B.count(), c = wet > .58 ? 2 : 3;
      B.box(x, -.027, z, .47 * tile.scale, .11, .35 * tile.scale, [1, 2, c, c], { yaw: tile.rotation });
      adjustable.push({ position: tile.point, first, last: B.count(), base: c, wet });
    }, { seed });
    for (const x of [-1.03, 1.03]) {
      B.box(x, -.02, -.89, .24, 1.61, .39, [1, 2, 3, 4]);
      B.box(x, 1.43, -.89, .42, .14, .49, [2, 3, 4, 4]);
    }
    B.box(0, 1.55, -.89, 2.62, .22, .55, [2, 3, 3, 4]);
    B.box(0, .39, -1.15, 1.28, .93, .14, [1, 1, 5, 5]);

    const glyph = [
      '00100',
      '01110',
      '11011',
      '01110',
      '00100'
    ].join('');
    const frame = color => [...glyph].flatMap(bit => bit === '1' ? [...B.P[color], 255] : [0, 0, 0, 0]);
    const asset = G.raster({ width: 5, height: 5, fps: 4,
      layers: { signal: { frames: [frame(6), frame(12), frame(9)] } },
      tags: { active: { start: 1, end: 3, fps: 3 } } });
    const signal = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (glyph[y * 5 + x] === '1') {
      signal.push([B.count(), y * 5 + x]);
      B.disc((x - 2) * .124, 1.18 - y * .124, -1.059, [0, 0, 1], .078, .018, B.P[6], 2.1, { em: true });
    }
    const ramp = (a, b) => ({ schema: { intensity: 'number' }, keys: [
      { time: 0, value: { intensity: a }, ease: 'smooth' }, { time: .8, value: { intensity: b } }
    ] });
    const machine = K.anim.stateGraph.create({
      input: { fuel: 1 }, initial: 'idle', triggers: ['start'],
      states: { idle: ramp(0, 0), ignite: ramp(0, 1), burn: ramp(1, 1), extinguish: ramp(1, 0) },
      transitions: [
        { from: 'idle', to: 'ignite', trigger: 'start' }, { from: 'ignite', to: 'burn', after: .8 },
        { from: 'burn', to: 'extinguish', when: [{ property: 'fuel', op: 'lt', value: .2 }], blend: .12 }
      ]
    }).instantiate();
    const growth = G.simulation({
      initial: { ring: .15 }, dt: 1 / 15, checkpoint: 5, seed,
      step(state, { time }) { return { ring: state.ring + (time > .35 && time < 1.9 ? .12 : -.026) }; }
    });
    const world = B.finish({
      cam: { target: [0, .46, -.1], dist: 10.15, yaw: -.38, pitch: .49 },
      dither: .09, radius: 6, detail: 30,
      look: { effects: { glow: { radius: 2, bands: 2, threshold: .35, colors: ['#29484f', '#4a8179'] } } }
    });
    let past = 0;
    const store = (i, r, g, b) => { world.data[i * 16 + 7] = (r | 0) + (g | 0) * 256 + (b | 0) * 65536; };
    world.anim = { stateful: true, update(dt, time) {
      if (time >= .34 && past < .34) machine.trigger('start');
      const state = machine.advance(time, { fuel: time < 2.04 ? 1 : 0 });
      const raster = asset.layer('signal', time, state.state === 'ignite' || state.state === 'burn' ? 'active' : 'all').data;
      for (const [i, p] of signal) {
        const c = p * 4, k = .21 + state.values.intensity * .79;
        store(i, raster[c] * k, raster[c + 1] * k, raster[c + 2] * k);
      }
      const { ring } = growth.sample(time).state;
      for (const { position, first, last, base, wet } of adjustable) {
        const [x, , z] = position;
        const distance = Math.hypot(x, z + 1.02);
        const value = distance < ring && wet > .36 ? (ring - distance < .48 ? 8 : 6) : base;
        const [r, g, b] = B.P[value];
        for (let i = first; i < last; i++) store(i, r, g, b);
      }
      past = time;
      return true;
    } };
    return world;
  }
});
