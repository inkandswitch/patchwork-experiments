/* Recursive room partitions and cellular cave layouts with connectivity repair. */
(function (K) {
  const P = K.procedural;
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;

  function dimensions(width, height, budget) {
    if (
      !integer(width, 3, 1024) || !integer(height, 3, 1024) ||
      !integer(budget, 9, 500000) || width * height > budget
    ) throw new Error('Layout dimensions exceed the cell budget');
  }

  function bsp({
    width, height, seed = 0, minRoom = 4, margin = 1,
    maxDepth = 6, maxRooms = 512, corridorWidth = 1, maxCells = 160000
  } = {}) {
    dimensions(width, height, maxCells);
    if (
      !integer(minRoom, 1, Math.min(width, height)) || !integer(margin, 0, 64) ||
      minRoom + margin * 2 > Math.min(width, height) || !integer(maxDepth, 0, 14) ||
      !integer(maxRooms, 1, 4096) || !integer(corridorWidth, 1, Math.min(width, height)) ||
      !Number.isSafeInteger(seed)
    ) throw new Error('Room partition needs feasible room, margin and corridor settings');
    const dice = K.grow.dice(P.data.hash('room-partitions', seed)),
      minLeaf = minRoom + margin * 2,
      cells = new Uint8Array(width * height),
      rooms = [],
      corridors = [],
      choose = (low, high) => low + Math.floor(dice() * (high - low + 1));
    function fill(x0, z0, x1, z1) {
      const low = Math.max(0, x0),
        high = Math.min(width, x1);
      for (let z = Math.max(0, z0); z < Math.min(height, z1); z++) {
        cells.fill(1, z * width + low, z * width + high);
      }
    }
    function passage(a, b, path) {
      const corner = dice() < 0.5 ? [a[0], b[1]] : [b[0], a[1]],
        points = [a];
      if (corner.some((v, i) => v !== a[i]) && corner.some((v, i) => v !== b[i])) points.push(corner);
      points.push(b);
      const radius = Math.floor((corridorWidth - 1) / 2),
        high = corridorWidth - radius;
      for (let i = 1; i < points.length; i++) {
        const [x1, z1] = points[i - 1],
          [x2, z2] = points[i];
        fill(
          Math.min(x1, x2) - radius, Math.min(z1, z2) - radius,
          Math.max(x1, x2) + high, Math.max(z1, z2) + high
        );
      }
      corridors.push(Object.freeze({
        id: 'corridor:' + path,
        route: P.routes.polyline(points.map(([x, z]) => [x + 0.5, 0, z + 0.5]))
      }));
    }
    function split(box, path, level) {
      const size = box.max.map((v, i) => v - box.min[i]),
        viable = size.map(value => value >= minLeaf * 2);
      if (level < maxDepth && viable.some(Boolean)) {
        let axis = 0;
        if (!viable[0] || size[1] > 1.35 * size[0] && viable[1]) axis = 1;
        else if (viable[1] && size[0] <= 1.35 * size[1]) axis = +(dice() < 0.5);
        const cut = choose(box.min[axis] + minLeaf, box.max[axis] - minLeaf),
          before = { min: box.min.slice(), max: box.max.slice() },
          after = { min: box.min.slice(), max: box.max.slice() };
        before.max[axis] = cut;
        after.min[axis] = cut;
        const a = split(before, path + '0', level + 1),
          b = split(after, path + '1', level + 1);
        let pair = [a[0], b[0]],
          gap = Infinity;
        for (const left of a) {
          for (const right of b) {
            const distance = Math.abs(left.center[0] - right.center[0]) + Math.abs(left.center[1] - right.center[1]);
            if (distance < gap) {
              gap = distance;
              pair = [left, right];
            }
          }
        }
        passage(pair[0].center, pair[1].center, path);
        return a.concat(b);
      }
      if (rooms.length >= maxRooms) throw new Error('Room partition exceeds its room budget');
      const spare = size.map(n => Math.floor((n - minLeaf) * 0.32)),
        min = box.min.map((v, i) => choose(v + margin, v + margin + spare[i])),
        max = box.max.map((v, i) => choose(Math.max(min[i] + minRoom, v - margin - spare[i]), v - margin)),
        center = min.map((v, i) => Math.floor((v + max[i] - 1) / 2)),
        room = { id: 'room:' + path, bounds: { min, max }, center };
      rooms.push(room);
      fill(min[0], min[1], max[0], max[1]);
      return [room];
    }
    split({ min: [0, 0], max: [width, height] }, 'root', 0);
    return Object.freeze({ width, height, cells, rooms: P.data.freeze(rooms), corridors: Object.freeze(corridors) });
  }

  function cave({
    width, height, seed = 0, openChance = 0.48, steps = 4, minArea = Math.min(12, width * height),
    repair = true, mask, open = [], solid = [], corridorWidth = 1, maxCells = 160000, maxWork = 9000000
  } = {}) {
    dimensions(width, height, maxCells);
    if (
      !Number.isSafeInteger(seed) || !Number.isFinite(openChance) || openChance < 0 || openChance > 1 ||
      !integer(steps, 0, 64) || !integer(minArea, 1, width * height) || typeof repair !== 'boolean' ||
      (mask !== undefined && typeof mask !== 'function') ||
      ![open, solid].every(a => Array.isArray(a) && a.length <= width * height) ||
      !integer(corridorWidth, 1, 9) || !integer(maxWork, 1, 50000000)
    ) throw new Error('Cave generation needs bounded grid, rules and pins');
    const size = width * height,
      dice = K.grow.dice(P.data.hash('cave-layout', seed)),
      locks = new Int8Array(size),
      allowed = new Uint8Array(size),
      exhausted = Symbol('cave work budget'),
      work = { checks: 0, steps: 0 },
      connections = [];
    let current = new Uint8Array(size),
      next = new Uint8Array(size),
      components = null,
      status = 'ok';
    const index = (x, z) => z * width + x,
      coords = i => [i % width, Math.floor(i / width)],
      inGrid = (x, z) => x >= 0 && x < width && z >= 0 && z < height;
    function check(n = 1) {
      if (work.checks + n > maxWork) throw exhausted;
      work.checks += n;
    }
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const i = index(x, z);
        allowed[i] = Number(!mask || mask(x, z));
        if (!allowed[i] || x === 0 || x === width - 1 || z === 0 || z === height - 1) locks[i] = -1;
        current[i] = Number(!locks[i] && dice() < openChance);
      }
    }
    function pin(list, value) {
      for (const p of list) {
        if (!Array.isArray(p) || p.length !== 2 || !integer(p[0], 0, width - 1) || !integer(p[1], 0, height - 1))
          throw new Error('Cave pins need in-range XZ indices');
        const i = index(...p);
        if (value > 0 && !allowed[i]) throw new Error('An open cave pin is outside the allowed mask');
        if (value < 0 && locks[i] > 0) throw new Error('Conflicting cave pins');
        locks[i] = value;
        current[i] = Number(value > 0);
      }
    }
    pin(open, 1);
    pin(solid, -1);
    function adjacent(i, visit) {
      const x = i % width,
        z = Math.floor(i / width);
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (z > 0) visit(i - width);
      if (z < height - 1) visit(i + width);
    }
    function groups() {
      const owner = new Int32Array(size).fill(-1),
        regions = [];
      check(size);
      for (let i = 0; i < size; i++) {
        if (!current[i] || owner[i] >= 0) continue;
        const list = [i],
          id = regions.length;
        owner[i] = id;
        for (let j = 0; j < list.length; j++) {
          check();
          adjacent(list[j], other => {
            if (!current[other] || owner[other] >= 0) return;
            owner[other] = id;
            list.push(other);
          });
        }
        regions.push(list);
      }
      return { owner, regions };
    }
    function connect(owner, regions) {
      let main = 0;
      for (let i = 1; i < regions.length; i++) if (regions[i].length > regions[main].length) main = i;
      const queue = regions[main].slice(),
        parent = new Int32Array(size).fill(-2);
      for (const i of queue) parent[i] = -1;
      let target = -1;
      for (let h = 0; h < queue.length && target < 0; h++) {
        check();
        const i = queue[h];
        adjacent(i, j => {
          if (target >= 0 || parent[j] !== -2 || locks[j] < 0) return;
          parent[j] = i;
          if (owner[j] >= 0 && owner[j] !== main) target = j;
          else queue.push(j);
        });
      }
      if (target < 0) return false;
      const path = [];
      for (let i = target; i >= 0; i = parent[i]) path.push(coords(i));
      const radius = Math.floor((corridorWidth - 1) / 2),
        high = corridorWidth - radius - 1;
      check(path.length * corridorWidth * corridorWidth);
      for (const [x, z] of path) {
        for (let u = -radius; u <= high; u++) {
          for (let v = -radius; v <= high; v++) {
            if (!inGrid(x + u, z + v)) continue;
            const i = index(x + u, z + v);
            if (locks[i] >= 0) current[i] = 1;
          }
        }
      }
      connections.push(P.data.freeze(path.reverse()));
      return true;
    }
    try {
      for (let step = 0; step < steps; step++) {
        check(size);
        for (let i = 0; i < size; i++) {
          if (locks[i]) {
            next[i] = Number(locks[i] > 0);
            continue;
          }
          const [x, z] = coords(i);
          let wall = 0;
          for (let u = -1; u <= 1; u++) {
            for (let v = -1; v <= 1; v++) {
              if ((u || v) && (!inGrid(x + u, z + v) || !current[index(x + u, z + v)])) wall++;
            }
          }
          next[i] = wall >= 5 ? 0 : wall <= 3 ? 1 : current[i];
        }
        [current, next] = [next, current];
        work.steps++;
      }
      for (const region of groups().regions) {
        if (region.length >= minArea || region.some(i => locks[i] > 0)) continue;
        for (const i of region) current[i] = 0;
      }
      let g = groups();
      while (repair && g.regions.length > 1) {
        if (!connect(g.owner, g.regions)) {
          status = 'disconnected';
          break;
        }
        g = groups();
      }
      components = g.regions.length;
    } catch (error) {
      if (error !== exhausted) throw error;
      status = 'budget';
    }
    return Object.freeze({ status, width, height, cells: current, components,
      connections: Object.freeze(connections), work: Object.freeze(work) });
  }

  P.layouts = { bsp, cave };
})(KIT);
