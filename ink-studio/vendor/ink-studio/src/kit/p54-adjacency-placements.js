/* Footprint packing and floor plans with explicit shared-wall adjacency. */
(function (K) {
  const P = K.procedural,
    integer = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high,
    idOK = id => typeof id === 'string' && id.length > 0 && id.length <= 120,
    pair = (p, low, high) => Array.isArray(p) && p.length === 2 && p.every(n => integer(n, low, high));

  function solve(items, {
    width, height, blocked, pins = [], gap = 0, adjacencies = [], maxChecks = 1800000, maxCells = 160000
  }, rooms) {
    if (
      !integer(width, 1, 1024) || !integer(height, 1, 1024) || !integer(maxCells, 1, 500000) || width * height > maxCells ||
      !Array.isArray(items) || !integer(items.length, 1, 128) || !Array.isArray(pins) || pins.length > items.length ||
      !integer(gap, 0, 128) || !integer(maxChecks, 1, 30000000) ||
      !Array.isArray(adjacencies) || adjacencies.length > 512 ||
      (blocked !== undefined && typeof blocked !== 'function')
    ) throw new Error('Placements need bounded items, grid, pins and comparison limits');

    const names = new Map(),
      specs = items.map((item, i) => {
        if (!idOK(item?.id) || names.has(item.id) || !pair(item.size, 1, 1024) ||
          (item.rotate !== undefined && typeof item.rotate !== 'boolean'))
          throw new Error('Placement items need unique IDs and positive integer dimensions');
        names.set(item.id, i);
        const [w, h] = item.size,
          shapes = [{ w, h, rotated: false }];
        if (item.rotate && w !== h) shapes.push({ w: h, h: w, rotated: true });
        return { id: item.id, shapes, area: w * h };
      }),
      requirements = Array.from({ length: specs.length }, () => []),
      edges = [],
      duplicates = new Set();
    for (const constraint of adjacencies) {
      const a = names.get(constraint?.a), b = names.get(constraint?.b),
        span = constraint?.span ?? 1,
        key = a < b ? a + ':' + b : b + ':' + a;
      if (a === undefined || b === undefined || a === b || !integer(span, 1, 1024) || duplicates.has(key))
        throw new Error('Floor-plan adjacencies need distinct room pairs and positive wall spans');
      duplicates.add(key);
      requirements[a].push({ other: b, span });
      requirements[b].push({ other: a, span });
      edges.push({ a, b, span });
    }
    const prefix = new Uint32Array((width + 1) * (height + 1)),
      stride = width + 1;
    if (blocked) {
      for (let z = 0; z < height; z++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
          row += Number(Boolean(blocked(x, z)));
          const i = (z + 1) * stride + x + 1;
          prefix[i] = prefix[i - stride] + row;
        }
      }
    }
    function obstacles(x, z, w, h) {
      const a = z * stride + x, b = (z + h) * stride + x;
      return prefix[b + w] - prefix[a + w] - prefix[b] + prefix[a];
    }
    function contact(a, b) {
      if (a.x + a.w === b.x || b.x + b.w === a.x) {
        const x = a.x + a.w === b.x ? b.x : a.x,
          low = Math.max(a.z, b.z), high = Math.min(a.z + a.h, b.z + b.h);
        if (high > low) return [[x, low], [x, high]];
      }
      if (a.z + a.h === b.z || b.z + b.h === a.z) {
        const z = a.z + a.h === b.z ? b.z : a.z,
          low = Math.max(a.x, b.x), high = Math.min(a.x + a.w, b.x + b.w);
        if (high > low) return [[low, z], [high, z]];
      }
      return null;
    }
    const length = ([a, b]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]),
      placed = new Array(specs.length).fill(null),
      fixed = new Set(),
      work = { checks: 0, backtracks: 0 },
      exhausted = Symbol('placement budget');
    function check() {
      if (work.checks >= maxChecks) throw exhausted;
      work.checks++;
    }
    function fits(i, p) {
      check();
      if (p.x < 0 || p.z < 0 || p.x + p.w > width || p.z + p.h > height || obstacles(p.x, p.z, p.w, p.h)) return false;
      for (const [j, q] of placed.entries()) {
        if (!q || j === i) continue;
        check();
        if (p.x < q.x + q.w + gap && q.x < p.x + p.w + gap &&
          p.z < q.z + q.h + gap && q.z < p.z + p.h + gap) return false;
      }
      for (const { other, span } of requirements[i]) {
        if (!placed[other]) continue;
        const wall = contact(p, placed[other]);
        if (!wall || length(wall) < span) return false;
      }
      return true;
    }

    function* options(i) {
      const anchor = requirements[i].find(edge => placed[edge.other]);
      for (const shape of specs[i].shapes) {
        const { w, h } = shape;
        if (!anchor) {
          for (let z = 0; z <= height - h; z++)
            for (let x = 0; x <= width - w; x++) yield { ...shape, x, z };
          continue;
        }
        const q = placed[anchor.other], span = anchor.span;
        if (h >= span && q.h >= span) {
          for (let z = q.z - h + span; z <= q.z + q.h - span; z++) {
            yield { ...shape, x: q.x - w, z };
            yield { ...shape, x: q.x + q.w, z };
          }
        }
        if (w >= span && q.w >= span) {
          for (let x = q.x - w + span; x <= q.x + q.w - span; x++) {
            yield { ...shape, x, z: q.z - h };
            yield { ...shape, x, z: q.z + q.h };
          }
        }
      }
    }
    function search() {
      let choice = -1,
        best = -Infinity;
      for (const [i, spec] of specs.entries()) {
        if (placed[i]) continue;
        const attached = requirements[i].filter(r => placed[r.other]).length,
          score = 2e9 * attached + 2e6 * requirements[i].length + spec.area;
        if (score > best) {
          best = score;
          choice = i;
        }
      }
      if (choice < 0) return true;
      for (const p of options(choice)) {
        if (!fits(choice, p)) continue;
        placed[choice] = p;
        if (search()) return true;
        placed[choice] = null;
        work.backtracks++;
      }
      return false;
    }
    function result(status, data = {}) {
      return P.data.freeze({ status, width, height, ...data, work: { ...work } });
    }
    try {
      for (const pin of pins) {
        const i = names.get(pin?.id);
        if (i === undefined || fixed.has(i) || !pair(pin.at, 0, 1024) ||
          (pin.rotated !== undefined && typeof pin.rotated !== 'boolean'))
          throw new Error('Pins need distinct item IDs and integer coordinates');
        const shape = specs[i].shapes.find(shape => shape.rotated === Boolean(pin.rotated));
        if (!shape) throw new Error('Pinned rotation is unavailable');
        const p = { ...shape, x: pin.at[0], z: pin.at[1] };
        if (!fits(i, p)) return result('contradiction');
        fixed.add(i);
        placed[i] = p;
      }
      if (!search()) return result('contradiction');
      const positions = placed.map((p, i) => ({
        id: specs[i].id, bounds: { min: [p.x, p.z], max: [p.x + p.w, p.z + p.h] }, rotated: p.rotated
      }));
      if (!rooms) return result('ok', { placements: positions });
      const doors = edges.map(({ a, b, span }) => {
        const wall = contact(placed[a], placed[b]),
          point = wall[0].map((value, i) => (value + wall[1][i]) / 2);
        return { a: specs[a].id, b: specs[b].id, wall, point, span };
      });
      return result('ok', { rooms: positions, doors });
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  P.layouts.pack = (items, options = {}) => solve(items, { ...options, adjacencies: [] }, false);
  P.layouts.floorPlan = (rooms, options = {}) => solve(rooms, { ...options, gap: 0 }, true);
})(KIT);
