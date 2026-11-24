module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'socket-walkway',
  name: 'Canal service walkway',
  seed: 14,
  build(seed) {
    const B = makeBuilder(28, [
      0x19282e, 0x323c39, 0x4d5145, 0x6b6a52, 0x8a8162, 0xaba17b,
      0x3e4140, 0x65604c, 0x8e7856, 0xa58e64, 0xc9ae78,
      0x4d3835, 0x765645, 0x9e7150, 0xc19663, 0xe4bf87,
      0x245057, 0x396f73, 0x598986, 0x80a099, 0xa3b9a6,
      0x394d44, 0x5b7460, 0x7d9474, 0x9ca07c,
      0x7c6139, 0xa88745, 0xd5b664, 0xf0d68b
    ]), S = K.sculpt(makeSculpt(B)), { grammar, routes, construct } = K.procedural, V = K.V,
      rock = { r: [1,2,3,4,5] }, cut = { r: [6,7,8,9,10] }, timber = { r: [11,12,13,14,15] },
      paint = { r: [16,17,18,19,20] }, brass = { r: [25,26,27,28] }, grass = { r: [21,22,23,24] },
      water = { r: [16,17,18,19], mod: (x,y,z) => Math.sin(x * 8 + 0.7 * Math.sin(z * 5)) * 0.09 };
    S.box([0,-0.44,0], [4.65,0.25,1.9], rock, { rd: 0.11, res: 0.095 });
    S.box([0,-0.205,0.25], [4.38,0.09,1.55], water, { rd: 0.031, res: 0.089 });
    for (const side of [-1,1]) {
      S.box([side * 3.79,0.06,0], [0.86,0.38,1.6], cut, { rd: 0.12, res: 0.075 });
      S.box([side * 3.86,0.43,0], [0.69,0.055,1.43], grass, { rd: 0.07, res: 0.074 });
    }
    const carrier = routes.polyline([[-3.78,1.52,0],[0.03,1.52,0],[3.76,1.52,0]]),
      modules = [
        { id: 'landing', length: 0.65, in: 'foot', out: 'rail', reversible: true, data: { shade: 'warm' } },
        { id: 'deck', length: 0.99, min: 0.9, max: 1.02, in: 'rail', out: 'rail', cost: 1.05 },
        { id: 'service-bay', length: 1.23, min: 1.14, max: 1.38, in: 'rail', out: 'rail',
          data: { shade: 'paint' }, cost: 1.3 }
      ],
      layout = grammar.assemble(carrier, modules, { id: 'canal', start: 'foot', end: 'foot',
        pins: [{ id: 'gate', at: 3.81 / carrier.length, socket: 'rail' }], seed }),
      support = construct.loadPaths([
        { id: 'west', point: [-3.78,1.34,0] }, { id: 'gate', point: [0.03,1.34,0] },
        { id: 'east', point: [3.76,1.34,0] }
      ], [{ id: 'first', a: 'west', b: 'gate' }, { id: 'second', a: 'gate', b: 'east' }], {
        ground: x => Math.abs(x) > 3.1 ? 0.44 : Math.abs(x) > 0.55 && Math.abs(x) < 1.53 ? null : -0.16,
        maxSpan: 2.25, postStep: 0.25, braceAfter: 0.8
      });
    for (const column of support.bearings) {
      if (!column.column) continue;
      const { base: a, top: b, height } = column;
      S.box(V.mad(a,V.sub(b,a),0.5), [0.118,height * 0.5,0.2], timber, { rd: 0.023, res: 0.061 });
      S.box([a[0],a[1] + 0.065,a[2]], [0.219,0.13,0.27], cut, { rd: 0.037, res: 0.058 });
      S.box([b[0],b[1] - 0.04,b[2]], [0.16,0.077,0.51], timber, { rd: 0.018, res: 0.059 });
    }
    for (const beam of support.beams) for (const z of [-0.39,0.39]) {
      const a = [beam.a[0],beam.a[1],z], b = [beam.b[0],beam.b[1],z];
      S.tube([a,b], 0.092, 0.092, timber, { res: 0.061 });
    }
    for (const brace of support.braces) for (const depth of [-0.22,0.22]) {
      S.tube([V.add(brace.a,[0,0,depth]), V.add(brace.b,[0,0,depth])], 0.047, 0.056, timber, { res: 0.049 });
    }
    const scaffold = layout.parts.flatMap(part => [
      { key: part.key, role: 'deck' }, { key: part.key + '/post', role: 'post' },
      { key: part.key + '/rail', role: 'rail' }
    ]), candidate = layout.parts.find(part => part.t0 > 0.47 && part.t0 < 0.7);
    const damage = construct.damage(scaffold, {
      seed, steps: 2, rules: [{ id: 'rail-loss', role: 'post', to: 'missing', when: p => p.key === candidate?.key + '/post' },
        { id: 'mended-bay', role: 'deck', to: 'patched', chance: 0.28 }],
      supports: layout.parts.map(part => ({ child: part.key + '/rail', by: [part.key + '/post'] })),
      pins: layout.parts.filter(part => part.module === 'landing').map(part => ({ key: part.key }))
    }), states = new Map(damage.states.map(p => [p.key,p]));
    for (const part of layout.parts) {
      const { start: { point: a }, end: { point: b }, length, frame: { point } } = part,
        count = Math.max(2, Math.round(length / 0.185)),
        shade = states.get(part.key).state === 'patched' ? brass : part.data.shade === 'paint' ? paint : timber;
      for (let i = 0; i < count; i++) {
        const p = V.mad(a,V.sub(b,a),(i + 0.5) / count);
        S.box(p, [length / count * 0.486,0.064,0.61], shade, { rd: 0.016, res: 0.054 });
      }
      for (const direction of [-1,1]) {
        const z = direction * 0.57;
        if (direction > 0 && !states.get(part.key + '/rail').active) continue;
        S.box([a[0],a[1] + 0.38,z], [0.058,0.37,0.056], paint, { rd: 0.017, res: 0.051 });
        S.box([point[0],point[1] + 0.64,z], [length * 0.5,0.052,0.053], paint, { rd: 0.02, res: 0.052 });
        if (part.module === 'landing') S.box([a[0],a[1] + 0.76,z], [0.068,0.064,0.07], brass, { rd: 0.015, res: 0.052 });
      }
    }
    S.box([3.76,1.52,0], [0.14,0.066,0.61], timber, { rd: 0.021, res: 0.058 });
    for (const endpoint of [-3.78,3.76]) for (let i = 0; i < 6; i++) {
      const x = endpoint + Math.sign(endpoint) * (0.14 + i * 0.168), y = 1.5 - i * 0.176;
      S.box([x,(y + 0.43) * 0.5,0], [0.087,(y - 0.43) * 0.5,0.56], cut, { rd: 0.018, res: 0.054 });
    }
    for (const [x,z] of [[-3.72,0.91], [3.68,0.94], [-3.93,-0.87], [3.79,-0.95]]) {
      S.box([x,0.73,z], [0.18,0.27,0.19], cut, { rd: 0.037, res: 0.063 });
      S.box([x,1.04,z], [0.21,0.065,0.21], cut, { rd: 0.033, res: 0.060 });
    }
    S.bake();
    return B.finish({ cam: { target: [0,0.76,0], dist: 11.7, pitch: 0.41, yaw: 0.26 },
      detail: 22, dither: 0.19, radius: 4.86 });
  }
});
