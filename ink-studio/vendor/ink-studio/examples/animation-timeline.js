/* A headless shot that shares timing, contacts, FX, cloth, and sprite framing. */
module.exports = kit => {
  const { KIT: K } = kit;
  const { buildSignalCourier } = require('./pose-blocking');
  const duration = 4, grip = [1.27, 1.49, -0.2], hand = [0.57, 1.08, -0.045], sole = [-0.25, 0, -0.1];
  function build(seed) {
    let cape, fx;
    const { world, parts, pairs } = buildSignalCourier(kit, seed, ({ B, S, define }) => {
      const steel = { r: [5, 6, 7, 8] }, brass = { r: [9, 10, 11, 12] }, glow = { r: [10, 11, 12, 13], em: true };
      S.box([grip[0], 0.38, grip[2]], [0.26, 0.38, 0.24], steel, { rd: 0.07 });
      S.box([grip[0], 0.78, grip[2]], [0.34, 0.09, 0.29], brass, { rd: 0.055 });
      const lantern = define('lantern', grip);
      lantern.box([grip[0], 0.93, grip[2]], [0.19, 0.085, 0.17], brass, 0.025);
      lantern.box([grip[0], 1.12, grip[2]], [0.12, 0.15, 0.11], glow, 0.035);
      lantern.box([grip[0], 1.29, grip[2]], [0.18, 0.06, 0.15], brass, 0.025);
      for (const sign of [-1, 1]) lantern.box([grip[0] + 0.10 * sign, 1.40, grip[2]], [0.027, 0.11, 0.027], brass, 0.021);
      lantern.box(grip, [0.105, 0.022, 0.03], brass, 0.013);
      cape = K.cloth(B, { nu: 9, nv: 11, dabs: 3, at: [-0.52, 2.11, 0.32], u: [1.04, 0, 0], v: [0, -1.18, 0.12],
        density: 0.47, bend: 0.0015,
        pattern: (u, v) => u < 0.13 || u > 0.87 || v > 0.88 ? [9, 10, 11, 12] : [14, 15, 16, 17] });
      fx = K.anim.motionFx.create(B, { duration, capacity: 3600, effects: [
        { id: 'reach-accent', kind: 'stretch', parts: ['body'], axis: [0, 1, 0], strength: 0.23,
          keys: [[0.85, 0], [1.16, 1], [1.38, 0]] },
        { id: 'lantern-sweep', kind: 'sweep', parts: ['lantern'], base: grip, tip: [grip[0], 0.93, grip[2]],
          lookback: 0.23, width: 0.055, color: 11, keys: [[1.37, 0], [1.65, 1], [1.91, 0]] }
      ] });
    }, [0x38254d, 0x684881, 0xa17caf, 0xd3accc]);
    parts.leftLeg.parent = parts.rightLeg.parent = 'body';
    world.cam.target = [0.23, 1.56, 0];
    world.cam.dist = 7.0;

    const puppet = K.puppet(world, { parts }), shelf = K.anim.poseShelf.create({ pairs });
    shelf.save('wait', {
      body: { pos: [-0.14, -0.02, 0] }, rightLeg: { pos: [0, 0.02, 0] },
      rightArm: { rot: [0, 0, 18] }, leftArm: { rot: [0, 0, -18] }
    }, { name: 'Ready at the plinth' });
    shelf.save('reach', {
      body: { pos: [0.18, -0.12, 0], rot: [0, -9, -6] }, rightLeg: { pos: [0, 0.12, 0] },
      rightArm: { rot: [0, 0, 43] }, rightForearm: { rot: [0, 0, 25] },
      leftArm: { rot: [0, 0, -28] }, head: { rot: [9, -23, -9] }
    }, { name: 'Reach for the lantern' });
    shelf.save('raise', {
      body: { pos: [-0.26, 0.01, 0], rot: [0, 20, 0] }, rightLeg: { pos: [0, -0.01, 0] },
      rightArm: { rot: [0, 0, 72] }, rightForearm: { rot: [-3, 0, 31] },
      leftArm: { rot: [0, 0, -23] }, head: { rot: [0, 16, 9] }
    }, { name: 'Raise lantern' });
    const pickup = K.anim.poseBlocking.create(shelf, { duration: 2.4, fps: 12, keys: [
      { time: 0, pose: 'wait' }, { time: 0.64, pose: 'wait', name: 'Look at the plinth' },
      { time: 0.96, bias: 0.62, name: 'Lift hand' }, { time: 1.25, pose: 'reach' }, { time: 2.4, pose: 'raise' }
    ] });
    const end = shelf.apply('raise');
    const turn = K.anim.clip({ dur: 1.6, fps: 12, tracks: [
      ...Object.entries(end).flatMap(([part, channels]) => Object.entries(channels)
        .filter(([channel]) => part !== 'head' || channel !== 'rot')
        .map(([ch, value]) => ({ part, ch, keys: [[0, value]] }))),
      { part: 'head', ch: 'rot', keys: [[0, end.head.rot], [1.6, [0, 38, 12]]] }
    ], cues: [[0.72, 'lantern-raised']] });
    const sequence = K.anim.sequence.create({ clips: { pickup, turn }, fps: 12, root: 'body', steps: [
      { id: 'pickup', clip: 'pickup', ease: 'in-out-sine' }, { id: 'turn', clip: 'turn' }
    ] });

    const takeStart = 2.22;
    const capeRest = cape.restPose();
    function capePose(actor) {
      const points = new Float32Array(capeRest.length);
      for (let i = 0; i < points.length; i += 3) {
        const v = Math.floor(i / (3 * cape.nu)) / (cape.nv - 1);
        points.set(actor.point('body', [capeRest[i] + 0.22 * v * v, capeRest[i + 1] + 0.14 * v * v,
          capeRest[i + 2] + 0.33 * v * v]), i);
      }
      return points;
    }
    const capture = K.deform.inspectPoses(puppet, solve => capePose(solve(sequence.sample(takeStart))));
    const cloth = K.cloth.review.create(cape, { maxSeconds: 5, speed: 0.08, quietFor: 0.25 });
    cloth.start(capture, { sourceTime: takeStart, damp: 9, substeps: 8 });
    cloth.advance(5);
    const take = cloth.bake();

    world.animationTimeline = K.anim.timeline.create({ world, puppet, sequence, fx,
      sprite: { width: 96, height: 96, directions: 8, fps: 12 },
      contacts: { height: 3, sockets: { plinth: { point: grip }, hand: { part: 'rightForearm', point: hand },
        sole: { point: sole } },
        contacts: [{ id: 'left-plant', upper: 'leftLeg', part: 'leftBoot', point: sole, target: 'sole',
          start: 0.34, end: 2.42, fadeIn: 0.18, fadeOut: 0.29, pole: [0, 0, -1] }],
        prop: { part: 'lantern', socket: 'plinth', keys: [
          { id: 'pickup', time: 1.29, to: 'hand', settle: 0.34, reach: { upper: 'rightArm', pole: [0, -1, -0.3] } }
        ] }
      },
      cloth: [{ id: 'cape-settle', panel: cape, take, before: (time, actor) => capePose(actor) }],
      review: { height: 3, loop: true, probes: [
        { id: 'glove', part: 'rightForearm', point: hand },
        { id: 'sole', part: 'leftBoot', point: sole, foot: true },
        { id: 'head', part: 'head', point: [0, 2.55, 0] }
      ] }
    });
    return world;
  }
  return { id: 'animation-timeline', name: 'Signal courier shared timeline', seed: 17, build };
};
