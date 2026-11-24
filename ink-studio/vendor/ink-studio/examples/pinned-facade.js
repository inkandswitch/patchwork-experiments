const emit = role => ({ op: 'emit', role });
const split = (axis, parts) => ({ op: 'split', axis, parts });
const inset = (min, max, use) => ({ op: 'inset', min, max, use });
const group = children => ({ op: 'group', children });

const rules = {
  building: split('y', [
    { key: 'base', size: 0.17, use: emit('plinth') },
    { key: 'body', use: 'body' },
    { key: 'edge', size: 0.18, use: 'cornice' }
  ]),
  body: { op: 'repeat', axis: 'x', pitch: 1.34, pinSet: 'entries', use: 'bay', pinUse: 'entrance' },
  cornice: split('y', [
    { key: 'ledge', weight: 1, use: emit('trim') },
    { key: 'crown', weight: 1, use: inset([0, 0, 0.025], [0, 0, 0.025], emit('trim')) }
  ]),
  bay: split('y', [
    { key: 'low', weight: 1.2, use: emit('plaster') },
    { key: 'sill', size: 0.12, use: emit('sill') },
    { key: 'window-band', size: 0.88, use: 'windowBand' },
    { key: 'lintel', size: 0.12, use: emit('trim') },
    { key: 'high', weight: 1, use: emit('plaster') }
  ]),
  windowBand: split('x', [
    { key: 'left', weight: 0.22, use: emit('plaster') },
    { key: 'opening', weight: 0.56, use: 'window' },
    { key: 'right', weight: 0.22, use: emit('plaster') }
  ]),
  window: group([
    { key: 'surround', use: inset([0, 0, 0.24], [0, 0, 0.11], emit('window-frame')) },
    { key: 'glass', use: inset([0.051, 0.053, 0.39], [0.051, 0.053, 0.07], emit('glazing')) },
    { key: 'sill-anchor', use: { op: 'socket', name: 'window-sill', axis: 'z', side: 'max', at: [0.5, 0, 0.5] } }
  ]),
  entrance: split('y', [
    { key: 'threshold', size: 0.12, use: emit('sill') },
    { key: 'opening', weight: 1, use: 'door' },
    { key: 'header', size: 0.63, use: emit('plaster') }
  ]),
  door: group([
    { key: 'wall', use: split('x', [
      { key: 'jamb-left', size: 0.17, use: emit('trim') },
      { key: 'leaf', weight: 1, use: inset([0, 0, 0.15], [0, 0, 0.18], emit('door')) },
      { key: 'jamb-right', size: 0.17, use: emit('trim') }
    ]) },
    { key: 'entry', use: { op: 'socket', name: 'entrance', axis: 'z', side: 'max', at: [0.5, 0, 0] } }
  ])
};

module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'pinned-facade',
  name: 'A window remembers its paint',
  seed: 0,
  build(seed) {
    const palette = [
      0x1a292e, 0x55423e, 0x836350, 0xa58161, 0xbda177, 0xe4c794,
      0x303c37, 0x596e54, 0x83956e, 0xa2aa76, 0x3b333a, 0x67515d, 0x92777f,
      0x392e34, 0x684037, 0x9e583e, 0xbd7750, 0xe6a267,
      0x253d56, 0x345f82, 0x568eb0, 0x83bbc8, 0x3a514d, 0x537a68, 0x81a188
    ];
    const B = makeBuilder(8, palette),
      S = K.sculpt(makeSculpt(B)),
      doc = K.authoring.document(),
      { grammar } = K.procedural,
      owner = doc.create('facade', { parameters: { width: 5.6, height: 3.04 } });
    function resize(width) {
      doc.begin('Resize façade');
      doc.update(owner, { parameters: { width } });
      const height = doc.get(owner).parameters.height,
        layout = grammar.expand({
          id: 'facade', symbol: 'building', bounds: { min: [-width / 2, 0, -0.28], max: [width / 2, height, 0.28] }
        }, rules, { pinSets: { entries: [{ id: 'main-entry', at: -0.36, span: 1.19 }] } });
      doc.derive(owner, 'shape', grammar.children(layout));
      doc.commit();
    }
    resize(5.6);
    const nearest = doc.entities('grammarPart').filter(entity => entity.parameters.role === 'glazing' && entity.parameters.center[0] < -0.36).at(-1);
    doc.update(nearest.id, { parameters: { paint: 'blue' } });
    if (seed % 2) resize(8.12);
    const mats = {
      plinth: { r: [10, 11, 12] }, plaster: { r: [1, 2, 3, 4, 5] },
      trim: { r: [10, 11, 12, 4] }, sill: { r: [2, 3, 4, 5] }, door: { r: [13, 14, 15, 16, 17] },
      'window-frame': { r: [13, 14, 15] }, glazing: { r: [22, 23, 24] }
    };
    S.ground({ r: [6, 7, 8, 9] }, { rad: 4.82, zs: 2.02, edge: 0.025, res: 0.09 });
    const markers = { r: [13, 14, 15, 17] };
    for (const entity of doc.entities('grammarPart')) {
      const { role, center, half, paint } = entity.parameters,
        mat = paint === 'blue' ? { r: [18, 19, 20, 21] } : mats[role];
      S.box(center, half, mat, { rd: Math.min(...half) * 0.22, res: 0.064 });
      if (role === 'door') S.ball([center[0] + 0.19, center[1] - 0.18, center[2] + half[2] + 0.017], 0.032, markers, { res: 0.039 });
    }
    for (const entity of doc.entities('grammarSocket')) {
      const { name, point } = entity.parameters;
      if (name === 'entrance') {
        for (const shift of [-0.4, 0.4]) {
          S.lathe([point[0] + shift, 0, point[2] + 0.65], 0.24, [0.065, 0.058], markers, { res: 0.053 });
        }
      } else {
        S.box([point[0], point[1] - 0.045, point[2] + 0.07], [0.26, 0.045, 0.11], mats.sill, { rd: 0.019, res: 0.062 });
      }
    }
    S.bake();
    return B.finish({ cam: { target: [0, 1.27, 0], dist: 11.6, pitch: 0.27, yaw: 0.2 }, detail: 20, dither: 0.25, radius: 5.2 });
  }
});
