/* Mirror or rotate authored part grammars with stable per-copy keys. */
(function (K) {
  const P = K.procedural, V = K.V, M = K.M, T = P.transforms,
    indices = { x: 0, y: 1, z: 2 }, TAU = 2 * Math.PI,
    basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    vector = p => Array.isArray(p) && p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);

  function symmetry(scope, rules, {
    mode = 'mirror', axis = mode === 'mirror' ? 'x' : 'y', count = mode === 'mirror' ? 2 : 3,
    origin = [0, 0, 0], copies = [], seed = 0, maxParts = 12000, ...options
  } = {}) {
    if (!['mirror', 'radial'].includes(mode) || !Object.hasOwn(indices, axis) ||
      !Number.isSafeInteger(count) || count < 2 || count > 64 || (mode === 'mirror' && count !== 2) ||
      !vector(origin) || !Number.isSafeInteger(seed) || !Array.isArray(copies) || copies.length > count ||
      !Number.isSafeInteger(maxParts) || maxParts < 1 || maxParts > 40000)
      throw new Error('Symmetric grammar needs a known axis, origin and bounded copies');
    const replacements = new Map();
    for (const item of copies) {
      const { index, symbol, offset = [0, 0, 0], turn = 0, scale = 1, seed } = item ?? {};
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || replacements.has(index) ||
        (symbol !== undefined && (typeof symbol !== 'string' || !symbol || symbol.length > 120)) ||
        !vector(offset) || !Number.isFinite(turn) || !Number.isFinite(scale) || scale <= 0 || scale > 1000 ||
        (seed !== undefined && !Number.isSafeInteger(seed))) throw new Error('Invalid symmetric grammar copy');
      replacements.set(index, { symbol, offset, turn, scale, seed });
    }
    const A = indices[axis], direction = basis[A], parts = [], sockets = [],
      build = (symbol, chosenSeed) => P.grammar.expand({ ...scope, symbol }, rules,
        { ...options, seed: chosenSeed, maxParts });
    let common, work = 0;
    for (let index = 0; index < count; index++) {
      const { symbol, offset = [0, 0, 0], scale = 1, turn = 0, seed: customSeed } = replacements.get(index) ?? {};
      const layout = symbol !== undefined || customSeed !== undefined
        ? build(symbol ?? scope.symbol, customSeed ?? seed)
        : common ?? (common = build(scope.symbol, seed));
      if (parts.length + sockets.length + layout.parts.length + layout.sockets.length > maxParts)
        throw new Error('Symmetric grammar exceeds its part budget');
      const mirror = mode === 'mirror' && index === 1,
        R = M.rot(direction, turn + (mode === 'radial' ? TAU * index / count : 0)),
        flip = basis.map((_, i) => i === A && mirror ? -scale : scale),
        matrix = M.mul(R, [flip[0], 0, 0, 0, flip[1], 0, 0, 0, flip[2]]),
        pose = { R: matrix, t: V.add(V.sub(origin, M.app(matrix, origin)), offset) },
        axes = basis.map(n => V.norm(M.app(matrix, n))),
        key = record => {
          const path = [record.path[0], 'copy:' + index, ...record.path.slice(1)];
          return { path, key: JSON.stringify(path), copy: index };
        };
      for (const part of layout.parts) parts.push({ ...part, ...key(part),
        center: T.point(pose, part.center), half: part.half.map(v => v * scale), axes,
        bounds: T.bounds(pose, part.bounds), handedness: mirror ? -1 : 1
      });
      for (const socket of layout.sockets) sockets.push({ ...socket, ...key(socket),
        point: T.point(pose, socket.point), normal: V.norm(M.app(matrix, socket.normal))
      });
      work += layout.work.steps;
    }
    return P.data.freeze({ parts, sockets, work: { steps: work } });
  }

  P.grammar.symmetry = symmetry;
})(KIT);
