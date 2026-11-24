/* First-order fast marching for isotropic travel-time fields on a bounded XZ grid. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    integer = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max,
    point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6),
    clamp = (value, low, high) => Math.max(low, Math.min(high, value)),
    distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  const frontier = () => new ProceduralHeap((a,b)=>a.value<b.value||a.value===b.value&&a.i<b.i);
  function march(queue,live,accept,stop) {
    while(queue.size){
      const next=queue.peek();
      if(!live(next)){queue.pop();continue;}
      const reason=stop?.(next.value);
      if(reason)return reason;
      accept(queue.pop());
    }
    return 'exhausted';
  }

  // Incremental reverse propagation for sampled graphs with weighted edges.
  function travelCosts(seeds,maxCells){
    const pending=new Map(), fixed=new Map(), queue=frontier();
    function offer(i,value,next){
      if(!Number.isFinite(value)||fixed.has(i)||value>=(pending.get(i)?.value??Infinity))return;
      const entry={i,value,next};
      pending.set(i,entry);
      queue.push(entry);
    }
    for(const [i,value] of seeds)offer(i,value,null);
    return Object.freeze({
      get settled(){return fixed.size;},
      at:i=>fixed.get(i),
      advance(neighbors,ready,visit){
        return march(queue,entry=>pending.get(entry.i)===entry,entry=>{
          pending.delete(entry.i);
          fixed.set(entry.i,entry);
          visit(entry);
          neighbors(entry.i,(i,cost)=>offer(i,entry.value+cost,entry.i));
        },value=>ready(value)?'ready':fixed.size>=maxCells?'budget':null);
      }
    });
  }

  function travelTime(sources, { bounds, cell = 0.5, speed = () => 1, maxCells = 80000 } = {}) {
    if (
      !point(bounds?.min) || !point(bounds?.max) || bounds.min.some((x, i) => bounds.max[i] - x <= EPS) ||
      !Array.isArray(sources) || !integer(sources.length, 256) || !sources.every(point) ||
      !Number.isFinite(cell) || cell < 1e-5 || typeof speed !== 'function' || !integer(maxCells, 250000)
    ) throw new Error('Fast marching needs bounded XZ coordinates, seeds, speed, and a cell budget');
    const [x0, z0] = bounds.min,
      [x1, z1] = bounds.max,
      cols = Math.ceil((x1 - x0) / cell) + 1,
      rows = Math.ceil((z1 - z0) / cell) + 1,
      count = cols * rows;
    if (count > maxCells) throw new Error('Fast marching exceeds its cell budget');
    const dx = (x1 - x0) / (cols - 1), dz = (z1 - z0) / (rows - 1),
      pointAt = i => {
        const x = i % cols, z = Math.floor(i / cols);
        return [x === cols - 1 ? x1 : x0 + x * dx, z === rows - 1 ? z1 : z0 + z * dz];
      },
      indexAt = (x, z) => x < 0 || x >= cols || z < 0 || z >= rows ? -1 : z * cols + x,
      contained = ([x, z]) => x >= x0 - EPS && x <= x1 + EPS && z >= z0 - EPS && z <= z1 + EPS,
      pins = sources.map(p => p.slice()),
      pinKeys = new Set(pins.map(p => p.join(':'))),
      times = new Float64Array(count).fill(Infinity),
      rates = new Float64Array(count),
      fixed = new Uint8Array(count),
      owner = new Int16Array(count).fill(-1),
      parent = new Int32Array(count).fill(-1),
      queue = frontier(),
      stride = Math.min(dx, dz),
      work = { accepted: 0 };
    function rate(x, z) {
      const value = speed(x, z);
      if (!Number.isFinite(value) || value > 1e8 || (value > 0 && value < 1e-8))
        throw new Error('Fast marching speed must be finite and within its positive range');
      return value;
    }
    function clear(a, b) {
      const n = Math.max(1, Math.ceil(4 * Math.max(Math.abs(b[0] - a[0]) / dx, Math.abs(b[1] - a[1]) / dz)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (rate(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) <= 0) return false;
      }
      return true;
    }
    function around(p) {
      return [(p[0] - x0) / dx, (p[1] - z0) / dz];
    }
    function queueAt(i, value, source, previous) {
      if (value >= times[i]) return;
      times[i] = value;
      owner[i] = source;
      parent[i] = previous;
      queue.push({ i, value });
    }
    for (let i = 0; i < count; i++) rates[i] = rate(...pointAt(i));
    const openX = new Uint8Array(count), openZ = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (rates[i] <= 0) continue;
      const p = pointAt(i), x = i % cols, z = Math.floor(i / cols);
      if (x + 1 < cols && rates[i + 1] > 0) openX[i] = Number(clear(p, pointAt(i + 1)));
      if (z + 1 < rows && rates[i + cols] > 0) openZ[i] = Number(clear(p, pointAt(i + cols)));
    }
    for (const [source, p] of pins.entries()) {
      const exact = rate(...p);
      if (!contained(p) || exact <= 0) throw new Error('Fast marching sources need passable positions within the grid');
      const [u, v] = around(p);
      let connected = false;
      for (let z = Math.floor(v); z <= Math.ceil(v); z++) {
        for (let x = Math.floor(u); x <= Math.ceil(u); x++) {
          const i = indexAt(x, z);
          if (i < 0 || rates[i] <= 0) continue;
          const q = pointAt(i);
          if (!clear(p, q)) continue;
          connected = true;
          queueAt(i, 2 * distance(p, q) / (exact + rates[i]), source, -1);
        }
      }
      if (!connected) throw new Error('Fast marching source could not connect to a passable lattice point');
    }
    function neighbor(a, b) {
      const left = a >= 0 && fixed[a], right = b >= 0 && fixed[b];
      if (!left) return right ? b : -1;
      if (!right) return a;
      return times[a] <= times[b] ? a : b;
    }
    const wx = 1 / (dx * dx), wz = 1 / (dz * dz), weights = wx + wz;
    function update(i) {
      if (i < 0 || fixed[i] || rates[i] <= 0) return;
      const x = i % cols, z = Math.floor(i / cols),
        a = neighbor(openX[i - 1] ? indexAt(x - 1, z) : -1, openX[i] ? indexAt(x + 1, z) : -1),
        b = neighbor(openZ[i - cols] ? indexAt(x, z - 1) : -1, openZ[i] ? indexAt(x, z + 1) : -1),
        u = a < 0 ? Infinity : times[a],
        v = b < 0 ? Infinity : times[b],
        speed = rates[i];
      let value = Math.min(u + dx / speed, v + dz / speed),
        previous = u + dx / speed <= v + dz / speed ? a : b;
      if (a >= 0 && b >= 0) {
        const difference = u - v,
          half = (wx * wz / weights) * difference * difference,
          slowness = 1 / speed,
          room = slowness * slowness - half;
        if (room >= 0) {
          const coupled = Math.min(u, v) + (difference > 0 ? wx : wz) * Math.abs(difference) / weights + Math.sqrt(room / weights);
          if (coupled >= Math.max(u, v)) {
            value = Math.min(value, coupled);
            previous = u <= v ? a : b;
          }
        }
      }
      if (previous >= 0) queueAt(i, value, owner[previous], previous);
    }
    march(queue,({i,value})=>!fixed[i]&&value===times[i],({i})=>{
      fixed[i] = 1;
      work.accepted++;
      const x = i % cols, z = Math.floor(i / cols);
      update(indexAt(x - 1, z));
      update(indexAt(x + 1, z));
      update(indexAt(x, z - 1));
      update(indexAt(x, z + 1));
    });
    function time(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !contained([x, z])) return Infinity;
      if (pinKeys.has(x + ':' + z)) return 0;
      const [u, v] = around([x, z]),
        i = clamp(Math.floor(u), 0, cols - 2), j = clamp(Math.floor(v), 0, rows - 2),
        s = clamp(u - i, 0, 1), t = clamp(v - j, 0, 1);
      let value = 0;
      for (const [offset, weight] of [[0, (1 - s) * (1 - t)], [1, s * (1 - t)], [cols, (1 - s) * t], [cols + 1, s * t]]) {
        if (weight <= EPS) continue;
        const sample = times[j * cols + i + offset];
        if (!Number.isFinite(sample)) return Infinity;
        value += weight * sample;
      }
      return value;
    }
    function trace(start, { height = () => 0, step = stride * 0.45, maxSteps = 4095 } = {}) {
      if (!point(start) || !contained(start) || typeof height !== 'function' || !Number.isFinite(step) || step <= EPS ||
        step > stride || !integer(maxSteps, 4095))
        throw new Error('Travel-time tracing needs a bounded pin, positive step and height sampler');
      const completed = (status, fields = {}) => Object.freeze({ status, ...fields });
      if (rate(...start) <= 0) return completed('blocked');
      const path = [start.slice()];
      function atWorld(p) {
        const y = height(...p);
        if (!Number.isFinite(y)) throw new Error('Travel-time route heights must be finite');
        return [p[0], y, p[1]];
      }
      function finish(index) {
        const pin = pins[index];
        if (distance(path.at(-1), pin) > EPS) path.push(pin);
        else path[path.length - 1] = pin;
        return path.length === 1
          ? completed('at-source', { point: Object.freeze(atWorld(pin)), source: index })
          : completed('ok', { route: P.routes.polyline(path.map(atWorld)), source: index, tracedTime: time(...start) });
      }
      for (let i = 0; i < maxSteps; i++) {
        const p = path.at(-1), value = time(...p);
        for (const [source, pin] of pins.entries())
          if (distance(p, pin) <= step * 1.9 && clear(p, pin)) return finish(source);
        const h = stride * 0.2,
          dU = time(p[0] + h, p[1]) - time(p[0] - h, p[1]),
          dV = time(p[0], p[1] + h) - time(p[0], p[1] - h),
          d = Math.hypot(dU, dV);
        if (Number.isFinite(d) && d > EPS) {
          const candidate = [p[0] - step * dU / d, p[1] - step * dV / d];
          if (contained(candidate) && time(...candidate) < value - EPS && clear(p, candidate)) {
            path.push(candidate);
            continue;
          }
        }
        const [u, v] = around(p), x = Math.round(u), z = Math.round(v),
          current = indexAt(x, z);
        let best = -1, priority = value;
        if (current >= 0 && distance(pointAt(current), p) <= EPS && owner[current] >= 0) {
          if (parent[current] < 0 && clear(p, pins[owner[current]])) return finish(owner[current]);
          if (parent[current] >= 0 && clear(p, pointAt(parent[current]))) best = parent[current];
        }
        if (best < 0) {
          for (let j = z - 1; j <= z + 1; j++) {
            for (let k = x - 1; k <= x + 1; k++) {
              const id = indexAt(k, j);
              if (id < 0 || times[id] >= priority - EPS || distance(pointAt(id), p) <= EPS || !clear(p, pointAt(id))) continue;
              priority = times[id];
              best = id;
            }
          }
        }
        if (best < 0) return completed('unreachable');
        path.push(pointAt(best));
      }
      return completed('budget');
    }
    return Object.freeze({
      grid: P.data.freeze({ origin: [x0, z0], spacing: [dx, dz], columns: cols, rows }),
      values: times, time, trace, work: Object.freeze(work)
    });
  }

  P.routes.travelTime = travelTime;
  P.routes.travelCosts = travelCosts;
})(KIT);
