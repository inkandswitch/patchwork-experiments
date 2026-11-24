/* kn-effects: four things that already existed, each given one name and one way in, and sunlight through a canopy (K.dapple).
   They were written where they were first needed (a cathedral, a pond, the game's breaking, a character's death). Nothing about how they
   look has changed; this is where to find them.

   K.windowLight(o)   light through a window, as the cathedral has it. o: { at: [x, y, z] the middle of the window (it stands square to z),
                      dir: the way its light travels, pane(u, v): the palette colour of the glass u across and v up from the middle, 0 for
                      lead or stone, clear: how far behind the window the light begins (0.3) }. Gives back three parts of the one effect:
                        .beam(x, y, z)       the pane whose light falls at a place, or 0
                        .lit                 a material's tex: surfaces facing up enough take the pane's colour where the light lands
                        .lamp(far, s)        the lamp to push onto S.lights, far back along the light, casting shadows
                        .air(r, cols, k)     what to give the finished world as .glass, so the page draws the light in the air itself
   K.dapple(o)        sunlight coming down through gaps, in a canopy or a broken roof, as shafts you can see in the air and patches
                      where they land. o: { sun: the way to the sun, y: the height of the gaps, gaps: [[x, z, r], ...] where they are on
                      that level (or at: [x, z], r, n, size: [r0, r1], seed to scatter n of them over a round canopy), cover(x, z): what is
                      under the canopy, where it is not open sky (a round one of r about at, if not given), under: how much sun gets
                      through under it away from the gaps (0.2), floor: the shafts fade out toward this height (-50), bound: [x, z, r]
                      the stand they are on (they fade out toward its edge; four times the canopy's r, if not given) }
                        .lit(x, y, z)        1 where a shaft falls on a place, otherwise 0
                        .mask(x, y, z)       for S.mask: 1 in a shaft or out in the open, o.under in the shade of the canopy
                        .motes(B, n, cols, o)    dust drifting in the shafts, lit by them (o.size, o.k: 6 bobs, 3 rises)
                        .air(cols, k, steps) what to give the finished world as .glass: the page draws every shaft in the air (cols:
                                             six palette colours, one a shaft, k strength, steps: banded into that many levels a unit)
   K.reflect(B, o)    things standing over still water, seen in it. o: { y: the water's height, where(x, z): where there is water,
                      colours: { palette colour above: the colour of its reflection }, gap, maxH }. Before B.finish, after everything
                      that is to be reflected.
   K.shatter(B, n)    loose pieces for whatever gets broken: n spare splats. .burst(list, centre, power, floor, cols) throws the splats
                      in list outward where they stand; .fall(list, pivot, angle, floor, cols, len) topples them over like a felled
                      trunk and smashes them where they land. (The game carves the hole first: stream.carve gives the list.)
   K.dissolve.at(i, t, nx, nz, out)   a body coming apart into its own splats: where splat i has got to at time t (0 to about 0.9), given
                      which way its surface faces across the ground. out: [dx, dy, dz, how much of its size is left]. Run backwards it
                      is an arrival. This is what every character does when it is defeated and when it is summoned. */
