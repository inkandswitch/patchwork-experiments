// ink-studio selftest: every module does what it says, in numbers. Run after any change to src/:   ink-studio selftest
module.exports = function (A) {
  const K = A.KIT,
    V = K.V,
    M = K.M;
  let fails = 0,
    n = 0;
  const ok = (name, cond, detail) => {
      n++;
      if (!cond) fails++;
      console.log((cond ? 'ok    ' : 'FAIL  ') + name + (detail !== undefined ? '   ' + detail : ''));
    },
    near = (a, b, e) => Math.abs(a - b) < (e || 1e-3);
  // ---- maths
  {
    const R = M.rot(V.norm([1, 2, 3]), 0.7),
      S = M.mul(R, M.stretch([0, 1, 0], 1.6, true)),
      P = M.turnOf(S),
      I = M.mul(M.inv(S), S);
    ok('math: inverse', near(I[0], 1) && near(I[4], 1) && near(I[1], 0));
    ok(
      'math: turnOf recovers the turn from a squashed turn',
      R.every((v, k) => near(v, P[k], 0.02))
    );
    ok('math: turnOf survives a flat matrix', M.turnOf([1, 0, 0, 0, 1, 0, 0, 0, 0]).every(Number.isFinite));
    ok('math: stretch keeps volume', near(M.det(M.stretch([0, 1, 0], 2, true)), 1));
    ok('math: kf with an ease name', near(K.kf(0.5, [0, 0, 1, 2, 'linear']), 1) && near(K.kf(2, [0, 0, 1, 2]), 2));
    const s = K.spring(0, 80, 0.4);
    let over = 0;
    for (let i = 0; i < 300; i++) over = Math.max(over, s.step(1, 1 / 60));
    ok(
      'math: an under-damped spring overshoots and settles',
      over > 1.05 && near(s.x, 1, 0.01),
      'peak ' + over.toFixed(2)
    );
  }
  // ---- motion
  {
    const sp = K.spine(
      [
        [0, 0, 0],
        [2, 0, 0],
        [4, 1, 0],
        [6, 1, 2]
      ],
      40,
      { rad: () => 0.3 }
    );
    for (let j = 0; j <= 40; j++) sp.wish(j, sp.C[j][0], sp.C[j][1] + Math.sin(j * 0.4), sp.C[j][2]);
    sp.lay(0, 40);
    let mx = 0,
      mn = 9;
    for (let j = 1; j <= 40; j++) {
      const d = V.dist(sp.P[j], sp.P[j - 1]);
      mx = Math.max(mx, d);
      mn = Math.min(mn, d);
    }
    ok(
      'spine: lay never stretches a link, and barely shortens one on a sharp bend',
      mx <= sp.SL + 1e-6 && mn > sp.SL * 0.9,
      mn.toFixed(3) + '..' + mx.toFixed(3) + ' of ' + sp.SL.toFixed(3)
    );
    const k = K.ik2([0, 2, 0], [1.5, 0, 0], 1.5, 1.5, [0, 1, 0]);
    ok('ik2: both bones keep their length', near(V.dist([0, 2, 0], k.mid), 1.5) && near(V.dist(k.mid, k.tip), 1.5));
    ok(
      'ik2: a target out of reach is brought in',
      near(V.dist([0, 0, 0], K.ik2([0, 0, 0], [9, 0, 0], 1, 1, [0, 1, 0]).tip), 2, 0.01)
    );
    const cues = [],
      m = K.machine({
        start: 'a',
        states: {
          a: {
            clip: K.clip({ dur: 1, tracks: { v: [0, 0, 1, 1] }, cues: [[0.5, 'half']] }),
            then: 'b',
            on: { hit: 'b' }
          },
          b: { clip: K.clip({ dur: 1, loop: true, tracks: { v: [0, 5] } }) }
        },
        cue: c => cues.push(c)
      });
    for (let i = 0; i < 80; i++) m.update(1 / 60);
    ok(
      'machine: runs on to the next state and fires its cue',
      m.state === 'b' && cues.length === 1 && near(m.values.v, 5, 0.05)
    );
    const g = K.gait({
        feet: [
          { home: [1, 1], group: 0 },
          { home: [-1, 1], group: 1 },
          { home: [1, -1], group: 1 },
          { home: [-1, -1], group: 0 }
        ],
        reach: 0.4,
        time: 0.2
      }),
      body = { p: [0, 0, 0], yaw: 0, v: [1, 0] };
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      body.p[0] += 1 / 60;
      g.update(1 / 60, body);
      for (const f of g.feet) worst = Math.max(worst, Math.abs(f.p[0] - body.p[0] - f.home[0]));
    }
    ok(
      'gait: feet keep up with a walking body',
      g.steps > 20 && worst < 1.6,
      g.steps + ' steps, worst lag ' + worst.toFixed(2)
    );
    const r = K.rope(
      [
        [0, 3, 0],
        [0, 2.5, 0],
        [0, 2, 0],
        [0, 1.5, 0]
      ],
      { floor: () => 0 }
    );
    for (let i = 0; i < 200; i++) r.step(1 / 60, [Math.sin(i * 0.1), 3, 0]);
    ok('rope: links keep their length', near(V.dist(r.P[3], r.P[2]), 0.5, 0.02));
  }
  // ---- shapes
  {
    const J = K.sdf.JOIN;
    ok('sdf: round join fills the corner', J.round(0.1, 0.1, 0.3) < Math.min(0.1, 0.1) && near(J.round(1, 2, 0.3), 1));
    ok('sdf: stairs join stays on or under the plain union', J.stairs(0.2, 0.2, 0.6, 3) <= 0.2 + 1e-9);
    ok('sdf: cut removes', J.cut(-1, -0.5) > 0);
    const B = A.makeBuilder(1, [0, 0xff0000, 0x00ff00, 0x0000ff]),
      S = K.sculpt(A.makeSculpt(B)),
      d6 = S.regular('d6', [0, 2, 0], 1, { r: [1] }, { rd: 0.1, res: 0.12 }),
      ring = S.fold(S.ball([2, 0.3, 0], 0.3, { r: [2] }, { hold: true }), { polar: 6 }, { res: 0.1 });
    S.bake();
    const W = B.finish({ cam: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0, sway: 0 }, radius: 4, detail: 14 });
    ok(
      'regular solid: six faces, each with a frame',
      d6.faces.length === 6 && d6.faces.every(f => near(V.dot(f.n, f.u), 0) && near(f.r, 1, 0.01))
    );
    ok('regular solid: its surface is where it should be', near(S.sdf(0, 3, 0), 0, 0.01) && S.sdf(0, 2, 0) < -0.9);
    ok(
      'fold: six copies round the axis',
      near(S.sdf(-2, 0.3, 0), -0.3, 0.02) && near(S.sdf(1, 0.3, Math.sqrt(3)), -0.3, 0.02)
    );
    ok('bake made splats for both', W.count > 800, W.count + ' splats');
    const st = K.stage(W),
      art = K.art({
        shapes: [
          { rect: [0, 0, 50, 100], fill: 3 },
          { d: 'M60 10 L90 10 L90 40 Z', fill: 2 }
        ]
      });
    ok('art: raster and lookup', art.at(0.25, 0.5) === 3 && art.at(0.75, 0.5) === -1 && art.at(0.85, 0.85) === 2);
    ok('art: svg curves and arcs parse', K.svgPath('M0 0 C10 0 10 10 0 10 A5 5 0 0 1 0 0 Z')[0].length > 20);
    const faces = K.art.faces(st, [{ face: d6.faces.find(f => f.n[2] > 0.9), art, size: 1 }]);
    st.add(faces);
    st.update(1 / 60, 0);
    let blue = 0;
    for (const i of faces.ids) if (st.D[i * 16 + 7] === 0xff0000) blue++;
    ok(
      "art: splats on the face take the art's colours",
      faces.count > 50 && blue > 10,
      faces.count + ' on the face, ' + blue + ' painted'
    );
    // ---- fields, voxels, light, pick
    const smooth = A.makeSculpt(A.makeBuilder(1)),
      group = smooth.grp(0.2),
      material = { r: [1, 2] };
    smooth.ball([0, 0, 0], 1, material, group);
    smooth.add({ bc: [0, 0, 0], br: 1, sd: () => NaN }, material, group);
    smooth.ready();
    ok('field: an undefined distance does not erase other members of a smooth union', near(smooth.sdf(0, 0, 0), -1));
    const ball = K.shape.sphere([0, 2, 1], 0.6),
      hole = K.fx.tint(st, K.field({ soft: 0.05, shapes: [{ shape: ball, opacity: 0 }] }), 'multiply');
    st.add(hole);
    st.update(1 / 60, 0.1);
    let hid = 0;
    for (let i = 0; i < st.N; i++) if (st.base[i * 16 + 3] >= 1 && st.D[i * 16 + 3] === 0) hid++;
    ok('field: an opacity-0 shape makes a hole', hid > 10, hid + ' splats hidden');
    ball.c = [9, 9, 9];
    hole.field.touch();
    st.update(1 / 60, 0.2);
    let still = 0;
    for (let i = 0; i < st.N; i++) if (st.base[i * 16 + 3] >= 1 && st.D[i * 16 + 3] === 0) still++;
    ok('field: and it heals when the shape moves away', still === 0);
    const vx = K.voxels(st, { cell: 0.3 });
    vx.brush('heat', [0, 3, 0], 0.5, 1);
    ok('voxels: brush and read back', vx.get('heat', 0, 2.95, 0) > 0.4 && vx.get('heat', 0, 1.2, 0) === 0);
    const hang = vx.unsupported(null, 0.5);
    ok(
      'voxels: the die, which floats, is found to be unsupported, and the ring on the floor is not',
      hang.length > 20 && hang.every(c => vx.centre(c)[1] > 0.8),
      hang.length + ' cells hang'
    );
    const hit = K.pick(st, [0, 2, 9], [0, 0, -1]);
    ok(
      "pick: a line from in front meets the die's front face",
      hit && near(hit.p[2], 1, 0.15),
      hit ? 'z ' + hit.p[2].toFixed(2) : 'missed'
    );
    const fl = K.flow.around(K.flow.wind([0, 0, -1]), S.sdf, 0.5),
      o = [0, 0, 0];
    fl(0, 2, 1.1, 0, o);
    ok(
      'flow: a wind blowing at a face is turned aside there',
      o[2] > -0.35,
      'into-surface speed ' + (-o[2]).toFixed(2)
    );
  }
  // ---- bent space and flat outlines
  {
    const B = A.makeBuilder(1, [0, 0x808080, 0xa0a0a0]),
      S = K.sculpt(A.makeSculpt(B)),
      m = { r: [1, 2] },
      H = { hold: true };
    const tw = S.warp(S.box([0, 2, 0], [1, 2, 0.2], m, H), { twist: Math.PI / 8, c: [0, 0, 0] }, { hold: true });
    ok(
      'warp: a slab twisted a quarter turn over its height faces the other way at the top',
      tw.sd(0.9, 0.05, 0) < 0 && tw.sd(0, 0.05, 0.9) > 0 && tw.sd(0, 3.95, 0.9) < 0 && tw.sd(0.9, 3.95, 0) > 0
    );
    const tp = S.warp(
      S.box([5, 2, 0], [1, 2, 1], m, H),
      { taper: [1, 0.25], y0: 0, y1: 4, c: [5, 0, 0] },
      { hold: true }
    );
    ok(
      'warp: a tapered block is narrow at the top',
      tp.sd(5.8, 0.2, 0) < 0 && tp.sd(5.8, 3.8, 0) > 0 && tp.sd(5.15, 3.8, 0) < 0
    );
    const sh = S.shell(S.ball([0, 10, 0], 1, m, H), 0.2, { hold: true });
    ok(
      'shell: hollow in the middle, solid at the skin',
      sh.sd(0, 10, 0) > 0.5 && sh.sd(1, 10, 0) < 0 && sh.sd(1.3, 10, 0) > 0
    );
    const ex = S.extrude(K.poly2.with(K.poly2.rect(2, 2), K.poly2.ngon(16, 0.4)), [10, 1, 0], 0.5, m, { hold: true });
    ok(
      'extrude: an outline with a hole, pushed to a depth',
      ex.sd(10.8, 1, 0) < 0 && ex.sd(10, 1, 0) > 0.3 && ex.sd(10.8, 1, 0.4) > 0.1
    );
    const rv = S.revolve(
      [
        [
          [0.5, 0],
          [1, 0],
          [1, 1],
          [0.5, 1]
        ]
      ],
      [15, 0, 0],
      m,
      { hold: true }
    );
    ok(
      'revolve: a square turned about the axis is a thick ring',
      rv.sd(15.75, 0.5, 0) < 0 && rv.sd(15, 0.5, 0.75) < 0 && rv.sd(15, 0.5, 0) > 0.4
    );
    const bw = S.bubbles(S.box([30, 0.5, 0], [2, 0.5, 2], m, H), { cell: 0.5, h: 0.2, flat: 'y', hold: true });
    ok(
      'bubbles: domes stand up at the middle of each cell and not between them',
      bw.sd(30.25, 1.12, 0.25) < 0 && bw.sd(30.5, 1.12, 0.5) > 0
    );
    const pf = S.puff(K.poly2.ngon(24, 1), [40, 1, 0], 1, m, { hold: true });
    ok(
      'puff: a disc blown up is thick in the middle and closed at the rim',
      pf.sd(40, 1, 0.4) < 0 && pf.sd(40, 1, 0.6) > 0 && pf.sd(40.9, 1, 0.3) > 0 && pf.sd(41.2, 1, 0) > 0
    );
    const star = S.extrude(K.poly2.star(5, 1, 0.4), [20, 1, 0], 0.4, m, { res: 0.1 }),
      bent = S.warp(S.box([25, 0.5, 0], [2, 0.2, 0.3], m, H), { bend: 0.5, thick: 0.3 }, { res: 0.1 });
    S.bake();
    const W = B.finish({ cam: { target: [0, 1, 0], dist: 14, pitch: 0.2, yaw: 0, sway: 0 }, radius: 30, detail: 12 });
    let up = 0;
    for (let i = 0; i < W.count; i++) if (W.data[i * 16] > 22 && W.data[i * 16 + 1] > 1.2) up++;
    ok(
      'warp and extrude bake into splats, and the bent bar curls up off the ground',
      W.count > 1000 && up > 30,
      W.count + ' splats, ' + up + ' lifted'
    );
    ok(
      'svg outline: scaled and centred',
      (() => {
        const L = K.poly2.svg('M0 0 L10 0 L10 20 L0 20 Z', 2)[0];
        return near(Math.max(...L.map(p => p[1])), 1) && near(Math.max(...L.map(p => p[0])), 0.5);
      })()
    );
  }
  // ---- weight: what is held up, and pieces that land on things
  {
    const box = (x, y, z) => {
        const qx = Math.abs(x) - 1,
          qy = Math.abs(y - 0.5) - 0.5,
          qz = Math.abs(z) - 1;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      },
      world = (x, y, z) => Math.min(y, box(x, y, z));
    const B = A.makeBuilder(1, [0, 0x808080]),
      S = A.makeSculpt(B);
    S.ball([0.2, 4, 0], 0.4, { r: [1] }, { res: 0.08, tag: 'a' });
    S.ball([3, 4, 0], 0.4, { r: [1] }, { res: 0.08, tag: 'b' });
    S.bake();
    const W = B.finish({ cam: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0, sway: 0 }, radius: 6, detail: 12 }),
      st = K.stage(W),
      rb = K.rubble(st, { solid: world });
    st.add(rb);
    const ia = [],
      ib = [];
    for (let i = 0; i < W.count; i++) (W.data[i * 16] < 1.5 ? ia : ib).push(i);
    const a = rb.spawn(ia),
      b = rb.spawn(ib);
    for (let t = 0; t < 5; t += 1 / 60) st.update(1 / 60, t);
    const ya = a.c[1],
      yb = b.c[1];
    for (let t = 5; t < 6; t += 1 / 60) st.update(1 / 60, t);
    ok(
      'rubble: a piece dropped over a block stays on the block, one dropped beside it stays on the ground',
      near(a.c[1], ya, 0.03) &&
        near(b.c[1], yb, 0.03) &&
        near(a.c[1], 1.4, 0.15) &&
        near(b.c[1], 0.4, 0.15) &&
        Math.abs(a.c[0]) < 1.2,
      'heights ' +
        a.c[1].toFixed(2) +
        ' and ' +
        b.c[1].toFixed(2) +
        ', speeds ' +
        Math.hypot(...a.v).toFixed(2) +
        ' ' +
        Math.hypot(...b.v).toFixed(2)
    );
    // a post with a slab on top; take the middle of the post away and the slab is an island
    let cut = false;
    const post = (x, y, z) => {
        let d = Math.min(
          Math.max(Math.hypot(x, z) - 0.3, Math.abs(y - 1) - 1),
          Math.max(Math.hypot(x, z) - 1, Math.abs(y - 2.2) - 0.2)
        );
        if (cut) d = Math.max(d, 0.5 - Math.abs(y - 1));
        return d;
      },
      sg = K.solids(post, [-1.5, 0, -1.5], [1.5, 3, 1.5], 0.15);
    sg.flood(2);
    const top = sg.at(0.8, 2.2, 0);
    const before = sg.reached[top];
    cut = true;
    sg.forget([0, 1, 0], 1);
    sg.flood(2);
    ok(
      'solids: the slab is held up by its post until the post is cut through',
      before === 1 && sg.reached[top] === 0 && sg.island(top, new Uint8Array(sg.nc)).length > 100
    );
  }
  // ---- built to rule
  {
    const f = K.fit(5, 1.2);
    ok('fit: a span is cut into whole equal bays', f.n === 4 && near(f.size, 1.25));
    const B = A.makeBuilder(1, [0, 0x808080, 0xa0a0a0, 0xc0c0c0]),
      S = K.sculpt(A.makeSculpt(B)),
      m = { stone: { r: [1, 2, 3] }, metal: { r: [1, 2, 3] }, post: { r: [1] } };
    const a = K.build.pillar(S, [0, 0, 0], 4, { r: 0.5, mats: m }),
      b = K.build.pillar(S, [3, 0, 0], 7, { r: 0.5, mats: m }),
      st1 = K.build.stairs(S, [0, 0, 3], [1, 0], 1.3, { mats: m }),
      pipe = K.build.pipe(
        S,
        [
          [-4, 1, 0],
          [-4, 1, 3],
          [-2, 1, 5]
        ],
        { r: 0.5, mats: m }
      ),
      fence = K.build.fence(S, [0, 0, -3], [5, 0, -3], { mats: m, ground: x => x * 0.1 });
    S.bake();
    B.finish({ cam: { target: [0, 1, 0], dist: 14, pitch: 0.2, yaw: 0, sway: 0 }, radius: 7, detail: 12 });
    ok(
      'pillar: a taller one has more bays, the same base and capital',
      b.recipe.bays > a.recipe.bays && near(S.sdf(0.5 * 1.3, 0.05, 0), S.sdf(3 + 0.5 * 1.3, 0.05, 0), 0.02),
      a.recipe.bays + ' and ' + b.recipe.bays + ' bays'
    );
    ok(
      'stairs: the risers add up to the rise exactly',
      near(st1.recipe.risers * st1.recipe.riser, 1.3, 1e-9) && near(st1.sockets.top.p[1], 1.3)
    );
    ok(
      'pipe: hollow from end to end, with a socket at each end',
      pipe.clear() && S.sdf(-4, 1.45, 1.5) < 0.03 && !!pipe.sockets.a && !!pipe.sockets.b
    );
    ok('fence: posts follow the ground', near(fence.sockets.end.p[1], 0.5, 1e-6) && fence.recipe.bays === 4);
    const px = K.art.pixels(['.##.', '#..#', '#..#', '.##.'], { '#': 3 });
    ok('art: a grid of characters is artwork too', px.at(0.4, 0.9) === 3 && px.at(0.4, 0.6) === -1);
  }
  // ---- the lab dioramas, run for a while
  const run = (id, secs, each) => {
    const s = A.SCENES.find(q => q.id === id),
      w = s.build(s.seed),
      st = w.anim;
    st.update(0, 0);
    let bad = 0,
      t = 0;
    for (; t < secs; t += 1 / 30) {
      st.update(1 / 30, t);
      if (each) each(w, t);
    }
    for (let i = 0; i < w.count * 16; i++) if (!Number.isFinite(w.data[i])) bad++;
    ok(id + ': ' + secs + ' s without a bad number', bad === 0, w.count + ' splats');
    return w;
  };
  {
    const w = run('watcher', 10.5, (w, t) => {
      if (Math.abs(t - 5) < 0.02) w.anim.poke([0, 3.4, 20], [0, 0, -1], t);
    });
    ok(
      'watcher: it hopped, and the art is on its faces',
      w.lab.hops() >= 2 && w.lab.art.count > 1500,
      w.lab.hops() + ' hops, ' + w.lab.art.count + ' splats carry art'
    );
  }
  {
    const w = run('burn', 26),
      L = w.lab,
      b = L.vx.layer('burnt');
    let burnt = 0;
    for (let c = 0; c < L.vx.nc; c++) if (b[c] > 200) burnt++;
    ok(
      'burn: fire spread, burnt out and left its mark',
      burnt > 150,
      burnt + ' cells burnt, ' + L.fire.active.size + ' still alight'
    );
    ok(
      'burn: frost took hold and stayed within its reach',
      L.frost.active.size > 5 && L.frost.active.size < 4000,
      L.frost.active.size + ' cells'
    );
  }
  {
    const w = run('idol', 16),
      L = w.lab,
      rb = L.rub.bodies;
    ok(
      'idol: five blows; the lumps are rubble that has come to rest on something',
      L.brk.strikes === 5 &&
        rb.length >= 6 &&
        rb.filter(b => b.asleep).length >= rb.length - 3 &&
        rb.every(b => b.c[1] > -0.2),
      rb.length + ' pieces, ' + rb.filter(b => b.asleep).length + ' at rest'
    );
    ok(
      'idol: only the head was left hanging, and the fence and arch still stand',
      L.brk.fell === 1,
      L.brk.fell + ' pieces fell for want of support'
    );
    let head = 0;
    for (let i = 0; i < w.count; i++)
      if (
        w.anim.base[i * 16 + 1] > 5.3 &&
        Math.hypot(w.anim.base[i * 16], w.anim.base[i * 16 + 2]) < 1.6 &&
        w.anim.base[i * 16 + 3] >= 1 &&
        w.data[i * 16 + 3] > 0 &&
        w.data[i * 16 + 1] > 5.2
      )
        head++;
    const hb = L.rub.bodies.reduce((m, b) => (b.ids.length > (m ? m.ids.length : 0) ? b : m), null);
    ok(
      'idol: with its neck gone the head dropped onto what was under it and stopped there',
      hb && hb.ids.length > 500 && hb.c[1] < 5.6 && hb.c[1] > 0.3,
      hb ? hb.ids.length + ' splats, now at height ' + hb.c[1].toFixed(2) : 'no head'
    );
  }
  {
    const w = run('bench', 9, (w, t) => {
        if (Math.abs(t - 4) < 0.02) w.anim.poke([-2.6, 1.6, 20], [0, 0, -1], t);
      }),
      L = w.lab;
    let far = 0;
    for (const nd of L.jel.nodes) far = Math.max(far, V.dist(nd.x, nd.q));
    ok(
      'bench: sand fell, the jelly moved and held together, the beetle walked',
      L.sand.count > 800 && far > 0.005 && far < 1.5 && L.gait.steps > 8,
      L.sand.count + ' grains, jelly ' + far.toFixed(2) + ' from rest, ' + L.gait.steps + ' steps'
    );
  }
  // ---- the two things a browser does that a tidy test does not: it opens a diorama long after the page's clock started, and it runs at any frame rate
  {
    const late = id => {
      const s = A.SCENES.find(q => q.id === id),
        w = s.build(s.seed);
      w.anim.update(0, 731.4);
      for (let t = 0; t < 1.5; t += 1 / 60) w.anim.update(1 / 60, 731.4 + t);
      return w;
    };
    ok('idol: opened late, it is not struck before its time', late('idol').lab.brk.strikes === 0);
    ok('watcher: opened late, it has not already hopped', late('watcher').lab.hops() === 0);
    ok('burn: opened late, the fire is only just lit', late('burn').lab.fire.active.size < 80);
    for (const fps of [24, 60, 144]) {
      const s = A.SCENES.find(q => q.id === 'bench'),
        w = s.build(s.seed);
      w.anim.update(0, 50);
      let far = 0,
        lateV = 0,
        bad = 0,
        back = 0;
      const prev = [0, 0, 0];
      for (let t = 0; t < 24; t += 1 / fps) {
        w.anim.update(1 / fps, 50 + t);
        for (const nd of w.lab.jel.nodes) {
          far = Math.max(far, V.dist(nd.x, nd.q));
          if (t > 16) lateV = Math.max(lateV, V.len(nd.v));
          if (!Number.isFinite(nd.x[0])) bad++;
        }
      }
      ok(
        'bench at ' + fps + ' frames a second: the jelly stays put and does not wind itself up',
        !bad && far < 1.2 && lateV < 7,
        'farthest ' + far.toFixed(2) + ', late speed ' + lateV.toFixed(1)
      );
    }
    // the beetle faces the way it is going
    {
      const s = A.SCENES.find(q => q.id === 'bench'),
        w = s.build(s.seed),
        st = w.anim,
        rig = st.rig;
      st.update(0, 0);
      for (let t = 0; t < 3; t += 1 / 60) st.update(1 / 60, t);
      const a = rig.at('bug', [5.1, 0.95, 0]),
        head = rig.at('bug', [5.1, 0.95, 0.85]);
      st.update(1 / 60, 3.02);
      const b = rig.at('bug', [5.1, 0.95, 0]);
      ok('bench: the beetle walks head first', V.dot(V.sub(head, a), V.sub(b, a)) > 0);
    }
  }
  // ---- meshes brought in
  {
    const Me = K.mesh,
      t = (1 + Math.sqrt(5)) / 2;
    let Vs = [
        [-1, t, 0],
        [1, t, 0],
        [-1, -t, 0],
        [1, -t, 0],
        [0, -1, t],
        [0, 1, t],
        [0, -1, -t],
        [0, 1, -t],
        [t, 0, -1],
        [t, 0, 1],
        [-t, 0, -1],
        [-t, 0, 1]
      ],
      Fs = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1]
      ];
    for (let q = 0; q < 3; q++) {
      const mid = new Map(),
        m = (a, b) => {
          const k = a < b ? a * 9999 + b : b * 9999 + a;
          if (!mid.has(k)) {
            mid.set(k, Vs.length);
            Vs.push([0, 1, 2].map(i => (Vs[a][i] + Vs[b][i]) / 2));
          }
          return mid.get(k);
        },
        G = [];
      for (const [a, b, c] of Fs) {
        const ab = m(a, b),
          bc = m(b, c),
          ca = m(c, a);
        G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      Fs = G;
    }
    Vs = Vs.map(v => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return v.map(x => (x / l) * 1.5);
    });
    const up = f => Vs[f[0]][1] + Vs[f[1]][1] + Vs[f[2]][1] > 0;
    const text =
      Vs.map(v => 'v ' + v.join(' ')).join('\n') +
      '\nusemtl red\n' +
      Fs.filter(up)
        .map(f => 'f ' + f.map(i => i + 1).join(' '))
        .join('\n') +
      '\nusemtl blue\n' +
      Fs.filter(f => !up(f))
        .map(f => 'f ' + f.map(i => i - Vs.length).join(' '))
        .join('\n') +
      '\n';
    const mesh = Me.obj(text, 'newmtl red\nKd 0.8 0.15 0.1\nnewmtl blue\nKd 0.1 0.2 0.8\n'),
      inf = Me.info(mesh);
    ok(
      'mesh: an OBJ is read, with its materials and its backward-counted corners',
      inf.tris === 1280 && inf.open === 0 && inf.mats.join() === 'default,red,blue'
    );
    const fld = Me.field(mesh, { cells: 40 });
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const p = [0, 1, 2].map(k => (K.hash(i * 3 + k) * 2 - 1) * 1.6),
        e = Math.abs(fld.sd(p[0], p[1], p[2]) - (Math.hypot(p[0], p[1], p[2]) - 1.5));
      if (e > worst) worst = e;
    }
    ok(
      'mesh: its field is the distance to it, signed',
      worst < fld.h * 0.6 && fld.sd(0, 0, 0) < -1.4 && fld.sd(5, 0, 0) > 3,
      'worst error ' + worst.toFixed(3) + ' on a cell of ' + fld.h.toFixed(3)
    );
    const back = Me.obj(Me.toObj(mesh));
    ok(
      'mesh: written out and read again it is the same',
      back.tri.length === mesh.tri.length && Math.abs(back.pos[30] - mesh.pos[30]) < 1e-4 && back.mats.length === 3
    );
    // the same ball as glTF: moved and doubled in size by its node, its buffer inside the file
    {
      const pos = new Float32Array(Vs.length * 3),
        idx = new Uint16Array(Fs.length * 3);
      Vs.forEach((v, i) => pos.set(v, i * 3));
      Fs.forEach((f, i) => idx.set(f, i * 3));
      const bytes = new Uint8Array(pos.byteLength + idx.byteLength);
      bytes.set(new Uint8Array(pos.buffer), 0);
      bytes.set(new Uint8Array(idx.buffer), pos.byteLength);
      let b64 = '';
      for (let i = 0; i < bytes.length; i += 3000)
        b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 3000)));
      const g = {
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, translation: [2, 0, 0], scale: [2, 2, 2] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        materials: [{ name: 'green', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.6, 0.1, 1] } }],
        buffers: [{ uri: 'data:application/octet-stream;base64,' + b64 }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
          { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: Vs.length, type: 'VEC3' },
          { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }
        ]
      };
      const m2 = Me.gltf(JSON.stringify(g)),
        i2 = Me.info(m2);
      ok(
        'mesh: glTF is read through its scene graph',
        i2.tris === 1280 && near(i2.lo[0], -1, 0.01) && near(i2.hi[0], 5, 0.01) && i2.mats[1] === 'green'
      );
      const js = new TextEncoder().encode(
          JSON.stringify(Object.assign({}, g, { buffers: [{ byteLength: bytes.length }] })) + '   '
        ),
        jl = js.length - (js.length % 4),
        glb = new Uint8Array(12 + 8 + jl + 8 + bytes.length),
        dv = new DataView(glb.buffer);
      dv.setUint32(0, 0x46546c67, true);
      dv.setUint32(4, 2, true);
      dv.setUint32(8, glb.length, true);
      dv.setUint32(12, jl, true);
      dv.setUint32(16, 0x4e4f534a, true);
      glb.set(js.subarray(0, jl), 20);
      dv.setUint32(20 + jl, bytes.length, true);
      dv.setUint32(24 + jl, 0x004e4942, true);
      glb.set(bytes, 28 + jl);
      ok('mesh: and in its binary wrapper', Me.info(Me.glb(glb)).tris === 1280);
    }
    const fit = Me.fit(mesh, { size: 4 }),
      fb = Me.box(fit);
    ok(
      'mesh: fitted to a size and stood on the ground',
      near(fb.hi[1] - fb.lo[1], 4, 0.01) && near(fb.lo[1], 0, 1e-4) && near(fb.lo[0], -2, 0.01)
    );
    const lk = Me.look(fit, { hues: 4, shades: 4 });
    ok(
      'mesh: its colours become ramps of a palette',
      lk.ramps.length === 2 && lk.pal.length === 9 && lk.ramps.every(r => r.length === 4)
    );
    const B = A.makeBuilder(1, lk.pal),
      S = K.sculpt(A.makeSculpt(B));
    S.mesh(fit, lk, { res: 0.1, cells: 40 });
    S.ball([0, 4, 0], 0.9, { r: [1] }, { neg: true });
    S.bake();
    const W = B.finish({});
    let off = 0,
      bitten = 0,
      redTop = 0,
      redLow = 0;
    const reds = new Set(lk.ramps[lk.hues[0][0] > lk.hues[1][0] ? 0 : 1].map(i => lk.pal[i]));
    for (let i = 0; i < W.count; i++) {
      const o = i * 16,
        x = W.data[o],
        y = W.data[o + 1],
        z = W.data[o + 2],
        inBite = Math.hypot(x, y - 4, z) < 0.95;
      if (Math.hypot(x, y - 4, z) < 0.8) bitten++;
      if (!inBite) off = Math.max(off, Math.abs(Math.hypot(x, y - 2, z) - 2));
      const c = W.data[o + 7],
        hx = ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
      if (reds.has(hx)) {
        if (y > 2.3) redTop++;
        else if (y < 1.7) redLow++;
      }
    }
    ok(
      'mesh: it bakes to splats on its own surface, coloured from its materials',
      W.count > 3000 && off < 0.06 && redTop > 500 && redLow === 0,
      W.count + ' splats, furthest ' + off.toFixed(3) + ', red above ' + redTop + ' below ' + redLow
    );
    ok('mesh: and is a solid: a bite carved out of it is gone', bitten === 0);
    const sheet = Me.make([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0], [0, 1, 2, 0, 2, 3]),
      sf = Me.field(sheet, { cells: 24 });
    ok(
      'mesh: an open sheet is given a thickness',
      sf.open && sf.thick > 0 && sf.sd(1, 1, 0) < 0 && sf.sd(1, 1, 0.5) > 0
    );
  }
  // ---- dioramas written as data
  {
    const Dio = K.diorama,
      spec = require('../lab/data-shrine.json'),
      copy = () => JSON.parse(JSON.stringify(spec));
    ok('data: the example is sound', Dio.check(spec).length === 0, Dio.report(Dio.check(spec)) || undefined);
    const b = copy();
    b.solids[0].mat = 'erth';
    b.solids[1].how = 'stares';
    b.solids.push({ kind: 'bal', at: [0, 0, 0], r: 1 }, { kind: 'box', at: [0, 1, 0], haf: [1, 1, 1] });
    b.motion[0].part = 'jem';
    b.stile = 'moss';
    const pr = Dio.check(b),
      has = (path, hint) => pr.some(q => q.path === path && q.hint.includes(hint));
    ok(
      'data: every mistake is listed at once, with what was probably meant',
      pr.length === 7 &&
        has('solids[0].mat', '"earth"') &&
        has('solids[1].how', '"stairs"') &&
        has('solids[12].kind', '"ball"') &&
        has('solids[13].haf', '"half"') &&
        has('motion[0].part', '"gem"') &&
        has('stile', '"style"'),
      pr.length + ' found'
    );
    let threw = null;
    try {
      Dio.build(b);
    } catch (e) {
      threw = e;
    }
    ok('data: a diorama with mistakes is not built', !!threw && threw.problems.length === 7);
    const big = copy();
    big.palette = Array.from({ length: 49 }, (q, i) => i * 1000);
    ok(
      'data: a palette too long for the page is refused',
      Dio.check(big).some(q => q.path === 'palette')
    );
    const W = Dio.build(spec),
      st = W.anim,
      rig = W.lab.rig;
    st.update(0, 0);
    const gem = rig.list[rig.part('gem')],
      lan = rig.list[rig.part('lantern')],
      J = spec.parts.lantern.joint,
      i0 = lan[lan.length - 1] * 16,
      d0 = Math.hypot(W.data[i0] - J[0], W.data[i0 + 1] - J[1], W.data[i0 + 2] - J[2]),
      g0 = [W.data[gem[0] * 16], W.data[gem[0] * 16 + 1]],
      x0 = W.data[i0 + 1];
    let swing = 0,
      bad = 0,
      drift = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      st.update(1 / 60, t);
      swing = Math.max(swing, Math.abs(W.data[i0 + 1] - x0) + Math.abs(W.data[i0 + 2] - st.base[i0 + 2]));
      drift = Math.max(
        drift,
        Math.abs(Math.hypot(W.data[i0] - J[0], W.data[i0 + 1] - J[1], W.data[i0 + 2] - J[2]) - d0)
      );
    }
    for (let i = 0; i < W.count * 16; i++) if (!Number.isFinite(W.data[i])) bad++;
    ok(
      'data: its parts move as written (the lantern swings about its joint, the gem turns)',
      gem.length > 200 &&
        lan.length > 100 &&
        swing > 0.2 &&
        drift < 0.01 &&
        Math.abs(W.data[gem[0] * 16] - g0[0]) + Math.abs(W.data[gem[0] * 16 + 1] - g0[1]) > 0.02 &&
        !bad,
      'swing ' + swing.toFixed(2) + ', joint drift ' + drift.toFixed(4)
    );
    ok(
      'data: lamps and loose particles are running',
      !!W.lab.lit && !!W.lab.ps && W.lab.ps.live > 0,
      W.lab.ps && W.lab.ps.live + ' particles'
    );
    const W2 = Dio.build(Object.assign(copy(), { style: 'moss' })),
      cols = w => {
        const c = new Set();
        for (let i = 0; i < w.count; i++) c.add(w.data[i * 16 + 7]);
        return c;
      },
      c1 = cols(Dio.build(spec)),
      c2 = cols(W2);
    let shared = 0;
    for (const c of c2) if (c1.has(c)) shared++;
    ok(
      'data: one word puts it in another style: same shape, other colours',
      W2.count === W.count && W2.pal.length === 8 && shared <= 1,
      W2.count + ' splats, ' + c2.size + ' colours, ' + shared + ' shared'
    );
  }
  // ---- matter: one solver, four kinds of stuff, and bodies with an inside
  {
    const drop = (kind, m, fps, secs, col) => {
      const B = A.makeBuilder(1, [0x07080b, 0x333333, 0x666666, 0x999999, 0xcccccc]),
        S = K.sculpt(A.makeSculpt(B)),
        rig = K.rig(B, S);
      S.ground({ r: [1, 2] }, { rad: 4, res: 0.4 });
      S.bake();
      const sol = col
        ? S.lathe([0, 0.02, 0], 1.8, 0.5, { r: [2, 3, 4] }, { res: 0.12, tag: 'b', whole: true })
        : S.ball([0, 1.7, 0], 0.7, { r: [2, 3, 4] }, { res: 0.12, tag: 'b', whole: true });
      S.bake();
      const ins = K.inside(B, sol.sd, { lo: [-0.8, 0, -0.8], hi: [0.8, 2.5, 0.8], cell: 0.15, ramp: [2, 3] }),
        W = B.finish({}),
        st = K.stage(W);
      rig.bind(st);
      const mp = st.add(K.mpm(st, { lo: [-3, 0, -3], hi: [3, 4, 3], cell: 0.25, floor: 0 })),
        ids = Array.from(rig.list[rig.part('b')]).concat(Array.from(ins.ids)),
        body = mp.add(ids, Object.assign({ kind }, m));
      let low = 9;
      for (let t = 0; t < secs; t += 1 / fps) {
        st.update(1 / fps, t);
        if (t > 0.3) {
          const q = mp.stats(body);
          low = Math.min(low, q.hi[1] - q.lo[1]);
        }
      }
      const q = mp.stats(body);
      return {
        h: q.hi[1] - q.lo[1],
        w: q.hi[0] - q.lo[0],
        low,
        bad: q.bad,
        n: q.n,
        awake: mp.awake,
        mp,
        body,
        ins,
        W,
        st,
        bottom: q.lo[1]
      };
    };
    const j60 = drop('jelly', {}, 60, 5),
      j24 = drop('jelly', {}, 24, 5);
    ok(
      'matter: jelly squashes when it lands and comes back to its shape',
      !j60.bad && j60.low < 1.2 && j60.h > 1.15 && j60.h < 1.45 && j60.bottom > -0.05,
      'squashed to ' + j60.low.toFixed(2) + ', rests at ' + j60.h.toFixed(2) + ' of 1.40'
    );
    ok(
      'matter: the same at 24 frames a second as at 60',
      Math.abs(j60.h - j24.h) < 0.06 && Math.abs(j60.w - j24.w) < 0.08,
      j24.h.toFixed(2) + ' against ' + j60.h.toFixed(2)
    );
    const c = drop('clay', {}, 60, 4);
    ok(
      'matter: clay gives, stays where it was put, and comes to rest',
      !c.bad && c.h < 0.95 && c.w > 1.7 && !c.awake,
      'height ' + c.h.toFixed(2) + ', width ' + c.w.toFixed(2)
    );
    const sd = drop('sand', {}, 60, 5, true),
      slope = (Math.atan2(sd.h, sd.w / 2) * 180) / Math.PI;
    ok(
      'matter: a tower of sand slumps to a heap with a slope, and rests',
      !sd.bad && sd.h < 1.0 && sd.h > 0.3 && slope > 12 && slope < 40 && !sd.awake,
      'height ' + sd.h.toFixed(2) + ', slope ' + slope.toFixed(0) + ' degrees'
    );
    const w = drop('water', {}, 60, 4);
    ok(
      'matter: water keeps no shape: it lies down flat',
      !w.bad && w.h < 0.4 && w.w > 2.5,
      'depth ' + w.h.toFixed(2) + ', width ' + w.w.toFixed(2)
    );
    ok(
      'inside: a body is filled, deeper splats knowing how deep they are',
      j60.ins.count > 150 && Math.max(...j60.ins.depth) > 0.4 && Math.min(...j60.ins.depth) >= 0.08,
      j60.ins.count + ' inside'
    );
    const before = c.mp.stats(c.body).n,
      took = c.mp.scoop([0, c.h, 0], 0.45, c.body);
    let gone = 0;
    for (const i of c.ins.ids) if (c.W.data[i * 16 + 3] === 0) gone++;
    ok(
      'matter: a scoop takes a bite out for good',
      took > 20 && c.mp.stats(c.body).n === before - took && gone > 0 && c.mp.awake,
      took + ' taken'
    );
    const hid = (() => {
      const B = A.makeBuilder(1, [0x07080b, 0x333333, 0x666666]),
        S = K.sculpt(A.makeSculpt(B));
      const b = S.ball([0, 1, 0], 1, { r: [1, 2] }, { res: 0.15 });
      S.bake();
      const ins = K.inside(B, b.sd, { lo: [-1, 0, -1], hi: [1, 2, 1], cell: 0.2, hidden: true }),
        W = B.finish({}),
        st = K.stage(W);
      let seen0 = 0;
      for (const i of ins.ids) if (W.data[i * 16 + 3] > 0) seen0++;
      const n = ins.showNear(st, [1, 1, 0], 0.6);
      let seen1 = 0;
      for (const i of ins.ids) if (W.data[i * 16 + 3] > 0) seen1++;
      return { seen0, n, seen1, all: ins.count };
    })();
    ok(
      'inside: kept unseen until a cut is made, then shown only there',
      hid.seen0 === 0 && hid.n > 3 && hid.seen1 === hid.n && hid.n < hid.all / 2,
      hid.n + ' of ' + hid.all + ' shown'
    );
    {
      const s = A.SCENES.find(q => q.id === 'stuff'),
        W = s.build(s.seed),
        st = W.anim;
      st.update(0, 100);
      for (let t = 0; t < 9; t += 1 / 60) st.update(1 / 60, 100 + t);
      const L = W.lab,
        q = n2 => L.mp.stats(L.bodies[n2]);
      let bad = 0;
      for (let i = 0; i < W.count * 16; i++) if (!Number.isFinite(W.data[i])) bad++;
      const wq = q('water'),
        inBasin = wq.c[0] > 4.4 && wq.c[0] < 5.6 && wq.c[1] < 1.0;
      let mid = 0;
      for (const i of st.rig.list[st.rig.part('cake')])
        if (Math.hypot(W.data[i * 16] + 1.8, W.data[i * 16 + 2]) < 0.3) mid = Math.max(mid, W.data[i * 16 + 1]);
      ok(
        'soft things: opened late, everything lands, the cake is pressed and the water is in the basin',
        !bad && q('jelly').lo[1] < 0.4 && mid < 0.85 && mid > 0.3 && q('sand').hi[1] < 1.2 && inBasin,
        'middle of the cake ' + mid.toFixed(2) + ' of 1.08, water at ' + wq.c.map(v => v.toFixed(1)).join(' ')
      );
    }
  }
  // ---- bones on the graphics card
  {
    const B = A.makeBuilder(1, [0x07080b, 0x333333, 0x999999]);
    for (let i = 0; i < 40; i++)
      B.iso(i * 0.1, 1, 0, 0.1, B.P[1 + (i % 2)], 3, i === 7 ? { k: 6, ph: 0, sp: 1, rg: 0.1 } : undefined);
    const W = B.finish({}),
      ids = Array.from({ length: 40 }, (q, i) => i),
      bid = ids.map(i => 1 + (i >= 20)),
      bid2 = ids.map(() => 2),
      w2 = ids.map(i => (i >= 15 && i < 20 ? 0.5 : 0));
    const tg = K.bones.tag(W, ids, bid, bid2, w2),
      bones = new Float32Array(36),
      R = M.rot([0, 0, 1], Math.PI / 2);
    bones.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 0);
    bones.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0], 12);
    bones.set([...R, 5, 0, 0], 24);
    W.anim = { bones, boned: tg.boned };
    const P = K.bones.posed(W),
      at = i => [P[i * 16], P[i * 16 + 1], P[i * 16 + 2]];
    ok(
      'bones: plain splats are tagged, one with a motion of its own is left to the caller',
      tg.boned.length === 39 && tg.cpu.length === 1 && tg.cpu[0] === 7 && Math.round(W.data[11]) % 16 === 12
    );
    ok(
      'bones: a carried splat is put where its bone has it, and the data itself stays at rest',
      near(at(3)[1], 3) &&
        near(at(30)[0], 4) &&
        near(at(30)[1], 3) &&
        near(W.data[30 * 16], 3) &&
        Math.round(P[30 * 16 + 11]) % 16 === 0,
      at(30)
        .map(v => v.toFixed(2))
        .join(' ')
    );
    ok(
      'bones: one shared between two bones lies between them',
      near(at(17)[0], (1.7 + 4) / 2) && near(at(17)[1], (3 + 1.7) / 2),
      at(17)
        .map(v => v.toFixed(2))
        .join(' ')
    );
  }
  // ---- a lamp that stays put: its shadow, its own colours, its flicker
  {
    const B = A.makeBuilder(
        3,
        [0x0a0a0a, 0x202020, 0x404040, 0x707070, 0xa0a0a0, 0xd0d0d0, 0x803010, 0xd06020, 0xffb040]
      ),
      S = A.makeSculpt(B),
      cap = K.light.capture(B, S);
    S.res = 0.12;
    S.sunK = 0;
    S.amb = 0.1;
    S.sky = 0.05;
    S.box([0, -0.2, 0], [4, 0.2, 4], { r: [1, 2, 3, 4, 5] });
    S.box([0, 0.8, 0], [0.3, 0.8, 0.3], { r: [1, 2, 3, 4, 5] });
    S.bake();
    const W = B.finish({ cam: { yaw: 0, pitch: 0.5, dist: 12, target: [0, 0, 0], sway: 0 } }),
      st = K.stage(W),
      lamp = { p: [-2, 2, 0], r: 6, s: 2.5, ramp: [6, 7, 8] },
      sys = st.add(K.light.system(st, cap, [lamp]));
    st.update(1 / 60, 0);
    const colAt = i => W.data[i * 16 + 7],
      pk = k => {
        const h = W.pal[k];
        return ((h >> 16) & 255) + ((h >> 8) & 255) * 256 + (h & 255) * 65536;
      },
      warm = new Set([pk(6), pk(7), pk(8)]);
    // floor splats behind the pillar (as the lamp sees it), and beside it at the same distance
    const behind = [],
      beside = [];
    for (let i = 0; i < W.count; i++) {
      const x = W.data[i * 16],
        y = W.data[i * 16 + 1],
        z = W.data[i * 16 + 2];
      if (y > 0.05 || !cap.ramp[i]) continue;
      if (x > 0.8 && x < 1.8 && Math.abs(z) < 0.12) behind.push(i);
      if (x > 0.8 && x < 1.8 && Math.abs(Math.abs(z) - 1.2) < 0.12) beside.push(i);
    }
    const share = list => list.filter(i => warm.has(colAt(i))).length / Math.max(1, list.length),
      before = share(behind);
    const blocked = K.light.shadow(st, cap, lamp, S.sdf);
    sys.touch();
    st.update(1 / 60, 0.1);
    ok(
      'lamp: a lamp with colours of its own paints what it lights from them, and once its shadow is worked out the floor behind a pillar goes back to its own colours while the floor beside it stays lit',
      before > 0.3 && share(behind) < 0.1 && share(beside) > 0.3 && blocked > 10,
      'behind the pillar ' +
        before.toFixed(2) +
        ' then ' +
        share(behind).toFixed(2) +
        ', beside it ' +
        share(beside).toFixed(2)
    );
    lamp.off = true;
    sys.touch();
    st.update(1 / 60, 0.2);
    const offShare = share(beside);
    lamp.off = false;
    const fl = st.add(K.light.flicker(sys, lamp, { rate: 9, depth: 0.5 }));
    let lo = 9,
      hi = 0;
    for (let k = 0; k < 120; k++) {
      st.update(1 / 60, 0.3 + k / 60);
      lo = Math.min(lo, lamp.s);
      hi = Math.max(hi, lamp.s);
    }
    ok(
      'lamp: switched off it lights nothing; guttering, its strength wanders and never goes over what it was given',
      offShare === 0 && hi <= 2.5 + 1e-9 && lo < 1.7 && fl,
      'strength ' + lo.toFixed(2) + ' to ' + hi.toFixed(2)
    );
  }
  // ---- growers, ramps that turn, and the named effects
  {
    const B = A.makeBuilder(4, [0, 0x101826, 0x283848, 0x566858, 0x9a9c78, 0xd8cc98, 0x183c28, 0x48883c, 0xa8d060]),
      S = A.makeSculpt(B),
      G = K.grow;
    S.sun = B.norm([-0.6, 0.6, 0.4]);
    S.box([0, -0.5, 0], [6, 0.5, 6], { r: [1, 2, 3] });
    S.box([0, 1.5, 0], [0.4, 1.5, 2.5], { r: [1, 2, 3] }); // a wall: one side of it is in its shadow
    S.ready();
    const dark = G.scatter(S, { disc: [0, 0, 5], n: 30, gap: 0.3, shade: [0, 0.3], seed: 3 }),
      lit = G.scatter(S, { disc: [0, 0, 5], n: 30, gap: 0.3, shade: [0.8, 1], seed: 3 }),
      again = G.scatter(S, { disc: [0, 0, 5], n: 30, gap: 0.3, shade: [0.8, 1], seed: 3 });
    ok(
      'grow: places asked for in the shade are all on the side of the wall away from the sun, those asked for in the sun are not, and the same seed gives the same places',
      dark.length > 5 &&
        dark.every(q => q.p[0] > 0.3) &&
        lit.length > 10 &&
        lit.filter(q => q.p[0] > 0.5 && q.p[0] < 2 && Math.abs(q.p[2]) < 2).length === 0 &&
        JSON.stringify(lit) === JSON.stringify(again),
      dark.length + ' in shade, ' + lit.length + ' in sun'
    );
    const free = G.branch({ at: [-3, 0, 0], dir: [1, 0.35, 0], len: 2.4, depth: 2, seed: 5, lean: 0, wobble: 0 }),
      round = G.branch({
        at: [-3, 0, 0],
        dir: [1, 0.35, 0],
        len: 2.4,
        depth: 2,
        seed: 5,
        lean: 0,
        wobble: 0,
        sdf: S.sdf,
        margin: 0.5
      }),
      inside = g => g.limbs.reduce((n, L) => n + L.pts.filter(q => S.sdf(q[0], q[1], q[2]) < 0).length, 0);
    ok(
      'grow: a branch aimed at the wall goes through it when it does not know of it, and stays out of it when it does; it forks the number of times asked',
      inside(free) > 0 && inside(round) === 0 && round.tips.length >= 4,
      inside(free) + ' points inside without, ' + inside(round) + ' with; ' + round.tips.length + ' tips'
    );
    const ro = G.arrange('rosette', 0, { rings: 3, per: 6 }),
      sp = G.arrange('spiral', 30, { r: 1, dome: 0.8 });
    ok(
      'grow: in a rosette the inner petals stand more upright than the outer ones; a spiral fills its dome without two parts in one place',
      ro.length === 18 &&
        ro[0].dir[1] > ro[17].dir[1] + 0.2 &&
        sp.every((a, i) =>
          sp.every((b, j) => i === j || Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) > 0.12)
        ),
      'inner ' + ro[0].dir[1].toFixed(2) + ', outer ' + ro[17].dir[1].toFixed(2)
    );
    const kind = G.species({ seed: 2, vary: { h: [1, 2] }, make: (S2, at, v) => v.h }),
      h1 = kind.grow(null, [1, 0, 1]),
      h2 = kind.grow(null, [2, 0, 1]);
    ok(
      'grow: two of a kind differ, and the one that stands in a place is the same one each time',
      h1 !== h2 && h1 === kind.grow(null, [1, 0, 1]) && h1 >= 1 && h1 <= 2
    );
    const n0 = B.count();
    G.rock(S, [3.5, 1, 3], 1, { r: [1, 2, 3, 4, 5] }, { beds: { n: 5 }, seed: 9 });
    S.bake();
    let far = 0,
      cnt = 0;
    const W = B.finish({ cam: { yaw: 0, pitch: 0.4, dist: 14, target: [0, 1, 0], sway: 0 } });
    for (let i = 0; i < W.count; i++) {
      const q = i * 16,
        dd = Math.hypot(W.data[q] - 3.5, W.data[q + 1] - 1, W.data[q + 2] - 3);
      if (dd < 1.3 && W.data[q + 1] > 0.1) {
        cnt++;
        if (dd < 0.84) far++;
      }
    }
    ok(
      'grow: a rock is a lump with flat faces cut into it (some of its surface lies well inside the ball it was cut from) and no holes',
      cnt > 1500 && far > 20,
      cnt + ' dabs, ' + far + ' on deep cuts'
    );
    const pal = [0, 0x1a2438, 0x2c4a4a, 0x4c7a4c, 0x9cb85c, 0xf0e08c, 0x202020, 0x505050, 0x909090, 0xd0d0d0],
      turn = K.ramp.make(pal, { hue: 110, n: 5 }),
      grey = K.ramp.check(pal, [6, 7, 8, 9]),
      one = K.ramp.check([0, 0x103010, 0x206020, 0x309030, 0x40c040], [1, 2, 3, 4]);
    ok(
      'ramp: from a palette that has them, a ramp is picked that runs dark to light and turns from cool to warm; a ramp of one hue is called that, and greys are called greys',
      turn.ramp.length === 5 &&
        turn.ramp[0] === 1 &&
        turn.ramp[4] === 5 &&
        /cool shadows to warm lights/.test(turn.says) &&
        grey.says === 'greys' &&
        /^one hue/.test(one.says),
      turn.says
    );
    const dv = K.dissolve.at(7, 0.3, 1, 0, [0, 0, 0, 0]),
      dv0 = K.dissolve.at(7, 0, 1, 0, [0, 0, 0, 0]);
    ok(
      'named effects: a body coming apart has not moved at the start, has moved and shrunk a third of a second in; the window light, reflection and shatter are there by name',
      dv0[0] === 0 &&
        dv0[3] === 1 &&
        Math.hypot(dv[0], dv[2]) > 0.1 &&
        dv[3] < 1 &&
        typeof K.windowLight === 'function' &&
        typeof K.reflect === 'function' &&
        typeof K.shatter === 'function'
    );
  }
  // ---- attributes, sweeps, cover, instances, growth in steps, patterns, cloth and hair
  {
    const pal = [0, 0x202020, 0x404040, 0x606060, 0x808080, 0xa0a0a0, 0xc0c0c0, 0xe0e0e0, 0x804020, 0x30a040],
      mk = () => {
        const B = A.makeBuilder(5, pal),
          S = K.sculpt(A.makeSculpt(B));
        S.sun = B.norm([-0.5, 0.7, 0.5]);
        S.res = 0.06;
        return { B, S };
      },
      bright = (W, i) => W.data[i * 16 + 7] % 256;
    {
      const { B, S } = mk();
      S.box([0, 0.5, 0], [0.5, 0.5, 0.5], { r: [1, 2, 3, 4, 5], wear: { from: 3, to: 8, t: 0.5 } });
      S.bake();
      const W = B.finish({});
      let e = 0,
        en = 0,
        f = 0,
        fn = 0;
      for (let i = 0; i < W.count; i++) {
        const x = W.data[i * 16],
          y = W.data[i * 16 + 1] - 0.5,
          z = W.data[i * 16 + 2],
          edge = [x, y, z].filter(v => Math.abs(v) > 0.45).length >= 2;
        if (edge) ((e += bright(W, i)), en++);
        else ((f += bright(W, i)), fn++);
      }
      ok(
        'attributes: a box worn by curvature is lighter along its edges than on its faces',
        e / en > f / fn + 8,
        (e / en).toFixed(0) + ' against ' + (f / fn).toFixed(0)
      );
    }
    {
      const { B, S } = mk();
      const leaf = K.sweep(
        S,
        K.curve.line([0, 0, 0], [1, 0, 0], 4),
        { w: K.sweep.leaf(0.2), h: 0.01 },
        { r: [8] },
        { up: [0, 1, 0] }
      );
      S.bake();
      const W = B.finish({});
      let wmid = 0,
        wtip = 0;
      for (let i = 0; i < W.count; i++) {
        const x = W.data[i * 16],
          z = Math.abs(W.data[i * 16 + 2]);
        if (Math.abs(x - 0.45) < 0.05) wmid = Math.max(wmid, z);
        if (Math.abs(x - 0.95) < 0.04) wtip = Math.max(wtip, z);
      }
      ok(
        'sweep: a leaf swept along a line is wide in the middle and narrow at the tip, thin across, and knows how far along it a point is',
        wmid > 0.12 &&
          wtip < wmid * 0.6 &&
          Math.abs(leaf.sd(0.5, 0.2, 0) - 0.19) < 0.03 &&
          Math.abs(leaf.along(0.25, 0, 0) - 0.25) < 0.02,
        'half-width ' + wmid.toFixed(2) + ' in the middle, ' + wtip.toFixed(2) + ' at the tip'
      );
    }
    {
      const { B, S } = mk();
      S.box([0, 0.5, 0], [0.5, 0.5, 0.5], { r: [1, 2, 3] });
      S.bake();
      const n0 = B.count(),
        laid = S.cover({ r: [7] }, { up: 0.6, thick: 0.05 }),
        W = B.finish({});
      let top = 0,
        side = 0;
      for (let i = n0; i < W.count; i++) W.data[i * 16 + 1] > 1.02 ? top++ : side++;
      ok(
        'cover: a coat is laid on the top of a box and not down its sides',
        laid > 100 && top > laid * 0.9,
        top + ' on top, ' + side + ' elsewhere'
      );
    }
    {
      const { B, S } = mk();
      S.box([0, -0.1, 0], [3, 0.1, 3], { r: [1, 2] });
      const tpl = S.template(S2 =>
        S2.tube(
          [
            [0, 0, 0],
            [0, 0.6, 0]
          ],
          0.06,
          0.04,
          { r: [8] }
        )
      );
      S.place(tpl, [1, 0, 0], { yaw: 0.5, scale: 1 });
      S.place(tpl, [-1, 0, 0.5], { scale: 1.5, sway: { amp: 0.05 } });
      S.bake();
      const W = B.finish({});
      let a = 0,
        b = 0,
        hb = 0,
        sw = 0;
      for (let i = 0; i < W.count; i++) {
        const x = W.data[i * 16],
          y = W.data[i * 16 + 1],
          z = W.data[i * 16 + 2];
        if (y < 0.02) continue;
        if (Math.hypot(x - 1, z) < 0.12) a++;
        if (Math.hypot(x + 1, z - 0.5) < 0.15)
          (b++, (hb = Math.max(hb, y)), Math.round(W.data[i * 16 + 11]) % 16 === 14 && sw++);
      }
      ok(
        'instances: one template placed twice: both copies are there, the second half again as tall, and it sways from its foot',
        a > 30 && b > a && hb > 0.85 && sw === b,
        a + ' and ' + b + ' dabs, the second ' + hb.toFixed(2) + ' tall'
      );
    }
    {
      const { B, S } = mk();
      S.box([0, -0.1, 0], [3, 0.1, 3], { r: [1, 2] });
      S.box([0, 0.4, 0], [0.5, 0.4, 0.5], { r: [1, 2] });
      const rk = K.grow.rock(S, [0.1, 4, 0], 0.4, { r: [3, 4] }, { settle: true, seed: 3, sink: 0 });
      S.ready();
      const top = S.heightAt(0.1, 0, 3, 3),
        vine = K.grow.creep(S, { from: [0.6, 0.1, 0], dir: [0, 1, 0], steps: 30, step: 0.05, seed: 4 }),
        pts = vine.paths[0] || [],
        hug = pts.length ? Math.max(...pts.map(q => Math.abs(S.sdf(q[0], q[1], q[2]) - 0.04))) : 9,
        lich = K.grow.spread(S, { from: [[0.4, 0.81, -0.4]], steps: 12, gap: 0.06, ok: (x, y, z, n) => n[1] > 0.5 });
      ok(
        'growth in steps: a rock dropped on a block comes to rest on it; a creeper climbs the block keeping to its face; lichen spreads over its top and not down its sides',
        rk.bc[1] - 0.4 * 1 < 0.95 &&
          top > 1.0 &&
          pts.length > 10 &&
          pts[pts.length - 1][1] > 0.5 &&
          hug < 0.03 &&
          lich.pts.length > 20 &&
          lich.pts.every(q => q[1] > 0.75),
        'rock rests at ' +
          rk.bc[1].toFixed(2) +
          ', creeper ' +
          pts.length +
          ' steps up to ' +
          (pts.length ? pts[pts.length - 1][1].toFixed(2) : '-') +
          ', lichen ' +
          lich.pts.length +
          ' points'
      );
    }
    {
      const v = K.tex.voronoi(2, { out: 'edge' }),
        id = K.tex.voronoi(2, { out: 'id' }),
        br = K.tex.brick(0.4, 0.2),
        lo = [0, 0, 0].map(() => 0);
      let edges = 0;
      for (let i = 0; i < 400; i++) if (v(i * 0.013, 0.3, 0.2) < 0.05) edges++;
      ok(
        'patterns: voronoi edges are thin lines, cells each have their own number, bricks have mortar',
        edges > 5 &&
          edges < 120 &&
          id(0.1, 0.1, 0.1) !== id(2.1, 0.1, 0.1) &&
          br(0.01, 0.1, 0) === 0 &&
          br(0.2, 0.1, 0) > 0.4,
        edges + ' of 400 on an edge'
      );
    }
    {
      const B = A.makeBuilder(6, pal),
        wind = K.xpbd.gust([6, 0, 0], { gust: 0.3 }),
        flag = K.cloth(B, {
          at: [0, 2, 0],
          u: [1.5, 0, 0],
          v: [0, -1, 0],
          nu: 14,
          nv: 10,
          wind,
          pattern: () => [3, 4, 5]
        }),
        still = K.cloth(B, { at: [3, 2, 0], u: [1.5, 0, 0], v: [0, -1, 0], nu: 14, nv: 10, pattern: () => [3, 4, 5] }),
        roots = [];
      for (let i = 0; i < 20; i++) roots.push({ p: [6 + (i % 5) * 0.05, 1, Math.floor(i / 5) * 0.05], n: [0, 1, 0] });
      const hair = K.hair(B, { roots, len: 0.5, segs: 5, ramp: [6, 7], droop: 0 }),
        W = B.finish({}),
        st = K.stage(W);
      st.add(flag);
      st.add(still);
      st.add(hair);
      for (let f = 0, t = 0; f < 240; f++, t += 1 / 60) st.update(1 / 60, t);
      const X = flag.sim.X,
        Y = still.sim.X;
      let far = 0,
        hang = 9;
      for (let i = 0; i < flag.sim.n; i++) far = Math.max(far, X[i * 3]);
      for (let i = 0; i < still.sim.n; i++) hang = Math.min(hang, Y[i * 3 + 1]);
      const tips = hair.strands.map(s => hair.sim.X[s.idx[s.idx.length - 1] * 3 + 1]),
        tipY = tips.reduce((a, b) => a + b, 0) / tips.length;
      ok(
        'cloth and hair: a flag in a wind streams out from its pole; the same cloth without wind hangs down; hair grown straight up keeps its shape against gravity, sagging a little',
        far > 1.2 && hang < 1.2 && tipY > 1.25 && tipY < 1.5,
        'flag reaches x ' +
          far.toFixed(2) +
          ', still cloth down to y ' +
          hang.toFixed(2) +
          ', hair tips at ' +
          tipY.toFixed(2)
      );
    }
  }
  // ---- light through things, and things that are not surfaces
  {
    const PALV = [0x07080b, 0x222222, 0x555555, 0x888888, 0xbbbbbb, 0xff9a6a, 0x4a2c1c, 0x7a4a26, 0xb0763a, 0xdcae6a],
      mk = () => {
        const B = A.makeBuilder(1, PALV),
          S = K.sculpt(A.makeSculpt(B));
        S.sun = B.norm([0, 0.3, 1]);
        return { B, S };
      },
      idx = (W, i) => {
        const c = W.data[i * 16 + 7],
          hx = ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
        return W.pal.indexOf(hx);
      };
    {
      const { B, S } = mk();
      S.box([-2, 1, 0], [0.8, 0.8, 0.06], K.look.wax([1, 2, 3, 4], { depth: 0.5, k: 0.9, glow: [5] }), { res: 0.1 });
      S.box([2, 1, 0], [0.8, 0.8, 0.8], K.look.wax([1, 2, 3, 4], { depth: 0.5, k: 0.9, glow: [5] }), { res: 0.1 });
      S.bake();
      const W = B.finish({});
      let thin = 0,
        thick = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16;
        if (idx(W, i) !== 5) continue;
        if (W.data[o] < 0 && W.data[o + 2] < -0.03) thin++;
        else if (W.data[o] > 0 && W.data[o + 2] < -0.7 && Math.abs(W.data[o + 1] - 1) < 0.4) thick++;
      }
      ok(
        'volume: light comes through a thin slab and not through the middle of a thick block',
        thin > 40 && thick === 0,
        thin + ' glowing on the back of the slab, ' + thick + ' on the block'
      );
    }
    {
      const { B, S } = mk();
      S.ball([0, 1, 0], 1, K.look.glass([2, 3, 4], { a: 0.1 }), { ghost: true, res: 0.12 });
      S.ball([3, 1, 0], 0.6, K.look.jelly([2, 3, 4], { a: 0.3 }), { res: 0.12 });
      S.bake();
      const W = B.finish({});
      let gl = 0,
        soft = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16;
        if (Math.round(W.data[o + 11]) >= 256) {
          gl++;
          if (Math.abs(W.data[o + 3] - 0.1) > 1e-6) gl = -1e9;
        } else if (Math.abs(W.data[o + 3] - 0.3) < 1e-6) soft++;
      }
      ok(
        'volume: glass and jelly are see-through, and glass is marked to bend what is behind it',
        gl > 200 && soft > 100,
        gl + ' glass, ' + soft + ' jelly'
      );
    }
    {
      const { B, S } = mk();
      S.ball([0, 1, 0], 1, K.look.fur([6, 7, 8, 9], { len: 0.3, still: true }), { res: 0.14 });
      S.bake();
      const W = B.finish({});
      let far = 0,
        tipLight = 0,
        tips = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16,
          r = Math.hypot(W.data[o], W.data[o + 1] - 1, W.data[o + 2]);
        far = Math.max(far, r);
        if (r > 1.16) {
          tips++;
          if (idx(W, i) >= 8) tipLight++;
        }
      }
      ok(
        'volume: fur stands off the skin and is lighter at the tip',
        far > 1.15 && tips > 100 && tipLight > tips * 0.4,
        'reaches ' + (far - 1).toFixed(2) + ' out, ' + tipLight + ' of ' + tips + ' tips light'
      );
    }
    {
      const B = A.makeBuilder(1, PALV);
      B.iso(0, 0, 0, 0.1, B.P[1], 3);
      const pool = K.pool(B, 120),
        W = B.finish({}),
        st = K.stage(W),
        sm = st.add(
          K.smoke(st, pool, { at: [0, 0, 0], ramp: [4, 3, 2, 1], sun: [0, 1, 0], rate: 30, life: 3, rise: 1.2 })
        );
      st.update(0, 0);
      for (let t = 0; t < 2.5; t += 1 / 60) st.update(1 / 60, t);
      let top = 0,
        tn = 0,
        low = 0,
        ln = 0,
        bad = 0;
      const ys = sm.puffs.map(q => q.p[1]).sort((a, b) => a - b),
        mid = ys[ys.length >> 1];
      for (const q of sm.puffs) {
        const c = idx(W, q.i);
        if (!Number.isFinite(q.p[0])) bad++;
        if (q.p[1] > mid) {
          top += c;
          tn++;
        } else {
          low += c;
          ln++;
        }
      }
      ok(
        'volume: smoke shades itself: with the light above, the top of the plume is brighter than the foot',
        !bad && sm.puffs.length > 40 && sm.puffs.length <= 120 && top / tn > low / ln + 0.3,
        sm.puffs.length + ' puffs, top ' + (top / tn).toFixed(2) + ' against ' + (low / ln).toFixed(2)
      );
    }
    {
      const R = require('./render.js'),
        s = A.SCENES.find(q => q.id === 'cabinet'),
        W = s.build(s.seed);
      W.anim.update(0, 0);
      for (let t = 0; t < 2; t += 1 / 30) W.anim.update(1 / 30, t);
      const shot = () => R.render(W, { t: 2, w: 420, h: 260 }).rgb,
        a = shot(),
        diff = b => {
          let d = 0;
          for (let i = 0; i < a.length; i += 3)
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) d++;
          return d;
        };
      const r0 = W.refract;
      W.refract = 0;
      const noBend = diff(shot());
      W.refract = r0;
      const ao0 = W.ao;
      W.ao = null;
      const noAo = diff(shot());
      W.ao = ao0;
      const f0 = W.fog;
      W.fog = { c: 0, start: 1, max: 0 };
      const noFog = diff(shot());
      W.fog = f0;
      ok(
        'night cabinet: glass bends the picture, contact shade and distance haze are in it',
        noBend > 5 && noAo > 100 && noFog > 100,
        noBend + ' pixels moved by the glass, ' + noAo + ' shaded, ' + noFog + ' hazed'
      );
    }
    {
      const B = A.makeBuilder(1, PALV),
        m = K.mist(B, { n: 50, rad: 4, cols: [1, 2] }),
        sh = K.shafts(B, { from: [0, 5, 0], len: 4, n: 8, col: 4 });
      ok(
        'volume: mist and shafts are soft splats that drift in the shader',
        m.count === 50 && sh.count === 8 && B.finish({}).data[3] < 1
      );
    }
  }
  // ---- the creature rig, standing by itself in the library
  {
    const B = A.makeBuilder(1, [0x07080b, 0x444444, 0x999999]),
      S = K.sculpt(A.makeSculpt(B)),
      R = K.creature(B, S);
    S.ground({ r: [1, 2] }, { rad: 3, res: 0.3 });
    S.ball([0, 1, 0], 0.8, { r: [1, 2] }, { tag: 'body', res: 0.12 });
    S.bake();
    const W = B.finish({}),
      rest = W.data.slice();
    R.bind(W, t => {
      R.set('body', R.rot(R.AY, t), [0, 1, 0], [0, 1 + 0.5 * t, 0]);
    });
    W.anim.update(1 / 60, 1);
    const P = K.bones.posed(W);
    let top = 0,
      moved = 0;
    for (const i of W.anim.boned) top = Math.max(top, P[i * 16 + 1]);
    for (let i = 0; i < rest.length; i += 16) if (rest[i + 1] !== W.data[i + 1]) moved++;
    ok(
      'creature: a tagged solid rides its bone on the graphics card, the data stays at rest, and a tap on it does nothing',
      W.anim.boned.length > 500 &&
        near(top, 2.3, 0.02) &&
        moved === 0 &&
        W.anim.bones.length === 24 &&
        W.anim.poke === undefined,
      W.anim.boned.length + ' splats on ' + W.anim.bones.length / 12 + ' bones'
    );
  }
  // ---- what the game runs on
  {
    const B = A.makeBuilder(
        1,
        Array.from({ length: 48 }, (q, i) => i * 0x050403)
      ),
      n0 = B.count(),
      fx = K.play.fx(B, 60),
      n1 = B.count(),
      db = K.play.debris(B, 80),
      eco = K.play.eco();
    ok(
      "play: the game's particles, debris and ground memory stand by themselves in the library",
      n1 - n0 === 60 &&
        B.count() - n1 === 80 &&
        ['sparks', 'ring', 'drops', 'flake', 'update'].every(k => typeof fx[k] === 'function') &&
        ['burst', 'drop', 'update'].every(k => typeof db[k] === 'function') &&
        ['ignite', 'freeze', 'reset'].every(k => typeof eco[k] === 'function')
    );
  }
  // ---- the second go at light-through and fur
  {
    const PALV = [
        0x07080b, 0x222222, 0x555555, 0x888888, 0xbbbbbb, 0xff9a6a, 0x4a2c1c, 0x7a4a26, 0xb0763a, 0xdcae6a, 0xffffff,
        0xffe2a8
      ],
      idx = (W, i) => {
        const c = W.data[i * 16 + 7],
          hx = ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
        return W.pal.indexOf(hx);
      };
    {
      const B = A.makeBuilder(1, PALV),
        S = K.sculpt(A.makeSculpt(B));
      S.sun = B.norm([0, 0.2, -1]);
      S.view = [0, 0, 1];
      S.ball(
        [0, 1, 0],
        1,
        K.look.jelly([1, 2, 3], {
          depth: 1.2,
          k: 0.6,
          glow: [3, 4, 5],
          core: { p: [0, 1, 0], r: 0.35, k: 0.9 },
          gloss: { c: 10, at: 0.985 }
        }),
        { res: 0.09 }
      );
      S.bake();
      const W = B.finish({});
      let mid = 0,
        mn = 0,
        ring = 0,
        rn = 0,
        edge = 0,
        en = 0,
        spec = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16,
          x = W.data[o],
          y = W.data[o + 1] - 1,
          z = W.data[o + 2];
        if (z < 0.2) continue;
        const r = Math.hypot(x, y),
          c = idx(W, i);
        if (c === 10) {
          spec++;
          continue;
        }
        if (r < 0.2) {
          mid += c;
          mn++;
        } else if (r > 0.5 && r < 0.7) {
          ring += c;
          rn++;
        } else if (r > 0.93) {
          edge += c;
          en++;
        }
      }
      ok(
        'volume: a light inside a body shows through the skin in front of it, and the backlit edge is bright',
        mid / mn > ring / rn + 0.8 && edge / en > ring / rn + 0.1,
        'middle ' + (mid / mn).toFixed(2) + ', between ' + (ring / rn).toFixed(2) + ', edge ' + (edge / en).toFixed(2)
      );
    }
    {
      const B = A.makeBuilder(1, PALV),
        S = K.sculpt(A.makeSculpt(B));
      S.sun = B.norm([-0.4, 0.8, 0.45]);
      S.view = [0, 0.3, 0.95];
      S.ball([0, 1, 0], 1, { r: [1, 2, 3], gloss: { c: 10, at: 0.97 } }, { res: 0.07 });
      S.bake();
      const W = B.finish({});
      let spec = 0,
        cx = 0,
        cy = 0,
        cz = 0;
      for (let i = 0; i < W.count; i++)
        if (idx(W, i) === 10) {
          spec++;
          cx += W.data[i * 16];
          cy += W.data[i * 16 + 1] - 1;
          cz += W.data[i * 16 + 2];
        }
      const h = B.norm([-0.4 + 0, 0.8 + 0.3, 0.45 + 0.95]),
        l = Math.hypot(cx, cy, cz) || 1;
      ok(
        'volume: a wet highlight sits where the body mirrors the sun to the eye, and is small',
        spec > 8 && spec < W.count * 0.03 && (cx * h[0] + cy * h[1] + cz * h[2]) / l > 0.97,
        spec + ' splats of ' + W.count
      );
    }
    {
      const B = A.makeBuilder(1, PALV),
        S = K.sculpt(A.makeSculpt(B));
      S.sun = B.norm([-0.5, 0.6, -0.6]);
      S.ball(
        [0, 1.2, 0],
        1,
        K.look.fur([6, 7, 8, 9], { len: 0.35, comb: [1, 0, 0], lay: 0.7, rim: [11], still: true }),
        { res: 0.12 }
      );
      S.bake();
      const W = B.finish({});
      let along = 0,
        hairs = 0,
        rimN = 0,
        rimOnBand = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16,
          x = W.data[o],
          y = W.data[o + 1] - 1.2,
          z = W.data[o + 2],
          r = Math.hypot(x, y, z);
        if (r < 1.04) continue;
        hairs++;
        const c00 = W.data[o + 4],
          c01 = W.data[o + 5],
          c02 = W.data[o + 6],
          c11 = W.data[o + 8],
          c22 = W.data[o + 10];
        if (Math.abs(y) < 0.5 && Math.abs(x) < 0.5 && c00 > c11 && c00 > c22) along++;
        if (idx(W, i) === 11) {
          rimN++;
          const nl = (x * S.sun[0] + y * S.sun[1] + z * S.sun[2]) / r;
          if (Math.abs(nl) < 0.5) rimOnBand++;
        }
      }
      let mid = 0;
      for (let i = 0; i < W.count; i++) {
        const o = i * 16,
          r = Math.hypot(W.data[o], W.data[o + 1] - 1.2, W.data[o + 2]);
        if (r >= 1.04 && Math.abs(W.data[o + 1] - 1.2) < 0.5 && Math.abs(W.data[o]) < 0.5) mid++;
      }
      ok(
        'volume: a combed coat lies along the comb, and its tips light up round the edge of the lit side',
        hairs > 2000 && along > mid * 0.5 && rimN > 40 && rimOnBand > rimN * 0.8,
        hairs +
          ' strokes, ' +
          along +
          ' of ' +
          mid +
          ' on the flank run with the comb, ' +
          rimOnBand +
          ' of ' +
          rimN +
          ' rim tips on the band'
      );
    }
  }
  // ---- placing things by where they are seen
  {
    const B = A.makeBuilder(1, [0x07080b, 0x444444, 0x999999, 0xffffff]),
      S = K.sculpt(A.makeSculpt(B));
    S.view = B.norm([0.21, 0.19, 0.96]);
    const body = S.ball([0, 1, 0], [0.82, 0.64, 0.82], { r: [1, 2] }, { res: 0.1, bump: [0.1, 1.6] }),
      a = S.on(body, { at: [-0.3, 0.25] }),
      top = S.on(body, { dir: [0, 1, 0] }),
      miss = S.on(body, { at: [1.4, 0] });
    ok(
      'place: the point of a lumpy solid that the eye sees is on its surface and faces the eye',
      a.hit &&
        Math.abs(S.psd(body, a.p[0], a.p[1], a.p[2])) < 0.004 &&
        a.n[0] * S.view[0] + a.n[1] * S.view[1] + a.n[2] * S.view[2] > 0.5 &&
        top.hit &&
        near(top.p[0], 0, 0.01) &&
        top.p[1] > 1.55 &&
        !miss.hit,
      a.p.map(v => v.toFixed(2)).join(' ')
    );
    const eye = S.stud(body, { at: [0.3, 0.25] }, 0.1, { r: [0], em: true }, { ghost: true, res: 0.04 }),
      glint = S.stud(eye, { at: [-0.3, 0.4], sink: 0.2 }, 0.03, { r: [3], em: true }, { ghost: true, res: 0.03 }),
      sunk = S.stud(body, { at: [-0.3, 0.25], sink: 1.2 }, 0.1, { r: [0] }, { ghost: true });
    S.box([0.3, 1.2, 1.6], [0.6, 0.6, 0.05], { r: [1, 2] });
    const hidden = S.stud(body, { at: [0.3, 0.2] }, 0.1, { r: [0] }, { ghost: true });
    ok(
      'place: a stud sits in the skin and can be seen; one sunk under it or put behind a wall is reported',
      !eye.buried && !glint.buried && sunk.buried && hidden.buried && S.warnings.length === 2,
      S.warnings.length + ' warnings'
    );
    const bad = A.SCENES.filter(q =>
      ['watcher', 'burn', 'idol', 'bench', 'stuff', 'cabinet', 'rehearsal'].includes(q.id)
    )
      .map(q => [q.id, (q.build(q.seed).warnings || []).length])
      .filter(q => q[1]);
    ok(
      'place: no lab diorama has anything buried',
      bad.length === 0,
      bad.map(q => q.join(' ')).join(', ') || undefined
    );
  }
  {
    K.seed(5);
    const a = [K.rnd(), K.rnd(), K.rnd()];
    K.seed(5);
    const b = [K.rnd(), K.rnd(), K.rnd()];
    let lo = 1,
      hi = 0,
      sum = 0;
    for (let i = 0; i < 4000; i++) {
      const v = K.rnd();
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    ok(
      'chance: K.rnd from a seed gives the same run again, spread evenly over 0..1 (so a diorama can be run twice and compared)',
      a.join() === b.join() &&
        a[0] !== a[1] &&
        lo >= 0 &&
        hi < 1 &&
        lo < 0.01 &&
        hi > 0.99 &&
        near(sum / 4000, 0.5, 0.03)
    );
  }
  // ---- animation tools (kh-animate)
  {
    const An = K.anim;
    ok(
      'anim: every easing starts at 0 and ends at 1; back and elastic overshoot; a straight Bezier is linear',
      An.EASES.every(e => near(An.ease(1, e), 1) && (e === 'step' || near(An.ease(0, e), 0))) &&
        An.ease(0.7, 'out-back') > 1 &&
        An.ease(0.12, 'out-elastic') > 1 &&
        near(An.ease(0.3, 'bezier', [0.3, 0.3, 0.7, 0.7]), 0.3, 0.01) &&
        near(An.ease(0.5, 'elastic'), An.ease(0.5, 'out-elastic'))
    );
    const kk = [
      [0, [0, 0]],
      [1, [10, 2], 'step'],
      [2, [0, 0]]
    ];
    ok(
      'anim: keys ease out of each key, hold a stepped one, and clamp at the ends',
      near(An.keys(kk, 0.5)[0], 5) &&
        near(An.keys(kk, 1.5)[0], 10) &&
        near(An.keys(kk, 9)[0], 0) &&
        near(An.param(3, 0), 3)
    );
    const sq = An.path(
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2]
        ],
        { closed: true, curve: 0 }
      ),
      q3 = sq.at(3),
      rd = An.path(
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2]
        ],
        { closed: true, curve: 1 }
      );
    ok(
      'anim: a path measures true length, wraps when closed, and rounds its corners when curved',
      near(sq.length, 8) &&
        near(q3.p[0], 2) &&
        near(q3.p[1], 1) &&
        near(q3.tan[1], 1) &&
        near(sq.at(9).p[0], 1) &&
        rd.length > 8 &&
        rd.length < 9.5,
      rd.length.toFixed(2)
    );
    let a1 = An.spring(0, 0, 1, 0.5, 20, 0.4),
      a2 = [0, 0];
    for (let i = 0; i < 50; i++) a2 = An.spring(a2[0], a2[1], 1, 0.01, 20, 0.4);
    ok(
      'anim: the spring is exact: one long step lands where fifty short ones do',
      near(a1[0], a2[0], 1e-6) && near(a1[1], a2[1], 1e-5)
    );
    ok(
      'anim: an expression graph is data, compiled without running text',
      near(
        An.run(['add', ['mul', ['var', 'time'], 2], ['if', ['gt', ['var', 'time'], 1], 10, 0]], { time: 1.5 }),
        13
      ) &&
        (() => {
          try {
            An.run(['var', 'constructor.x'], {});
            return false;
          } catch (e) {
            return true;
          }
        })()
    );
    const walk = An.clip({
        id: 'walk',
        dur: 2,
        loop: true,
        parents: { tail: 'body' },
        tracks: {
          'body.rot': [
            [0, [0, 0, 0]],
            [1, [0, 90, 0]],
            [2, [0, 0, 0]]
          ],
          'body.scale': [
            [0, [1, 1, 1]],
            [2, [1, 2, 1]]
          ]
        },
        tools: {
          follow: [{ id: 'f', part: 'tail', preset: 'loose' }],
          layers: [
            { id: 'nod', values: { head: { rot: [10, 0, 0], scale: [1, 1.5, 1] } }, start: 0.5, end: 1.5, blend: 0.25 },
            { id: 'fix', values: { hip: { pos: [0, 0.2, 0] } }, driver: { part: 'body', ch: 'rot.y', from: 0, to: 90 } }
          ]
        }
      }),
      w1 = walk.sample(0.5),
      w2 = walk.sample(2.5),
      w3 = walk.sample(1);
    ok(
      'anim: a clip loops, lags a follower behind its source, and gives the same pose however it is reached',
      near(w1.body.rot[1], 45) &&
        w1.tail.rot[1] < -5 &&
        JSON.stringify(w1) === JSON.stringify(w2) &&
        near(w1.body.scale[1], 1.15625),
      'tail ' + w1.tail.rot[1].toFixed(1)
    );
    ok(
      'anim: a layer fades in over its blend, multiplies scale, and a corrective layer follows its driver',
      !walk.sample(0.4).head &&
        !w1.head &&
        near(walk.sample(0.625).head.rot[0], 5) &&
        near(w3.head.rot[0], 10) &&
        near(w3.head.scale[1], 1.5) &&
        near(w3.hip.pos[1], 0.2) &&
        near(w1.hip.pos[1], 0.1),
      walk.sample(0.625).head.rot[0].toFixed(2)
    );
    const hit = {
      dur: 2,
      cues: [An.cue('f', 'freeze', 0.5, { duration: 0.1 }), An.cue('s', 'slow', 1, { duration: 0.4, amount: 0.25 })]
    };
    ok(
      'anim: a freeze stops the clip clock, slow motion creeps it, and the wall time can be found again',
      near(An.animTime(hit, 0.55), 0.5) &&
        near(An.animTime(hit, 0.7), 0.6) &&
        near(An.animTime(hit, 1.5), 1.1) &&
        near(An.wallTime(hit, 1.1), 1.5, 1e-4)
    );
    const pr = { cues: An.preset('heavy-impact', 1) },
      p0 = An.present(pr, 1.02),
      p1 = An.present(pr, 1.5),
      anim = {};
    An.show(anim, p0, [0x000000, 0x404040], {});
    ok(
      'anim: an impact shakes, flashes and zooms, and is over when it is over; the background colour is never flashed',
      Math.hypot(p0.x, p0.y) > 0.5 &&
        p0.overlays.length === 1 &&
        p0.scale > 1 &&
        p1.x === 0 &&
        p1.overlays.length === 0 &&
        anim.kick &&
        anim.zoom > 1 &&
        anim.grade[0] === 0 &&
        anim.grade[3] > 0.3 &&
        An.show(anim, p1, [0, 0x404040], {}).grade === null
    );
    const cam = An.camera();
    cam.impulse(1);
    cam.advance(0.02);
    const amp = cam.amplitude;
    for (let i = 0; i < 60; i++) cam.advance(1 / 60);
    ok('anim: a camera impulse dies away', amp > 0.7 && cam.amplitude < 1e-4 && cam.offset.every(isFinite));
    const still = An.clip({
        id: 'still',
        dur: 1,
        loop: true,
        tracks: { 'body.pos': [[0, [0, 0, 0]]], 'arm.rot': [[0, [0, 0, 0]]] }
      }),
      jump = An.clip({ id: 'jump', dur: 1, tracks: { 'body.pos': [[0, [0, 1, 0]]] } }),
      wave = An.clip({ id: 'wave', dur: 1, loop: true, tracks: { 'arm.rot': [[0, [0, 0, 80]]] } }),
      mc = An.machine({
        inputs: [
          { id: 'go', type: 'trigger' },
          { id: 'speed', type: 'number', value: 0 },
          { id: 'hi', type: 'boolean', value: false }
        ],
        layers: [
          {
            id: 'base',
            entry: 'still',
            states: [
              { id: 'still', clip: still },
              { id: 'jump', clip: jump, playback: 'once' }
            ],
            transitions: [
              { from: 'any', to: 'jump', conditions: [{ input: 'go', op: 'fired' }], duration: 0.2, easing: 'linear' },
              { from: 'jump', to: 'still', exitTime: 1, duration: 0 }
            ]
          },
          {
            id: 'arms',
            entry: 'none',
            states: [{ id: 'none' }, { id: 'wave', clip: wave }],
            transitions: [
              { from: 'none', to: 'wave', conditions: [{ input: 'hi', op: 'eq', value: true }], duration: 0 },
              { from: 'wave', to: 'none', conditions: [{ input: 'speed', op: 'gt', value: 2 }], duration: 0 }
            ]
          }
        ]
      });
    mc.fire('go');
    const f1 = mc.advance(0.1),
      mid = mc.pose().body.pos[1];
    mc.advance(0.3);
    const full = mc.pose().body.pos[1];
    mc.set('hi', true);
    mc.advance(0.75);
    const back = mc.state('base'),
      arm = mc.pose();
    mc.set('speed', 3);
    mc.advance(0.1);
    ok(
      'anim: a machine fires on a trigger, cross-fades, leaves a clip when it has played, and layers override only what they animate',
      f1.events.some(e => e.type === 'transition') &&
        near(mid, 0.5) &&
        near(full, 1) &&
        back === 'still' &&
        near(arm.arm.rot[2], 80) &&
        near(arm.body.pos[1], 0) &&
        mc.state('arms') === 'none',
      'mid ' + mid.toFixed(2)
    );
    const js = An.joystick({
        x: An.clip({
          dur: 1,
          tracks: {
            'head.rot': [
              [0, [0, -30, 0], 'linear'],
              [1, [0, 30, 0]]
            ]
          }
        }),
        y: An.clip({
          dur: 1,
          tracks: {
            'head.rot': [
              [0, [-20, 0, 0], 'linear'],
              [1, [20, 0, 0]]
            ]
          }
        }),
        invertY: true
      }),
      jp = js.pose([1, 0.5]);
    ok('anim: a joystick picks a pose from two clips', near(jp.head.rot[1], 30) && near(jp.head.rot[0], -10));
    const grp = { parts: ['open', 'half', 'shut'], active: 'open' },
      swaps = [
        [1, 'half'],
        [1.1, 'shut'],
        [2, 'open']
      ];
    ok(
      'anim: a solo group shows one drawing at a time and swaps on its keys',
      An.solo(grp, swaps, 0.5) === 'open' &&
        An.solo(grp, swaps, 1.05) === 'half' &&
        An.soloPose(grp, swaps, 1.5, {}).shut.show === 1 &&
        An.soloPose(grp, swaps, 1.5, {}).open.show === 0
    );
    const fc = An.face({ gaze: { mode: 'pointer', response: 20, amplitude: [0, 0], frequency: [0, 0] } });
    let ff = null,
      shut = 1;
    for (let i = 0; i < 180; i++) {
      ff = fc.step(1 / 60, [0.5, -0.2]);
      if (fc.time > 2.8 && fc.time < 3.05) shut = Math.min(shut, ff.open);
    }
    fc.set('sleepy').blink();
    const forced = fc.step(0.1);
    for (let i = 0; i < 60; i++) fc.step(1 / 60);
    const held = An.faceControl(
      { open: 1, tilt: 0, gaze: [0, 0] },
      { open: 0.3, expressionOpen: 0.3, tilt: 0, gaze: [0.5, 0], blink: 0 },
      [
        { id: 'a', part: 'eye', time: 0, duration: 2, faceControl: { open: 1, priority: 1 } },
        { id: 'b', part: 'eye', time: 0, duration: 2, faceControl: { open: 0.5, gaze: [0, 0], priority: 2 } }
      ],
      'eye',
      1
    );
    ok(
      'anim: a face blinks on schedule and on demand, looks where it is pointed, changes mood, and a timeline can hold it',
      shut < 0.05 &&
        near(ff.gaze[0], 0.5, 0.02) &&
        forced.blink > 0.9 &&
        near(fc.open, 0.3, 0.02) &&
        near(held.open, 0.5) &&
        near(held.gaze[0], 0),
      'shut ' + shut.toFixed(2)
    );
    ok(
      'anim: a mouth opens and closes with speech and is shut outside it',
      An.talk(0.5, [[1, 2]]) === 0 &&
        [...Array(40)].some((_, i) => An.talk(1 + i / 40, [[1, 2]]) > 0.5) &&
        An.talk(2.5, [[1, 2]]) === 0
    );
    const pulse = [
      { kind: 'pulse', center: [0, 0, 0], radial: true, radius: 10, strength: 1, start: 0, speed: 5, decay: 4 }
    ];
    ok(
      'anim: a pulse in the air arrives when it has travelled there, pushes outward, and a receiver answers late',
      V.len(An.force(pulse, [5, 0, 0], 0.9)) === 0 &&
        An.force(pulse, [5, 0, 0], 1.05)[0] > 0.1 &&
        An.response(pulse, [5, 0, 0], 1.05, { lag: 0.3 })[0] < An.force(pulse, [5, 0, 0], 1.05)[0] &&
        An.response(pulse, [5, 0, 0], 1.6, { lag: 0.3 })[0] > An.force(pulse, [5, 0, 0], 1.6)[0]
    );
    const ss = {};
    let rep = null;
    for (let i = 0; i < 600; i++)
      rep = An.steer(
        { minDistance: 1, maxDistance: 1.5, moveSpeed: 2, turnSpeed: 3 },
        ss,
        [0, 0],
        [0, 1],
        [6, 0],
        1 / 60
      );
    const ts = {},
      tm = [0, 0].map(() => An.track({ yaw: [-0.5, 0.5], response: 30 }, ts, [5, 0, 1], 0.5))[1],
      sup = An.support(
        [
          [-1, 0],
          [1, 0.4]
        ],
        { height: 1, at: 0, y: 1 },
        {},
        1
      );
    ok(
      'anim: a body walks to within reach of a target and faces it; a look stops at its limit; a body sits level over its feet',
      rep.distance < 1.6 &&
        rep.distance > 0.9 &&
        Math.abs(rep.angle) < 0.15 &&
        near(ts.yaw, 0.5, 0.01) &&
        near(Math.atan2(M.app(tm, [0, 0, 1])[0], M.app(tm, [0, 0, 1])[2]), 0.5, 0.01) &&
        near(sup.offset, 0.2) &&
        near(sup.angle, Math.atan(0.2)),
      'stops at ' + rep.distance.toFixed(2)
    );
    const cp = An.copy(
      { a: { rot: [10, 40, 0] }, b: { rot: [1, 1, 1] } },
      { part: 'b', from: 'a', ch: 'rot', axes: [0, 1, 0], multiplier: [1, 0.5, 1], max: [null, 15, null] },
      1
    );
    ok('anim: copy takes the axes asked for, scaled, and limits them', near(cp.b.rot[1], 15) && near(cp.b.rot[0], 1));
    const cg = An.clip({
      dur: 2,
      tracks: {
        'a.pos': [
          [0, [0, 0, 0]],
          [0.5, [1, 0, 0]],
          [1.5, [0, 0, 0]]
        ]
      }
    });
    ok(
      'anim: ghost times are the keys either side, or a fixed spacing',
      cg.ghosts(1).join() === '0.5,1.5' && cg.ghosts(1, { mode: 'spacing', spacing: 0.2 }).join() === '0.8,1.2'
    );
  }
  // ---- deformers and the puppet (ki-deform)
  {
    const D = K.deform,
      An = K.anim;
    const body = D.body({ base: [0, 0, 0], height: 2, stretch: 1.4, waist: -0.4, bend: [0.5, 0] });
    let vol = 0,
      cnt = 0;
    for (let i = 0; i < 4000; i++) {
      const p = [K.hash(i, 1) - 0.5, K.hash(i, 2) * 2, K.hash(i, 3) - 0.5];
      vol += M.det(D.jac(body, p));
      cnt++;
    }
    ok(
      'deform: squash and stretch holds the bottom, keeps the volume, and leans the top',
      near(body([0.3, 0, 0.2])[1], 0) &&
        near(body([0, 2, 0])[1], 2.8) &&
        near(vol / cnt, 1, 0.02) &&
        near(body([0, 2, 0])[0], 0.5) &&
        near(body([0, 0, 0])[0], 0),
      'volume ' + (vol / cnt).toFixed(3)
    );
    const nd = D.noodle({ from: [0, 0, 0], to: [0, 3, 0] }),
      r0 = nd([0.3, 1.2, -0.2]);
    nd.points[2] = [0.6, 2, 0];
    nd.points[3] = [1.6, 2.6, 0];
    nd.twists = [0, 0, 0, 90];
    nd.set();
    const tip = nd([0, 3, 0]),
      side = V.sub(nd([0.2, 3, 0]), tip),
      mid = nd([0, 1.5, 0]);
    nd.set({ points: nd.rest, twists: [0, 0, 0, 0], stretch: 2 });
    const thin = nd([0.4, 0, 0]),
      far = nd([0, 3, 0]);
    ok(
      'deform: a noodle leaves its rest shape alone, follows its curve, twists, and thins as it stretches',
      V.dist(r0, [0.3, 1.2, -0.2]) < 1e-6 &&
        V.dist(tip, [1.6, 2.6, 0]) < 1e-3 &&
        near(V.len(side), 0.2, 0.03) &&
        Math.abs(side[2]) > 0.15 &&
        mid[0] > 0.02 &&
        near(far[1], 6) &&
        near(thin[0], 0.4 / Math.sqrt(2), 0.01),
      'tip ' + tip.map(v => v.toFixed(2)).join(' ')
    );
    const n2 = D.noodle({ from: [0, 0, 0], to: [0, 3, 0] }),
      nk = [
        { t: 0, v: { points: n2.rest } },
        { t: 1, v: { points: n2.rest.map((p, i) => [p[0] + i, p[1], p[2]]) } }
      ],
      lg = D.noodleAt(n2, nk, 0.6, { dur: 1, lag: 0.4, spring: 0.5 }),
      nl = D.noodleAt(n2, nk, 0.6, { dur: 1 });
    ok(
      'deform: with lag the far end of a noodle trails, and asking twice gives the same pose',
      lg.points[3][0] < nl.points[3][0] - 0.3 &&
        near(lg.points[0][0], nl.points[0][0]) &&
        JSON.stringify(lg) === JSON.stringify(D.noodleAt(n2, nk, 0.6, { dur: 1, lag: 0.4, spring: 0.5 })),
      lg.points[3][0].toFixed(2) + ' against ' + nl.points[3][0].toFixed(2)
    );
    const crease = D.fold({ angle: Math.PI / 2, offset: 1, width: 0 }),
      arc = D.fold({ angle: Math.PI / 2, offset: 1, width: 0.5 }),
      fa = arc([0, 1.2, 0]),
      fb = arc([0, 1.3, 0]);
    ok(
      'deform: a crease turns what is past it and keeps its length; an arc keeps length along the bend',
      V.dist(crease([0.2, 0.5, 0]), [0.2, 0.5, 0]) < 1e-9 &&
        V.dist(crease([0.2, 2, 0]), [0.2, 1, 1]) < 1e-6 &&
        near(V.dist(fa, fb), 0.1, 1e-3) &&
        near(arc([0, 3, 0])[1], 1 + 0.5 / (Math.PI / 2), 1e-3)
    );
    const lat = D.lattice({ min: [-1, 0, -1], max: [1, 2, 1] }, [2, 3, 2]),
      keep = lat.pts.slice();
    lat.move(1, 2, 1, [0.5, 0.5, 0]);
    const moved = lat.pts.slice(),
      l1 = lat([1, 2, 1]),
      l2 = lat([-1, 0, -1]),
      l3 = lat([0.5, 1.5, 0.5]);
    lat.mix(keep, moved, 0.5);
    ok(
      'deform: a lattice carries a corner with its handle, leaves the far corner, moves what is between in proportion, and blends poses',
      V.dist(l1, [1.5, 2.5, 1]) < 1e-6 &&
        V.dist(l2, [-1, 0, -1]) < 1e-9 &&
        near(l3[0] - 0.5, 0.5 * 0.75 * 0.5 * 0.75, 1e-6) &&
        near(lat([1, 2, 1])[0], 1.25)
    );
    const mo = D.morph({ height: 2, arc: Math.PI / 2 }),
      tw = D.morph({ height: 2, twist: Math.PI / 2, inflate: 0.5 });
    ok(
      'deform: an arc keeps the length of what it bends; twist turns the top; inflate swells the middle',
      V.dist(mo([0, 2, 0]), [4 / Math.PI, 4 / Math.PI, 0]) < 1e-6 &&
        near(tw([1, 2, 0])[2], -1, 1e-6) &&
        near(tw([1, 1, 0])[0] ** 2 + tw([1, 1, 0])[2] ** 2, 2.25, 1e-6)
    );
    const em = D.emote({ center: [0, 1, 0], width: 2, height: 2 });
    let fine = true,
      moves = 0;
    for (const m of D.EMOTES) {
      em.motion = m;
      em.t = 0.37;
      em.k = 1;
      const q = em([0.4, 1.8, 0]);
      fine = fine && q.every(isFinite);
      if (V.dist(q, [0.4, 1.8, 0]) > 1e-4) moves++;
      em.k = 0;
      fine = fine && V.dist(em([0.4, 1.8, 0]), [0.4, 1.8, 0]) === 0;
    }
    const sm = D.smear({ dir: [1, 0, 0], len: 0.5, front: [1, 0, 0], extent: 2 }),
      fo = D.foliage({ kind: 'tree', height: 4, width: 3 }),
      bo = D.boil({ fps: 8, amp: 0.02 });
    fo.t = 2;
    fo.impact = 0.08;
    bo.t = 0.05;
    const b1 = bo([1, 1, 1]);
    bo.t = 0.1;
    const b2 = bo([1, 1, 1]);
    bo.t = 0.3;
    ok(
      'deform: the 21 reaction fields all move something and all vanish at no intensity; a smear leaves the trailing side behind; a tree keeps its roots; a boil holds between its frames',
      D.EMOTES.length === 21 &&
        fine &&
        moves === 21 &&
        V.dist(sm([1, 0, 0]), [1, 0, 0]) === 0 &&
        near(sm([-1, 0, 0])[0], -1.5) &&
        V.len(fo([0, 0, 0])) < 1e-9 &&
        fo([0, 3.5, 0])[0] > 0.2 &&
        V.dist(b1, b2) === 0 &&
        V.dist(b1, bo([1, 1, 1])) > 0,
      moves + ' fields move'
    );
    const B = A.makeBuilder(1, [0x07080b, 0x333333, 0x666666, 0x999999, 0xcccccc]),
      S = K.sculpt(A.makeSculpt(B)),
      tags = D.tags(S);
    S.ball([0, 1, 0], [0.6, 1, 0.6], { r: [1, 2, 3] }, { res: 0.07, tag: 'body' });
    S.ball([0, 2.3, 0], 0.4, { r: [2, 3, 4] }, { res: 0.07, tag: 'head' });
    S.ball([0.5, 1.2, 0], [0.5, 0.14, 0.14], { r: [2, 3] }, { res: 0.06, tag: 'arm' });
    S.ball([1.3, 1.2, 0], [0.5, 0.14, 0.14], { r: [3, 4] }, { res: 0.06, tag: 'hand' });
    S.ball([0, 0.4, 0.7], 0.15, { r: [1, 2], blade: true }, { res: 0.06, tag: 'tuft' });
    S.bake();
    const W = B.finish({}),
      all = tags.of('body', 'head'),
      rest = D.rest(W, all),
      exact = new Float32Array(W.data),
      bendy = D.body({ base: [0, 0, 0], height: 2, bend: [0.5, 0.2], stretch: 1.15 });
    D.apply({ data: exact }, tags.body, D.rest(W, tags.body), bendy);
    let det0 = 0,
      det1 = 0;
    {
      const o = tags.body[100] * 16,
        cov = d => M.det([d[o + 4], d[o + 5], d[o + 6], d[o + 5], d[o + 8], d[o + 9], d[o + 6], d[o + 9], d[o + 10]]),
        p = [W.data[o], W.data[o + 1], W.data[o + 2]];
      det0 = cov(W.data) * Math.pow(M.det(D.jac(bendy, p)), 2);
      det1 = cov(exact);
    }
    ok(
      'deform: applied exactly, a splat goes where the map says and its shape is stretched as the map stretches space there',
      near(det1 / det0, 1, 0.01) &&
        V.dist(
          [exact[tags.body[0] * 16], exact[tags.body[0] * 16 + 1], exact[tags.body[0] * 16 + 2]],
          bendy([W.data[tags.body[0] * 16], W.data[tags.body[0] * 16 + 1], W.data[tags.body[0] * 16 + 2]])
        ) < 1e-5
    );
    let poseFn = () => {};
    const pup = K.puppet(W, {
      react: true,
      parts: {
        body: { ids: tags.body, pivot: [0, 0, 0], slices: 8 },
        head: { ids: tags.head, pivot: [0, 2, 0], parent: 'body' },
        arm: { ids: tags.arm, pivot: [0, 1.2, 0], parent: 'body' },
        hand: { ids: tags.hand, pivot: [1, 1.2, 0], parent: 'arm' },
        tuft: { ids: tags.tuft, parent: 'body' }
      },
      pose: (t, dt, p) => poseFn(t, dt, p)
    });
    const posed = () => {
        W.anim.update(1 / 60, 0);
        return K.bones.posed(W);
      },
      at = (d, i) => [d[i * 16], d[i * 16 + 1], d[i * 16 + 2]];
    poseFn = (t, dt, p) => {
      p.pose.body = { stretch: 1.15, bend: [0.5, 0.2] };
    };
    let d1 = posed(),
      worst = 0;
    for (const i of tags.body) worst = Math.max(worst, V.dist(at(d1, i), at(exact, i)));
    const kinds = {};
    let windy = -1;
    for (const i of tags.tuft) {
      const k = Math.round(W.data[i * 16 + 11]) % 16;
      kinds[k] = 1;
      if (k === 13) windy = i;
    }
    ok(
      'puppet: eight slices of bones on the graphics card follow a bend to within a few hundredths of doing it exactly',
      worst < 0.05 && pup.count === 12 && W.anim.boned.length === W.count,
      'worst ' + worst.toFixed(3) + ' of a body 2 tall'
    );
    ok(
      'puppet: hair and grass that sway are carried too, and still sway (their own kind), and are posed as swaying splats for the tools',
      Object.keys(kinds).join() === '12,13' &&
        Math.round(d1[windy * 16 + 11]) % 16 === 11 &&
        near(d1[windy * 16 + 13], 1.9)
    );
    const headTop = pup.point('head', [0, 2.7, 0]);
    ok(
      'puppet: a child rides its parent where the parent bends, turning with it',
      near(pup.point('head', [0, 2, 0])[0], bendy([0, 2, 0])[0], 0.03) && headTop[0] > bendy([0, 2, 0])[0] + 0.1,
      headTop.map(v => v.toFixed(2)).join(' ')
    );
    poseFn = (t, dt, p) => {
      p.look('head', [5, 2, 0], { forward: [0, 0, 1], limit: 60 });
    };
    posed();
    const nose = pup.point('head', [0, 2.3, 0.4]);
    poseFn = (t, dt, p) => {
      p.pose.arm = { rot: [0, 0, 20] };
      p.miss = p.reach('arm', 'hand', [1.8, 1.2, 0], [1.0, 2.2, 0.5]);
    };
    posed();
    const tipAt = pup.point('hand', [1.8, 1.2, 0]),
      elbow = V.dist(pup.point('arm', [0, 1.2, 0]), pup.point('hand', [1, 1.2, 0]));
    ok(
      'puppet: a head turns to look but no further than its limit; a two-bone arm puts its hand on a target without stretching',
      near(nose[0], 0.4 * Math.sin(Math.PI / 3), 0.01) &&
        pup.miss < 0.02 &&
        V.dist(tipAt, [1.0, 2.2, 0.5]) < 0.02 &&
        near(elbow, 1, 1e-3),
      'miss ' + pup.miss.toFixed(4)
    );
    const ring = An.path(
      [
        [2, 0],
        [0, 2],
        [-2, 0],
        [0, -2]
      ],
      { closed: true }
    );
    poseFn = (t, dt, p) => {
      p.onPath('body', ring, 0, { orient: true, forward: [0, 0, 1], offset: [0, 0, 0] });
      p.pin('head', [0, 2.3, 0], [2, 3, 0]);
      p.distance('arm', [2, 1.2, 0], 0.5, { mode: 'closer' });
      p.pose.tuft = { show: 0 };
    };
    const d2 = posed(),
      fw = M.app(pup.parts.body.A, [0, 0, 1]);
    ok(
      'puppet: a body rides a path and faces along it; a pin puts a point on a target; a part is kept within a distance; a hidden part is gone',
      V.dist(pup.point('body', [0, 0, 0]), [2, 0, 0]) < 1e-6 &&
        V.dot(fw, [ring.at(0).tan[0], 0, ring.at(0).tan[1]]) > 0.999 &&
        V.dist(pup.point('head', [0, 2.3, 0]), [2, 3, 0]) < 1e-6 &&
        V.dist(pup.point('arm', [0, 1.2, 0]), [2, 1.2, 0]) < 0.5 + 1e-6 &&
        d2[tags.tuft[0] * 16 + 1] < -50
    );
    poseFn = (t, dt, p) => {
      p.pose.body = { scale: 1.2, rot: [0, 90, 0], pos: [1, 0, 0] };
    };
    const d3 = posed();
    let lo = 9,
      hi = -9;
    for (const i of tags.head) {
      lo = Math.min(lo, d3[i * 16 + 1]);
      hi = Math.max(hi, d3[i * 16 + 1]);
    }
    ok(
      'puppet: scale, turn and move go down the hierarchy',
      near(hi, 2.7 * 1.2, 0.03) &&
        near(pup.point('arm', [0.5, 1.2, 0])[2], -0.6, 1e-6) &&
        near(pup.point('arm', [0.5, 1.2, 0])[0], 1, 1e-6)
    );
    /* anything on bones can be bent by a map, and flinches when tapped */
    const times = [];
    poseFn = t => {
      times.push(t);
    };
    const an = W.anim,
      top = d => {
        let hi2 = -9,
          wd = 0;
        for (const i of tags.body) {
          hi2 = Math.max(hi2, d[i * 16 + 1]);
          wd = Math.max(wd, Math.abs(d[i * 16]));
        }
        return [hi2, wd];
      },
      rest0 = top(posed());
    an.warp = D.squash([0, 0, 0], [0, 1, 0], 1.3);
    const warped = top(posed());
    an.warp = null;
    const miss = an.poke([5, 9, 9], [0, 0, -1]),
      hitAt = an.poke([0.1, 1, 9], [0, 0, -1]);
    let tt = 0,
      lowest = 9,
      highest = 0,
      kicked = 0;
    times.length = 0;
    for (let i = 0; i < 48; i++) {
      tt += 1 / 60;
      an.update(1 / 60, tt);
      const q = top(K.bones.posed(W));
      lowest = Math.min(lowest, q[0]);
      highest = Math.max(highest, q[0]);
      if (an.kick) kicked++;
    }
    const after = top(posed());
    ok(
      'bones: a map bends whatever rides them, however it was rigged',
      near(warped[0], rest0[0] * 1.3, 0.03) &&
        near(warped[1], rest0[1] / Math.sqrt(1.3), 0.03) &&
        near(top(posed())[0], rest0[0], 1e-6),
      'top ' + rest0[0].toFixed(2) + ' to ' + warped[0].toFixed(2)
    );
    ok(
      'bones: tapped, a creature that asked to (react: true) flinches: it squashes and springs back, its clock stops for the hit stop, the camera is jogged, and it ends as it was',
      miss === null &&
        hitAt &&
        near(hitAt[2], 0.6, 0.15) &&
        lowest < rest0[0] - 0.05 &&
        highest > rest0[0] + 0.02 &&
        kicked > 2 &&
        near(times[2], times[0], 1e-9) &&
        near(times[47] - times[40], 7 / 60, 1e-9) &&
        near(after[0], rest0[0], 1e-6) &&
        an.kick === null,
      'top ' + lowest.toFixed(2) + ' to ' + highest.toFixed(2) + ' from ' + rest0[0].toFixed(2)
    );
  }
  // ---- the clips (kj-acts)
  {
    const T = K.acts,
      An = K.anim;
    const ends = T.KINDS.every(k => {
        const c = T.clip(k, { part: 'b' }),
          e = c.sample(c.dur).b;
        return V.len(e.pos) < 1e-9 && near(e.stretch, 1) && V.len(e.rot) < 1e-9;
      }),
      vic = T.clip('victory', { part: 'b', unit: 0.01 }),
      up = Math.max(...[...Array(40)].map((_, i) => vic.sample((i / 40) * vic.dur).b.pos[1])),
      sq = Math.min(...[...Array(40)].map((_, i) => vic.sample((i / 40) * vic.dur).b.stretch)),
      raw = T.clip('heart-hurt', { part: 'b', keep: false }).sample(0).b.scale;
    ok(
      'acts: all ' +
        T.KINDS.length +
        ' squash and stretch clips end at rest; a cheer squashes, then leaves the ground; a lost heart starts flat',
      ends &&
        T.KINDS.length === 10 &&
        near(up, 0.24) &&
        sq < 0.9 &&
        near(raw[0], 1.65) &&
        near(raw[1], 0.4) &&
        T.poseAt(T.SEQUENCES.attack, 0.3) === 'reach',
      'rises ' + up.toFixed(2)
    );
    const pl = T.emotes();
    pl.trigger('love');
    pl.trigger('idea', { enqueue: true });
    pl.update(1);
    const first = pl.active.id,
      age = pl.active.age;
    pl.update(2.5);
    const second = pl.active && pl.active.id;
    pl.update(10);
    const rs = T.reactions();
    rs.trigger('hero', 'hurt', 0);
    const env = T.envelope(0.2, 3.4);
    ok(
      'acts: 25 reactions; an emote plays out, the next in the queue follows, and it arrives with an overshoot; a cheer cannot replace a hurt',
      T.REACTIONS.length === 25 &&
        T.REACTIONS.every(r => K.deform.EMOTES.includes(r.motion)) &&
        first === 'love' &&
        near(age, 1) &&
        second === 'idea' &&
        pl.active === null &&
        T.envelope(0, 3.4).scale === 0 &&
        env.scale > 1.05 &&
        T.envelope(3.4, 3.4).opacity === 0 &&
        rs.trigger('hero', 'hit', 0.5) === null &&
        rs.trigger('hero', 'death', 0.5) !== null &&
        rs.at('hero', 1).event.kind === 'death' &&
        T.accent({ id: 'confused', age: 0.7 }).armLift > 0.15
    );
    const ck = T.clock('chop');
    let seen = [],
      heldAt = 0,
      when = 0;
    for (let i = 0; i < 400 && !ck.finished; i++) {
      const before = ck.time,
        ev = ck.advance(0.01);
      seen = seen.concat(ev);
      if (ev.includes('contact')) when = i;
      if (when && i > when && i <= when + 4 && ck.time === before) heldAt++;
    }
    ok(
      'acts: an action reaches its contact, holds there for the hit stop, and finishes',
      seen.join() === 'effort,contact,finish' &&
        heldAt === 4 &&
        near(T.ACTION.contact.chop * T.ACTION.duration.chop, 1.2875),
      'held ' + heldAt + ' frames'
    );
    const g0 = T.gait(1.0, 0),
      g1 = T.gait(1.0, 1),
      pl2 = [...Array(100)].map((_, i) => T.gait((i / 100) * Math.PI * 2, 0)),
      head = p => [p * 9000, 100 * Math.sin(p * 30)];
    ok(
      'acts: one leg swings while the other is planted; a planted foot is on the ground; the swing takes 44 parts in a hundred',
      g0.planted !== g1.planted &&
        pl2.every(q => !q.planted || q.lift === 0) &&
        Math.abs(pl2.filter(q => !q.planted).length - 44) <= 1
    );
    ok(
      'acts: a smear only in the fast part of a swing; follow-through only after the blow; a flash that holds then fades; a struck tree rocks after a beat and a felled one leans over',
      T.smear(0.3, head, 1).length === 0 &&
        T.smear(0.48, head, 1).length > 10 &&
        T.swingFollow(0.5, 'chop').headY === 0 &&
        Math.abs(T.swingFollow(0.6, 'chop').headY) > 1 &&
        near(T.hitFlash(1.03, 1), 0.85) &&
        T.hitFlash(1.12, 1) < 0.5 &&
        T.hitFlash(1.3, 1) === 0 &&
        T.treeFollow(0.05) === 0 &&
        Math.abs(T.treeFollow(0.2)) > 0.01 &&
        T.hit(0.1, 'wood').x !== 1 &&
        T.hit(1, 'wood').x === 1 &&
        near(T.fell(2, 1).lean, -1.5) &&
        T.fell(0.1).lean === 0 &&
        near(T.harvestLift(1), 123)
    );
    const cl = T.CLOUDS[0],
      lf = T.newLeaf([0, 3, 0], 1, 5);
    let lt = 0,
      lp = null;
    for (; lt < 6; lt += 0.05) {
      lp = T.leaf(lf, lt, 0);
      if (lp.done) break;
    }
    const bd = { at: 1, duration: 2, from: { x: 0, y: 1, z: 0 }, to: { x: 4, y: 2, z: 0 }, arc: 1 };
    ok(
      'acts: a cloud starts from its place and never jumps; a leaf flutters down and lands; a bird arcs from perch to perch; butterflies come and go',
      V.dist(T.cloud(cl, 0), [cl.x, cl.y, cl.z]) < 1e-9 &&
        V.dist(T.cloud(cl, 10), T.cloud(cl, 10.1)) < 0.02 &&
        lp.done &&
        lf.landAt > 1 &&
        near(lp.p[1], 0.03) &&
        near(T.bird(bd, 1).x, 0) &&
        near(T.bird(bd, 3).y, 2) &&
        T.bird(bd, 2).y > 2 &&
        T.butterflies({ x: 0, z: 0 }, 0, 3)[0].alpha === 0 &&
        T.butterflies({ x: 0, z: 0 }, 20, 3)[0].alpha === 1 &&
        T.butterflies({ x: 0, z: 0 }, 60, 3).length === 0,
      'leaf lands at ' + (lf.landAt || 0).toFixed(2) + 's'
    );
    const sp = T.spin({ part: 'd' }),
      br = T.breathe(1);
    ok(
      'acts: a floating spin loops; breath is small',
      sp.loop && near(sp.sample(8.5).d.rot[1], sp.sample(0.5).d.rot[1]) && Math.abs(br.stretch - 1) < 0.02
    );
    const cab = A.SCENES.find(q => q.id === 'cabinet').build(7),
      st = cab.anim,
      be = cab.lab.beast,
      coat = be.pup.parts.coat;
    let good = true,
      states = [],
      t = 0,
      flashed = false,
      shook = 0;
    const run = (secs, each) => {
      for (let i = 0; i < secs * 60; i++) {
        t += 1 / 60;
        st.update(1 / 60, t);
        good = good && be.pup.bones.every(isFinite);
        if (each) each();
      }
    };
    run(2);
    const footBefore = be.pup.point('coat', coat.base),
      rows0 = st.rows.reduce((a, b) => a + b, 0);
    be.startle([0.2, 1.5, 0.9]);
    run(0.3, () => {
      states.push(be.brain.state('body'));
      flashed = flashed || !!st.grade;
      shook = Math.max(shook, st.kick ? V.len(st.kick) : 0);
    });
    const squash = be.pup.pose.coat.stretch;
    run(1.5);
    states.push(be.brain.state('body'));
    be.notice([4.6, 1.6, 0]);
    run(1);
    const turned = M.app(be.pup.parts.head.A, [0, 0, 1])[0];
    run(17);
    ok(
      'cabinet: the beast lives on the animation tools: startled it flinches with a hit stop, a shake and a flash, recovers, turns to what it notices, and dozes when left alone',
      good &&
        states.includes('startle') &&
        states[states.length - 1] === 'idle' &&
        flashed &&
        shook > 0.003 &&
        st.grade === null &&
        turned > 0.25 &&
        be.brain.state('mood') === 'doze' &&
        be.face.def.expression === 'sleepy' &&
        V.dist(footBefore, [coat.base[0], coat.base[1], coat.base[2]]) < 0.02,
      'head turned ' + turned.toFixed(2) + ', shake ' + shook.toFixed(3)
    );
    ok(
      'cabinet: all of the beast rides bones: nothing of it is sent to the graphics card again each frame',
      be.pup.anim.boned.length === be.pup.splats,
      be.pup.splats + ' splats on ' + be.pup.count + ' bones'
    );
  }
  // ---- the character (kk-character), and the tools on it
  {
    const spec = {
        id: 'blob',
        height: 1.2,
        pts: { hip: [0, 0.5, 0], chest: [0, 0.7, 0], hem: [0, 0.3, 0], neck: [0, 0.95, 0] },
        sculpt(S, T) {
          S.ball([0, 0.5, 0], [0.4, 0.45, 0.4], { r: [1, 2, 3] }, T('root'));
          S.ball([0, 1.0, 0], 0.25, { r: [2, 3, 4] }, T('head'));
        },
        world: { height: () => 0 }
      },
      B = A.makeBuilder(
        1,
        Array.from({ length: 40 }, (_, i) => (i ? 0x101010 * (1 + (i % 14)) : 0x07080b))
      ),
      ch = K.character(B, spec, 0),
      W = B.finish({}),
      at = W.count - ch.total;
    ch.bind(W, at);
    const box = () => {
      let lo = 9,
        hi = -9,
        x0 = 9,
        x1 = -9;
      for (let i = 0; i < ch.rig; i++) {
        const o = (at + i) * 16;
        if (W.data[o + 1] < -10) continue;
        lo = Math.min(lo, W.data[o + 1]);
        hi = Math.max(hi, W.data[o + 1]);
        x0 = Math.min(x0, W.data[o]);
        x1 = Math.max(x1, W.data[o]);
      }
      return { lo, hi, w: x1 - x0 };
    };
    let t = 0,
      tall = 0,
      low = 9,
      up = 0,
      wide = 0,
      narrow = 9;
    const step = (n, each) => {
      for (let i = 0; i < n; i++) {
        t += 1 / 60;
        ch.update(1 / 60, { move: 0 }, t);
        if (each) each(box());
      }
    };
    step(120);
    const idle = box();
    ch.play('victory');
    step(70, b => {
      tall = Math.max(tall, b.hi);
      low = Math.min(low, b.hi);
      up = Math.max(up, b.lo);
    });
    const done = !ch.playing();
    step(120);
    const back = box();
    ch.react('spring', { dur: 1.2, k: 1.5 });
    step(60, b => {
      wide = Math.max(wide, b.w);
      narrow = Math.min(narrow, b.w);
    });
    step(120);
    ok(
      'character: a clip from the library plays over what it is doing (it squashes, stretches and leaves the ground), ends, and leaves it as it was',
      tall > idle.hi + 0.08 &&
        low < idle.hi - 0.04 &&
        up > idle.lo + 0.05 &&
        done &&
        ch.st.act === null &&
        near(back.hi, idle.hi, 0.03),
      'top ' + low.toFixed(2) + ' to ' + tall.toFixed(2) + ' from ' + idle.hi.toFixed(2)
    );
    ok(
      'character: a reaction field runs through its bones for its time and is gone',
      wide > idle.w + 0.05 && narrow < idle.w - 0.05 && ch.warp === null && near(box().w, idle.w, 0.03),
      'width ' + narrow.toFixed(2) + ' to ' + wide.toFixed(2) + ' from ' + idle.w.toFixed(2)
    );
  }
  {
    const reh = A.SCENES.find(q => q.id === 'rehearsal').build(8),
      st = reh.anim,
      lab = reh.lab,
      kinds = new Set();
    let good = true,
      t = 0,
      tall = 1,
      flat = 1,
      cue = 0;
    for (let i = 0; i < 70 * 30; i++) {
      t += 1 / 30;
      st.update(1 / 30, t);
      good = good && lab.pup.bones.every(isFinite);
      const it = lab.now(),
        s = lab.pup.pose.core && lab.pup.pose.core.stretch;
      kinds.add(it.motion || it.kind);
      if (s) {
        tall = Math.max(tall, s);
        flat = Math.min(flat, s);
      }
      if (st.grade || st.kick) cue++;
    }
    const before = lab.now();
    st.poke([0, 5, 9], [0, -0.3, -0.95]);
    ok(
      'rehearsal: all ten clips, the cage and all 21 fields are played in turn; it squashes and stretches; cues fire; a tap goes on to the next',
      good && kinds.size === 10 + 1 + 21 && tall > 1.25 && flat < 0.7 && cue > 5 && lab.now() !== before,
      kinds.size + ' kinds, stretch ' + flat.toFixed(2) + ' to ' + tall.toFixed(2)
    );
    const bad = (reh.warnings || []).length;
    ok('rehearsal: nothing buried', bad === 0);
  }
  // ---- pixel-sized nodes (kpx-pixel) and the crispness measure
  {
    const PALx = [0x101018, 0x303848, 0x58607a, 0x8890a8, 0xc0c8d8, 0x2a4a2a, 0x4a7a3a, 0x7aaa4a, 0xb0d870];
    const B = A.makeBuilder(3, PALx),
      S = K.sculpt(A.makeSculpt(B));
    S.pixelSize(20);
    S.sun = [-0.5, 0.75, 0.43];
    S.wob = 0;
    const px = S.px;
    S.box([0, -0.2, 0], [2.2, 0.2, 2.2], K.pixel.lawn({ r: [5, 6, 7, 8], tufts: 0.3 }), { res: px * 0.9 });
    const rock = S.facet({ at: [-0.9, 0.3, 0.6], size: [0.5, 0.4, 0.45], faces: 9, seed: 4, mat: { r: [1, 2, 3, 4] } });
    S.canopy({ at: [0.8, 0.9, -0.5], size: [0.7, 0.6, 0.7], lobes: 5, mat: { r: [5, 6, 7, 8] }, seed: 2 });
    S.pine({ at: [1.4, 0, 1.2], h: 1.6, mat: { r: [5, 6, 7] }, trunk: { r: [1, 2] }, seed: 3 });
    S.box([-1.2, 0.5, -1.2], [0.5, 0.5, 0.05], K.pixel.masonry({ r: [1, 2, 3, 4], stone: [8, 5] }), { res: px * 0.9 });
    S.bake();
    const W = B.finish({
      cam: { target: [0, 0.4, 0], dist: 7, pitch: 0.5, yaw: 0.7, sway: 0 },
      radius: 3.5,
      detail: 20,
      dither: 0,
      look: { clean: true, lines: true }
    });
    ok(
      'pixel nodes: a sculpt of grass, a cut rock, a crown, a pine and a wall bakes',
      W.count > 20000,
      W.count + ' dabs'
    );
    // every face of the cut rock is covered: points spread over its faces all have a dab within a pixel and a half of them
    let miss = 0,
      tried = 0;
    const D = W.data;
    for (let k = 0; k < 200; k++) {
      const a = (k / 200) * Math.PI * 2 * 7.3,
        e = Math.sin(k * 1.7) * 1.2,
        d = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
      // march from outside in to the rock's surface
      let t = 1.5;
      for (let i = 0; i < 80; i++) {
        const v = rock.sd(-0.9 + d[0] * t, 0.3 + d[1] * t, 0.6 + d[2] * t);
        if (v < 0.002) break;
        t -= Math.max(0.004, v * 0.9);
      }
      const p = [-0.9 + d[0] * t, 0.3 + d[1] * t, 0.6 + d[2] * t];
      if (p[1] < 0.02) continue;
      tried++;
      let near = false;
      for (let i = 0; i < W.count && !near; i++)
        if ((D[i * 16] - p[0]) ** 2 + (D[i * 16 + 1] - p[1]) ** 2 + (D[i * 16 + 2] - p[2]) ** 2 < (px * 1.5) ** 2)
          near = true;
      if (!near) miss++;
    }
    ok(
      'pixel nodes: a cut rock has no holes (every place on its faces has a dab)',
      tried > 100 && miss === 0,
      miss + ' bare of ' + tried
    );
    const R = require('./render.js'),
      C = require('./crisp.js'),
      im = R.render(W, { t: 0, w: 640, h: 400 }),
      m = C.measure(im);
    ok(
      "pixel nodes: drawn, it is crisp by the study's targets",
      m.stray < 0.02 && m.specks < 0.07,
      (m.stray * 100).toFixed(1) + '% stray, ' + (m.specks * 100).toFixed(1) + '% specks'
    );
    const tex = K.pixel.masonry({ r: [1, 2, 3, 4], stone: [8, 5], px: 0.05 }).tex;
    ok(
      'masonry: a joint is darker than the stone beside it',
      tex(0.3, 0.001, 0, 0, 0.6, 0, 1) < tex(0.3, 0.12, 0, 0, 0.6, 0, 1) || tex(0.3, 0.001, 0, 0, 0.6, 0, 1) === 1
    );
  }
  // ---- edge sprites (kpz-sprite), prop libraries (kpy-props) and paint-over decals
  {
    const sp = K.sprite.art('.+.\n+#-\n###');
    ok(
      'sprites: text art is read root first and written back the same',
      sp.w === 3 &&
        sp.h === 3 &&
        sp.cells[0] === 8 &&
        sp.cells[3 * 2 + 1] === 9 &&
        K.sprite.show(sp) === '.+.\n+#-\n###'
    );
    let big = false;
    try {
      K.sprite.art('########');
    } catch (e) {
      big = true;
    }
    ok('sprites: one wider than the limit is refused', big);
    const sets = ['grass', 'leafy', 'ivy', 'needles'].map(n => K.sprite.set(n, { n: 4 }));
    ok(
      'sprites: every ready set makes sprites within the limits, each with something in it',
      sets.every(l => l.length === 4 && l.every(q => q.w <= 7 && q.h <= 6 && q.cells.some(v => v)))
    );
    // a lawn with tufts along its edges, drawn with them and without: they stand past its edge, and leave its inside alone
    const PALx = [0x101018, 0x303848, 0x58607a, 0x8890a8, 0xc0c8d8, 0x2a4a2a, 0x4a7a3a, 0x7aaa4a, 0xb0d870];
    const mk = (withEdges, rs) => {
      const B = A.makeBuilder(3, PALx),
        S = K.sculpt(A.makeSculpt(B));
      S.pixelSize(20);
      S.pixel = true;
      S.sun = [-0.5, 0.75, 0.43];
      S.wob = 0;
      const mat = { r: [5, 6, 7, 8] };
      S.box([0, -0.2, 0], [1.6, 0.2, 1.6], withEdges ? K.pixel.edge(mat, { up: 'grass', every: 4, share: 1 }) : mat, {
        res: S.px * (rs || 0.9)
      });
      S.bake();
      const W = B.finish({
        cam: { target: [0, 0, 0], dist: 7, pitch: 0.5, yaw: 0.7, sway: 0 },
        radius: 3,
        detail: 20,
        dither: 0,
        look: { pixel: true, outline: true }
      });
      W.pixTex = K.pixel.evaluators(W);
      W.pixCell = K.pixel.CELL;
      W.pixView = K.pixel.VIEW;
      W.pixUnfold = K.pixel.unfold;
      W.pixAnchors = K.pixel.anchors;
      return W;
    };
    const R = require('./render.js'),
      a0 = R.render(mk(false), { t: 0, w: 320, h: 220 }),
      a1 = R.render(mk(true), { t: 0, w: 320, h: 220 }),
      bg = [(PALx[0] >> 16) & 255, (PALx[0] >> 8) & 255, PALx[0] & 255],
      isBg = (im, i) => im.rgb[i * 3] === bg[0] && im.rgb[i * 3 + 1] === bg[1] && im.rgb[i * 3 + 2] === bg[2];
    let grew = 0,
      lost = 0;
    for (let i = 0; i < a0.w * a0.h; i++) {
      if (isBg(a0, i) && !isBg(a1, i)) grew++;
      if (!isBg(a0, i) && isBg(a1, i)) lost++;
    }
    ok(
      'edge sprites: tufts stand past the edge of the lawn, and take nothing away',
      grew > 40 && lost === 0,
      grew + ' pixels past the edge, ' + lost + ' lost'
    );
    // the points they stand on are pinned to the surface, not to the dabs: built with dabs of another size, nearly every point is
    // within a pixel of where it was (so swapping detail levels does not move them)
    const P1 = K.pixel.anchors(mk(true)),
      P2 = K.pixel.anchors(mk(true, 0.6)),
      key = (D, q) => [0, 1, 2].map(c => Math.floor(D[q + c] / ((4 / 20) * 0.5))).join(','),
      at2 = new Map();
    for (let q = 0; q < P2.n * 12; q += 12) at2.set(key(P2.data, q), q);
    let same = 0,
      near = 0;
    for (let q = 0; q < P1.n * 12; q += 12) {
      const q2 = at2.get(key(P1.data, q));
      if (q2 === undefined) continue;
      same++;
      if (
        Math.hypot(P1.data[q] - P2.data[q2], P1.data[q + 1] - P2.data[q2 + 1], P1.data[q + 2] - P2.data[q2 + 2]) <
        1 / 20
      )
        near++;
    }
    ok(
      'edge sprites: the points they stand on stay put when the dabs are made another size',
      P1.n > 100 && same > P1.n * 0.8 && near > same * 0.9,
      near + ' of ' + same + ' within a pixel'
    );
    // props: a slab with a wall on it; things at the foot of the wall stand outside it and near it, facing out, the same each time
    const B = A.makeBuilder(5, PALx),
      S = K.sculpt(A.makeSculpt(B));
    S.pixelSize(20);
    S.box([0, -0.2, 0], [2, 0.2, 2], { r: [5, 6, 7] }, { res: S.px });
    S.box([0, 0.5, 0], [0.6, 0.5, 0.4], { r: [1, 2, 3] }, { res: S.px });
    const foot = () => K.props.wallBase(S, { box: [0, 0, 0.6, 0.4], reach: 0.2, every: 0.2, top: 0.3, seed: 2 }),
      f1 = foot(),
      f2 = foot();
    ok(
      'props: places at the foot of a wall are outside it, within reach, on the ground, and the same each time',
      f1.length > 6 &&
        f1.every(
          q =>
            Math.max(Math.abs(q.p[0]) - 0.6, Math.abs(q.p[2]) - 0.4) > 0 &&
            Math.max(Math.abs(q.p[0]) - 0.6, Math.abs(q.p[2]) - 0.4) < 0.22 &&
            Math.abs(q.p[1]) < 0.02
        ) &&
        JSON.stringify(f1) === JSON.stringify(f2),
      f1.length + ' places'
    );
    const n0 = B.count(),
      put = K.props.assign(S, K.props.starter, f1, { stone: { r: [1, 2, 3] }, leaf: { r: [5, 6, 7] } });
    ok(
      'props: a library puts only the things whose materials it was given, and they are made',
      put.length === f1.length && put.every(d => ['pebble', 'stones', 'tuft'].includes(d.key)) && B.count() >= n0,
      put.map(d => d.key).join(' ')
    );
    // paint-over: a decal handed to the builder is one more dab, of its colour, just in front of where it was painted
    const B2 = A.makeBuilder(7, PALx),
      c0 = B2.count();
    globalThis.INK_DECAL_NEXT = [[0.5, 1, -0.25, 0, 0, 1, 8]];
    const W2 = B2.finish({ detail: 20 });
    ok(
      'paint: a decal becomes one dab of its palette colour, pinned where it was painted',
      W2.count === c0 + 1 &&
        Math.abs(W2.data[2] + 0.25 - 0.3 / 20) < 1e-4 &&
        W2.data[7] === 0x70 * 65536 + 0xd8 * 256 + 0xb0 &&
        !globalThis.INK_DECAL_NEXT,
      W2.count + ' dabs'
    );
  }
  // ---- the sandbox (kq-sandbox): matter in a grid
  {
    const SB = K.sandbox,
      run = (sim, n) => {
        for (let i = 0; i < n; i++) sim.step();
      },
      room = () => {
        const g = SB.grid({ at: [0, 0, 0], size: [3, 2, 3], cell: 0.1, seed: 3 });
        g.box([0, 0, 0], [3, 0.3, 3], 'stone');
        return g;
      };
    {
      const g = room();
      g.box([0.2, 0.3, 0.2], [1.2, 0.6, 1.2], 'lava');
      g.box([0.2, 1.2, 0.2], [1.0, 1.5, 1.0], 'water');
      g.box([1.8, 0.3, 1.8], [2.6, 0.9, 2.6], 'ice');
      const sim = SB(g.spec());
      let steam = 0;
      for (let i = 0; i < 12; i++) {
        run(sim, 10);
        steam = Math.max(steam, sim.count('steam'));
      }
      ok(
        'sandbox: water on lava makes steam and stone',
        sim.count('basalt') > 50 && steam > 40,
        sim.count('basalt') + ' stone, ' + steam + ' steam at most'
      );
      const ice0 = sim.count('ice');
      sim.cast('flame', [2.2, 1.0, 2.2]);
      run(sim, 120);
      ok(
        'sandbox: fire melts ice into water that runs off',
        sim.count('ice') < ice0 && sim.count('water') > 0,
        ice0 + ' -> ' + sim.count('ice')
      );
    }
    {
      const g = room();
      g.box([0.2, 0.3, 0.2], [2.8, 0.6, 2.8], 'water');
      g.box([0.2, 0.6, 0.2], [2.8, 0.7, 2.8], 'oil');
      const sim = SB(g.spec());
      run(sim, 30);
      const w0 = sim.count('water'),
        o0 = sim.count('oil');
      sim.cast('flame', [0.6, 0.7, 0.6]);
      let blaze = 0;
      for (let i = 0; i < 30; i++) {
        run(sim, 10);
        blaze = Math.max(blaze, sim.count('blaze'));
      }
      ok(
        'sandbox: an oil slick burns right across the water it floats on, and the water is still there',
        o0 > 500 && sim.count('oil') < o0 * 0.1 && blaze > o0 * 0.5 && sim.count('water') > w0 * 0.8,
        'oil ' + o0 + ' -> ' + sim.count('oil') + ', water ' + w0 + ' -> ' + sim.count('water')
      );
    }
    {
      const g = room();
      g.box([1.3, 0.3, 1.3], [1.7, 1.6, 1.7], 'water');
      const sim = SB(g.spec());
      run(sim, 400);
      let lone = 0,
        all = 0;
      for (let z = 0.05; z < 3; z += 0.1)
        for (let x = 0.05; x < 3; x += 0.1) {
          const q = sim.at([x, 0.35, z]);
          if (!q || q.name !== 'water') continue;
          all++;
          if (
            ![
              [0.1, 0],
              [-0.1, 0],
              [0, 0.1],
              [0, -0.1]
            ].some(d => (sim.at([x + d[0], 0.35, z + d[1]]) || {}).name === 'water')
          )
            lone++;
        }
      ok(
        'sandbox: spilt water spreads into one puddle, not scattered drops',
        all > 150 && lone < all * 0.03,
        lone + ' alone of ' + all
      );
    }
    {
      const g = room();
      g.box([0, 1.85, 0], [3, 2, 3], 'stone');
      g.box([1.0, 0.3, 1.0], [2.0, 0.5, 2.0], 'water');
      g.heater({ at: [1.5, 0.35, 1.5], r: 0.6, temp: 400, rate: 0.3 });
      const sim = SB(g.spec());
      run(sim, 300);
      let high = 0,
        low = 0;
      for (let z = 0.05; z < 3; z += 0.1)
        for (let x = 0.05; x < 3; x += 0.1) {
          if ((sim.at([x, 1.75, z]) || {}).name === 'steam') high++;
          if ((sim.at([x, 1.0, z]) || {}).name === 'steam') low++;
        }
      ok(
        'sandbox: boiled water rises as steam and gathers under the lid',
        high > low && high > 20,
        high + ' under the lid, ' + low + ' halfway'
      );
    }
    {
      const g = room();
      g.box([1.0, 0.3, 1.0], [2.0, 0.6, 2.0], 'acid');
      const sim = SB(g.spec()),
        s0 = sim.count('stone');
      let fumes = 0;
      for (let i = 0; i < 30; i++) {
        run(sim, 10);
        fumes = Math.max(fumes, sim.count('fumes'));
      }
      ok(
        'sandbox: acid eats the stone under it and gives off fumes',
        sim.count('stone') < s0 && fumes > 5,
        s0 - sim.count('stone') + ' eaten, ' + fumes + ' fumes at most'
      );
    }
    {
      const g = room();
      g.box([1.2, 0.3, 1.2], [1.8, 0.6, 1.8], 'powder');
      g.box([0.2, 0.3, 0.2], [2.8, 0.5, 0.6], 'sand');
      const sim = SB(g.spec());
      run(sim, 10);
      sim.cast('flame', [1.5, 0.65, 1.5]);
      let flew = 0;
      for (let i = 0; i < 60; i++) {
        sim.step();
        flew = Math.max(flew, sim.stats().flying);
      }
      const b = sim.blasts();
      ok(
        'sandbox: black powder, lit, blows up, throws what is loose, and says so',
        sim.count('powder') < 20 && flew > 50 && b.length >= 6,
        b.length / 6 + ' blasts, ' + flew + ' flying'
      );
    }
    {
      // the scene's own solids: real stone to the grid, drawn by the scene until something happens to them
      const g = SB.grid({ at: [0, 0, 0], size: [2, 1, 2], cell: 0.1 }),
        sdf = (x, y) => y - 0.3;
      g.walls(sdf, { as: (x, y, z) => (x < 1 ? 'stone' : 'wall') });
      const spec = g.spec(),
        sim = SB(spec),
        blk = new Float32Array(4096 * 16);
      sim.draw(blk, 4096);
      let drawn = 0;
      for (let s = 0; s < 4096; s++) if (blk[s * 16 + 3] > 0) drawn++;
      ok(
        "sandbox: the scene's solids are the grid's but not drawn by it",
        sim.count('stone') > 100 && drawn === 0,
        sim.count('stone') + ' stone, ' + drawn + ' drawn'
      );
      sim.explode([0.5, 0.3, 1], 0.35, 4);
      run(sim, 5);
      const u = sim.uncovered();
      sim.draw(blk, 4096);
      drawn = 0;
      for (let s = 0; s < 4096; s++) if (blk[s * 16 + 3] > 0) drawn++;
      sim.explode([1.5, 0.3, 1], 0.35, 4);
      run(sim, 5);
      let walls = 0;
      for (let k = 0; k < 9; k++) if ((sim.at([1.3 + k * 0.05, 0.25, 1]) || { name: 'x' }).name === 'wall') walls++;
      ok(
        'sandbox: a blast hands the hole over to the grid, which draws its sides; wall stays wall',
        u.length > 20 && drawn > 20 && walls === 9,
        u.length + ' handed over, ' + drawn + ' drawn'
      );
      // and on a world: the scene's splats over the hole are put away, and come back when the grid starts again
      const N0 = 600,
        D = new Float32Array(N0 * 16);
      for (let i = 0; i < N0; i++) {
        D[i * 16] = 0.05 + (i % 20) * 0.1;
        D[i * 16 + 1] = 0.3;
        D[i * 16 + 2] = 0.05 + Math.floor(i / 20) * 0.1;
        D[i * 16 + 3] = 3;
      }
      const W = { data: D, count: N0, sandbox: spec };
      SB.attach(W, { budget: Infinity });
      const st = W.anim;
      let blasts = 0;
      st.sandbox.onBlast(() => blasts++);
      st.update(1 / 30, 0);
      st.sandbox.cast('nova', [0.5, 0.35, 1]);
      st.sandbox.cast('fist', [0.5, 0.35, 1]);
      for (let k = 1; k < 20; k++) st.update(1 / 30, k / 30);
      let gone = 0;
      for (let i = 0; i < N0; i++) if (W.data[i * 16 + 3] === 0) gone++;
      st.dispose();
      let back = 0;
      for (let i = 0; i < N0; i++) if (W.data[i * 16 + 3] === 3) back++;
      ok(
        "sandbox: attached, a blow puts away the scene's splats over the hole, tells who listens, and they come back",
        gone > 0 && blasts > 0 && back === N0,
        gone + ' put away, ' + blasts + ' blasts'
      );
    }
    {
      const mk = () => {
        const g = room();
        g.box([0.2, 0.3, 0.2], [1.2, 0.8, 1.2], 'sand');
        g.box([1.5, 1.0, 1.5], [2.5, 1.5, 2.5], 'water');
        return SB(g.spec());
      };
      const a = mk(),
        b = mk();
      run(a, 100);
      run(b, 100);
      a.cast('nova', [0.7, 0.9, 0.7]);
      b.cast('nova', [0.7, 0.9, 0.7]);
      run(a, 60);
      run(b, 60);
      ok(
        'sandbox: the same seed runs the same',
        a.count('sand') === b.count('sand') &&
          a.count('water') === b.count('water') &&
          a.stats().flying === b.stats().flying
      );
    }
  }
  console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed');
  return fails;
};
