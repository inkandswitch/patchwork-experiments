/* Deliberately uneven motion for the Signal courier puppet. */
function motionReviewScene(kit) {
  const { KIT: K } = kit;
  const courier = typeof module === 'object' ? require('./pose-blocking').buildSignalCourier : buildSignalCourier;
  function build(seed, { controls = {} } = {}) {
    const { world, parts } = courier(kit, seed);
    const zero = [0, 0, 0], fps = 24, duration = 4;
    const keys = rows => rows.map(([frame, value, ease = 'linear']) => [frame/fps, value, ease]);
    const clip = K.anim.clip({ name: 'Signal test', fps, dur: duration, loop: true, tracks: {
      'rightArm.rot': [[0, [-10, 0, 40]]],
      'rightForearm.rot': [[0, [-25, 0, 22]]],
      'rightForearm.pos': keys([[0, zero], [8, [0.02, 0, 0]], [14, [0.11, 0.025, 0]], [15, [0.33, 0.086, 0]],
        [21, [0.44, 0.116, 0], 'smooth'], [32, zero]]),
      'leftArm.rot': [[0, [-10, 0, -36]]],
      'leftForearm.rot': [[0, [-19, 0, -25]]],
      'leftForearm.pos': keys([[32, zero], [40, [-0.075, 0.02, 0]], [47, [-0.32, 0.082, 0]],
        [53, [-0.32, 0.35, 0]], [58, [-0.27, 0.48, 0]], [63, [-0.15, 0.52, 0]],
        [68, [-0.04, 0.48, 0]], [75, [0.02, 0.35, 0]], [85, zero]]),
      'leftBoot.pos': keys([[0, zero], [52, zero, 'smooth'], [56, [-0.11, 0.13, 0], 'smooth'],
        [60, [-0.17, 0, 0]], [74, [0.12, 0, 0]], [78, [0.14, 0.13, 0], 'smooth'], [83, zero]]),
      'body.pos': keys([[0, zero], [86, zero, 'smooth'], [94, [0.21, 0.05, 0]]]),
      'head.rot': keys([[0, zero], [86, zero, 'smooth'], [94, [12, -17, -28]]])
    } });
    let review, preview = {};
    const puppet = K.puppet(world, { parts, pose(time, dt, actor) {
      (review ?? clip).sample(time, actor.pose, preview);
    } });
    review = K.anim.motionReview.create({ clip, puppet, height: 3, fps, probes: [
      { id: 'right-hand', label: 'Right glove', part: 'rightForearm', point: [0.57, 1.08, -0.026] },
      { id: 'left-hand', label: 'Left glove', part: 'leftForearm', point: [-0.57, 1.08, -0.026] },
      { id: 'left-sole', label: 'Left sole', part: 'leftBoot', point: [-0.25, 0, -0.1], foot: true },
      { id: 'antenna', label: 'Antenna', part: 'head', point: [0, 3, 0.03] }
    ] });
    if (controls.fix) for (const finding of review.findings)
      if (controls.fix === true || controls.fix === finding.kind) review.accept(finding.id);
    world.motionReview = review;
    world.motionDemo = {
      update(time, { before = false } = {}) {
        preview = { sourceTime: true, before };
        try { world.anim.update(0, time); }
        finally { preview = {}; }
      }
    };
    return world;
  }
  return { id: 'motion-review', name: 'Signal courier motion review', seed: 17, build };
}
if (typeof module === 'object') module.exports = motionReviewScene;