(function (K) {
  K.windowLight = o => {
    const WC = o.at,
      D = o.dir,
      clear = o.clear === undefined ? 0.3 : o.clear,
      beam = (x, y, z) => {
        const t = (z - WC[2]) / D[2];
        if (t <= clear) return 0;
        return o.pane(x - D[0] * t - WC[0], y - D[1] * t - WC[1]);
      };
    return {
      beam,
      lit: (x, y, z, ny) => {
        if (ny < 0.3) return undefined;
        const c = beam(x, y, z);
        return c ? c : undefined;
      },
      lamp: (far, s) => ({
        p: [WC[0] - D[0] * far, WC[1] - D[1] * far, WC[2] - D[2] * far],
        r: far * 2.8,
        s,
        sh: true
      }),
      air: (r, cols, k) => ({ at: WC, r, dir: D, cols, k })
    };
  };
  K.dapple = o => {
    const sun = K.V.norm(o.sun),
      D = [-sun[0], -sun[1], -sun[2]],
      Y = o.y,
      under = o.under === undefined ? 0.2 : o.under,
      at = o.at || [0, 0],
      R = o.r || 3,
      cover = o.cover || ((x, z) => Math.hypot(x - at[0], z - at[1]) < R);
    let gaps = o.gaps;
    if (!gaps) {
      gaps = [];
      const sz = o.size || [0.25, 0.55],
        seed = o.seed || 1;
      for (let i = 0, tries = 0; gaps.length < (o.n || 8) && tries < 400; tries++, i++) {
        const a = K.hash(seed, i, 1) * Math.PI * 2,
          q = Math.sqrt(K.hash(seed, i, 2)) * R * 0.85,
          g = [at[0] + Math.cos(a) * q, at[1] + Math.sin(a) * q, sz[0] + (sz[1] - sz[0]) * K.hash(seed, i, 3)];
        if (gaps.every(h => Math.hypot(h[0] - g[0], h[1] - g[1]) > h[2] + g[2] + 0.15)) gaps.push(g);
      }
    }
    /* a place is in a shaft when it lies within the gap's radius of the line the light takes through the gap's middle */
    const within = (x, y, z) => {
      if (y > Y) return -1;
      for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i],
          px = x - g[0],
          py = y - Y,
          pz = z - g[1],
          s = px * D[0] + py * D[1] + pz * D[2],
          qx = px - D[0] * s,
          qy = py - D[1] * s,
          qz = pz - D[2] * s;
        if (qx * qx + qy * qy + qz * qz < g[2] * g[2]) return i;
      }
      return -1;
    };
    /* where under the canopy a place is: follow the light back up to the gaps' level */
    const shaded = (x, y, z) => {
      if (y > Y) return false;
      const t = (Y - y) / sun[1];
      return cover(x + sun[0] * t, z + sun[2] * t);
    };
    return {
      gaps,
      dir: D,
      lit: (x, y, z) => (within(x, y, z) >= 0 ? 1 : 0),
      mask: (x, y, z) => (within(x, y, z) >= 0 || !shaded(x, y, z) ? 1 : under),
      motes(B, n, cols, mo) {
        mo = mo || {};
        const size = mo.size || 0.022,
          k = mo.k === undefined ? 6 : mo.k,
          low = mo.low === undefined ? 0 : mo.low;
        for (let i = 0, made = 0; made < n && i < n * 40; i++) {
          const g = gaps[Math.floor(B.rr(0, gaps.length))],
            s = (B.rr(0.3, 1) * (Y - low)) / -D[1],
            a = B.rr(0, Math.PI * 2),
            q = Math.sqrt(B.rr(0, 1)) * g[2] * 0.9,
            x = g[0] + D[0] * s + Math.cos(a) * q,
            y = Y + D[1] * s,
            z = g[1] + D[2] * s + Math.sin(a) * q;
          if (within(x, y, z) < 0) continue;
          made++;
          const c = B.P[cols[Math.floor(B.rr(0, cols.length))]];
          B.iso(x, y, z, size, c, 3, {
            em: true,
            nd: true,
            k,
            ph: B.rr(0, 6.3),
            sp: k === 3 ? B.rr(0.05, 0.12) : B.rr(0.4, 1.1),
            rg: k === 3 ? B.rr(0.6, 1.4) : B.rr(0.03, 0.09),
            ex: 0
          });
        }
      },
      air: (cols, k, steps) => ({
        mode: 'gaps',
        gaps: gaps.map(g => [g[0], Y, g[1], g[2]]),
        dir: D,
        floor: o.floor === undefined ? -50 : o.floor,
        cols,
        k: k === undefined ? 0.5 : k,
        steps: steps || 0,
        at: o.bound ? [o.bound[0], Y, o.bound[1]] : [at[0], Y, at[1]],
        r: o.bound ? o.bound[2] : R * 4
      })
    };
  };
  K.reflect = (B, o) => B.mirror(o.y || 0, o.where || (() => true), o.colours, { gap: o.gap, maxH: o.maxH });
  K.shatter = (B, n) => K.play.debris(B, n);
  K.dissolve = {
    at(i, t, nx, nz, out) {
      const h1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1,
        h2 = Math.abs(Math.sin(i * 78.233) * 12543.123) % 1,
        v = 1.2 + 3.2 * h1,
        ang = h2 * 6.283185307179586;
      out[0] = (nx * 0.6 + Math.cos(ang) * 0.5) * v * t;
      out[1] = (1.5 + 3 * h1) * t - 9 * t * t;
      out[2] = (nz * 0.6 + Math.sin(ang) * 0.5) * v * t;
      out[3] = Math.max(0, 1 - t / (0.45 + 0.45 * h2));
      return out;
    }
  };
})(KIT);
