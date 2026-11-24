/* kk-character: a character you can steer, with Inkwell character controls: squash on landing, stretch on take-off,
   a lean and a nod on springs that overshoot and settle, a hem that follows, and tails as ropes. It is built from a spec and writes its own splats each frame.
     const ch = K.character(B, spec, lane)   before B.finish. spec: { pts: { hip, chest, hem, neck, sock, ank, sho, hand }, height,
                                              sculpt(S, T, U) (tag each solid with the bone that carries it: T('root' | 'chest' | 'hem' |
                                              'head' | 'legL' ...)), anim, speed, atk: 'slash' | 'pound' | 'thrust' | 'spin' | 'peck',
                                              gait: 'walk' | 'hop' | 'float', tails, rings, world: { height(x, z, y) } ... }
     ch.bind(world, at)                      after B.finish: at is the first of its splats (world.count - ch.total when it was made last)
     ch.update(dt, inp, time)                inp: { move, mz, run, jump, dash, attack, cast, crouch, auto, face }
     ch.hurt(kx, kz)  ch.respawn(x)  ch.striking()  ch.st (its whole state: x, y, z, face, atk, dead ...)
   With the animation tools:
     ch.play(clip, o)                        play a K.anim clip, or one of K.acts by name ('victory', 'hurt', 'dodge' ...), on top of
                                             whatever it is doing: the clip's `body` part moves it (pos, stretch, rot about the way it
                                             faces as a lean, nod, flare, spin). o.part names another part to read; o.unit scales K.acts
     ch.st.act = { stretch, lean, nod, pos, flare, spin }   the same by hand, each frame, from any pose
     ch.warp = map                           a K.deform map its bones are put through (a reaction field, a smear, a cage) */
