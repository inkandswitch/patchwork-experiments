/* Pressure-driven flow and use-dependent capacity on a retained graph. */
(function (K) {
  const P = K.procedural, V = K.V;
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const name = v => typeof v === 'string' && v.length >= 1 && v.length <= 128;
  const point = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(n => number(n, -1e6, 1e6));
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const list = (v, max) => Array.isArray(v) && v.length >= 1 && v.length <= max && Array.from(v).every(record);
  const check = (ok, why) => { if (!ok) throw new RangeError('Adaptive transport: ' + why); };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function adaptiveTransport({
    nodes: nodeSpecs, edges: edgeSpecs, dt = .1, reinforce = 2.8, decay = .78, flowScale = .025, exponent = 1,
    tolerance = 1e-9, maxIterations = 1200, maxWork = 36000000
  } = {}) {
    check(list(nodeSpecs, 4096) && list(edgeSpecs, 24000) && number(dt, 1e-5, 1) &&
      number(reinforce, 0, 1000) && number(decay, 0, 1000) && number(flowScale, 1e-6, 1e4) &&
      number(exponent, .1, 8) && number(tolerance, 1e-13, 1e-3) &&
      integer(maxIterations, 1, 10000) && integer(maxWork, 1, 200000000), 'invalid graph or solver controls');

    const nodeIds = new Map(), edgeIds = new Map(), size = nodeSpecs.length;
    const pins = new Float64Array(size).fill(NaN);
    const nodes = nodeSpecs.map(({ id, at, pressure }, i) => {
      check(name(id) && !nodeIds.has(id) && (at === undefined || point(at)) &&
        (pressure == null || number(pressure, 0, 1)), 'nodes need unique IDs and valid points or pressures');
      nodeIds.set(id, i);
      if (pressure != null) pins[i] = pressure;
      return Object.freeze({ id, at: at ? Object.freeze(at.slice()) : null });
    });
    let routePoints = 0;
    const capacities = new Float64Array(edgeSpecs.length), health = new Float64Array(edgeSpecs.length);
    const edges = edgeSpecs.map((spec, i) => {
      const { id, from, to, points, minCapacity = .02, maxCapacity = 1, integrity = 1 } = spec;
      const { capacity = clamp(.18, minCapacity, maxCapacity), reinforce: growth = reinforce,
        decay: loss = decay, flowScale: scale = flowScale } = spec;
      const a = nodeIds.get(from), b = nodeIds.get(to);
      check(name(id) && !edgeIds.has(id) && a !== undefined && b !== undefined && a !== b &&
        number(minCapacity, 1e-6, 1e4) && number(maxCapacity, minCapacity, 1e4) &&
        number(capacity, minCapacity, maxCapacity) && number(integrity, 0, 1) &&
        number(growth, 0, 1000) && number(loss, 0, 1000) && number(scale, 1e-6, 1e4), 'invalid edge, endpoints, or capacity controls');
      const first = nodes[a].at, last = nodes[b].at;
      if (points !== undefined) {
        check(first && last && Array.isArray(points) && integer(points.length, 2, 4097) && Array.from(points).every(point) &&
          V.dist(first, points[0]) <= 1e-7 && V.dist(last, points.at(-1)) <= 1e-7, 'edge points must meet their positioned endpoints');
      }
      const path = points ?? (first && last && [first, last]);
      routePoints += path?.length ?? 0;
      check(routePoints <= 250000, 'authored routes exceed their point budget');
      const route = path ? P.routes.polyline(path) : null, resistance = spec.resistance ?? route?.length ?? 0;
      check(number(resistance, 0, 1e7), 'invalid edge resistance');
      edgeIds.set(id, i);
      capacities[i] = capacity;
      health[i] = integrity;
      return { id, from, to, route, a, b, resistance, minCapacity, maxCapacity, growth, loss, scale };
    });
    const workUnit = size + edges.length, saved = new WeakMap();
    function budget() {
      let work = 0;
      return count => {
        work += count;
        check(work <= maxWork, 'step exceeds its work budget');
      };
    }

    function solve(capacity, integrity, boundary, prior, spend) {
      spend(4 * workUnit);
      const parent = Int32Array.from({ length: size }, (_, i) => i), weight = new Uint32Array(size).fill(1);
      function root(i) {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      }
      const diag = new Float64Array(size), conductance = new Float64Array(edges.length), active = [];
      for (let i = 0; i < edges.length; i++) {
        const { a, b, resistance } = edges[i], g = capacity[i] * integrity[i] / (1 + resistance);
        conductance[i] = g;
        if (!g) continue;
        active.push(i);
        diag[a] += g;
        diag[b] += g;
        let x = root(a), y = root(b);
        if (x === y) continue;
        if (weight[x] < weight[y]) [x, y] = [y, x];
        parent[y] = x;
        weight[x] += weight[y];
      }
      const low = new Float64Array(size).fill(Infinity), high = new Float64Array(size).fill(-Infinity);
      const component = parent.map((_, i) => root(i)), driven = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        if (Number.isNaN(boundary[i])) continue;
        const group = component[i];
        low[group] = Math.min(low[group], boundary[i]);
        high[group] = Math.max(high[group], boundary[i]);
      }
      const pressure = new Float64Array(size), free = [];
      for (let i = 0; i < size; i++) {
        const j = component[i];
        if (low[j] > high[j]) continue;
        driven[i] = 1;
        if (!Number.isNaN(boundary[i])) pressure[i] = boundary[i];
        else if (low[j] === high[j]) pressure[i] = low[j];
        else {
          pressure[i] = prior?.driven[i] ? clamp(prior.pressure[i], low[j], high[j]) : (low[j] + high[j]) / 2;
          free.push(i);
        }
      }

      // Pinned rows are omitted from the solve. Search directions stay zero at pins.
      function laplacian(input, out) {
        spend(size + active.length);
        out.fill(0);
        for (const j of active) {
          const { a, b } = edges[j], flow = conductance[j] * (input[a] - input[b]);
          out[a] += flow;
          out[b] -= flow;
        }
      }
      const net = new Float64Array(size), residual = new Float64Array(size),
        direction = new Float64Array(size), product = new Float64Array(size);
      function restart() {
        laplacian(pressure, net);
        let norm = 0, error = 0;
        for (const i of free) {
          residual[i] = -net[i];
          direction[i] = residual[i] / diag[i];
          norm += residual[i] * direction[i];
          error = Math.max(error, Math.abs(direction[i]));
        }
        return { norm, error };
      }

      let iterations = 0, { norm, error } = restart();
      while (error > tolerance && iterations < maxIterations) {
        laplacian(direction, product);
        let curvature = 0;
        for (const i of free) curvature += direction[i] * product[i];
        if (!(curvature > 0 && norm > 0)) break;
        const alpha = norm / curvature;
        let nextNorm = 0;
        error = 0;
        for (const i of free) {
          pressure[i] += alpha * direction[i];
          residual[i] -= alpha * product[i];
          const z = residual[i] / diag[i];
          nextNorm += residual[i] * z;
          error = Math.max(error, Math.abs(z));
        }
        iterations++;
        if (error <= tolerance) {
          ({ norm, error } = restart());
        } else {
          const beta = nextNorm / norm;
          for (const i of free) direction[i] = residual[i] / diag[i] + beta * direction[i];
          norm = nextNorm;
        }
      }

      for (const i of free) pressure[i] = clamp(pressure[i], low[component[i]], high[component[i]]);
      laplacian(pressure, net);
      let residualHead = 0, imbalance = 0, supplied = 0, delivered = 0;
      for (let i = 0; i < size; i++) {
        if (Number.isNaN(boundary[i])) {
          imbalance = Math.max(imbalance, Math.abs(net[i]));
          if (diag[i]) residualHead = Math.max(residualHead, Math.abs(net[i]) / diag[i]);
        } else {
          supplied += Math.max(0, net[i]);
          delivered += Math.max(0, -net[i]);
        }
      }
      check(Number.isFinite(residualHead) && residualHead <= 2 * tolerance, 'pressure solve did not converge');
      const flow = Float64Array.from(edges, ({ a, b }, i) => conductance[i] * (pressure[a] - pressure[b]));
      return { pressure, driven, conductance, flow, net,
        stats: Object.freeze({ iterations, residualHead, imbalance, supplied, delivered }) };
    }

    let tick = 0, capacity = capacities, integrity = health, boundary = pins;
    let current = solve(capacity, integrity, boundary, null, budget());

    function frame() {
      const nodeFrame = Object.freeze(nodes.map((node, i) => Object.freeze({ ...node,
        pressure: current.driven[i] ? current.pressure[i] : null, pinned: !Number.isNaN(boundary[i]), net: current.net[i] })));
      const edgeFrame = Object.freeze(edges.map(({ id, from, to, route, resistance, minCapacity, maxCapacity }, i) => {
        const limit = capacity[i] * integrity[i], flow = current.flow[i];
        return Object.freeze({ id, from, to, route, resistance, minCapacity, maxCapacity, capacity: capacity[i],
          integrity: integrity[i], conductance: current.conductance[i], flow,
          utilization: limit ? Math.abs(flow) / limit : 0 });
      }));
      return Object.freeze({ tick, time: tick * dt, nodes: nodeFrame, edges: edgeFrame, stats: current.stats,
        node: id => nodeFrame[nodeIds.get(id)] ?? null, edge: id => edgeFrame[edgeIds.get(id)] ?? null });
    }

    function edit({ pressures = {}, integrity: health = {} } = {}) {
      check(record(pressures) && record(health), 'edits need pressure and integrity maps');
      const draftPins = boundary.slice(), draftHealth = integrity.slice();
      for (const [id, value] of Object.entries(pressures)) {
        check(nodeIds.has(id) && (value === null || number(value, 0, 1)), 'invalid pressure edit for ' + id);
        draftPins[nodeIds.get(id)] = value === null ? NaN : value;
      }
      for (const [id, value] of Object.entries(health)) {
        check(edgeIds.has(id) && number(value, 0, 1), 'invalid integrity edit for ' + id);
        draftHealth[edgeIds.get(id)] = value;
      }
      current = solve(capacity, draftHealth, draftPins, current, budget());
      boundary = draftPins;
      integrity = draftHealth;
      return frame();
    }

    function step(count = 1) {
      check(integer(count, 0, 300) && tick + count <= 1e8, 'invalid timestep count');
      let next = capacity, result = current;
      const spend = budget();
      for (let k = 0; k < count; k++) {
        spend(edges.length);
        next = next.map((old, i) => {
          const { minCapacity, maxCapacity, growth, loss, scale } = edges[i];
          const use = Math.min(1, Math.abs(result.flow[i]) / scale) ** exponent;
          const strengthening = growth * use, speed = strengthening + loss;
          if (!speed) return old;
          const target = minCapacity + (maxCapacity - minCapacity) * (strengthening / speed);
          return clamp(old + (target - old) * (-Math.expm1(-speed * dt)), minCapacity, maxCapacity);
        });
        result = solve(next, integrity, boundary, result, spend);
      }
      capacity = next;
      current = result;
      tick += count;
      return frame();
    }

    function checkpoint() {
      const token = Object.freeze({ tick });
      saved.set(token, { tick, capacity, integrity, boundary, current });
      return token;
    }
    function restore(token) {
      const state = saved.get(token);
      check(state, 'checkpoint belongs to a different network');
      ({ tick, capacity, integrity, boundary, current } = state);
      return frame();
    }
    const initial = checkpoint();
    return Object.freeze({ dt, frame, step, edit, checkpoint, restore, reset: () => restore(initial) });
  }

  P.routes.adaptiveTransport = adaptiveTransport;
})(KIT);
