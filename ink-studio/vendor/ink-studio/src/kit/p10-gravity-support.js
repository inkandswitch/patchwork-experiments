/* A gravity-aligned solid between a convex planar carrier and a bounded height
   field. It is independent of buildings, materials, documents and rendering. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    finite = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  A.supportSkirt = raw => {
    const outline = A.data.clone(raw?.outline),
      ground = raw?.ground,
      embed = raw?.embed ?? 0.06,
      overlap = raw?.overlap ?? 0.04,
      maxDrop = raw?.maxDrop ?? 64;
    if (
      !Array.isArray(outline) ||
      outline.length < 3 ||
      outline.length > 256 ||
      !outline.every(finite) ||
      !ground ||
      typeof ground.height !== 'function' ||
      ![ground.bounds?.min, ground.bounds?.max].every(finite) ||
      ground.bounds.min.some((v, k) => v > ground.bounds.max[k]) ||
      !Number.isFinite(ground.slopeBound) ||
      ground.slopeBound < 0 ||
      ![embed, overlap, maxDrop].every(Number.isFinite) ||
      embed < 0 ||
      embed > 0.5 ||
      overlap < 0 ||
      overlap > 0.25 ||
      maxDrop <= 0 ||
      maxDrop > 128
    )
      throw Error('Support skirts need a finite planar convex loop, bounded height carrier and valid depths');
    let area = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      area += a[0] * b[2] - b[0] * a[2];
    }
    if (Math.abs(area) < 1e-9) throw Error('Support carrier must project to a nonzero XZ area');
    if (area < 0) outline.reverse();
    let plane;
    for (let i = 1; i < outline.length - 1; i++) {
      const n = V.cross(V.sub(outline[i], outline[0]), V.sub(outline[i + 1], outline[0]));
      if (Math.abs(n[1]) > 1e-9) {
        plane = n;
        break;
      }
    }
    if (!plane) throw Error('Support carrier cannot be vertical');
    const slope = [-plane[0] / plane[1], -plane[2] / plane[1]],
      origin = outline[0],
      top = (x, z) => origin[1] + slope[0] * (x - origin[0]) + slope[1] * (z - origin[2]),
      edges = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length],
          dx = b[0] - a[0],
          dz = b[2] - a[2],
          length = Math.hypot(dx, dz);
        if (length < 1e-8) throw Error('Support carrier has a repeated edge');
        return { a, b, dx, dz, length, n: [dz / length, 0, -dx / length] };
      });
    if (
      outline.some(q => Math.abs(q[1] - top(q[0], q[2])) > 1e-5 * (1 + Math.hypot(...slope))) ||
      edges.some(edge => outline.some(q => edge.n[0] * (q[0] - edge.a[0]) + edge.n[2] * (q[2] - edge.a[2]) > 1e-7))
    )
      throw Error('Support carrier must be planar and convex');
    const height = (x, z) => {
        const h = ground.height(x, z);
        if (
          !Number.isFinite(h) ||
          (x >= ground.bounds.min[0] &&
            x <= ground.bounds.max[0] &&
            z >= ground.bounds.min[2] &&
            z <= ground.bounds.max[2] &&
            (h < ground.bounds.min[1] - 1e-6 || h > ground.bounds.max[1] + 1e-6))
        )
          throw Error('Support ground height must remain finite and within its declared bounds');
        return h;
      },
      bottom = (x, z) => Math.max(height(x, z) - embed, top(x, z) - maxDrop),
      bounds = A.spatial.boxOf(outline);
    bounds.min[1] = Math.max(ground.bounds.min[1] - embed, bounds.min[1] - maxDrop);
    bounds.max[1] += overlap;
    bounds.min[1] = Math.min(bounds.min[1], bounds.max[1]);
    const topScale = 1 / Math.hypot(1, ...slope),
      bottomScale = 1 / Math.hypot(1, ground.slopeBound, ...slope),
      horizontal = (x, z) => {
        let inside = true,
          d = Infinity;
        for (const edge of edges) {
          const dx = x - edge.a[0],
            dz = z - edge.a[2],
            t = Math.max(0, Math.min(1, (dx * edge.dx + dz * edge.dz) / edge.length ** 2));
          if (edge.n[0] * dx + edge.n[2] * dz > 0) inside = false;
          d = Math.min(d, Math.hypot(dx - edge.dx * t, dz - edge.dz * t));
        }
        return inside ? -d : d;
      };
    function distance(point) {
      if (!finite(point)) throw Error('Support queries need finite coordinates');
      const [x, y, z] = point;
      return Math.max(horizontal(x, z), (y - top(x, z) - overlap) * topScale, (bottom(x, z) - y) * bottomScale);
    }
    function clip(poly, side, root = false) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          da = side(a),
          db = side(b);
        if (da >= -1e-9) out.push(a);
        if (da < 0 !== db < 0) {
          let t = da / (da - db);
          if (root) {
            let lo = 0,
              hi = 1;
            for (let k = 0; k < 18; k++) {
              const m = (lo + hi) / 2;
              if (side(lerp(a, b, m)) >= 0 === da >= 0) lo = m;
              else hi = m;
            }
            t = (lo + hi) / 2;
          }
          out.push(lerp(a, b, t));
        }
      }
      return out;
    }
    function mesh(options = {}) {
      const resolution = options.resolution ?? 0.2;
      if (!Number.isFinite(resolution) || resolution <= 0) throw Error('Support mesh resolution must be positive');
      const budget = options.budget ?? 50000;
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > 250000)
        throw Error('Support mesh needs a bounded triangle budget');
      let triangles = 0;
      const guard = n => {
        if ((triangles += n) > budget) throw Error('Support mesh exceeds its triangle budget');
      };
      const b = A.geometry.builder(),
        meta = {
          owner: options.owner || '',
          material: options.material || 'foundation',
          surface: options.surface || 'foundation'
        },
        emit = (a, c, d, surface) => {
          guard(1);
          b.triangle(a, c, d, { ...meta, surface });
        },
        gap = q => top(q[0], q[1]) + overlap - bottom(q[0], q[1]);
      function side(edge, a, c, depth = 0) {
        const t = (a + c) / 2,
          p = lerp(edge.a, edge.b, a),
          q = lerp(edge.a, edge.b, c),
          m = lerp(edge.a, edge.b, t),
          h = [p, q, m].map(v => bottom(v[0], v[2])),
          g = [p, q, m].map((v, i) => top(v[0], v[2]) + overlap - h[i]);
        if (
          depth < 10 &&
          (Math.abs(h[2] - (h[0] + h[1]) / 2) > resolution * 0.2 || (g[0] * g[1] > 0 && g[0] * g[2] < 0)) &&
          (c - a) * edge.length > resolution / 8
        ) {
          side(edge, a, t, depth + 1);
          side(edge, t, c, depth + 1);
          return;
        }
        if (g[0] <= 0 && g[1] <= 0) return;
        let lo = a,
          hi = c;
        if (g[0] * g[1] < 0) {
          let L = a,
            H = c;
          for (let k = 0; k < 20; k++) {
            const at = (L + H) / 2,
              v = lerp(edge.a, edge.b, at),
              positive = top(v[0], v[2]) + overlap > bottom(v[0], v[2]);
            if (positive === g[0] > 0) L = at;
            else H = at;
          }
          if (g[0] <= 0) lo = (L + H) / 2;
          else hi = (L + H) / 2;
        }
        const A0 = lerp(edge.a, edge.b, lo),
          C0 = lerp(edge.a, edge.b, hi),
          low = v => [v[0], bottom(v[0], v[2]), v[2]],
          high = v => [v[0], top(v[0], v[2]) + overlap, v[2]];
        guard(2);
        b.quad(low(A0), high(A0), high(C0), low(C0), meta);
      }
      for (const edge of edges) {
        const n = Math.min(512, Math.max(1, Math.ceil(edge.length / resolution)));
        for (let i = 0; i < n; i++) side(edge, i / n, (i + 1) / n);
      }
      const nx = Math.min(64, Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / resolution))),
        nz = Math.min(64, Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / resolution)));
      for (let x = 0; x < nx; x++)
        for (let z = 0; z < nz; z++) {
          const X = i => bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * i) / nx,
            Z = i => bounds.min[2] + ((bounds.max[2] - bounds.min[2]) * i) / nz;
          let poly = [
            [X(x), Z(z)],
            [X(x + 1), Z(z)],
            [X(x + 1), Z(z + 1)],
            [X(x), Z(z + 1)]
          ];
          for (const edge of edges)
            poly = clip(poly, q => -edge.n[0] * (q[0] - edge.a[0]) - edge.n[2] * (q[1] - edge.a[2]));
          poly = clip(poly, gap, true);
          for (let i = 1; i < poly.length - 1; i++) {
            const high = poly.map(q => [q[0], top(q[0], q[1]) + overlap, q[1]]),
              low = poly.map(q => [q[0], bottom(q[0], q[1]), q[1]]);
            emit(high[0], high[i + 1], high[i], meta.surface + '-top');
            emit(low[0], low[i], low[i + 1], meta.surface + '-bottom');
          }
        }
      return b.finish();
    }
    function sample(spacing, put, options = {}) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof put !== 'function')
        throw Error('Support samples need positive spacing and an emitter');
      let count = 0;
      const budget = options.budget ?? 100000;
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > 1000000)
        throw Error('Support samples need a bounded point budget');
      const estimate =
        (edges.reduce((n, e) => n + e.length, 0) * (bounds.max[1] - bounds.min[1]) +
          2 * (bounds.max[0] - bounds.min[0]) * (bounds.max[2] - bounds.min[2])) /
        (spacing * spacing);
      if (estimate > budget * 2) throw Error('Support surface exceeds its sample budget');
      const emit = q => {
        if (++count > budget) throw Error('Support samples exceed their budget');
        put(q);
      };
      for (const edge of edges)
        A.geometry.samplePatch(
          {
            steps: [Math.max(1, Math.ceil(edge.length / spacing)), 1],
            spacing,
            sample: (u, v) => {
              const q = lerp(edge.a, edge.b, u),
                low = bottom(q[0], q[2]),
                high = top(q[0], q[2]) + overlap;
              return [q[0], low + Math.max(0, high - low) * v, q[2]];
            },
            accept: u => {
              const q = lerp(edge.a, edge.b, u);
              return top(q[0], q[2]) + overlap > bottom(q[0], q[2]);
            }
          },
          emit
        );
      const nx = Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / spacing)),
        nz = Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / spacing));
      if (nx * nz * 2 > budget) throw Error('Support cap grid exceeds its sample budget');
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const x = bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * (i + 0.5)) / nx,
            z = bounds.min[2] + ((bounds.max[2] - bounds.min[2]) * (j + 0.5)) / nz,
            lo = bottom(x, z),
            hi = top(x, z) + overlap;
          if (horizontal(x, z) > 0 || hi <= lo) continue;
          emit([x, lo, z]);
          emit([x, hi, z]);
        }
      return count;
    }
    function raycast(origin, dir, max = 10000) {
      if (!finite(origin) || !finite(dir) || V.len(dir) < 1e-8 || !Number.isFinite(max) || max <= 0)
        throw Error('Support rays need finite vectors and a positive limit');
      const direction = V.norm(dir);
      let t = A.spatial.rayBox(bounds, origin, direction, max);
      if (t === null) return null;
      for (let i = 0; i < 4096 && t <= max; i++) {
        const q = V.mad(origin, direction, t),
          d = distance(q);
        if (Math.abs(d) < 0.0002) {
          const eps = 0.0001,
            n = [0, 1, 2].map(k => {
              const a = q.slice(),
                b = q.slice();
              a[k] += eps;
              b[k] -= eps;
              return distance(a) - distance(b);
            });
          return { p: q, n: V.norm(n), distance: t };
        }
        t += Math.max(0.0001, Math.abs(d) * 0.9);
      }
      return null;
    }
    return {
      outline: A.data.freeze(outline),
      bounds,
      top,
      bottom,
      horizontal,
      distance,
      mesh,
      sample,
      raycast,
      ground,
      embed,
      overlap,
      maxDrop
    };
  };
})(KIT);
