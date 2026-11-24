/* Planar free-surface PIC/FLIP with staggered face velocities and a pressure projection. */
(function (K) {
  const P = K.procedural;
  const { kinds, size, obstacles, int, range, vector, clamp, raster, buffer, move, color } = P.rasterSimSupport;

  function weights(grid, x, y, visit) {
    const px = x - grid.ox, py = y - grid.oy, u = Math.floor(px), v = Math.floor(py);
    for (let j = v; j <= v + 1; j++) for (let i = u; i <= u + 1; i++) {
      if (i < 0 || i >= grid.width || j < 0 || j >= grid.height) continue;
      const cell = j * grid.width + i, weight = (1 - Math.abs(px - i)) * (1 - Math.abs(py - j));
      if (weight > 0 && grid.open[cell]) visit(cell, weight);
    }
  }

  function faceGrid(width, height, ox, oy, test) {
    const open = Uint8Array.from({ length: width * height }, (_, i) => Number(test(i % width, Math.floor(i / width))));
    return { width, height, ox, oy, open, data: new Float64Array(open.length), mass: new Float64Array(open.length) };
  }

  function extend(grid, input, starting) {
    let data = input.slice(), valid = starting.slice();
    const { width, height, open } = grid;
    for (let layer = 0; layer < 3; layer++) {
      const next = data.slice(), flags = valid.slice();
      for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
        if (!open[p] || valid[p]) continue;
        let total = 0, count = 0;
        if (x && valid[p - 1]) { total += data[p - 1]; count++; }
        if (x + 1 < width && valid[p + 1]) { total += data[p + 1]; count++; }
        if (y && valid[p - width]) { total += data[p - width]; count++; }
        if (y + 1 < height && valid[p + width]) { total += data[p + width]; count++; }
        if (count) { next[p] = total / count; flags[p] = 1; }
      }
      data = next;
      valid = flags;
    }
    return data;
  }

  function sample(grid, data, x, y) {
    let value = 0, total = 0;
    weights(grid, x, y, (i, weight) => { value += data[i] * weight; total += weight; });
    return total ? value / total : 0;
  }

  function project(width, height, cells, fluid, x, y, iterations) {
    const pitch = width + 1, pressure = new Float64Array(width * height), rhs = new Float64Array(pressure.length);
    const neighbors = new Uint8Array(pressure.length);
    for (let row = 0, i = 0; row < height; row++) for (let col = 0; col < width; col++, i++) {
      if (!fluid[i]) continue;
      const u = row * pitch + col;
      rhs[i] = x[u + 1] - x[u] + y[i + width] - y[i];
      neighbors[i] = Number(col > 0 && cells[i - 1]) + Number(col + 1 < width && cells[i + 1]) +
        Number(row > 0 && cells[i - width]) + Number(row + 1 < height && cells[i + width]);
    }
    for (let j = 0; j < iterations; j++) for (let row = 0, i = 0; row < height; row++) for (let col = 0; col < width; col++, i++) {
      if (!neighbors[i]) continue;
      const sum = (col ? pressure[i - 1] : 0) + (col + 1 < width ? pressure[i + 1] : 0) +
        (row ? pressure[i - width] : 0) + (row + 1 < height ? pressure[i + width] : 0);
      // Air pressure stays zero and closed walls are left out of the stencil.
      pressure[i] = (sum - rhs[i]) / neighbors[i];
    }
    let before = 0, after = 0, count = 0;
    for (let row = 0, i = 0; row < height; row++) for (let col = 0; col < width; col++, i++) {
      const u = row * pitch + col;
      if (col && cells[i] && cells[i - 1] && (fluid[i] || fluid[i - 1])) x[u] -= pressure[i] - pressure[i - 1];
      if (row && cells[i] && cells[i - width] && (fluid[i] || fluid[i - width])) y[i] -= pressure[i] - pressure[i - width];
    }
    for (let row = 0, i = 0; row < height; row++) for (let col = 0; col < width; col++, i++) {
      if (!fluid[i]) continue;
      const u = row * pitch + col, div = x[u + 1] - x[u] + y[i + width] - y[i];
      count++;
      before += Math.abs(rhs[i]);
      after += Math.abs(div);
    }
    return [before / Math.max(1, count), after / Math.max(1, count)];
  }

  kinds.flip = (options, { seed }) => {
    const dims = size(options, 20000), { width: w, height: h } = dims, { closed, open } = obstacles(options, dims);
    const { fill = [[2, h * .23, w * .32, h * .72]], particlesPerCell = 4, pressureIterations = 19, substeps = 2,
      gravity = [0, 76], velocity = [0, 0], flip = .9, maxSpeed = 100,
      palette = ['#1e536d', '#26748f', '#41a4a9', '#80d1c2', '#c3eddd'], surface = .34 } = options;
    const colors = Array.isArray(palette) && int(palette.length, 2, 32) && palette.map(color);
    if (!colors || !Array.isArray(fill) || !int(fill.length, 1, 64) ||
        !Array.from(fill).every(r => vector(r, 4) && r[2] > 0 && r[3] > 0) || !int(particlesPerCell, 1, 9) ||
        !int(pressureIterations, 2, 100) || !int(substeps, 1, 8) || !vector(gravity, 2) || !vector(velocity, 2) ||
        !range(maxSpeed, .1, 400) || !range(flip, 0, 1) || !range(surface, .01, 8))
      throw new RangeError('Invalid PIC/FLIP grid, pressure, transfer or fill options');
    const cells = closed.map(n => 1 - n);
    const u = faceGrid(w + 1, h, 0, .5, (x, y) => x > 0 && x < w && cells[y * w + x] && cells[y * w + x - 1]);
    const v = faceGrid(w, h + 1, .5, 0, (x, y) => y > 0 && y < h && cells[y * w + x] && cells[(y - 1) * w + x]);
    const fluid = new Uint8Array(w * h), shell = Math.ceil(Math.sqrt(particlesPerCell));
    const random = K.grow.dice(P.data.hash('pic-flip-fill', seed));
    const clipSpeed = x => clamp(x, -maxSpeed, maxSpeed);
    let water = [], divergence = [0, 0];
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      if (!cells[p] || !fill.some(([a, b, width, height]) =>
        x + .5 >= a && y + .5 >= b && x + .5 < a + width && y + .5 < b + height)) continue;
      for (let i = 0; i < particlesPerCell; i++) {
        const px = x + (i % shell + .25 + random() * .5) / shell;
        const py = y + (Math.floor(i / shell) + .25 + random() * .5) / shell;
        water.push([px, py, clipSpeed(velocity[0]), clipSpeed(velocity[1])]);
      }
      if (water.length > 12500) throw new RangeError('PIC/FLIP exceeds its particle budget');
    }
    if (!water.length) throw new RangeError('PIC/FLIP fill has no open cells');
    const count = water.length;
    const activeAt = (i, j) => i >= 0 && i < w && j >= 0 && j < h && fluid[j * w + i];

    function deposit(grid, axis) {
      grid.mass.fill(0);
      grid.data.fill(0);
      for (const row of water) weights(grid, row[0], row[1], (i, weight) => {
        grid.mass[i] += weight;
        grid.data[i] += weight * row[axis + 2];
      });
      const known = grid.mass.map((n, i) => {
        if (n) grid.data[i] /= n;
        return Number(n > 0);
      });
      return extend(grid, grid.data, known);
    }

    function advance(dt) {
      fluid.fill(0);
      for (const [x, y] of water) fluid[Math.floor(y) * w + Math.floor(x)] = 1;
      const beforeU = deposit(u, 0), beforeV = deposit(v, 1), nextU = beforeU.slice(), nextV = beforeV.slice();
      const waterU = u.open.map((n, i) => {
        const x = i % u.width, y = Math.floor(i / u.width);
        return Number(n && (activeAt(x - 1, y) || activeAt(x, y)));
      });
      const waterV = v.open.map((n, i) => {
        const x = i % v.width, y = Math.floor(i / v.width);
        return Number(n && (activeAt(x, y - 1) || activeAt(x, y)));
      });
      for (let i = 0; i < nextU.length; i++) if (waterU[i]) nextU[i] += gravity[0] * dt;
      for (let i = 0; i < nextV.length; i++) if (waterV[i]) nextV[i] += gravity[1] * dt;
      divergence = project(w, h, cells, fluid, nextU, nextV, pressureIterations);
      const afterU = extend(u, nextU, waterU), afterV = extend(v, nextV, waterV);
      const refU = extend(u, beforeU, waterU), refV = extend(v, beforeV, waterV);
      for (const row of water) {
        const [x, y, vx, vy] = row, px = sample(u, afterU, x, y), py = sample(v, afterV, x, y);
        row[2] = clipSpeed(K.mix(px, vx + px - sample(u, refU, x, y), flip));
        row[3] = clipSpeed(K.mix(py, vy + py - sample(v, refV, x, y), flip));
        move(row, dt, open);
      }
    }

    function frame() {
      const density = new Float32Array(w * h), speed = new Float32Array(w * h), data = new Uint8Array(w * h * 4);
      for (const [x, y, vx, vy] of water) {
        const ix = Math.floor(x), iy = Math.floor(y), s = Math.hypot(vx, vy);
        for (let b = Math.max(0, iy - 1); b <= Math.min(h - 1, iy + 1); b++)
          for (let a = Math.max(0, ix - 1); a <= Math.min(w - 1, ix + 1); a++) {
            const i = b * w + a, d2 = ((a + .5 - x) ** 2 + (b + .5 - y) ** 2) / 1.75;
            if (closed[i] || d2 >= 1) continue;
            const weight = (1 - d2) ** 2 / particlesPerCell;
            density[i] += weight;
            speed[i] += weight * s;
          }
      }
      for (let i = 0; i < density.length; i++) {
        const d = density[i];
        if (d < surface * .4) continue;
        const edge = clamp(1 - Math.abs(d - surface) / (surface * 1.75));
        const gradient = clamp((d - (density[i - w] ?? 0)) * 1.5);
        const tint = clamp(.18 + edge * .42 + gradient * .28 + Math.min(.2, speed[i] / Math.max(.05, d) * .003));
        data.set(colors[Math.round(tint * (colors.length - 1))], i * 4);
        data[i * 4 + 3] = Math.round(clamp((d - surface * .4) / (surface * .4)) * 255);
      }
      return { value: raster(dims, data, 4), field: raster(dims, density),
        points: water.map(([x, y, vx, vy], id) => ({ id, point: [x, y], velocity: [vx, vy] })),
        count, divergenceBefore: divergence[0], divergenceAfter: divergence[1] };
    }

    return { work: substeps * (w * h * (pressureIterations + 38) + count * 35),
      step(_tick, dt) { for (let i = 0; i < substeps; i++) advance(dt / substeps); },
      capture: () => ({ water, divergence }),
      restore(saved) {
        if (!Array.isArray(saved?.water) || saved.water.length !== count) throw new RangeError('Invalid PIC/FLIP particle count');
        const next = Array.from(saved.water, row => {
          buffer(row, 4);
          if (!open(row[0], row[1]) || Math.max(Math.abs(row[2]), Math.abs(row[3])) > maxSpeed)
            throw new RangeError('Invalid PIC/FLIP particle checkpoint');
          return row.slice();
        });
        divergence = buffer(saved.divergence, 2, 0).slice();
        water = next;
      }, frame
    };
  };
})(KIT);
