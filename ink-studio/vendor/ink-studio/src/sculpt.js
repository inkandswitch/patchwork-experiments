/* ------------------------------------------------------------------
   Sculpting. Solids are described by signed distance (balls, boxes,
   tubes, turned profiles, rings; blended, carved, roughened), then
   baked into splats: points are scattered over each solid, pulled onto
   the combined surface, and coloured from a material ramp using the
   surface normal, a cast shadow, ambient occlusion and nearby lamps.
   ------------------------------------------------------------------ */
function makeSculpt(B, rest) {
  const { P, n3, fbm, disc, stick, fib, TAU, clamp, norm, R } = B;
  const detailBudget = B.detailBudget;
  const controlledMaterials = new WeakMap();
  function controlled(material) {
    if (material?.controls === undefined && material?.top?.controls === undefined) return material;
    if (!controlledMaterials.has(material))
      controlledMaterials.set(material, MaterialControls.resolve(material, { palette: P, packed: true }));
    return controlledMaterials.get(material);
  }
  const shadowArt = B.shadowArt;
  const shadowTarget = (owner, mat) => ({
    object: owner?.renderOwner, entity: owner?.renderOwner, ...owner?.renderTarget,
    material: mat.materialId, surface: owner?.renderTarget?.surface ?? mat.surfaceId ?? mat.surface?.id
  });
  const receives = new WeakMap();
  function receivesShadow(owner, material) {
    if (!shadowArt?.receive) return true;
    if (!owner) return ShadowArt.allows(shadowArt.receive, shadowTarget(owner, material));
    if (!receives.has(owner)) receives.set(owner, new WeakMap());
    const cached = receives.get(owner);
    if (!cached.has(material)) cached.set(material, ShadowArt.allows(shadowArt.receive, shadowTarget(owner, material)));
    return cached.get(material);
  }
  const pixelStyles = new WeakMap();
  function materialStyle(value) {
    if (value === undefined || value === false) return null;
    if (!pixelStyles.has(value)) pixelStyles.set(value, MaterialPixelStyle.prepare(value));
    return pixelStyles.get(value);
  }
  const budgetFor = detailBudget && (p => detailBudget.match({
    object: p.renderOwner, entity: p.renderOwner, ...p.renderTarget
  }));
  const pos = rest?.positive || [],
    neg = rest?.negative || [],
    ghosts = [],
    g3 = [0, 0, 0],
    EM = { em: true },
    GLINT = { em: true, emission: false },
    VIEW0 = [0, 0.34, 0.94],
    FSEG = [0.38, 0.34, 0.28],
    FWID = [1, 0.75, 0.5],
    GLASS = { gl: true, nd: true },
    GLASSEM = { gl: true, nd: true, em: true },
    WINDL = { k: 11, ph: 0, sp: 1.3, rg: 0.04 },
    WINDG = { k: 11, ph: 1, sp: 1.9, rg: 0.022 };
  let gid = 1,
    own = null,
    ownNeg = null,
    L = null;
  const S = {
    res: 0.09,
    adaptiveSampling: false,
    keepRenderSdf: false,
    sun: norm([-0.5, 0.8, 0.45]),
    amb: 0.14,
    sky: 0.26,
    sunK: 0.72,
    aoR: 0.14,
    aoK: 1.5,
    shK: 9,
    shLen: 16,
    wob: 0.05,
    fat: 0.46,
    /* inked detail: 0 is off. Set to 1 and every plain dab also carries a 4 by 4 picture of the surface under it (its pattern, the
       edge of a shadow, the edge of the next thing along), which the page looks up for each pixel when its Inked detail option is on */
    fine: typeof globalThis !== 'undefined' && globalThis.INK_FINE ? 1 : 0,
    pixel: typeof globalThis !== 'undefined' && !!globalThis.INK_PIXEL,
    /* bounce light: null is off. { k, reach, rays, glow } and, after each bake, every dab is also lit by the lit things round it, in
       their colours (B.bounce). The page's Bounce light option sets it for a whole diorama so the two looks can be compared */
    bounce: typeof globalThis !== 'undefined' && globalThis.INK_BOUNCE ? {} : null,
    /* uneven detail: null is off. { p: [x, y, z], near, far, coarse, fine }: within `near` of the point p dabs are laid at the usual
       spacing (times `fine`, if given, for more of them); beyond `far` at `coarse` times it (bigger and fewer); between, halfway. The
       eye goes to where the detail is. A solid lying across a boundary is sampled once for each side of it. */
    focus: (typeof globalThis !== 'undefined' && globalThis.INK_FOCUS) || null,
    /* dabs that follow the form: null is off. { stretch, broad }: each dab is drawn out along the way the surface runs straightest (along
       a limb, round a rim), up to 1 + stretch times as long as it is wide where the surface curves one way only, and is `broad` times
       the size where the surface is flat both ways. Brushwork that describes the shape, bigger on planes than on detail. */
    follow: (typeof globalThis !== 'undefined' && globalThis.INK_FOLLOW) || null,
    /* attributes kept on the world: false is off. Set true and every dab carries four numbers (world.attr): its curvature (+ convex,
       - hollow, times its size), how shut in it is, which way is up from it (ny), and how far along its limb it is */
    keepAttrs: false,
    lights: [],
    mask: null,
    clip: null
  };
  S.AZ = [
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0]
  ]; // frame whose long axis runs along Z
  S.AX = [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1]
  ]; // ... along X
  S.grp = k => ({ g: gid++, k }); // members of a group melt into each other over distance k
  S.pick = (ramp, t) => ramp[clamp(Math.floor(t * ramp.length), 0, ramp.length - 1)];

  let hasOptionalProxy = false;
  function add(p, mat, o) {
    o = o || {};
    p.mat = controlled(Array.isArray(mat) ? { r: mat } : mat || {});
    p.res = o.res || S.res;
    p.k = o.k || 0;
    p.g = o.g || gid++;
    p.bump = o.bump || null;
    p.tag = o.tag || null;
    p.renderOwner = o.objectId ?? p.tag;
    p.renderTarget = o.surfaceId !== undefined ? { surface: o.surfaceId, ...o.target } : o.target;
    if (shadowArt?.cast) p.shadowCaster = ShadowArt.allows(shadowArt.cast, shadowTarget(p, p.mat));
    if (budgetFor) p.detailBudget = budgetFor(p);
    p.model = o.model;
    if (p.bump) p.br += p.bump[0];
    p.reach = o.reach || 0;
    p.whole = !!o.whole;
    if (o.lowerBound !== undefined) {
      if (typeof o.lowerBound !== 'function') throw new Error('A field lower bound must be a function');
      p.lowerBound = o.lowerBound;
    }
    if (o.born !== undefined) p.born = o.born;
    if (o.hold) return p; // held: made to be combined into another solid, not drawn by itself
    if (S.collide && (o.ghost || (p.mat.skip && !p.mat.solid))) return p; // when only what can be walked on matters, leave out what is drawn but not solid
    (o.ghost ? ghosts : o.neg ? neg : pos).push(p);
    if (p.mat.omitFromProxy && !o.ghost && !o.neg) hasOptionalProxy = true;
    return p;
  }
  // Capture a multi-piece recipe as operands for a sculpt operation.
  S.takeSolids = build => {
    const start = pos.length;
    try {
      build();
      return pos.slice(start);
    } finally {
      pos.length = start;
    }
  };
  S.materialAt = (material, point, normal) => {
    if (!material) return material;
    const selected = material.materialAt?.(...point, ...normal) ?? material;
    const state = selected.surfaceState, hit = state?.locate(point, normal);
    return hit ? state.apply(selected, hit, point, normal) : selected;
  };
  S.mapSurfaceState = (material, inverse, pullNormal) => {
    const state = material?.surfaceState;
    return state ? { ...material, surfaceState: { ...state, locate(point, normal) {
      const rest = inverse(point);
      return state.locate(rest, pullNormal ? pullNormal(normal, rest, point) : normal);
    } } } : material;
  };
  // Transform the geometry registered by one recipe, or its held boolean operand.
  S.transformSolids = ({ point, inverse, direction, scale }, build) => {
    const lists = [pos, neg, ghosts], starts = lists.map(list => list.length);
    const result = build();
    const solids = lists.flatMap((list, i) => list.slice(starts[i]));
    if (!solids.length && result?.sd) solids.push(result);
    for (const solid of solids) {
      const { sd, sample, lowerBound, along, analytic, geometryBounds, mat } = solid;
      solid.bc = point(solid.bc);
      if (solid.br < 1e8) solid.br *= scale;
      solid.reach *= scale;
      if (solid.bump) solid.bump = [solid.bump[0] * scale, solid.bump[1]];
      solid.sd = (x, y, z) => scale * sd(...inverse([x, y, z]));
      solid.sample = function (visit) {
        const res = this.res;
        this.res = res / scale;
        try {
          sample.call(this, (x, y, z) => visit(...point([x, y, z])));
        } finally {
          this.res = res;
        }
      };
      if (lowerBound) solid.lowerBound = (x, y, z, limit) => scale * lowerBound(...inverse([x, y, z]), limit / scale);
      if (along) solid.along = (x, y, z) => along(...inverse([x, y, z]));
      if (mat.rf) solid.mat = { ...mat, rf: (x, y, z) => mat.rf(...inverse([x, y, z])) };
      if (mat.surfaceState) {
        const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(direction);
        solid.mat = S.mapSurfaceState(solid.mat, inverse,
          normal => axes.map(axis => axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2]));
      }
      if (analytic) {
        const axes = analytic.frame ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        solid.analytic = { ...analytic, center: point(analytic.center), frame: axes.map(direction),
          ...(analytic.radii ? { radii: analytic.radii.map(r => r * scale) } :
            { major: analytic.major * scale, minor: analytic.minor * scale }) };
      }
      if (geometryBounds) {
        const { min, max } = geometryBounds;
        const corners = [min[0], max[0]].flatMap(x =>
          [min[1], max[1]].flatMap(y => [min[2], max[2]].map(z => point([x, y, z]))));
        solid.geometryBounds = {
          min: min.map((_, i) => Math.min(...corners.map(p => p[i]))),
          max: max.map((_, i) => Math.max(...corners.map(p => p[i])))
        };
      }
    }
    if (result?.sockets) {
      result.sockets = Object.fromEntries(Object.entries(result.sockets).map(([name, socket]) =>
        [name, { ...socket, p: point(socket.p), dir: direction(socket.dir) }]));
    }
    if (result && !result.sd && solids.length) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const { bc, br } of solids) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], bc[axis] - br);
        max[axis] = Math.max(max[axis], bc[axis] + br);
      }
      result.geometryBounds = { min, max };
    }
    return result;
  };
  // A measurement pass records per-axis extents without changing sampling,
  // grid bounds or shading for an ordinary sculpt.
  const measureBounds = rest?.measureBounds === true;
  function localBounds(p, center, half, frame, ellipsoid) {
    if (!measureBounds) return;
    const extent = frame ? half.map((_, axis) => {
      const u = half[0] * frame[0][axis], v = half[1] * frame[1][axis], w = half[2] * frame[2][axis];
      return ellipsoid ? Math.hypot(u, v, w) : Math.abs(u) + Math.abs(v) + Math.abs(w);
    }) : half;
    p.geometryBounds = {
      min: center.map((v, i) => v - extent[i]),
      max: center.map((v, i) => v + extent[i])
    };
  }
  if (measureBounds) S.geometryBounds = () => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of pos) {
      if (!Number.isFinite(p.br) || p.br > 1e8) throw Error('Geometry measurement needs finite solids');
      const bounds = p.geometryBounds, blend = Math.max(0, p.k);
      const margin = blend + (bounds ? Math.max(0, p.bump?.[0] || 0) : p.br);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], (bounds ? bounds.min[i] : p.bc[i]) - margin);
        max[i] = Math.max(max[i], (bounds ? bounds.max[i] : p.bc[i]) + margin);
      }
    }
    return pos.length ? { min, max } : null;
  };
  // a solid defined in its own space: centred on c, optionally turned by the frame o.ax
  function local(c, br, sd0, sm0, mat, o) {
    const ax = o && o.ax,
      p = { bc: c, br };
    if (ax) {
      const U = ax[0],
        V = ax[1],
        W = ax[2];
      p.sd = (x, y, z) => {
        const a = x - c[0],
          b = y - c[1],
          d = z - c[2];
        return sd0(a * U[0] + b * U[1] + d * U[2], a * V[0] + b * V[1] + d * V[2], a * W[0] + b * W[1] + d * W[2]);
      };
      p.sample = function (f) {
        sm0(this.res, (a, b, d) =>
          f(
            c[0] + U[0] * a + V[0] * b + W[0] * d,
            c[1] + U[1] * a + V[1] * b + W[1] * d,
            c[2] + U[2] * a + V[2] * b + W[2] * d
          )
        );
      };
    } else {
      p.sd = (x, y, z) => sd0(x - c[0], y - c[1], z - c[2]);
      p.sample = function (f) {
        sm0(this.res, (a, b, d) => f(c[0] + a, c[1] + b, c[2] + d));
      };
    }
    return add(p, mat, o);
  }

  /* a solid of your own: centred on c, inside a ball of radius br; sd(x, y, z) its distance in its own space, sample(res, f) calls f with
     points spread over it about res apart (they are pulled onto the surface afterwards: o.reach says how far they may be pulled) */
  S.solid = local;
  S.vox = (spec, o) => VOX.add(local, S, spec, o); // a shape typed in a block at a time: see kl-vox
  // ---------------- solids ----------------
  S.ball = (c, r, mat, o) => {
    const rx = r.length ? r[0] : r,
      ry = r.length ? r[1] : r,
      rz = r.length ? r[2] : r,
      sph = rx === ry && ry === rz;
    const solid = local(
      c,
      Math.max(rx, ry, rz),
      (x, y, z) => {
        if (sph) return Math.hypot(x, y, z) - rx;
        const k0 = Math.hypot(x / rx, y / ry, z / rz),
          k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
        return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
      },
      (res, f) => {
        const n = Math.ceil(
          (1.3 *
            4 *
            Math.PI *
            Math.pow((Math.pow(rx * ry, 1.6) + Math.pow(rx * rz, 1.6) + Math.pow(ry * rz, 1.6)) / 3, 0.625)) /
            (res * res)
        );
        for (let i = 0; i < n; i++) {
          const d = fib(i, n);
          f(d[0] * rx, d[1] * ry, d[2] * rz);
        }
      },
      mat,
      o
    );
    if (measureBounds) localBounds(solid, c, [rx, ry, rz], o?.ax, true);
    solid.analytic = { kind: 'ellipsoid', center: c, radii: [rx, ry, rz], frame: o?.ax };
    return solid;
  };
  // box: c is the centre, h the half-sizes, o.rd rounds the edges
  S.box = (c, h, mat, o) => {
    const rd = (o && o.rd) || 0,
      hs = h;
    const solid = local(
      c,
      Math.hypot(h[0], h[1], h[2]),
      (x, y, z) => {
        const qx = Math.abs(x) - h[0] + rd,
          qy = Math.abs(y) - h[1] + rd,
          qz = Math.abs(z) - h[2] + rd;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rd;
      },
      (res, f) => {
        for (let a = 0; a < 3; a++) {
          const b = (a + 1) % 3,
            c2 = (a + 2) % 3,
            nb = Math.max(1, Math.round((2 * hs[b]) / res)),
            nc = Math.max(1, Math.round((2 * hs[c2]) / res)),
            q = [0, 0, 0];
          for (let i = 0; i < nb; i++)
            for (let j = 0; j < nc; j++)
              for (let sg = -1; sg <= 1; sg += 2) {
                q[a] = sg * hs[a];
                q[b] = (((i + 0.5) / nb) * 2 - 1) * hs[b];
                q[c2] = (((j + 0.5) / nc) * 2 - 1) * hs[c2];
                f(q[0], q[1], q[2]);
              }
        }
      },
      mat,
      o
    );
    if (measureBounds) localBounds(solid, c, h, o?.ax);
    return solid;
  };
  // turned solid: c is the centre of the base, h the height, rf the radius (a number, [bottom, top], or a function of 0..1)
  S.lathe = (c, h, rf, mat, o) => {
    const fn = typeof rf === 'function' ? rf : rf.length ? t => rf[0] + (rf[1] - rf[0]) * t : () => rf;
    let rm = 0;
    for (let i = 0; i <= 16; i++) rm = Math.max(rm, fn(i / 16));
    if (o?.maxRadius !== undefined) {
      if (!Number.isFinite(o.maxRadius) || o.maxRadius < 0) throw Error('Lathe radius bound must be finite and nonnegative');
      rm = Math.max(rm, o.maxRadius);
    }
    const V = o && o.ax ? o.ax[1] : [0, 1, 0],
      cc = [c[0] + (V[0] * h) / 2, c[1] + (V[1] * h) / 2, c[2] + (V[2] * h) / 2];
    const solid = local(
      cc,
      Math.hypot(rm, h / 2),
      (x, y, z) => {
        const dr = (Math.hypot(x, z) - fn(clamp(y / h + 0.5, 0, 1))) * 0.8,
          dy = Math.abs(y) - h / 2;
        return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
      },
      (res, f) => {
        const rows = Math.ceil((h / res) * 1.25);
        for (let j = 0; j < rows; j++) {
          const t = (j + 0.5) / rows,
            r = fn(t),
            cnt = Math.max(3, Math.ceil((TAU * r) / res));
          for (let k = 0; k < cnt; k++) {
            const a = ((k + j * 0.5) / cnt) * TAU;
            f(Math.cos(a) * r, (t - 0.5) * h, Math.sin(a) * r);
          }
        }
        for (const e of [0, 1])
          for (let r = fn(e) - res * 0.5; r > 0; r -= res) {
            const cnt = Math.max(1, Math.ceil((TAU * r) / res));
            for (let k = 0; k < cnt; k++) {
              const a = (k / cnt) * TAU;
              f(Math.cos(a) * r, (e - 0.5) * h, Math.sin(a) * r);
            }
          }
      },
      mat,
      o
    );
    if (measureBounds && (typeof rf !== 'function' || o?.maxRadius !== undefined)) localBounds(solid, cc, [rm, h / 2, rm], o?.ax);
    return solid;
  };
  // ring lying flat (turn it with o.ax)
  S.torus = (c, R, r, mat, o) => {
    const solid = local(
      c,
      R + r,
      (x, y, z) => Math.hypot(Math.hypot(x, z) - R, y) - r,
      (res, f) => {
        const nu = Math.ceil((TAU * (R + r)) / res),
          nv = Math.max(4, Math.ceil((TAU * r) / res));
        for (let i = 0; i < nu; i++)
          for (let j = 0; j < nv; j++) {
            const a = (i / nu) * TAU,
              b = (j / nv) * TAU,
              q = R + Math.cos(b) * r;
            f(Math.cos(a) * q, Math.sin(b) * r, Math.sin(a) * q);
          }
      },
      mat,
      o
    );
    solid.analytic = { kind: 'torus', center: c, major: R, minor: r, frame: o?.ax };
    return solid;
  };
  // limb or branch through a list of points; radius goes r0 -> r1, or is a function of 0..1
  S.tube = (pts, r0, r1, mat, o) => {
    const rf = typeof r0 === 'function' ? r0 : t => r0 + (r1 - r0) * t,
      segs = [],
      cum = [0];
    let tot = 0,
      cx = 0,
      cy = 0,
      cz = 0,
      br = 0,
      rmax = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      tot += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
      cum.push(tot);
    }
    for (const q of pts) {
      cx += q[0] / pts.length;
      cy += q[1] / pts.length;
      cz += q[2] / pts.length;
    }
    for (const q of pts) br = Math.max(br, Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz));
    for (let i = 0; i <= 16; i++) rmax = Math.max(rmax, rf(i / 16));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        bx = b[0] - a[0],
        by = b[1] - a[1],
        bz = b[2] - a[2],
        l2 = bx * bx + by * by + bz * bz;
      if (l2 > 1e-10) segs.push([a[0], a[1], a[2], bx, by, bz, l2, rf(cum[i] / tot), rf(cum[i + 1] / tot)]);
    }
    const p = {
      bc: [cx, cy, cz],
      br: br + rmax,
      // how far along the tube (0 at its first point, 1 at its last) the nearest part of it is: an attribute, `along`
      along(x, y, z) {
        let d = 1e9,
          at = 0;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i],
            px = x - s[0],
            py = y - s[1],
            pz = z - s[2];
          let t = (px * s[3] + py * s[4] + pz * s[5]) / s[6];
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const q = Math.hypot(px - s[3] * t, py - s[4] * t, pz - s[5] * t);
          if (q < d) ((d = q), (at = (cum[i] + (cum[i + 1] - cum[i]) * t) / tot));
        }
        return at;
      },
      sd(x, y, z) {
        let d = 1e9;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i],
            px = x - s[0],
            py = y - s[1],
            pz = z - s[2];
          let t = (px * s[3] + py * s[4] + pz * s[5]) / s[6];
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const q = Math.hypot(px - s[3] * t, py - s[4] * t, pz - s[5] * t) - (s[7] + (s[8] - s[7]) * t);
          if (q < d) d = q;
        }
        return d;
      },
      sample(f) {
        const res = this.res,
          sphere = (q, r) => {
            const n = Math.ceil((12.6 * r * r) / (res * res));
            for (let i = 0; i < n; i++) {
              const d = fib(i, n);
              f(q[0] + d[0] * r, q[1] + d[1] * r, q[2] + d[2] * r);
            }
          };
        for (let si = 0; si < segs.length; si++) {
          const s = segs[si],
            len = Math.sqrt(s[6]),
            ax = s[3] / len,
            ay = s[4] / len,
            az = s[5] / len;
          let ux = -az,
            uz = ax,
            ul = Math.hypot(ux, uz);
          if (ul < 1e-4) {
            ux = 1;
            uz = 0;
            ul = 1;
          }
          ux /= ul;
          uz /= ul;
          const vx = ay * uz,
            vy = az * ux - ax * uz,
            vz = -ay * ux,
            st = Math.max(1, Math.ceil(len / res));
          for (let j = 0; j < st; j++) {
            const t = (j + 0.5) / st,
              r = s[7] + (s[8] - s[7]) * t,
              cnt = Math.max(3, Math.ceil((TAU * r) / res));
            for (let k = 0; k < cnt; k++) {
              const a = ((k + j * 0.5) / cnt) * TAU,
                ca = Math.cos(a) * r,
                sa = Math.sin(a) * r;
              f(s[0] + s[3] * t + ux * ca + vx * sa, s[1] + s[4] * t + vy * sa, s[2] + s[5] * t + uz * ca + vz * sa);
            }
          }
          if (si > 0) {
            const q = segs[si - 1],
              ql = Math.sqrt(q[6]);
            if ((q[3] * s[3] + q[4] * s[4] + q[5] * s[5]) / (ql * len) < 0.95) sphere(s, s[7]);
          }
        }
        sphere(pts[0], rf(0));
        sphere(pts[pts.length - 1], rf(1));
      }
    };
    if (measureBounds && segs.length) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const segment of segs) for (let i = 0; i < 3; i++) {
        const a = segment[i], b = a + segment[i + 3];
        min[i] = Math.min(min[i], a - segment[7], b - segment[8]);
        max[i] = Math.max(max[i], a + segment[7], b + segment[8]);
      }
      p.geometryBounds = { min, max };
    }
    return add(p, mat, o);
  };
  // the ground: flat at o.y, or a height function o.h(x, z); only a ragged disc of it (o.rad, o.zs squashes it front to back) is drawn
  S.ground = (mat, o) => {
    o = o || {};
    const hf = o.h || null,
      y0 = o.y || 0,
      rad = o.rad || 8,
      cx = o.cx || 0,
      cz = o.cz || 0,
      edge = o.edge === undefined ? 0.16 : o.edge,
      zs = o.zs || 1;
    const p = {
      bc: [0, 0, 0],
      br: 1e9,
      sd: hf ? (x, y, z) => (y - hf(x, z)) * 0.7 : (x, y, z) => y - y0,
      sample(f) {
        const res = this.res;
        let row = 0;
        for (let z = -rad / zs; z <= rad / zs; z += res * 0.87, row++)
          for (let x = -rad + (row % 2) * res * 0.5; x <= rad; x += res) {
            const r = Math.hypot(x, z * zs),
              a = Math.atan2(z, x);
            if (
              r >
              rad * (1 - edge * 2 + edge * 2 * fbm(Math.cos(a) * 1.6 + 5 + cx, Math.sin(a) * 1.6 + 5, 3.3 + cz, 3))
            )
              continue;
            if (o.keep && !o.keep(cx + x, cz + z)) continue;
            f(cx + x, hf ? hf(cx + x, cz + z) : y0, cz + z);
          }
      }
    };
    return add(p, mat, o);
  };

  // a rectangular piece of a larger ground: sample points sit on one world-wide lattice, so neighbouring pieces meet without seams
  S.terrain = (mat, o) => {
    const hf = o.h,
      p = {
        bc: [0, 0, 0],
        br: 1e9,
        sd: (x, y, z) => (y - hf(x, z)) * 0.7,
        sample(f) {
          const res = this.res,
            dz = res * 0.87;
          for (let j = Math.ceil(o.z0 / dz); j * dz < o.z1; j++) {
            const z = j * dz,
              off = (((j % 2) + 2) % 2) * res * 0.5;
            for (let i = Math.ceil((o.x0 - off) / res); i * res + off < o.x1; i++) {
              const x = i * res + off;
              if (o.keep && !o.keep(x, z)) continue;
              f(x, hf(x, z), z);
            }
          }
        }
      };
    return add(p, mat, o);
  };

  // ---------------- the combined field ----------------
  function psd(p, x, y, z) {
    let d = p.sd(x, y, z);
    if (p.bump && d > p.bump[0] + 0.25) return d - p.bump[0]; // far away: skip the noise, stay conservative
    if (p.bump) d -= p.bump[0] * (n3(x * p.bump[1] + p.g * 3.7, y * p.bump[1], z * p.bump[1]) * 1.5 - 0.75);
    return d;
  }
  // A coarse grid lists, for each cell, only the solids that can come within MARG of it; beyond that the
  // field just reports MARG, which is all the shadow and occlusion marches need.
  const MARG = 1.0;
  let grid = null,
    always = [],
    gmin = [0, 0, 0],
    gdim = [1, 1, 1],
    CS = 1.25;
  function buildGrid() {
    pos.sort((a, b) => a.g - b.g);
    let lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    always = [];
    for (const p of pos) {
      if (p.br > 1e8) {
        always.push(p);
        continue;
      }
      const e = p.br + p.k + MARG;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p.bc[k] - e);
        hi[k] = Math.max(hi[k], p.bc[k] + e);
      }
    }
    if (lo[0] > hi[0]) {
      lo = [0, 0, 0];
      hi = [1, 1, 1];
    }
    CS = Math.max(0.9, Math.cbrt(((hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])) / 50000));
    gmin = lo;
    gdim = [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k]) / CS)));
    grid = new Array(gdim[0] * gdim[1] * gdim[2]);
    for (const p of pos) {
      const inf = p.br > 1e8,
        e = p.br + p.k + MARG,
        a = [0, 1, 2].map(k => (inf ? 0 : Math.max(0, Math.floor((p.bc[k] - e - lo[k]) / CS)))),
        b = [0, 1, 2].map(k => (inf ? gdim[k] - 1 : Math.min(gdim[k] - 1, Math.floor((p.bc[k] + e - lo[k]) / CS))));
      for (let ix = a[0]; ix <= b[0]; ix++)
        for (let iy = a[1]; iy <= b[1]; iy++)
          for (let iz = a[2]; iz <= b[2]; iz++) {
            const c = (ix * gdim[1] + iy) * gdim[2] + iz;
            (grid[c] || (grid[c] = [])).push(p);
          }
    }
  }
  function field(x, y, z, exclude, proxyOnly, castOnly) {
    let d = 1e9,
      gd = 1e9,
      cur = -1,
      gk = 0,
      o = null,
      go = null,
      list = always;
    const ix = Math.floor((x - gmin[0]) / CS),
      iy = Math.floor((y - gmin[1]) / CS),
      iz = Math.floor((z - gmin[2]) / CS);
    if (ix >= 0 && iy >= 0 && iz >= 0 && ix < gdim[0] && iy < gdim[1] && iz < gdim[2])
      list = grid[(ix * gdim[1] + iy) * gdim[2] + iz] || always;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p === exclude || proxyOnly && p.mat.omitFromProxy || castOnly && p.shadowCaster === false) continue;
      if (p.g !== cur) {
        if (gd < d) {
          d = gd;
          o = go;
        }
        cur = p.g;
        gd = 1e9;
        go = null;
        gk = p.k;
      }
      if (p.br < 1e8) {
        const m = (gd < d ? gd : d) + gk + p.br,
          dx = x - p.bc[0],
          dy = y - p.bc[1],
          dz = z - p.bc[2];
        if (m <= 0 || dx * dx + dy * dy + dz * dz > m * m) continue;
      }
      if (p.lowerBound) {
        const limit = Math.min(d,gd) + gk + (p.bump ? p.bump[0] : 0) + 1e-9;
        if (p.lowerBound(x,y,z,limit) > limit) continue;
      }
      const pd = psd(p, x, y, z);
      // A distance function may be undefined outside its solid. Keep that sample out of the smooth union.
      if (Number.isNaN(pd)) continue;
      if (gk > 0 && gd < 1e8) {
        const h = Math.max(gk - Math.abs(gd - pd), 0) / gk;
        if (pd < gd) go = p;
        gd = Math.min(gd, pd) - h * h * gk * 0.25;
      } else if (pd < gd) {
        gd = pd;
        go = p;
      }
    }
    if (gd < d) {
      d = gd;
      o = go;
    }
    if (d > MARG) d = MARG;
    own = o;
    ownNeg = null;
    for (let i = 0; i < neg.length; i++) {
      const p = neg[i],
        dx = x - p.bc[0],
        dy = y - p.bc[1],
        dz = z - p.bc[2],
        m = p.br + 0.5;
      if (dx * dx + dy * dy + dz * dz > m * m) continue;
      const nd = -psd(p, x, y, z);
      if (nd > d) {
        d = nd;
        ownNeg = p;
      }
    }
    return d;
  }
  let gm = 1; // how steep the field is at the last point: roughness makes it steeper than a true distance
  function grad(x, y, z, d, e = 0.012) {
    g3[0] = field(x + e, y, z) - d;
    g3[1] = field(x, y + e, z) - d;
    g3[2] = field(x, y, z + e) - d;
    const l = Math.hypot(g3[0], g3[1], g3[2]) || 1;
    g3[0] /= l;
    g3[1] /= l;
    g3[2] /= l;
    gm = Math.max(0.6, l / e);
  }

  // ---------------- colouring one surface point ----------------
  /* (for inked detail the same point-colouring is asked again at sixteen places round a dab. Then PRB is set: nothing is laid down, the
     colour is handed back, and what is dear to work out, how shut in the place is, whether the sun and each lamp reach it, how thick
     the body is behind it, is taken from the dab's own answer unless the dab sits on the edge of a shadow) */
  let PRB = 0,
    LAO = 1,
    LSH = -1,
    LTH = 0,
    LTN = 0;
  const RLOG = (typeof globalThis !== 'undefined' && globalThis.INK_RAMPS) || null,
    LLS = [],
    BTAP = { ramp: [], t: [] };
  /* ---------------- attributes ----------------
     What a surface point is like, measured where it is baked, for materials to use:
       A.curv   curvature: + where the surface bulges (an edge, a knuckle), - in a hollow (a crease, the foot of a wall); 1/units
       A.cav    how shut in it is: 0 open to the sky .. 1 deep in a crevice
       A.hollow max(cav, the hollowness of the curvature): where dirt, moss and water gather
       A.up     which way it faces: 1 straight up, -1 straight down
       A.rel    how high it is within its own solid: 0 at the bottom of it, 1 at the top
       A.along  how far along its limb it is, for tubes and sweeps (0 at the root, 1 at the tip); otherwise A.rel
       A.y      its height in the world
       and any made with S.attr(name, (x, y, z, A) => value).
     A material reads them through mod(x, y, z, ny, A), tex(x, y, z, ny, t, nx, nz, A) and rf(x, y, z, A), or through rules:
       m.by = [{ a: 'curv', from: 2, to: 5, t: 0.3 }, { a: 'hollow', from: 0.3, to: 0.6, ramp: [..] }]
          each rule weighs its attribute from `from` (nothing) to `to` (all of it); t moves the point up its ramp by that much,
          ramp changes the ramp where the weight is over a half (with a ragged edge), both may be given
       m.wear  = { from, to, t }      short for a curvature rule that lightens edges   (from 2.5, to 6, t 0.3)
       m.grime = { from, to, ramp, t } short for a hollow rule                          (from 0.35, to 0.7)
       m.root  = 0.3                  darker by that much toward the root of a limb (along 0), lighter toward its tip */
  const A = { curv: 0, cav: 0, hollow: 0, up: 0, rel: 0, along: 0, y: 0, own: null },
    ATTR = [];
  let curP = null,
    FLO = null;
  S.attr = (name, fn) => ATTR.push([name, fn]);
  const wantsA = m => m.by || m.wear || m.grime || m.root !== undefined || m.attr || ATTR.length || S.keepAttrs,
    // curvature costs eight looks at the field: only for what uses it
    wantsCurv = m =>
      m.wear ||
      m.grime ||
      m.attr ||
      ATTR.length ||
      S.keepAttrs ||
      (m.by && m.by.some(r => r.a === 'curv' || r.a === 'hollow'));
  function measure(res, x, y, z, nx, ny, nz, ao, cheap) {
    if (cheap) {
      A.curv = 0;
      A.cav = ao === undefined ? 0 : 1 - ao;
      A.hollow = A.cav;
      A.up = ny;
      A.y = y;
      A.own = curP;
      A.rel = curP && curP.br < 1e8 ? clamp((y - (curP.bc[1] - curP.br)) / (2 * curP.br), 0, 1) : 0;
      A.along = curP && curP.along ? curP.along(x, y, z) : A.rel;
      return A;
    }
    // curvature: how the normal turns a little way off in two directions across the surface
    const h = Math.max(0.02, res * 0.8),
      sg0 = g3[0],
      sg1 = g3[1],
      sg2 = g3[2],
      sgm = gm,
      so = own,
      son = ownNeg;
    let ux = -nz,
      uz = nx,
      ul = Math.hypot(ux, uz);
    if (ul < 1e-3) ((ux = 1), (uz = 0), (ul = 1));
    ux /= ul;
    uz /= ul;
    const vx = ny * uz,
      vy = nz * ux - nx * uz,
      vz = -ny * ux;
    let k = 0,
      n = 0;
    grad(x + ux * h, y, z + uz * h, field(x + ux * h, y, z + uz * h));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > -0.4) ((k += ((g3[0] - nx) * ux + (g3[2] - nz) * uz) / h), n++);
    grad(x + vx * h, y + vy * h, z + vz * h, field(x + vx * h, y + vy * h, z + vz * h));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > -0.4)
      ((k += ((g3[0] - nx) * vx + (g3[1] - ny) * vy + (g3[2] - nz) * vz) / h), n++);
    g3[0] = sg0;
    g3[1] = sg1;
    g3[2] = sg2;
    gm = sgm;
    own = so;
    ownNeg = son;
    if (ao === undefined) {
      let occ = 0,
        w = 1;
      for (let j = 1; j <= 3; j++) {
        const hh = S.aoR * j;
        occ += (Math.max(0, hh - field(x + nx * hh, y + ny * hh, z + nz * hh)) * w) / hh;
        w *= 0.6;
      }
      ao = clamp(1 - (S.aoK * occ) / 1.96, 0, 1);
    }
    A.curv = n ? k / n : 0;
    A.cav = 1 - ao;
    A.hollow = Math.max(A.cav, clamp(-A.curv * 0.15, 0, 1));
    A.up = ny;
    A.y = y;
    A.own = curP;
    A.rel = curP && curP.br < 1e8 ? clamp((y - (curP.bc[1] - curP.br)) / (2 * curP.br), 0, 1) : 0;
    A.along = curP && curP.along ? curP.along(x, y, z) : A.rel;
    for (let i = 0; i < ATTR.length; i++) A[ATTR[i][0]] = ATTR[i][1](x, y, z, A);
    return A;
  }
  // the material's rules on attributes: how far up its ramp to move, and which ramp
  function rules(m, ramp, t, x, y, z) {
    const list = m.by ? m.by.slice() : [];
    if (m.wear) list.push(Object.assign({ a: 'curv', from: 2.5, to: 6, t: 0.3 }, m.wear));
    if (m.grime) list.push(Object.assign({ a: 'hollow', from: 0.35, to: 0.7 }, m.grime));
    if (m.root !== undefined) list.push({ a: 'along', from: 0, to: 1, t: m.root, centre: true });
    for (let i = 0; i < list.length; i++) {
      const r = list[i],
        v = A[r.a];
      if (v === undefined) continue;
      let w = clamp((v - r.from) / (r.to - r.from || 1e-6), 0, 1);
      w = w * w * (3 - 2 * w);
      if (r.t) t += r.t * (r.centre ? w - 0.5 : w) * 2 * (r.centre ? 1 : 0.5);
      if (r.ramp && w + (n3(x * 2.3 + i * 7, y * 2.3, z * 2.3) - 0.5) * (r.edge === undefined ? 0.5 : r.edge) > 0.5)
        ramp = r.ramp;
    }
    RR[0] = ramp;
    RR[1] = t;
    return RR;
  }
  const bevelMaterials = new Map(), bevelPrimitives = new WeakMap();
  let bevelSculpt;
  function bevelDistance(settings, owner) {
    if (!bevelMaterials.has(settings)) bevelMaterials.set(settings, SurfaceLook.needsDistance(settings));
    if (!bevelMaterials.get(settings)) return undefined;
    if (owner?.bevelDistance) return owner.bevelDistance;
    if (owner && (owner.whole || ghosts.includes(owner))) {
      if (!bevelPrimitives.has(owner)) bevelPrimitives.set(owner, (x, y, z) => psd(owner, x, y, z));
      return bevelPrimitives.get(owner);
    }
    if (!bevelSculpt && pos.length) {
      const sculpt = makeSculpt(B, { positive: pos.slice(), negative: neg.slice() });
      sculpt.ready();
      bevelSculpt = sculpt.sdf;
    }
    return bevelSculpt;
  }
  const RR = [null, 0];
  function light(m, res, x, y, z, nx, ny, nz, full, selected, fine, coarse = false) {
    if (!coarse && S.clip && !S.clip(x, y, z)) return;
    /* born: when this dab appears (growth you can watch). A material's or a solid's o.born: seconds, or (x, y, z, along) -> seconds */
    const bn = m.born !== undefined ? m.born : curP && curP.born !== undefined ? curP.born : null;
    if (!coarse) B.born(
      bn === null ? null : typeof bn === 'function' ? bn(x, y, z, curP && curP.along ? curP.along(x, y, z) : 0) : bn
    );
    /* wet: when the rain has soaked this dab, so that it darkens from then on. m.wet, or S.wet for everything: seconds, or
       (x, y, z, ny) -> seconds (null: it stays dry). S.open(x, y, z) says how open to the sky a place is, for deciding */
    const wt = m.wet !== undefined ? m.wet : S.wet;
    if (!coarse) B.wet(wt === undefined || wt === null ? null : typeof wt === 'function' ? wt(x, y, z, ny) : wt);
    let AA = null;
    const probe = PRB || coarse, receive = receivesShadow(curP, m);
    let hadShadow = false;
    if (!probe) LLS.length = 0;
    /* form: the shape this is lit as, not the one it has (a crown lit as the few balls it is made of, a rock as its flat faces):
       m.form(x, y, z, nx, ny, nz) -> [nx, ny, nz], or nothing to keep its own */
    const gx = nx,
      gy = ny,
      gz = nz;
    if (m.form) {
      const f = m.form(x, y, z, nx, ny, nz);
      if (f) ((nx = f[0]), (ny = f[1]), (nz = f[2]));
    }
    let ramp = m.rf ? m.rf(x, y, z) || m.r : m.r,
      t,
      ao = 1,
      shd = 0,
      lb = null,
      lbc = 0;
    const m0 = m;
    if (m.em) t = m.v === undefined ? 1 : m.v;
    else {
      let sun = nx * L[0] + ny * L[1] + nz * L[2];
      if (full) {
        if (probe) ao = LAO;
        else {
          let occ = 0,
            w = 1;
          for (let j = 1; j <= 3; j++) {
            const h = S.aoR * j;
            occ += (Math.max(0, h - field(x + nx * h, y + ny * h, z + nz * h)) * w) / h;
            w *= 0.6;
          }
          ao = clamp(1 - (S.aoK * occ) / 1.96, 0, 1);
          LAO = ao;
          LSH = -1;
        }
        if (sun > 0 && S.sunK > 0 && m.leaf) sun *= 0.8;
        else if (receive && sun > 0 && S.sunK > 0) {
          let tt = 0.07,
            sh = 1;
          if (coarse || PRB && (LSH === 0 || LSH === 1)) sh = LSH;
          else
            for (let i = 0; i < 20 && tt < S.shLen; i++) {
              const h = shadowDistance(x + nx * 0.05 + L[0] * tt, y + ny * 0.05 + L[1] * tt, z + nz * 0.05 + L[2] * tt);
              if (h < 0.004) {
                sh = 0;
                break;
              }
              // The field's outside distance is capped. It represents empty
              // space, which should not create a distant penumbra.
              if (!shadowArt || h < MARG) sh = Math.min(sh, (S.shK * h) / tt);
              tt += h < 0.05 ? 0.05 : h > 0.9 ? 0.9 : h;
            }
          if (!probe) LSH = sh;
          hadShadow = sh < 1;
          sh = ShadowArt.transfer(shadowArt, sh, coarse);
          sun *= sh;
          shd = 1 - sh;
        }
      }
      if (sun < 0) sun = 0;
      if (S.mask && sun > 0) sun *= S.mask(x, y, z);
      const v = ao * (S.amb + S.sky * (0.5 + 0.5 * ny)) + S.sunK * sun;
      let pl = 0;
      for (let i = 0; i < S.lights.length; i++) {
        const li = S.lights[i],
          lx = li.p[0] - x,
          ly = li.p[1] - y,
          lz = li.p[2] - z,
          dist = Math.hypot(lx, ly, lz);
        if (dist > li.r) continue;
        const nd = (nx * lx + ny * ly + nz * lz) / (dist || 1),
          fa = 1 - dist / li.r;
        let c = fa * fa * li.s * (0.2 + 0.8 * Math.max(nd, 0));
        if (full && receive && li.sh && c > 0.03 && nd > 0) {
          let k2 = 1;
          if (probe && LLS[i] !== undefined) k2 = LLS[i];
          else {
            let tt = 0.08;
            for (let k = 0; k < 20 && tt < dist - 0.12; k++) {
              const h = shadowDistance(
                x + nx * 0.05 + (lx / dist) * tt,
                y + ny * 0.05 + (ly / dist) * tt,
                z + nz * 0.05 + (lz / dist) * tt
              );
              if (h < 0.004) {
                k2 = 0.12;
                break;
              }
              tt += h < 0.06 ? 0.06 : h;
            }
            if (!probe) LLS[i] = k2;
          }
          hadShadow ||= k2 < 1;
          c *= ShadowArt.transfer(shadowArt, k2, coarse);
        } else if (!probe) LLS[i] = undefined;
        pl += c * (0.4 + 0.6 * ao);
        if (c > lbc) {
          lbc = c;
          lb = li;
        }
      }
      t = v + pl + (m.b || 0) + S.wob * (n3(x * 3.1 + 7, y * 3.1, z * 3.1) - 0.5);
      /* Light through the body (wax, jelly, a leaf, an ear). Two distances are measured from just under this point: how far it is through
         the solid toward the sun, and how far straight in. Light that has come a short way through arrives on the side turned away from the
         sun; it dies off smoothly with distance, so a thick body shows a dark saturated band where the glow gives out and a bright one where
         the body is thinnest. Thin parts glow a little whichever way they face, and the lit side wraps softly round the terminator instead
         of stopping at it. sss: { depth (how far light gets), k (how strong), ramp (what it glows, dark to bright), at (where the glow ramp
         takes over) } */
      if (m.sss) {
        const q = m.sss,
          dp = q.depth || 0.8,
          kk = q.k === undefined ? 0.5 : q.k,
          sx = S.sun[0],
          sy = S.sun[1],
          sz = S.sun[2],
          ins = Math.min(0.05, res * 0.4),
          x0 = x - nx * ins,
          y0 = y - ny * ins,
          z0 = z - nz * ins;
        let th = 0,
          tn = 0;
        if (PRB) ((th = LTH), (tn = LTN));
        else {
          for (let k = 0; k < 24 && th < dp * 2.5; k++) {
            const h = field(x0 + sx * (th + ins), y0 + sy * (th + ins), z0 + sz * (th + ins));
            if (h > 0) break;
            th += Math.max(ins, -h);
          }
          for (let k = 0; k < 14 && tn < dp * 1.5; k++) {
            const h = field(x0 - nx * (tn + ins), y0 - ny * (tn + ins), z0 - nz * (tn + ins));
            if (h > 0) break;
            tn += Math.max(ins, -h);
          }
          LTH = th;
          LTN = tn;
        }
        const nl = nx * sx + ny * sy + nz * sz,
          through = Math.exp(-th / (dp * 0.45)),
          thin = Math.exp(-tn / (dp * 0.3)),
          aw = clamp((0.35 - nl) / 0.9, 0, 1),
          away = aw * aw * (3 - 2 * aw),
          wr = clamp((nl + 0.55) / 1.55, 0, 1),
          lit = kk * (through * away + 0.3 * thin * (0.35 + 0.65 * away));
        /* a light inside the body (core: { p, r, k }) shows through the skin in front of it, as the eye at S.view sees it: brightest where the
           line of sight passes nearest its middle, dimmer the deeper it lies */
        let glow = lit;
        if (q.core) {
          // (core.b: the light is a line from core.p to core.b, the axis of a crystal; it is looked at in five places along it)
          const cz = q.core,
            vw = S.view || VIEW0,
            nk = cz.b ? 5 : 1;
          let best = 0;
          for (let k = 0; k < nk; k++) {
            const f = nk > 1 ? k / (nk - 1) : 0,
              cp0 = cz.b ? cz.p[0] + (cz.b[0] - cz.p[0]) * f : cz.p[0],
              cp1 = cz.b ? cz.p[1] + (cz.b[1] - cz.p[1]) * f : cz.p[1],
              cp2 = cz.b ? cz.p[2] + (cz.b[2] - cz.p[2]) * f : cz.p[2],
              px = cp0 - x,
              py = cp1 - y,
              pz = cp2 - z,
              along = -(px * vw[0] + py * vw[1] + pz * vw[2]);
            if (along > 0) {
              const ex = px + vw[0] * along,
                ey = py + vw[1] * along,
                ez = pz + vw[2] * along,
                gl = Math.exp(-(ex * ex + ey * ey + ez * ez) / (cz.r * cz.r)) * Math.exp(-along / (dp * 1.5));
              if (gl > best) best = gl;
            }
          }
          glow += (cz.k === undefined ? 0.7 : cz.k) * best;
        }
        t += S.sunK * 0.4 * Math.max(0, wr * wr - Math.max(0, nl)) * ao + glow;
        if (q.ramp) {
          const at = q.at === undefined ? 0.22 : q.at;
          if (glow > at) {
            ramp = q.ramp;
            t = clamp(0.1 + ((glow - at) / Math.max(0.08, kk * 0.85 - at)) * 0.9, 0, 0.999);
          }
        }
      }
      AA = wantsA(m) ? measure(res, x, y, z, nx, ny, nz, full ? ao : undefined, !wantsCurv(m)) : null;
      if (m.mod) t += m.mod(x, y, z, ny, AA);
      if (m.top && ny > m.top.min + 0.35 * (n3(x * 1.9, y * 1.9, z * 1.9) - 0.5)) ((m = m.top), (ramp = m.r));
      // a second ramp for sunlit surfaces lets shadows shift hue instead of only getting darker
      if (m.s) {
        if (S.sunK * sun > 0.2) {
          ramp = m.s;
          t = (t - 0.3) / 0.75;
        } else t = t / 0.5;
      }
      if (m.g && pl > v * 0.8)
        ramp =
          lb && lb.c ? (lb.cache || (lb.cache = {}))[m.g[0]] || (lb.cache[m.g[0]] = [m.g[0], lb.c[0], lb.c[1]]) : m.g;
    }
    if (AA && !m.em) {
      const r = rules(m, ramp, t, x, y, z);
      ramp = r[0];
      t = r[1];
    }
    if (!coarse && AA && S.keepAttrs) B.attrNext(AA.curv * res, AA.cav, AA.up, AA.along);
    const style = materialStyle(m.pixelStyle ?? m0.pixelStyle);
    if (style?.highlight && !m.em && !m.glass)
      t = MaterialPixelStyle.lighting(t, style.highlight, nx, ny, nz, L, S.view || VIEW0);
    const shade = style && (style.mode || style.steps) ? MaterialPixelStyle.rampPair(t, style.steps, ramp) : null;
    let ci = shade ? shade[shade[2] < .5 ? 0 : 1] : ramp[clamp(Math.floor(t * ramp.length), 0, ramp.length - 1)],
      flat = false;
    if (RLOG && !probe)
      RLOG.set(ramp, (RLOG.get(ramp) || 0) + 1); /* which ramps a diorama is shaded on, for `ink-studio ramps` */
    if (m.tex) {
      const q = m.tex(x, y, z, ny, t, nx, nz, AA);
      if (q === -1) return;
      if (q !== undefined) {
        ci = q;
        flat = true;
      }
    }
    /* a wet or polished thing has a small hard highlight where it mirrors the sun to the eye. The eye is taken to be at S.view (set it to the
       way the camera looks from); gloss: { c (palette index), at (how small: 0.95), c2 and at2 (a dimmer ring round it) } */
    const surface = m.surface === undefined ? m0.surface : m.surface;
    let glint = false;
    if (m.gloss && !style?.highlight && !surface && !m.em && !flat) {
      const g = m.gloss,
        vw = S.view || VIEW0,
        hx = L[0] + vw[0],
        hy = L[1] + vw[1],
        hz = L[2] + vw[2],
        nh = (nx * hx + ny * hy + nz * hz) / (Math.hypot(hx, hy, hz) || 1);
      if (nh > (g.at || 0.95)) {
        ci = g.c;
        glint = flat = true;
      } else if (g.c2 !== undefined && nh > (g.at2 || 0.88)) {
        ci = g.c2;
        flat = true;
      }
    }
    if (coarse) return { ci, ramp: flat && !m.pat ? undefined : ramp, t, noLine: m0.line === false || m.line === false,
      visibility: 1 - shd };
    if (PRB) return ci;
    const bevel = surface ? bevelDistance(surface, curP) : undefined;
    selected?.(m, style, style?.mode && !flat && !m.glass && shade?.[0] !== shade?.[1] ? shade : null);
    const fl =
      FLO || m.motionAt?.(x, y, z) || m.fl || (m.em ? EM : glint ? GLINT : (m.leaf || m.blade) && !m.still ? (m.leaf ? WINDL : WINDG) : undefined);
    if (m.leaf && !flat) {
      const lf = m.leaf,
        a = R() * TAU,
        ca = Math.cos(a),
        sa = Math.sin(a),
        lift = lf.lift === undefined ? 0.3 : lf.lift;
      let ux = -nz,
        uz = nx,
        ul = Math.hypot(ux, uz);
      if (ul < 1e-3) {
        ux = 1;
        uz = 0;
        ul = 1;
      }
      ux /= ul;
      uz /= ul;
      const vx = ny * uz,
        vy = nz * ux - nx * uz,
        vz = -ny * ux,
        tx = ux * ca + vx * sa + nx * lift,
        ty = vy * sa + ny * lift,
        tz = uz * ca + vz * sa + nz * lift,
        tl = Math.hypot(tx, ty, tz);
      if (lf.l) {
        // an explicit leaf size (feathers, scales): keep the plain shard
        ci =
          ramp[
            clamp(Math.floor(t * ramp.length + (R() - 0.5) * (lf.j === undefined ? 1.3 : lf.j)), 0, ramp.length - 1)
          ];
        if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, [tx / tl, ty / tl, tz / tl], bevel);
        stick(
          x + nx * 0.04,
          y + ny * 0.04,
          z + nz * 0.04,
          [tx / tl, ty / tl, tz / tl],
          lf.l,
          lf.w || res * 0.5,
          P[ci],
          3,
          fl
        );
        return;
      }
      // foliage on a solid (bushes, hedges, moss, vines): the same leaves as a tree crown. Tone comes from which way the leaf
      // faces and from the lobe it belongs to, so a bush reads as lit masses of leaves and matches the trees beside it.
      const base = (m0.r || []).concat(m0.s || []),
        tones = (m0.g && ramp === m0.g ? m0.g : base).filter((c, i, arr) => arr.indexOf(c) === i);
      const band = n3(x * 0.8 + 3.3, y * 0.8 + 7.1, z * 0.8 + 1.9),
        li = 0.2 + 0.2 * ny + 0.26 * Math.max(-0.4, nx * L[0] + ny * L[1] + nz * L[2]) + 0.42 * band + 0.25 * (ao - 1);
      ci = tones[clamp(Math.floor(li * tones.length + (R() - 0.5) * 1.1), 0, tones.length - 1)];
      const size = (R() < 0.32 ? 0.12 + R() * 0.1 : 0.06 + R() * 0.065) * 2.3 * clamp(res * 5.2, 0.45, 1.1),
        out = 0.04 + R() * size * 0.6;
      if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, [tx / tl, ty / tl, tz / tl], bevel);
      stick(
        x + nx * out,
        y + ny * out,
        z + nz * out,
        [tx / tl, ty / tl, tz / tl],
        size * 1.15,
        size * 0.5,
        P[ci],
        3,
        fl
      );
      return;
    }
    if (m.blade && !flat && ny > 0.45) {
      // grass: tall tapered blades, dark at the root and light at the tip, growing in patches of
      // tone and height with worn places between, so the lawn reads as tufts rather than as speckle
      const bl = m.blade,
        n = ramp.length,
        tone = n3(x * 0.33 + 11.3, z * 0.33 + 4.1, 4.2),
        tall = n3(x * 0.55 + 3.7, z * 0.55 + 8.9, 1.7),
        wear = n3(x * 0.8 + 21.1, z * 0.8 + 2.3, 6.4);
      const kf = t * n + (tone - 0.5) * 1.5 * (1 - 0.7 * shd) - 0.35 * shd,
        k = clamp(Math.floor(kf), 0, n - 1),
        lo = ramp[Math.max(0, k - 1)],
        mid = ramp[k],
        hi = ramp[Math.min(n - 1, k + 1)];
      if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, undefined, bevel);
      disc(x, y, z, [nx, ny, nz], res * S.fat, res * 0.3, P[lo], 3, m.fl);
      if (wear > 0.7 && R() < (wear - 0.7) * 6) return;
      const h = (bl.h || 0.15) * 2.1 * (0.45 + 1.1 * tall) * (0.55 + 0.75 * R()),
        w = (bl.w || 0.032) * 1.9 * (0.8 + 0.5 * R());
      const lx = (R() - 0.5) * 0.5,
        lz = (R() - 0.5) * 0.5,
        ll = Math.hypot(lx, 1, lz),
        ax = [lx / ll, 1 / ll, lz / ll];
      if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, ax, bevel);
      stick(
        x + ax[0] * h * 0.3,
        y + ax[1] * h * 0.3,
        z + ax[2] * h * 0.3,
        ax,
        h * 0.34,
        w,
        P[lo === mid ? mid : R() < 0.55 ? lo : mid],
        3,
        fl
      );
      if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, ax, bevel);
      stick(
        x + ax[0] * h * 0.72,
        y + ax[1] * h * 0.72,
        z + ax[2] * h * 0.72,
        ax,
        h * 0.3,
        w * 0.55,
        P[R() < 0.3 + 0.5 * (kf - k) ? hi : mid],
        3,
        fl
      );
      return;
    }
    if (m.fur && !flat) {
      /* Fur. Each point of the skin grows a few hairs, each of three strokes that droop more toward the tip, so a hair curves. The coat lies
         along `comb` laid into the surface (or hangs, if none is given), `lay` saying how flat. Neighbouring hairs lean and lengthen
         together (a slow noise, not a throw of the dice for each), which is what makes locks and tufts. A hair is darkest at the root and
         lightest at the tip; where the light rakes across the coat the tips step up again (the sheen), and round the edge of the lit side
         they catch the light from behind (the rim: its own ramp if given). Under it all the skin is drawn two tones down.
         fur: { len, comb [x, y, z], lay, droop, clump, n (hairs to a point), w, rim (ramp), still } */
      const f = m.fur,
        n = ramp.length,
        k = clamp(Math.floor(t * n), 0, n - 1),
        cb = f.comb || g3,
        lay = f.lay === undefined ? 0.5 : f.lay,
        dr = f.droop === undefined ? 0.35 : f.droop,
        cl = f.clump === undefined ? 0.6 : f.clump,
        len0 = f.len || 0.3,
        w = f.w || res * 0.3,
        hairs = f.n || 2,
        fq = 0.7 / len0,
        sway = f.still ? undefined : WINDG,
        nl = nx * L[0] + ny * L[1] + nz * L[2],
        rim = clamp(1 - Math.abs(nl + 0.06) / 0.26, 0, 1) * (1 - shd);
      let fx = cb[0],
        fy = cb[1] - (cb[0] || cb[1] || cb[2] ? 0 : 1),
        fz = cb[2];
      const fn = fx * nx + fy * ny + fz * nz;
      fx -= nx * fn;
      fy -= ny * fn;
      fz -= nz * fn;
      const fm = Math.hypot(fx, fy, fz) || 1;
      if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, undefined, bevel);
      disc(x, y, z, [nx, ny, nz], res * S.fat, res * 0.3, P[ramp[Math.max(0, k - 2)]], 3, m.fl);
      for (let hi = 0; hi < hairs; hi++) {
        const jx = R() - 0.5,
          jy = R() - 0.5,
          jz = R() - 0.5;
        let qx = x + jx * res * 0.7,
          qy = y + jy * res * 0.7,
          qz = z + jz * res * 0.7;
        const c1 = n3(qx * fq, qy * fq, qz * fq) - 0.5,
          c2 = n3(qx * fq + 19.1, qy * fq + 7.3, qz * fq + 3.7) - 0.5,
          c3 = n3(qx * fq + 5.2, qy * fq + 31.7, qz * fq + 11.9) - 0.5,
          len = len0 * (0.55 + 0.9 * n3(qx * fq * 0.8 + 40, qy * fq * 0.8, qz * fq * 0.8)) * (hi ? 0.8 : 1),
          dx = nx * (1 - lay) + (fx / fm) * lay + cl * 1.6 * c1 + 0.22 * jx,
          dy = ny * (1 - lay) + (fy / fm) * lay + cl * 1.6 * c2 + 0.22 * jy,
          dz = nz * (1 - lay) + (fz / fm) * lay + cl * 1.6 * c3 + 0.22 * jz;
        for (let sg = 0; sg < 3; sg++) {
          const ax = norm([dx, dy - dr * (sg + 0.5) * 0.45, dz]),
            sl = len * FSEG[sg],
            rake = Math.abs(ax[0] * L[0] + ax[1] * L[1] + ax[2] * L[2]);
          let c = ramp[sg === 0 ? Math.max(0, k - 1) : sg === 1 ? k : Math.min(n - 1, k + 1)];
          if (sg === 2 && nl > 0.12 && rake < 0.3) c = ramp[Math.min(n - 1, k + 2)];
          if (sg > 0 && rim > 0.45) {
            const rr2 = f.rim;
            c =
              sg === 2 && rr2
                ? rr2[clamp(Math.floor(rim * rr2.length), 0, rr2.length - 1)]
                : ramp[Math.min(n - 1, k + sg + (rim > 0.75 ? 1 : 0))];
          }
          if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, ax, bevel);
          stick(
            qx + ax[0] * sl * 0.5,
            qy + ax[1] * sl * 0.5,
            qz + ax[2] * sl * 0.5,
            ax,
            sl * 0.62,
            w * FWID[sg],
            P[c],
            3,
            sway
          );
          qx += ax[0] * sl;
          qy += ax[1] * sl;
          qz += ax[2] * sl;
        }
      }
      return;
    }
    const alternate = shadowArt?.small && hadShadow && !m.glass && !flat ?
      light(m0, res, x, y, z, gx, gy, gz, full, undefined, undefined, true) : null;
    if ((fine ?? (S.fine || m0.fine)) && !m.glass && (m.a === undefined || m.a >= 1 || glint))
      fineTile(m0, res, x, y, z, nx, ny, nz, full, ci);
    if (S.bounce && !flat && !m.em)
      ((BTAP.ramp[B.count()] = ramp), (BTAP.t[B.count()] = t)); /* kept for the bounce pass */
    if (S.tap) S.tap(ramp, t, nx, ny, nz, flat || !!m.em, ci); // whoever is listening learns how this splat was lit (it is the next one made)
    /* colour worked out per pixel (S.pixel, for a diorama whose look.pixel is on): the dab says which ramp, how lit, which pattern and
       which way its surface truly faces; each pixel is then coloured from those where it lands. A colour a material chose itself
       (a texture with no pattern behind it), a glowing thing, glass and a glint keep the dab's own colour */
    if (S.pixel && !m.optical && !surface?.opacity && !m.em && !m.glass && !glint && (m.a === undefined || m.a >= 1) && (!flat || m.pat))
      B.pixNext(
        ramp,
        t,
        m.pat || null,
        gx,
        gy,
        gz,
        m0.form || m.form ? nx : undefined,
        ny,
        nz,
        m0.line === false || m.line === false
      );
    // (a: how solid it is, 1 and over is solid, under 1 lets what is behind show through; glass also bends what is behind it)
    if (surface) B.surfaceNext(surface, nx, ny, nz, L, 1 - shd, undefined, bevel);
    if (alternate) B.shadowNext(ci, alternate);
    if (S.follow && !m.glass) {
      formDab(res, x, y, z, nx, ny, nz, P[ci], m.a === undefined || glint ? 3 : m.a, fl);
      return;
    }
    disc(
      x,
      y,
      z,
      [nx, ny, nz],
      res * (m.fat || S.fat), // (a material may ask for bigger dabs: m.fat, against the sculpt's 0.46: stone with steps in it)
      res * 0.3,
      P[ci],
      m.a === undefined || glint ? 3 : m.a,
      m.glass ? (m.em ? GLASSEM : GLASS) : fl
    );
  }
  /* A dab laid along the form (S.follow). How the normal turns a little way off in two directions across the surface says how the
     surface bends: the two bends, and the way each runs. The dab is drawn out along the straighter way, and made bigger where neither
     bends. Round a corner (the normal jumps) nothing is concluded. */
  function formDab(res, x, y, z, nx, ny, nz, col, a, fl) {
    const F = S.follow,
      stretch = F.stretch === undefined ? 1.1 : F.stretch,
      broad = F.broad === undefined ? 1.35 : F.broad,
      h = res * 0.8,
      sg0 = g3[0],
      sg1 = g3[1],
      sg2 = g3[2],
      sgm = gm,
      so = own,
      son = ownNeg;
    let ux = -nz,
      uz = nx,
      ul = Math.hypot(ux, uz);
    if (ul < 1e-3) ((ux = 1), (uz = 0), (ul = 1));
    ux /= ul;
    uz /= ul;
    const vx = ny * uz,
      vy = nz * ux - nx * uz,
      vz = -ny * ux;
    let a11 = 0,
      a12 = 0,
      a21 = 0,
      a22 = 0,
      sure = true;
    grad(x + ux * h, y, z + uz * h, field(x + ux * h, y, z + uz * h));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > 0.5) {
      const dx = g3[0] - nx,
        dy = g3[1] - ny,
        dz = g3[2] - nz;
      a11 = (dx * ux + dz * uz) / h;
      a12 = (dx * vx + dy * vy + dz * vz) / h;
    } else sure = false;
    grad(x + vx * h, y + vy * h, z + vz * h, field(x + vx * h, y + vy * h, z + vz * h));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > 0.5) {
      const dx = g3[0] - nx,
        dy = g3[1] - ny,
        dz = g3[2] - nz;
      a21 = (dx * ux + dz * uz) / h;
      a22 = (dx * vx + dy * vy + dz * vz) / h;
    } else sure = false;
    g3[0] = sg0;
    g3[1] = sg1;
    g3[2] = sg2;
    gm = sgm;
    own = so;
    ownNeg = son;
    const st = res * S.fat;
    if (!sure) {
      disc(x, y, z, [nx, ny, nz], st, res * 0.3, col, a, fl);
      return;
    }
    const b = (a12 + a21) / 2,
      mean = (a11 + a22) / 2,
      dif = (a11 - a22) / 2,
      rad = Math.hypot(dif, b),
      k1 = Math.abs(mean + rad),
      k2 = Math.abs(mean - rad),
      th = 0.5 * Math.atan2(b, dif) + (k1 < k2 ? 0 : Math.PI / 2),
      cs = Math.cos(th),
      sn = Math.sin(th),
      aniso = clamp((Math.max(k1, k2) - Math.min(k1, k2)) * res * 3, 0, 1),
      flat = clamp(1 - Math.max(k1, k2) * res * 5, 0, 1),
      big = 1 + (broad - 1) * flat;
    B.dab(
      x,
      y,
      z,
      [nx, ny, nz],
      [ux * cs + vx * sn, vy * sn, uz * cs + vz * sn],
      st * big * (1 + stretch * aniso),
      st * big,
      res * 0.3,
      col,
      a,
      fl
    );
  }

  /* Inked detail: the surface under one dab, asked at four by four places across it. Each place takes the material of whatever solid is
     really there (so the edge between two things falls where it is, not where the dabs happen to sit), the normal as it turns across
     the dab, and its own pattern; the edge of a cast shadow is followed only by dabs that sit in one. If all sixteen agree with the
     dab nothing is kept. */
  const FT = [0, 0, 0, 0],
    FC = new Uint8Array(16),
    FS4 = [-0.75, -0.25, 0.25, 0.75];
  function fineTile(m0, res, x, y, z, nx, ny, nz, full, ci) {
    const half = res * S.fat * 1.3,
      sg0 = g3[0],
      sg1 = g3[1],
      sg2 = g3[2],
      sgm = gm,
      so = own,
      son = ownNeg;
    let ux = -nz,
      uz = nx,
      ul = Math.hypot(ux, uz);
    if (ul < 1e-3) ((ux = 1), (uz = 0), (ul = 1));
    ux /= ul;
    uz /= ul;
    const vx = ny * uz,
      vy = nz * ux - nx * uz,
      vz = -ny * ux;
    // how the normal turns across the dab (not followed round a corner)
    let ax = 0,
      ay = 0,
      az = 0,
      bx = 0,
      by = 0,
      bz = 0;
    grad(x + ux * half, y, z + uz * half, field(x + ux * half, y, z + uz * half));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > 0.6) ((ax = g3[0] - nx), (ay = g3[1] - ny), (az = g3[2] - nz));
    grad(x + vx * half, y + vy * half, z + vz * half, field(x + vx * half, y + vy * half, z + vz * half));
    if (g3[0] * nx + g3[1] * ny + g3[2] * nz > 0.6) ((bx = g3[0] - nx), (by = g3[1] - ny), (bz = g3[2] - nz));
    let differ = false;
    FT[0] = FT[1] = FT[2] = FT[3] = 0;
    PRB = 1;
    /* first only the four corners and the four middle places: where those all agree with the dab the surface is taken to be plain there */
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          if (pass === 0 && (i === 0 || i === 3) !== (j === 0 || j === 3)) continue;
          if (pass === 1 && !differ) continue;
          const s = FS4[i],
            t = FS4[j];
          let qx = x + (ux * s + vx * t) * half,
            qy = y + vy * t * half,
            qz = z + (uz * s + vz * t) * half,
            mx = nx + ax * s + bx * t,
            my = ny + ay * s + by * t,
            mz = nz + az * s + bz * t;
          const ml = Math.hypot(mx, my, mz) || 1;
          mx /= ml;
          my /= ml;
          mz /= ml;
          const d = field(qx, qy, qz);
          let mq = m0;
          /* whose surface is under this place. Something cut into the surface (a rune, a seam) is taken wherever it is near, so thin cuts
             read whole; another solid is taken only where it lies flush with this one (an inlay, the next colour of a typed-in shape).
             A thin thing standing proud keeps its own colour to the edge of its dabs, as it does without inked detail. */
          if (own && Math.abs(d) < half) {
            const cut = ownNeg && ownNeg.mat.r,
              mo = cut ? ownNeg.mat : own.mat;
            if (
              (cut || (own !== so && !ownNeg && Math.abs(d) < res * 0.2)) &&
              mo &&
              mo.r &&
              !mo.skip &&
              !mo.glass &&
              (mo.a === undefined || mo.a >= 1)
            )
              mq = mo;
            if (mq !== m0 || own === so) {
              qx -= mx * d;
              qy -= my * d;
              qz -= mz * d;
            }
          }
          let c = light(mq, res, qx, qy, qz, mx, my, mz, full);
          if (c === undefined || c < 0 || c > 63) c = ci;
          if (pass === 0) {
            if (c !== ci) differ = true;
          } else FC[j * 4 + i] = c;
        }
    PRB = 0;
    g3[0] = sg0;
    g3[1] = sg1;
    g3[2] = sg2;
    gm = sgm;
    own = so;
    ownNeg = son;
    if (differ) {
      /* a lone place of some other colour, with none like it beside it, is noise at this size: it takes the dab's colour */
      differ = false;
      for (let k = 0; k < 16; k++) {
        const c = FC[k],
          i = k & 3,
          j = k >> 2;
        let keep = c === ci;
        if (!keep)
          keep =
            (i > 0 && FC[k - 1] === c) ||
            (i < 3 && FC[k + 1] === c) ||
            (j > 0 && FC[k - 4] === c) ||
            (j < 3 && FC[k + 4] === c);
        const c2 = keep ? c : ci;
        if (c2 !== ci) differ = true;
        FT[j] += c2 * (i === 0 ? 1 : i === 1 ? 64 : i === 2 ? 4096 : 262144);
      }
    }
    if (differ) B.fineTile(FT[0], FT[1], FT[2], FT[3], ux * half, 0, uz * half, vx * half, vy * half, vz * half, P[ci]);
  }

  // ---------------- baking ----------------
  // the first surface below (x, y0, z): 1e9 if that point is inside something, -1e9 if nothing is found
  const negAll = []; // carved shapes are kept after baking so openings (arches, doorways) stay open to anything walking the scene
  const fieldAll = (x, y, z, proxyOnly, castOnly) => {
    let d = field(x, y, z, undefined, proxyOnly, castOnly);
    for (let i = 0; i < negAll.length; i++) {
      const p = negAll[i],
        dx = x - p.bc[0],
        dy = y - p.bc[1],
        dz = z - p.bc[2],
        m = p.br + 0.5;
      if (dx * dx + dy * dy + dz * dz > m * m) continue;
      const nd = -psd(p, x, y, z);
      if (nd > d) {
        d = nd;
        ownNeg = p;
      }
    }
    return d;
  };
  S.sdf = (x, y, z) => fieldAll(x, y, z);
  S.shadowSdf = shadowArt?.cast ? (x, y, z) => fieldAll(x, y, z, false, true) : S.sdf;
  if (shadowArt?.cast) S.sdf.forShadow = S.shadowSdf;
  const shadowDistance = shadowArt?.cast ? S.shadowSdf : field;
  S.proxySdf = () => hasOptionalProxy ? (x, y, z) => fieldAll(x, y, z, true) : S.sdf;
  /* Material and part ownership at a rest-pose surface. The distance field
     is retained even when the renderer samples it at a different resolution. */
  S.surfaceAt = (x, y, z, provenance = false) => {
    const distance = fieldAll(x, y, z), cut = ownNeg;
    const source = cut?.mat?.r ? cut : own;
    return { distance, material: source?.mat, tag: cut?.tag || own?.tag || null,
      ...(provenance && { owner: source?.renderOwner, target: source?.renderTarget }) };
  };
  /* (before a bake the field does not yet know where its solids are: S.ready() tells it, for whoever needs to ask early) */
  S.ready = buildGrid;
  /* Conservative rest bounds for the still-unbaked finite solids. */
  S.modelBounds = padding => {
    if (!pos.length && !neg.length) throw new Error('Model export needs an unbaked sculpt');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of pos) {
      if (!Number.isFinite(p.br) || p.br > 1e8) throw new Error('Model export needs finite solids; put the ground in a separate render pass');
      const r = p.br + Math.max(0, p.k) + padding;
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p.bc[a] - r);
        max[a] = Math.max(max[a], p.bc[a] + r);
      }
    }
    if (!pos.length) throw new Error('Model export needs at least one positive solid');
    return { min, max };
  };
  /* Detach the rest field from the splat bake, which clears its live solids. */
  S.modelSource = () => {
    const parts = [], positive = [];
    for (const solid of pos) {
      if ((solid.model === 'separate' || solid.model?.separate) && !solid.analytic)
        throw new Error('A separate sculpt model requires an analytic primitive');
      if (solid.analytic && (solid.model === 'separate' || solid.model?.separate)) parts.push(solid);
      else positive.push(solid);
    }
    for (const solid of ghosts)
      if (solid.analytic && (solid.model === 'separate' || solid.model?.separate)) parts.push(solid);
    if (!positive.length && !parts.length) throw new Error('Model export needs an unbaked sculpt');
    const field = positive.length ? makeSculpt(B, { positive, negative: [...neg, ...negAll] }) : null;
    if (field) field.ready();
    return { field, parts, noise: n3 };
  };
  S.renderSurface = (x,y,z) => {
    fieldAll(x,y,z);
    return {body:own, owner:ownNeg?.mat?.r ? ownNeg : own};
  };
  let renderSdf;
  function captureRenderSdf() {
    const positive = pos.filter(p => !p.whole && Number.isFinite(p.br) && p.br < 1e8 && SdfAssist.opaque(p.mat));
    if (!positive.length) return null;
    const field = makeSculpt(B,{positive,negative:neg.slice()});
    const bounds = field.modelBounds(.05);
    field.ready();
    const rows = new Map();
    const owners = new Set([...positive,...neg.filter(p=>SdfAssist.opaque(p.mat))]);
    const {pre,clip} = S;
    const accepts = (pre || clip) && ((x,y,z)=>(!pre || pre(x,y,z)) && (!clip || clip(x,y,z)));
    return { bounds, distance:field.sdf, locate:field.renderSurface, rows, owners, accepts };
  }
  S.solidCount = () => pos.length + neg.length;
  S.add = add;
  S.psd = psd; // the finished field (distance to the nearest surface), for whatever comes after the bake
  S.heightAt = (x, z, y0, depth) => {
    let y = y0,
      d = fieldAll(x, y, z);
    if (d < 0.02) return 1e9;
    const end = y0 - (depth || 6);
    for (let i = 0; i < 320 && y > end; i++) {
      y -= Math.max(d * 0.9, 0.02);
      d = fieldAll(x, y, z);
      if (d < 0.02) return y;
    }
    return -1e9;
  };
  /* uneven detail: which of the three bands a place is in (near the point of focus, between, far), and which bands a solid lies in */
  const ONE_BAND = [0];
  function focusBand(x, y, z) {
    const F = S.focus,
      d = Math.hypot(x - F.p[0], y - F.p[1], z - F.p[2]);
    return d < (F.near === undefined ? 3 : F.near) ? 0 : d < (F.far === undefined ? 7 : F.far) ? 1 : 2;
  }
  function focusBands(p) {
    const F = S.focus,
      near = F.near === undefined ? 3 : F.near,
      far = F.far === undefined ? 7 : F.far,
      coarse = F.coarse || 1.8,
      d = Math.hypot(p.bc[0] - F.p[0], p.bc[1] - F.p[1], p.bc[2] - F.p[2]),
      out = [];
    if (d - p.br < near) out.push([0, F.fine || 1]);
    if (d + p.br >= near && d - p.br < far) out.push([1, Math.sqrt(coarse * (F.fine || 1))]);
    if (d + p.br >= far) out.push([2, coarse]);
    return out;
  }
  /* merge by distance (S.merge, a share of the spacing; 0 is off): a point that lands within that distance of one already laid in this
     bake, with the same material, is dropped. Where solids overlap or blend each samples the same surface, and the doubles add
     nothing to the picture but cost as much as any other dab */
  const MERGE = new Map();
  const merged = (x, y, z, res, m) => {
    const md = res * S.merge,
      ix = Math.floor(x / md),
      iy = Math.floor(y / md),
      iz = Math.floor(z / md),
      d2 = md * md;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const L = MERGE.get((ix + a) * 73856093 + (iy + b) * 19349663 + (iz + c) * 83492791);
          if (L)
            for (let k = 0; k < L.length; k += 4) {
              const dx = L[k] - x,
                dy = L[k + 1] - y,
                dz = L[k + 2] - z;
              if (L[k + 3] === m && dx * dx + dy * dy + dz * dz < d2) return true;
            }
        }
    const key = ix * 73856093 + iy * 19349663 + iz * 83492791;
    let L = MERGE.get(key);
    if (!L) MERGE.set(key, (L = []));
    L.push(x, y, z, m);
    return false;
  };
  S.merge = 0;
  /* how open to the sky a point on a surface is, 0..1 (straight up, and leaning by o.lean round about, or into o.wind): where snow
     lies and rain falls. During a bake, or before one once the field is ready */
  S.open = (x, y, z, o) => {
    const lean = (o && o.lean) || 0.35,
      dirs = [[0, 1, 0]],
      w = o && o.wind;
    if (w) dirs.push(norm([-w[0] * lean, 1, -w[2] * lean]), norm([-w[0] * lean * 2, 1, -w[2] * lean * 2]));
    else for (let k = 0; k < 4; k++) dirs.push(norm([Math.cos(k * 1.57) * lean, 1, Math.sin(k * 1.57) * lean]));
    let open = 0;
    for (const d of dirs) {
      let t = 0.08,
        hit = false;
      for (let k = 0; k < 24 && t < ((o && o.far) || 8); k++) {
        const h = field(x + d[0] * t, y + d[1] * t, z + d[2] * t);
        if (h < 0.02) {
          hit = true;
          break;
        }
        t += Math.max(0.05, h);
      }
      if (!hit) open++;
    }
    return open / dirs.length;
  };
  const stagedAlbedo = surface => Array.isArray(surface?.renderStages) && surface.renderStages.some(rule => rule.stage === 'material') ||
    surface?.layers && Object.values(surface.layers).some(SurfaceLook.basePaint);
  const unnamedTarget = {}, surfaceTargets = new WeakMap();
  function renderTarget(owner, surfaceId) {
    const target = owner?.renderTarget;
    if (!surfaceId || target?.surface !== undefined) return target;
    const source = target ?? unnamedTarget;
    if (!surfaceTargets.has(source)) surfaceTargets.set(source, new Map());
    const entries = surfaceTargets.get(source);
    if (!entries.has(surfaceId)) entries.set(surfaceId, { ...target, surface: surfaceId });
    return entries.get(surfaceId);
  }

  function shadeOwned(owner, material, ...sample) {
    if (material.materialAt || material.surfaceState)
      material = S.materialAt(material, sample.slice(1, 4), sample.slice(4, 7));
    material = controlled(material);
    const preview = typeof globalThis !== 'undefined' && globalThis.INK_LOOK_ALBEDO;
    const capture = B.describeAlbedo && (preview || S.captureAlbedo || stagedAlbedo(material.surface) || stagedAlbedo(material.top?.surface));
    const fine = owner?.detailBudget?.fine;
    const collectStyle = B.describePixelStyle && (material.pixelStyle || material.top?.pixelStyle);
    if (!renderSdf && !capture && !B.describeSplats && !collectStyle && !material.optical && !material.top?.optical) return light(material, ...sample, undefined, fine);
    const first = B.count();
    let effective = material, style, pair;
    if (material.top || collectStyle) light(material, ...sample, (used, settings, shades) => {
      effective = used;
      style = settings;
      pair = shades;
    }, fine);
    else light(material, ...sample, undefined, fine);
    const end = B.count();
    if (first < end && renderSdf?.owners.has(owner) && SdfAssist.opaque(effective)) {
      if (!renderSdf.rows.has(owner)) renderSdf.rows.set(owner,[]);
      const ranges = renderSdf.rows.get(owner);
      if (ranges.at(-1)?.[1] === first) ranges.at(-1)[1] = end;
      else ranges.push([first,end]);
    }
    if (effective.optical !== undefined) B.describeOptical?.(first, end, effective.optical);
    if (style) B.describePixelStyle?.(first, end, style, pair);
    const surfaceId = effective.surfaceId ?? (effective === material ? undefined : effective.surface?.id) ?? material.surfaceId;
    B.describeSplats?.(first, end, {
      object: owner?.renderOwner ?? owner,
      material: effective.materialId ?? material.materialId ?? material,
      target: renderTarget(owner, surfaceId)
    });
    const albedo = effective.albedo ?? effective.r?.at(-1) ?? material.albedo ?? material.r?.at(-1);
    if (capture && albedo !== undefined) B.describeAlbedo(first, end, albedo);
  }
  function sampleAt(solid, spacing, visit) {
    const original = solid.res;
    solid.res = spacing;
    try {
      if (S.sampleCandidates) S.sampleCandidates(solid, spacing, callback => solid.sample(callback), visit);
      else solid.sample(visit);
    } finally {
      solid.res = original;
    }
  }
  function bakeBand(p, band, res, adaptive, probeStep, finePass) {
    const bump = p.bump ? p.bump[0] : 0,
      tout = res * 0.7 + bump + p.reach,
      tin = res * 0.7 + bump + p.k * 0.4 + p.reach,
      normalStep = finePass ? Math.min(.012, res * .1) : .012;
    function shadedSpacing(query, d, x, y, z, nx, ny, nz) {
      const before = own, negative = ownNeg;
      const score = SculptSampling.detail(adaptive, query, probeStep, d, x, y, z, nx, ny, nz);
      own = before;
      ownNeg = negative;
      // The two grids overlap at the transition, where coarse dabs taper to leave room for the detail.
      const start = .78, end = 1.12;
      if (finePass) return score >= start ? res : 0;
      if (score >= end) return 0;
      return res * (1 - .22 * clamp((score - start) / (end - start), 0, 1));
    }
    // Rough or blended solids stretch their sample points.
    sampleAt(p, p.bump ? res * 0.8 : res, (x, y, z) => {
      if (S.pre && !S.pre(x, y, z)) return;
      if (band >= 0 && focusBand(x, y, z) !== band) return;
      // whole: this solid's own surface, all of it, found from its own distance alone (a part that will move must not have gaps where it touched something)
      if (p.whole) {
        const e = normalStep;
        let d = psd(p, x, y, z),
          nx = 0,
          ny = 1,
          nz = 0;
        for (let it = 0; it < 6; it++) {
          nx = psd(p, x + e, y, z) - d;
          ny = psd(p, x, y + e, z) - d;
          nz = psd(p, x, y, z + e) - d;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          if (Math.abs(d) < 0.004) break;
          const st = d / Math.max(0.6, l / e);
          x -= nx * st;
          y -= ny * st;
          z -= nz * st;
          d = psd(p, x, y, z);
        }
        if (Math.abs(d) > res * 0.5 || !p.mat.r || p.mat.skip) return;
        if (S.capture) {
          S.capture(p, S.materialAt(p.mat, [x, y, z], [nx, ny, nz]), res, x, y, z, nx, ny, nz, 1);
          return;
        }
        const spacing = adaptive ? shadedSpacing((a, b, c) => psd(p, a, b, c), d, x, y, z, nx, ny, nz) : res;
        if (!spacing) return;
        curP = p;
        if (S.emit) {
          const n0 = B.count();
          shadeOwned(p, p.mat, spacing, x, y, z, nx, ny, nz, true);
          S.emit(p, n0, B.count());
        } else shadeOwned(p, p.mat, spacing, x, y, z, nx, ny, nz, true);
        return;
      }
      /* a solid whose candidate points may lie well off its own surface (reach: grown rocks, typed-in shapes) has them taken onto
         its own surface first. Otherwise, where something else is nearer than its own surface (the ground beside a rock's cut face,
         the next rock) the field would carry them onto that, and its own surface there would get no dabs at all */
      if (p.reach > 0)
        for (let it = 0; it < 8; it++) {
          const d0 = psd(p, x, y, z);
          if (Math.abs(d0) < 0.002) break;
          const e = 0.006,
            gx = psd(p, x + e, y, z) - d0,
            gy = psd(p, x, y + e, z) - d0,
            gz = psd(p, x, y, z + e) - d0,
            gl = Math.hypot(gx, gy, gz) || 1,
            st = d0 / Math.max(0.6, gl / e);
          x -= (gx / gl) * st;
          y -= (gy / gl) * st;
          z -= (gz / gl) * st;
        }
      let d = field(x, y, z);
      if (d > tout || d < -tin) return;
      for (let it = 0; it < 7 && Math.abs(d) > 0.004; it++) {
        grad(x, y, z, d, normalStep);
        const st = d / gm;
        x -= g3[0] * st;
        y -= g3[1] * st;
        z -= g3[2] * st;
        d = field(x, y, z);
      }
      if (Math.abs(d) > res * 0.5) return;
      grad(x, y, z, d, normalStep);
      const nx = g3[0],
        ny = g3[1],
        nz = g3[2];
      field(x, y, z);
      if (!own) return;
      const m = ownNeg && ownNeg.mat.r ? ownNeg.mat : own.mat;
      if (!m.r || m.skip) return;
      if (S.capture) {
        const pr = ownNeg && ownNeg.mat.r ? ownNeg : own;
        let occ = 0,
          w = 1;
        for (let j = 1; j <= 3; j++) {
          const h = S.aoR * j;
          occ += (Math.max(0, h - field(x + nx * h, y + ny * h, z + nz * h)) * w) / h;
          w *= 0.6;
        }
        S.capture(pr, S.materialAt(m, [x, y, z], [nx, ny, nz]), res, x, y, z, nx, ny, nz, clamp(1 - (S.aoK * occ) / 1.96, 0, 1));
        return;
      }
      const source = ownNeg && ownNeg.mat.r ? ownNeg : own;
      if (adaptive && !SculptSampling.surface(m)) return;
      const spacing = adaptive ? shadedSpacing(field, d, x, y, z, nx, ny, nz) : res;
      if (!spacing || S.merge && merged(x, y, z, spacing, m)) return;
      curP = source;
      if (S.emit) {
        const pr = curP,
          n0 = B.count();
        shadeOwned(curP, m, spacing, x, y, z, nx, ny, nz, true);
        S.emit(pr, n0, B.count());
      } else shadeOwned(curP, m, spacing, x, y, z, nx, ny, nz, true);
    });
  }
  S.bake = () => {
    const override = typeof globalThis !== 'undefined' ? globalThis.INK_ADAPTIVE_SAMPLING : undefined;
    const sampling = !S.capture && SculptSampling.prepare(override ?? S.adaptiveSampling);
    const keepSdf = S.keepRenderSdf || (typeof globalThis !== 'undefined' && globalThis.INK_RETAIN_RENDER_SDF);
    renderSdf = keepSdf && !S.capture && B.keepRenderSdf ? captureRenderSdf() : null;
    buildGrid();
    L = S.sun;
    for (const p of pos.concat(neg)) {
      if (p.mat.skip) continue;
      const adaptive = sampling && SculptSampling.surface(p.mat) ? sampling : null;
      const res0 = p.res * (p.detailBudget?.spacing ?? 1),
        bands = S.focus && !S.capture ? focusBands(p) : ONE_BAND;
      for (let bi = 0; bi < bands.length; bi++) {
        const band = bands === ONE_BAND ? -1 : bands[bi][0],
          res = bands === ONE_BAND ? res0 : res0 * bands[bi][1];
        if (!adaptive) bakeBand(p, band, res, null);
        else {
          const probeStep = res * adaptive.coarse * .9;
          bakeBand(p, band, res * adaptive.coarse, adaptive, probeStep, false);
          bakeBand(p, band, res * adaptive.fine, adaptive, probeStep, true);
        }
      }
    }
    // ghosts are drawn but take no part in shadows (things in the sky, glass, glowing shapes)
    for (const p of ghosts) {
      const res = p.res * (p.detailBudget?.spacing ?? 1),
        e = 0.012;
      sampleAt(p, p.bump ? res * 0.8 : res, (x, y, z) => {
        if (S.pre && !S.pre(x, y, z)) return;
        let d = psd(p, x, y, z),
          nx = 0,
          ny = 1,
          nz = 0;
        for (let it = 0; it < (p.bump ? 5 : 1); it++) {
          nx = psd(p, x + e, y, z) - d;
          ny = psd(p, x, y + e, z) - d;
          nz = psd(p, x, y, z + e) - d;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          if (!p.bump) break;
          const st = d / Math.max(0.6, l / e);
          x -= nx * st;
          y -= ny * st;
          z -= nz * st;
          d = psd(p, x, y, z);
        }
        if (S.capture) {
          S.capture(p, S.materialAt(p.mat, [x, y, z], [nx, ny, nz]), res, x, y, z, nx, ny, nz);
          return;
        }
        curP = p;
        if (S.emit) {
          const n0 = B.count();
          shadeOwned(p, p.mat, res, x, y, z, nx, ny, nz, !!S.ghostLit);
          S.emit(p, n0, B.count());
        } else shadeOwned(p, p.mat, res, x, y, z, nx, ny, nz, !!S.ghostLit);
      });
    }
    if (renderSdf?.rows.size) {
      const {owners, ...source} = renderSdf;
      B.keepRenderSdf(source);
    }
    renderSdf = null;
    layInstances();
    bevelSculpt = undefined;
    bevelMaterials.clear();
    B.born(null);
    B.wet(null);
    MERGE.clear();
    for (const p of neg) negAll.push(p);
    /* bounce light, if asked for: what has just been baked is lit by everything baked so far */
    if (S.bounce && !S.capture) B.bounce(fieldAll, Object.assign({ taps: BTAP }, S.bounce === true ? {} : S.bounce));
    pos.length = 0;
    neg.length = 0;
    ghosts.length = 0;
  };

  // make the solids added so far walkable (heightAt) without drawing any of them
  /* ---------------- instances ----------------
     S.template(build, o)   bakes once whatever build(S2) makes, into a template: every surface point kept with its material, how far
                            along its limb it is, and the template's own field. Nothing is drawn by it.
     S.place(tpl, at, o)    puts a copy at `at`: o.yaw (turn about up), o.scale, o.up (the way the copy's up should lean, e.g. the
                            ground's normal) and o.lean (how far: 0..1), o.sway { amp, sp } (it sways as a whole, from its foot,
                            in the shader: nothing for the CPU to do). The copy is lit where it stands, so its light and shadow are
                            right, and its field joins the scene's, so it casts shadows and hides what lies inside it. What is
                            sculpted and projected once is used again: a forest costs a little more than its trees' lighting. */
  const insts = [],
    INST = { bc: [0, 0, 0], br: 1, v: 0, along: () => INST.v };
  S.template = (build, o) => {
    o = o || {};
    const S2 = typeof KIT !== 'undefined' && KIT.sculpt ? KIT.sculpt(makeSculpt(B)) : makeSculpt(B);
    for (const k of ['res', 'sun', 'amb', 'sky', 'sunK', 'aoR', 'aoK', 'fat']) S2[k] = S[k];
    if (o.res) S2.res = o.res;
    const samples = [];
    S2.capture = (pr, m, res, x, y, z, nx, ny, nz) => {
      const sample = [x, y, z, nx, ny, nz, res, m, pr && pr.along ? pr.along(x, y, z) : 0];
      if (pr?.whole) sample[9] = true;
      samples.push(sample);
    };
    build(S2);
    S2.bake();
    const lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (const q of samples)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], q[k]);
        hi[k] = Math.max(hi[k], q[k]);
      }
    const bc = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
    return {
      samples,
      sdf: S2.sdf,
      proxySdf: S2.proxySdf(),
      bc,
      br: Math.hypot(hi[0] - bc[0], hi[1] - bc[1], hi[2] - bc[2]) + 0.05,
      foot: lo[1]
    };
  };
  S.place = (tpl, at, o) => {
    o = o || {};
    const proxySdf = tpl.proxySdf || tpl.sdf;
    const sc = o.scale || 1,
      yw = o.yaw || 0,
      cy = Math.cos(yw),
      sy = Math.sin(yw);
    // turn about up, then lean up toward o.up; or o.R, a turn given whole (rows: where the copy's x, y and z go)
    let R = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    if (o.R) R = [o.R[0], o.R[3], o.R[6], o.R[1], o.R[4], o.R[7], o.R[2], o.R[5], o.R[8]];
    else if (o.up && o.lean !== 0) {
      const u = norm([o.up[0] * (o.lean || 1), 1 + (o.up[1] - 1) * (o.lean || 1), o.up[2] * (o.lean || 1)]),
        ax = [u[2], 0, -u[0]],
        s2 = Math.hypot(ax[0], ax[2]),
        c2 = u[1];
      if (s2 > 1e-5) {
        const kx = ax[0] / s2,
          kz = ax[2] / s2,
          t = 1 - c2,
          T = [c2 + kx * kx * t, -kz * s2, kx * kz * t, kz * s2, c2, -kx * s2, kx * kz * t, kx * s2, c2 + kz * kz * t];
        R = [0, 1, 2].flatMap(i =>
          [0, 1, 2].map(j => T[i * 3] * R[j] + T[i * 3 + 1] * R[3 + j] + T[i * 3 + 2] * R[6 + j])
        );
      }
    }
    const tw = v => [
        R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
        R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
        R[6] * v[0] + R[7] * v[1] + R[8] * v[2]
      ],
      c = tw(tpl.bc),
      proxy = {
        bc: [at[0] + c[0] * sc, at[1] + c[1] * sc, at[2] + c[2] * sc],
        br: tpl.br * sc,
        sd(x, y, z) {
          const dx = (x - at[0]) / sc,
            dy = (y - at[1]) / sc,
            dz = (z - at[2]) / sc;
          return (
            proxySdf(
              R[0] * dx + R[3] * dy + R[6] * dz,
              R[1] * dx + R[4] * dy + R[7] * dz,
              R[2] * dx + R[5] * dy + R[8] * dz
            ) * sc
          );
        },
        sample() {}
      };
    // (o.solid false: the copy is drawn and lit, but takes no part in the field: no shadow of its own, nothing hidden by it.
    // Right for small thin things in great numbers, leaves, petals, where the field would only be slowed by them)
    const labels = { objectId: o.objectId, tag: o.tag, target: o.target };
    if (o.solid !== false) add(proxy, { r: [0], skip: true }, labels);
    else {
      proxy.renderOwner = o.objectId ?? o.tag;
      proxy.renderTarget = o.target;
      if (budgetFor) proxy.detailBudget = budgetFor(proxy);
    }
    insts.push({
      born: o.born,
      tpl,
      at,
      R,
      sc,
      tw,
      proxy,
      sway: o.sway || null,
      ph: o.phase === undefined ? (at[0] * 1.7 + at[2] * 2.3) % 6.28 : o.phase
    });
    return proxy;
  };
  function layInstances() {
    for (const I of insts) {
      FLO = I.sway
        ? {
            k: 14,
            ph: I.ph,
            sp: I.sway.sp || 1.6,
            rg: I.sway.amp === undefined ? 0.05 : I.sway.amp,
            ex: I.at[1] + I.tpl.foot * I.sc
          }
        : null;
      INST.bc = I.proxy.bc;
      INST.br = I.proxy.br;
      INST.bevelDistance = I.proxy.sd;
      INST.born = I.born; // (a copy can have its own time to appear)
      for (const q of I.tpl.samples) {
        const p = I.tw(q),
          nv = I.tw([q[3], q[4], q[5]]),
          x = I.at[0] + p[0] * I.sc,
          y = I.at[1] + p[1] * I.sc,
          z = I.at[2] + p[2] * I.sc,
          res = q[6] * I.sc;
        if (field(x, y, z, q[9] ? I.proxy : undefined) < -res * 0.6) continue; // buried in another solid
        if (S.clip && !S.clip(x, y, z)) continue;
        INST.v = q[8];
        curP = INST;
        shadeOwned(I.proxy, q[7], res, x, y, z, nv[0], nv[1], nv[2], true);
      }
    }
    FLO = null;
    INST.bevelDistance = undefined;
    insts.length = 0;
  }

  /* ---------------- cover ----------------
     S.cover(mat, o) lays a coat over what has been baked so far (or from dab o.from on): snow, moss, dust, sand, lichen. Only what
     faces up enough takes it, and it is thickest where the surface is level, thinning to nothing at the lip, with a ragged edge.
     o: { up: how level a surface must be (0.55), thick (0.06), lumpy (0.5), edge: how ragged (0.3), res, where(x, y, z, ny): only
     here (a mask: K.grow.spread gives one), from } */
  S.cover = (mat, o) => {
    o = o || {};
    mat = Array.isArray(mat) ? { r: mat } : mat;
    const from = o.from || 0,
      to = B.count(),
      up = o.up === undefined ? 0.55 : o.up,
      thick = o.thick === undefined ? 0.06 : o.thick,
      lumpy = o.lumpy === undefined ? 0.5 : o.lumpy,
      edge = o.edge === undefined ? 0.3 : o.edge,
      res = o.res || S.res,
      cell = res * 0.6,
      seen = new Set(),
      d = new Array(10);
    L = S.sun;
    let laid = 0;
    for (let i = from; i < to; i++) {
      if (!B.dabAt(i, d) || d[6] < 1) continue;
      const kraw = Math.round(d[7]),
        flags = Math.floor(kraw / 16);
      if (kraw % 16 !== 0 || flags & 2 || flags & 4 || flags & 16) continue; // only still, plain, solid dabs: not glows, water or glass
      const x = d[0],
        y = d[1],
        z = d[2],
        nx = d[3],
        ny = d[4],
        nz = d[5],
        jag = (n3(x * 1.7 + 3, y * 1.7, z * 1.7) - 0.5) * edge,
        w0 = clamp((ny + jag - (up - 0.08)) / 0.3, 0, 1),
        w = w0 * w0 * (3 - 2 * w0);
      if (w < 0.25) continue;
      if (o.where && !o.where(x, y, z, ny)) continue;
      const key =
        (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
      if (seen.has(key)) continue;
      seen.add(key);
      const th = thick * w * (1 - lumpy * 0.5 + lumpy * n3(x * 0.9 + 5, y * 0.9, z * 0.9)),
        // the coat lies a little flatter than what it lies on
        mx = nx * (1 - 0.35 * w),
        my = ny + 0.35 * w,
        mz = nz * (1 - 0.35 * w),
        ml = Math.hypot(mx, my, mz) || 1;
      curP = null;
      shadeOwned(null, mat, res, x + nx * th, y + ny * th, z + nz * th, mx / ml, my / ml, mz / ml, true);
      laid++;
    }
    return laid;
  };

  S.freeze = () => {
    buildGrid();
    L = S.sun;
    for (const p of neg) negAll.push(p);
    pos.length = 0;
    neg.length = 0;
    ghosts.length = 0;
  };

  // ---------------- things built from solids ----------------
  S.rock = (c, r, mat, o) =>
    S.ball(
      c,
      r.length ? r : [r * 1.15, r * 0.8, r],
      mat,
      Object.assign({ bump: [(r.length ? r[1] : r) * 0.42, 1.1 / (r.length ? r[1] : r)] }, o)
    );
  // a cloaked figure, h tall, standing at (x, y, z). o: w (robe width), head (material), hood, hat, horns, staff: [dx, dz, top, material], face: angle it looks toward
  S.fig = (x, y, z, h, mat, o) => {
    o = o || {};
    const res = o.res || Math.max(0.035, h * 0.03),
      G = Object.assign(S.grp(h * 0.05), { res }),
      w = (o.w || 0.26) * h,
      fa = o.face || 0,
      fx = Math.sin(fa),
      fz = Math.cos(fa);
    S.lathe([x, y, z], h * 0.8, t => w * (0.28 + 0.72 * Math.pow(1 - t, 0.85)), mat, G);
    S.ball(
      [x + fx * h * 0.02, y + h * 0.87, z + fz * h * 0.02],
      o.hood ? h * 0.145 : h * 0.12,
      o.hood ? mat : o.head || mat,
      G
    );
    if (o.hood && o.head) S.ball([x + fx * h * 0.09, y + h * 0.86, z + fz * h * 0.09], h * 0.085, o.head, { res });
    if (o.hat) S.lathe([x, y + h * 0.93, z], h * 0.2, [h * 0.3, 0.01], o.hat === true ? mat : o.hat, { res });
    if (o.horns)
      for (const sg of [-1, 1])
        S.tube(
          [
            [x + fz * sg * h * 0.07, y + h * 0.95, z - fx * sg * h * 0.07],
            [x + fz * sg * h * 0.1, y + h * 1.16, z - fx * sg * h * 0.1]
          ],
          h * 0.03,
          h * 0.012,
          o.horns === true ? mat : o.horns,
          { res }
        );
    if (o.staff) {
      const s = o.staff,
        sx = x + s[0] * h,
        sz = z + s[1] * h;
      S.tube(
        [
          [sx, y, sz],
          [sx + (s[4] || 0) * h, y + s[2] * h, sz]
        ],
        Math.max(0.02, h * 0.016),
        Math.max(0.02, h * 0.016),
        s[3] || mat,
        { res }
      );
    }
    if (o.arm) {
      const a = o.arm;
      S.tube(
        [
          [x + fz * h * 0.12 * a[0], y + h * 0.68, z - fx * h * 0.12 * a[0]],
          [x + a[1] * h, y + a[2] * h, z + a[3] * h]
        ],
        h * 0.05,
        h * 0.035,
        mat,
        G
      );
    }
  };
  // Leaves: each cluster is an ellipsoid filled through its whole volume with small flat leaves that
  // face outward. A leaf's tone comes from where it sits in its cluster (low and shaded side dark, top and sunward side light)
  // plus the cluster's own band, so the crown reads as separate lit masses with dark gaps where the branches show.
  S.crown = (clusters, mat, count, o) => {
    if (S.collide) return;
    o = o || {};
    const m = Array.isArray(mat) ? { r: mat } : mat,
      sc = o.scale || 1,
      Ls = S.sun,
      uniq = a => a.filter((c, i) => a.indexOf(c) === i);
    const tones = uniq((m.r || []).concat(m.s || [])),
      gt = m.g ? uniq(m.g) : null;
    let total = 0,
      y0 = 1e9,
      y1 = -1e9;
    for (const c of clusters) {
      c.w = c.r[0] * c.r[2];
      total += c.w;
      y0 = Math.min(y0, c.p[1]);
      y1 = Math.max(y1, c.p[1]);
    }
    let mx = 0,
      my = 0,
      mz = 0,
      ext = 0.001;
    for (const c of clusters) {
      mx += c.p[0] / clusters.length;
      my += c.p[1] / clusters.length;
      mz += c.p[2] / clusters.length;
    }
    for (const c of clusters) ext = Math.max(ext, Math.hypot(c.p[0] - mx, c.p[1] - my, c.p[2] - mz));
    for (const c of clusters) {
      // each lobe has its own band; lobes on the sunward side of the whole crown run lighter, those underneath and behind darker
      c.phase = R() * TAU;
      if (c.band === undefined)
        c.band = clamp(
          0.5 * R() + 0.25 + (0.5 * ((c.p[0] - mx) * Ls[0] + (c.p[1] - my) * Ls[1] + (c.p[2] - mz) * Ls[2])) / ext,
          0,
          1
        );
      c.fl = m.fl || (m.still ? undefined : { k: 11, ph: c.phase, sp: 1.3, rg: 0.045 });
      c.lamp = false;
      if (gt)
        for (const li of S.lights) {
          const d = Math.hypot(li.p[0] - c.p[0], li.p[1] - c.p[1], li.p[2] - c.p[2]);
          if (d < li.r && (1 - d / li.r) * (1 - d / li.r) * li.s > 0.3) c.lamp = true;
        }
    }
    for (let i = 0; i < count; i++) {
      let pick = R() * total,
        cl = clusters[clusters.length - 1];
      for (const c of clusters) {
        pick -= c.w;
        if (pick <= 0) {
          cl = c;
          break;
        }
      }
      let x, y, z, q;
      do {
        x = R() * 2 - 1;
        y = R() * 2 - 1;
        z = R() * 2 - 1;
        q = x * x + y * y + z * z;
      } while (q > 1);
      const lobe = 1 + 0.12 * Math.sin(x * 5 + z * 4 + cl.phase) + 0.08 * Math.sin(z * 7 - y * 3);
      const px = cl.p[0] + x * cl.r[0] * lobe,
        py = cl.p[1] + y * cl.r[1] * (1 + 0.12 * Math.sin(x * 6 + cl.phase)),
        pz = cl.p[2] + z * cl.r[2] * lobe;
      if (S.clip && !S.clip(px, py, pz)) continue;
      const light = 0.24 + 0.2 * y + 0.24 * (x * Ls[0] + y * Ls[1] + z * Ls[2]) + 0.36 * cl.band,
        tn = cl.lamp ? gt : tones;
      const ci = tn[clamp(Math.floor(light * tn.length + (R() - 0.5) * 1.1), 0, tn.length - 1)];
      // a hard-edged shard lying across the lobe's surface direction, a few pixels long, so the crown's edge and tones break up leaf by leaf
      const size = (R() < 0.32 ? 0.12 + R() * 0.1 : 0.06 + R() * 0.065) * 2.3 * sc,
        nl = Math.hypot(x, y + 0.25, z) || 1,
        nx = x / nl,
        ny = (y + 0.25) / nl,
        nz = z / nl;
      let ux = -nz,
        uz = nx,
        ul = Math.hypot(ux, uz);
      if (ul < 1e-3) {
        ux = 1;
        uz = 0;
        ul = 1;
      }
      ux /= ul;
      uz /= ul;
      const a = R() * TAU,
        ca = Math.cos(a),
        sa = Math.sin(a),
        vx = ny * uz,
        vy = nz * ux - nx * uz,
        vz = -ny * ux,
        tx = ux * ca + vx * sa + nx * 0.3,
        ty = vy * sa + ny * 0.3,
        tz = uz * ca + vz * sa + nz * 0.3,
        tl = Math.hypot(tx, ty, tz);
      stick(px, py, pz, [tx / tl, ty / tl, tz / tl], size * 1.15, size * 0.5, P[ci], 3, cl.fl);
    }
    // unseen solids standing in for the leaf masses, so the crown still shades the ground, the trunk and the limbs under it
    if (o.shade !== false)
      for (const c of clusters) S.ball(c.p, [c.r[0] * 0.6, c.r[1] * 0.6, c.r[2] * 0.6], { skip: true }, { res: 0.5 });
  };
  // A tree: a twisted trunk and roots; main limbs leaving the upper trunk; two to four side
  // branches off each limb; a leaf cluster at the end of every side branch and limb, and one over the top.
  // o: h (trunk height), r, lean [x, z], nb (limbs), spread (reach of the limbs), cr (cluster size), bark, leaf, roots, res, leaves (count),
  // shade (false: the crown casts no shadow of its own, for when S.mask says where its shade falls), crown (false: the leaves wait for
  // .leaves(), so what the crown's clusters are can be known first). -> { top, tips, clusters, leaves }
  S.tree = (x, y, z, o) => {
    const { rr, path } = B,
      h = o.h || 5,
      r = o.r || h * 0.08,
      res = o.res || S.res,
      lean = o.lean || [0.25, 0],
      tw = rr(0, 6);
    const G = Object.assign(S.grp(r * 0.8), { res }),
      TG = Object.assign(S.grp(Math.max(0.04, r * 0.22)), { res: Math.min(res, 0.07) });
    const tr = t => [
      x + lean[0] * h * t * t + r * 0.9 * Math.sin(t * 5 + tw) * t,
      y + h * t,
      z + lean[1] * h * t * t + r * 0.9 * Math.cos(t * 4 + tw) * t
    ];
    S.tube(
      path(10, tr),
      t => r * (1.25 - 0.75 * t + 0.5 * Math.pow(1 - t, 6)),
      0,
      o.bark,
      Object.assign({ bump: [r * 0.5, 1.4 / r] }, G)
    );
    for (let k = 0; k < (o.roots === undefined ? 5 : o.roots); k++) {
      const a = (k / 5) * TAU + rr(-0.4, 0.4),
        len = r * rr(2.5, 4.5);
      S.tube(
        path(5, t => [x + Math.cos(a) * len * t, y + r * 1.6 * (1 - t) * (1 - t) - 0.03, z + Math.sin(a) * len * t]),
        r * 0.55,
        r * 0.12,
        o.bark,
        G
      );
    }
    const nb = o.nb || 6,
      sp = o.spread || h * 0.6,
      L0 = sp * 0.8 * (o.cs || 1),
      tips = [],
      clusters = [];
    const grow = (start, dir, len, gnarl, segs) => {
      const pts = [start];
      let d = norm(dir),
        p = start;
      for (let s = 0; s < segs; s++) {
        d = norm([d[0] + rr(-0.5, 0.5) * gnarl, d[1] + rr(-0.5, 0.5) * gnarl * 0.5, d[2] + rr(-0.5, 0.5) * gnarl]);
        p = [p[0] + (d[0] * len) / segs, p[1] + (d[1] * len) / segs, p[2] + (d[2] * len) / segs];
        pts.push(p);
      }
      return pts;
    };
    const at = (pts, t) => {
      const s = t * (pts.length - 1),
        i = Math.min(pts.length - 2, Math.floor(s)),
        u = s - i;
      return [0, 1, 2].map(c => pts[i][c] * (1 - u) + pts[i + 1][c] * u);
    };
    for (let k = 0; k < nb; k++) {
      const t = Math.min(0.98, 0.55 + (k / nb) * 0.42 + rr(-0.03, 0.03)),
        ang = (k / nb) * TAU + rr(0, 0.9),
        len = sp * rr(0.62, 1.0) * (1.15 - t * 0.4),
        lr = r * (0.62 - t * 0.25);
      const pts = grow(tr(t), [Math.cos(ang), rr(0.35, 0.9), Math.sin(ang)], len, 0.3, 4);
      if (!S.collide) S.tube(pts, u => Math.max(0.065, lr * (1 - 0.7 * u)), 0, o.bark, G);
      tips.push(pts[pts.length - 1]);
      if (!o.leaf) continue;
      const subs = 2 + Math.floor(rr(0, 3));
      for (let s2 = 0; s2 < subs; s2++) {
        const st = 0.35 + (s2 / subs) * 0.55,
          p0 = at(pts, st),
          p1 = at(pts, Math.min(1, st + 0.05)),
          pd = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]),
          sa = rr(0, TAU);
        const sub = grow(
          p0,
          [pd[0] + Math.cos(sa) * 1.0, pd[1] + rr(0.25, 0.65), pd[2] + Math.sin(sa) * 1.0],
          len * rr(0.45, 0.75),
          0.35,
          3
        );
        if (!S.collide) S.tube(sub, u => Math.max(0.05, lr * 0.5 * (1 - 0.7 * u)), 0, o.bark, TG);
        const c = L0 * rr(0.16, 0.27);
        clusters.push({ p: at(sub, 0.95), r: [c * 1.2, c * 0.7, c * 1.2] });
      }
      const c = L0 * rr(0.2, 0.33);
      clusters.push({ p: at(pts, 1), r: [c * 1.25, c * 0.72, c * 1.25] });
    }
    let leaves = () => 0;
    if (o.leaf) {
      const top = tr(1),
        sn = h / 6.2,
        ls = o.ls || clamp(sn, 0.5, 1.6);
      clusters.push({ p: [top[0], top[1] + L0 * 0.32, top[2]], r: [L0 * 0.36, L0 * 0.24, L0 * 0.36] });
      leaves = () =>
        S.crown(clusters, o.leaf, o.leaves || Math.round(1900 * Math.min(1, (sn / ls) * (sn / ls))), {
          scale: ls,
          shade: o.shade
        });
      if (o.crown !== false) leaves();
    }
    return { top: tr(1), tips, clusters, leaves };
  };
  return S;
}

