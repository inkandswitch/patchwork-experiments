/* kl-vox: shapes typed in, a block at a time. For the small exact things that are clumsy to sculpt: an emblem on a cover, teeth, a rune, a buckle.
   A model is a pile of little pictures made of letters. Every letter is a material; '.' (or a space) is nothing.
     const BOOK = { cell: 0.06, key: { c: [2, 3, 4], p: [10, 11], g: { r: [8, 9], gloss: { c: 9 } } },
       layers: [ ['cccc', 'cccc', 'cccc'],            a plan of the lowest layer: rows run from the back to the front, letters from left to right
                 [['cppp', 'cppp', 'cppp'], 3],       [plan, n]: the same plan n layers running
                 'cccc/cgcc/cccc' ] }                 a plan may also be one string, rows parted by '/'
     or  front: [ rows, [rows, n], ... ]               pictures seen from the front instead, the first nearest you: rows run from the top down
     mirror: 'x'    each row is half a row: it is finished with itself the other way round ('xo': an odd width, the middle letter not doubled)
     cell: 0.06 or [x, y, z]     how big one block is (a different height makes squashed or stretched layers)
     hard: true                  keep the blocks as blocks: flat faces and square corners (round: 0..0.45 then softens the outside edges a little)
   Unless hard is asked for, the blocks are only where the stuff is. What is made of them is one soft solid, the way a thing sculpted
   from balls is soft: faces stay where they were typed, corners and steps are rounded over, a stair of blocks becomes a slope, a hole one
   block deep becomes a dimple. The letters still say what each part is made of, so what was typed small stays as sharp as it was typed.
   S.vox(model, { at: [x, y, z], yaw, ax, anchor: 'base' | 'centre', cell, round, res, and anything a solid takes: tag, whole, ghost, neg, k, g })
   Either way they are not drawn as blocks. They become one solid with a distance (so it lights, shadows, melts into its neighbours in a
   group, can be cut out of something with neg, can be broken, and is walked on, like anything else sculpted), and that is what is splatted.
   Each letter keeps its own material, so one can glow, one can shine and one can grow fur.  VOX.parse(model) -> { nx, ny, nz, grid, keys } */
