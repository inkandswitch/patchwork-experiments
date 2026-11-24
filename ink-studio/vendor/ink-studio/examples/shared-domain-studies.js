const FPS = 10, TICKS = 64, DURATION = TICKS / FPS;
const palette = [0x0c151e, 0x111d28, 0x1b2b37, 0x243845, 0x304956, 0x345461, 0x456574,
  0x517984, 0x96a9b5, 0x12606f, 0x218494, 0x38b1bf, 0x72ced0, 0xa5e5e5,
  0x544335, 0x75563c, 0x966342, 0xbb8250, 0xdeab68, 0xffce95, 0xf5e7cf, 0xfff4d4];
const blue = [0.28, 0.83, 0.91], gold = [1.0, 0.69, 0.36], pale = [1, 0.93, 0.73];
const studies = [
  ['IMAGE GRID', 'WRAPPED X / MASKED CENTER'],
  ['JOINED UV CHARTS', 'TWO CHARTS / ONE SEAM'],
  ['DIRECTED GRAPH', 'ONE-WAY BRIDGE / 6 TICKS'],
  ['VOXEL VOLUME', '6 FACE NEIGHBORS / CLOSED']
];

function models(D) {
  const image = D.image({ width: 21, height: 10, origin: [-4.15, .78],
    spacing: [.166, .167], units: 'world', boundary: ['wrap', 'closed'],
    mask: ({ address: [x, y] }) => (x - 10) ** 2 + (1.25 * (y - 4.5)) ** 2 > 7.5 });
  const sheet = (x, z, dx, dz) => ({ sample: ([u, v]) => ({ p: [x + u * dx, .81 + 1.64 * v, z + u * dz] }) });
  const charts = D.charts({
    charts: [
      { id: 'left', width: 10, height: 10, carrier: sheet(.62, .16, 1.63, 0) },
      { id: 'right', width: 10, height: 10, carrier: sheet(2.25, .16, 1.56, -.94) }
    ],
    seams: [{ a: ['left', 'u1'], b: ['right', 'u0'] }]
  });
  const nodes = [], edges = [];
  for (const [side, center, angle] of [['A', -3.30, 0], ['B', -1.40, Math.PI]]) {
    for (let i = 0; i < 6; i++) {
      const a = angle + Math.PI * i / 3;
      nodes.push({ id: side + i, position: [center + .62 * Math.cos(a), -1.31 + .57 * Math.sin(a), .13] });
      edges.push({ from: side + i, to: side + ((i + 1) % 6), bidirectional: true });
    }
    nodes.push({ id: side + 'hub', position: [center, -1.31, .13] });
    for (const i of [1, 3, 5]) edges.push({ from: side + i, to: side + 'hub', bidirectional: true });
  }
  edges.push({ id: 'bridge', from: 'A0', to: 'B0', delay: 6 });
  const graph = D.graph({ nodes, edges, units: 'world' });
  const volume = D.volume({ width: 7, height: 5, depth: 5,
    origin: [-1.05, -.55, -.70], spacing: [.30, .22, .28], boundary: 'closed' });
  return [
    { domain: image, source: [2, 4], alternate: [18, 6], tint: blue, size: .047 },
    { domain: charts, source: ['left', 4, 4], alternate: ['right', 7, 5], tint: gold, size: .047 },
    { domain: graph, source: 'A3', alternate: 'A1', tint: blue, size: .083 },
    { domain: volume, source: [0, 2, 1], alternate: [6, 2, 4], tint: gold, size: .037,
      project: ([x, y, z]) => [2.38 + .94 * x - .65 * z, -1.33 + .92 * y + .24 * x + .39 * z, .58 + .55 * x + .75 * z] }
  ];
}

