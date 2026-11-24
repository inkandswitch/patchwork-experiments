/* k4-art: flat artwork (SVG paths and simple shapes) that lives on the surface of a solid.
   The art is drawn into a small grid of palette colours; splats on the face look their colour up by where they sat when they were made.
   So when the rig turns or squashes the solid the art goes with it, and the art can itself be keyed, morphed or warped without the solid knowing.
     const art = K.art({ box: [0, 0, 100, 100], res: 96, shapes: [{ d: 'M10 10 L90 10 L50 90 Z', fill: 5 }, { circle: [50, 50, 20], fill: 2, key: t => ({ sy: blink(t) , px: 50, py: 50 }) }], warp: (x, y, t) => [x, y] })
     K.art.faces(st, [{ face: solid.faces[4], art, size: 0.8 }])      (a system: add it to the stage) */
(function (K) {
  const V = K.V;
  // an SVG path as lists of points (curves cut into short straight pieces)
  const parse = (K.svgPath = (d, seg) => {
    seg = seg || 10;
    const tk = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [],
      out = [];
    let i = 0,
      cmd = '',
      x = 0,
      y = 0,
      sx = 0,
      sy = 0,
      cx = 0,
      cy = 0,
      cur = null;
    const num = () => +tk[i++],
      isNum = () => i < tk.length && !/^[a-zA-Z]$/.test(tk[i]);
    const to = (nx, ny) => {
        cur.push([nx, ny]);
        x = nx;
        y = ny;
      },
      bez = (p0, p1, p2, p3) => {
        for (let k = 1; k <= seg; k++) {
          const t = k / seg,
            u = 1 - t;
          cur.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
          ]);
        }
        x = p3[0];
        y = p3[1];
      };
    while (i < tk.length) {
      if (!isNum()) cmd = tk[i++];
      const rel = cmd === cmd.toLowerCase(),
        c = cmd.toUpperCase(),
        ox = rel ? x : 0,
        oy = rel ? y : 0;
      if (c === 'M') {
        const nx = ox + num(),
          ny = oy + num();
        cur = [[nx, ny]];
        out.push(cur);
        x = sx = nx;
        y = sy = ny;
        cmd = rel ? 'l' : 'L';
      } else if (c === 'L') to(ox + num(), oy + num());
      else if (c === 'H') to(ox + num(), y);
      else if (c === 'V') to(x, oy + num());
      else if (c === 'C') {
        const p1 = [ox + num(), oy + num()],
          p2 = [ox + num(), oy + num()],
          p3 = [ox + num(), oy + num()];
        bez([x, y], p1, p2, p3);
        cx = p2[0];
        cy = p2[1];
      } else if (c === 'S') {
        const p1 = [2 * x - cx, 2 * y - cy],
          p2 = [ox + num(), oy + num()],
          p3 = [ox + num(), oy + num()];
        bez([x, y], p1, p2, p3);
        cx = p2[0];
        cy = p2[1];
      } else if (c === 'Q') {
        const q = [ox + num(), oy + num()],
          p3 = [ox + num(), oy + num()],
          p0 = [x, y];
        bez(
          p0,
          [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
          [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
          p3
        );
        cx = q[0];
        cy = q[1];
      } else if (c === 'T') {
        const q = [2 * x - cx, 2 * y - cy],
          p3 = [ox + num(), oy + num()],
          p0 = [x, y];
        bez(
          p0,
          [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
          [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
          p3
        );
        cx = q[0];
        cy = q[1];
      } else if (c === 'A') {
        let rx = Math.abs(num()),
          ry = Math.abs(num());
        const ph = (num() * Math.PI) / 180,
          fa = num(),
          fs = num(),
          ex = ox + num(),
          ey = oy + num(),
          cp = Math.cos(ph),
          sp = Math.sin(ph),
          dx = (x - ex) / 2,
          dy = (y - ey) / 2,
          x1 = cp * dx + sp * dy,
          y1 = -sp * dx + cp * dy,
          lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
        if (lam > 1) {
          rx *= Math.sqrt(lam);
          ry *= Math.sqrt(lam);
        }
        const sq =
            Math.sqrt(
              Math.max(
                0,
                (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)
              )
            ) * (fa === fs ? -1 : 1),
          cxp = (sq * rx * y1) / ry,
          cyp = (-sq * ry * x1) / rx,
          ccx = cp * cxp - sp * cyp + (x + ex) / 2,
          ccy = sp * cxp + cp * cyp + (y + ey) / 2,
          a1 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
        let da = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - a1;
        if (fs && da < 0) da += 2 * Math.PI;
        if (!fs && da > 0) da -= 2 * Math.PI;
        for (let k = 1; k <= seg * 2; k++) {
          const a = a1 + (da * k) / (seg * 2);
          cur.push([
            ccx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp,
            ccy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp
          ]);
        }
        x = ex;
        y = ey;
      } else if (c === 'Z') {
        x = sx;
        y = sy;
      } else i++;
      if (c !== 'C' && c !== 'S' && c !== 'Q' && c !== 'T') {
        cx = x;
        cy = y;
      }
    }
    return out;
  });
  const outline = s =>
    s.d
      ? parse(s.d, s.seg)
      : s.pts
        ? [s.pts.map(p => p.slice())]
        : s.circle
          ? [
              Array.from({ length: 28 }, (_, k) => [
                s.circle[0] + Math.cos((k / 28) * 6.2832) * s.circle[2],
                s.circle[1] + Math.sin((k / 28) * 6.2832) * s.circle[2]
              ])
            ]
          : s.ellipse
            ? [
                Array.from({ length: 28 }, (_, k) => [
                  s.ellipse[0] + Math.cos((k / 28) * 6.2832) * s.ellipse[2],
                  s.ellipse[1] + Math.sin((k / 28) * 6.2832) * s.ellipse[3]
                ])
              ]
            : s.rect
              ? [
                  [
                    [s.rect[0], s.rect[1]],
                    [s.rect[0] + s.rect[2], s.rect[1]],
                    [s.rect[0] + s.rect[2], s.rect[1] + s.rect[3]],
                    [s.rect[0], s.rect[1] + s.rect[3]]
                  ]
                ]
              : [];
  K.art = def => {
    const box = def.box || [0, 0, 100, 100],
      res = def.res || 96,
      bw = box[2] - box[0],
      bh = box[3] - box[1],
      shapes = def.shapes.map(s => ({ s, rest: outline(s), to: s.to ? parse(s.to, s.seg) : null })),
      grid = new Uint8Array(res * res),
      xs = [];
    const art = {
      def,
      res,
      grid,
      animated: !!def.warp || def.shapes.some(s => s.key),
      stamp: -1,
      // draw the art as it stands at time t into the grid: 0 clear, else palette index + 1. Later shapes cover earlier ones
      raster(t) {
        if (art.stamp === t) return grid;
        art.stamp = t;
        grid.fill(0);
        for (const sh of shapes) {
          const s = sh.s,
            k = s.key ? s.key(t) || {} : null;
          if (k && k.hide) continue;
          const fill = (k && k.fill !== undefined ? k.fill : s.fill) + 1,
            rule = s.rule === 'evenodd';
          const polys = sh.rest.map((poly, pi) =>
            poly.map((p, qi) => {
              let x = p[0],
                y = p[1];
              if (k) {
                if (k.morph && sh.to && sh.to[pi] && sh.to[pi][qi]) {
                  x += (sh.to[pi][qi][0] - x) * k.morph;
                  y += (sh.to[pi][qi][1] - y) * k.morph;
                }
                const px = k.px === undefined ? 0 : k.px,
                  py = k.py === undefined ? 0 : k.py;
                x = (x - px) * (k.sx === undefined ? 1 : k.sx);
                y = (y - py) * (k.sy === undefined ? 1 : k.sy);
                if (k.rot) {
                  const c = Math.cos(k.rot),
                    sn = Math.sin(k.rot),
                    nx = x * c - y * sn;
                  y = x * sn + y * c;
                  x = nx;
                }
                x += px + (k.tx || 0);
                y += py + (k.ty || 0);
              }
              if (def.warp) {
                const w = def.warp(x, y, t);
                x = w[0];
                y = w[1];
              }
              return [((x - box[0]) / bw) * res, ((y - box[1]) / bh) * res];
            })
          );
          for (let row = 0; row < res; row++) {
            const yy = row + 0.5;
            xs.length = 0;
            for (const poly of polys)
              for (let a = 0, n = poly.length; a < n; a++) {
                const p = poly[a],
                  q = poly[(a + 1) % n];
                if (p[1] <= yy !== q[1] <= yy)
                  xs.push([p[0] + ((yy - p[1]) / (q[1] - p[1])) * (q[0] - p[0]), q[1] > p[1] ? 1 : -1]);
              }
            if (!xs.length) continue;
            xs.sort((a, b) => a[0] - b[0]);
            let wind = 0;
            for (let a = 0; a < xs.length - 1; a++) {
              wind += rule ? 1 : xs[a][1];
              if (rule ? wind & 1 : wind !== 0) {
                const x0 = Math.max(0, Math.ceil(xs[a][0] - 0.5)),
                  x1 = Math.min(res - 1, Math.floor(xs[a + 1][0] - 0.5));
                for (let c = x0; c <= x1; c++) grid[row * res + c] = fill;
              }
            }
          }
        }
        return grid;
      },
      // the colour at u, v (0..1 across, 0..1 up the picture): a palette index, or -1 where the art is clear. Uses the last raster
      at(u, v) {
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
        return grid[Math.floor((1 - v) * res) * res + Math.floor(u * res)] - 1;
      }
    };
    art.raster(0);
    return art;
  };
  // where a picture sits: on a solid's face ({ face, size: share of the face it fills, turn: radians }) or anywhere ({ o, u, v, n, w, h } half-sizes)
  const place = pl => {
    if (!pl.face) return Object.assign({ depth: 0.14 }, pl);
    const f = pl.face,
      k = (pl.size === undefined ? 0.85 : pl.size) * f.r,
      c = Math.cos(pl.turn || 0),
      s = Math.sin(pl.turn || 0);
    return {
      o: f.c,
      n: f.n,
      u: V.add(V.mul(f.u, c), V.mul(f.v, s)),
      v: V.add(V.mul(f.v, c), V.mul(f.u, -s)),
      w: k,
      h: k,
      depth: pl.depth || 0.14,
      art: pl.art,
      part: pl.part
    };
  };
  // at bake time: a material that shows the art (as it is at time 0) where the face is. Splats made this way never change
  K.art.mat = (mat, pl) => {
    const P = place(pl),
      art = pl.art,
      old = mat.tex;
    return Object.assign({}, mat, {
      tex: (x, y, z, ny, t, nx, nz) => {
        const r = [x - P.o[0], y - P.o[1], z - P.o[2]];
        if (Math.abs(V.dot(r, P.n)) < P.depth) {
          const q = art.at(V.dot(r, P.u) / (2 * P.w) + 0.5, V.dot(r, P.v) / (2 * P.h) + 0.5);
          if (q >= 0) return q;
        }
        return old ? old(x, y, z, ny, t, nx, nz) : undefined;
      }
    });
  };
  // at run time: a painter. Splats within each face's slab (at rest) remember their u, v; whenever the art's grid changes under one, it is repainted
  K.art.faces = (st, list) => {
    const N = st.N,
      slot = new Int32Array(N).fill(-1),
      ids = [],
      us = [],
      vs = [],
      which = [],
      P = list.map(place),
      pal = st.W.pal,
      base = st.base,
      bid = st.rig ? st.rig.bid : null;
    for (let i = 0, o = 0; i < N; i++, o += 16) {
      if (base[o + 3] < 1) continue;
      for (let k = 0; k < P.length; k++) {
        const p = P[k];
        if (p.part && bid && st.rig.names[bid[i]] !== p.part) continue;
        const r = [base[o] - p.o[0], base[o + 1] - p.o[1], base[o + 2] - p.o[2]];
        if (Math.abs(V.dot(r, p.n)) > p.depth) continue;
        const u = V.dot(r, p.u) / (2 * p.w) + 0.5,
          v = V.dot(r, p.v) / (2 * p.h) + 0.5;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        slot[i] = ids.length;
        ids.push(i);
        us.push(u);
        vs.push(v);
        which.push(k);
        break;
      }
    }
    const shown = new Int16Array(ids.length).fill(-2),
      sys = {
        ids,
        count: ids.length,
        update(dt, t) {
          for (const p of P) if (p.art.animated || p.art.stamp < 0 || shown[0] === -2) p.art.raster(t);
          for (let k = 0; k < ids.length; k++) {
            const q = P[which[k]].art.at(us[k], vs[k]);
            if (q !== shown[k]) {
              shown[k] = q;
              st.repaint(ids[k]);
            }
          }
        },
        paint(i, c) {
          const k = slot[i];
          if (k < 0) return;
          const q = shown[k];
          if (q < 0) return;
          const h = pal[q];
          c[0] = ((h >> 16) & 255) / 255;
          c[1] = ((h >> 8) & 255) / 255;
          c[2] = (h & 255) / 255;
        }
      };
    return sys;
  };
})(KIT);
