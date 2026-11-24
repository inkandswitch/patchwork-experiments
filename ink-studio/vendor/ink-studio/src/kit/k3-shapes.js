/* k3-shapes: more ways to make and combine solids, and the regular solids with a frame on every face.
     K.sculpt(S) adds to a sculpt toolkit:
       S.join(kind, a, b, o)   a and b are solids made with { hold: true } (or lists of them). kind is one of K.sdf.JOIN
       S.fold(p, spec, o)      one held solid repeated: { polar: n, axis, c } | { mirror: 'x', c } | { repeat: [dx, dy, dz], count: [i, j, k] }
       S.poly(c, planes, mat, o)   a convex solid from flat faces; o.rd rounds its edges
       S.regular(kind, c, r, mat, o)   'd4' 'd6' 'd8' 'd12' 'd20'; returns the solid with .faces = [{ c, n, u, v, r }]
       S.warp(p, { twist | bend | taper | map })   a held solid seen through bent space
       S.shell(p, t)  S.swell(p, r) (also S.inflate)  S.rough(p, fn, amp)  S.bubbles(p, { cell, h })   hollow skin, grown, rippled, bubble wrap
       S.puff(outline, c, height, mat, o)   a flat outline blown up like a cushion
       S.extrude(outline, c, depth, mat, o)  S.revolve(outline, c, mat, o)   flat outlines made solid; K.poly2.ngon/star/gear/rect/svg make outlines */