(function (K) {
  const DSV = [0, 0, 0, 0]; // scratch for K.dissolve.at
  K.character = function makeCharacter(B, spec, LANE0) {
    const { rr, n3, P, TAU, norm, iso } = B;
    /* the plain vector and matrix work is the kit's */
    const V = K.V,
      mul = K.M.mul,
      app = K.M.app;
    const rz = a => {
        const c = Math.cos(a),
          s = Math.sin(a);
        return [c, -s, 0, s, c, 0, 0, 0, 1];
      },
      ry = a => {
        const c = Math.cos(a),
          s = Math.sin(a);
        return [c, 0, s, 0, 1, 0, -s, 0, c];
      };
    const rxm = a => {
      const c = Math.cos(a),
        s = Math.sin(a);
      return [1, 0, 0, 0, c, -s, 0, s, c];
    };
    const scl = (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z],
      sub = V.sub,
      add3 = V.add,
      len = V.len,
      cross = V.cross,
      dot3 = V.dot;
    const mixn = (a, b, t) => a + (b - a) * t,
      sat = v => (v < 0 ? 0 : v > 1 ? 1 : v),
      ss = v => {
        v = sat(v);
        return v * v * (3 - 2 * v);
      };
    function turn(a, b) {
      const v = cross(a, b),
        c = dot3(a, b);
      if (c < -0.9999) return [-1, 0, 0, 0, -1, 0, 0, 0, 1];
      const k = 1 / (1 + c),
        x = v[0],
        y = v[1],
        z = v[2];
      return [
        1 - k * (y * y + z * z),
        k * x * y - z,
        k * x * z + y,
        k * x * y + z,
        1 - k * (x * x + z * z),
        k * y * z - x,
        k * x * z - y,
        k * y * z + x,
        1 - k * (x * x + y * y)
      ];
    }

    // ------------------------------------------------------------ skeleton
    const pt = spec.pts,
      HIP = pt.hip,
      CH = pt.chest || add3(HIP, [0, 0.4, 0]),
      HEMP = pt.hem || add3(HIP, [0, -0.3, 0]),
      NECK = pt.neck || add3(CH, [0, 0.4, 0]);
    const hasLegs = !!pt.sock,
      hasArm = !!pt.sho,
      SOCK = s => [pt.sock[0], pt.sock[1], s * pt.sock[2]],
      ANK = s => [pt.ank[0], pt.ank[1], s * pt.ank[2]],
      SHO = pt.sho,
      HANDR = pt.hand;
    const tails = spec.tails || [],
      rings = spec.rings || [],
      gait = spec.gait || 'walk',
      sp0 = Object.assign({ walk: 2.6, run: 5.6, jump: 8.5, dash: 15 }, spec.speed),
      LG = Object.assign({ lo: 0.3, hi: 1 }, spec.light),
      STY = spec.atk || 'slash',
      AN = spec.anim || {},
      AW = (spec.wind || { pound: 0.26, thrust: 0.12, spin: 0.1, peck: 0.08 }[STY] || 0.07) + (spec.windAdd || 0),
      AS = STY === 'spin' ? 0.22 : 0.11,
      AR = 0.2,
      reach = spec.reach || 1.1;
    const CWD = spec.castWind || 0.14,
      BSP = spec.boltSpeed || 10;
    const BI = { root: 0, chest: 1, hem: 2, head: 3, legL: 4, legR: 5, footL: 6, footR: 7, arm: 8, item: 9 };
    let NB = 10;
    const TB = [];
    tails.forEach((t, c) => {
      TB.push(NB);
      t.dir = norm(t.dir || [-0.3, -0.95, 0]);
      t.seg = t.seg || 0.15;
      t.n = t.n || 4;
      for (let i = 0; i < t.n; i++) BI['t' + c + '_' + i] = NB++;
    });
    const QD = spec.quad || null,
      QB = NB;
    if (QD) for (let k = 0; k < 4; k++) BI['q' + k] = NB++;
    const tailRest = (c, i) => {
      const t = tails[c];
      return [t.at[0] + t.dir[0] * t.seg * i, t.at[1] + t.dir[1] * t.seg * i, t.at[2] + t.dir[2] * t.seg * i];
    };

    // ------------------------------------------------------------ sculpt: the usual solids, collected instead of drawn
    const S = makeSculpt(B),
      rig = [];
    S.res = spec.res || 0.055;
    S.aoR = 0.07;
    S.aoK = 1.3;
    S.sun = norm([-0.45, 0.7, 0.55]);
    const T = (a, b, w, o) => Object.assign({ tag: { a, b, w } }, o);
    T.eye = (a, o) => Object.assign({ tag: { a, eye: true } }, o);
    S.capture = (prim, m, res, x, y, z, nx, ny, nz, ao) => {
      const tg = prim.tag || {},
        a = BI[tg.a] === undefined ? 0 : BI[tg.a],
        b = tg.b ? BI[tg.b] : a,
        w = tg.b ? (typeof tg.w === 'function' ? sat(tg.w([x, y, z])) : tg.w === undefined ? 0.5 : tg.w) : 0;
      let ramp = m.r;
      if (m.top && false) ramp = m.r;
      if (m.top && ny > m.top.min + 0.35 * (n3(x * 5, y * 5, z * 5) - 0.5)) ramp = m.top.r;
      if (spec.pmap) ramp = m.w || ramp.map(q => spec.pmap[q]); // (a material may say outright which of the world's colours it wants there)
      const nn = [nx, ny, nz],
        t1 = norm(Math.abs(ny) > 0.95 ? cross([1, 0, 0], nn) : cross([0, 1, 0], nn)),
        t2 = cross(nn, t1),
        s = res * 0.68,
        sn = res * 0.22;
      rig.push({
        a,
        b,
        w,
        p: [x, y, z],
        n: nn,
        A: [t1[0] * s, t1[1] * s, t1[2] * s, t2[0] * s, t2[1] * s, t2[2] * s, nx * sn, ny * sn, nz * sn],
        ramp,
        sh: (m.b || 0) + ((ao === undefined ? 1 : ao) - 1) * 0.6,
        em: !!m.em,
        eye: !!tg.eye,
        jit: rr(-0.06, 0.06)
      });
    };
    spec.sculpt(S, T, {
      ss,
      mixn,
      TAU,
      gh: (b, res) => T(b, null, null, { ghost: true, res: res || 0.035 }),
      em: c => ({ r: [c], em: true })
    });
    if (QD)
      for (let k = 0; k < 4; k++) {
        const x = QD.x[k >> 1],
          z = (k & 1 ? 1 : -1) * QD.z;
        S.tube(
          [
            [x, QD.top, z],
            [x, QD.bot, z]
          ],
          QD.r0 || 0.07,
          QD.r1 || 0.045,
          QD.mat || [2, 2, 3],
          T('q' + k)
        );
        S.ball([x + 0.02, QD.bot - 0.03, z], QD.foot || [0.07, 0.05, 0.06], QD.hoof || [2, 2, 3], T('q' + k));
      }
    if (hasLegs && !QD) {
      const L = spec.legs || {};
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        S.tube([SOCK(s), ANK(s)], L.r0 || 0.05, L.r1 || 0.04, L.mat || [2, 2, 3], T(k ? 'legR' : 'legL'));
        if (L.foot !== false)
          S.ball(
            add3(ANK(s), [0.05, -0.04, 0]),
            L.foot || [0.1, 0.05, 0.06],
            L.footMat || L.mat || [2, 2, 3],
            T(k ? 'footR' : 'footL')
          );
      }
    }
    tails.forEach((t, c) => {
      for (let i = 0; i < t.n; i++)
        S.tube(
          [tailRest(c, i), tailRest(c, i + 1)],
          mixn(t.r0 || 0.08, t.r1 || 0.025, i / t.n),
          mixn(t.r0 || 0.08, t.r1 || 0.025, (i + 1) / t.n),
          t.mat || [2, 2, 3],
          T('t' + c + '_' + i)
        );
    });
    S.bake();
    const MPi = i => (spec.pmap ? spec.pmap[i] : i),
      WH = MPi(6);
    const NR = rig.length,
      ND = 14,
      NS = 10,
      NSL = 16,
      NBO = 6,
      RN = rings.reduce((a, r) => a + (r.n || 20), 0);
    for (const r of rig) iso(0, -50, 0, 0.02, P[r.ramp[0]], 3, r.em ? { em: true, nd: true } : undefined);
    for (let i = 0; i < ND + NS; i++)
      iso(0, -50, 0, 0.02, P[MPi(i < ND ? spec.dust || 5 : spec.streak || spec.fx || 6)], 0, { nd: true });
    for (let i = 0; i < NSL + NBO; i++) iso(0, -50, 0, 0.02, P[MPi(spec.fx || 6)], 3, { em: true, nd: true }); // the slash and the bolt
    for (const r of rings)
      for (let i = 0; i < (r.n || 20); i++) iso(0, -50, 0, r.w || 0.02, P[r.col], 3, { em: true, nd: true });
    iso(0, -50, 0, 0.1, P[MPi(1)], 3, { nd: true }); // the shadow on the floor
    const total = NR + ND + NS + NSL + NBO + RN + 1;

    // ------------------------------------------------------------ motion
    const BM = [],
      BT = [];
    for (let i = 0; i < NB; i++) {
      BM.push([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      BT.push([0, 0, 0]);
    }
    const st = {
      wet: 0,
      jbuf: 0,
      coy: 0,
      cut: false,
      grab: false,
      climb: false,
      climbT: 0,
      ctop: 0,
      face: 0,
      dfx: 1,
      dfz: 0,
      gh: 0,
      born: 0,
      z: LANE0,
      vz: 0,
      fat: 0,
      vuln: 0,
      goo: 0,
      ls: 0,
      lv: 0,
      ns: 0,
      nv: 0,
      pph: 0,
      slammed: false,
      atk: -1,
      cast: -1,
      connected: false,
      struck: false,
      hitT: 0,
      hp: spec.hp || 3,
      dead: -1,
      bolt: null,
      x: spec.x0 === undefined ? -2.5 : spec.x0,
      y: 0,
      vx: 0,
      vy: 0,
      dir: 1,
      yaw: 0,
      ph: 0,
      ground: true,
      freeze: 0,
      crouch: 0,
      land: 9,
      launch: 9,
      dash: 0,
      dashAge: 9,
      dashDir: 1,
      airK: 0,
      dashK: 0,
      moveK: 0,
      runK: 0,
      blink: 2,
      look: 0,
      lookT: 1.5,
      turnAge: 9,
      hem: [0, 0, 0],
      hemV: [0, 0, 0],
      tail: [],
      tailP: [],
      auto: 0,
      autoStep: 0,
      acc: 0,
      spin: 0
    };
    tails.forEach((t, c) => {
      st.tail.push([]);
      st.tailP.push([]);
      for (let i = 0; i <= t.n; i++) {
        const p = add3(tailRest(c, i), [st.x, 0, st.z]);
        st.tail[c].push(p.slice());
        st.tailP[c].push(p.slice());
      }
    });
    st.hem = [st.x + HEMP[0], HEMP[1], st.z];
    const dust = [],
      streak = [];
    for (let i = 0; i < ND; i++) dust.push({ life: 0 });
    for (let i = 0; i < NS; i++) streak.push({ life: 0 });
    /* the wobble that follows a landing, a take-off, a turn: the animation tools' decaying wave */
    const settle = K.anim.wave;
    const puff = (n, x, spread, up) => {
      if (st.wet > 0) return;
      for (const d of dust) {
        if (n <= 0) break;
        if (d.life > 0) continue;
        n--;
        d.life = d.max = rr(0.28, 0.5);
        d.p = [x + rr(-0.15, 0.15), st.gh + 0.05, st.z + rr(-0.2, 0.2)];
        d.v = [rr(-1, 1) * spread, rr(0.2, 1) * up, rr(-0.5, 0.5) * spread];
        d.s = rr(0.05, 0.1);
      }
    };
    // a burst of short bright sparks in the character's own effect colour: when a bolt is thrown, and wherever something lands a hit
    const spark = (n, x, y, z) => {
      for (const q of streak) {
        if (n <= 0) break;
        if (q.life > 0) continue;
        n--;
        const a = rr(0, TAU),
          v = rr(3, 6.5);
        q.life = q.max = rr(0.14, 0.26);
        q.p = [x, y, z];
        q.fx = Math.cos(a);
        q.fz = Math.sin(a);
        q.v = [Math.cos(a) * v, rr(-0.3, 0.8) * v * 0.6, Math.sin(a) * v];
        q.l = rr(0.1, 0.22);
      }
    };
    const AUTO = [
        ['walk', 2.0],
        ['run', 1.5],
        ['jump', 0],
        ['run', 1.0],
        ['dash', 0],
        ['run', 0.5],
        ['walk', 0.9],
        ['idle', 1.6],
        ['jump', 0],
        ['idle', 0.9]
      ],
      G = 23,
      EDGE = 5.4;
    let start = 0,
      D = null,
      PK = null,
      SUN = S.sun,
      H = spec.height || NECK[1] + 0.4;

    function control(dt, inp) {
      if (st.dead >= 0) {
        st.dead += dt;
        st.vx = 0;
        return;
      }
      let move = inp.move,
        run = inp.run,
        jump = inp.jump,
        dash = inp.dash,
        mzI = inp.mz || 0;
      const busy = st.atk >= 0 || st.cast >= 0;
      {
        const l = Math.hypot(move, mzI);
        if (l > 1) {
          move /= l;
          mzI /= l;
        }
      }
      if (!busy && st.dash <= 0) {
        if (inp.face !== undefined) st.face = inp.face;
        else if (move || mzI) st.face = Math.atan2(mzI, move);
      } // turn to face the way you are going
      const FX = Math.cos(st.face),
        FZ = Math.sin(st.face);
      if (st.slam > 0 && (st.ground || st.climb || st.hitT > 0)) st.slam = 0;
      if (
        inp.attack &&
        !busy &&
        st.hitT <= 0.1 &&
        st.slamOK &&
        !st.slam &&
        !st.ground &&
        !st.climb &&
        st.y - st.gh > 1.0
      ) {
        st.slam = 1;
        st.slamT = 0.15;
        st.slamY = st.y;
        st.dash = 0;
        st.vx *= 0.25;
        st.vz *= 0.25;
      } // the slam: hang a moment, then straight down
      else if (inp.attack && !busy && st.hitT <= 0.1 && !st.slam) {
        st.atk = 0;
        st.connected = false;
        st.struck = false;
        st.slammed = false;
      }
      if (st.slam > 0) {
        move = 0;
        mzI = 0;
        jump = dash = false;
        if (st.slam === 1) {
          st.slamT -= dt;
          st.vy = 1.2;
          if (st.slamT <= 0) {
            st.slam = 2;
            st.vy = -30;
          }
        } else st.vy = Math.min(st.vy, -30);
      } else if (inp.cast && !busy && spec.cast && !st.bolt && st.hitT <= 0.1) st.cast = 0;
      if (st.atk >= 0) {
        st.atk += dt;
        if (!st.struck && st.atk >= AW) {
          st.struck = true;
          {
            const L = (spec.lunge || 4) * (STY === 'thrust' ? 1.9 : STY === 'spin' || STY === 'pound' ? 0.5 : 1);
            st.vx += FX * L;
            st.vz += FZ * L;
          }
        }
        if (STY === 'pound' && !st.slammed && st.atk > AW + AS) {
          st.slammed = true;
          puff(8, st.x + FX * 0.4, 2, 1.2);
          st.freeze = 0.04;
        }
        if (st.atk > AW + AS + AR) st.atk = -1;
        if (!inp.keep) {
          if (st.ground) move = 0;
          jump = dash = false;
        }
      }
      if (st.cast >= 0) {
        const was = st.cast;
        st.cast += dt;
        if (was < CWD && st.cast >= CWD) {
          st.bolt = {
            x: st.x + FX * 0.45,
            z: st.z + FZ * 0.45,
            y: st.y + H * 0.55,
            vx: FX * BSP,
            vz: FZ * BSP,
            life: 0.85
          };
          st.vx -= FX * 1.5;
          st.vz -= FZ * 1.5;
          st.fat = 0;
          spark(5, st.bolt.x, st.bolt.y, st.bolt.z);
        }
        if (st.cast > CWD + 0.22) st.cast = -1;
        if (st.ground) move = 0;
        jump = dash = false;
      }
      if (st.bolt) {
        st.bolt.x += st.bolt.vx * dt;
        st.bolt.z += st.bolt.vz * dt;
        st.bolt.life -= dt;
        if (st.bolt.life <= 0) st.bolt = null;
      }
      if (inp.auto) {
        const [cmd, dur] = AUTO[st.autoStep];
        st.auto += dt;
        if (Math.abs(st.x) > EDGE - 1.2 && Math.sign(st.x) === st.dir && st.ground) {
          st.dir = -st.dir;
          st.turnAge = 0;
        }
        move = cmd === 'idle' ? 0 : st.dir;
        run = cmd === 'run';
        if (cmd === 'jump' || cmd === 'dash') {
          if (cmd === 'jump') jump = true;
          else dash = true;
          st.auto = 9;
        }
        if (st.auto >= dur) {
          st.auto = 0;
          st.autoStep = (st.autoStep + 1) % AUTO.length;
        }
      }
      const wk = st.wet > 0 ? 1 - Math.min(0.45, st.wet * 0.9) : 1; // wading
      if (dash && st.dash <= 0 && st.dashAge > 0.45) {
        st.dash = 0.22;
        st.dashAge = -0.06;
        st.dfx = FX;
        st.dfz = FZ;
        st.freeze = 0.045;
        if (spec.goo) st.goo = 0.6;
      }
      st.dashAge += dt;
      if (st.dash > 0 && st.dashAge >= 0) {
        st.dash -= dt;
        const dv = sp0.dash * (st.dash > 0.05 ? 1 : 0.45);
        st.vx = st.dfx * dv;
        st.vz = st.dfz * dv;
        st.vy = 0;
        if (st.dash <= 0) {
          st.vx = st.dfx * sp0.run * 0.7;
          st.vz = st.dfz * sp0.run * 0.7;
          if (st.ground) puff(5, st.x + st.dfx * 0.3, 1.2, 1);
        }
      } else if (st.dash <= 0) {
        const target = move * (inp.rush || (run ? sp0.run : sp0.walk)) * wk,
          acc = st.ground
            ? inp.ice
              ? target * st.vx < 0
                ? 10
                : Math.abs(target) > Math.abs(st.vx)
                  ? 8
                  : 4.5
              : 42
            : st.hitT > 0 || st.wallLock > 0
              ? 8
              : inp.air || 9;
        st.vx += Math.sign(target - st.vx) * Math.min(Math.abs(target - st.vx), acc * dt);
      } else if (st.dash <= 0) {
        const target = move * (run ? sp0.run : sp0.walk) * (move && inp.mz ? 0.7071 : 1),
          acc = st.ground ? (Math.abs(target) > Math.abs(st.vx) ? 16 : 22) : 7;
        st.vx += Math.sign(target - st.vx) * Math.min(Math.abs(target - st.vx), acc * dt);
      }
      st.jbuf = jump ? 0.2 : Math.max(0, st.jbuf - dt);
      st.coy = st.ground ? 0.17 : Math.max(0, st.coy - dt); // a jump pressed a little early or a little late still counts
      // a jump out of a dash along the ground is a long low leap: the dash's speed is kept, and carried a long way not far off the ground
      if (
        st.jbuf > 0 &&
        st.dash > 0 &&
        st.dashAge >= 0 &&
        (st.ground || st.coy > 0) &&
        st.hitT <= 0 &&
        !st.climb &&
        !st.slam
      ) {
        st.leap = 1.1;
        st.lsp = sp0.dash * 0.96;
        st.lfx = st.dfx;
        st.lfz = st.dfz;
        st.dash = 0;
        st.vy = sp0.jump * 0.76;
        st.ground = false;
        st.jbuf = 0;
        st.coy = 0;
        st.cut = true;
        st.launch = 0;
        st.leapE = true;
        puff(5, st.x, 1.2, 1);
      }
      if (st.leap > 0) {
        st.leap -= dt;
        if (
          (st.ground && st.leap < 0.95) ||
          st.climb ||
          st.hitT > 0 ||
          st.slam ||
          st.dash > 0 ||
          (st.wallT > 0 && st.leap < 0.9)
        )
          st.leap = 0;
        else {
          st.lsp = Math.max(sp0.run, st.lsp - 2 * dt);
          st.vx = st.lfx * st.lsp;
          st.vz = st.lfz * st.lsp;
        }
      }
      st.wallT = Math.max(0, (st.wallT || 0) - dt);
      st.wallLock = Math.max(0, (st.wallLock || 0) - dt);
      if (st.ground) {
        st.lastWall = null;
        st.wrunWall = null;
        st.wrun = 0;
        st.wrunN = 0;
      }
      if (
        st.jbuf > 0 &&
        !st.ground &&
        st.coy <= 0 &&
        st.wallT > 0 &&
        st.wallLock <= 0 &&
        !st.climb &&
        st.dash <= 0 &&
        st.hitT <= 0 &&
        st.crouch <= 0
      ) {
        const key = Math.round(Math.atan2(st.wnz, st.wnx) / (Math.PI / 4)); // a wall kick
        if (key !== st.lastWall) {
          st.vy = sp0.jump * 0.97;
          st.vx = st.wnx * 7.6;
          st.vz = st.wnz * 7.6;
          st.face = Math.atan2(st.wnz, st.wnx);
          st.lastWall = key;
          st.wallLock = 0.16;
          st.wallT = 0;
          st.jbuf = 0;
          st.grab = false;
          st.cut = true;
          st.launch = 0;
          st.wjE = true;
          st.djUsed = false;
        }
      }
      if (st.ground || st.climb) st.djUsed = false;
      if (
        st.jbuf > 0 &&
        st.djOK &&
        !st.djUsed &&
        !st.ground &&
        st.coy <= 0 &&
        st.wallT <= 0 &&
        !st.climb &&
        st.dash <= 0 &&
        st.hitT <= 0 &&
        st.crouch <= 0 &&
        !st.slam
      ) {
        st.vy = sp0.jump * 0.93;
        st.djUsed = true;
        st.jbuf = 0;
        st.cut = false;
        st.grab = false;
        st.launch = 0;
        st.djE = true;
      } // a second jump, off nothing
      if (st.jbuf > 0 && (st.ground || (st.coy > 0 && st.vy <= 0)) && st.crouch <= 0 && st.dash <= 0) {
        st.crouch = 0.001;
        st.jbuf = 0;
        st.coy = 0;
      }
      if (st.crouch > 0) {
        st.crouch -= dt;
        if (st.crouch <= 0) {
          st.vy = sp0.jump * (st.wet > 0 ? 0.8 : 1);
          st.ground = false;
          st.launch = 0;
          st.cut = false;
          st.coy = 0;
          st.jE = true;
          puff(4, st.x, 0.8, 0.8);
        }
      }
      if (inp.jumpHeld === false && !st.cut && !st.ground && st.vy > 3 && st.hitT <= 0 && st.launch > 0.05) {
        st.vy *= 0.5;
        st.cut = true;
      }
      {
        const tx = -st.wnz || 0,
          tz = st.wnx || 0,
          al = move * tx + mzI * tz,
          wk2 = Math.round(Math.atan2(st.wnz || 0, st.wnx || 0) * 2);
        if (st.wrun > 0 && (st.ground || st.climb || st.wallT <= 0 || !inp.jumpHeld || st.hitT > 0 || st.dash > 0))
          st.wrun = 0;
        else if (
          !(st.wrun > 0) &&
          !st.ground &&
          !st.climb &&
          st.wallT > 0 &&
          inp.jumpHeld &&
          st.jbuf <= 0 &&
          Math.abs(al) > 0.5 &&
          st.dash <= 0 &&
          st.hitT <= 0 &&
          !st.slam &&
          st.vy < 7 &&
          st.wrunWall !== wk2 &&
          (st.wrunN || 0) < 2
        ) {
          st.wrun = 0.95;
          st.wrunWall = wk2;
          st.wdir = al > 0 ? 1 : -1;
          if (!st.wrunN) {
            st.vy = Math.max(st.vy, 2.4);
            st.djUsed = false;
          }
          st.wrunN = (st.wrunN || 0) + 1;
        }
        if (st.wrun > 0) {
          st.wrun -= dt;
          const sp = Math.max(sp0.run * 1.08, Math.min(11, Math.hypot(st.vx, st.vz)));
          st.vx = tx * st.wdir * sp - st.wnx * 1.6;
          st.vz = tz * st.wdir * sp - st.wnz * 1.6;
          st.vy += G * dt * 0.84;
          if (st.vy < -1.4) st.vy = -1.4;
          if (st.vy > 1.5) st.vy += (1.5 - st.vy) * Math.min(1, dt * 14);
          st.face = Math.atan2(tz * st.wdir, tx * st.wdir);
          st.sliding = 0.1;
        }
      }
      if (!st.ground && !st.climb && !(st.dash > 0 && st.dashAge >= 0)) {
        st.vy -=
          G * dt * (st.vy > 1.3 ? 1 : st.vy > -1.3 && inp.jumpHeld === true && !st.cut ? 0.6 : st.vy > 0 ? 1 : 1.42);
        if (st.wallT > 0 && st.vy < -2.6 && move * st.wnx + mzI * st.wnz < -0.3) {
          st.vy = -2.6;
          st.sliding = 0.1;
        } // pressed to a wall you slide down it slowly
        st.y += st.vy * dt;
        if (st.y <= st.gh) {
          const hard = -st.vy;
          st.y = st.gh;
          st.vy = 0;
          st.ground = true;
          st.land = 0;
          st.landK = sat(hard / 9);
          if (st.slam === 2) {
            st.slamE = Math.max(0.3, Math.min(1, ((st.slamY || st.y) - st.y) / 4));
            st.slam = 0;
            st.landK = 1;
            st.vx = st.vz = 0;
          }
          if (hard > 13) st.freeze = 0.05;
          puff(hard > 5 ? 8 : 4, st.x, 1.6, 1.1);
        }
      }
      if (!(st.dash > 0 && st.dashAge >= 0)) {
        const tz =
          ((st.atk >= 0 || st.cast >= 0) && !inp.keep ? 0 : mzI) * (inp.rush || (run ? sp0.run : sp0.walk)) * wk;
        st.vz +=
          Math.sign(tz - st.vz) *
          Math.min(
            Math.abs(tz - st.vz),
            (st.ground
              ? inp.ice
                ? tz * st.vz < 0
                  ? 10
                  : Math.abs(tz) > Math.abs(st.vz)
                    ? 8
                    : 4.5
                : 42
              : st.hitT > 0 || st.wallLock > 0
                ? 8
                : inp.air || 9) * dt
          );
      }
      const Wd = spec.world,
        nx = st.x + st.vx * dt,
        nz = st.z + st.vz * dt;
      if (Wd && Wd.height && !st.ground && !st.climb && st.vy > 0)
        for (const q of [
          [0, 0],
          [0.3, 0],
          [-0.3, 0],
          [0, 0.3],
          [0, -0.3]
        ]) {
          const c = Wd.height(st.x + q[0], st.z + q[1], st.y + 1.45);
          if (
            (c > 1e8 || c > st.y + 0.55) &&
            ((!q[0] && !q[1]) || Wd.height(st.x + q[0], st.z + q[1], st.y + 0.5) < st.y + 0.5)
          ) {
            const o2 = Wd.height(st.x - q[0], st.z - q[1], st.y + 1.45),
              room =
                (q[0] || q[1]) &&
                !(o2 > 1e8 || o2 > st.y + 0.55) &&
                Wd.height(st.x - q[0] * 1.4, st.z - q[1] * 1.4, st.y + 0.5) < st.y + 0.45;
            if (room) {
              st.x -= q[0] * 0.4;
              st.z -= q[1] * 0.4;
            } else {
              st.vy = -0.5;
              break;
            }
          }
        } // (felt for across the width of the body, so the edge of a deck counts too; a wall beside you is not overhead)   // anything overhead stops a jump: a roof, or a deck you are standing under (you cannot come up through it)
      if (Wd && Wd.height) {
        // walk on whatever the scene is sculpted from: steps are walked up, ledges are climbed, walls stop you, edges can be walked off
        const RB = 0.26,
          wall = h => h > 1e8 || h > st.y + 0.45;
        let climbTo = null;
        const tryMove = (x, z) => {
          const h = Wd.height(x, z, st.y + 1.5),
            dx = x - st.x,
            dz = z - st.z,
            dl = Math.hypot(dx, dz) || 1,
            ax = x + (dx / dl) * RB,
            az = z + (dz / dl) * RB;
          const blk = h < -1e8 || wall(h) || wall(Wd.height(ax, az, st.y + 1.5)); // the body has width: feel ahead by its radius
          if (blk && h > -1e8 && st.dash <= 0 && st.crouch <= 0 && !(Wd.slick && Wd.slick(ax, az))) {
            const top = Wd.height(ax, az, st.y + 1.08);
            const foot = Wd.height(ax + (dx / dl) * 0.3, az + (dz / dl) * 0.3, st.y + 0.25);
            if (
              Math.abs(top) < 1e8 &&
              top > st.y + 0.45 &&
              Wd.height(st.x, st.z, top + 0.3) < top - 0.3 &&
              (foot > 1e8 || foot > st.y + 0.4)
            )
              climbTo = top;
          } // and only a ledge with something under it: a deck or a slab with air beneath is not climbed onto from below   // (and only from beside it: something overhead is a roof, not a ledge)   // only a ledge whose top is within arm's reach can be caught
          if (blk) return false;
          st.x = x;
          st.z = z;
          st.gh = h;
          return true;
        };
        const n = Math.max(1, Math.ceil(Math.hypot(nx - st.x, nz - st.z) / 0.1)),
          sx = (nx - st.x) / n,
          sz = (nz - st.z) / n; // small steps, so nothing thin is ever skipped over
        let bx = 0,
          bz = 0;
        for (let i = 0; i < n; i++) {
          if (tryMove(st.x + sx, st.z + sz)) continue; // slide along what blocks you, and remember which way it faced
          if (tryMove(st.x + sx, st.z)) {
            if (Math.abs(sz) > 1e-5) bz = Math.sign(sz);
            continue;
          }
          if (Math.abs(sx) > 1e-5) bx = Math.sign(sx);
          if (tryMove(st.x, st.z + sz)) continue;
          if (Math.abs(sz) > 1e-5) bz = Math.sign(sz);
          break;
        }
        if (!st.ground && (bx || bz)) {
          const tall = (ax, az) => {
            const hh = Wd.height(st.x + ax * 0.45, st.z + az * 0.45, st.y + 1.5);
            return hh > 1e8 || hh > st.y + 1.0;
          };
          if (bx && !tall(bx, 0)) bx = 0;
          if (bz && !tall(0, bz)) bz = 0;
        } // only a wall is a wall: the edge of the world stops you, but there is nothing there to kick off
        if (!st.ground && (bx || bz) && climbTo === null) {
          const l = Math.hypot(bx, bz),
            h = Wd.height(st.x + (bx / l) * 0.45, st.z + (bz / l) * 0.45, st.y + 1.5);
          if ((h > 1e8 || h > st.y + 1.0) && !(Wd.slick && Wd.slick(st.x + (bx / l) * 0.45, st.z + (bz / l) * 0.45))) {
            st.wnx = -bx / l;
            st.wnz = -bz / l;
            st.wallT = 0.16;
          }
        } // a wall too tall to catch: one to kick off (unless it is ice: there is no purchase on ice)
        if (st.ground) st.grab = false;
        if (
          !st.ground &&
          !st.climb &&
          climbTo !== null &&
          climbTo - st.y > 0 &&
          climbTo - st.y <= 0.5 &&
          (move || mzI)
        ) {
          st.y = climbTo + 0.02;
          if (st.vy < 0) st.vy = 0;
          climbTo = null;
        }
        if (st.climb) {
          if (climbTo !== null && Math.abs(climbTo - st.ctop) < 0.3 && (move || mzI)) st.climbT = 0.25;
        } // keep hold of the ledge you are on, never reach for a higher one
        else if (climbTo !== null && (move || mzI) && !st.grab && (st.ground ? climbTo - st.y <= 0.92 : true)) {
          st.climbT = 0.25;
          st.ctop = climbTo;
          st.grab = true;
        } // low ledges are stepped up onto; anything taller must be jumped for, and one catch is all a jump gets
        st.climb = st.climbT > 0;
        if (st.climb) {
          st.climbT -= dt;
          st.ground = false;
          st.vy = 0;
          st.y = Math.min(st.ctop + 0.05, st.y + 3.6 * dt);
        }
        if (st.ground) {
          if (st.gh < st.y - 0.5) st.ground = false;
          else st.y = st.gh;
        }
        {
          const wl = Wd.water ? Wd.water(st.x, st.z) : -99;
          st.wet = st.y < wl - 0.06 ? wl - st.y : 0;
        }
      } else {
        st.x = nx;
        st.z = nz;
        if (Wd) {
          const d = Math.hypot(st.x, st.z);
          if (d > Wd.rad) {
            st.x *= Wd.rad / d;
            st.z *= Wd.rad / d;
          }
        } else {
          st.x = Math.max(-EDGE, Math.min(EDGE, st.x));
          st.z = Math.max(-2.6, Math.min(2.8, st.z));
        }
      }
      if (st.vuln > 0) st.vuln -= dt;
      st.land += dt;
      st.launch += dt;
      st.turnAge += dt;
    }

    function animate(dt, time) {
      st.goo *= Math.exp(-dt * 5);
      st.born += dt;
      const FX = Math.cos(st.face),
        FZ = Math.sin(st.face);
      const sp = st.grind ? 0.3 : Math.hypot(st.vx, st.vz),
        k = Math.min(1, dt * 14),
        dashing = st.dash > 0 && st.dashAge >= 0;
      if (spec.roll) {
        const ra = st.rollA || 0;
        st.rollA = sp > 0.6 ? ra + (sp * dt) / spec.roll : ra + (Math.round(ra / TAU) * TAU - ra) * Math.min(1, dt * 8);
      } // a roller turns over as it goes, and comes to rest the right way up
      st.moveK += (ss(sp / 0.8) - st.moveK) * k;
      st.runK += (ss((sp - sp0.walk - 0.3) / 1.5) - st.runK) * k;
      st.airK += ((st.ground ? 0 : 1) - st.airK) * Math.min(1, dt * 22);
      st.dashK += ((dashing ? 1 : 0) - st.dashK) * Math.min(1, dt * 30);
      const mK = st.moveK,
        rK = st.runK,
        T0 = gait === 'hop' ? mixn(0.46, 0.34, rK) : mixn(0.62, 0.43, rK),
        duty = mixn(0.62, 0.36, rK);
      if (st.ground && sp > 0.05) st.ph = (st.ph + dt / T0) % 1;
      const fwd = st.vx * FX + st.vz * FZ >= -0.05 ? 1 : -1,
        LL = hasLegs ? pt.sock[1] - pt.ank[1] : 0.5,
        stance = Math.min(LL * 1.15, sp * T0 * duty) * fwd,
        ph = st.ph;
      const feet = [],
        hand = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 2; i++) {
        const f = (ph + i * 0.5) % 1;
        let x, y, p;
        if (f < duty) {
          const s = f / duty;
          x = stance * (0.5 - s);
          y = 0;
          p = mixn(0.3, -0.4, s) * mK * (0.4 + 0.6 * rK);
        } else {
          const s = (f - duty) / (1 - duty),
            e = s * s * (3 - 2 * s);
          x = stance * (-0.5 + e) - rK * 0.17 * LL * Math.sin(Math.PI * s);
          y = (0.16 + 0.36 * rK) * LL * Math.sin(Math.PI * s) * mK;
          p = (-0.7 * (1 - s) + 0.3 * s) * mK * (0.5 + 0.5 * rK);
        }
        feet.push({ x, y, p });
      }
      const sw = Math.cos(TAU * ph + Math.PI) * (0.2 + 0.26 * rK) * mK * fwd;
      if (hasArm) {
        hand.x = HANDR[0] - sw * 0.35 - 0.06 * rK;
        hand.y = HANDR[1] + 0.03 * Math.sin(2 * TAU * ph) * mK + 0.08 * rK;
        hand.z = HANDR[2];
      }
      let hipY = 0,
        lean = (0.05 * mK + 0.15 * rK) * fwd,
        bend = 0.05 * rK,
        twist = Math.sin(TAU * ph) * (0.1 + 0.16 * rK) * mK,
        sy =
          1 + (AN.breath || 0.014) * Math.sin(time * (AN.bf || 2.6)) * (1 - mK) + (AN.jit || 0) * Math.sin(time * 37),
        flare = 1 + (AN.wob || 0) * Math.sin(time * 3.1),
        roll =
          (AN.rock || 0) * Math.sin(time * (AN.sf || 1.5) * 0.5) * (1 - mK) +
          (AN.waddle || 0) * Math.sin(TAU * ph) * mK,
        spinA = 0,
        hx = 0;
      lean += (AN.sway || 0) * Math.sin(time * (AN.sf || 1.5)) * (1 - mK * (1 - (AN.swayRun || 0)));
      if (AN.nod) bend += AN.nod * Math.sin(time * (AN.nf || 2) + 1.3);
      if (gait === 'walk')
        hipY = -(AN.bounce || 1) * (0.042 + 0.07 * rK) * LL * Math.cos(2 * TAU * (ph - 0.07)) * mK - 0.012 * mK;
      else if (gait === 'hop') {
        const u = ph,
          hgt = (0.16 + 0.2 * rK) * H * mK,
          arc = 4 * u * (1 - u),
          vel = 1 - 2 * u;
        hipY = arc * hgt;
        sy *=
          1 +
          (0.16 * vel * vel * Math.sign(vel) * (vel > 0 ? 1 : -0.6) -
            0.2 * Math.exp(-u * 14) -
            0.12 * Math.exp(-(1 - u) * 14)) *
            mK;
        lean *= 0.6;
        sy *= 1 + 0.03 * Math.sin(time * 2.2) * (1 - mK);
      } else {
        hipY = 0.05 * H * Math.sin(time * 2.1) + 0.02 * H * mK;
        lean = (0.08 * mK + 0.14 * rK) * fwd;
      }
      let nod = -0.45 * lean + 0.035 * Math.sin(2 * TAU * ph) * mK + (AN.nodI || 0) * Math.sin(time * 4.2) * (1 - mK);
      if (st.airK > 0.001) {
        const a = st.airK,
          top = Math.exp(-(st.vy * st.vy) / 14),
          up = sat(st.vy / 6),
          dn = sat(-st.vy / 6);
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1,
            F = feet[i];
          F.x = mixn(F.x, (-0.2 * up + 0.14 * dn + s * 0.14 * top) * LL, a);
          F.y = mixn(F.y, (0.07 * up + 0.48 * top + (i ? 0.12 : 0) * top) * LL, a);
          F.p = mixn(F.p, -0.7 * up + 0.35 * dn, a);
        }
        if (hasArm) {
          hand.y = mixn(hand.y, HANDR[1] + 0.1 * top + 0.3 * dn, a);
          hand.x = mixn(hand.x, HANDR[0] - 0.08 * up, a);
        }
        sy = mixn(sy, 1 + 0.17 * up + 0.09 * dn - 0.05 * top, a);
        lean = mixn(lean, lean * 0.6 + 0.06, a);
        nod = mixn(nod, 0.12 * up - 0.2 * dn, a);
        flare += a * (0.3 * dn - 0.12 * up);
        hipY *= 1 - a;
      }
      if (st.dashK > 0.001) {
        const a = st.dashK;
        for (let i = 0; i < 2; i++) {
          const F = feet[i];
          F.x = mixn(F.x, (-0.6 - i * 0.24) * LL, a);
          F.y = mixn(F.y, (0.36 + i * 0.17) * LL, a);
          F.p = mixn(F.p, -1.0, a);
        }
        if (hasArm) {
          hand.x = mixn(hand.x, HANDR[0] - 0.45, a);
          hand.y = mixn(hand.y, HANDR[1] + 0.2, a);
        }
        lean = mixn(lean, gait === 'hop' ? 0.4 : 0.7, a);
        sy = mixn(sy, 1.24, a);
        nod = mixn(nod, -0.55, a);
        hipY = mixn(hipY, 0.1, a);
        flare -= 0.15 * a;
      }
      if (st.atk >= 0) {
        const a = st.atk,
          w = sat(a / AW),
          q = sat((a - AW) / AS),
          rec = sat((a - AW - AS) / AR),
          hit = a >= AW && a < AW + AS,
          done = a >= AW + AS;
        if (STY === 'pound') {
          const up = done ? 0 : hit ? (1 - q) * (1 - q) : Math.sin(w * 1.5708);
          hipY += 0.45 * H * up;
          sy *= 1 + 0.18 * up - (done ? 0.32 * (1 - rec) : 0);
          lean += hit ? 0.35 : done ? 0 : -0.22 * w;
          flare += done ? 0.45 * (1 - rec) : 0;
        } // rear up, slam down
        else if (STY === 'thrust') {
          lean += done ? 0.3 * (1 - rec) : hit ? 0.75 : -0.38 * w;
          sy *= done ? 1 : hit ? 1.14 : 1 - 0.17 * w;
          nod += hit ? -0.5 : done ? 0 : 0.25 * w;
        } // coil, then drive straight through
        else if (STY === 'spin') {
          spinA = (hit ? ss(q) : done ? 1 : 0) * TAU * 2;
          sy *= hit ? 0.9 : 1 - 0.1 * w * (done ? 0 : 1);
          flare += hit ? 0.5 : 0;
          lean += done ? 0 : hit ? 0 : -0.12 * w;
        } // whirl on the spot
        else if (STY === 'peck') {
          hx = (hit ? Math.sin(q * Math.PI) : 0) * 0.3 * H;
          nod += hit ? -0.8 : done ? -0.5 * (1 - rec) : 0.5 * w;
          lean += hit ? 0.4 : done ? 0.25 * (1 - rec) : -0.25 * w;
          sy *= hit ? 1.05 : 1 - 0.08 * w * (done ? 0 : 1);
        } // rear the head back, dart it out
        else if (!hit && !done) {
          lean -= 0.32 * w;
          sy *= 1 - 0.13 * w;
          nod += 0.2 * w;
        } else if (hit) {
          lean += 0.5 * (1 - 0.5 * q);
          sy *= 1 + 0.15 * (1 - q);
          nod -= 0.3;
          flare += 0.25;
        } else lean += 0.24 * (1 - rec);
      }
      if (st.cast >= 0) {
        const a = st.cast;
        if (a < 0.14) {
          const q = a / 0.14;
          lean -= 0.2 * q;
          sy *= 1 + 0.07 * q;
          nod -= 0.2 * q;
        } else {
          const q = 1 - (a - 0.14) / 0.22;
          lean += 0.22 * q;
          sy *= 1 - 0.06 * q;
        }
      }
      if (st.hitT > 0) {
        st.hitT -= dt;
        lean -= 0.4 * sat(st.hitT / 0.22);
      }
      const flash = st.hitT > 0.13,
        gone = st.dead > 0.95;
      if (spec.goo && st.dashK > 0.001) {
        sy *= 1 - 0.6 * st.dashK;
        flare += 0.8 * st.dashK;
      } // goo runs flat along the ground when it dashes
      if (st.crouch > 0) {
        sy *= 0.76;
        hipY -= (0.1 * H) / 2.2;
        lean += 0.1;
        nod += 0.2;
      }
      if (st.grind) {
        sy *= 0.84;
        lean -= 0.24;
        hipY -= 0.07;
        nod += 0.18;
        flare += 0.2;
      } // on a rail: low, leaning back, coat flying
      if (st.slam === 1) {
        sy *= 0.8;
        lean -= 0.25;
        nod -= 0.3;
      } else if (st.slam === 2) {
        sy *= 1.3;
        lean += 0.2;
        nod += 0.35;
        flare -= 0.2;
      }
      if (st.dashAge < 0) {
        lean -= 0.3;
        sy *= 0.88;
        hipY -= 0.05;
      }
      if (st.heft > 0.001) {
        sy *= 1 - 0.3 * st.heft;
        hipY -= (0.11 * st.heft * H) / 2.2;
        nod += 0.5 * st.heft;
      } // bending to something on the ground, or setting it down
      if (st.heave) lean += st.heave; // drawing back to throw, and the follow-through
      if (st.carryK > 0.001) {
        sy *= 1 - 0.05 * st.carryK;
        if (hasArm) {
          hand.x = mixn(hand.x, HANDR[0] * 0.3, st.carryK);
          hand.y = mixn(hand.y, H * 0.86, st.carryK);
        }
      } // something held over the head: an arm up under it
      const land = settle(st.land, 0.5, 3.1, 4) * (0.12 + 0.22 * (st.landK || 0));
      sy *= 1 - land;
      hipY -= land * 0.13 * H;
      hipY += st.lift || 0;
      sy *= 1 + 0.2 * settle(st.launch, 0.3, 2.5, 5);
      sy *= 1 - 0.07 * settle(st.turnAge, 0.3, 3, 5);
      /* What the animation tools add: a pose from a clip, a machine or by hand, laid over what it is doing. The lean and the nod it asks
         for go through the same springs as its own, so they arrive with its weight; a clip being played is frozen by a hit stop like the
         rest of it. Nothing here does anything until something is played or st.act is set */
      let actX = 0,
        actZ = 0;
      if (playing) {
        playing.t += dt * playing.speed;
        const po = playing.clip.sample(Math.min(playing.t, playing.clip.dur), {})[playing.part] || {},
          k = Math.PI / 180;
        st.act = {
          stretch: po.stretch,
          pos: po.pos,
          lean: (po.lean || 0) - (po.rot ? po.rot[2] * k : 0),
          spin: (po.spin || 0) + (po.rot ? po.rot[1] * k : 0),
          nod: po.nod,
          flare: po.flare
        };
        played = st.act;
        if (playing.t >= playing.clip.dur && !playing.clip.loop) playing = null;
      } else if (played && st.act === played) {
        st.act = null;
        played = null;
      }
      if (st.act) {
        const a = st.act;
        if (a.stretch !== undefined) sy *= a.stretch;
        if (a.lean) lean += a.lean;
        if (a.nod) nod += a.nod;
        if (a.flare) flare += a.flare;
        if (a.spin) spinA += a.spin;
        if (a.pos) {
          actX = a.pos[0];
          hipY += a.pos[1];
          actZ = a.pos[2];
        }
      }
      st.lookT -= dt;
      if (st.lookT <= 0) {
        st.lookT = rr(1.4, 3.4);
        st.lookTo = mK > 0.2 ? 0 : rr(-0.5, 0.6);
      }
      st.look += ((mK > 0.2 ? 0 : st.lookTo || 0) - st.look) * Math.min(1, dt * 5);
      st.blink -= dt;
      if (st.blink < -0.11) st.blink = rr(1.8, 4.2);
      const eye = st.blink < 0 ? 0.15 : 1;
      {
        let da = st.face - st.yaw;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        st.yaw += da * Math.min(1, dt * 18);
      }

      {
        const pp = st.pph;
        st.pph = ph;
        if (rK > 0.5 && st.ground && Math.floor(ph * 2) !== Math.floor(pp * 2)) puff(1, st.x - FX * 0.15, 0.5, 0.5);
      } // a puff at each running footfall
      {
        const n = Math.max(1, Math.ceil(dt / 0.009)),
          h = dt / n;
        for (let i = 0; i < n; i++) {
          st.lv += ((lean - st.ls) * 520 - st.lv * 27) * h;
          st.ls += st.lv * h;
          st.nv += ((nod - st.ns) * 200 - st.nv * 13) * h;
          st.ns += st.nv * h;
        }
        lean = st.ls;
        nod = st.ns;
      } // weight: the lean and the head overshoot and settle
      // bones in the character's own space
      const kx = 1 / Math.sqrt(sy),
        body = mul(
          mul(mul(ry(spinA), rz(-lean - (st.rollA || 0))), rxm(roll)),
          scl(
            kx *
              (1 + 0.22 * st.fat) *
              (spec.goo && st.atk >= AW && st.atk < AW + AS
                ? 1 + 1.6 * Math.sin(sat((st.atk - AW) / AS) * Math.PI)
                : 1),
            sy,
            kx * (1 + 0.22 * st.fat)
          )
        ),
        hipP = [HIP[0] + actX, HIP[1] + hipY, HIP[2] + actZ],
        side = 0;
      const at = (M, piv, pos, v) => add3(app(M, sub(v, piv)), pos),
        set = (i, M, piv, pos) => {
          BM[i] = M;
          BT[i] = sub(pos, app(M, piv));
        };
      set(0, body, HIP, hipP);
      const chM = mul(body, mul(rz(-bend), ry(twist + 0.3 * side))),
        chP = at(body, HIP, hipP, CH);
      set(1, chM, CH, chP);
      set(2, mul(body, scl(flare, 1, flare)), HEMP, at(body, HIP, hipP, HEMP));
      const hs = mixn(1, sy, 0.6),
        hdM = mul(
          mul(rz(-lean * 0.5 - bend), ry(st.look + twist * 0.4 + side)),
          mul(rz(-nod), scl(1 / Math.sqrt(hs), hs, 1 / Math.sqrt(hs)))
        );
      set(3, hdM, NECK, add3(at(chM, CH, chP, NECK), [hx, 0, 0]));
      const stretch = (i, r0, r1, q0, q1) => {
        const d0 = norm(sub(r1, r0)),
          dq = sub(q1, q0),
          L = Math.max(0.03, len(dq)),
          d1 = [dq[0] / L, dq[1] / L, dq[2] / L],
          s = L / len(sub(r1, r0)),
          kk = 1 / Math.sqrt(s),
          R = turn(d0, d1),
          e = s - kk;
        BM[i] = mul(R, [
          kk + e * d0[0] * d0[0],
          e * d0[0] * d0[1],
          e * d0[0] * d0[2],
          e * d0[1] * d0[0],
          kk + e * d0[1] * d0[1],
          e * d0[1] * d0[2],
          e * d0[2] * d0[0],
          e * d0[2] * d0[1],
          kk + e * d0[2] * d0[2]
        ]);
        BT[i] = sub(q0, app(BM[i], r0));
      };
      if (hasLegs)
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1,
            F = feet[i],
            ank = [pt.ank[0] + F.x, pt.ank[1] + F.y, s * pt.ank[2]];
          stretch(4 + i, SOCK(s), ANK(s), at(body, HIP, hipP, SOCK(s)), ank);
          set(6 + i, rz(F.p), ANK(s), ank);
        }
      if (QD)
        for (let k = 0; k < 4; k++) {
          const fr = k >> 1,
            sd = k & 1 ? 1 : -1,
            F = feet[(fr + (k & 1)) % 2],
            r0 = [QD.x[fr], QD.top, sd * QD.z],
            r1 = [QD.x[fr], QD.bot, sd * QD.z];
          stretch(QB + k, r0, r1, at(body, HIP, hipP, r0), [r1[0] + F.x * (QD.reach || 0.8), r1[1] + F.y, r1[2]]);
        }
      if (hasArm) {
        const hl = [hand.x + lean * 0.4, hand.y + hipY, hand.z];
        stretch(8, SHO, HANDR, at(chM, CH, chP, SHO), hl);
        set(9, mul(rz(-lean * 0.6 + sw * 0.5 - 0.9 * st.dashK), ry(0.2 * side)), HANDR, hl);
      }
      const cy0 = 1,
        Y = ry(-st.yaw),
        O = [st.x, st.y, st.z];
      for (let i = 0; i < 10; i++) {
        BT[i] = add3(app(Y, BT[i]), O);
        BM[i] = mul(Y, BM[i]);
      }
      if (QD)
        for (let i = QB; i < QB + 4; i++) {
          BT[i] = add3(app(Y, BT[i]), O);
          BM[i] = mul(Y, BM[i]);
        }
      // follow motion: hem on a spring, tails as ropes
      const hemT = add3(app(BM[2], HEMP), BT[2]);
      for (let c = 0; c < 3; c++) {
        st.hemV[c] += ((hemT[c] - st.hem[c]) * 150 - st.hemV[c] * 13) * dt;
        st.hem[c] += st.hemV[c] * dt;
      }
      let off = sub(st.hem, hemT);
      const ol = len(off),
        om = 0.15 * H;
      if (ol > om) {
        off = off.map(v => (v * om) / ol);
        st.hem = add3(hemT, off);
      }
      off[1] = Math.max(-0.05, off[1] * 0.6);
      BT[2] = add3(BT[2], off);
      const wind = 0.5 * Math.sin(time * 1.7) + 0.3 * Math.sin(time * 2.9);
      tails.forEach((t, c) => {
        const tl = st.tail[c],
          tp = st.tailP[c],
          ab = BI[t.bone || 'hem'],
          b0 = TB[c];
        tl[0] = add3(app(BM[ab], t.at), BT[ab]);
        for (let i = 1; i <= t.n; i++) {
          const p = tl[i],
            q = tp[i],
            v = [(p[0] - q[0]) * 0.9, (p[1] - q[1]) * 0.9, (p[2] - q[2]) * 0.9];
          tp[i] = p.slice();
          p[0] += v[0] + wind * 0.5 * dt * dt * i;
          p[1] += v[1] - (t.g === undefined ? 20 : t.g) * dt * dt;
          p[2] += v[2];
        }
        for (let it = 0; it < 3; it++)
          for (let i = 1; i <= t.n; i++) {
            const a = tl[i - 1],
              p = tl[i],
              d = sub(p, a),
              L = len(d) || 1e-4;
            tl[i] = [
              a[0] + (d[0] / L) * t.seg,
              Math.max(st.gh + 0.04, a[1] + (d[1] / L) * t.seg),
              a[2] + (d[2] / L) * t.seg
            ];
          }
        for (let i = 0; i < t.n; i++) {
          BM[b0 + i] = turn(t.dir, norm(sub(tl[i + 1], tl[i])));
          BT[b0 + i] = sub(tl[i], app(BM[b0 + i], tailRest(c, i)));
        }
      });

      /* a reaction field being played over it follows it about; then any map its bones are to be put through: each bone goes where the
         map sends the middle of what it carries, and is stretched as the map stretches space there */
      if (reacting) {
        const r = reacting;
        r.t += dt;
        if (r.t >= r.dur) {
          reacting = null;
          if (api.warp === r.map) api.warp = null;
        } else {
          r.map.center = [st.x, st.y + H * 0.5, st.z];
          r.map.t = r.t;
          r.map.k = r.k * K.acts.envelope(r.t, r.dur).opacity;
        }
      }
      if (api.warp) {
        const map = api.warp;
        for (let i = 0; i < NB; i++) {
          if (!BM[i] || !MID[i]) continue;
          const q = add3(app(BM[i], MID[i]), BT[i]),
            J = K.deform.jac(map, q);
          BT[i] = add3(map(q), app(J, sub(BT[i], q)));
          BM[i] = mul(J, BM[i]);
        }
      }
      // write the splats: place, shape, tone (astride something, your own legs are down its far sides and are not drawn)
      const astride = (st.lift || 0) > 0.2;
      for (let i = 0; i < NR; i++) {
        const r = rig[i],
          o = (start + i) * 16,
          Ma = BM[r.a],
          Ta = BT[r.a],
          p = r.p;
        if (gone || (astride && r.a >= 4 && r.a <= 7)) {
          D[o + 1] = -50;
          continue;
        }
        let M = Ma,
          x = Ma[0] * p[0] + Ma[1] * p[1] + Ma[2] * p[2] + Ta[0],
          y = Ma[3] * p[0] + Ma[4] * p[1] + Ma[5] * p[2] + Ta[1],
          z = Ma[6] * p[0] + Ma[7] * p[1] + Ma[8] * p[2] + Ta[2];
        if (r.w > 0) {
          const Mb = BM[r.b],
            Tb = BT[r.b],
            w = r.w,
            u = 1 - w;
          M = [
            Ma[0] * u + Mb[0] * w,
            Ma[1] * u + Mb[1] * w,
            Ma[2] * u + Mb[2] * w,
            Ma[3] * u + Mb[3] * w,
            Ma[4] * u + Mb[4] * w,
            Ma[5] * u + Mb[5] * w,
            Ma[6] * u + Mb[6] * w,
            Ma[7] * u + Mb[7] * w,
            Ma[8] * u + Mb[8] * w
          ];
          x = x * u + (Mb[0] * p[0] + Mb[1] * p[1] + Mb[2] * p[2] + Tb[0]) * w;
          y = y * u + (Mb[3] * p[0] + Mb[4] * p[1] + Mb[5] * p[2] + Tb[1]) * w;
          z = z * u + (Mb[6] * p[0] + Mb[7] * p[1] + Mb[8] * p[2] + Tb[2]) * w;
        }
        if (st.goo > 0.01) {
          const g = st.goo * Math.abs(r.jit) * 9;
          x += r.n[0] * g;
          y += Math.abs(r.n[1]) * g * 0.6 + g * 0.3;
          z += r.n[2] * g;
        } // goo bursts into droplets and pulls itself back together
        let shr = 1;
        if (st.dead >= 0 || st.born < 0.7) {
          // death, and arrival run backwards: the body comes apart into its splats, which fly out, fall and shrink away
          const t = st.dead >= 0 ? st.dead : (0.7 - st.born) * 0.8;
          K.dissolve.at(
            i,
            t,
            r.n[0] * (cy0 < 0 ? -1 : 1),
            r.n[2],
            DSV
          ); /* (the one coming-apart every body shares: kn-effects) */
          x += DSV[0];
          z += DSV[2];
          y = Math.max(st.gh + 0.03, y + DSV[1]);
          shr = DSV[3];
          if (shr <= 0) {
            D[o + 1] = -50;
            continue;
          }
        }
        const A = r.A;
        let c00 = 0,
          c01 = 0,
          c02 = 0,
          c11 = 0,
          c12 = 0,
          c22 = 0;
        for (let c = 0; c < 9; c += 3) {
          let ax = M[0] * A[c] + M[1] * A[c + 1] + M[2] * A[c + 2],
            ay = M[3] * A[c] + M[4] * A[c + 1] + M[5] * A[c + 2],
            az = M[6] * A[c] + M[7] * A[c + 1] + M[8] * A[c + 2];
          if (r.eye) ay *= eye;
          c00 += ax * ax;
          c01 += ax * ay;
          c02 += ax * az;
          c11 += ay * ay;
          c12 += ay * az;
          c22 += az * az;
        }
        shr *= shr;
        if (st.size && st.size !== 1) {
          const SZ = st.size;
          x = st.x + (x - st.x) * SZ;
          y = st.y + (y - st.y) * SZ;
          z = st.z + (z - st.z) * SZ;
          shr *= SZ * SZ;
        }
        D[o] = x;
        D[o + 1] = y;
        D[o + 2] = z;
        D[o + 4] = c00 * shr;
        D[o + 5] = c01 * shr;
        D[o + 6] = c02 * shr;
        D[o + 8] = c11 * shr;
        D[o + 9] = c12 * shr;
        D[o + 10] = c22 * shr;
        if (r.ramp.length > 1) {
          const n = r.n,
            nx = M[0] * n[0] + M[1] * n[1] + M[2] * n[2],
            ny = M[3] * n[0] + M[4] * n[1] + M[5] * n[2],
            nz = M[6] * n[0] + M[7] * n[1] + M[8] * n[2],
            nl = Math.hypot(nx, ny, nz) || 1;
          const lit =
            LG.lo + (LG.hi - LG.lo) * (0.5 + (0.5 * (nx * SUN[0] + ny * SUN[1] + nz * SUN[2])) / nl) + r.sh + r.jit;
          D[o + 7] = PK[flash ? WH : r.ramp[Math.max(0, Math.min(r.ramp.length - 1, Math.floor(lit * r.ramp.length)))]];
        } else D[o + 7] = PK[flash && !r.em ? WH : r.ramp[0]];
      }
      if (dashing)
        for (const s of streak)
          if (s.life <= 0 && rr(0, 1) < 0.5) {
            s.life = s.max = rr(0.1, 0.2);
            s.v = null;
            s.fx = st.dfx;
            s.fz = st.dfz;
            s.p = [
              st.x - st.dfx * rr(0.2, 0.9) + rr(-0.25, 0.25) * st.dfz,
              st.y + rr(0.2, H),
              st.z - st.dfz * rr(0.2, 0.9) + rr(-0.25, 0.25) * st.dfx
            ];
            s.l = rr(0.25, 0.6);
            break;
          }
      for (let i = 0; i < ND + NS; i++) {
        const o = (start + NR + i) * 16,
          d = i < ND ? dust[i] : streak[i - ND];
        if (d.life <= 0) {
          D[o + 3] = 0;
          D[o + 1] = -50;
          continue;
        }
        d.life -= dt;
        const u = 1 - d.life / d.max;
        if (i < ND) {
          d.p[0] += d.v[0] * dt;
          d.p[1] += d.v[1] * dt;
          d.p[2] += d.v[2] * dt;
          d.v[0] *= 1 - 3 * dt;
          d.v[1] -= 1.5 * dt;
          const s = d.s * (0.7 + 1.1 * u);
          D[o] = d.p[0];
          D[o + 1] = d.p[1];
          D[o + 2] = d.p[2];
          D[o + 3] = u > 0.75 ? 0 : 3;
          D[o + 4] = s * s;
          D[o + 5] = 0;
          D[o + 6] = 0;
          D[o + 8] = s * s;
          D[o + 9] = 0;
          D[o + 10] = s * s;
        } else {
          if (d.v) {
            d.p[0] += d.v[0] * dt;
            d.p[1] += d.v[1] * dt;
            d.p[2] += d.v[2] * dt;
          }
          const w = (d.v ? 0.055 : 0.03) * (1 - u),
            l = d.l;
          D[o] = d.p[0];
          D[o + 1] = d.p[1];
          D[o + 2] = d.p[2];
          const e = l * l - w * w,
            qx = d.fx === undefined ? 1 : d.fx,
            qz = d.fz || 0;
          D[o + 3] = 3;
          D[o + 4] = w * w + e * qx * qx;
          D[o + 5] = 0;
          D[o + 6] = e * qx * qz;
          D[o + 8] = w * w;
          D[o + 9] = 0;
          D[o + 10] = w * w + e * qz * qz;
        }
      }
      // the slash: a crescent of light swept from over the shoulder down to the ground in front
      let ro = (start + NR + ND + NS) * 16;
      const sa = st.atk,
        PD = STY === 'pound',
        t0 = PD ? AW + AS * 0.75 : AW,
        on = sa >= t0 && sa < AW + AS + (PD ? 0.14 : 0.07),
        u = sat((sa - t0) / (PD ? 0.17 : AS)),
        fade = PD ? 1 - u * 0.7 : sa > AW + AS ? 1 - (sa - AW - AS) / 0.07 : 1;
      for (let i = 0; i < NSL; i++, ro += 16) {
        if (!on) {
          D[ro + 1] = -50;
          continue;
        }
        const f = i / (NSL - 1);
        let lf,
          ll = 0,
          py,
          tf = 1,
          tl = 0,
          ty = 0,
          w,
          l;
        if (STY === 'thrust' || STY === 'peck') {
          const pk = STY === 'peck',
            len = reach * (pk ? 0.9 : 1.35) * ss(u);
          lf = 0.25 + len * (1 - f * 0.85);
          py = st.y + H * (pk ? 0.78 : 0.5) - (pk ? 0.22 * H * (1 - f) * ss(u) : 0);
          w = (0.045 * (1 - f) + 0.01) * fade * reach;
          l = reach * 0.12;
        } else if (PD) {
          const a = f * TAU,
            R = reach * (0.35 + 0.95 * u);
          lf = 0.3 + Math.cos(a) * R;
          ll = Math.sin(a) * R;
          py = st.gh + 0.05 + 0.1 * u;
          tf = -Math.sin(a);
          tl = Math.cos(a);
          w = 0.07 * fade * reach;
          l = R * 0.22;
        } else if (STY === 'spin') {
          const a = u * TAU * 2 - f * 2.4;
          lf = Math.cos(a) * reach * 0.95;
          ll = Math.sin(a) * reach * 0.95;
          py = st.y + H * 0.45;
          tf = -Math.sin(a);
          tl = Math.cos(a);
          w = (0.05 * (1 - f) + 0.012) * fade * reach;
          l = reach * 0.13;
        } else {
          const th = 1.75 - 2.6 * ss(u) + 1.2 * f * Math.min(1, u * 3 + 0.2);
          tf = -Math.sin(th);
          ty = Math.cos(th);
          w = (0.13 * (1 - f) + 0.015) * fade * reach;
          l = reach * 0.11;
          lf = 0.15 + Math.cos(th) * reach;
          py = st.y + H * 0.5 + Math.sin(th) * reach * 0.85;
        }
        const tx = tf * FX - tl * FZ,
          tz = tf * FZ + tl * FX,
          e = l * l - w * w;
        D[ro] = st.x + lf * FX - ll * FZ;
        D[ro + 1] = Math.max(st.gh + 0.04, py);
        D[ro + 2] = st.z + lf * FZ + ll * FX;
        D[ro + 4] = w * w + e * tx * tx;
        D[ro + 5] = e * tx * ty;
        D[ro + 6] = e * tx * tz;
        D[ro + 8] = w * w + e * ty * ty;
        D[ro + 9] = e * ty * tz;
        D[ro + 10] = w * w + e * tz * tz;
      }
      for (let i = 0; i < NBO; i++, ro += 16) {
        const b = st.bolt;
        if (!b) {
          D[ro + 1] = -50;
          continue;
        }
        const bs = Math.hypot(b.vx, b.vz) || 1,
          bx = b.vx / bs,
          bz = b.vz / bs,
          w = spec.arrow
            ? i === 0
              ? 0.065
              : i === NBO - 1
                ? 0.075
                : 0.028
            : (i ? 0.075 * (1 - i / NBO) : 0.11) * (0.85 + 0.15 * Math.sin(time * 40 + i)),
          l = spec.arrow ? (i === 0 ? 0.15 : 0.13) : i ? 0.16 : w,
          e = l * l - w * w;
        D[ro] = b.x - bx * (spec.arrow ? 0.21 : 0.17) * i;
        D[ro + 1] = b.y + (i && !spec.arrow ? 0.03 * Math.sin(time * 30 + i * 2) : 0);
        D[ro + 2] = b.z - bz * (spec.arrow ? 0.21 : 0.17) * i;
        D[ro + 4] = w * w + e * bx * bx;
        D[ro + 5] = 0;
        D[ro + 6] = e * bx * bz;
        D[ro + 8] = w * w;
        D[ro + 9] = 0;
        D[ro + 10] = w * w + e * bz * bz;
      }
      // rings: thin arcs of light turning about a bone
      st.spin += dt;
      for (const r of rings) {
        const b = BI[r.bone || 'head'],
          M = BM[b],
          c = add3(app(M, r.c), BT[b]),
          ax = norm(r.axis || [0, 1, 0]),
          u = norm(Math.abs(ax[1]) > 0.9 ? cross(ax, [1, 0, 0]) : cross(ax, [0, 1, 0])),
          v = cross(ax, u),
          n = r.n || 20,
          arc = (r.arc === undefined ? 0.6 : r.arc) * TAU,
          a0 = (r.phase || 0) + st.spin * (r.speed || 0),
          w = r.w || 0.02;
        for (let i = 0; i < n; i++, ro += 16) {
          const a = a0 + (arc * i) / (arc >= TAU - 1e-6 ? n : n - 1),
            q = app(M, [
              (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r.r,
              (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r.r,
              (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r.r
            ]);
          D[ro] = c[0] + q[0];
          D[ro + 1] = c[1] + q[1];
          D[ro + 2] = c[2] + q[2];
          D[ro + 4] = w * w;
          D[ro + 5] = 0;
          D[ro + 6] = 0;
          D[ro + 8] = w * w;
          D[ro + 9] = 0;
          D[ro + 10] = w * w;
        }
      }
      {
        const sw =
            (st.dead >= 0 || spec.blob ? 0 : 1) *
            (spec.shadow || 0.26 * H) *
            (1 - 0.35 * sat(st.y / 2)) *
            (1 + 0.5 * st.dashK),
          sd = sw * 0.5;
        D[ro] = st.x;
        D[ro + 1] = st.gh + 0.03;
        D[ro + 2] = st.z;
        D[ro + 4] = sw * sw;
        D[ro + 5] = 0;
        D[ro + 6] = 0;
        D[ro + 8] = 1e-5;
        D[ro + 9] = 0;
        D[ro + 10] = sd * sd;
      }
    }

    const place = () => {
      st.hem = [st.x + HEMP[0], st.y + HEMP[1], st.z];
      st.hemV = [0, 0, 0];
      tails.forEach((t, c) => {
        for (let i = 0; i <= t.n; i++) {
          const p = add3(tailRest(c, i), [st.x, st.y, st.z]);
          st.tail[c][i] = p.slice();
          st.tailP[c][i] = p.slice();
        }
      });
    };
    if (spec.world && spec.world.height) {
      const h = spec.world.height(st.x, st.z, 7);
      st.gh = Math.abs(h) < 1e8 ? h : 0;
      st.y = st.gh;
      place();
    }
    /* for the animation tools: what is being played, and the middle of what each bone carries */
    let playing = null,
      played = null,
      reacting = null;
    const MID = [];
    {
      const sum = [];
      for (const r of rig) {
        const q = sum[r.a] || (sum[r.a] = [0, 0, 0, 0]);
        q[0] += r.p[0];
        q[1] += r.p[1];
        q[2] += r.p[2];
        q[3]++;
      }
      sum.forEach((q, i) => {
        MID[i] = [q[0] / q[3], q[1] / q[3], q[2] / q[3]];
      });
    }
    const api = {
      warp: null,
      /* play a clip over whatever it is doing: a K.anim clip (its `body` part, or o.part), or one of K.acts by name */
      play(c, o) {
        o = o || {};
        const clip =
          typeof c === 'string'
            ? K.acts.clip(c, { part: 'body', unit: o.unit === undefined ? H / 260 : o.unit, gain: o.gain, dur: o.dur })
            : c;
        playing = { clip, t: 0, part: o.part || 'body', speed: o.speed || 1 };
        return clip;
      },
      playing: () => (playing ? playing.clip : null),
      /* play one of the reaction fields (K.deform.EMOTES: shiver, spring, heartbeat ...) through its whole body for o.dur seconds */
      react(motion, o) {
        o = o || {};
        const map = K.deform.emote({ width: H * 0.9, height: H, motion });
        reacting = { map, t: 0, dur: o.dur || 1.6, k: o.k === undefined ? 1 : o.k };
        map.k = 0;
        api.warp = map;
        return map;
      },
      total,
      rig: NR,
      height: H,
      reach,
      st,
      spec,
      aw: AW,
      as: AS,
      sty: STY,
      bind(world, at) {
        D = world.data;
        start = at;
        PK = P.map(c => (c[0] | 0) + (c[1] | 0) * 256 + (c[2] | 0) * 65536);
      },
      update(dt, inp, time) {
        if (st.freeze > 0) {
          st.freeze -= dt;
          if (inp.jump) st.jbuf = 0.2;
          return;
        }
        control(dt, inp);
        animate(dt, time);
      },
      burst(x, y, z, n) {
        spark(n || 6, x, y, z);
      },
      striking() {
        return st.atk >= AW && st.atk < AW + AS && !st.connected;
      },
      hurt(kx, kz) {
        if (st.dead >= 0) return;
        if (spec.goo) st.goo = 1;
        if (spec.gulp && st.vuln <= 0) {
          st.fat++;
          st.hitT = 0.16;
          if (st.fat >= 3) {
            st.cast = 0;
            st.atk = -1;
            st.face = Math.atan2(-kz, -kx);
            st.vuln = 4;
          }
          return;
        } // swallow the blow, swell, and on the third send it all back
        st.hitT = 0.22;
        st.vx = kx * 4.5;
        st.vz = kz * 4.5;
        st.vy = 3.2;
        st.y = Math.max(st.y, st.gh + 0.01);
        st.ground = false;
        st.atk = -1;
        st.cast = -1;
        st.dash = 0;
        st.hp--;
        if (st.hp <= 0 && spec.mortal) {
          st.dead = 0;
          puff(12, st.x, 2.4, 1.8);
        }
      },
      respawn(x) {
        st.x = x;
        if (spec.world && spec.world.height) {
          const h = spec.world.height(x, st.z, 7);
          st.gh = Math.abs(h) < 1e8 ? h : 0;
        }
        st.y = st.gh;
        st.born = 0;
        st.vx = st.vy = st.vz = 0;
        st.ground = true;
        st.hp = spec.hp || 3;
        st.dead = -1;
        st.hitT = 0;
        st.launch = 0;
        place();
        puff(6, x, 1.2, 1.2);
      }
    };
    return api;
  };
})(KIT);