const VOX = (() => {
  const memo = new WeakMap();
  const parse = spec => {
    let M = memo.get(spec);
    if (M) return M;
    const src = spec.front || spec.layers,
      front = !!spec.front,
      lay = [];
    if (!src) throw new Error('vox: a model needs layers or front');
    const rowsOf = e =>
      (typeof e === 'string' ? e.split(/[\/\n]/) : e).map(r => {
        r = r.replace(/\s+$/, '');
        return spec.mirror === 'x'
          ? r + r.split('').reverse().join('')
          : spec.mirror === 'xo'
            ? r + r.split('').reverse().join('').slice(1)
            : r;
      });
    for (const e of src) {
      const rep = Array.isArray(e) && typeof e[1] === 'number',
        n = rep ? e[1] : 1,
        rows = rowsOf(rep ? e[0] : e);
      for (let i = 0; i < n; i++) lay.push(rows);
    }
    const cols = Math.max(...lay.map(L => Math.max(...L.map(r => r.length)))),
      rws = Math.max(...lay.map(L => L.length)),
      nx = cols,
      ny = front ? rws : lay.length,
      nz = front ? lay.length : rws;
    const keys = Object.keys(spec.key || {}),
      grid = new Uint8Array(nx * ny * nz);
    lay.forEach((L, li) =>
      L.forEach((row, ri) => {
        for (let ci = 0; ci < row.length; ci++) {
          const ch = row[ci];
          if (ch === '.' || ch === ' ') continue;
          const k = keys.indexOf(ch);
          if (k < 0) throw new Error("vox: the letter '" + ch + "' is not in the model's key");
          const x = ci,
            y = front ? ny - 1 - ri : li,
            z = front ? nz - 1 - li : ri;
          grid[(x * ny + y) * nz + z] = k + 1;
        }
      })
    );
    M = { nx, ny, nz, grid, keys };
    memo.set(spec, M);
    return M;
  };
  const add = (local, S, spec, o) => {
    o = o || {};
    const M = parse(spec),
      { nx, ny, nz, grid, keys } = M,
      cl = o.cell || spec.cell || 0.1,
      cx = cl.length ? cl[0] : cl,
      cy = cl.length ? cl[1] : cl,
      cz = cl.length ? cl[2] : cl,
      cm = Math.min(cx, cy, cz);
    const hard = o.hard === undefined ? !!spec.hard : !!o.hard,
      r = hard ? Math.max(0, Math.min(0.45, o.round === undefined ? spec.round || 0 : o.round)) * cm : 0,
      ISO = 0.4,
      hx = (nx * cx) / 2,
      hy = (ny * cy) / 2,
      hz = (nz * cz) / 2,
      yaw = o.yaw || 0,
      ax =
        o.ax ||
        (yaw
          ? [
              [Math.cos(yaw), 0, -Math.sin(yaw)],
              [0, 1, 0],
              [Math.sin(yaw), 0, Math.cos(yaw)]
            ]
          : null);
    const at = o.at || [0, 0, 0],
      V = ax ? ax[1] : [0, 1, 0],
      c = o.anchor === 'centre' ? at : [at[0] + V[0] * hy, at[1] + V[1] * hy, at[2] + V[2] * hy],
      res = o.res || spec.res || Math.max(0.02, Math.min(S.res, cm * 0.7));
    const G = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : grid[(x * ny + y) * nz + z]);
    // how far a place is from the whole model, and which letter is nearest it. (One answer is kept: every letter's solid asks about the same place in turn.)
    let qx = NaN,
      qy = NaN,
      qz = NaN,
      qd = 0,
      qk = 0;
    const W = 2;
    // soft: every full block is a soft lump (a quadratic bell three blocks wide each way) and the lumps are added up. Where the sum passes ISO is the
    // skin: on a flat face that is where the face was typed, give or take a tenth of a block; a single block is a small round thing
    const bell = t => {
      t = Math.abs(t);
      return t < 0.5 ? 0.75 - t * t : t < 1.5 ? 0.5 * (1.5 - t) * (1.5 - t) : 0;
    };
    const askSoft = (x, y, z) => {
      const ox = Math.max(Math.abs(x) - hx, 0),
        oy = Math.max(Math.abs(y) - hy, 0),
        oz = Math.max(Math.abs(z) - hz, 0),
        out = Math.hypot(ox, oy, oz);
      if (out > 1.5 * cm) {
        qd = out - 0.7 * cm;
        qk = 0;
        return;
      }
      const fx = (x + hx) / cx - 0.5,
        fy = (y + hy) / cy - 0.5,
        fz = (z + hz) / cz - 0.5,
        ix = Math.round(fx),
        iy = Math.round(fy),
        iz = Math.round(fz);
      let f = 0,
        bw = 0,
        bk = 0;
      for (let a = ix - 1; a <= ix + 1; a++) {
        const wa = bell(fx - a);
        if (!wa) continue;
        for (let b = iy - 1; b <= iy + 1; b++) {
          const wb = wa * bell(fy - b);
          if (!wb) continue;
          for (let e = iz - 1; e <= iz + 1; e++) {
            const k = G(a, b, e);
            if (!k) continue;
            const w = wb * bell(fz - e);
            f += w;
            if (w > bw) {
              bw = w;
              bk = k;
            }
          }
        }
      }
      qd = (ISO - f) * 2 * cm;
      qk = bk;
    };
    const ask = (x, y, z) => {
      if (x === qx && y === qy && z === qz) return;
      qx = x;
      qy = y;
      qz = z;
      if (!hard) return askSoft(x, y, z);
      const ox = Math.max(Math.abs(x) - hx, 0),
        oy = Math.max(Math.abs(y) - hy, 0),
        oz = Math.max(Math.abs(z) - hz, 0),
        out = Math.hypot(ox, oy, oz);
      if (out > W * cm) {
        qd = out - r;
        qk = 0;
        return;
      } // well outside: the box round it will do
      const fx = (x + hx) / cx,
        fy = (y + hy) / cy,
        fz = (z + hz) / cz,
        ix = Math.floor(fx),
        iy = Math.floor(fy),
        iz = Math.floor(fz),
        me = G(ix, iy, iz);
      let best = 1e9,
        bk = 0;
      for (let a = ix - W; a <= ix + W; a++)
        for (let b = iy - W; b <= iy + W; b++)
          for (let e = iz - W; e <= iz + W; e++) {
            const k = G(a, b, e);
            if (me ? k : !k) continue; // inside, look for the nearest empty block; outside, the nearest full one
            const dx = Math.max(a - fx, 0, fx - a - 1) * cx,
              dy = Math.max(b - fy, 0, fy - b - 1) * cy,
              dz = Math.max(e - fz, 0, fz - e - 1) * cz,
              d = dx * dx + dy * dy + dz * dz;
            if (d < best) {
              best = d;
              bk = k;
            }
          }
      best = best > 1e8 ? W * cm : Math.sqrt(best);
      if (me) {
        qd = -best - r;
        qk = me;
      } else {
        qd = Math.max(best, out) - r;
        qk = bk;
      }
    };
    let js = 12345;
    const jit = () => {
      js = (js * 1103515245 + 12345) & 0x7fffffff;
      return 0.15 + (0.7 * js) / 0x7fffffff;
    }; // (always the same for the same model)
    const FACES = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ],
      C = [cx, cy, cz],
      H = [hx, hy, hz],
      pass = {};
    for (const k of ['tag', 'whole', 'ghost', 'neg', 'k', 'g', 'hold', 'bump', 'reach'])
      if (o[k] !== undefined) pass[k] = o[k];
    return keys
      .map((ch, ki) => {
        const id = ki + 1,
          m = spec.key[ch],
          mat = typeof m === 'number' ? { r: [m] } : m;
        let any = false;
        for (let i = 0; i < grid.length && !any; i++) any = grid[i] === id;
        if (!any) return null;
        return local(
          c,
          Math.hypot(hx, hy, hz) + r,
          (x, y, z) => {
            ask(x, y, z);
            return qk === id || qk === 0 ? qd : qd + 0.3 * cm;
          },
          (rs, f) => {
            for (let x = 0; x < nx; x++)
              for (let y = 0; y < ny; y++)
                for (let z = 0; z < nz; z++) {
                  if (grid[(x * ny + y) * nz + z] !== id) continue;
                  const lo = [x * cx - hx, y * cy - hy, z * cz - hz];
                  for (const d of FACES) {
                    if (G(x + d[0], y + d[1], z + d[2])) continue;
                    const a = d[0] ? 1 : 0,
                      u = d[0] ? 1 : d[1] ? 2 : 0,
                      v = d[0] ? 2 : d[1] ? 0 : 1,
                      w = d[0] ? 0 : d[1] ? 1 : 2,
                      nu = Math.max(1, Math.ceil(C[u] / rs)),
                      nv = Math.max(1, Math.ceil(C[v] / rs)),
                      p = [0, 0, 0];
                    p[w] = lo[w] + (d[w] > 0 ? C[w] + r : -r);
                    for (let i = 0; i < nu; i++)
                      for (let j = 0; j < nv; j++) {
                        p[u] = lo[u] + ((i + (hard ? 0.5 : jit())) / nu) * C[u];
                        p[v] = lo[v] + ((j + (hard ? 0.5 : jit())) / nv) * C[v];
                        f(p[0], p[1], p[2]);
                      }
                  }
                }
          },
          mat,
          Object.assign({ res, ax: ax || undefined }, hard ? {} : { reach: 0.45 * cm }, pass)
        );
      })
      .filter(Boolean);
  };
  return {
    parse,
    add,
    size: (spec, cell) => {
      const M = parse(spec),
        cl = cell || spec.cell || 0.1,
        q = cl.length ? cl : [cl, cl, cl];
      return [M.nx * q[0], M.ny * q[1], M.nz * q[2]];
    }
  };
})();
KIT.vox = VOX;
