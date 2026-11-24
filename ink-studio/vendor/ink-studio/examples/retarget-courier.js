/* A walking courier and a differently proportioned guard using the same semantic profile. */
function character(kit, guard, withLantern = false) {
  const { KIT: K, makeBuilder, makeSculpt } = kit;
  const id = guard ? 'retarget-guard' : 'retarget-courier';
  const palette = [0x121923, 0x392639, 0x783548, 0xb95359, 0xe9876b, 0x183641, 0x295b69, 0x398e90,
    0x81bdb2, 0x87593c, 0xc18858, 0xf1bc77, 0xffe0aa];
  const legScale = guard ? 1.44 : 1, stride = 0.85 * legScale, bootY = 0.15 * legScale;
  const thigh = 0.49 * legScale, shin = 0.47 * legScale, hipsY = bootY + thigh + shin;
  const waist = guard ? 0.31 : 0.24, chest = guard ? 0.51 : 0.34, torsoLen = guard ? 0.88 : 0.67;
  const shoulderY = hipsY + torsoLen, headY = shoulderY + (guard ? 0.37 : 0.30);
  const names = guard ? { hips: 'belt-pivot', spine: 'armor', head: 'visor' } : { hips: 'body', spine: 'jacket', head: 'hood' };
  for (const side of ['left', 'right']) {
    const letter = side[0];
    for (const [role, part] of Object.entries(guard
      ? { Thigh: 'cuisses', Shin: 'greave', Foot: 'sabatons', UpperArm: 'pauldron', Forearm: 'gauntlet' }
      : { Thigh: 'trouser', Shin: 'calf', Foot: 'boot', UpperArm: 'sleeve', Forearm: 'glove' }))
      names[side + role] = part + '-' + letter;
  }

  function build(seed) {
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), tags = K.deform.tags(S);
    const parts = {}, roles = { ...names };
    const outer = { r: guard ? [1, 2, 3, 4] : [5, 6, 7, 8] };
    const dark = { r: guard ? [1, 2, 3] : [5, 6, 7] }, brass = { r: [9, 10, 11, 12] };
    const eye = { r: [10, 11, 12], em: true };
    const part = (role, pivot, parent) => {
      const tag = names[role] ?? role;
      parts[tag] = { ids: [], pivot, parent: parent && names[parent] };
      return {
        box: (center, size, mat = outer, rd = 0.05) => S.box(center, size, mat, { tag, rd, res: 0.055 }),
        ball: (center, size, mat = outer) => S.ball(center, size, mat, { tag, res: 0.055 })
      };
    };
    part('hips', [0, hipsY, 0]).box([0, hipsY, 0], [waist + 0.18, 0.095, 0.20], brass);
    const body = part('spine', [0, hipsY + 0.12, 0], 'hips');
    body.box([0, hipsY + torsoLen * 0.56, 0], [chest, torsoLen * 0.50, guard ? 0.32 : 0.23], outer, 0.15);
    body.box([0, hipsY + torsoLen * 0.6, 0.25], [guard ? 0.20 : 0.14, 0.13, 0.082], brass, 0.045);
    if (!guard) body.box([0, hipsY + 0.27, -0.21], [0.28, 0.24, 0.16], dark, 0.09);
    const head = part('head', [0, shoulderY + 0.07, 0], 'spine'), headW = guard ? 0.30 : 0.35;
    head.box([0, headY, 0], [headW, guard ? 0.31 : 0.26, 0.29], outer, guard ? 0.10 : 0.17);
    head.box([0, headY + 0.02, 0.269], [headW * 0.78, 0.083, 0.052], dark, 0.044);
    for (const x of [-0.12, 0.12]) head.box([x, headY + 0.02, 0.32], [0.042, 0.034, 0.02], eye, 0.019);
    if (guard) head.box([0, headY + 0.34, -0.02], [0.075, 0.13, 0.22], brass, 0.055);
    else head.ball([0, headY + 0.28, 0], 0.07, brass);

    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      const x = sign * waist, kneeY = hipsY - thigh;
      part(side + 'Thigh', [x, hipsY, 0], 'hips').box([x, hipsY - thigh / 2, 0],
        [guard ? 0.18 : 0.132, thigh / 2 + 0.05, 0.14], dark, 0.065);
      part(side + 'Shin', [x, kneeY, 0], side + 'Thigh').box([x, kneeY - shin / 2, 0],
        [guard ? 0.165 : 0.119, shin / 2 + 0.04, 0.123], outer, 0.055);
      part(side + 'Foot', [x, bootY, 0], side + 'Shin').box([x, bootY * 0.5, 0.08 * legScale],
        [0.145 * legScale, bootY * 0.5, 0.21 * legScale], brass, 0.052);
      roles[side + 'Sole'] = { part: names[side + 'Foot'], point: [x, 0, 0.08 * legScale] };

      const ax = sign * (chest + 0.07), elbowX = ax + sign * (guard ? 0.17 : 0.065);
      const elbowY = shoulderY - (guard ? 0.43 : 0.33), wristY = elbowY - (guard ? 0.43 : 0.34);
      const arm = part(side + 'UpperArm', [ax, shoulderY, 0], 'spine');
      arm.box([(ax + elbowX) / 2, (shoulderY + elbowY) / 2, 0], [0.13, (shoulderY - elbowY) * 0.55, 0.13]);
      arm.ball([ax, shoulderY - 0.06, 0], guard ? 0.22 : 0.14, brass);
      const forearm = part(side + 'Forearm', [elbowX, elbowY, 0], side + 'UpperArm');
      forearm.box([elbowX, (elbowY + wristY) / 2, 0], [0.112, (elbowY - wristY) / 2, 0.13], dark);
      forearm.ball([elbowX, wristY, 0], guard ? 0.13 : 0.107, brass);
      roles[side + 'Wrist'] = { part: names[side + 'Forearm'], point: [elbowX, wristY, 0], marker: true };
      if (withLantern && side === 'right') {
        const grip = [elbowX, wristY - 0.045, 0.09], [x, y, z] = grip;
        const lantern = part('lantern', grip, 'rightForearm');
        lantern.box(grip, [0.084, 0.034, 0.05], brass, 0.023);
        lantern.box([x, y-0.14, z], [0.12, 0.035, 0.10], brass, 0.023);
        lantern.box([x, y-0.24, z], [0.083, 0.085, 0.085], eye, 0.037);
        lantern.box([x, y-0.34, z], [0.123, 0.034, 0.108], brass, 0.028);
      }
    }
    S.bake();
    for (const [id, entry] of Object.entries(parts)) entry.ids = tags[id];
    const world = B.finish({ cam: { target: [0, 1.52, 0.48], dist: 6.8, yaw: 0.92, pitch: 0.08 },
      radius: 4, detail: 24, dither: 0.20 });
    const puppet = K.puppet(world, { parts });
    world.retargetRig = { puppet, profile: 'biped', roles, sprite: { width: 96, height: 96, directions: 8 } };
    if (guard) return world;

    const fps = 24, dur = 1, tracks = {};
    const key = (role, ch, time, value) => {
      const id = names[role] + '.' + ch;
      (tracks[id] ||= []).push([time, value, 'linear']);
    };
    const degrees = 180 / Math.PI;
    for (let i = 0; i <= fps; i++) {
      const t = i / fps, rootY = -0.115 + 0.018 * Math.cos(4 * Math.PI * t);
      key('hips', 'pos', t, [0, rootY, t * stride]);
      key('spine', 'rot', t, [2.5, 8 * Math.sin(2 * Math.PI * t), 0]);
      key('head', 'rot', t, [-2.5, -5 * Math.sin(2 * Math.PI * t), 0]);
      for (const [side, shift] of [['left', 0], ['right', 0.5]]) {
        const phase = (t + shift) % 1, swing = Math.max(0, (phase - 0.6) / 0.4);
        const z = phase <= 0.6 ? (0.3 - phase) * stride : (K.anim.ease(swing, 'smooth') - 0.5) * 0.6 * stride;
        const dy = -thigh - shin - rootY + 0.14 * Math.sin(Math.PI * swing);
        const knee = Math.acos(K.clamp((dy * dy + z * z - thigh * thigh - shin * shin) / (2 * thigh * shin), -1, 1));
        const hip = Math.atan2(-z, -dy) - Math.atan2(shin * Math.sin(knee), thigh + shin * Math.cos(knee));
        key(side + 'Thigh', 'rot', t, [hip * degrees, 0, 0]);
        key(side + 'Shin', 'rot', t, [knee * degrees, 0, 0]);
        key(side + 'Foot', 'rot', t, [-(hip + knee) * degrees, 0, 0]);
        key(side + 'UpperArm', 'rot', t, [24 * Math.cos(2 * Math.PI * phase), 0, 0]);
        key(side + 'Forearm', 'rot', t, [-8 - 10 * Math.sin(Math.PI * phase), 0, 0]);
      }
    }
    const walk = K.anim.clip({ id: 'walk', name: 'Courier walk', fps, dur, loop: true, tracks, cues: [[0, 'left-plant'], [0.5, 'right-plant']] });
    world.retargetRig.clips = { walk };
    puppet.setPoseSampler((time, dt, actor) => walk.sample(time, actor.pose, { sourceTime: true }));
    return world;
  }
  return { id, name: guard ? 'Tall guard retarget rig' : 'Courier walk retarget rig', seed: 13, build };
}

module.exports = kit => character(kit, false);
module.exports.guard = kit => character(kit, true);
module.exports.lantern = kit => character(kit, false, true);
