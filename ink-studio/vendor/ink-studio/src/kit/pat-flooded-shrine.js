/* Retained shrine layout. Placed parts keep their IDs and hand-authored overrides. */
(function (K) {
  const P = K.procedural, A = K.authoring;
  const defaults = Object.freeze({ waterline: .11, age: .46, vegetation: .52, clearance: 1.1 });
  const rules = { waterline: [-.35, .8], age: [0, 1], vegetation: [0, 1], clearance: [.55, 2.4] };
  const diceFor = (seed, id) => K.grow.dice(P.data.hash(id, seed));
  const point = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  function settings(values) {
    const out = { ...defaults, ...values };
    for (const [name, value] of Object.entries(out)) {
      if (!Object.hasOwn(rules, name) || !Number.isFinite(value) || value < rules[name][0] || value > rules[name][1])
        throw new RangeError('Invalid shrine control ' + name);
    }
    return out;
  }

  function create({ seed = 1, controls = {}, snapshot } = {}) {
    if (!Number.isSafeInteger(seed)) throw new RangeError('Shrine seed must be an integer');
    const doc = A.document(snapshot);
    if (!snapshot) doc.transact('Create shrine anchors', () => {
      doc.create('shrine', { id: 'shrine', parameters: { ...settings(controls), layoutSeed: seed } });
      doc.create('shrine-anchor', { id: 'entrance', parent: 'shrine', parameters: { point: [0, .05, 2.8] } });
      doc.create('shrine-anchor', { id: 'silhouette', parent: 'shrine', parameters: { point: [0, .55, -1.28], height: 2.43 } });
    });
    if (!doc.get('shrine') || !doc.get('entrance') || !doc.get('silhouette')) throw new TypeError('Snapshot is missing shrine anchors');

    function generate() {
      const { layoutSeed, ...incoming } = doc.get('shrine').parameters;
      const controls = settings(incoming);
      const { point: foot } = doc.get('entrance').parameters;
      const { point: hero } = doc.get('silhouette').parameters;
      const pathX = z => foot[0] + (hero[0] - foot[0]) * Math.max(0, Math.min(1,
        (foot[2] - z) / Math.max(.1, foot[2] - hero[2])));
      const plan = [{ key: 'platform', type: 'foundation', parameters: { point: [0, -.21, 0], half: [3.4, .35, 2.95] } }];
      for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
        const key = 'wall/' + side + '/' + i, dice = diceFor(layoutSeed, key), z = (i - 3.6) * .71;
        const height = .58 + .54 * dice() * (1 - controls.age),
          x = side * (2.7 + .25 * dice());
        const nearPath = Math.abs(pathX(z) - x) < controls.clearance;
        const worn = dice();
        plan.push({ key, type: 'wall', parameters: {
          point: [x, .15 + height / 2, z], half: [.23 + .13 * dice(), height / 2, .36],
          yaw: (dice() - .5) * (.16 + controls.age * .4), wear: worn * controls.age, visible: !nearPath && worn > controls.age * .63
        } });
      }
      for (let i = 0; i < 9; i++) {
        const fraction = i / 8, key = 'path/' + i, dice = diceFor(layoutSeed, key);
        const p = foot.map((n, axis) => n + (hero[axis] - n) * fraction);
        plan.push({ key, type: 'step', parameters: {
          point: [p[0], p[1] - .08, p[2]], half: [controls.clearance * .50, .12, .28],
          yaw: (dice() - .5) * .17, wear: controls.age * dice()
        } });
      }
      for (const side of [-1, 1]) for (let i = 0; i < 28; i++) {
        const key = 'growth/' + side + '/' + i, dice = diceFor(layoutSeed, key);
        const z = -2.6 + dice() * 5.1, x = side * (controls.clearance + .16 + dice() * Math.max(.1, 3.1 - controls.clearance - .16));
        const height = .10 + dice() * .45, species = dice() > .68 ? 'reed' : 'moss';
        plan.push({ key, type: species, parameters: { point: [x, .17, z],
          height, visible: dice() < controls.vegetation && Math.abs(pathX(z) - x) >= controls.clearance * .78, phase: dice() * 6.28 } });
      }
      return doc.derive('shrine', 'layout', plan);
    }

    if (!snapshot) doc.transact('Generate shrine', generate);
    return {
      document: doc,
      setControls(changes) {
        const { layoutSeed, ...old } = doc.get('shrine').parameters;
        return doc.transact('Set shrine controls', () => {
          doc.update('shrine', { parameters: { ...settings({ ...old, ...changes }), layoutSeed } });
          generate();
        });
      },
      regenerate(layoutSeed) {
        if (!Number.isSafeInteger(layoutSeed)) throw new RangeError('Layout seed must be an integer');
        return doc.transact('Regenerate shrine', () => {
          doc.update('shrine', { parameters: { layoutSeed } });
          generate();
        });
      },
      pin(name, newPoint, height) {
        if (!['entrance', 'silhouette'].includes(name) || !point(newPoint) ||
            (height !== undefined && (!Number.isFinite(height) || height < 1.2 || height > 4)))
          throw new RangeError('Invalid shrine anchor');
        return doc.transact('Move shrine anchor', () => {
          doc.update(name, { parameters: { point: newPoint, ...(height !== undefined && { height }) } });
          generate();
        });
      },
      describe() {
        const nodes = doc.entities().filter(e => e.derived?.owner === 'shrine');
        const walls = nodes.filter(e => e.type === 'wall');
        const present = walls.filter(e => e.parameters.visible);
        return {
          silhouette: present.reduce((sum, e) => sum + e.parameters.half[1], 0),
          openness: 1 - present.length / walls.length,
          wear: present.length ? present.reduce((sum, e) => sum + e.parameters.wear, 0) / present.length : 1,
          controls: doc.get('shrine').parameters,
          anchors: ['entrance', 'silhouette'].map(name => doc.get(name).parameters)
        };
      }
    };
  }
  P.floodedShrine = Object.freeze({ create, defaults });
})(KIT);
