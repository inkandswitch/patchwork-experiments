/* A lantern pickup with a keyed owner switch and an independently planted foot. */
function authoredContactsScene(kit) {
  const { KIT: K } = kit;
  const courier = typeof module === 'object' ? require('./pose-blocking').buildSignalCourier : buildSignalCourier;
  function build(seed, { controls = {} } = {}) {
    const grip = [1.27, 1.49, -0.2], hand = [0.57, 1.08, -0.045], sole = [-0.25, 0, -0.1];
    const { world, parts } = courier(kit, seed, ({ S, define }) => {
      const steel = { r: [5, 6, 7, 8] }, brass = { r: [9, 10, 11, 12] }, glow = { r: [10, 11, 12, 13], em: true };
      const [x, , z] = grip;
      S.box([x, 0.42, z], [0.22, 0.40, 0.23], steel, { rd: 0.075, res: 0.072 });
      S.box([x, 0.78, z], [0.34, 0.08, 0.32], steel, { rd: 0.035, res: 0.063 });
      S.box([x, 0.15, z], [0.32, 0.11, 0.30], brass, { rd: 0.06, res: 0.071 });
      const lantern = define('lantern', grip);
      lantern.box([x, 0.94, z], [0.20, 0.085, 0.19], brass, 0.035);
      lantern.box([x, 1.12, z], [0.15, 0.16, 0.14], glow, 0.04);
      lantern.box([x, 1.30, z], [0.19, 0.07, 0.17], brass, 0.04);
      for (const offset of [-0.155, 0.155]) {
        lantern.box([x + offset, 1.12, z - 0.134], [0.035, 0.14, 0.025], steel, 0.018);
        lantern.box([x + offset * 0.70, 1.405, z], [0.028, 0.12, 0.03], brass, 0.022);
      }
      lantern.box([x, grip[1], z], [0.12, 0.027, 0.035], brass, 0.022);
    });
    parts.leftLeg.parent = parts.rightLeg.parent = 'body';
    world.cam.target = [0.24, 1.58, 0];
    world.cam.dist = 6.7;
    const duration = 3.4;
    const clip = K.anim.clip({ dur: duration, tracks: {
      'body.pos': [[0, [-0.18, -0.08, 0]], [0.55, [-0.18, -0.08, 0]], [1.22, [0.08, -0.16, 0]],
        [1.58, [0.06, -0.11, 0]], [2.35, [-0.37, -0.07, 0]], [duration, [-0.37, -0.07, 0]]],
      'rightLeg.pos': [[0, [0, 0.08, 0]], [0.55, [0, 0.08, 0]], [1.22, [0, 0.16, 0]],
        [1.58, [0, 0.11, 0]], [2.35, [0, 0.07, 0]]],
      'leftArm.rot': [[0, [0, 0, -19]], [1.18, [-14, 0, -43]], [2.37, [0, 0, -21]]],
      'rightArm.rot': [[0, [0, 0, 22]], [0.76, [0, 0, 27]], [1.22, [0, 0, 44]],
        [1.43, [0, 0, 68]], [1.78, [0, 0, 78]]],
      'rightForearm.rot': [[0, [0, 0, 5]], [1.08, [0, 0, 9]], [1.43, [0, 0, 20]]],
      'head.rot': [[0, [0, 0, 0]], [1.15, [10, -21, -12]], [2.5, [-4, 9, 0]]]
    } });
    let timeline, current, spec = { time: 1.22, settle: 0.42, pinStart: 0.38, pinEnd: 2.56,
      pin: true, transfer: true, ...controls };
    const puppet = K.puppet(world, { parts, pose(time) { current = timeline.pose(time); } });
    function compile(next) {
      return K.anim.contacts.create({ duration, puppet, height: 3, sample: time => clip.sample(time, {}, { sourceTime: true }),
        sockets: {
          plinth: { p: grip, dir: [0, 1, 0] },
          'right-hand': { part: 'rightForearm', point: hand, rotation: [0, 0, -98] },
          'left-sole': { point: sole }
        },
        contacts: [{ id: 'plant-left', upper: 'leftLeg', part: 'leftBoot', point: sole, target: 'left-sole',
          start: next.pinStart, end: next.pinEnd, fadeIn: Math.min(0.17, (next.pinEnd - next.pinStart) / 2),
          fadeOut: Math.min(0.28, (next.pinEnd - next.pinStart) / 2), pole: [0, 0, -1], enabled: next.pin }],
        prop: { part: 'lantern', socket: 'plinth', keys: next.transfer ? [
          { id: 'pickup', time: next.time, to: 'right-hand', settle: next.settle,
            reach: { upper: 'rightArm', pole: [0, -1, -0.3] } }
        ] : [] }
      });
    }
    world.contactTimeline = timeline = compile(spec);
    world.contactDemo = {
      edit(patch) {
        const next = { ...spec, ...patch };
        const plan = compile(next);
        spec = next;
        return world.contactTimeline = timeline = plan;
      },
      update(time) {
        world.anim.update(0, time);
        return current;
      }
    };
    return world;
  }
  return { id: 'authored-contacts', name: 'Signal courier lantern pickup', seed: 17, build };
}
if (typeof module === 'object') module.exports = authoredContactsScene;