(function (K) {
  const V = K.V,
    SQ = Math.SQRT1_2,
    mod = (a, n) => a - n * Math.floor(a / n);
  const stairs = (a, b, r, n) => {
    const s = r / n,
      u = b - r;
    return Math.min(Math.min(a, b), 0.5 * (u + a + Math.abs(mod(u - a + s, 2 * s) - s)));
  };
  const columns = (a, b, r, n) => {
    if (!(a < r && b < r)) return Math.min(a, b);
    const cr = (r * Math.SQRT2) / ((n - 1) * 2 + Math.SQRT2);
    let px = (a + b) * SQ,
      py = (b - a) * SQ;
    px -= SQ * r;
    px += cr * Math.SQRT2;
    if (n % 2 === 1) py += cr;
    py = mod(py + cr, cr * 2) - cr;
    return Math.min(Math.min(Math.min(Math.hypot(px, py) - cr, px), a), b);
  };
  const iround = (a, b, r) => Math.min(-r, Math.max(a, b)) + Math.hypot(Math.max(r + a, 0), Math.max(r + b, 0)),
    ichamfer = (a, b, r) => Math.max(Math.max(a, b), (a + r + b) * SQ);
  // each takes the two distances and gives the joined one. r is the size of the join, n how many steps or columns
  const JOIN = {
    union: (a, b) => Math.min(a, b),
    cut: (a, b) => Math.max(a, -b),
    common: (a, b) => Math.max(a, b),
    round: (a, b, r) => Math.max(r, Math.min(a, b)) - Math.hypot(Math.max(r - a, 0), Math.max(r - b, 0)),
    cutRound: (a, b, r) => iround(a, -b, r),
    commonRound: iround,
    chamfer: (a, b, r) => Math.min(Math.min(a, b), (a - r + b) * SQ),
    cutChamfer: (a, b, r) => ichamfer(a, -b, r),
    commonChamfer: ichamfer,
    stairs,
    cutStairs: (a, b, r, n) => -stairs(-a, b, r, n),
    commonStairs: (a, b, r, n) => -stairs(-a, -b, r, n),
    columns,
    cutColumns: (a, b, r, n) => -columns(-a, b, r, n),
    pipe: (a, b, r) => Math.hypot(a, b) - r,
    engrave: (a, b, r) => Math.max(a, (a + r - Math.abs(b)) * SQ),
    groove: (a, b, r, n) => Math.max(a, Math.min(a + r, (n || r) - Math.abs(b))),
    tongue: (a, b, r, n) => Math.min(a, Math.max(a - r, Math.abs(b) - (n || r)))
  };
  K.sdf = { JOIN };
  const bound = list => {
    let c = [0, 0, 0],
      br = 0,
      inf = false;
    for (const p of list) {
      if (p.br > 1e8) inf = true;
      c = V.mad(c, p.bc, 1 / list.length);
    }
    if (inf) return { bc: [0, 0, 0], br: 1e9 };
    for (const p of list) br = Math.max(br, V.dist(c, p.bc) + p.br);
    return { bc: c, br };
  };
  K.sculpt = S => {
    if (S.join) return S;
    const asList = a => (Array.isArray(a) ? a : [a]),
      sdOf = list =>
        list.length === 1
          ? (x, y, z) => S.psd(list[0], x, y, z)
          : (x, y, z) => {
              let d = 1e9;
              for (const p of list) {
                const q = S.psd(p, x, y, z);
                if (q < d) d = q;
              }
              return d;
            };
    S.join = (kind, a, b, o) => {
      o = o || {};
      const A = asList(a),
        Bl = asList(b),
        fa = sdOf(A),
        fb = sdOf(Bl),
        op = JOIN[kind],
        r = o.r === undefined ? 0.2 : o.r,
        n = o.n || 3,
        left = o.mask && bound(A), right = o.mask && kind === 'common' && bound(Bl),
        bd = left ? right && right.br < left.br ? right : left : bound(A.concat(Bl));
      if (!op) throw new Error('no join called ' + kind);
      const ma = A[0].mat,
        mb = Bl[0].mat,
        base =
          o.mat ||
          (kind.startsWith('cut') || kind === 'engrave' || kind === 'groove'
            ? Object.assign({}, ma, o.inner ? { rf: (x, y, z) => (fb(x, y, z) < 0.06 ? o.inner : null) } : {})
            : Object.assign({}, ma, { rf: (x, y, z) => (fb(x, y, z) < fa(x, y, z) ? mb.r : null) }));
      const chart = A.concat(Bl).find(solid => solid.mat.surfaceState)?.mat.surfaceState;
      let mat = base;
      if (!o.mat?.surfaceState && chart) {
        const cut = kind.startsWith('cut') || kind === 'engrave' || kind === 'groove';
        const common = kind.startsWith('common');
        mat = { ...base, surfaceState: { ...chart, locate(point, normal) {
          const left = fa(...point), right = fb(...point);
          if (cut && -right >= left) return null;
          const sources = cut || (common ? left >= right : left <= right) ? A : Bl;
          const solid = sources.reduce((best, row) => !best || S.psd(row, ...point) < S.psd(best, ...point) ? row : best, null);
          return solid?.mat.surfaceState?.locate(point, normal);
        } } };
      }
      const p = {
        bc: bd.bc,
        br: bd.br + r,
        sd: (x, y, z) => op(fa(x, y, z), fb(x, y, z), r, n),
        sample(f) {
          const res = this.res;
          const sample = (list, rejected) => {
            for (const q of list) {
              const keep = q.res, margin = res + q.reach;
              q.res = res;
              try {
                q.sample(rejected ? (x, y, z) => {
                  if (rejected(x, y, z) <= margin) f(x, y, z);
                } : f);
              } finally {
                q.res = keep;
              }
            }
          };
          if (o.mask) {
            // The opposite field clips candidate points before refinement can pull them onto a cap.
            sample(A, kind === 'cut' ? (x, y, z) => -fb(x, y, z) : fb);
            sample(Bl, fa);
          } else sample(A.concat(Bl));
        }
      };
      return S.add(p, mat, Object.assign({ reach: r * 1.1 }, o));
    };
    S.fold = (p0, spec, o) => {
      o = o || {};
      const c = spec.c || [0, 0, 0],
        T = [],
        inv = [];
      if (spec.polar) {
        const n = spec.polar,
          ax = spec.axis || 'y',
          i0 = ax === 'y' ? 0 : ax === 'x' ? 1 : 0,
          i1 = ax === 'y' ? 2 : ax === 'x' ? 2 : 1,
          sec = (Math.PI * 2) / n,
          a0 = Math.atan2(p0.bc[i1] - c[i1], p0.bc[i0] - c[i0]);
        for (let k = 0; k < n; k++) {
          const cs = Math.cos(k * sec),
            sn = Math.sin(k * sec);
          T.push(q => {
            const u = q[i0] - c[i0],
              w = q[i1] - c[i1],
              e = q.slice();
            e[i0] = c[i0] + u * cs - w * sn;
            e[i1] = c[i1] + u * sn + w * cs;
            return e;
          });
        }
        inv.push((x, y, z) => {
          const q = [x, y, z],
            u = q[i0] - c[i0],
            w = q[i1] - c[i1],
            rr = Math.hypot(u, w),
            a = mod(Math.atan2(w, u) - a0 + sec / 2, sec) - sec / 2 + a0;
          q[i0] = c[i0] + Math.cos(a) * rr;
          q[i1] = c[i1] + Math.sin(a) * rr;
          return q;
        });
      } else if (spec.mirror) {
        const i = 'xyz'.indexOf(spec.mirror),
          sg = p0.bc[i] >= c[i] ? 1 : -1;
        T.push(q => q);
        T.push(q => {
          const e = q.slice();
          e[i] = 2 * c[i] - e[i];
          return e;
        });
        inv.push((x, y, z) => {
          const q = [x, y, z];
          q[i] = c[i] + sg * Math.abs(q[i] - c[i]);
          return q;
        });
      } else if (spec.repeat) {
        const d = spec.repeat,
          cnt = spec.count || [1, 1, 1];
        for (let i = 0; i < cnt[0]; i++)
          for (let j = 0; j < cnt[1]; j++)
            for (let k = 0; k < cnt[2]; k++) T.push(q => [q[0] + i * d[0], q[1] + j * d[1], q[2] + k * d[2]]);
        inv.push((x, y, z) => {
          const q = [x, y, z];
          for (let m = 0; m < 3; m++)
            if (d[m] && cnt[m] > 1) q[m] -= d[m] * K.clamp(Math.round((q[m] - p0.bc[m]) / d[m]), 0, cnt[m] - 1);
          return q;
        });
      }
      const f0 = inv[0],
        reps = T.map(t => ({ bc: t(p0.bc), br: p0.br })),
        bd = bound(reps),
        p = {
          bc: bd.bc,
          br: bd.br,
          sd: (x, y, z) => {
            const q = f0(x, y, z);
            return S.psd(p0, q[0], q[1], q[2]);
          },
          sample(f) {
            const keep = p0.res;
            p0.res = this.res;
            for (const t of T)
              p0.sample((x, y, z) => {
                const q = t([x, y, z]);
                f(q[0], q[1], q[2]);
              });
            p0.res = keep;
          }
        };
      const mat = o.mat?.surfaceState ? o.mat : S.mapSurfaceState(
        o.mat && p0.mat.surfaceState ? { ...o.mat, surfaceState: p0.mat.surfaceState } : o.mat || p0.mat,
        point => f0(...point), (normal, rest, point) => {
          const inverse = K.deform.jac(q => f0(...q), point), { M } = K;
          return Math.abs(M.det(inverse)) > 1e-8 ? V.norm(M.app(M.tr(M.inv(inverse)), normal), normal) : normal;
        });
      return S.add(p, mat, o);
    };
    S.poly = (c, planes, mat, o) => {
      o = o || {};
      const rd = o.rd || 0;
      let R = 0;
      const faces = planes.map(pl => {
        const n = V.norm(pl.n),
          d = pl.d,
          up = Math.abs(n[1]) > 0.98,
          u = up ? [1, 0, 0] : V.norm(V.cross([0, 1, 0], n)),
          v = V.cross(n, u);
        return { n, d, u, v, c: V.mad(c, n, d) };
      });
      for (const f of faces) {
        let r = 1e9,
          far = 0;
        for (const g of faces) {
          if (g === f) continue;
          const k = V.dot(f.n, g.n);
          if (k > 0.999) continue;
          const e = (g.d - k * f.d) / Math.sqrt(1 - k * k);
          if (e > 0 && e < r) r = e;
        }
        f.r = r;
        R = Math.max(R, Math.hypot(f.d, r * 2.2));
      }
      const p = {
        bc: c,
        br: R,
        faces,
        sd: (x, y, z) => {
          let m = -1e9;
          const a = x - c[0],
            b = y - c[1],
            e = z - c[2];
          for (const f of faces) {
            const q = f.n[0] * a + f.n[1] * b + f.n[2] * e - (f.d - rd);
            if (q > m) m = q;
          }
          return m - rd;
        },
        sample(fn) {
          const res = this.res;
          for (const f of faces) {
            const ext = f.r * 2.4,
              m = Math.ceil(ext / res);
            for (let i = -m; i <= m; i++)
              for (let j = -m; j <= m; j++) {
                const a = (i + (j & 1) * 0.5) * res,
                  b = j * res * 0.87,
                  q = [
                    f.c[0] + f.u[0] * a + f.v[0] * b,
                    f.c[1] + f.u[1] * a + f.v[1] * b,
                    f.c[2] + f.u[2] * a + f.v[2] * b
                  ];
                let ok = true;
                for (const g of faces)
                  if (g !== f && V.dot(g.n, V.sub(q, c)) - g.d > res * 0.3) {
                    ok = false;
                    break;
                  }
                if (ok) fn(q[0], q[1], q[2]);
              }
          }
        }
      };
      return S.add(p, mat, Object.assign({ reach: rd }, o));
    };
    const PHI = (1 + Math.sqrt(5)) / 2,
      SIGN = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ],
      cyc = (a, b, c) => [
        [a, b, c],
        [c, a, b],
        [b, c, a]
      ];
    const NORMALS = {
      d4: [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1]
      ],
      d6: [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ],
      d8: [],
      d12: [],
      d20: []
    };
    for (const a of [1, -1])
      for (const b of [1, -1])
        for (const e of [1, -1]) {
          NORMALS.d8.push([a, b, e]);
          NORMALS.d20.push([a, b, e]);
        }
    for (const s of SIGN) {
      for (const q of cyc(0, s[0], s[1] * PHI)) NORMALS.d12.push(q);
      for (const q of cyc(0, s[0] / PHI, s[1] * PHI)) NORMALS.d20.push(q);
    }
    // r is the distance from the middle to each face. o.ax = [X, Y, Z] turns the whole solid
    S.regular = (kind, c, r, mat, o) => {
      o = o || {};
      const ax = o.ax,
        ns = NORMALS[kind];
      if (!ns) throw new Error('no regular solid called ' + kind);
      return S.poly(
        c,
        ns.map(n => ({
          n: ax
            ? [
                ax[0][0] * n[0] + ax[1][0] * n[1] + ax[2][0] * n[2],
                ax[0][1] * n[0] + ax[1][1] * n[1] + ax[2][1] * n[2],
                ax[0][2] * n[0] + ax[1][2] * n[1] + ax[2][2] * n[2]
              ]
            : n,
          d: r
        })),
        mat,
        o
      );
    };
    // ---- bending space. A held solid is seen through a map of space: fwd says where each of its points goes, inv brings a point back.
    //   { twist: radians per unit, axis: 'y' } | { bend: radians per unit along x (the bar curls up) } | { taper: [scale at y0, scale at y1], y0, y1 } | { map: { fwd, inv, lip } }
    S.warp = (p0, spec, o) => {
      o = o || {};
      const c = spec.c || p0.bc.slice();
      let fwd,
        inv,
        lip = 1;
      if (spec.twist) {
        const k = spec.twist,
          ax = spec.axis || 'y',
          i0 = ax === 'y' ? 0 : ax === 'x' ? 1 : 0,
          i1 = ax === 'y' ? 2 : ax === 'x' ? 2 : 1,
          ia = 'xyz'.indexOf(ax),
          turn = (q, sg) => {
            const a = sg * k * (q[ia] - c[ia]),
              cs = Math.cos(a),
              sn = Math.sin(a),
              u = q[i0] - c[i0],
              w = q[i1] - c[i1],
              e = q.slice();
            e[i0] = c[i0] + u * cs - w * sn;
            e[i1] = c[i1] + u * sn + w * cs;
            return e;
          };
        fwd = q => turn(q, 1);
        inv = q => turn(q, -1);
        lip = Math.sqrt(1 + Math.pow(k * Math.min(p0.br, spec.wide || p0.br), 2));
      } else if (spec.bend) {
        const k = spec.bend,
          R = 1 / k;
        fwd = q => {
          const a = k * (q[0] - c[0]),
            y = q[1] - c[1];
          return [c[0] + (R - y) * Math.sin(a), c[1] + R - (R - y) * Math.cos(a), q[2]];
        };
        inv = q => {
          const dx = q[0] - c[0],
            dy = R - (q[1] - c[1]),
            a = Math.atan2(dx, dy * Math.sign(R));
          return [c[0] + a / k, c[1] + R - Math.hypot(dx, dy) * Math.sign(R), q[2]];
        };
        lip = 1 + Math.abs(k) * (spec.thick || 1);
      } else if (spec.taper) {
        const s0 = spec.taper[0],
          s1 = spec.taper[1],
          y0 = spec.y0 === undefined ? p0.bc[1] - p0.br : spec.y0,
          y1 = spec.y1 === undefined ? p0.bc[1] + p0.br : spec.y1,
          sc = y => s0 + (s1 - s0) * K.clamp((y - y0) / (y1 - y0), 0, 1);
        fwd = q => {
          const k = sc(q[1]);
          return [c[0] + (q[0] - c[0]) * k, q[1], c[2] + (q[2] - c[2]) * k];
        };
        inv = q => {
          const k = sc(q[1]);
          return [c[0] + (q[0] - c[0]) / k, q[1], c[2] + (q[2] - c[2]) / k];
        };
        lip = 1 / Math.min(s0, s1, 1);
      } else if (spec.map) {
        fwd = spec.map.fwd;
        inv = spec.map.inv;
        lip = spec.map.lip || 1.5;
      } else throw new Error('warp: twist, bend, taper or map');
      // where the warped solid ends up: carry the corners of a box round the original through the map
      const lo = [1e9, 1e9, 1e9],
        hi = [-1e9, -1e9, -1e9];
      for (let k = 0; k < 27; k++) {
        const q = fwd([
          p0.bc[0] + ((k % 3) - 1) * p0.br,
          p0.bc[1] + ((Math.floor(k / 3) % 3) - 1) * p0.br,
          p0.bc[2] + (Math.floor(k / 9) - 1) * p0.br
        ]);
        for (let m = 0; m < 3; m++) {
          lo[m] = Math.min(lo[m], q[m]);
          hi[m] = Math.max(hi[m], q[m]);
        }
      }
      const bc = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
        p = {
          bc,
          br: p0.br > 1e8 ? 1e9 : Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2,
          sd: (x, y, z) => {
            const q = inv([x, y, z]);
            return S.psd(p0, q[0], q[1], q[2]) / lip;
          },
          sample(f) {
            const keep = p0.res;
            p0.res = this.res;
            p0.sample((x, y, z) => {
              const q = fwd([x, y, z]);
              f(q[0], q[1], q[2]);
            });
            p0.res = keep;
          }
        };
      const mat = o.mat?.surfaceState ? o.mat : S.mapSurfaceState(
        o.mat && p0.mat.surfaceState ? { ...o.mat, surfaceState: p0.mat.surfaceState } : o.mat || p0.mat,
        inv, (normal, rest) => V.norm(K.M.app(K.M.tr(K.deform.jac(fwd, rest)), normal), normal));
      return S.add(p, mat, Object.assign({ reach: 0.06 }, o));
    };
    const gradOf = (p0, x, y, z) => {
      const e = 0.01,
        d = S.psd(p0, x, y, z);
      return V.norm([S.psd(p0, x + e, y, z) - d, S.psd(p0, x, y + e, z) - d, S.psd(p0, x, y, z + e) - d]);
    };
    function projectSkin(p0, material) {
      if (material?.surfaceState) return material;
      const base = material && p0.mat.surfaceState ? { ...material, surfaceState: p0.mat.surfaceState } : material || p0.mat;
      return S.mapSurfaceState(base, point => V.mad(point, gradOf(p0, ...point), -S.psd(p0, ...point)));
    }
    // a hollow skin of thickness t on a held solid's surface (cut it open with a join to see inside), and the same solid grown by r all round
    S.shell = (p0, t, o) => {
      const h = t / 2,
        p = {
          bc: p0.bc,
          br: p0.br + h,
          sd: (x, y, z) => Math.abs(S.psd(p0, x, y, z)) - h,
          sample(f) {
            const keep = p0.res;
            p0.res = this.res;
            p0.sample((x, y, z) => {
              const n = gradOf(p0, x, y, z);
              f(x + n[0] * h, y + n[1] * h, z + n[2] * h);
              f(x - n[0] * h, y - n[1] * h, z - n[2] * h);
            });
            p0.res = keep;
          }
        };
      return S.add(p, projectSkin(p0, o?.mat), Object.assign({ reach: h * 0.5 }, o));
    };
    S.swell = (p0, r, o) => {
      const p = {
        bc: p0.bc,
        br: p0.br + Math.max(0, r),
        sd: (x, y, z) => S.psd(p0, x, y, z) - r,
        sample(f) {
          const keep = p0.res;
          p0.res = this.res;
          p0.sample((x, y, z) => {
            const n = gradOf(p0, x, y, z);
            f(x + n[0] * r, y + n[1] * r, z + n[2] * r);
          });
          p0.res = keep;
        }
      };
      return S.add(p, projectSkin(p0, o?.mat), Object.assign({ reach: Math.abs(r) * 0.3 }, o));
    };
    // a held solid with its surface pushed in and out by fn(x, y, z) (at most amp either way): ripples, scales, wear
    S.rough = (p0, fn, amp, o) => {
      const p = {
        bc: p0.bc,
        br: p0.br + amp,
        sd: (x, y, z) => (S.psd(p0, x, y, z) + fn(x, y, z)) * 0.8,
        sample(f) {
          const keep = p0.res;
          p0.res = this.res;
          p0.sample(f);
          p0.res = keep;
        }
      };
      return S.add(p, projectSkin(p0, o?.mat), Object.assign({ reach: amp * 1.2 }, o));
    };
    // ---- flat outlines made solid. An outline is a list of closed loops of [x, y] points (K.poly2 makes them; holes are loops inside loops).
    const sd2 = (loops, x, y) => {
      let d = 1e18,
        inside = false;
      for (const L of loops)
        for (let a = 0, n = L.length; a < n; a++) {
          const p = L[a],
            q = L[(a + 1) % n],
            ex = q[0] - p[0],
            ey = q[1] - p[1],
            wx = x - p[0],
            wy = y - p[1],
            t = K.clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1),
            dx = wx - ex * t,
            dy = wy - ey * t,
            dd = dx * dx + dy * dy;
          if (dd < d) d = dd;
          if (p[1] <= y !== q[1] <= y && x < p[0] + ((y - p[1]) / (q[1] - p[1])) * ex) inside = !inside;
        }
      return (inside ? -1 : 1) * Math.sqrt(d);
    };
    const edges = (loops, res, fn) => {
      for (const L of loops)
        for (let a = 0, n = L.length; a < n; a++) {
          const p = L[a],
            q = L[(a + 1) % n],
            len = Math.hypot(q[0] - p[0], q[1] - p[1]),
            m = Math.max(1, Math.ceil(len / res));
          for (let k = 0; k < m; k++)
            fn(p[0] + ((q[0] - p[0]) * (k + 0.5)) / m, p[1] + ((q[1] - p[1]) * (k + 0.5)) / m);
        }
    };
    const span2 = loops => {
      let lo = [1e9, 1e9],
        hi = [-1e9, -1e9];
      for (const L of loops)
        for (const p of L) {
          lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
          hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
        }
      return {
        lo,
        hi,
        r: Math.max(
          Math.hypot(lo[0], lo[1]),
          Math.hypot(hi[0], hi[1]),
          Math.hypot(lo[0], hi[1]),
          Math.hypot(hi[0], lo[1])
        )
      };
    };
    // pushed straight through to a depth, centred on c. o.ax = [U, V, W]: the outline's x and y, and the way it is pushed. o.rd rounds the edges
    S.extrude = (loops, c, depth, mat, o) => {
      o = o || {};
      const ax = o.ax || [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ],
        U = ax[0],
        Vv = ax[1],
        Wd = ax[2],
        sp = span2(loops),
        h = depth / 2,
        rd = o.rd || 0,
        out = (a, b, d) => [
          c[0] + U[0] * a + Vv[0] * b + Wd[0] * d,
          c[1] + U[1] * a + Vv[1] * b + Wd[1] * d,
          c[2] + U[2] * a + Vv[2] * b + Wd[2] * d
        ];
      const p = {
        bc: c,
        br: Math.hypot(sp.r, h),
        sd: (x, y, z) => {
          const r = [x - c[0], y - c[1], z - c[2]],
            d2 = sd2(loops, V.dot(r, U), V.dot(r, Vv)) + rd,
            dz = Math.abs(V.dot(r, Wd)) - h + rd;
          return Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) - rd;
        },
        sample(f) {
          const res = this.res,
            nz = Math.max(1, Math.ceil(depth / res));
          edges(loops, res, (a, b) => {
            for (let k = 0; k < nz; k++) {
              const q = out(a, b, -h + ((k + 0.5) / nz) * depth);
              f(q[0], q[1], q[2]);
            }
          });
          for (let a = sp.lo[0]; a <= sp.hi[0]; a += res)
            for (let b = sp.lo[1]; b <= sp.hi[1]; b += res * 0.87)
              if (sd2(loops, a, b) < 0)
                for (const sg of [-1, 1]) {
                  const q = out(a, b, sg * h);
                  f(q[0], q[1], q[2]);
                }
        }
      };
      return S.add(p, mat, Object.assign({ reach: rd }, o));
    };
    // turned about the y axis through c: the outline's x is distance from the axis (keep it at or above 0), its y is height
    S.revolve = (loops, c, mat, o) => {
      o = o || {};
      const sp = span2(loops),
        p = {
          bc: [c[0], c[1] + (sp.lo[1] + sp.hi[1]) / 2, c[2]],
          br: Math.hypot(sp.hi[0], (sp.hi[1] - sp.lo[1]) / 2),
          sd: (x, y, z) => sd2(loops, Math.hypot(x - c[0], z - c[2]), y - c[1]),
          sample(f) {
            const res = this.res;
            let row = 0;
            edges(loops, res, (a, b) => {
              if (a < 1e-3) return;
              const cnt = Math.max(3, Math.ceil((Math.PI * 2 * a) / res));
              row++;
              for (let k = 0; k < cnt; k++) {
                const t = ((k + (row % 2) * 0.5) / cnt) * Math.PI * 2;
                f(c[0] + Math.cos(t) * a, c[1] + b, c[2] + Math.sin(t) * a);
              }
            });
          }
        };
      return S.add(p, mat, o);
    };
    S.inflate = S.swell;
    // bubble wrap: a held solid's surface raised into rows of domes. cell: spacing; h: how far each stands out; fill: how much of its cell a dome takes (0..1).
    // flat: 'x' | 'y' | 'z' lays the rows out ignoring that direction, which is what a flat sheet facing that way wants; without it they sit on a 3D lattice
    S.bubbles = (p0, o) => {
      o = o || {};
      const cell = o.cell || 0.4,
        h = o.h === undefined ? cell * 0.3 : o.h,
        fill = o.fill === undefined ? 0.9 : o.fill,
        skip = o.flat ? 'xyz'.indexOf(o.flat) : -1,
        wrap = v => {
          const u = v / cell;
          return (u - Math.floor(u) - 0.5) * 2;
        };
      const dome = (x, y, z) => {
        const q = [x, y, z];
        let r2 = 0,
          row = 0;
        for (let k = 0; k < 3; k++) {
          if (k === skip) continue;
          const sh = row++ === 1 ? 0 : 0;
          const w = wrap(q[k] + sh);
          r2 += w * w;
        }
        const e = 1 - r2 / (fill * fill);
        return e > 0 ? Math.sqrt(e) : 0;
      };
      const p = {
        bc: p0.bc,
        br: p0.br + h,
        sd: (x, y, z) => (S.psd(p0, x, y, z) - h * dome(x, y, z)) * 0.7,
        sample(f) {
          const keep = p0.res;
          p0.res = this.res * 0.85;
          p0.sample(f);
          p0.res = keep;
        }
      };
      return S.add(p, o.mat || p0.mat, Object.assign({ reach: h * 1.2 }, o));
    };
    // a flat outline blown up like a cushion or a balloon letter: thickest in the middle, closing to nothing at the edge. height: its greatest thickness;
    // o.width: how far in from the edge it goes on rising (default: as far as the outline allows); o.ax as for extrude; o.back: 0..1, how much of it bulges out behind (1 = the same both sides, 0 = flat-backed)
    S.puff = (loops, c, height, mat, o) => {
      o = o || {};
      const ax = o.ax || [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1]
        ],
        U = ax[0],
        Vv = ax[1],
        Wd = ax[2],
        sp = span2(loops),
        back = o.back === undefined ? 1 : o.back;
      let W = o.width || 0;
      if (!W) {
        for (let a = sp.lo[0]; a <= sp.hi[0]; a += (sp.hi[0] - sp.lo[0]) / 24)
          for (let b = sp.lo[1]; b <= sp.hi[1]; b += (sp.hi[1] - sp.lo[1]) / 24) W = Math.max(W, -sd2(loops, a, b));
        W = Math.max(W, 1e-3);
      }
      const thick = e => (height / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(e, W) / W, 2))),
        out = (a, b, d) => [
          c[0] + U[0] * a + Vv[0] * b + Wd[0] * d,
          c[1] + U[1] * a + Vv[1] * b + Wd[1] * d,
          c[2] + U[2] * a + Vv[2] * b + Wd[2] * d
        ];
      const p = {
        bc: c,
        br: Math.hypot(sp.r, height / 2),
        sd: (x, y, z) => {
          const r = [x - c[0], y - c[1], z - c[2]],
            d2 = sd2(loops, V.dot(r, U), V.dot(r, Vv)),
            d = V.dot(r, Wd);
          if (d2 >= 0) return Math.hypot(d2, d) * 0.9;
          const t = thick(-d2) * (d < 0 ? back : 1);
          return Math.max(d2 * 0.9, (Math.abs(d) - t) * 0.55);
        },
        sample(f) {
          const res = this.res * 0.7;
          for (let a = sp.lo[0]; a <= sp.hi[0]; a += res)
            for (let b = sp.lo[1]; b <= sp.hi[1]; b += res * 0.87) {
              const d2 = sd2(loops, a, b);
              if (d2 >= 0) continue;
              const t = thick(-d2);
              let q = out(a, b, t);
              f(q[0], q[1], q[2]);
              q = out(a, b, -t * back);
              f(q[0], q[1], q[2]);
            }
          edges(loops, res, (a, b) => {
            const q = out(a, b, 0);
            f(q[0], q[1], q[2]);
          });
        }
      };
      return S.add(
        p,
        mat,
        Object.assign({ reach: this ? 0 : 0 }, o, { reach: Math.max((o.res || S.res) * 1.5, height * 0.12) })
      );
    };
    /* Placing things by where they are seen, not by coordinates.
         S.on(solid, o)       the point of a solid's surface that the eye sees. o.view is the way to the eye (S.view if not given); o.at
                              [right, up] says how far across the solid to look, in parts of its size (0, 0 is its middle; o.size if the
                              solid's own reach is the wrong measure). Or o.dir, a direction out from its middle. o.lift stands it off.
                              -> { p, n, ax, hit }: the point, which way the surface faces there, a frame whose long axis is that way
         S.seen(p, o)         can the eye see point p, with everything made so far in the way? (ghosts hide nothing)
         S.stud(solid, o, r, mat, opts)   a ball set into the surface there (o.sink: how much of its radius is under the skin, 0.35):
                              an eye, a button, a rivet. The ball comes back with .at (what S.on found) and .buried (true if the eye
                              cannot see it, which is nearly always a mistake: it is also noted in S.warnings; hand that to B.finish({ warnings })
                              and the tools print it) */
    const unit3 = v => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      },
      cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
      eyeDir = o => unit3((o && o.view) || S.view || [0, 0.34, 0.94]);
    S.warnings = S.warnings || [];
    S.on = (solid, o) => {
      o = o || {};
      const c = o.from || solid.bc,
        br = solid.br,
        out = o.dir ? unit3(o.dir) : eyeDir(o),
        reach = br * 1.6 + 0.3,
        start = [c[0] + out[0] * reach, c[1] + out[1] * reach, c[2] + out[2] * reach];
      if (!o.dir && o.at) {
        let right = cross3([0, 1, 0], out);
        if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
        right = unit3(right);
        const up = cross3(out, right),
          size = o.size || br;
        for (let k = 0; k < 3; k++) start[k] += right[k] * o.at[0] * size + up[k] * o.at[1] * size;
      }
      let t = 0,
        hit = false;
      for (let k = 0; k < 240 && t < reach * 2 + 0.3; k++) {
        const d = S.psd(solid, start[0] - out[0] * t, start[1] - out[1] * t, start[2] - out[2] * t);
        if (d < 0.002) {
          hit = true;
          break;
        }
        t += Math.max(d * 0.85, 0.004);
      }
      const p = [start[0] - out[0] * t, start[1] - out[1] * t, start[2] - out[2] * t],
        e = 0.01;
      let n = out;
      if (hit)
        n = unit3([
          S.psd(solid, p[0] + e, p[1], p[2]) - S.psd(solid, p[0] - e, p[1], p[2]),
          S.psd(solid, p[0], p[1] + e, p[2]) - S.psd(solid, p[0], p[1] - e, p[2]),
          S.psd(solid, p[0], p[1], p[2] + e) - S.psd(solid, p[0], p[1], p[2] - e)
        ]);
      if (o.lift) for (let k = 0; k < 3; k++) p[k] += n[k] * o.lift;
      let u = cross3(Math.abs(n[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], n);
      u = unit3(u);
      return { p, n, ax: [u, n, cross3(u, n)], hit };
    };
    let readyFor = -1;
    S.seen = (p, o) => {
      if (S.ready && S.solidCount() !== readyFor) {
        S.ready();
        readyFor = S.solidCount();
      }
      const out = eyeDir(o),
        slack = (o && o.slack) || 0.03;
      let t = slack;
      for (let k = 0; k < 160 && t < 40; k++) {
        const d = S.sdf(p[0] + out[0] * t, p[1] + out[1] * t, p[2] + out[2] * t);
        if (d < 0.002) return false;
        t += Math.max(d * 0.9, 0.01);
      }
      return true;
    };
    S.stud = (solid, o, r, mat, opts) => {
      o = o || {};
      const at = S.on(solid, o),
        sink = o.sink === undefined ? 0.35 : o.sink,
        c = [
          at.p[0] + at.n[0] * r * (1 - 2 * sink),
          at.p[1] + at.n[1] * r * (1 - 2 * sink),
          at.p[2] + at.n[2] * r * (1 - 2 * sink)
        ],
        tip = [c[0] + at.n[0] * r, c[1] + at.n[1] * r, c[2] + at.n[2] * r],
        ball = S.ball(c, r, mat, opts);
      ball.at = at;
      ball.buried = !at.hit || !S.seen(tip, o);
      if (ball.buried)
        S.warnings.push(
          'a stud at ' +
            c.map(v => v.toFixed(2)).join(', ') +
            (at.hit ? ' cannot be seen from where the eye is' : ' missed the solid it was meant to sit on')
        );
      return ball;
    };
    S.stroke = (spec, mat, o) => K.drawing.solid(S, { ...spec, kind: 'stroke' }, mat, o);
    S.fill = (spec, mat, o) => K.drawing.solid(S, { ...spec, kind: 'fill' }, mat, o);
    return S;
  };
  // outlines for S.extrude and S.revolve. Each gives a list of loops
  K.poly2 = {
    ngon: (n, r, rot) => [
      Array.from({ length: n }, (_, k) => {
        const a = (rot || 0) + (k / n) * Math.PI * 2;
        return [Math.cos(a) * r, Math.sin(a) * r];
      })
    ],
    star: (n, r0, r1, rot) => [
      Array.from({ length: n * 2 }, (_, k) => {
        const a = (rot || 0) + (k / (n * 2)) * Math.PI * 2,
          r = k % 2 ? r1 : r0;
        return [Math.cos(a) * r, Math.sin(a) * r];
      })
    ],
    gear: (n, r, tooth) => [
      Array.from({ length: n * 4 }, (_, k) => {
        const a = ((k + 0.5) / (n * 4)) * Math.PI * 2,
          rr = r + (k % 4 < 2 ? tooth : 0);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      })
    ],
    rect: (w, h) => [
      [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2]
      ]
    ],
    // an SVG path, scaled so that its larger side is `size` across, centred, y up
    svg: (d, size) => {
      const loops = K.svgPath(d);
      let lo = [1e9, 1e9],
        hi = [-1e9, -1e9];
      for (const L of loops)
        for (const p of L) {
          lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
          hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
        }
      const k = (size || 1) / Math.max(hi[0] - lo[0], hi[1] - lo[1]),
        cx = (lo[0] + hi[0]) / 2,
        cy = (lo[1] + hi[1]) / 2;
      return loops.map(L => L.map(p => [(p[0] - cx) * k, -(p[1] - cy) * k]));
    },
    with: (outer, hole) => outer.concat(hole)
  };
})(KIT);
