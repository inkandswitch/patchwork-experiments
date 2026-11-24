/* Retain the glTF document independently of its flattened sculpt preview. */
(function(K) {
  const brand = Symbol.for('ink-studio.gltf-asset'), { mul, trs } = K.mesh.gltfTransforms;
  const integer = Number.isSafeInteger, finite = Number.isFinite;
  const vector = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(finite);
  const index = (id, list) => integer(id) && id >= 0 && id < list.length;
  const paths = { translation: 3, rotation: 4, scale: 3, weights: 0 };
  const widths = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const components = {
    5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767],
    5123: [2, 'getUint16', 65535], 5126: [4, 'getFloat32', 1]
  };
  const indices = { 5121: components[5121], 5123: components[5123], 5125: [4, 'getUint32'] };
  const identity = trs({});
  const is = value => value?.[brand] === true;

  function create(source) {
    if (is(source)) return source;
    if (!source || source.document?.asset?.version !== '2.0')
      throw new TypeError('Interchange requires a glTF 2.0 document');
    const document = structuredClone(source.document), { buffers = [], bufferViews = [], accessors = [], images = [],
      nodes = [], scenes = [], materials = [], meshes = [], skins = [], animations = [] } = document;
    if (![buffers, bufferViews, accessors, images, nodes, scenes, materials, meshes, skins, animations].every(Array.isArray))
      throw new TypeError('Invalid glTF asset tables');
    const input = source.binary ?? new Uint8Array(0), length = buffers[0]?.byteLength ?? 0;
    if (!(input instanceof Uint8Array) || buffers.length > 1 || buffers[0]?.uri !== undefined ||
        !integer(length) || length < 0 || length > input.length || input.length - length > 3 ||
        images.some(image => !image || image.uri !== undefined || !index(image.bufferView, bufferViews)))
      throw new TypeError('A retained glTF asset needs self-contained binary and image data');
    const binary = Uint8Array.from(input.subarray(0, length));
    const bytes = new DataView(binary.buffer);
    function viewRange(id, offset, span) {
      const view = bufferViews[id];
      const first = view?.byteOffset ?? 0, size = view?.byteLength;
      if (!view || !buffers.length || view.buffer !== 0 || ![first, size, offset, span].every(n => integer(n) && n >= 0) ||
          first + size > length || offset + span > size)
        throw new RangeError('glTF data exceeds its buffer view');
      return first + offset;
    }
    for (const [i, view] of bufferViews.entries()) viewRange(i, 0, view?.byteLength);
    const parents = new Int32Array(nodes.length).fill(-1);
    for (const [id, node] of nodes.entries()) {
      if (!node || typeof node !== 'object' || node.matrix !== undefined &&
          (!vector(node.matrix, 16) || Object.keys(paths).slice(0, 3).some(key => node[key] !== undefined)) ||
          Object.entries(paths).some(([key, size]) => size && node[key] !== undefined && !vector(node[key], size)) ||
          node.rotation && Math.abs(Math.hypot(...node.rotation) - 1) > .001 ||
          node.mesh !== undefined && !index(node.mesh, meshes) || node.skin !== undefined && !index(node.skin, skins))
        throw new TypeError('Invalid glTF node transform or mesh binding at ' + id);
      const children = node.children ?? [];
      if (!Array.isArray(children)) throw new TypeError('glTF children must be node indices');
      for (const child of children) {
        if (!index(child, nodes) || parents[child] !== -1) throw new RangeError('Invalid glTF hierarchy or multiple node parents');
        parents[child] = id;
      }
    }
    const roots = nodes.map((_, id) => id).filter(id => parents[id] === -1);
    const order = roots.slice();
    for (let i = 0; i < order.length; i++) for (const child of nodes[order[i]].children ?? []) order.push(child);
    if (order.length !== nodes.length) throw new RangeError('Cyclic glTF hierarchy');
    function sceneRoots(scene) {
      if (scene === undefined && !scenes.length) return roots;
      const selected = scene ?? document.scene ?? 0;
      if (!index(selected, scenes)) throw new RangeError('Unknown glTF scene');
      const entries = scenes[selected]?.nodes ?? [];
      if (!Array.isArray(entries) || new Set(entries).size !== entries.length ||
          !Array.from(entries).every(id => index(id, nodes) && parents[id] === -1))
        throw new RangeError('glTF scenes need distinct root nodes');
      return entries;
    }
    for (let i = 0; i < scenes.length; i++) sceneRoots(i);
    sceneRoots();
    for (const mesh of meshes)
      if (!Array.isArray(mesh?.primitives) || mesh.primitives.some(part => !part || part.material !== undefined && !index(part.material, materials)))
        throw new TypeError('Invalid glTF material assignment');

    const decoded = new Map(), compiled = new Map();
    function valuesOf(id) {
      if (decoded.has(id)) return decoded.get(id);
      const a = accessors[id], width = widths[a?.type], component = components[a?.componentType];
      const float = a?.componentType === 5126;
      if (!width || !component || (float ? a.normalized : a.normalized !== true) || !integer(a.count) || a.count < 1 ||
          a.count * width > 4_000_000) throw new TypeError('Unsupported glTF animation accessor');
      const [size, readValue, maximum] = component;
      const values = new Float64Array(a.count * width), row = width * size;
      const read = (at, into) => {
        for (let k = 0; k < width; k++) {
          const value = bytes[readValue](at + k * size, true);
          if (!finite(value)) throw new RangeError('Nonfinite glTF animation value');
          values[into * width + k] = float ? value : Math.max(-1, value / maximum);
        }
      };
      if (a.bufferView !== undefined) {
        const stride = bufferViews[a.bufferView]?.byteStride ?? row;
        if (!integer(stride) || stride < row || stride % size) throw new RangeError('Invalid glTF animation stride');
        const first = viewRange(a.bufferView, a.byteOffset ?? 0, row + (a.count - 1) * stride);
        for (let n = 0; n < a.count; n++) read(first + n * stride, n);
      }
      if (a.sparse) {
        const { count, indices: keys, values: replacements } = a.sparse, type = indices[keys?.componentType];
        if (!type || !integer(count) || count < 1 || count > a.count || !replacements)
          throw new RangeError('Invalid sparse glTF animation accessor');
        const [size, method] = type, first = viewRange(keys.bufferView, keys.byteOffset ?? 0, size * count);
        const data = viewRange(replacements.bufferView, replacements.byteOffset ?? 0, row * count);
        let last = -1;
        for (let n = 0; n < count; n++) {
          const key = bytes[method](first + n * size, true);
          if (key <= last || key >= a.count) throw new RangeError('Invalid sparse glTF indices');
          read(data + n * row, key);
          last = key;
        }
      }
      const result = { values, width, float };
      decoded.set(id, result);
      return result;
    }
    function clipIndex(clip) {
      if (typeof clip === 'string') {
        const ids = animations.map((row, i) => row.name === clip ? i : -1).filter(i => i >= 0);
        if (ids.length === 1) return ids[0];
        if (ids.length > 1) throw new RangeError('Ambiguous glTF animation name: ' + clip);
      } else if (index(clip, animations)) return clip;
      throw new RangeError('Unknown glTF animation: ' + clip);
    }
    function tracks(id) {
      if (compiled.has(id)) return compiled.get(id);
      const { channels, samplers } = animations[id] ?? {};
      if (!Array.isArray(channels) || !Array.isArray(samplers)) throw new TypeError('Invalid glTF animation');
      const seen = new Set();
      const rows = channels.flatMap(({ sampler, target }) => {
        const { node, path } = target ?? {}, row = samplers[sampler];
        if (node === undefined || !Object.hasOwn(paths, path)) return [];
        if (!index(node, nodes) || !row || nodes[node].matrix)
          throw new TypeError('Unsupported glTF animation channel');
        const key = node + '/' + path;
        if (seen.has(key)) throw new RangeError('Duplicate glTF animation target');
        seen.add(key);
        const mode = row.interpolation ?? 'LINEAR';
        if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(mode)) throw new TypeError('Unsupported glTF interpolation ' + mode);
        const times = valuesOf(row.input), output = valuesOf(row.output), keys = times.values;
        const cubic = mode === 'CUBICSPLINE', stride = cubic ? 3 : 1;
        const width = paths[path] || meshes[nodes[node].mesh]?.primitives[0]?.targets?.length;
        if (!integer(width) || width < 1 || times.width !== 1 || !times.float ||
            keys.some((n, i) => n < 0 || i > 0 && n <= keys[i - 1]) || cubic && keys.length < 2 ||
            !output.float && path !== 'rotation' && path !== 'weights' ||
            output.width !== (path === 'weights' ? 1 : width) || output.values.length !== keys.length * width * stride)
          throw new RangeError('Invalid glTF animation keyframes');
        return [{ node, path, mode, cubic, keys, width, data: output.values }];
      });
      compiled.set(id, rows);
      return rows;
    }
    function rotation(values) {
      const length = Math.hypot(...values);
      if (!(length > 0)) throw new RangeError('Invalid glTF quaternion keyframe');
      return values.map(n => n / length);
    }
    function sampleTrack({ keys, width, data, cubic, mode, path }, time) {
      let low = 0, high = keys.length - 1;
      if (time <= keys[0]) high = low;
      else if (time >= keys[high]) low = high;
      else while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (keys[mid] <= time) low = mid;
        else high = mid;
      }
      const offset = key => (cubic ? 3 * key + 1 : key) * width;
      const a = Array.from(data.subarray(offset(low), offset(low) + width));
      const quaternion = path === 'rotation';
      if (low === high || mode === 'STEP') return quaternion ? rotation(a) : a;
      const b = Array.from(data.subarray(offset(high), offset(high) + width));
      const dt = keys[high] - keys[low], t = (time - keys[low]) / dt;
      if (cubic) {
        const t2 = t*t, t3 = t2*t;
        const out = a.map((n, k) => (2*t3 - 3*t2 + 1)*n + (t3 - 2*t2 + t)*dt*data[offset(low) + width + k] +
          (-2*t3 + 3*t2)*b[k] + (t3 - t2)*dt*data[offset(high) - width + k]);
        return quaternion ? rotation(out) : out;
      }
      if (!quaternion) return a.map((n, k) => n + (b[k] - n)*t);
      const from = rotation(a), to = rotation(b);
      const dot = from.reduce((sum, n, i) => sum + n * to[i], 0), sign = dot < 0 ? -1 : 1;
      if (Math.abs(dot) > .9995) return rotation(from.map((n, k) => n*(1-t) + t*to[k]*sign));
      const angle = Math.acos(Math.abs(dot)), denom = Math.sin(angle);
      return from.map((n, k) => (n*Math.sin((1-t)*angle) + to[k]*sign*Math.sin(t*angle)) / denom);
    }

    function sample(time = 0, { clip, scene } = {}) {
      if (!finite(time)) throw new RangeError('glTF pose time must be finite');
      const active = sceneRoots(scene).slice(), posed = nodes.map(node => ({ ...node }));
      for (let i = 0; i < active.length; i++) for (const child of nodes[active[i]].children ?? []) active.push(child);
      if (clip !== undefined) for (const track of tracks(clipIndex(clip))) posed[track.node][track.path] = sampleTrack(track, time);
      const world = [];
      return active.map(id => {
        const node = posed[id], parent = parents[id], local = trs(node).slice();
        const mesh = meshes[node.mesh], morphs = mesh?.primitives[0]?.targets?.length,
          weights = node.weights ?? mesh?.weights ?? (morphs ? Array(morphs).fill(0) : undefined);
        world[id] = mul(parent === -1 ? identity : world[parent], local);
        return { id, name: node.name, parent: parent === -1 ? null : parent, local, world: world[id],
          ...(mesh && { mesh: node.mesh, materials: mesh.primitives.map(part => part.material ?? null) }),
          ...(node.skin !== undefined && { skin: node.skin }),
          ...(node.extras?.inkStudio?.pivot && { pivot: structuredClone(node.extras.inkStudio.pivot) }),
          ...(weights && { weights: weights.slice() })
        };
      });
    }

    return Object.freeze({ [brand]: true, sample,
      snapshot: () => ({ document: structuredClone(document), binary: binary.slice() }),
      withDocument: next => create({ document: next, binary })
    });
  }
  K.authoring.gltfAssets = Object.freeze({ create, is });
})(KIT);
