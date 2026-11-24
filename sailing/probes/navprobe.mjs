// Navmesh checks for the browser probes (sailing-run.mjs, camber-run.mjs):
// what walk baked of her from the stage, checked in the page.
//
// - staticChecks: C1–C9 (walk's navcheck.js) over a ship's bake input as
//   walk's adapter reads it from the stage (her GLBs as loaded, her walk.*
//   traits), seed-pruned (walk bakes prune: false until its pruning by
//   passable sides lands: walk/DESIGN.md, Decision 29), and walk's own mesh
//   of her holding every cell of it: as walk's deck-12m.test.js does on the
//   exported sloop.
// - watchWalk / walkReport: every frame of a walk, the walker's invariant
//   asserted (__WALK_ASSERT__ on: a breach throws in walk's loop and is
//   logged, counted here), the mode, and the feet against ship.js's
//   analytic surfaces.
// The page imports walk's and sailing's src modules for this (served from
// the repo root), beside the built dist the views run: a dev tool, nothing
// is shared but data.

/** C1–C9 over `ship`'s mesh in view `w` (`kind` "sloop" adds C8). */
export const staticChecks = (js, w, ship, kind = "sloop") =>
  js(
    `(async () => {
      const nc = await import('/walk/src/navcheck.js');
      const nm = await import('/walk/src/navmesh.js');
      const { bakeInput } = await import('/walk/src/supports.js');
      const { BODY } = await import('/walk/src/walk.js');
      const api = window.__p.api('${w}') ?? window.__p.api('sailing'); // (camber-probe's api takes an extension id)
      const own = window.__p.live('${w}')?.env.mesh('${ship}');
      const full = api ? bakeInput(api, '${ship}') : null;
      if (!own || !full) return { ok: false, why: 'no mesh' };
      const input = { triangles: full.triangles, seeds: full.seeds };
      const t0 = performance.now();
      const mesh = nm.bake(input, BODY);
      const bakeMs = performance.now() - t0;
      const r = nc.staticChecks(mesh, input.triangles, {
        seeds: input.seeds,
        railed: '${kind}' === 'sloop',
        rebake: (p) => nm.bake(input, p),
        shuffled: () => nm.bake({ ...input, triangles: nc.shuffleTriangles(input.triangles, 7) }, BODY),
      });
      const checks = {};
      for (const [k, v] of Object.entries(r.checks)) checks[k] = { ok: v.ok, detail: JSON.stringify(v.detail).slice(0, 500) };
      // a cell is its column (x, z: exact multiples of the cell size) and its floor's height there; the two bakes
      // are the same function of the same triangles, so a height is the same to well under a millimetre, and
      // keying it rounded would split a tie at a rounding edge: heights are compared within 1 mm instead
      const col = (p) => Math.round(p[0] * 1e4) + ',' + Math.round(p[2] * 1e4);
      const ys = new Map();
      for (let a = 0; a < own.count; a++) { const p = nm.pointOf(own, a, 0.5, 0.5); const k = col(p); ys.set(k, [...(ys.get(k) ?? []), p[1]]); }
      const lostAt = [];
      for (let a = 0; a < mesh.count; a++) {
        const p = nm.pointOf(mesh, a, 0.5, 0.5);
        const near = ys.get(col(p)) ?? [];
        if (!near.some((y) => Math.abs(y - p[1]) <= 1e-3)) lostAt.push({ at: p.map((v) => +v.toFixed(4)), own: near.map((v) => +v.toFixed(4)) });
      }
      const lost = lostAt.length;
      checks["walk's own mesh holds every cell"] = { ok: lost === 0, detail: JSON.stringify({ lost, own: own.count, pruned: mesh.count, lostAt: lostAt.slice(0, 5) }) };
      return { ok: r.ok && lost === 0, cells: mesh.count, own: own.count, triangles: input.triangles.length / 9, links: mesh.links.map((l) => l.kind + (l.id ? ' ' + l.id : '')), at: mesh.links.map((l) => [l.kind, l.asked.map((v) => +v.toFixed(2)), nm.pointOf(mesh, l.at.cell, l.at.u, l.at.v).map((v) => +v.toFixed(2))]), bakeMs: Math.round(bakeMs), checks };
    })()`,
    240_000,
  );