module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'shared-domain-studies', name: 'One Rule, Four Domains', seed: 38, duration: DURATION,
  build(seed) {
    const B = makeBuilder(seed, palette), D = K.cellular.domain, V = K.V;
    const sprites = SpriteSurface.make(512), font = K.inspection.font({});
    function label(text, x, y, scale, color) {
      const chars = [...text].map(c => font.get(c)), width = chars.length * 6;
      sprites.face([x, y, -.91], [width * scale, 0, 0], [0, 7 * scale, 0], width, 7,
        (i, j) => chars[Math.floor(i / 6)]?.[j * 6 + i % 6] ? color : null);
    }
    for (const [i, [title, caption]] of studies.entries()) {
      const x = i % 2 ? .13 : -4.74, y = i > 1 ? -2.79 : .29;
      sprites.face([x, y, -1.08], [4.61, 0, 0], [0, 2.91, 0], 150, 98, (u, v) => {
        if (!u || !v || u === 149 || v === 97) return i % 2 ? 0x544335 : 0x345461;
        if (v === 15 || v === 84) return 0x243845;
        return u % 6 === 0 && v % 6 === 0 ? 0x1b2b37 : 0x111d28;
      });
      label(title, x + .25, y + 2.57, .033, i % 2 ? 0xffce95 : 0xa5e5e5);
      label(caption, x + .25, y + .17, .025, 0x96a9b5);
    }
    label('ONE RULE, FOUR DOMAINS', -4.57, 3.42, .043, 0xf5e7cf);

    const rule = K.cellular.graph.rules.pulse({ refractory: 8 });
    const domains = models(D).map(model => {
      const sim = D.create({ domain: model.domain, rule, seed });
      const frames = Array.from({ length: TICKS }, (_, i) => {
        if (i) sim.step();
        if (i === 2 || i === 32) sim.edit([{ at: i === 2 ? model.source : model.alternate, state: 1 }]);
        return sim.frame();
      });
      return { ...model, frames, cells: model.domain.cells.map(cell => [cell.id, model.project?.(cell.position) ?? cell.position]) };
    });
    const graph = domains[2].domain, bridge = graph.edges.find(edge => edge.id === 'bridge');
    const bridgeEndpoints = [graph.cell(bridge.from).position, graph.cell(bridge.to).position];
    const graphSegments = graph.edges.map(edge => [
      graph.cell(edge.from).position, graph.cell(edge.to).position, edge === bridge
    ]);
    const capacity = 2 * domains.reduce((count, entry) => count + entry.cells.length, 0) + graph.edges.length + 48;
    const paint = K.frameSplats(B, capacity, (draw, _dt, t) => {
      const cursor = (t - DURATION * Math.floor(t / DURATION)) * FPS;
      const tick = Math.min(TICKS - 1, Math.floor(cursor + 1e-7)), fraction = Math.max(0, cursor - tick);
      const fade = Math.min(1, (TICKS - 1 - tick) / 9);
      for (const [a, b, main] of graphSegments) {
        draw.streak(a, b, { width: main ? .020 : .012, rgb: main ? [0.63, .39, .24] : [.18, .35, .44],
          density: .84, depth: true });
      }
      for (let j = 0; j < 13; j++) {
        draw.point([2.25, .82 + j * .134, .24], { width: .014, rgb: gold, density: .72, depth: true });
      }
      for (const { frames, cells, tint, size } of domains) {
        const frame = frames[tick];
        for (const [id, p] of cells) {
          const state = frame.get(id), active = state === 1, glow = (state ? (1 - (state - 1) / 9) ** 1.65 : 0) * fade;
          draw.point(p, { width: size * (1.04 + glow * .25), density: .35 + glow * 1.28,
            rgb: V.lerp([.23, .39, .49], active ? pale : tint, glow), depth: true });
          draw.point(p, { width: size * 1.65, density: glow * (active ? .48 : .12), rgb: tint, depth: true });
        }
      }
      for (let age = 0; age < bridge.delay; age++) {
        if (domains[2].frames[tick].get(bridge.from, age) !== 1) continue;
        const [a, b] = bridgeEndpoints;
        const p = V.lerp(a, b, (age + fraction) / bridge.delay);
        draw.point([p[0], p[1], p[2] + .025], { width: .053, density: 1.56 * fade, rgb: gold, depth: true });
      }
    });
    paint.post = (_dt, _t, active) => {
      for (let i = paint.first; i < paint.first + paint.count; i++) {
        const offset = 16 * i, data = active.D;
        if (!data[offset + 3] && (data[offset] || data[offset + 2])) {
          data[offset] = data[offset + 2] = 0;
          active.touch(i);
        }
      }
    };
    const world = B.finish({ spriteSurfaces: sprites.finish(),
      cam: { target: [0, .30, 0], dist: 12, fov: .59, yaw: 0, pitch: 0, sway: 0 },
      detail: 25, radius: 7, dither: .033, look: { pixelSize: 1, splatCoverage: 'continuous' } });
    const stage = K.stage(world);
    stage.add(paint);
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
});
