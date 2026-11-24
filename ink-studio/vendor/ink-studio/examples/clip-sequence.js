/* Reusable actions for the Signal courier. All trims belong to the sequence. */
function clipSequenceScene(kit) {
  const { KIT: K } = kit;
  const courier = typeof module === 'object' ? require('./pose-blocking').buildSignalCourier : buildSignalCourier;
  function build(seed, { controls = {} } = {}) {
    const { world, parts } = courier(kit, seed);
    parts.leftLeg.parent = parts.rightLeg.parent = 'body';
    world.cam.target = [0.45, 1.68, 0];
    const zero = [0, 0, 0];
    const line = pairs => pairs.map(([t, value]) => [t, value, 'linear']);
    const clips = {
      stride: K.anim.clip({ name: 'Stride', fps: 24, dur: 1.2, loop: true, tracks: {
        'body.pos': line([[0, zero], [1.2, [0.96, 0, 0]]]),
        'leftLeg.pos': line([[0, [0.24, 0, 0]], [0.6, [-0.24, 0, 0]],
          [0.75, [-0.13, 0.16, -0.01]], [0.90, [0, 0.24, -0.03]],
          [1.05, [0.13, 0.15, -0.02]], [1.2, [0.24, 0, 0]]]),
        'rightLeg.pos': line([[0, [-0.24, 0, 0]], [0.15, [-0.13, 0.15, 0.01]],
          [0.30, [0, 0.23, 0.03]], [0.45, [0.13, 0.16, 0.02]],
          [0.6, [0.24, 0, 0]], [1.2, [-0.24, 0, 0]]]),
        'leftArm.rot': [[0, [24, 0, -17]], [0.6, [-24, 0, -21]], [1.2, [24, 0, -17]]],
        'rightArm.rot': [[0, [-24, 0, 21]], [0.6, [24, 0, 17]], [1.2, [-24, 0, 21]]],
        'head.rot': [[0, [0, 0, 0]], [0.6, [0, -10, 3]], [1.2, [0, 0, 0]]]
      }, cues: [[0, 'Left step'], [0.6, 'Right step']] }),
      settle: K.anim.clip({ name: 'Settle', fps: 24, dur: 0.9, tracks: {
        'body.pos': line([[0, [-0.1, 0, 0]], [0.9, [-0.1, 0, 0]]]),
        'leftLeg.pos': [[0, [0.24, 0.02, 0]], [0.36, [0.24, 0.02, 0]], [0.9, zero]],
        'rightLeg.pos': [[0, [-0.04, 0, 0]], [0.46, [-0.04, 0, 0]], [0.9, zero]],
        'leftArm.rot': [[0, [-9, 0, -112]], [0.25, [24, 0, -17]], [0.38, [24, 0, -17]], [0.9, [-9, 0, -14]]],
        'rightArm.rot': [[0, [-8, 0, 105]], [0.25, [-24, 0, 21]], [0.38, [-24, 0, 21]], [0.9, [-9, 0, 14]]],
        'head.rot': [[0, [0, -35, 25]], [0.25, zero], [0.9, zero]]
      }, cues: [[0.34, 'Plant'], [0.78, 'Settle']] }),
      signal: K.anim.clip({ name: 'Signal', fps: 24, dur: 1.1, tracks: {
        'body.pos': [[0, zero]],
        'leftArm.rot': [[0, [-9, 0, -14]], [0.42, [-20, 0, -35]], [1.1, [-9, 0, -14]]],
        'rightArm.rot': [[0, [-9, 0, 14]], [0.42, [-22, 0, 140]], [0.72, [-22, 0, 140]], [1.1, [-9, 0, 14]]],
        'head.rot': [[0, zero], [0.42, [0, -12, 13]], [0.72, [0, -12, 13]], [1.1, zero]]
      }, cues: [[0.42, 'Signal up'], [0.72, 'Signal off']] })
    };
    const base = [{ id: 'walk', clip: 'stride' }, { id: 'stop', clip: 'settle' }, { id: 'wave', clip: 'signal' }];
    let timeline, active, mode = 'once';
    const puppet = K.puppet(world, { parts, pose(time, dt, actor) {
      active.sample(time, actor.pose, { mode });
    } });
    const rig = { clips, puppet, root: 'body', height: 3, feet: [
      { id: 'left-sole', part: 'leftBoot', point: [-0.25, 0, -0.1] },
      { id: 'right-sole', part: 'rightBoot', point: [0.25, 0, -0.1] }
    ] };
    const cycle = K.anim.sequence.create({ ...rig, steps: [{ id: 'cycle', clip: 'stride' }] });
    function replace(next) {
      world.clipSequence = timeline = next;
      active = timeline;
      return timeline;
    }
    replace(K.anim.sequence.create({ ...rig, steps: controls.steps ?? base, alignment: controls.alignment ?? 'source' }));
    if (controls.edit) replace(timeline.edit(controls.edit.step, controls.edit));
    if (Number.isInteger(controls.cut)) replace(timeline.applyCut(controls.cut));
    if (controls.cycle) active = cycle;
    mode = controls.mode ?? 'once';
    world.sequenceDemo = {
      clips, cycle, replace,
      update(time, { plan = timeline, playback = 'once' } = {}) {
        active = plan;
        mode = playback;
        world.anim.update(0, time);
      }
    };
    return world;
  }
  return { id: 'clip-sequence', name: 'Signal courier sequence', seed: 17, build };
}
if (typeof module === 'object') module.exports = clipSequenceScene;
