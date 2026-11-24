/* A courier cape with a pinned collar and a protected embroidered patch. */
function clothReviewScene(kit) {
  const { KIT: K } = kit;
  const courier = typeof module === 'object' ? require('./pose-blocking').buildSignalCourier : buildSignalCourier;
  const nu = 15, nv = 17, length = 1.8;
  const defaultRegions = Array.from({ length: nu * nv }, (_, i) => {
    const x = i % nu, y = Math.floor(i / nu);
    return y === 0 ? 'pin' : x >= 5 && x <= 9 && y >= 2 && y <= 5 ? 'protected' : 'free';
  });
  function build(seed, { controls = {} } = {}) {
    let cape;
    const { world, parts } = courier(kit, seed, ({ B }) => {
      cape = K.cloth(B, {
        nu, nv, dabs: 3, at: [-0.67, 2.16, 0.31], u: [1.34, 0, 0], v: [0, -1.60, 0.17],
        density: 0.42, stretch: 3e-7, shear: 4e-6, bend: 0.0028, air: 1.0,
        pattern(u, v) {
          if (u < 0.08 || u > 0.92 || v > 0.94) return [9, 10, 11, 12];
          if (Math.abs(u - 0.5) + Math.abs(v - 0.20) < 0.10) return [10, 11, 12, 13];
          return [14, 15, 16, 17];
        }
      });
    }, [0x2f2048, 0x53366b, 0x8258a0, 0xb990c6]);
    parts.leftLeg.parent = parts.rightLeg.parent = 'body';
    world.cam.target = [0.03, 1.58, 0.26];
    world.cam.yaw = 0.68;
    world.cam.pitch = 0.09;
    world.cam.dist = 7.1;
    const clip = K.anim.clip({ dur: length, tracks: {
      'body.rot': [[0, [0, -23, 0]], [0.70, [-6, 21, -7]], [1.25, [2, 62, 7]], [length, [0, 37, 0]]],
      'body.pos': [[0, [-0.08, -0.035, 0]], [0.83, [0.15, -0.055, 0]], [length, [0.02, -0.04, 0]]],
      'head.rot': [[0, [0, 5, 0]], [1.0, [5, 26, 0]], [length, [0, 14, 0]]],
      'leftArm.rot': [[0, [0, 0, -16]], [0.82, [-16, 0, -38]], [length, [0, 0, -18]]],
      'rightArm.rot': [[0, [-10, 0, 16]], [0.82, [-10, 0, 42]], [length, [0, 0, 19]]]
    } });
    const puppet = K.puppet(world, { parts, pose(t, dt, actor) {
      clip.sample(t, actor.pose, { sourceTime: true });
    } });
    const updatePuppet = world.anim.update.bind(world.anim);
    const stage = { D: world.data, base: world.data, rows: world.anim.rows };
    const rest = cape.restPose();
    const review = K.cloth.review.create(cape, { regions: controls.regions ?? defaultRegions, maxSeconds: 8, speed: 0.045 });
    let selected, source, spheres;
    function select(time) {
      if (!Number.isFinite(time)) throw new TypeError('Choose a finite source pose');
      const t = K.clamp(time, 0, length);
      if (t === selected) return t;
      K.deform.inspectPoses(puppet, solve => {
        solve(clip.sample(t, {}, { sourceTime: true }));
        source = new Float32Array(rest.length);
        for (let i = 0; i < rest.length; i += 3) {
          const u = (i / 3 % nu) / (nu - 1), v = Math.floor(i / (3 * nu)) / (nv - 1);
          const bend = v * v, move = Math.sin(1.75 * t + 0.4);
          const p = [rest[i] + bend * 0.66 * move, rest[i+1] + bend * 0.24 * Math.abs(move),
            rest[i+2] + bend * (0.39 + 0.31 * Math.sin(t * 2 + u * 4))];
          source.set(puppet.point('body', p), i);
        }
        spheres = [
          { c: puppet.point('body', [0, 1.74, -0.01]), r: 0.38 },
          { c: puppet.point('body', [0, 1.31, -0.01]), r: 0.25 }
        ];
      });
      selected = t;
      review.discard();
      return t;
    }
    const gust = K.xpbd.gust([4.3, 1.9, 3.1], { gust: 0.25, turn: 0.18 });
    function start(time = selected) {
      select(time);
      return review.start(source, { sourceTime: selected, spheres, damp: 6.5, substeps: 8,
        wind(x, y, z, t) {
          const lift = t <= 0.85 ? Math.sin(Math.PI * t / 0.85) ** 2 : 0;
          return K.V.mul(gust(x, y, z, t), lift);
        }
      });
    }
    function draw(view = 'preview', time = review.state().time, take) {
      if (take && (take.nu !== nu || take.nv !== nv)) throw new Error('Cloth bake grid does not match this cape');
      const before = view === 'before' || review.state().phase === 'idle';
      const pose = take ? take.sample(time) : before ? Float32Array.from(source) : review.sample(time);
      updatePuppet(0, take?.sourceTime ?? selected);
      cape.drawPose(stage, pose);
      return pose;
    }
    select(controls.pose ?? 0.90);
    world.clothReview = review;
    world.clothDemo = { length, defaultRegions: defaultRegions.slice(), select, start, draw, selected: () => selected };
    if (controls.run) start();
    world.anim.update = (dt, time) => {
      if (controls.run) {
        review.advance(time);
        draw('preview', time);
      } else {
        select(time);
        draw('before');
      }
    };
    draw('before');
    return world;
  }
  return { id: 'cloth-review', name: 'Signal courier cape review', seed: 17, build };
}
if (typeof module === 'object') module.exports = clothReviewScene;
