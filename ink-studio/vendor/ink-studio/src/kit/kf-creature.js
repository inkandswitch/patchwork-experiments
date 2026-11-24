/* kf-creature: what the animals are built on (it grew up beside the Barrow Tortoise, the Grave Cap, the Drift Queen, the Reef Revenant and the
   Yard Warden, and was lifted here unchanged so that there is one of it).
     const R = K.creature(B, S)     bones by name; a solid's tag says which bone carries it
       R.part(name, fn)             splats made inside fn belong to that bone too (glints, drips, flies)
       R.split(name, fn) / R.spine(name, points, ...) / R.limb(...)    cut a part along a line of points; a leg in two bones
       R.set(name, turn, from, to)  put a bone: a 3x3 turn, the point it was made about, where that point is now
       R.bind(W, pose)              after B.finish: pose(t, dt) sets the bones each frame. The splats ride on the graphics card (K.bones)
     K.rot(B, S, list, rim)         wounds: places where the hide is gone and what is under it shows */
(function (K) {
  // =====================================================================
  // What the animals below share: a rig, so that a thing sculpted once can be moved afterwards, and rot, so that it can be seen into
  // =====================================================================
  // The rig. Every solid that will move carries the name of the part it belongs to (its tag); as the splats are made each one is noted
  // against its part. A part is then moved by x' = R (x - o) + p: o is where its joint was when it was made, p where the joint is now,
  // and R any 3x3 (a turn, or a turn and a squeeze). bind() hands the finished scene a pose to be called every frame.
  // Parts that turn against each other are made whole (the sculptor's `whole`), each with all of its own surface, so that a joint is two solids one inside
  // the other and nothing is missing when it bends.
  K.creature = function makeRig(B, S) {
    const BN = {},
      owner = [],
      own2 = [],
      wgt = [],
      splits = [],
      ancestry = new Map(),
      restJoints = new Map(),
      norm = B.norm;
    const bone = name => BN[name] || (BN[name] = Object.keys(BN).length + 1);
    S.emit = (pr, n0, n1) => {
      if (pr && pr.tag) {
        const b = bone(pr.tag);
        for (let i = n0; i < n1; i++) owner[i] = b;
      }
    };
    const part = (name, fn) => {
      const n0 = B.count(),
        b = bone(name);
      fn();
      for (let i = n0; i < B.count(); i++) owner[i] = b;
    };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
      cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
      sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      add = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
      len = v => Math.hypot(v[0], v[1], v[2]);
    const AX = [1, 0, 0],
      AY = [0, 1, 0],
      AZ = [0, 0, 1],
      I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const rot = (ax, a) => {
      const c = Math.cos(a),
        s = Math.sin(a),
        t = 1 - c,
        x = ax[0],
        y = ax[1],
        z = ax[2];
      return [
        t * x * x + c,
        t * x * y - s * z,
        t * x * z + s * y,
        t * x * y + s * z,
        t * y * y + c,
        t * y * z - s * x,
        t * x * z - s * y,
        t * y * z + s * x,
        t * z * z + c
      ];
    };
    const mul = (A, C) => [
      A[0] * C[0] + A[1] * C[3] + A[2] * C[6],
      A[0] * C[1] + A[1] * C[4] + A[2] * C[7],
      A[0] * C[2] + A[1] * C[5] + A[2] * C[8],
      A[3] * C[0] + A[4] * C[3] + A[5] * C[6],
      A[3] * C[1] + A[4] * C[4] + A[5] * C[7],
      A[3] * C[2] + A[4] * C[5] + A[5] * C[8],
      A[6] * C[0] + A[7] * C[3] + A[8] * C[6],
      A[6] * C[1] + A[7] * C[4] + A[8] * C[7],
      A[6] * C[2] + A[7] * C[5] + A[8] * C[8]
    ];
    const app = (R, v) => [
      R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
      R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
      R[6] * v[0] + R[7] * v[1] + R[8] * v[2]
    ];
    const scl = (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z];
    // the least turn that carries direction u onto direction v
    const aim = (u, v) => {
      const w = cross(u, v),
        k = 1 / (1 + Math.max(-0.98, dot(u, v)));
      return [
        1 - k * (w[1] * w[1] + w[2] * w[2]),
        -w[2] + k * w[0] * w[1],
        w[1] + k * w[0] * w[2],
        w[2] + k * w[0] * w[1],
        1 - k * (w[0] * w[0] + w[2] * w[2]),
        -w[0] + k * w[1] * w[2],
        -w[1] + k * w[0] * w[2],
        w[0] + k * w[1] * w[2],
        1 - k * (w[0] * w[0] + w[1] * w[1])
      ];
    };
    const ease = x => {
        x = x < 0 ? 0 : x > 1 ? 1 : x;
        return x * x * (3 - 2 * x);
      },
      frac = x => x - Math.floor(x);
    // a value that passes through the given (when, what) pairs over one beat, easing between them
    const kf = (p, K) => {
      for (let i = 2; i < K.length; i += 2)
        if (p <= K[i]) return K[i - 1] + (K[i + 1] - K[i - 1]) * ease((p - K[i - 2]) / (K[i] - K[i - 2]));
      return K[K.length - 1];
    };
    let M = null, restPose = null, capture = false;
    const set = (name, R, o, p) => {
      const b = BN[name];
      if (!b || !M) return;
      if (capture && !restJoints.has(name)) restJoints.set(name, { head: o.slice() });
      const k = b * 12;
      for (let i = 0; i < 9; i++) M[k + i] = R[i];
      M[k + 9] = p[0] - (R[0] * o[0] + R[1] * o[1] + R[2] * o[2]);
      M[k + 10] = p[1] - (R[3] * o[0] + R[4] * o[1] + R[5] * o[2]);
      M[k + 11] = p[2] - (R[6] * o[0] + R[7] * o[1] + R[8] * o[2]);
    };
    // a joint: R about the point o. Its parent carries o to where it is now (or p says where), and what hangs off it asks at() where its own joint has gone
    const J = (par, R, o, p) => {
      const Rw = par ? mul(par.R, R) : R,
        pw = p || (par ? par.at(o) : o);
      return {
        R: Rw,
        o,
        p: pw,
        at: v => {
          const q = app(Rw, sub(v, o));
          return [q[0] + pw[0], q[1] + pw[1], q[2] + pw[2]];
        }
      };
    };
    const use = (name, j) => set(name, j.R, j.o, j.p);
    // the splats of one part are shared out among others according to where they were made
    const split = (name, fn) => splits.push([name, fn]);
    // a spine: a line of points through a part. Every splat of the part finds the stretch of line it lies beside and is shared between the two points at
    // the ends of it, by how far along it is: when the line bends the skin bends with it, and no cracks open between one length and the next;
    // the pose says where every point has gone, and each length is carried there and turned to lie along the line again (JT keeps the joint of each
    // length, for whatever else rides on it; twist(j) may add a turn or a squeeze of its own; orient(j, T) says how a length lies along T when
    // the least turn will not do, as for something that swims right round)
    const spine = (name, C0) => {
      const n = C0.length,
        T0 = C0.map((c, j) => norm(sub(C0[Math.min(n - 1, j + 1)], C0[Math.max(0, j - 1)])));
      split(name, (x, y, z) => {
        let best = 1e9,
          bj = 0,
          bu = 0;
        for (let j = 0; j < n - 1; j++) {
          const a = C0[j],
            b = C0[j + 1],
            bx = b[0] - a[0],
            by = b[1] - a[1],
            bz = b[2] - a[2];
          let u = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz || 1);
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = x - a[0] - bx * u,
            dy = y - a[1] - by * u,
            dz = z - a[2] - bz * u,
            d = dx * dx + dy * dy + dz * dz;
          if (d < best) {
            best = d;
            bj = j;
            bu = u;
          }
        }
        return bu > 0.5
          ? [name + '#' + (bj + 1), name + '#' + bj, 1 - bu]
          : [name + '#' + bj, name + '#' + (bj + 1), bu];
      });
      for (let i = 0; i < n; i++) {
        const key = name + '#' + i;
        if (i > 0) ancestry.set(key, name + '#' + (i - 1));
        restJoints.set(key, { head: C0[i].slice(), tail: add(C0[i], T0[i], Math.max(0.05,
          len(sub(C0[Math.min(n - 1, i + 1)], C0[Math.max(0, i - 1)])) * 0.5)) });
      }
      const JT = [];
      return {
        n,
        C0,
        T0,
        JT,
        pose(PT, twist, orient) {
          let T = T0[n - 1];
          for (let j = 0; j < n; j++) {
            const a = PT[Math.max(0, j - 1)],
              b = PT[Math.min(n - 1, j + 1)];
            T = norm(sub(b, a));
            const Rj = orient ? orient(j, T) : aim(T0[j], T);
            JT[j] = J(null, Rj, C0[j], PT[j]);
            set(name + '#' + j, twist ? mul(Rj, twist(j)) : Rj, C0[j], PT[j]);
          }
          return T;
        }
      };
    };
    // a leg of two lengths: hip h, knee k, foot f as they were made. Given where the hip and the foot are now, the knee goes where it must, bending the way it was made to bend
    const limb = (na, nb, L, hip, foot) => {
      const l1 = len(sub(L.k, L.h)),
        l2 = len(sub(L.f, L.k));
      let v = sub(foot, hip),
        d = len(v);
      if (d > l1 + l2 - 0.02) {
        const q = (l1 + l2 - 0.02) / d;
        foot = add(hip, v, q);
        v = sub(foot, hip);
        d = l1 + l2 - 0.02;
      }
      const dir = [v[0] / d, v[1] / d, v[2] / d],
        x = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
        y = Math.sqrt(Math.max(0, l1 * l1 - x * x)),
        kv = sub(L.k, L.h),
        kd = dot(kv, dir),
        nn = norm([kv[0] - dir[0] * kd, kv[1] - dir[1] * kd, kv[2] - dir[2] * kd]),
        kn = [hip[0] + dir[0] * x + nn[0] * y, hip[1] + dir[1] * x + nn[1] * y, hip[2] + dir[2] * x + nn[2] * y];
      const Ra = aim(norm(kv), norm(sub(kn, hip))),
        Rb = aim(norm(sub(L.f, L.k)), norm(sub(foot, kn)));
      set(na, Ra, L.h, hip);
      set(nb, Rb, L.k, kn);
      return { R: Rb, o: L.k, p: kn };
    };
    const bind = (W, pose) => {
      restPose = pose;
      const D = W.data;
      for (const [name, fn] of splits) {
        const b = BN[name];
        if (!b) continue;
        for (let i = 0; i < owner.length; i++)
          if (owner[i] === b) {
            const o = i * 16,
              r = fn(D[o], D[o + 1], D[o + 2]);
            if (Array.isArray(r)) {
              owner[i] = bone(r[0]);
              own2[i] = bone(r[1]);
              wgt[i] = r[2];
            } else owner[i] = bone(r);
          }
      }
      const ids = [];
      for (let i = 0; i < owner.length; i++) if (owner[i]) ids.push(i);
      const NA = ids.length,
        rest = new Float32Array(NA * 9),
        bid = new Uint16Array(NA),
        bid2 = new Uint16Array(NA),
        w2 = new Float32Array(NA),
        NBN = Object.keys(BN).length + 1;
      M = new Float32Array(NBN * 12);
      for (let j = 0; j < NA; j++) {
        const o = ids[j] * 16;
        rest[j * 9] = D[o];
        rest[j * 9 + 1] = D[o + 1];
        rest[j * 9 + 2] = D[o + 2];
        rest[j * 9 + 3] = D[o + 4];
        rest[j * 9 + 4] = D[o + 5];
        rest[j * 9 + 5] = D[o + 6];
        rest[j * 9 + 6] = D[o + 8];
        rest[j * 9 + 7] = D[o + 9];
        rest[j * 9 + 8] = D[o + 10];
        bid[j] = owner[ids[j]];
        if (wgt[ids[j]] > 0.001) {
          bid2[j] = own2[ids[j]];
          w2[j] = wgt[ids[j]];
        }
      }
      for (let b = 0; b < NBN; b++) {
        M[b * 12] = 1;
        M[b * 12 + 4] = 1;
        M[b * 12 + 8] = 1;
      }
      W.note = 'animated ' + NA + ' of ' + W.count + ' in ' + (NBN - 1) + ' parts';
      if (!NA) return W;
      KIT.bones.bind(W, { ids, bid, bid2, w2, M, pose }); // (the library remembers the rest pose, hands the splats to the graphics card and moves what is left)
      return W;
    };
    function modelWeights(tag, p) {
      let primary = tag, secondary, weight = 0;
      for (const [name, splitAt] of splits) if (primary === name) {
        const value = splitAt(...p);
        if (Array.isArray(value)) [primary, secondary, weight] = value;
        else primary = value;
      }
      if (!primary) return [];
      return weight > 0.001 ? [[primary, 1 - weight], [secondary, weight]] : [[primary, 1]];
    }
    function modelFrame(t, dt, pose = restPose) {
      if (!M) throw new Error('Bind the creature before sampling its model pose');
      capture = true;
      try {
        if (pose) pose(t, dt);
      } finally {
        capture = false;
      }
      return Object.fromEntries(Object.entries(BN).map(([name, index]) => [name, Array.from(M.slice(index * 12, index * 12 + 12))]));
    }
    function modelJoint(name) {
      return { ...restJoints.get(name), parent: ancestry.get(name) };
    }
    return {
      modelWeights,
      modelFrame,
      modelJoint,
      bone,
      part,
      set,
      J,
      use,
      split,
      spine,
      limb,
      bind,
      dot,
      cross,
      sub,
      add,
      lerp,
      len,
      rot,
      mul,
      app,
      scl,
      aim,
      ease,
      frac,
      kf,
      AX,
      AY,
      AZ,
      I3
    };
  };
  // Rot. A list of places where the flesh has gone, each a centre and a reach: [x, y, z, r] or [x, y, z, rx, ry, rz]. at() is above nought inside
  // one, with a ragged edge. skin() makes a material stop there, with a raw rim; under() keeps what lies beneath (meat, bone) only near an opening
  K.rot = function makeRot(B, S, list, RIM) {
    const n3 = B.n3;
    const at = (x, y, z) => {
      let v = -9;
      for (let i = 0; i < list.length; i++) {
        const w = list[i],
          dx = (x - w[0]) / w[3],
          dy = (y - w[1]) / (w[4] || w[3]),
          dz = (z - w[2]) / (w[5] || w[3]),
          q = 1 - dx * dx - dy * dy - dz * dz;
        if (q > v) v = q;
      }
      return v + 0.5 * (n3(x * 0.8 + 3, y * 0.8, z * 0.8) - 0.5);
    };
    const skin = m =>
      Object.assign({}, m, {
        tex: (x, y, z, ny, t, nx, nz) => {
          const w = at(x, y, z);
          if (w > 0) return -1;
          if (w > -0.17) return S.pick(RIM, t);
          return m.tex ? m.tex(x, y, z, ny, t, nx, nz) : undefined;
        }
      });
    const under = (m, reach) =>
      Object.assign({}, m, {
        tex: (x, y, z, ny, t, nx, nz) =>
          at(x, y, z) < -(reach || 0.7) ? -1 : m.tex ? m.tex(x, y, z, ny, t, nx, nz) : undefined
      });
    const near = (pts, reach) => pts.some(p => at(p[0], p[1], p[2]) > -(reach || 0.9));
    return { at, skin, under, near, list };
  };
})(KIT);
