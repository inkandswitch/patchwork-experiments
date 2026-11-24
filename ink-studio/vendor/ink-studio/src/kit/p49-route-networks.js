/* Delaunay road networks, minimum spanning trees with loops, and graph Steiner approximations. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    point = p => Array.isArray(p) && p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6),
    edgeOrder = (a, b) => a.cost - b.cost || a.a - b.a || a.b - b.b;

  function tree(size, edges) {
    const parent = Int32Array.from({ length: size }, (_, i) => i),
      weight = new Uint32Array(size).fill(1);
    function root(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    const picked = [];
    for (const edge of edges.slice().sort(edgeOrder)) {
      let a = root(edge.a), b = root(edge.b);
      if (a === b) continue;
      if (weight[a] < weight[b]) [a, b] = [b, a];
      parent[b] = a;
      weight[a] += weight[b];
      picked.push(edge);
    }
    return picked;
  }

  function graph(n, edges) {
    const adjacency = Array.from({ length: n }, () => []);
    for (const edge of edges) {
      adjacency[edge.a].push({ vertex: edge.b, edge });
      adjacency[edge.b].push({ vertex: edge.a, edge });
    }
    return adjacency;
  }

  function shortest(adjacency, from, stop, check) {
    const values = new Float64Array(adjacency.length).fill(Infinity),
      parent = new Array(adjacency.length),
      queue = new ProceduralHeap((a, b) => a.cost < b.cost || (a.cost === b.cost && a.vertex < b.vertex));
    values[from] = 0;
    queue.push({ vertex: from, cost: 0 });
    while (queue.size) {
      const { vertex, cost } = queue.pop();
      if (cost !== values[vertex]) continue;
      if (vertex === stop) break;
      for (const next of adjacency[vertex]) {
        check();
        const total = cost + next.edge.cost;
        if (total >= values[next.vertex]) continue;
        values[next.vertex] = total;
        parent[next.vertex] = { from: vertex, edge: next.edge };
        queue.push({ vertex: next.vertex, cost: total });
      }
    }
    return { values, parent };
  }

  function network(input, { loops = 0, minStretch = 1.25, cost, constraints, maxChecks = 3500000 } = {}) {
    if (
      !Array.isArray(input) || !integer(input.length, 1, 6000) || !input.every(point) ||
      !integer(loops, 0, 128) || !Number.isFinite(minStretch) || minStretch < 1 ||
      (cost !== undefined && typeof cost !== 'function') || !integer(maxChecks, 1, 30000000)
    ) throw new Error('A route network needs world sites, loop controls and a work budget');
    const points = P.data.freeze(input.map(p => p.slice())),
      triangulation = P.geometry.delaunay(points.map(([x, , z]) => [x, z]), { constraints }),
      candidates = [];
    for (const [a, b] of triangulation.edges) {
      const distance = V.dist(points[a], points[b]),
        weight = cost ? cost(points[a], points[b], a, b) : distance;
      if (weight === Infinity) continue;
      if (distance < 1e-8 || !Number.isFinite(weight) || weight <= 0) throw new Error('Network edge costs must be positive or infinity');
      candidates.push({ a, b, cost: weight });
    }
    const base = tree(points.length, candidates),
      current = base.slice(), marked = new Set(base),
      work = { checks: 0, loops: 0 },
      result = (status, fields = {}) => Object.freeze({ status, points, ...fields, work: Object.freeze({ ...work }) }),
      exhausted = Symbol('network comparison limit');
    if (base.length !== points.length - 1) return result('unreachable');
    function check() {
      if (work.checks >= maxChecks) throw exhausted;
      work.checks++;
    }
    try {
      for (let n = 0; n < loops; n++) {
        const adjacent = graph(points.length, current);
        let chosen = null, benefit = minStretch;
        for (const edge of candidates) {
          if (marked.has(edge)) continue;
          const { values } = shortest(adjacent, edge.a, edge.b, check),
            ratio = values[edge.b] / edge.cost;
          if (ratio <= benefit) continue;
          benefit = ratio;
          chosen = edge;
        }
        if (!chosen) break;
        current.push(chosen);
        marked.add(chosen);
        work.loops++;
      }
      return result('ok', {
        edges: Object.freeze(current.map((edge, i) => Object.freeze({
          ...edge, loop: i >= base.length, route: P.routes.polyline([points[edge.a], points[edge.b]])
        }))),
        candidates: P.data.freeze(candidates), triangulation
      });
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  function steiner(input, links, terminals, { maxChecks = 8000000 } = {}) {
    if (
      !Array.isArray(input) || !integer(input.length, 1, 20000) || !input.every(point) ||
      !Array.isArray(links) || links.length > 200000 ||
      !Array.isArray(terminals) || !integer(terminals.length, 2, 256) ||
      new Set(terminals).size !== terminals.length || !terminals.every(i => integer(i, 0, input.length - 1)) ||
      !integer(maxChecks, 1, 30000000)
    ) throw new Error('Steiner paths need world sites, graph links, distinct terminal indices and a work budget');
    const size = input.length, nodes = P.data.freeze(input.map(p => p.slice())),
      edges = links.map((edge, index) => {
        let { a, b } = edge ?? {};
        if (!integer(a, 0, size - 1) || !integer(b, 0, size - 1) || a === b) throw new Error('Invalid Steiner graph edge');
        if (a > b) [a, b] = [b, a];
        const separation = V.dist(nodes[a], nodes[b]),
          cost = edge.cost ?? separation;
        if (separation < 1e-8 || !Number.isFinite(cost) || cost <= 0) throw new Error('Steiner edges need finite positive costs');
        return { a, b, cost, index };
      }),
      adjacent = graph(size, edges),
      closure = [], search = [],
      work = { checks: 0 },
      exhausted = Symbol('Steiner comparison limit'),
      result = (status, data = {}) => Object.freeze({ status, ...data, work: Object.freeze({ ...work }) });
    function check() {
      if (work.checks >= maxChecks) throw exhausted;
      work.checks++;
    }
    try {
      for (const [i, terminal] of terminals.entries()) {
        const run = shortest(adjacent, terminal, -1, check);
        search.push(run.parent);
        for (let j = i + 1; j < terminals.length; j++) {
          const cost = run.values[terminals[j]];
          if (Number.isFinite(cost)) closure.push({ a: i, b: j, cost });
        }
      }
      const connection = tree(terminals.length, closure);
      if (connection.length !== terminals.length - 1) return result('unreachable');
      const traced = new Set();
      for (const { a, b } of connection) {
        let at = terminals[b];
        while (at !== terminals[a]) {
          const p = search[a][at];
          traced.add(p.edge);
          at = p.from;
        }
      }
      const prunable = tree(size, [...traced]), lists = graph(size, prunable),
        fixed = new Set(terminals), live = new Set(prunable), degree = lists.map(row => row.length),
        leaves = degree.flatMap((count, i) => count === 1 && !fixed.has(i) ? [i] : []);
      while (leaves.length) {
        const i = leaves.pop();
        const entry = lists[i].find(item => live.has(item.edge));
        if (degree[i] !== 1 || !entry) continue;
        live.delete(entry.edge);
        degree[i] = 0;
        const next = entry.vertex;
        if (--degree[next] === 1 && !fixed.has(next)) leaves.push(next);
      }
      const output = [...live].sort(edgeOrder);
      return result('ok', {
        nodes: Object.freeze(nodes.map((_, i) => i).filter(i => degree[i] > 0)),
        edges: Object.freeze(output.map(edge => Object.freeze({
          ...edge, route: P.routes.polyline([nodes[edge.a], nodes[edge.b]])
        }))),
        cost: output.reduce((sum, e) => sum + e.cost, 0)
      });
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  Object.assign(P.routes, { network, steiner });
})(KIT);
