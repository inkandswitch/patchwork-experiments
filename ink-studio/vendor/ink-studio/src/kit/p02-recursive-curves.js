/* Directed subdivision and stable addresses for the shared curve paths. */
const RecursiveCurves = (() => {
  const K = KIT, C = K.curve, V = K.V, { freeze, clone } = K.procedural.data,
    types = {
      koch: { branch: 4, max: 6, initial: 3 },
      dragon: { branch: 2, max: 12, initial: 8 },
      hilbert: { branch: 4, max: 6, initial: 4, side: 2 },
      peano: { branch: 9, max: 3, initial: 3, side: 3 }
    },
    families = Object.freeze(Object.keys(types)),
    controls = ['type', 'generation', 'axis', 'right', 'origin', 'scale'],
    range = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

  function hilbert(index, side) {
    let x = 0, y = 0;
    for (let span = 1; span < side; span *= 2) {
      const right = (index >> 1) & 1, up = (index ^ right) & 1;
      if (!up) {
        if (right) { x = span - 1 - x; y = span - 1 - y; }
        [x, y] = [y, x];
      }
      x += right * span;
      y += up * span;
      index >>= 2;
    }
    return [x, y];
  }

  function peano(index, side) {
    if (side === 1) return [0, 0];
    const span = side / 3, block = span * span, tile = Math.floor(index / block),
      column = Math.floor(tile / 3), step = tile % 3, row = column % 2 ? 2 - step : step;
    const [x, y] = peano(index % block, span);
    return [column * span + (step % 2 ? span - 1 - x : x),
      row * span + (column % 2 ? span - 1 - y : y)];
  }

  const addressId = (type, address) => address ? type + '/' + [...address].join('/') : type;
  function lattice(type, recipe, generation) {
    const side = recipe.side ** generation, count = side * side, locate = type === 'hilbert' ? hilbert : peano;
    const points = [], segments = [], cells = [];
    let previous = '';
    for (let index = 0; index < count; index++) {
      const address = index.toString(recipe.branch).padStart(generation, '0'),
        grid = locate(index, side), id = addressId(type, address);
      points.push([grid[0] / (side - 1) - .5, grid[1] / (side - 1) - .5, 0]);
      cells.push({ id, parentId: addressId(type, address.slice(0, -1)), generation, index, grid });
      if (index) {
        let shared = 0;
        while (previous[shared] === address[shared]) shared++;
        const owner = addressId(type, address.slice(0, shared));
        segments.push({ id: owner + '/bridge-' + previous[shared], parentId: owner,
          generation: shared + 1, from: index - 1, to: index });
      }
      previous = address;
    }
    return { points, segments, cells };
  }

  function subdivision(type, generation) {
    const a = [-.5, type === 'koch' || type === 'dragon' ? 0 : -.5, 0],
      b = [.5, type === 'peano' ? .5 : a[1], 0], points = [a], segments = [];
    function visit(from, to, left, id, parentId, handedness) {
      if (!left) {
        segments.push({ id, parentId, generation, from: points.length - 1, to: points.length });
        points.push(to);
        return;
      }
      const dx = to[0] - from[0], dy = to[1] - from[1], dragon = type === 'dragon',
        bend = dragon ? .5 * handedness : Math.sqrt(3) / 6,
        peak = [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend, 0],
        row = dragon ? [from, peak, to] : [from, V.lerp(from, to, 1 / 3), peak, V.lerp(from, to, 2 / 3), to];
      for (let i = 0; i < row.length - 1; i++) visit(row[i], row[i + 1], left - 1, id + '/' + i, id, i % 2 ? -1 : 1);
    }
    visit(a, b, generation, type, null, 1);
    return { points, segments, cells: [] };
  }

  function compile(definition, frame) {
    const { type } = definition;
    if (!families.includes(type) || Object.keys(definition).some(key => !controls.includes(key)))
      throw new RangeError('Recursive curves need a supported type and frame settings');
    const recipe = types[type], initial = definition.generation ?? recipe.initial,
      maxGeneration = recipe.max, transform = frame(definition), levels = new Map(), anchors = new Map();
    const requireLevel = generation => {
      if (!range(generation, 0, maxGeneration)) throw new RangeError('Recursive generation must be 0–' + maxGeneration + ' for ' + type);
    };
    requireLevel(initial);

    function level(generation = initial) {
      requireLevel(generation);
      if (levels.has(generation)) return levels.get(generation);
      const spec = recipe.side && generation ? lattice(type, recipe, generation) : subdivision(type, generation),
        rail = C.path(spec.points.map(transform), { closed: false }), count = spec.segments.length;
      if (rail.points.length !== count + 1) throw new RangeError('Recursive curve vertices collapse in this world frame');
      const parameters = Array.from({ length: count + 1 }, (_, i) => i / count);
      const api = freeze({ ...rail, type, generation, segments: spec.segments, cells: spec.cells,
        parameters, breaks: parameters, properties: {},
        sampling: { mode: 'recursive', segments: count, limited: false },
        closest(point) {
          return C.closest(api, point);
        },
        evaluate(u) {
          if (!Number.isFinite(u)) throw new RangeError('Recursive curve parameter must be finite');
          const t = K.clamp(u, 0, 1) * count, i = Math.floor(t);
          return i === count ? rail.points[i].slice() : V.lerp(rail.points[i], rail.points[i + 1], t - i);
        },
        snapshot: () => clone({ ...definition, generation })
      });
      levels.set(generation, api);
      return api;
    }

    function morph(from, progress) {
      requireLevel(from);
      requireLevel(from + 1);
      if (!Number.isFinite(progress) || progress < 0 || progress > 1)
        throw new RangeError('Recursive morph progress must be in [0, 1]');
      const coarse = level(from), fine = level(from + 1);
      if (!anchors.has(from)) {
        const prior = fine.points.map((_, i) => {
          if (recipe.side) return from ? coarse.points[Math.floor(i / recipe.branch)] :
            V.lerp(coarse.points[0], coarse.points[1], i / fine.segments.length);
          const parent = Math.floor(i / recipe.branch), fraction = (i % recipe.branch) / recipe.branch;
          return fraction ? V.lerp(coarse.points[parent], coarse.points[parent + 1], fraction) : coarse.points[parent];
        });
        prior[0] = coarse.points[0];
        prior[prior.length - 1] = coarse.points.at(-1);
        anchors.set(from, freeze(prior));
      }
      const start = anchors.get(from),
        points = progress === 0 ? start : progress === 1 ? fine.points : start.map((p, i) => V.lerp(p, fine.points[i], progress));
      return freeze({ type, from, to: from + 1, progress, points, segments: fine.segments, cells: fine.cells });
    }

    return Object.freeze({ type, maxGeneration, level, morph });
  }

  return Object.freeze({ families, compile });
})();
