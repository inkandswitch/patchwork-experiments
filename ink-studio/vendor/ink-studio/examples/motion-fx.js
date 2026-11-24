/* Four independently timed effects on one courier turn. */
function motionFxScene(kit) {
  const { KIT: K } = kit;
  const courier = typeof module === 'object' ? require('./pose-blocking').buildSignalCourier : buildSignalCourier;
  const duration = 2.5;
  const layers = [
    { id: 'torso-stretch', kind: 'stretch', parts: ['body'], axis: [1, 0, 0], strength: 0.84,
      keys: [[0.77, 0], [1.06, 1], [1.30, 0]] },
    { id: 'cape-smear', kind: 'smear', parts: ['cape'], length: 0.57, gain: 0.20,
      keys: [[0.95, 0], [1.18, 0.95], [1.49, 0]] },
    { id: 'cape-trail', kind: 'trail', parts: ['cape'], color: 16, copies: 3, opacity: 0.24, lookback: 0.34,
      keys: [[1.09, 0], [1.37, 0.92], [1.60, 0.78], [1.79, 0]] },
    { id: 'lantern-sweep', kind: 'sweep', parts: ['lantern'], color: 11, width: 0.092, spacing: 0.053,
      base: [0.61, 1.08, -0.045], tip: [0.61, 0.60, -0.045], lookback: 0.25, samples: 12,
      keys: [[1.26, 0], [1.43, 1], [1.58, 0.9], [1.73, 0]] }
  ];
  function build(seed, { controls = {} } = {}) {
    let fx;
    const grip = [0.61, 1.08, -0.045];
    const { world, parts } = courier(kit, seed, ({ B, S, define }) => {
      const cape = define('cape', [0, 2.12, 0.25], 'body');
      const cloth = { r: [14, 15, 16, 17] }, hem = { r: [15, 16, 17] };
      cape.box([0, 1.75, 0.32], [0.40, 0.43, 0.058], cloth, 0.055);
      cape.box([0, 1.38, 0.41], [0.52, 0.28, 0.062], cloth, 0.055);
      cape.box([0, 1.14, 0.45], [0.52, 0.055, 0.063], hem, 0.04);
      const lantern = define('lantern', grip, 'rightForearm');
      const brass = { r: [9, 10, 11, 12] }, glow = { r: [10, 11, 12, 13], em: true };
      lantern.box([0.61, 0.89, -0.045], [0.14, 0.037, 0.12], brass, 0.03);
      lantern.box([0.61, 0.75, -0.045], [0.105, 0.13, 0.105], glow, 0.04);
      lantern.box([0.61, 0.61, -0.045], [0.14, 0.045, 0.12], brass, 0.035);
      S.tube([[0.49, 0.89, -0.045], [0.52, 1.03, -0.045], grip, [0.70, 1.03, -0.045], [0.73, 0.89, -0.045]],
        0.022, 0.022, brass, { tag: 'lantern', res: 0.032 });
      fx = K.anim.motionFx.create(B, { duration, capacity: 8000, trailLimit: 600,
        effects: layers.map(layer => ({ ...layer, enabled: controls.fx !== false && (controls.only === undefined || controls.only === layer.kind) }))
      });
    }, [0x291935, 0x5e3b79, 0xa96bab, 0xe2abd0]);
    parts.leftLeg.parent = parts.rightLeg.parent = 'body';
    parts.cape.slices = 4;
    world.cam.target = [0, 1.60, 0];
    world.cam.dist = 6.9;
    const clip = K.anim.clip({ dur: duration, tracks: {
      'body.pos': [[0, [0, 0, 0]], [0.69, [-0.28, -0.03, 0]], [0.93, [-0.34, -0.08, 0]],
        [1.19, [0.14, 0.07, 0]], [1.48, [0.56, 0, 0]], [1.91, [0.32, 0, 0]], [duration, [0.1, 0, 0]]],
      'body.rot': [[0, [0, -14, 0]], [0.72, [0, -46, -8]], [0.96, [0, -58, -11], 'linear'],
        [1.47, [0, 291, 8]], [1.98, [0, 347, 0]], [duration, [0, 347, 0]]],
      'rightArm.rot': [[0, [-22, 0, 27]], [0.87, [-20, 0, 39]], [1.22, [-14, 0, 78]], [1.59, [0, 0, 86]], [2.07, [-23, 0, 28]]],
      'rightForearm.rot': [[0, [-15, 0, 15]], [1.20, [0, 0, 15]], [1.54, [9, 0, 13]], [2.16, [-15, 0, 15]]],
      'lantern.rot': [[0, [23, 0, -38]], [1.28, [0, 0, -70]], [1.58, [0, 0, -90]], [2.14, [23, 0, -38]]],
      'leftArm.rot': [[0, [0, 0, -17]], [1.03, [12, 0, -25]], [1.43, [-12, 0, -58]], [1.96, [0, 0, -19]]],
      'cape.rot': [[0, [0, 0, 0]], [0.92, [11, -18, 7]], [1.37, [44, -35, 30]], [1.62, [31, 19, -23]], [2.15, [0, 0, 0]]]
    } });
    const source = (time, actor) => clip.sample(time, actor.pose, { sourceTime: true });
    let state, before = false;
    const puppet = K.puppet(world, { parts, pose(time, dt, actor) {
      source(time, actor);
      state = fx.apply(time, { before });
    } });
    fx.bind(world, puppet, source);
    world.motionFx = fx;
    world.motionFxDemo = { names: puppet.names.slice(), update(time, { source = false } = {}) {
      before = source;
      try { world.anim.update(0, time); }
      finally { before = false; }
      return state;
    } };
    return world;
  }
  return { id: 'motion-fx', name: 'Signal courier motion FX', seed: 17, build };
}
if (typeof module === 'object') module.exports = motionFxScene;
