/* Deterministic 2D emitters and falling material for raster effects. */
(function (K) {
  const P = K.procedural, S = P.rasterSimSupport;
  const { kinds, size, obstacles, int, range, vector, clamp, buffer, color, opacity, raster, dot, line, draw, move } = S;

  function sources(rows, limit, defaultColor) {
    if (!Array.isArray(rows) || !int(rows.length, 0, 24)) throw new RangeError('Expected up to 24 emitters');
    return Array.from(rows, (row, i) => {
      const { at, rate = 24, radius = 1, start = 0, end = 1e6, colors = defaultColor } = row;
      if (!vector(at, 2) || !range(rate, 0, limit) || !range(radius, 0, 256) || !range(start, 0, 1e6) ||
          !range(end, start, 1e6) || !Array.isArray(colors) || !int(colors.length, 1, 32))
        throw new RangeError('Invalid emitter position, clock, radius or colors');
      Array.from(colors).forEach(color);
      return { ...row, at, rate, radius, start, end, colors, index: i };
    });
  }

  function emit(row, tick, dt, seed, add) {
    const count = time => Math.floor(clamp(time - row.start, 0, row.end - row.start) * row.rate + 1e-8);
    const first = count((tick - 1) * dt), last = count(tick * dt);
    for (let serial = first; serial < last; serial++) {
      const random = K.grow.dice(P.data.hash(row.index + '/' + serial, seed)), angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * row.radius;
      add([row.at[0] + Math.cos(angle) * radius, row.at[1] + Math.sin(angle) * radius], random, serial);
    }
  }

  function particles(options, { seed, dt: fixedDt }) {
    const dims = size(options), { open } = obstacles(options, dims);
    const { gravity = [0, 28], drag = .35, bounce = .4, limit = 1200, maxSpeed = 220,
      emitters = [{ at: [dims.width / 2, dims.height * .78], velocity: [0, -62] }] } = options;
    if (!vector(gravity, 2) || !range(drag, 0, 20) || !range(bounce, 0, 1) ||
        !int(limit, 1, 4000) || !range(maxSpeed, .1, 1000)) throw new RangeError('Invalid particle forces, bounce or capacity');
    const spawns = sources(emitters, 2400, ['#f3bf74', '#ffdd9c', '#e8765b']).map(row => {
      const { velocity = [0, -60], spread = 22, life = [1, 2.2], size = .75, trail = 0 } = row;
      if (!vector(velocity, 2) || !range(spread, 0, 1000) || !vector(life, 2) || !range(life[0], .01, 600) ||
          !range(life[1], life[0], 600) || !range(size, .25, 32) || !range(trail, 0, 1))
        throw new RangeError('Invalid particle velocity, lifetime or mark');
      return { ...row, velocity, spread, life, size, trail };
    });
    let rows = [];
    const limitSpeed = n => clamp(n, -maxSpeed, maxSpeed);
    function step(tick, dt) {
      const retain = Math.exp(-drag * dt), time = tick * dt;
      for (const row of rows) {
        row[2] = limitSpeed((row[2] + gravity[0] * dt) * retain);
        row[3] = limitSpeed((row[3] + gravity[1] * dt) * retain);
        move(row, dt, open, bounce);
      }
      rows = rows.filter(row => time < row[4] + row[5]);
      for (const source of spawns) emit(source, tick, dt, seed, (p, random, id) => {
        if (rows.length >= limit || !open(...p)) return;
        const x = limitSpeed(source.velocity[0] + (random() * 2 - 1) * source.spread);
        const y = limitSpeed(source.velocity[1] + (random() * 2 - 1) * source.spread);
        rows.push([...p, x, y, time, K.mix(...source.life, random()), source.index, Math.floor(random() * source.colors.length), id]);
      });
    }
    return { work: limit * 6, step, capture: () => ({ rows }),
      restore(saved) {
        if (!Array.isArray(saved?.rows) || saved.rows.length > limit) throw new RangeError('Invalid particle checkpoint');
        rows = Array.from(saved.rows, row => {
          const p = buffer(row, 9), source = spawns[p[6]];
          if (!source || !int(p[6], 0, spawns.length - 1) || !int(p[7], 0, source.colors.length - 1) ||
              !int(p[8], 0, 1e9) || !open(p[0], p[1]) || !range(p[5], .01, 600) ||
              Math.max(Math.abs(p[2]), Math.abs(p[3])) > maxSpeed) throw new RangeError('Invalid particle checkpoint row');
          return p.slice();
        });
      },
      frame(tick) {
        const commands = [], points = [], time = tick * fixedDt;
        for (const [x, y, vx, vy, born, life, emitter, tint, id] of rows) {
          const s = spawns[emitter], p = [x, y], a = clamp(1 - (time - born) / life), fill = s.colors[tint];
          if (s.trail && (vx || vy)) commands.push(line([[x - vx * s.trail, y - vy * s.trail], p], opacity(fill, a * .48)));
          commands.push(dot(p, s.size, opacity(fill, a)));
          points.push({ id: emitter + '/' + id, point: p, velocity: [vx, vy], age: time - born, life });
        }
        return { value: draw(dims, commands), points, count: rows.length };
      }
    };
  }

  function grain(options, { seed }) {
    const dims = size(options), { width: w, height: h } = dims, { closed, open } = obstacles(options, dims);
    const { initial = [], palette = ['#b37846', '#e0a15f', '#f3c77b', '#ffdb9b'],
      emitters = [{ at: [w / 2, 2], rate: 260, radius: 4 }], steps = 2 } = options;
    const rgb = Array.isArray(palette) && int(palette.length, 1, 64) && palette.map(color);
    if (!rgb || !int(steps, 1, 8) || !Array.isArray(initial) || initial.length > 128) throw new RangeError('Invalid grain settings');
    const converters = sources(emitters, 4800, ['#ffffff']);
    let grid = new Uint8Array(w * h), grains = 0;
    function place(x, y, value) {
      if (!open(x, y) || grid[y * w + x]) return false;
      grid[y * w + x] = value;
      grains++;
      return true;
    }
    const random = K.grow.dice(P.data.hash('grain-init', seed));
    for (const { rect, index } of initial) {
      if (!vector(rect, 4) || !rect.every(Number.isSafeInteger) || !int(rect[2], 1, w) || !int(rect[3], 1, h) ||
          index !== undefined && !int(index, 0, rgb.length - 1)) throw new RangeError('Invalid initial grain fill');
      for (let y = Math.max(0, rect[1]); y < Math.min(h, rect[1] + rect[3]); y++)
        for (let x = Math.max(0, rect[0]); x < Math.min(w, rect[0] + rect[2]); x++)
          place(x, y, 1 + (index ?? Math.floor(random() * rgb.length)));
    }
    const free = (x, y) => x >= 0 && x < w && !grid[y * w + x] && !closed[y * w + x];
    function step(tick, dt) {
      for (const source of converters) emit(source, tick, dt, seed, ([x, y], random) =>
        place(Math.floor(x), Math.floor(y), 1 + Math.floor(random() * rgb.length)));
      const random = K.grow.dice(P.data.hash('grain:' + tick, seed));
      for (let sub = 0; sub < steps; sub++) for (let y = h - 2; y >= 0; y--) {
        const direction = random() < .5 ? 1 : -1;
        for (let u = 0; u < w; u++) {
          const x = direction > 0 ? u : w - 1 - u, i = y * w + x, value = grid[i];
          if (!value) continue;
          const side = random() < .5 ? 1 : -1;
          const shift = free(x, y + 1) ? 0 : free(x + side, y + 1) ? side : free(x - side, y + 1) ? -side : null;
          if (shift === null) continue;
          grid[i] = 0;
          grid[i + w + shift] = value;
        }
      }
    }
    return { work: w * h * steps, step, capture: () => ({ grid }),
      restore(saved) {
        const data = buffer(saved?.grid, grid.length, 0, rgb.length);
        if (data.some((n, i) => !Number.isInteger(n) || n && closed[i])) throw new RangeError('Invalid grain checkpoint cells');
        grid = Uint8Array.from(data);
        grains = grid.reduce((sum, n) => sum + Number(n > 0), 0);
      },
      frame() {
        const data = new Uint8Array(w * h * 4), fill = new Float32Array(w * h);
        for (let i = 0; i < grid.length; i++) if (grid[i]) {
          const supported = i >= w && !grid[i - w];
          for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(rgb[grid[i] - 1][c] * (supported ? 1 : .88));
          data[i * 4 + 3] = 255;
          fill[i] = 1;
        }
        return { value: raster(dims, data, 4), field: raster(dims, fill), grains };
      }
    };
  }

  kinds.particles = particles;
  kinds.grain = grain;
})(KIT);
