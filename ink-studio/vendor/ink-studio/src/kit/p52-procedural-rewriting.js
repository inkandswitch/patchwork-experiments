/* Seeded probabilistic rewrites of scalar grids and labeled graphs. */
(function (K) {
  const P = K.procedural,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    scalar = v => v === null || typeof v === 'boolean' || typeof v === 'string' && v.length <= 1000 || Number.isFinite(v),
    name = v => typeof v === 'string' && v.length > 0 && v.length <= 180,
    validWeight = v => Number.isFinite(v) && v > 0 && v <= 1e6;
  function choose(rules, parameters, visit, apply, state) {
    const { seed = 0, steps = 48, maxChecks = 2500000 } = parameters;
    if (!Array.isArray(rules) || !integer(rules.length, 1, 128) ||
      !Number.isSafeInteger(seed) || !integer(steps, 0, 10000) || !integer(maxChecks, 1, 30000000))
      throw new Error('Rewriting needs a rule list, integer seed and work limits');
    const dice = K.grow.dice(P.data.hash('procedural-rewrite', seed)),
      exhausted = Symbol('rewrite work'),
      work = { checks: 0, steps: 0 },
      history = [];
    function check(n = 1) {
      if (work.checks + n > maxChecks) throw exhausted;
      work.checks += n;
    }
    let status = 'limit';
    try {
      for (; work.steps < steps; work.steps++) {
        let sum = 0, selected = null;
        function offer(data, weight) {
          sum += weight;
          if (dice() * sum < weight) selected = data;
        }
        for (const rule of rules) visit(rule, offer, check);
        if (!selected) {
          status = 'complete';
          break;
        }
        history.push(apply(selected, work.steps, check));
      }
    } catch (error) {
      if (error !== exhausted) throw error;
      status = 'budget';
    }
    return P.data.freeze({ status, ...state(), history, work });
  }

  function cells(raw, minimum = 1, maximum = 512) {
    if (!Array.isArray(raw) || !integer(raw.length, minimum, maximum))
      throw new Error('Rewrite rules need rectangular scalar rows');
    const rows = raw.map(row => typeof row === 'string' ? [...row] : Array.isArray(row) ? row.slice() : null),
      width = rows[0]?.length;
    if (!integer(width, minimum, maximum) || rows.some(row => !row || row.length !== width || !row.every(scalar)))
      throw new Error('Rewrite rules need equally sized scalar rows');
    return rows;
  }
  function rewriteGrid(input, rawRules, { wildcard = '*', keep = '=', pinned = [], wrap = false, ...options } = {}) {
    const rows = cells(input),
      height = rows.length, width = rows[0].length;
    if (!scalar(wildcard) || !scalar(keep) || wildcard === keep || typeof wrap !== 'boolean' ||
      !Array.isArray(pinned) || pinned.length > width * height || !Array.isArray(rawRules) || !integer(rawRules.length, 1, 128))
      throw new Error('Grid rewriting needs distinct tokens, pinned coordinates and bounded rules');
    const locked = new Set(),
      rules = rawRules.map(rule => {
        const id = rule?.id, weight = rule?.weight ?? 1,
          find = cells(rule?.find, 1, 32), replace = cells(rule?.replace, 1, 32);
        if (!name(id) || !validWeight(weight) || find.length !== replace.length || find[0].length !== replace[0].length ||
          find.length > height || find[0].length > width)
          throw new Error('Grid rewrite replacements must fit the matching pattern and the grid');
        return { id, weight, find, replace };
      });
    if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('Rewrite rule IDs must be unique');
    for (const point of pinned) {
      if (!Array.isArray(point) || point.length !== 2 || !integer(point[0], 0, width - 1) || !integer(point[1], 0, height - 1))
        throw new Error('Grid rewrite pins need in-range XZ indices');
      locked.add(point[1] * width + point[0]);
    }
    function visit(rule, offer, check) {
      const h = rule.find.length, w = rule.find[0].length;
      for (let z = 0; z < (wrap ? height : height - h + 1); z++) {
        for (let x = 0; x < (wrap ? width : width - w + 1); x++) {
          let matches = true, changing = false;
          for (let j = 0; j < h && matches; j++) for (let i = 0; i < w && matches; i++) {
            check();
            const u = (x + i) % width, v = (z + j) % height,
              old = rows[v][u], next = rule.replace[j][i], target = rule.find[j][i],
              changes = next !== keep && next !== old;
            if ((target !== wildcard && target !== old) || (changes && locked.has(v * width + u))) matches = false;
            if (changes) changing = true;
          }
          if (matches && changing) offer({ rule, x, z }, rule.weight);
        }
      }
    }
    function apply({ rule, x, z }) {
      for (const [j, row] of rule.replace.entries()) for (const [i, value] of row.entries()) {
        if (value !== keep) rows[(z + j) % height][(x + i) % width] = value;
      }
      return { rule: rule.id, x, z };
    }
    return choose(rules, options, visit, apply, () => ({ width, height, rows }));
  }

  function rewriteGraph(input, rawRules, { maxNodes = 12000, maxEdges = 60000, ...options } = {}) {
    if (!integer(maxNodes, 1, 20000) || !integer(maxEdges, 1, 100000) ||
      !Array.isArray(input?.nodes) || input.nodes.length > maxNodes || !Array.isArray(input.edges) ||
      input.edges.length > maxEdges || !Array.isArray(rawRules) || !integer(rawRules.length, 1, 128))
      throw new Error('Graph rewriting needs bounded labeled nodes, edges and rules');
    const nodes = new Map(),
      edges = new Map(),
      edgeKey = ({ from, to, type }) => JSON.stringify([from, to, type]),
      index = new Map();
    function placeEdge(raw) {
      const { from, to, type } = raw;
      const entry = { from, to, type, data: P.data.clone(raw.data ?? {}) };
      const key = edgeKey(entry);
      if (!edges.has(key) && edges.size >= maxEdges) throw new Error('Graph rewrite exceeds its edge budget');
      edges.set(key, entry);
    }
    function reindex() {
      index.clear();
      for (const edge of edges.values()) {
        if (!index.has(edge.from)) index.set(edge.from, new Map());
        const peers = index.get(edge.from);
        if (!peers.has(edge.to)) peers.set(edge.to, []);
        peers.get(edge.to).push(edge);
      }
    }
    for (const entry of input.nodes) {
      if (!name(entry?.id) || !name(entry.type) || nodes.has(entry.id)) throw new Error('Graph rewrite nodes need unique IDs and types');
      nodes.set(entry.id, { id: entry.id, type: entry.type, data: P.data.clone(entry.data ?? {}) });
    }
    for (const edge of input.edges) {
      if (!nodes.has(edge?.from) || !nodes.has(edge?.to) || !name(edge.type) || edges.has(edgeKey(edge)))
        throw new Error('Graph rewrite edges need distinct valid definitions');
      placeEdge(edge);
    }
    reindex();
    function pattern(part, replacing) {
      if (!Array.isArray(part?.nodes) || !integer(part.nodes.length, replacing ? 0 : 1, 16) ||
        !Array.isArray(part.edges) || part.edges.length > 128)
        throw new Error('Graph rewrite patterns need bounded nodes and edges');
      const keys = new Set();
      for (const vertex of part.nodes) {
        if (!name(vertex?.key) || keys.has(vertex.key) || (vertex.type !== undefined && !name(vertex.type)) ||
          (!replacing && vertex.data !== undefined)) throw new Error('Invalid graph rule vertex');
        keys.add(vertex.key);
      }
      for (const edge of part.edges) {
        if (!keys.has(edge?.from) || !keys.has(edge?.to) || ((replacing || edge.type !== undefined) && !name(edge.type)))
          throw new Error('Invalid graph rule edge');
      }
      return { ...part, keys };
    }
    const rules = rawRules.map(spec => {
      if (!name(spec?.id) || !validWeight(spec.weight ?? 1)) throw new Error('Graph rewrite rules need IDs and positive weights');
      const find = pattern(spec.find,false), replace = pattern(spec.replace,true);
      for (const vertex of replace.nodes) {
        if (!find.keys.has(vertex.key) && !name(vertex.type)) throw new Error('New graph nodes need types');
      }
      return { id: spec.id, weight: spec.weight ?? 1, find, replace };
    });
    if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('Rewrite rule IDs must be unique');
    function visit(rule, offer, check) {
      const assigned = new Map(), used = new Set();
      function search(depth) {
        if (depth === rule.find.nodes.length) {
          offer({ rule, match: new Map(assigned) }, rule.weight);
          return;
        }
        const { key, type } = rule.find.nodes[depth];
        for (const node of nodes.values()) {
          check();
          if (used.has(node.id) || (type !== undefined && type !== node.type)) continue;
          assigned.set(key, node.id);
          let fits = true;
          for (const edge of rule.find.edges) {
            if (edge.from !== key && edge.to !== key) continue;
            const from = assigned.get(edge.from), to = assigned.get(edge.to);
            if (!from || !to) continue;
            check();
            const options = index.get(from)?.get(to);
            if (!options?.some(e => {
              check();
              return edge.type === undefined || e.type === edge.type;
            })) {
              fits = false;
              break;
            }
          }
          if (fits) {
            used.add(node.id);
            search(depth + 1);
            used.delete(node.id);
          }
          assigned.delete(key);
        }
      }
      search(0);
    }
    function apply({ rule, match }, step, check) {
      check(edges.size * 2 + rule.replace.nodes.length + rule.replace.edges.length + rule.find.edges.length);
      const kept = new Map(), removing = new Set([...match].filter(([key]) => !rule.replace.keys.has(key)).map(([, id]) => id));
      const newNodes = rule.replace.nodes.filter(node => !match.has(node.key));
      if (nodes.size - removing.size + newNodes.length > maxNodes) throw new Error('Graph rewrite exceeds its node budget');
      for (const edge of rule.find.edges) {
        const from = match.get(edge.from), to = match.get(edge.to);
        for (const e of index.get(from)?.get(to) ?? []) {
          if (edge.type === undefined || e.type === edge.type) edges.delete(edgeKey(e));
        }
      }
      for (const e of edges.values()) if (removing.has(e.from) || removing.has(e.to)) edges.delete(edgeKey(e));
      for (const id of removing) nodes.delete(id);
      for (const entry of rule.replace.nodes) {
        const prior = nodes.get(match.get(entry.key));
        let id = prior?.id;
        if (!id) {
          const base = 'generated:' + step + ':' + P.data.hash(JSON.stringify([rule.id, entry.key])).toString(16);
          id = base;
          for (let suffix = 1; nodes.has(id); suffix++) id = base + ':' + suffix;
        }
        nodes.set(id, { id, type: entry.type ?? prior.type, data: P.data.clone(entry.data ?? prior?.data ?? {}) });
        kept.set(entry.key, id);
      }
      for (const e of rule.replace.edges) placeEdge({ ...e, from: kept.get(e.from), to: kept.get(e.to) });
      reindex();
      return { rule: rule.id, matched: [...match.values()], remaining: [...kept.values()] };
    }
    return choose(rules, options, visit, apply, () => ({ nodes: [...nodes.values()], edges: [...edges.values()] }));
  }

  Object.assign(P.grammar, { rewriteGrid, rewriteGraph });
})(KIT);
