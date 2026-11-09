// Navmesh checks for the browser probes (sailing-run.mjs, camber-run.mjs):
// what the crew baked from the stage, checked in the page.
//
// - staticChecks: C1–C9 (navcheck.js) over a ship's mesh as the page's crew
//   baked it, from the triangles it gathered from her GLBs as loaded (not
//   ship.js's): the same checks sloop-navmesh.test.js runs on ship.js's.
// - watchWalk / walkReport: every frame of a walk, the walker's invariant
//   asserted (__SAILING_ASSERT__ on: a breach throws in the crew's tick and is
//   counted), the mode, and the feet against ship.js's analytic surfaces.
// The page imports sailing's own src modules for this (served from the repo
// root), beside the built dist the views run: a dev tool, nothing is shared
// but data.

/** C1–C9 over `ship`'s mesh in view `w` (`kind` "sloop" adds C8). */
export const staticChecks = (js, w, ship, kind = "sloop") =>
  js(
    `(async () => {
      const nc = await import('/sailing/src/navcheck.js');
      const nm = await import('/sailing/src/navmesh.js');
      const { DECK } = await import('/sailing/src/walk.js');
      const n = window.__p.ctx('${w}').crew.nav('${ship}');
      if (!n?.mesh || !n.input) return { ok: false, why: 'no mesh' };
      const input = n.input;
      const t0 = performance.now();
      const again = nm.bake(input, DECK);
      const bakeMs = performance.now() - t0;
      const r = nc.staticChecks(n.mesh, input.triangles, {
        rebake: (p) => nm.bake(input, p),
        shuffled: () => nm.bake({ ...input, triangles: nc.shuffleTriangles(input.triangles, 7) }, DECK),
        ship: '${kind}',
      });
      const checks = {};
      for (const [k, v] of Object.entries(r.checks)) checks[k] = { ok: v.ok, detail: JSON.stringify(v.detail).slice(0, 500) };
      return { ok: r.ok, cells: n.mesh.count, again: again.count, triangles: input.triangles.length / 9, links: n.mesh.links.map((l) => l.kind + (l.id ? ' ' + l.id : '')), at: n.mesh.links.map((l) => [l.kind, l.asked.map((v) => +v.toFixed(2)), nm.pointOf(n.mesh, l.at.cell, l.at.u, l.at.v).map((v) => +v.toFixed(2))]), bakeMs: Math.round(bakeMs), checks };
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
    const M = (window.__walkMon = { frames: 0, asserts: [], off: [], modes: {}, visited: {}, worst: 0, orig: crew.tick });
    globalThis.__SAILING_ASSERT__ = true;
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    crew.tick = (dt) => {
      try { M.orig(dt); } catch (e) { M.asserts.push(String(e?.message ?? e).slice(0, 240)); }
      const me = crew.me();
      const st = crew.walker();
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
    return { frames: M.frames, asserts: M.asserts, off: M.off, modes: M.modes, visited: M.visited, worst: +M.worst.toFixed(4) };
  })()`);