// brick or block courses as a brightness pattern: dark joints, and each block a slightly different tone
function courses(bw, bh, n3, amt) {
  return (x, y, z) => {
    const row = Math.floor(y / bh),
      fy = y / bh - row,
      u = (x + z * 0.7) / bw + (row % 2) * 0.5,
      col = Math.floor(u),
      fx = u - col;
    return fy < 0.16 || fx < 0.07 ? -0.3 : (amt || 0.16) * (n3(col * 7.31, row * 3.17, 1.7) - 0.5) * 2;
  };
}

// ---------------- small things many scenes use ----------------
// a facing direction with its right and up, and a way to place points relative to it
function basis(f) {
  const l = Math.hypot(f[0], f[1], f[2]);
  f = [f[0] / l, f[1] / l, f[2] / l];
  const rl = Math.hypot(f[2], f[0]) || 1,
    rt = [f[2] / rl, 0, -f[0] / rl],
    up = [f[1] * rt[2] - f[2] * rt[1], f[2] * rt[0] - f[0] * rt[2], f[0] * rt[1] - f[1] * rt[0]];
  return {
    f,
    rt,
    up,
    at: (c, a, b, d) => [
      c[0] + f[0] * a + rt[0] * b + up[0] * d,
      c[1] + f[1] * a + rt[1] * b + up[1] * d,
      c[2] + f[2] * a + rt[2] * b + up[2] * d
    ]
  };
}