/**
 * Watch every frame of view `w`'s crew from now: the walker asserted, its
 * mode, and (on `ship`, the stock sloop) the feet against her analytic
 * surfaces: within 2 cm of the deck, the sole, a bench or a coaming's top,
 * or over one of them in the air.
 */
export const watchWalk = (js, w, ship) =>
  js(`(async () => {
    const S = await import('/sailing/src/ship.js');
    const crew = window.__p.ctx('${w}').crew;
    const live = window.__p.live('${w}');
    const M = (window.__walkMon = { frames: 0, asserts: [], off: [], modes: {}, visited: {}, worst: 0, orig: crew.tick, warn: console.warn, error: console.error });
    globalThis.__WALK_ASSERT__ = true;
    // a breach throws in walk's loop, which the stage logs
    const caught = (f) => (...a) => { const t = a.map(String).join(' '); if (/walker invariant|\[walk\]/.test(t)) M.asserts.push(t.slice(0, 240)); return f.apply(console, a); };
    console.warn = caught(M.warn);
    console.error = caught(M.error);
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    crew.tick = (dt) => {
      try { M.orig(dt); } catch (e) { M.asserts.push(String(e?.message ?? e).slice(0, 240)); }
      const me = crew.me();
      const st = live?.state();
      if (!me.playing || !st) return;
      M.frames++;
      M.modes[st.mode] = (M.modes[st.mode] ?? 0) + 1;
      if (me.on !== '${ship}') return;
      const [x, y, z] = me.position;
      const ax = Math.abs(x);
      const s = [S.deckAt(x, z)];
      // each surface where it lies, give or take a cell (the mesh's boundaries are its 5 cm columns)
      const c = 0.05;
      const well = ax <= 0.8 + c && z >= 1.95 - c && z <= 5.15 + c;
      if (well) s.push(0.72);
      if (well && ax >= 0.38 - c && z <= 3.75 + c) s.push(1.08);
      if (ax >= 0.78 - c && ax <= 0.86 + c && z <= 4.1 + c) s.push(S.deckAt(x, z) + 0.2 * smooth(4.1, 3.5, z));
      const d = Math.min(...s.map((v) => Math.abs(y - v)));
      const air = st.mode === 'airborne' || st.mode === 'vaulting';
      const ok = d <= 0.02 || (air && s.some((v) => y >= v - 0.02));
      if (!air) M.worst = Math.max(M.worst, d);
      if (!ok && M.off.length < 20) M.off.push({ mode: st.mode, at: [x, y, z].map((v) => +v.toFixed(3)), d: +d.toFixed(3) });
      if (!air && d <= 0.02) {
        const where = well && Math.abs(y - 0.72) < 0.03 ? 'sole' : well && Math.abs(y - 1.08) < 0.03 ? 'bench' : z > 5.15 ? 'aft deck' : ax > 0.85 ? 'side deck' : 'deck';
        if (where === 'side deck') M.visited[x > 0 ? 'starboard' : 'port'] = (M.visited[x > 0 ? 'starboard' : 'port'] ?? 0) + 1;
        M.visited[where] = (M.visited[where] ?? 0) + 1;
      }
      if (air) M.visited.air = (M.visited.air ?? 0) + 1;
    };
    return true;
  })()`);

/** Stop watching; what was seen. */
export const walkReport = (js, w) =>
  js(`(() => {
    const M = window.__walkMon;
    const crew = window.__p.ctx('${w}').crew;
    crew.tick = M.orig; // the page keeps asserting (it sets the flag for every walker step)
    console.warn = M.warn;
    console.error = M.error;
    return { frames: M.frames, asserts: M.asserts, off: M.off, modes: M.modes, visited: M.visited, worst: +M.worst.toFixed(4) };
  })()`);
