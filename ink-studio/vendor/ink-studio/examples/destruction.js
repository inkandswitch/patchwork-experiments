/* A siege garden driven entirely by K.destruction. */
function destructionScene({ makeBuilder, makeSculpt, KIT: K }) {
  return { id: 'destruction', name: 'The siege garden', seed: 51, build(seed) {
    const palette = [0x121f2a, 0x23404c, 0x3c5e68, 0x91b1ae, 0x584731, 0x927046, 0xc9a56b, 0xf4dca0,
      0x173a34, 0x345b48, 0x608363, 0xa9b782, 0x523c30, 0x91633b, 0xc88a4c, 0xffcb73];
    const { V, M } = K, B = makeBuilder(seed, palette), groups = [], links = [];
    const stone = K.pixel.masonry({ r: [4, 5, 6, 7], stone: [8, 4], joint: 1, seed: 13 });
    const blue = { r: [0, 1, 2, 3] }, wood = { r: [4, 12, 13, 14] }, gold = { r: [5, 6, 7, 15] };
    function sculpt() {
      const S = K.sculpt(makeSculpt(B));
      S.pixel = true;S.pixelSize(16);S.sun = V.norm([-.6, .8, .5]);S.sunK = .8;S.amb = .39;S.sky = .22;S.aoK = .3;
      return S;
    }
    const S = sculpt();
    S.ground({ r: [8, 9, 10] }, { rad: 9, res: .23 });
    S.box([0, .08, 0], [4.5, .10, 3.8], { r: [0, 1, 2] }, { res: .19, rd: .2 });
    for (let i = 0; i < 100; i++) {
      const a = i * 2.39996, r = 6.4 + K.hash(i, 3, 6) * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > 3.2 && Math.abs(x) < 5.7) continue;
      for (let j = 0; j < 3; j++) {
        const y = .13 + K.hash(i, j, 4) * .28, t = a + j * 2.1;
        S.tube([[x, .02, z], [x + Math.cos(t) * .11, y, z + Math.sin(t) * .11]], .028, .008, { r: [9, 10, 11] }, { res: .07 });
      }
      if (i % 13 === 0) S.rock([x, .17, z], [.4, .28, .31], blue, { res: .1 });
    }
    S.bake();
    function group(id, spec, shape) {
      const first = B.count(), part = sculpt();shape(part);part.bake();
      const ids = Array.from({ length: B.count() - first }, (_, i) => first + i);
      groups.push({ id, ids, static: true, fragmentSize: .7, ...spec });
    }
    group('tower-foot', { anchor: true, mass: 18, strength: 6 }, s => {
      s.box([-3, .67, -1.15], [.68, .56, .68], stone, { res: .115, rd: .055 });
      s.box([-3, .20, -1.15], [.83, .15, .83], blue, { res: .12 });
    });
    group('tower', { mass: 15, strength: 12 }, s => {
      s.box([-3, 2.27, -1.15], [.66, 1.06, .66], stone, { res: .115, rd: .055 });
      for (const x of [-3.32, -2.68]) s.box([x, 2.45, -.471], [.13, .28, .035], blue, { res: .07 });
      s.box([-3, 3.36, -1.15], [.8, .12, .8], gold, { res: .10 });
    });
    group('battlements', { mass: 7, strength: 5, fragmentSize: .47 }, s => {
      for (const x of [-3.62, -3, -2.38]) for (const z of [-1.77, -.53]) s.box([x, 3.72, z], [.18, .23, .18], stone, { res: .085, rd: .025 });
      s.tube([[-3, 3.5, -1.15], [-3, 5.2, -1.15]], .036, .024, wood, { res: .07 });
      s.box([-2.62, 4.86, -1.15], [.34, .21, .027], gold, { res: .07 });
    });
    links.push(['tower-foot', 'tower'], ['tower', 'battlements']);
    for (const x of [-.5, 3.1]) {
      const id = x < 0 ? 'west-pier' : 'east-pier';
      group(id, { anchor: true, mass: 16, strength: 8 }, s => {
        s.box([x, .95, -.15], [.42, .83, .67], stone, { res: .11, rd: .04 });
        s.box([x, .24, -.15], [.58, .18, .79], blue, { res: .115 });
      });
      links.push([id, 'bridge']);
    }
    group('bridge', { mass: 12, strength: 5, fragmentSize: .65 }, s => {
      s.box([1.3, 1.95, -.15], [2.31, .18, .78], stone, { res: .11, rd: .04 });
      for (const z of [-.92, .62]) s.tube([[-.9, 2.12, z], [3.5, 2.12, z]], .05, .05, gold, { res: .08 });
    });
    group('parapet', { mass: 6, strength: 4, fragmentSize: .5 }, s => {
      for (const z of [-.91, .61]) for (let i = 0; i < 9; i++) s.box([-.75 + i * .51, 2.36, z], [.15, .23, .13], stone, { res: .08 });
    });
    links.push(['bridge', 'parapet']);
    const cannon = [-5.6, .75, 4.2], catapult = [4.6, 1.0, 4.6], art = sculpt();
    for (const [x, y, z] of [cannon, catapult]) {
      art.box([x, .31, z], [.48, .16, .65], wood, { res: .11 });
      for (const side of [-1, 1]) for (const dz of [-.38, .38]) art.ball([x + side * .49, .24, z + dz], [.10, .25, .25], blue, { res: .08 });
    }
    const barrel = V.norm(V.sub([-3, .95, -1.15], cannon));
    art.tube([V.mad(cannon, barrel, -.45), V.mad(cannon, barrel, .70)], .19, .16, blue, { res: .08 });
    art.tube([V.mad(cannon, barrel, .68), V.mad(cannon, barrel, .73)], .20, .20, gold, { res: .06 });
    art.box([catapult[0], 1.0, catapult[2]], [.44, .1, .08], gold, { res: .08 });
    art.tube([[4.6, .4, 4.6], [4.6, 1.7, 4.6], [4.6, 2.2, 5.7]], .065, .08, wood, { res: .08 });
    art.ball([4.6, 2.22, 5.7], [.22, .07, .21], gold, { res: .08 });
    art.bake();
    let physics;
    const shots = K.frameSplats(B, 32, draw => {
      for (const shot of physics.projectiles) draw.point(shot.p, { width: shot.radius, color: shot.mass > 4 ? 15 : 3, emissive: false, depth: true, density: 3 });
    });
    const W = B.finish({ cam: { target: [0, 1.5, .1], dist: 21, yaw: .53, pitch: .54 }, detail: 24, dither: .12 });
    const stage = K.stage(W);
    physics = stage.add(K.destruction(stage, { groups, links, gravity: 12, maxPieces: 52, maxProjectiles: 32, points: 10 }));
    stage.add(shots);
    stage.update(0, 0);
    W.destructionDemo = { physics,
      fire(kind = 'cannon', target = kind === 'cannon' ? 'tower' : 'bridge') {
        const p = kind === 'cannon' ? V.mad(cannon, barrel, .76) : [4.6, 2.22, 5.7];
        const aim = target === 'tower' ? [-3, .85, -1.15] : [1.3, 2, -.15];
        const t = kind === 'cannon' ? .36 : 1.35, v = V.mul(V.sub(aim, p), 1 / t);
        v[1] += 6 * (t + 1 / 120);
        return physics.launch({ p, v, radius: kind === 'cannon' ? .19 : .27, mass: kind === 'cannon' ? 6 : 9, restitution: .18 });
      },
      reset() { physics.reset(); },
      advance(seconds) { for (let t = 0; t < seconds - 1e-8; t += 1 / 120) stage.update(1 / 120, stage.time + 1 / 120); }
    };
    return W;
  } };
}
if (typeof module === 'object') module.exports = destructionScene;