// a small flame with a soft glow: c = [outer, inner, core] palette indices
function flame(B, x, y, z, s, c) {
  const an = { em: true, nd: true, k: 6, ph: B.rr(0, 6), sp: 9, rg: 0.02 * s };
  B.iso(x, y, z, 0.17 * s, B.P[c[0]], 3, an);
  B.iso(x, y + 0.24 * s, z, 0.12 * s, B.P[c[1]], 3, an);
  B.iso(x, y + 0.46 * s, z, 0.07 * s, B.P[c[1]], 3, an);
  B.iso(x, y, z, 0.09 * s, B.P[c[2]], 3, an);
  B.iso(x, y + 0.2 * s, z, 1.0 * s, B.P[c[0]], 0.2, { em: true, nd: true, k: 7, ph: 0, sp: 7 });
}

// drifting bright specks
function motes(B, n, bx, cols, sz) {
  for (let i = 0; i < n; i++)
    B.iso(B.rr(bx[0], bx[1]), B.rr(bx[2], bx[3]), B.rr(bx[4], bx[5]), sz || 0.03, B.P[B.pick(cols)], 2.5, {
      em: true,
      nd: true,
      k: 6,
      ph: B.rr(0, 6),
      sp: B.rr(0.3, 0.9),
      rg: B.rr(0.1, 0.4)
    });
}

