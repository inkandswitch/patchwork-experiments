/* Water frames shared by world queries and renderers. */
(function (K) {
  const P = K.procedural;
  const maxAxis = 64, uniformBodies = 8, maxBodies = 256, atlasSize = 2048;
  const states = new WeakMap(), sceneStates = new WeakMap(), tileScenes = new WeakMap();
  const number = value => Number.isFinite(value) && Number.isFinite(Math.fround(value));
  const pair = value => Array.isArray(value) && value.length === 2 && number(value[0]) && number(value[1]);
  const unit = value => number(value) && value >= 0 && value <= 1;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  function optics({
    optical, reflection, tint = [0.05, 0.25, 0.31], extinction = [0.8, 0.32, 0.18],
    surfaceColor = [0.46, 0.75, 0.79], surface = 0.22,
    refraction = 1.5, foam = 0.45, caustics = 0.26,
    deepTint, depthRange = [0.25, 3],
    sediment: { color = [0.71, 0.62, 0.39], strength = 0, height = 0.3, scale = 10 } = {}
  } = {}) {
    const rgb = values => Array.isArray(values) && values.length === 3 && Array.from(values).every(unit);
    if (!rgb(tint) || !rgb(surfaceColor) || !Array.isArray(extinction) || extinction.length !== 3 ||
        !Array.from(extinction).every(v => number(v) && v >= 0 && v <= 32) ||
        ![surface, foam, caustics, strength].every(unit) || !number(refraction) || refraction < 0 || refraction > 4 ||
        (deepTint !== undefined && !rgb(deepTint)) || !pair(depthRange) || depthRange[0] < 0 ||
        !(Math.fround(depthRange[1]) > Math.fround(depthRange[0])) || !rgb(color) ||
        !number(height) || height < 1e-4 || !number(scale) || scale <= 0 || scale > 64)
      throw new RangeError('Invalid water optics');
    if (reflection !== undefined && (!name(reflection?.plane) ||
        !number(reflection.distortion ?? 5) || (reflection.distortion ?? 5) < 0 || (reflection.distortion ?? 5) > 64 ||
        !number(reflection.blur ?? 0) || (reflection.blur ?? 0) < 0 || (reflection.blur ?? 0) > 16))
      throw new RangeError('Water reflection needs a plane ID, distortion in [0,64] and blur in [0,16]');
    const binding = reflection && { plane: reflection.plane, distortion: reflection.distortion ?? 5, blur: reflection.blur ?? 0 };
    const profile = optical === undefined ? undefined : OpticalMaterials.material(optical);
    if (profile) {
      const medium = OpticalMaterials.medium(profile, tint);
      tint = medium.tint;
      extinction = [medium.extinction, medium.extinction, medium.extinction];
      surface = profile.reflection;
      surfaceColor = profile.reflectionColor;
      if (deepTint) deepTint = deepTint.map(value => value * medium.scatter);
    }
    return P.data.freeze({ ...(profile && { optical: profile }), ...(binding && { reflection: binding }), tint: tint.slice(), extinction: extinction.slice(), surfaceColor: surfaceColor.slice(),
      surface, refraction, foam, caustics, deepTint: deepTint?.slice() ?? tint.slice(), depthRange: depthRange.slice(),
      sediment: { color: color.slice(), strength, height, scale }, styled: deepTint !== undefined || strength > 0 });
  }

  // A negative weight identifies the shared Fresnel model in either GPU layout.
  const surfaceWeight = style => style.optical ? -1 - style.surface : style.surface;

  function create({ id, bounds, resolution = [1, 1], sample, optics: look } = {}) {
    if (!name(id) || !pair(bounds?.min) || !pair(bounds?.max) || !Array.isArray(resolution) ||
        resolution.length !== 2 || !Array.from(resolution).every(n => Number.isInteger(n) && n >= 1 && n <= maxAxis) ||
        typeof sample !== 'function')
      throw new TypeError('Water needs an ID, finite XZ bounds, a column sampler and a grid up to 64 × 64');
    const min = bounds.min.map(Math.fround), max = bounds.max.map(Math.fround);
    const [nx, nz] = resolution;
    const width = max[0] - min[0], length = max[1] - min[1];
    const dx = Math.fround(width / nx), dz = Math.fround(length / nz);
    if (!number(width) || !number(length) || !(dx > 0) || !(dz > 0))
      throw new RangeError('Water bounds need a positive extent representable on the GPU');
    const style = optics(look), data = new Float32Array(nx * nz * 4), wet = [];
    let low = Infinity, high = -Infinity;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const result = sample(min[0] + (x + 0.5) * dx, min[1] + (z + 0.5) * dz);
      if (result == null) continue;
      const { bed, surface, current = [0, 0] } = result;
      if (!number(bed) || !number(surface) || !pair(current) || !number(surface - bed))
        throw new RangeError('Water columns need finite bed, surface and XZ current');
      const bottom = Math.fround(bed), top = Math.fround(surface);
      if (top <= bottom) continue;
      const i = z * nx + x;
      data.set([bottom, top, ...current], i * 4);
      wet.push(i);
      low = Math.min(low, bottom);
      high = Math.max(high, top);
    }
    const extent = P.data.freeze({
      min: [min[0], wet.length ? low : 0, min[1]], max: [max[0], wet.length ? high : 0, max[1]]
    });
    function offsetAt(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || x < min[0] || x >= max[0] || z < min[1] || z >= max[1]) return -1;
      return (Math.min(nz - 1, Math.floor((z - min[1]) / dz)) * nx +
        Math.min(nx - 1, Math.floor((x - min[0]) / dx))) * 4;
    }
    function columnAt(x, z) {
      const o = offsetAt(x, z);
      return o >= 0 && data[o + 1] > data[o] ? {
        bed: data[o], surface: data[o + 1], depth: data[o + 1] - data[o], current: [data[o + 2], 0, data[o + 3]]
      } : null;
    }
    const medium = Object.freeze({
      id, kind: 'water', bounds: extent,
      surface: (x, z) => data[offsetAt(x, z) + 1],
      sdf(x, y, z) {
        const o = offsetAt(x, z);
        return o >= 0 && data[o + 1] > data[o] ? Math.max(data[o] - y, y - data[o + 1]) : 1;
      },
      current(x, y, z) {
        const o = offsetAt(x, z);
        return [data[o + 2], 0, data[o + 3]];
      }
    });
    function shoreline() {
      const edges = [];
      const edge = (x0, z0, x1, z1, y) => [
        [Math.min(max[0], min[0] + x0 * dx), y, Math.min(max[1], min[1] + z0 * dz)],
        [Math.min(max[0], min[0] + x1 * dx), y, Math.min(max[1], min[1] + z1 * dz)]
      ];
      const hasWater = (x, z) => {
        const o = (z * nx + x) * 4;
        return x >= 0 && x < nx && z >= 0 && z < nz && data[o + 1] > data[o];
      };
      for (const i of wet) {
        const x = i % nx, z = Math.floor(i / nx), y = data[i * 4 + 1];
        if (!hasWater(x - 1, z)) edges.push(edge(x, z + 1, x, z, y));
        if (!hasWater(x + 1, z)) edges.push(edge(x + 1, z, x + 1, z + 1, y));
        if (!hasWater(x, z - 1)) edges.push(edge(x, z, x + 1, z, y));
        if (!hasWater(x, z + 1)) edges.push(edge(x + 1, z + 1, x, z + 1, y));
      }
      return edges;
    }
    // Use the same immutable wet cells for art emission and medium queries.
    function particles({ count = 64, seed = 0 } = {}) {
      if (!Number.isInteger(count) || count < 0 || count > 10000 || !Number.isSafeInteger(seed))
        throw new RangeError('Water particles need a count from 0 to 10000 and an integer seed');
      const dice = K.grow.dice(P.data.hash(id, seed));
      return Array.from({ length: wet.length ? count : 0 }, () => {
        const i = wet[Math.floor(dice() * wet.length)], o = i * 4;
        const x = min[0] + (i % nx + 0.1 + 0.8 * dice()) * dx;
        const z = min[1] + (Math.floor(i / nx) + 0.1 + 0.8 * dice()) * dz;
        const y = data[o] + (data[o + 1] - data[o]) * (0.1 + 0.8 * dice());
        return { position: [x, y, z], current: [data[o + 2], 0, data[o + 3]] };
      });
    }
    const body = Object.freeze({ id, bounds: extent, columnAt, medium, shoreline, particles });
    states.set(body, { nx, nz, dx, dz, data, style, empty: !wet.length });
    return body;
  }

  function fromShallowWater(snapshot, { id, resolution = [snapshot?.width, snapshot?.height], optics } = {}) {
    if (typeof snapshot?.sample !== 'function') throw new TypeError('Expected a shallow-water snapshot');
    return create({
      id, bounds: snapshot.bounds, resolution, optics,
      sample(x, z) {
        const local = snapshot.sample(x, z);
        return local?.depth > 0 ? { bed: local.bed, surface: local.level, current: local.velocity } : null;
      }
    });
  }

  function fromSpans(grid, { id, optics: look } = {}) {
    if (!name(id) || !P.verticalSpans.isGrid(grid) || grid.resolution.some(n => n > maxAxis))
      throw new TypeError('Layered water needs an ID and a span grid up to 64 × 64');
    const [nx, nz] = grid.resolution, [dx, dz] = grid.cell, { min, max } = grid.bounds;
    const data = new Float32Array(nx * nz * 4), spans = [], labels = new Map(), spanProfiles = [], spanMedia = [], caps = [];
    const profileFor = typeof look === 'function' ? look : null, style = optics(profileFor ? undefined : look);
    const profiles = new Map();
    let low = Infinity, high = -Infinity;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const column = grid.column(x, z), start = spans.length / 4;
      let count = 0, lower = 0, upper = 0, bed, top;
      column.forEach((row, i) => {
        if (row.kind === 'solid' || (row.kind === 'air' && row.id === null)) return;
        const key = row.id ?? id;
        if (labels.has(key) && labels.get(key) !== row.kind)
          throw new TypeError('Each span medium ID must refer to one kind');
        labels.set(key, row.kind);
        if (row.kind !== 'water') return;
        if (count === 0 || column[i - 1]?.kind !== 'water') {
          bed = row.min;
          let end = i;
          while (column[end + 1]?.kind === 'water') end++;
          top = column[end].max;
        }
        if (count >= 32) throw new RangeError('Layered water supports up to 32 wet spans per column');
        if (!column[i + 1] || column[i + 1].kind === 'air') {
          if (count < 16) lower |= 1 << count;
          else upper |= 1 << (count - 16);
        }
        count++;
        low = Math.min(low, row.min);
        high = Math.max(high, row.max);
        spans.push(row.min, row.max, row.current[0], row.current[2]);
        spanMedia.push(key);
        caps.push(bed, top);
        if (profileFor) {
          if (!profiles.has(key)) profiles.set(key, optics(profileFor(key, grid)));
          spanProfiles.push(profiles.get(key));
        }
      });
      data.set([start, count, lower, upper], (z * nx + x) * 4);
    }
    const bounds = P.data.freeze({
      min: [min[0], spans.length ? low : min[1], min[2]], max: [max[0], spans.length ? high : min[1], max[2]]
    });
    const media = Object.freeze(Array.from(labels, ([key, kind]) => {
      const medium = { id: key, kind, bounds: grid.bounds, sdf(x, y, z) {
        const row = grid.at(x, y, z);
        return row?.kind === kind && (row.id ?? (kind === 'water' ? id : null)) === key ? -1 : 1;
      } };
      if (kind === 'air') return Object.freeze({ ...medium, priority: 1 });
      return Object.freeze({ ...medium, surfaceAt(x, y, z) {
        let row = grid.at(x, y, z);
        do {
          y = row.max;
          row = grid.at(x, y, z);
        } while (row?.kind === 'water');
        return y;
      },
        current: (x, y, z) => grid.at(x, y, z).current });
    }));
    const body = Object.freeze({ id, bounds, grid, media });
    states.set(body, { nx, nz, dx, dz, data, style, spanProfiles, spanMedia, caps: Float32Array.from(caps),
      empty: !spans.length, spans: Float32Array.from(spans) });
    return body;
  }

  function pocket({ id, bounds: source } = {}) {
    const triplet = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(number);
    if (!name(id) || !triplet(source?.min) || !triplet(source?.max)) throw new TypeError('An air pocket needs an ID and finite XYZ bounds');
    const bounds = P.data.freeze({ min: source.min.map(Math.fround), max: source.max.map(Math.fround) });
    if (bounds.min.some((v, i) => v >= bounds.max[i])) throw new RangeError('An air pocket needs positive XYZ extents');
    const { min, max } = bounds;
    return Object.freeze({ id, kind: 'air', priority: 1, bounds, sdf: (x, y, z) =>
      Math.max(min[0] - x, x - max[0], min[1] - y, y - max[1], min[2] - z, z - max[2]) });
  }

  const equalVector = (a, b) => a.every((v, i) => v === b[i]);
  const equalBounds = (a, b) => equalVector(a.min, b.min) && equalVector(a.max, b.max);
  function changedBody(before, after) {
    if (!before || !after) {
      const body = before ?? after;
      return body.grid?.bounds ?? body.bounds;
    }
    if (before === after) return null;
    const a = states.get(before), b = states.get(after), old = before.grid?.bounds ?? before.bounds,
      next = after.grid?.bounds ?? after.bounds;
    if (before.grid || after.grid) {
      if (before.grid === after.grid) return null;
      if (!before.grid || !after.grid || !equalBounds(old, next) || a.nx !== b.nx || a.nz !== b.nz)
        return P.spatial.boxOf([old.min, old.max, next.min, next.max]);
      const equalColumn = (x, z) => {
        const left = before.grid.column(x, z), right = after.grid.column(x, z);
        return left.length === right.length && left.every((row, i) => {
          const other = right[i];
          return row.min === other.min && row.max === other.max && row.kind === other.kind &&
            row.id === other.id && row.material === other.material && equalVector(row.current, other.current);
        });
      };
      const boxes = [];
      for (let z = 0; z < a.nz; z++) {
        let start = -1;
        for (let x = 0; x <= a.nx; x++) {
          if (x < a.nx && !equalColumn(x, z)) {
            if (start === -1) start = x;
          } else if (start !== -1) {
            boxes.push({ min: [old.min[0] + start * a.dx, old.min[1], old.min[2] + z * a.dz],
              max: [x === a.nx ? old.max[0] : old.min[0] + x * a.dx, old.max[1],
                z === a.nz - 1 ? old.max[2] : old.min[2] + (z + 1) * a.dz] });
            start = -1;
          }
        }
      }
      return boxes;
    }
    if (a.nx !== b.nx || a.nz !== b.nz || a.dx !== b.dx || a.dz !== b.dz ||
        [0, 2].some(i => old.min[i] !== next.min[i] || old.max[i] !== next.max[i]))
      return P.spatial.boxOf([old.min, old.max, next.min, next.max]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] &&
          a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
      const x = i / 4 % a.nx, z = Math.floor(i / 4 / a.nx);
      lo[0] = Math.min(lo[0], next.min[0] + x * a.dx);
      lo[2] = Math.min(lo[2], next.min[2] + z * a.dz);
      hi[0] = Math.max(hi[0], x === a.nx - 1 ? next.max[0] : next.min[0] + (x + 1) * a.dx);
      hi[2] = Math.max(hi[2], z === a.nz - 1 ? next.max[2] : next.min[2] + (z + 1) * a.dz);
      if (a.data[i] < a.data[i + 1]) {
        lo[1] = Math.min(lo[1], a.data[i]);
        hi[1] = Math.max(hi[1], a.data[i + 1]);
      }
      if (b.data[i] < b.data[i + 1]) {
        lo[1] = Math.min(lo[1], b.data[i]);
        hi[1] = Math.max(hi[1], b.data[i + 1]);
      }
    }
    return lo[0] === Infinity ? null : { min: lo, max: hi };
  }

  function atlasFor(bodies) {
    const bounds = bodies.map(body => body.bounds), tree = [];
    function branch(indices) {
      const index = tree.length, box = P.spatial.boxOf(indices.flatMap(i => [bounds[i].min, bounds[i].max]));
      const node = { box, body: indices.length === 1 ? indices[0] : -1, escape: 0 };
      tree.push(node);
      if (indices.length > 1) {
        const midpoint = (i, axis) => (bounds[i].min[axis] + bounds[i].max[axis]) / 2;
        const centres = P.spatial.boxOf(indices.map(i => [midpoint(i, 0), midpoint(i, 1), midpoint(i, 2)]));
        const size = centres.max.map((v, i) => v - centres.min[i]), axis = size.indexOf(Math.max(...size));
        indices.sort((a, b) => midpoint(a, axis) - midpoint(b, axis) || a - b);
        const middle = indices.length >>> 1;
        branch(indices.slice(0, middle));
        branch(indices.slice(middle));
      }
      node.escape = tree.length;
    }
    branch(bodies.map((_, i) => i));
    const profiles = [], byStyle = new Map(), byValue = new Map();
    function profile(style) {
      if (!byStyle.has(style)) {
        const value = JSON.stringify(style);
        if (!byValue.has(value)) {
          byValue.set(value, profiles.length);
          profiles.push(style);
        }
        byStyle.set(style, byValue.get(value));
      }
      return byStyle.get(style);
    }
    const bodyBase = tree.length * 2, styleBase = bodyBase + bodies.length * 4;
    const blocks = bodies.map(body => {
      const state = states.get(body);
      return { body, ...state, defaultStyle: profile(state.style), styles: state.spanProfiles?.map(profile) };
    });
    const dataBase = styleBase + profiles.length * 6;
    const texels = blocks.reduce((sum, { nx, nz, spans }) => sum + nx * nz + (spans?.length ?? 0) / 2, dataBase);
    if (texels > atlasSize ** 2) throw new RangeError('Water scene exceeds its texture atlas budget');
    const width = Math.min(atlasSize, Math.max(maxAxis, 2 ** Math.ceil(Math.log2(Math.sqrt(texels)))));
    const height = Math.ceil(texels / width);
    return (air, reflectionPlanes) => {
      const data = new Float32Array(width * height * 4);
      const write = (i, column) => data.set(column, i * 4);
      tree.forEach(({ box, escape, body }, i) => {
        write(i * 2, [...box.min, escape]);
        write(i * 2 + 1, [...box.max, body]);
      });
      profiles.forEach((row, i) => {
        const at = styleBase + i * 6;
        write(at, [...row.tint, row.foam]);
        write(at + 1, [...row.extinction, row.caustics]);
        write(at + 2, [...row.surfaceColor, surfaceWeight(row)]);
        write(at + 3, [...row.deepTint, row.refraction]);
        write(at + 4, [...row.sediment.color, row.sediment.strength]);
        write(at + 5, [...row.depthRange, row.sediment.height, row.sediment.scale]);
      });
      let next = dataBase;
      blocks.forEach(({ body, nx, nz, dx, dz, data: grid, spans, caps, styles, defaultStyle }, i) => {
        const at = bodyBase + i * 4, start = next, tail = start + nx * nz;
        write(at, [...body.bounds.min, start]);
        write(at + 1, [...body.bounds.max, defaultStyle]);
        write(at + 2, [dx, dz, nx, nz]);
        write(at + 3, [Number(Boolean(spans)), 0, 0, 0]);
        data.set(grid, start * 4);
        next = tail;
        if (!spans) return;
        for (let column = 0; column < nx * nz; column++) {
          const o = column * 4, first = grid[o], count = grid[o + 1];
          data[(start + column) * 4] = tail + first * 2;
          for (let j = 0; j < count; j++) {
            const span = first + j, flags = grid[o + (j < 16 ? 2 : 3)], exposed = (flags >> (j % 16)) & 1;
            write(next++, spans.subarray(span * 4, span * 4 + 4));
            write(next++, [styles?.[span] ?? defaultStyle, exposed, caps[span * 2], caps[span * 2 + 1]]);
          }
        }
      });
      return packReflections({ width, height, data, uniforms: { ...air, u_waterAtlas: 1, u_waterCount: bodies.length,
        u_waterNodeCount: tree.length, u_waterBodyBase: bodyBase, u_waterStyleBase: styleBase } }, profiles, reflectionPlanes);
    };
  }

  // Append capture bindings to the existing optical texture, not a second water layout.
  function packReflections(packed, profiles, planes) {
    if (!planes.length) return packed;
    const base = packed.data.length / 4, height = Math.ceil((base + profiles.length) / packed.width);
    if (height > atlasSize) throw new RangeError('Water reflection bindings exceed the texture atlas budget');
    const data = new Float32Array(packed.width * height * 4);
    data.set(packed.data);
    profiles.forEach((style, i) => {
      const binding = style.reflection;
      if (binding) data.set([planes.indexOf(binding.plane) + 1, binding.distortion, binding.blur, 0], (base + i) * 4);
    });
    return { ...packed, height, data, uniforms: { ...packed.uniforms, u_waterReflectionBase: base } };
  }

  function rayBox(bounds, origin, direction, stop) {
    const range = [0, stop];
    return [0, 1, 2].every(axis =>
      SceneOptics.slab(range, origin[axis], direction[axis], bounds.min[axis], bounds.max[axis])) ? range : null;
  }

  function columnSegments(body, state, origin, direction, range, cuts, out, mediumIds) {
    const { nx, nz, dx, dz, data, spans, style, spanProfiles, caps } = state;
    const { min } = body.bounds;
    const [start, stop] = range;
    // Split once at each horizontal grid crossing. Each open interval belongs to one column.
    const times = [start, stop];
    for (const [axis, size, count] of [[0, dx, nx], [2, dz, nz]]) {
      if (Math.abs(direction[axis]) < 1e-10) continue;
      const at = t => (origin[axis] + direction[axis] * t - min[axis]) / size;
      const low = Math.max(1, Math.ceil(Math.min(at(start), at(stop))));
      const high = Math.min(count - 1, Math.floor(Math.max(at(start), at(stop))));
      for (let cell = low; cell <= high; cell++) {
        const t = (min[axis] + cell * size - origin[axis]) / direction[axis];
        if (t > start && t < stop) times.push(t);
      }
    }
    times.sort((a, b) => a - b);
    function wet(from, to, bed, top, profile, surface, id) {
      const clipped = [from, to];
      if (top <= bed || !SceneOptics.slab(clipped, origin[1], direction[1], bed, top)) return;
      const append=(a,b)=>out.push(mediumIds?[a,b,profile,surface,id]:[a,b,profile,surface]);
      let [enter, exit] = clipped;
      for (const [left, right] of cuts) {
        if (right <= enter || left >= exit) continue;
        if (left > enter) append(enter,left);
        enter = right;
        if (enter >= exit) return;
      }
      append(enter,exit);
    }
    for (let i = 1; i < times.length; i++) {
      const from = times[i - 1], to = times[i];
      if (to - from < 1e-10) continue;
      const mid = (from + to) * .5;
      const x = Math.max(0, Math.min(nx - 1, Math.floor((origin[0] + direction[0] * mid - min[0]) / dx)));
      const z = Math.max(0, Math.min(nz - 1, Math.floor((origin[2] + direction[2] * mid - min[2]) / dz)));
      const col = (z * nx + x) * 4;
      if (spans) {
        const first = data[col], end = first + data[col + 1];
        for (let span = first; span < end; span++)
          wet(from, to, spans[span * 4], spans[span * 4 + 1], spanProfiles[span] ?? style, caps[span * 2 + 1], state.spanMedia?.[span]??body.id);
      } else wet(from, to, data[col], data[col + 1], style, data[col + 1], body.id);
    }
  }

  function scene(bodies, { airPockets = [] } = {}) {
    if (!Array.isArray(bodies) || bodies.length > maxBodies || !Array.from(bodies).every(body => states.has(body)) ||
        new Set(bodies.map(body => body.id)).size !== bodies.length)
      throw new TypeError('A water scene holds up to 256 water bodies with distinct IDs');
    if (!Array.isArray(airPockets) || airPockets.length > 8) throw new TypeError('A water scene holds up to eight air pockets');
    const pockets = Array.from(airPockets, pocket).sort(compare);
    if (new Set([...pockets, ...bodies].map(item => item.id)).size !== pockets.length + bodies.length)
      throw new TypeError('Water bodies and air pockets need distinct IDs');
    const sorted = bodies.slice().sort(compare), active = sorted.filter(body => !states.get(body).empty);
    const physical = sorted.filter(body => body.grid || !states.get(body).empty);
    for (let i = 0; i < physical.length; i++) for (let j = i + 1; j < physical.length; j++) {
      const first = physical[i], second = physical[j], a = first.grid?.bounds ?? first.bounds, b = second.grid?.bounds ?? second.bounds;
      if (a.min.every((v, axis) => v < b.max[axis] && a.max[axis] > b.min[axis]))
        throw new RangeError('Water body bounds overlap: ' + first.id + ' and ' + second.id);
    }
    const labels = new Map();
    for (const body of sorted) for (const row of body.media ?? [body.medium]) {
      if (!labels.has(row.id)) labels.set(row.id, []);
      labels.get(row.id).push({ row, layered: Boolean(body.grid) });
    }
    const media = Object.freeze([...Array.from(labels.values(), group => {
      const { row: first } = group[0];
      if (group.length === 1) return first;
      if (group.some(({ row, layered }) => !layered || row.kind !== first.kind))
        throw new TypeError('Repeated span IDs must refer to the same kind across layered tiles');
      const index = group.length > uniformBodies ? P.spatial.pointIndex(group.map(({ row }) => row)) : null;
      function sample(x, y, z) {
        if (!index) return group.find(({ row }) => row.sdf(x, y, z) < 0)?.row;
        let match;
        index([x, y, z], row => {
          if (!match && row.sdf(x, y, z) < 0) match = row;
        });
        return match;
      }
      const combined = { id: first.id, kind: first.kind, priority: first.priority,
        bounds: P.data.freeze(P.spatial.boxOf(group.flatMap(({ row }) => [row.bounds.min, row.bounds.max]))),
        sdf: (x, y, z) => sample(x, y, z) ? -1 : 1 };
      if (first.kind === 'air') return Object.freeze(combined);
      return Object.freeze({ ...combined, surfaceAt: (x, y, z) => sample(x, y, z).surfaceAt(x, y, z),
        current: (x, y, z) => sample(x, y, z).current(x, y, z) });
    }), ...pockets]);
    const reflectionPlanes = Object.freeze([...new Set(active.flatMap(body => {
      const state = states.get(body);
      return [state.style, ...(state.spanProfiles ?? [])].flatMap(style => style.reflection ? [style.reflection.plane] : []);
    }))].sort());
    if (reflectionPlanes.length > 4) throw new RangeError('A water scene supports up to four distinct reflection planes');
    const layered = active.some(body => body.grid);
    const atlas = active.length > uniformBodies || active.some(body => {
      const { style, spanProfiles } = states.get(body);
      return style.styled || spanProfiles?.length;
    }) ? atlasFor(active) : null;
    const { mediumAt } = P.biomes.create({ media });
    function pack() {
      const airMin = new Float32Array(32), airMax = new Float32Array(32);
      pockets.forEach(({ bounds }, i) => {
        airMin.set(bounds.min, i * 4);
        airMax.set(bounds.max, i * 4);
      });
      const air = { u_waterAirCount: pockets.length, u_waterAirMin: airMin, u_waterAirMax: airMax,
        u_waterLayered: +layered };
      if (atlas) return atlas(air, reflectionPlanes);
      const rows = active.reduce((sum, body) => sum + states.get(body).nz, 0);
      const intervals = active.reduce((sum, body) => sum + (states.get(body).spans?.length ?? 0) / 4, 0);
      const width = Math.max(maxAxis, Math.ceil(intervals / (2048 - rows)));
      const height = Math.max(1, rows + Math.ceil(intervals / width));
      const data = new Float32Array(width * height * 4), modes = new Int32Array(uniformBodies);
      const boxesMin = new Float32Array(uniformBodies * 4), boxesMax = new Float32Array(uniformBodies * 4);
      const grids = new Float32Array(uniformBodies * 4), tint = new Float32Array(uniformBodies * 4);
      const extinction = new Float32Array(uniformBodies * 4), highlights = new Float32Array(uniformBodies * 4);
      let row = 0, tail = rows * width;
      active.forEach((body, i) => {
        const { nx, nz, dx, dz, data: grid, spans, style } = states.get(body), o = i * 4;
        boxesMin.set([...body.bounds.min, row], o);
        boxesMax.set([...body.bounds.max, style.refraction], o);
        grids.set([dx, dz, nx, nz], o);
        tint.set([...style.tint, style.foam], o);
        extinction.set([...style.extinction, style.caustics], o);
        highlights.set([...style.surfaceColor, surfaceWeight(style)], o);
        for (let z = 0; z < nz; z++) {
          const offset = (row + z) * width * 4;
          data.set(grid.subarray(z * nx * 4, (z + 1) * nx * 4), offset);
          if (spans) for (let x = 0; x < nx; x++) data[offset + x * 4] += tail;
        }
        if (spans) {
          modes[i] = 1;
          data.set(spans, tail * 4);
          tail += spans.length / 4;
        }
        row += nz;
      });
      const uniforms = { u_waterCount: active.length, u_waterMin: boxesMin, u_waterMax: boxesMax,
        u_waterGrid: grids, u_waterTint: tint, u_waterLoss: extinction, u_waterHighlight: highlights,
        ...air, u_waterSpanMode: modes };
      return packReflections({ width, height, data, uniforms }, active.map(body => states.get(body).style), reflectionPlanes);
    }
    function changesFrom(previous) {
      if (previous === result) return [];
      const old = previous == null ? { physical: [], pockets: [] } : sceneStates.get(previous);
      if (!old) throw new TypeError('Expected a previous water scene');
      const changed = [];
      function compareRows(before, after, difference) {
        const a = new Map(before.map(row => [row.id, row])), b = new Map(after.map(row => [row.id, row]));
        for (const id of new Set([...a.keys(), ...b.keys()])) {
          const bounds = difference(a.get(id), b.get(id));
          if (Array.isArray(bounds)) changed.push(...bounds);
          else if (bounds) changed.push(bounds);
        }
      }
      compareRows(old.physical, physical, changedBody);
      compareRows(old.pockets, pockets, (a, b) => {
        if (!a || !b) return (a ?? b).bounds;
        return equalBounds(a.bounds, b.bounds) ? null :
          P.spatial.boxOf([a.bounds.min, a.bounds.max, b.bounds.min, b.bounds.max]);
      });
      return P.data.freeze(changed);
    }
    function raySegments(origin, direction, stop, { mediumIds = false } = {}) {
      const cuts = pockets.map(pocket => rayBox(pocket.bounds, origin, direction, stop))
        .filter(Boolean).sort((a, b) => a[0] - b[0]);
      const segments = [];
      for (const body of active) {
        const range = rayBox(body.bounds, origin, direction, stop);
        if (range) columnSegments(body, states.get(body), origin, direction, range, cuts, segments, mediumIds);
      }
      return segments.sort((a, b) => a[0] - b[0]);
    }
    function mapColors(colorFor) {
      const next = sorted.map(body => {
        const state = states.get(body), styles = new Map();
        function recolor(id, style) {
          if (styles.has(id)) return styles.get(id);
          const transform = colorFor(id, 'water');
          const mapped = transform ? P.data.freeze({ ...style, tint: transform(style.tint), deepTint: transform(style.deepTint),
            surfaceColor: transform(style.surfaceColor), sediment: { ...style.sediment, color: transform(style.sediment.color) } }) : style;
          styles.set(id, mapped);
          return mapped;
        }
        const style = body.grid ? state.style : recolor(body.id, state.style);
        let spanProfiles = state.spanProfiles, changed = style !== state.style;
        if (state.spanMedia?.length) {
          spanProfiles = state.spanMedia.map((id, i) => {
            const before = state.spanProfiles[i] ?? state.style;
            const after = recolor(id, before);
            changed ||= before !== after;
            return after;
          });
        }
        if (!changed) return body;
        const copy = Object.freeze({ ...body });
        states.set(copy, { ...state, style, spanProfiles });
        return copy;
      });
      return next.every((body, i) => body === sorted[i]) ? result : scene(next, { airPockets });
    }
    const result = Object.freeze({ media, mediumAt, count: active.length, layered, reflectionPlanes, pack, changesFrom, mapColors, raySegments });
    sceneStates.set(result, { physical, pockets });
    return result;
  }

  function sceneFromSpans(tiles, { previous, optics: look, onWork } = {}) {
    const old = tileScenes.get(previous);
    if (!Array.isArray(tiles) || tiles.length > 4096 || new Set(tiles).size !== tiles.length ||
        !Array.from(tiles).every(P.verticalSpans.isGrid) ||
        (previous !== undefined && !old) || onWork !== undefined && typeof onWork !== 'function')
      throw new TypeError('Expected span grids and an optional previous span water scene and work callback');
    const key = typeof look === 'function' ? look : JSON.stringify(optics(look ?? undefined));
    const cached = old?.key === key ? old.bodies : new Map();
    const wet = tiles.filter(grid => grid.hasWater || grid.hasNamedAir);
    if (wet.length > maxBodies) throw new RangeError('A span water scene supports up to 256 wet or tagged-air tiles');
    const bodies = new Map();
    for (const grid of wet) {
      const id = 'span/' + grid.bounds.min.join('/');
      bodies.set(grid, cached.get(grid) ?? fromSpans(grid, { id, optics: look ?? undefined }));
    }
    if (onWork) {
      const byId = new Set([...bodies.values()].map(body=>body.id));
      onWork(P.data.freeze({
        rebuilt:wet.filter(grid=>!cached.has(grid)).map(grid=>bodies.get(grid).id),
        reused:wet.filter(grid=>cached.has(grid)).map(grid=>bodies.get(grid).id),
        removed:[...(old?.bodies.values() ?? [])].filter(body=>!byId.has(body.id)).map(body=>body.id)
      }));
    }
    if (old?.key === key && bodies.size === cached.size && wet.every(grid => cached.has(grid))) return previous;
    const result = scene([...bodies.values()]);
    tileScenes.set(result, { key, bodies });
    return result;
  }

  function combine(...scenes) {
    const present=scenes.filter(Boolean);
    if(present.length<2)return present[0];
    const inputs=present.map(value=>sceneStates.get(value));
    if(inputs.some(value=>!value))throw new TypeError('Expected water scenes');
    return scene(inputs.flatMap(value=>value.physical),{airPockets:inputs.flatMap(value=>value.pockets)});
  }
  P.waterBodies = Object.freeze({ create, fromShallowWater, fromSpans, scene, sceneFromSpans, combine, optics });
})(KIT);
