/* A lantern performance layered over two uninterrupted walking strides. */
module.exports = kit => {
  const { KIT: K } = kit;
  const courier = require('./retarget-courier.js').lantern(kit);
  function build(seed, { controls = {} } = {}) {
    const world = courier.build(seed);
    const { puppet, clips: { walk } } = world.retargetRig;
    world.cam.target = [0, 1.45, 0.85];
    const sequence = K.anim.sequence.create({ clips: { walk }, root: 'body', alignment: 'root',
      steps: [{ id: 'stride-a', clip: 'walk' }, { id: 'stride-b', clip: 'walk' }] });
    const lift = K.anim.clip({ id: 'lift', dur: 1.5, tracks: {
      'jacket.rot': [[0, [2, -6, 0]], [0.54, [-7, -21, 0]], [1.12, [-7, -21, 0]], [1.5, [2, -6, 0]]],
      'sleeve-r.rot': [[0, [-15, 0, 0]], [0.54, [-91, 6, 0]], [1.12, [-91, 6, 0]], [1.5, [-12, 0, 0]]],
      'glove-r.rot': [[0, [-8, 0, 0]], [0.54, [-23, 0, 0]], [1.12, [-23, 0, 0]], [1.5, [-8, 0, 0]]],
      'lantern.rot': [[0, [23, 0, 0]], [0.54, [122, -6, 0]], [1.12, [122, -6, 0]], [1.5, [20, 0, 0]]]
    } });
    const glance = K.anim.clip({ id: 'glance', dur: 0.66, tracks: {
      'jacket.rot': [[0, [-7, -21, 0]], [0.33, [-12, -32, -5]], [0.66, [-7, -21, 0]]],
      'hood.rot': [[0, [0, 0, 0]], [0.33, [17, 32, 10]], [0.66, [0, 0, 0]]]
    } });
    let motionLayers = K.anim.motionLayers.create({ duration: sequence.duration, sources: { lift, glance }, parts: puppet.names, layers: [
      { id: 'lantern-lift', label: 'Lift lantern', clip: 'lift', parts: ['jacket', 'sleeve-r', 'glove-r', 'lantern'],
        start: 0.24, end: 1.78, enabled: !controls.baseOnly,
        weight: [[0.24, 0, 'bezier', [0.26, 0, 0.4, 1]], [0.69, 1], [1.46, 1], [1.78, 0]] },
      { id: 'glance', label: 'Look into the light', clip: 'glance', parts: ['jacket', 'hood'],
        start: 0.80, end: 1.46, enabled: !controls.baseOnly,
        weight: [[0.80, 0], [1.13, 0.72], [1.46, 0]] }
    ] });
    for (const [id, patch] of Object.entries(controls.layerEdits ?? {})) motionLayers = motionLayers.edit(id, patch);
    if (controls.layerOrder !== undefined) motionLayers = motionLayers.arrange(controls.layerOrder);
    world.animationTimeline = K.anim.timeline.create({ world, puppet, sequence, motionLayers,
      sprite: { width: 112, height: 96, directions: 8, fps: 12 } });
    world.animationTimeline.set({ stage: 'spline' });
    return world;
  }
  return { id: 'motion-layers', name: 'Lantern lift over a walk', seed: courier.seed, build };
};