// water in the manner of a painted pond: flat tone in soft patches, a pale line at the bank, a few glints
function pondMat(B, c, shore) {
  return {
    r: [c[1]],
    em: true,
    tex: (x, y, z) => {
      if (shore && shore(x, z) < 0.22) return c[3];
      const v = B.fbm(x * 0.22 + 7, z * 0.22, 1.7, 2);
      if (Math.sin(z * 7 + 2 * Math.sin(x * 1.7)) > 0.985 && B.n3(x * 1.5, z * 1.5, 4) > 0.55) return c[3];
      return v > 0.57 ? c[2] : v < 0.43 ? c[0] : c[1];
    }
  };
}

function lilies(B, n, cx, cz, r, y, ok, c) {
  for (let i = 0; i < n; i++) {
    const a = B.rr(0, B.TAU),
      q = Math.sqrt(B.rr(0, 1)) * r,
      x = cx + Math.cos(a) * q,
      z = cz + Math.sin(a) * q,
      s2 = B.rr(0.34, 0.6),
      cut = B.rr(0, B.TAU);
    if (!ok(x, z)) continue;
    for (let k = 0; k < 44; k++) {
      const t = B.rr(0, B.TAU),
        d = Math.sqrt(B.rr(0, 1)) * s2;
      if (Math.abs(((t - cut + 9.42) % 6.283) - 3.14) < 0.32) continue;
      B.disc(x + Math.cos(t) * d, y, z + Math.sin(t) * d, B.UP, 0.085, 0.02, B.P[d > s2 * 0.72 ? c[0] : c[1]], 3);
    }
    if (i % 3 === 0)
      for (let k = 0; k < 5; k++)
        B.stick(
          x + 0.07 * Math.cos(k * 1.26),
          y + 0.08,
          z + 0.07 * Math.sin(k * 1.26),
          B.norm([Math.cos(k * 1.26), 1.2, Math.sin(k * 1.26)]),
          0.07,
          0.03,
          B.P[c[2]],
          3
        );
  }
}
