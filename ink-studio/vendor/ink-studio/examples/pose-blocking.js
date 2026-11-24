/* One puppet and one pose sampler, shared by Node and the browser preview. */
function buildSignalCourier({ makeBuilder, makeSculpt, KIT: K }, seed, decorate, extraPalette = []) {
  const B = makeBuilder(seed, [0x111923, 0x17343e, 0x25666d, 0x39a6a1, 0x83ded0,
    0x112529, 0x294951, 0x557179, 0x80949a, 0x884726, 0xca6830, 0xf29b47, 0xffdc83, 0xeff8df, ...extraPalette]);
  const S = K.sculpt(makeSculpt(B)), tags = K.deform.tags(S);
  const teal = { r: [1, 2, 3, 4] }, steel = { r: [5, 6, 7, 8] }, brass = { r: [9, 10, 11, 12] };
  const light = { r: [10, 11, 12, 13], em: true };
  const parts = {};
  function define(name, pivot, parent) {
    parts[name] = { pivot, parent, ids: [] };
    const option = { tag: name, res: 0.066 };
    return {
      box: (p, half, mat, rd = 0.08) => S.box(p, half, mat, { ...option, rd }),
      ball: (p, radius, mat) => S.ball(p, radius, mat, option)
    };
  }
  const body = define('body', [0, 1.34, 0]);
  body.box([0, 1.75, 0], [0.48, 0.48, 0.26], teal, 0.15);
  body.box([0, 1.67, -0.245], [0.21, 0.21, 0.07], steel);
  body.ball([0, 1.68, -0.31], [0.11, 0.11, 0.045], light);
  body.box([0, 1.32, 0], [0.38, 0.09, 0.24], brass);
  const head = define('head', [0, 2.2, 0], 'body');
  head.box([0, 2.52, 0], [0.43, 0.32, 0.31], teal, 0.16);
  head.box([0, 2.53, -0.255], [0.35, 0.15, 0.085], steel, 0.095);
  for (const x of [-0.15, 0.15]) head.box([x, 2.53, -0.338], [0.065, 0.058, 0.025], light, 0.024);
  head.box([0, 2.87, 0.03], [0.038, 0.13, 0.038], brass, 0.025);
  head.ball([0, 3, 0.03], 0.076, light);
  const pairs = [];
  for (const limb of ['Arm', 'Forearm', 'Leg', 'Boot']) pairs.push(['left' + limb, 'right' + limb]);
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right', x = side * 0.57;
    const arm = define(name + 'Arm', [x, 2.02, 0], 'body');
    arm.ball([x, 1.98, 0], 0.17, brass);
    arm.box([x, 1.77, 0], [0.125, 0.27, 0.12], teal);
    const forearm = define(name + 'Forearm', [x, 1.54, 0], name + 'Arm');
    forearm.box([x, 1.29, 0], [0.15, 0.26, 0.145], steel);
    forearm.box([x, 1.08, -0.026], [0.16, 0.11, 0.15], brass);
    const hip = side * 0.25;
    const leg = define(name + 'Leg', [hip, 1.32, 0]);
    leg.box([hip, 0.94, 0], [0.143, 0.40, 0.145], steel);
    leg.ball([hip, 0.57, -0.03], 0.148, teal);
    const boot = define(name + 'Boot', [hip, 0.57, 0], name + 'Leg');
    boot.box([hip, 0.32, 0], [0.15, 0.245, 0.15], teal);
    boot.box([hip, 0.13, -0.1], [0.20, 0.13, 0.255], brass);
  }
  decorate?.({ B, S, define });
  S.bake();
  for (const [name, part] of Object.entries(parts)) part.ids = tags[name];
  const world = B.finish({
    cam: { target: [0, 1.68, 0], dist: 6.6, pitch: 0.08, yaw: Math.PI },
    radius: 4, detail: 22, dither: 0.16
  });
  return { world, parts, pairs };
}

function poseBlockingScene(kit) {
  const { KIT: K } = kit;
  function build(seed, { controls = {} } = {}) {
    const { world, parts, pairs } = buildSignalCourier(kit, seed);
    const shelf = K.anim.poseShelf.create({ pairs });
    shelf.save('ready', {
      leftArm: { rot: [-9, 0, -14] }, rightArm: { rot: [-9, 0, 14] },
      leftForearm: { rot: [-12, 0, 0] }, rightForearm: { rot: [-12, 0, 0] }
    }, { name: 'Ready' });
    shelf.save('anticipation', {
      body: { pos: [0, -0.14, 0], rot: [10, -11, -13] }, head: { rot: [5, 12, 12] },
      leftArm: { rot: [-4, 0, -28] }, rightArm: { rot: [16, 0, 26] },
      rightForearm: { rot: [-29, 0, 0] }
    }, { name: 'Wind-up' });
    shelf.save('reach', {
      body: { rot: [0, 12, 12], pos: [0, 0.07, 0] }, head: { rot: [-9, -12, -10] },
      leftArm: { rot: [-23, 0, -22] }, rightArm: { rot: [-22, 0, 144] },
      rightForearm: { rot: [0, 7, 28] }, leftLeg: { rot: [4, 0, -9] }
    }, { name: 'Signal right' });
    shelf.save('reach-left', shelf.apply('reach', { mirror: true }), { name: 'Signal left' });
    const duration = 3.2, edits = new Map();
    let authoredTime = controls.breakTime ?? 0.82, authoredBias = controls.bias ?? 0.72;
    function timeline(time, bias) {
      const keys = new Map([
        { time: 0, pose: 'ready' },
        { time: 0.48, pose: 'anticipation' },
        { time, bias, name: 'Lift' },
        { time: 1.28, pose: 'reach', ease: 'step' },
        { time: 1.64, pose: 'reach', name: 'Hold signal' },
        { time: 1.98, bias: 0.5, name: 'Cross over' },
        { time: 2.38, pose: 'reach-left' },
        { time: duration, pose: 'ready', name: 'Settle' }
      ].map(key => [key.time, key]));
      for (const [at, pose] of edits) keys.set(at, { time: at, pose });
      return K.anim.poseBlocking.create(shelf, { duration, fps: 12, keys: [...keys.values()] });
    }
    let blocking = timeline(authoredTime, authoredBias), mode = controls.mode ?? 'spline', override;
    const activeClip = () => mode === 'held' ? blocking.held : blocking.clip;
    world.poseBlocking = blocking;
    K.puppet(world, { parts, pose(time, dt, puppet) {
      if (override) Object.assign(puppet.pose, override);
      else activeClip().sample(time, puppet.pose);
    } });
    world.poseDemo = {
      shelf,
      setBreakdown(time, bias) {
        world.poseBlocking = blocking = timeline(time, bias);
        authoredTime = time;
        authoredBias = bias;
      },
      setMode(value) { mode = value; },
      preview(id, { time, ...options }) {
        override = shelf.apply(id, { base: activeClip().sample(time), ...options });
      },
      save(id, name, time) { return shelf.save(id, override ?? activeClip().sample(time), { name }); },
      key(id, time) {
        edits.set(time, id);
        world.poseBlocking = blocking = timeline(authoredTime, authoredBias);
        override = undefined;
      },
      clearPreview() { override = undefined; }
    };
    return world;
  }
  return { id: 'pose-blocking', name: 'Signal courier', seed: 17, build };
}
if (typeof module === 'object') {
  module.exports = poseBlockingScene;
  module.exports.buildSignalCourier = buildSignalCourier;
}
