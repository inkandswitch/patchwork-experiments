/* Renderer-independent, editable affine hierarchy. Every attachment uses the same frame. */
(function (K) {
  const { V, M, Q } = K,
    { freeze, clone } = K.procedural.data;
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Scene hierarchy: ' + message);
  };
  const record = o =>
    o && typeof o === 'object' && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o));
  const fields = (o, allowed) => record(o) && Object.keys(o).every(k => allowed.includes(k));
  const name = s =>
    typeof s === 'string' &&
    /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(s) &&
    !['__proto__', 'prototype', 'constructor'].includes(s);
  const vector = (v, n) =>
    v &&
    v.length === n &&
    (Array.isArray(v) || ArrayBuffer.isView(v)) &&
    Array.from(v).every(x => Number.isFinite(x) && Math.abs(x) <= 1e8);
  function transform(raw = {}) {
    check(fields(raw, ['position', 'rotation', 'scale', 'matrix']), 'unknown transform field');
    const position = raw.position ?? [0, 0, 0];
    check(vector(position, 3), 'invalid position');
    let matrix;
    if (raw.matrix !== undefined) {
      check(
        raw.rotation === undefined && raw.scale === undefined && vector(raw.matrix, 9),
        'matrix replaces rotation and scale'
      );
      matrix = Array.from(raw.matrix);
    } else {
      const rotation = raw.rotation ?? Q.id(),
        scale = raw.scale ?? 1,
        s = typeof scale === 'number' ? [scale, scale, scale] : scale;
      check(
        vector(s, 3) && Array.from(s).every(v => Math.abs(v) >= 1e-6 && Math.abs(v) <= 1e6),
        'scale must be finite and nonzero'
      );
      matrix = Q.toMatrix(rotation).map((v, i) => v * s[i % 3]);
    }
    const size = Math.max(...matrix.map(Math.abs)),
      normalized = matrix.map(v => v / size);
    check(size > 0 && Math.abs(M.det(normalized)) > 1e-12, 'transform is singular or ill-conditioned');
    return freeze({ position: Array.from(position), matrix });
  }
  const identity = () => ({ position: [0, 0, 0], matrix: M.id() });
  const point = (frame, p) => V.add(M.app(frame.matrix, p), frame.position);
  function compose(a, b) {
    return transform({ position: point(a, b.position), matrix: M.mul(a.matrix, b.matrix) });
  }
  function inverse(frame) {
    const determinant = M.det(frame.matrix);
    check(Number.isFinite(determinant) && determinant !== 0, 'frame cannot be inverted at numeric precision');
    const matrix = M.inv(frame.matrix),
      position = V.mul(M.app(matrix, frame.position), -1);
    check([...matrix, ...position].every(Number.isFinite), 'inverse exceeds numeric precision');
    return freeze({ matrix, position });
  }
  function reference(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') {
      check(name(raw), 'invalid node ID');
      return { node: raw };
    }
    check(
      fields(raw, ['node', 'socket']) && name(raw.node) && (raw.socket === undefined || name(raw.socket)),
      'invalid node/socket reference'
    );
    return { ...raw };
  }
  const same = (a, b) =>
    a.visible === b.visible &&
    a.position.every((v, i) => v === b.position[i]) &&
    a.matrix.every((v, i) => v === b.matrix[i]);
  function create(definition = { nodes: {} }) {
    check(
      fields(definition, ['nodes']) && record(definition.nodes) && Object.keys(definition.nodes).length <= 4096,
      'expected at most 4096 nodes'
    );
    const nodes = new Map(),
      worlds = new Map(),
      dirty = new Set();
    let childrenIndex = new Map();
    const reindex = () => {
      childrenIndex = new Map();
      for (const [id, row] of nodes) {
        const key = row.parent?.node ?? null;
        if (!childrenIndex.has(key)) childrenIndex.set(key, []);
        childrenIndex.get(key).push(id);
      }
    };
    let revision = 0,
      worldVersion = 0,
      order = [];
    function parse(id, row) {
      check(
        name(id) && fields(row, ['parent', 'transform', 'visible', 'sockets', 'kind', 'label']),
        'invalid node ' + id
      );
      const { visible = true, sockets = {}, kind = 'group', label = id } = row;
      check(
        typeof visible === 'boolean' &&
          record(sockets) &&
          Object.keys(sockets).length <= 128 &&
          name(kind) &&
          typeof label === 'string' &&
          label.length <= 256,
        'invalid node settings ' + id
      );
      return {
        parent: reference(row.parent),
        local: transform(row.transform),
        visible,
        kind,
        label,
        sockets: new Map(
          Object.entries(sockets).map(([key, value]) => {
            check(name(key), 'invalid socket ID');
            return [key, transform(value)];
          })
        )
      };
    }
    for (const [id, row] of Object.entries(definition.nodes)) nodes.set(id, parse(id, row));
    function topology(candidate = nodes) {
      const result = [],
        states = new Map(),
        depths = new Map();
      function visit(id, depth) {
        check(depth <= 128, 'maximum parent depth is 128');
        const state = states.get(id);
        check(state !== 1, 'parent cycle at ' + id);
        if (state === 2) return;
        states.set(id, 1);
        const parent = candidate.get(id).parent;
        if (parent) {
          check(candidate.has(parent.node), 'missing parent ' + parent.node);
          check(
            parent.socket === undefined || candidate.get(parent.node).sockets.has(parent.socket),
            'missing parent socket ' + parent.socket
          );
          visit(parent.node, depth + 1);
        }
        const actualDepth = candidate.get(id).parent ? depths.get(candidate.get(id).parent.node) + 1 : 0;
        check(actualDepth <= 128, 'maximum parent depth is 128');
        depths.set(id, actualDepth);
        states.set(id, 2);
        result.push(id);
      }
      for (const id of candidate.keys()) visit(id, 0);
      return result;
    }
    order = topology();
    reindex();
    for (const id of nodes.keys()) dirty.add(id);
    const requireNode = id => {
      check(nodes.has(id), 'unknown node ' + id);
      return nodes.get(id);
    };
    function invalidate(id) {
      const queue = [id];
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        dirty.add(current);
        queue.push(...(childrenIndex.get(current) ?? []));
      }
      revision++;
    }
    function update() {
      const changed = [];
      for (const id of order) {
        if (!dirty.has(id)) continue;
        const row = nodes.get(id);
        let base = identity(),
          visible = row.visible;
        if (row.parent) {
          const p = worlds.get(row.parent.node);
          base = p;
          if (row.parent.socket) base = compose(p, nodes.get(row.parent.node).sockets.get(row.parent.socket));
          visible = visible && p.visible;
        }
        const next = { ...compose(base, row.local), visible };
        if (!worlds.has(id) || !same(worlds.get(id), next)) {
          worlds.set(id, freeze({ ...next, version: ++worldVersion }));
          changed.push(id);
        }
        dirty.delete(id);
      }
      return { revision, changed };
    }
    function frame(raw) {
      const ref = reference(raw);
      check(ref, 'a node reference is required');
      const row = requireNode(ref.node);
      update();
      const world = worlds.get(ref.node);
      if (!ref.socket) return world;
      check(row.sockets.has(ref.socket), 'unknown socket ' + ref.socket);
      return freeze({ ...compose(world, row.sockets.get(ref.socket)), visible: world.visible, version: world.version });
    }
    function setLocal(id, raw) {
      const row = requireNode(id),
        next = transform(raw);
      if (
        row.local.position.every((v, i) => v === next.position[i]) &&
        row.local.matrix.every((v, i) => v === next.matrix[i])
      )
        return api;
      row.local = next;
      invalidate(id);
      return api;
    }
    function snapshot() {
      return {
        nodes: Object.fromEntries(
          [...nodes].map(([id, row]) => [
            id,
            {
              parent: row.parent ? { ...row.parent } : null,
              transform: { position: row.local.position.slice(), matrix: row.local.matrix.slice() },
              visible: row.visible,
              kind: row.kind,
              label: row.label,
              sockets: Object.fromEntries(
                [...row.sockets].map(([key, value]) => [
                  key,
                  { position: value.position.slice(), matrix: value.matrix.slice() }
                ])
              )
            }
          ])
        )
      };
    }
    const baseline = snapshot();
    const api = {
      get revision() {
        return revision;
      },
      get size() {
        return nodes.size;
      },
      update,
      frame,
      world: frame,
      has: id => nodes.has(id),
      ids: () => Array.from(nodes.keys()),
      local(id) {
        const f = requireNode(id).local;
        return freeze({ position: f.position.slice(), matrix: f.matrix.slice() });
      },
      node(id) {
        const row = requireNode(id);
        return freeze({
          id,
          parent: row.parent ? { ...row.parent } : null,
          kind: row.kind,
          label: row.label,
          visible: row.visible,
          transform: api.local(id),
          sockets: Array.from(row.sockets.keys())
        });
      },
      children(id = null) {
        if (id !== null) requireNode(id);
        return [...(childrenIndex.get(id) ?? [])];
      },
      setLocal,
      setWorld(id, raw) {
        const row = requireNode(id),
          world = transform(raw),
          base = row.parent ? frame(row.parent) : identity();
        return setLocal(id, compose(inverse(base), world));
      },
      setVisible(id, visible) {
        const row = requireNode(id);
        check(typeof visible === 'boolean', 'visibility must be boolean');
        if (row.visible !== visible) {
          row.visible = visible;
          invalidate(id);
        }
        return api;
      },
      reparent(id, parent, { keepWorld = true } = {}) {
        const row = requireNode(id),
          next = reference(parent);
        check(typeof keepWorld === 'boolean', 'keepWorld must be boolean');
        const candidate = new Map(nodes);
        candidate.set(id, { ...row, parent: next });
        const nextOrder = topology(candidate),
          world = keepWorld ? frame(id) : null,
          local = keepWorld ? compose(inverse(next ? frame(next) : identity()), world) : row.local;
        row.parent = next;
        row.local = local;
        order = nextOrder;
        reindex();
        invalidate(id);
        return api;
      },
      setSocket(id, key, raw) {
        const row = requireNode(id);
        check(
          (name(key) && row.sockets.size < 128) || row.sockets.has(key),
          'invalid socket or socket budget exceeded'
        );
        const next = transform(raw);
        row.sockets.set(key, next);
        worlds.delete(id);
        invalidate(id);
        return api;
      },
      removeSocket(id, key) {
        const row = requireNode(id);
        check(row.sockets.has(key), 'unknown socket ' + key);
        check(
          ![...nodes.values()].some(n => n.parent?.node === id && n.parent.socket === key),
          'socket still has children'
        );
        row.sockets.delete(key);
        worlds.delete(id);
        invalidate(id);
        return api;
      },
      add(id, row = {}) {
        check(!nodes.has(id) && nodes.size < 4096, 'duplicate node or node budget exceeded');
        const parsed = parse(id, row),
          candidate = new Map(nodes);
        candidate.set(id, parsed);
        const nextOrder = topology(candidate);
        nodes.set(id, parsed);
        order = nextOrder;
        reindex();
        invalidate(id);
        return api;
      },
      remove(id, { subtree = false } = {}) {
        requireNode(id);
        check(typeof subtree === 'boolean', 'subtree must be boolean');
        const remove = new Set([id]);
        for (const key of order) if (remove.has(nodes.get(key).parent?.node)) remove.add(key);
        check(subtree || remove.size === 1, 'node still has children');
        for (const key of remove) {
          nodes.delete(key);
          worlds.delete(key);
          dirty.delete(key);
        }
        order = topology();
        reindex();
        revision++;
        return api;
      },
      toWorld(raw, p) {
        check(vector(p, 3), 'invalid point');
        return point(frame(raw), p);
      },
      toLocal(raw, p) {
        check(vector(p, 3), 'invalid point');
        return point(inverse(frame(raw)), p);
      },
      direction(raw, v) {
        check(vector(v, 3), 'invalid direction');
        return M.app(frame(raw).matrix, v);
      },
      normal(raw, v) {
        check(vector(v, 3) && V.len(v) > 0, 'invalid normal');
        const n = M.app(M.tr(inverse(frame(raw)).matrix), v),
          l = V.len(n);
        check(Number.isFinite(l) && l > 0, 'normal exceeds numeric precision');
        return V.mul(n, 1 / l);
      },
      snapshot,
      reset() {
        const restored = create(baseline);
        nodes.clear();
        for (const [id, row] of Object.entries(restored.snapshot().nodes)) nodes.set(id, parse(id, row));
        worlds.clear();
        order = topology();
        reindex();
        dirty.clear();
        for (const id of nodes.keys()) dirty.add(id);
        revision++;
        return api;
      }
    };
    return Object.freeze(api);
  }
  K.sceneGraph = { create, transform, compose, inverse, point, reference };
})(KIT);
