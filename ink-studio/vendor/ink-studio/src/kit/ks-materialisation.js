/* Actual surface splats become fragments, gather into live anchors, and rejoin their parts. */
(function (K) {
  const api = K.materialisation,
    { V } = K,
    HOME = 0,
    WAIT = 1,
    DRIFT = 2,
    GATHER = 3,
    SETTLED = 4,
    HIDDEN = 5,
    MODES = ['home', 'waiting', 'drifting', 'gathering', 'settled', 'hidden'];
  const finite = (n, a = 0, b = 1e9) => Number.isFinite(n) && n >= a && n <= b;
  const vector = (v, n) => {
    if ((!Array.isArray(v) && !ArrayBuffer.isView(v)) || v.length !== n) return false;
    for (let i = 0; i < n; i++) if (!Number.isFinite(v[i])) return false;
    return true;
  };
  const unit = x => Math.max(0, Math.min(1, x)),
    smooth = x => {
      x = unit(x);
      return x * x * x * (10 + x * (-15 + 6 * x));
    };
  const mix = (a, b, t) => a + (b - a) * t;
  const packedMix = (a, b, t) =>
    Math.round(mix(a & 255, b & 255, t)) +
    (Math.round(mix((a >>> 8) & 255, (b >>> 8) & 255, t)) << 8) +
    (Math.round(mix((a >>> 16) & 255, (b >>> 16) & 255, t)) << 16);
  const covarianceIndices = [4, 5, 6, 8, 9, 10];
  const contextFreePaths = new WeakSet();
  function colorRGB(c) {
    return [(c & 255) / 255, ((c >>> 8) & 255) / 255, ((c >>> 16) & 255) / 255];
  }
  function providersSample(provider, time) {
    provider.begin(time);
    const rows = Array.from({ length: provider.count }, () => api.sample());
    rows.forEach((row, i) => provider.sample(i, time, row));
    return rows;
  }
  function spatialOrder(samples) {
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity];
    for (const s of samples)
      for (let a = 0; a < 3; a++) {
        low[a] = Math.min(low[a], s.position[a]);
        high[a] = Math.max(high[a], s.position[a]);
      }
    function code(s) {
      const q = s.position.map((v, a) =>
        Math.min(255, Math.floor(((v - low[a]) / Math.max(1e-8, high[a] - low[a])) * 255))
      );
      let result = 0;
      for (let bit = 0; bit < 8; bit++) for (let a = 0; a < 3; a++) result |= ((q[a] >> bit) & 1) << (bit * 3 + a);
      return result;
    }
    return samples
      .map((s, i) => ({ i, code: code(s) }))
      .sort((a, b) => a.code - b.code || a.i - b.i)
      .map(row => row.i);
  }
  function correspondence(source, target, { mapping = 'spatial', links = 4, transport } = {}, time = 0) {
    const n = source.count,
      m = target.count;
    if (!Number.isInteger(links) || links < 1 || links > 16)
      throw new RangeError('Correspondence links must be in [1,16]');
    if (Array.isArray(mapping) || ArrayBuffer.isView(mapping)) {
      const values = Array.from(mapping);
      if (values.length !== n || values.some(i => !Number.isInteger(i) || i < 0 || i >= m))
        throw new RangeError('Explicit mapping must address every source anchor');
      return values.map(i => [[i, 1]]);
    }
    if (!['index', 'spatial', 'transport'].includes(mapping))
      throw new RangeError('Unknown materialisation correspondence');
    if (mapping === 'index')
      return Array.from({ length: n }, (_, i) => [[Math.min(m - 1, Math.floor((i * m) / n)), 1]]);
    const a = providersSample(source, time),
      b = providersSample(target, time);
    if (mapping === 'spatial') {
      const first = spatialOrder(a),
        second = spatialOrder(b),
        result = new Array(n);
      first.forEach((id, k) => {
        result[id] = [[second[Math.min(m - 1, Math.floor((k * m) / n))], 1]];
      });
      return result;
    }
    const samples = rows =>
      rows.map((s, i) => ({ id: String(i), position: s.position, normal: s.normal, color: colorRGB(s.color) }));
    const result = K.procedural.motion.transportSplats(samples(a), samples(b), { normalize: 'bounds', ...transport });
    return Array.from({ length: n }, (_, i) => {
      const candidates = Array.from({ length: m }, (_, j) => [j, result.mass[i * m + j]])
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, links),
        sum = candidates.reduce((v, p) => v + p[1], 0);
      return sum ? candidates.map(([j, w]) => [j, w / sum]) : [[i % m, 1]];
    });
  }
  api.color = value => {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      const h = parseInt(value.slice(1), 16);
      return ((h >>> 16) & 255) + (h & 0xff00) + ((h & 255) << 16);
    }
    if (vector(value, 3) && Array.from(value).every(v => v >= 0 && v <= 1))
      return Math.round(value[0] * 255) + (Math.round(value[1] * 255) << 8) + (Math.round(value[2] * 255) << 16);
    if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
    throw new RangeError('Materialisation color needs hex text, normalized RGB or packed splat RGB');
  };
  api.FLAG = 32768; // Explicit fragment appearance bypasses rest-space pixel brushes.
  api.correspondence = correspondence;
  api.paths = Object.freeze({
    arc({ axis = [0, 1, 0], height = 1 } = {}) {
      if (!vector(axis, 3) || V.len(axis) < 1e-10 || !Number.isFinite(height))
        throw new RangeError('An arc needs a direction and finite height');
      const a = V.mul(V.norm(axis), height);
      const path = (ctx, out) => {
        for (let k = 0; k < 3; k++) out[k] = a[k];
      };
      contextFreePaths.add(path);
      return path;
    },
    vortex({ axis = [0, 1, 0], radius = 1, turns = 2 } = {}) {
      if (!vector(axis, 3) || V.len(axis) < 1e-10 || !finite(radius, 0, 1000) || !finite(turns, -100, 100))
        throw new RangeError('A vortex needs a direction, radius and bounded turns');
      const n = V.norm(axis),
        a = V.perp(n),
        b = V.cross(n, a);
      return (ctx, out) => {
        const theta = ctx.progress * turns * Math.PI * 2 + ctx.seed * Math.PI * 2;
        for (let k = 0; k < 3; k++) out[k] = (a[k] * Math.cos(theta) + b[k] * Math.sin(theta)) * radius;
      };
    }
  });

  api.bind = (stage, options = {}) => {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError('Materialisation options must be an object');
    if (
      !(stage?.D instanceof Float32Array) ||
      !(stage.base instanceof Float32Array) ||
      typeof stage.touch !== 'function'
    )
      throw new TypeError('Materialisation needs a stage');
    const { D, W } = stage,
      maxFragments = options.maxFragments ?? 50000,
      step = options.step ?? 1 / 120,
      maxSubsteps = options.maxSubsteps ?? 2400,
      maxWork = options.maxWork ?? 20000000;
    if (
      !Number.isInteger(maxFragments) ||
      maxFragments < 1 ||
      maxFragments > 250000 ||
      !finite(step, 1 / 1000, 1 / 30) ||
      !Number.isInteger(maxSubsteps) ||
      maxSubsteps < 1 ||
      maxSubsteps > 60000 ||
      !Number.isInteger(maxWork) ||
      maxWork < 1 ||
      maxWork > 500000000
    )
      throw new RangeError('Invalid materialisation sample or integration budget');
    if ((options.ids === undefined) === (options.selector === undefined))
      throw new RangeError('Choose materialisation IDs or a selector');
    let ids;
    if (options.selector !== undefined) {
      const selector = TargetSelectors.prepare(options.selector),
        index = TargetSelectors.index(W);
      ids = [];
      for (let i = 0; i < stage.N; i++) if (TargetSelectors.matches(selector, index.row(i))) ids.push(i);
    } else if (Array.isArray(options.ids) || ArrayBuffer.isView(options.ids)) ids = Array.from(options.ids);
    if (
      !ids?.length ||
      ids.length > maxFragments ||
      new Set(ids).size !== ids.length ||
      ids.some(i => !Number.isSafeInteger(i) || i < 0 || i >= stage.N)
    )
      throw new RangeError('Materialisation needs distinct source IDs within its fragment budget');
    const n = ids.length,
      indexOf = new Map(ids.map((id, i) => [id, i])),
      seed = options.seed ?? 17,
      originTime = options.time ?? stage.time ?? 0,
      maxEvents = options.maxEvents ?? 256,
      maxMappings = options.maxMappings ?? 8;
    const seeds = Float64Array.from(ids, id => K.hash(id, seed, 1));
    const width = options.width ?? 0.015,
      length = options.length ?? 0.045,
      peel = options.peel ?? 0.22,
      drag = options.drag ?? 3,
      gravity = options.gravity ?? [0, 0, 0];
    const flow = options.flow,
      forces = options.forces ?? [],
      paths = options.paths ?? [],
      appearance = options.appearance ?? [];
    const flowContext = flow && !K.flow.contextFree(flow);
    if (
      !Number.isSafeInteger(seed) ||
      !finite(originTime, -1e9, 1e9) ||
      !Number.isInteger(maxMappings) ||
      maxMappings < 1 ||
      maxMappings > 64 ||
      !Number.isInteger(maxEvents) ||
      maxEvents < 1 ||
      maxEvents > 100000 ||
      !finite(width, 1e-5, 10) ||
      !finite(length, width, 10) ||
      !finite(peel, step, 60) ||
      !finite(drag, 0, 1000) ||
      !vector(gravity, 3) ||
      (flow !== undefined &&
        typeof flow !== 'function' &&
        typeof flow?.xyz !== 'function' &&
        typeof flow?.sample !== 'function') ||
      ![forces, paths, appearance].every(
        a => Array.isArray(a) && a.length <= 64 && a.every(f => typeof f === 'function')
      ) ||
      (options.visible !== undefined && typeof options.visible !== 'boolean') ||
      (options.emissive !== undefined && typeof options.emissive !== 'boolean')
    )
      throw new RangeError('Invalid materialisation flow, operators or fragment appearance');
    const pathContext = paths.some(path => !contextFreePaths.has(path));
    const home = options.source ?? api.anchors.splats(stage, ids);
    if (!api.anchors.is(home) || home.count !== n) throw new RangeError('Source anchors must match the carrier count');
    const targets = new Map([['home', home]]);
    for (const [name, provider] of Object.entries(options.targets ?? {})) {
      if (!name || name === 'home' || name.length > 240 || !api.anchors.is(provider))
        throw new RangeError('Targets need distinct names and surface anchors');
      targets.set(name, provider);
    }
    const signature = JSON.stringify([
      options.id ?? '',
      ids,
      seed,
      originTime,
      maxMappings,
      step,
      width,
      length,
      peel,
      drag,
      gravity,
      options.emissive,
      options.visible,
      [...targets].map(([name, p]) => [name, p.count])
    ]);
    if (targets.size > 65 || [...targets.values()].reduce((sum, p) => sum + p.count, 0) > 500000)
      throw new RangeError('Materialisation anchor budget exceeded');
    const ownership = K.geometryOwnership(stage),
      owner = {},
      original = new Float32Array(n * 16),
      free = new Uint8Array(n),
      originalNormals = new Map();
    ids.forEach((id, i) => {
      original.set(D.subarray(id * 16, id * 16 + 16), i * 16);
      free[i] = stage.rig?.free?.[id] ?? 0;
      for (const [key, array, stride, offset] of [
        ['pix', W.pix, 8, 3],
        ['surface', W.surfaceData, 8, 1],
        ['metadata', W.renderMetadata?.normals, 3, 0]
      ])
        if (array) {
          if (!originalNormals.has(key))
            originalNormals.set(key, { array, stride, offset, values: new Float32Array(n * 3) });
          const record = originalNormals.get(key);
          for (let a = 0; a < 3; a++) record.values[i * 3 + a] = array[id * stride + offset + a];
        }
    });
    const state = Array.from({ length: n }, (_, i) => ({
      mode: HOME,
      target: 'home',
      links: [[i, 1]],
      at: 0,
      duration: 1,
      fadeAt: Infinity,
      fadeDuration: 1,
      velocity: [0, 0, 0],
      free: [0, 0, 0],
      position: [0, 0, 0],
      displayVelocity: [0, 0, 0],
      start: api.sample(),
      display: api.sample(),
      kick: [0, 0, 0],
      normalImpulse: 0,
      inherit: 1
    }));
    const cache = new Map(),
      goalCache = new Map(),
      mappings = new Map(),
      homeVelocity = Array.from({ length: n }, () => [0, 0, 0]),
      previousHome = Array.from({ length: n }, () => [0, 0, 0]);
    let ticks = 0,
      elapsed = 0,
      accumulator = 0,
      lastAnchorTime = null,
      disposed = false,
      program = [],
      period = 0,
      programIndex = 0,
      programCycle = 0,
      executingTimeline = false;
    const events = [],
      scratch = [0, 0, 0],
      force = [0, 0, 0],
      flightCov = [0, 0, 0, 0, 0, 0],
      weightedGoal = api.sample(),
      context = {};
    function alive() {
      if (disposed) throw new Error('Materialisation binding is disposed');
    }
    const time = () => ticks * step;
    const worldTime = (local = elapsed) => originTime + local;
    function emit(type, selected, extra = {}) {
      if (events.length === maxEvents) events.shift();
      events.push({ type, time: time(), worldTime: worldTime(time()), ids: selected.map(i => ids[i]), ...extra });
    }
    function refreshTarget(name, t) {
      const provider = targets.get(name);
      provider.begin(worldTime(t));
      let samples = cache.get(name);
      if (!samples) {
        samples = Array.from({ length: provider.count }, () => api.sample());
        cache.set(name, samples);
        goalCache.set(name, {
          revision: 0,
          views: samples.map(row => ({
            position: row.position,
            covariance: row.covariance,
            normal: [0, 1, 0],
            velocity: null,
            revision: -1
          }))
        });
      }
      for (let i = 0; i < samples.length; i++) provider.sample(i, worldTime(t), samples[i]);
      const goals = goalCache.get(name);
      if (goals) goals.revision++;
    }
    function refreshAnchors(t) {
      const wanted = new Set(['home']);
      for (const s of state) {
        if (s.mode === GATHER || s.mode === SETTLED) wanted.add(s.target);
        if (s.pending) wanted.add(s.pending.target);
      }
      for (const name of wanted) refreshTarget(name, t);
      const dt = lastAnchorTime === null ? 0 : t - lastAnchorTime,
        samples = cache.get('home');
      for (let i = 0; i < n; i++)
        for (let a = 0; a < 3; a++) {
          const velocity = samples[i].velocity;
          if (velocity) homeVelocity[i][a] = velocity[a];
          else if (dt > 1e-10) homeVelocity[i][a] = (samples[i].position[a] - previousHome[i][a]) / dt;
          previousHome[i][a] = samples[i].position[a];
        }
      lastAnchorTime = t;
    }
    function cloneSample(out, row) {
      for (let a = 0; a < 3; a++) {
        out.position[a] = row.position[a];
        out.normal[a] = row.normal[a];
      }
      for (let a = 0; a < 6; a++) out.covariance[a] = row.covariance[a];
      out.color = row.color;
      out.alpha = row.alpha;
      return out;
    }
    function targetSample(s, out = weightedGoal) {
      const samples = cache.get(s.target);
      if (s.links.length === 1 && s.links[0][1] === 1) {
        let goals = goalCache.get(s.target);
        if (!goals) {
          goals = { revision: 0, views: new Array(samples.length) };
          goalCache.set(s.target, goals);
        }
        const index = s.links[0][0],
          row = samples[index];
        let view = goals.views[index];
        if (!view)
          view = goals.views[index] = {
            position: row.position,
            covariance: row.covariance,
            normal: [0, 1, 0],
            velocity: null,
            revision: -1
          };
        if (view.revision !== goals.revision) {
          const length = Math.hypot(row.normal[0], row.normal[1], row.normal[2]);
          for (let a = 0; a < 3; a++) view.normal[a] = length > 1e-9 ? row.normal[a] / length : a === 1 ? 1 : 0;
          view.position = row.position;
          view.covariance = row.covariance;
          view.color = row.color;
          view.alpha = row.alpha;
          view.revision = goals.revision;
        }
        return view;
      }
      out.position.fill(0);
      out.normal.fill(0);
      out.covariance.fill(0);
      let r = 0,
        g = 0,
        b = 0,
        alpha = 0;
      for (const [i, w] of s.links) {
        const row = samples[i];
        for (let a = 0; a < 3; a++) {
          out.position[a] += row.position[a] * w;
          out.normal[a] += row.normal[a] * w;
        }
        for (let a = 0; a < 6; a++) out.covariance[a] += row.covariance[a] * w;
        r += (row.color & 255) * w;
        g += ((row.color >>> 8) & 255) * w;
        b += ((row.color >>> 16) & 255) * w;
        alpha += row.alpha * w;
      }
      const normal = V.norm(out.normal, [0, 1, 0]);
      for (let a = 0; a < 3; a++) out.normal[a] = normal[a];
      out.color = Math.round(r) + (Math.round(g) << 8) + (Math.round(b) << 16);
      out.alpha = alpha;
      return out;
    }
    function select({ ids: selected, mask, fraction = 1 } = {}) {
      if (!finite(fraction, 0, 1) || (mask !== undefined && typeof mask !== 'function'))
        throw new RangeError('Selection needs a unit fraction and optional mask callback');
      const list =
        selected === undefined
          ? Array.from({ length: n }, (_, i) => i)
          : Array.isArray(selected) || ArrayBuffer.isView(selected)
            ? Array.from(selected, i => indexOf.get(i))
            : null;
      if (!list || new Set(list).size !== list.length || list.some(i => i === undefined))
        throw new RangeError('Selection contains unknown or repeated carriers');
      const homeRows = cache.get('home');
      return list.filter(i => {
        const p = state[i].mode === HOME || state[i].mode === WAIT ? homeRows[i].position : state[i].position,
          weight = mask
            ? mask(...p, executingTimeline ? time() : elapsed, { id: ids[i], index: i, seed: seeds[i] })
            : 1;
        if (!finite(weight, 0, 1)) throw new RangeError('A materialisation mask must return a weight in [0,1]');
        return weight > 0 && K.hash(ids[i], seed, 7) < weight * fraction;
      });
    }
    function normals(i, normal, restore = false) {
      const id = ids[i];
      for (const { array, stride, offset, values } of originalNormals.values())
        for (let a = 0; a < 3; a++) array[id * stride + offset + a] = restore ? values[i * 3 + a] : normal[a];
    }
    function activate(i) {
      ownership.activate(owner, ids[i]);
      if (stage.rig?.free) stage.rig.free[ids[i]] = 1;
    }
    function attach(i) {
      const s = state[i],
        id = ids[i],
        row = D.subarray(id * 16, id * 16 + 16);
      home.restore?.(i, row);
      if (!home.restore) {
        row.set(original.subarray(i * 16, i * 16 + 16));
        const p = cache.get('home')[i];
        for (let a = 0; a < 3; a++) row[a] = p.position[a];
        covarianceIndices.forEach((k, a) => {
          row[k] = p.covariance[a];
        });
        row[3] = p.alpha;
        row[7] = p.color;
        row[11] -= Math.round(row[11]) % 16;
        row.fill(0, 12, 16);
      }
      normals(i, null, true);
      if (home.restore) {
        ownership.deactivate(owner, id);
        if (stage.rig?.free) stage.rig.free[id] = free[i];
      } else activate(i);
      s.mode = HOME;
      s.target = 'home';
      s.links = [[i, 1]];
      s.pending = null;
      cloneSample(s.display, cache.get('home')[i]);
      s.position.splice(0, 3, ...s.display.position);
      if (!home.restore) write(i);
      stage.touch(id);
      stage.repaint?.(id);
    }
    function starting(i) {
      const s = state[i];
      if (s.mode === HOME || s.mode === WAIT) {
        cloneSample(s.display, cache.get('home')[i]);
        for (let a = 0; a < 3; a++) {
          s.position[a] = s.display.position[a];
          s.displayVelocity[a] = homeVelocity[i][a];
        }
      }
      cloneSample(s.start, s.display);
      for (let a = 0; a < 3; a++) {
        s.free[a] = s.position[a];
        s.velocity[a] = s.displayVelocity[a];
      }
      activate(i);
      return s;
    }
    function launch(i) {
      const s = state[i],
        homeRow = cache.get('home')[i];
      cloneSample(s.start, homeRow);
      cloneSample(s.display, homeRow);
      for (let a = 0; a < 3; a++) {
        s.free[a] = s.position[a] = homeRow.position[a];
        s.velocity[a] = s.kick[a] + s.normalImpulse * homeRow.normal[a] + s.inherit * homeVelocity[i][a];
        s.displayVelocity[a] = s.velocity[a];
      }
      s.mode = DRIFT;
      s.at = time();
      activate(i);
    }
    function validateSettings(settings, gathering = false) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings))
        throw new TypeError('Materialisation command options must be an object');
      if (
        (settings.velocity !== undefined && !vector(settings.velocity, 3)) ||
        (settings.normalImpulse !== undefined && !finite(settings.normalImpulse, -1000, 1000)) ||
        (settings.inheritVelocity !== undefined && !finite(settings.inheritVelocity, 0, 10)) ||
        (settings.stagger !== undefined && !finite(settings.stagger, 0, 600)) ||
        (settings.fadeAt !== undefined && settings.fadeAt !== Infinity && !finite(settings.fadeAt, 0, 600)) ||
        (settings.fadeDuration !== undefined && !finite(settings.fadeDuration, step, 600)) ||
        (settings.duration !== undefined && !finite(settings.duration, step, 600)) ||
        (settings.fraction !== undefined && !finite(settings.fraction, 0, 1)) ||
        (settings.mask !== undefined && typeof settings.mask !== 'function') ||
        (settings.remap !== undefined && typeof settings.remap !== 'boolean')
      )
        throw new RangeError('Invalid materialisation release or gather duration, selection or motion');
      if (
        settings.ids !== undefined &&
        ((!Array.isArray(settings.ids) && !ArrayBuffer.isView(settings.ids)) ||
          Array.from(settings.ids).some(id => !indexOf.has(id)) ||
          new Set(settings.ids).size !== settings.ids.length)
      )
        throw new RangeError('Unknown or repeated materialisation command IDs');
      if (gathering && settings.mapping !== undefined) {
        const map = settings.mapping;
        if (
          typeof map === 'string'
            ? !['index', 'spatial', 'transport'].includes(map)
            : (!Array.isArray(map) && !ArrayBuffer.isView(map)) ||
              map.length !== n ||
              Array.from(map).some(i => !Number.isInteger(i) || i < 0)
        )
          throw new RangeError('Invalid gather mapping');
      }
    }
    function release(settings = {}) {
      alive();
      validateSettings(settings);
      if (!executingTimeline) refreshAnchors(elapsed);
      const selected = select(settings),
        velocity = settings.velocity ?? [0, 0, 0],
        normalImpulse = settings.normalImpulse ?? 0.35,
        inherit = settings.inheritVelocity ?? 1,
        stagger = settings.stagger ?? 0;
      const fadeAt = settings.fadeAt ?? Infinity,
        fadeDuration = settings.fadeDuration ?? 1;
      if (
        !vector(velocity, 3) ||
        !finite(normalImpulse, -1000, 1000) ||
        !finite(inherit, 0, 10) ||
        !finite(stagger, 0, 600) ||
        !(fadeAt === Infinity || finite(fadeAt, 0, 600)) ||
        !finite(fadeDuration, step, 600)
      )
        throw new RangeError('Invalid fragment release motion, delay or fade');
      for (const i of selected) {
        const s = state[i];
        s.pending = null;
        s.fadeAt = fadeAt;
        s.fadeDuration = fadeDuration;
        if (s.mode === HOME) {
          s.mode = WAIT;
          s.at = time() + Math.ceil((stagger * K.hash(ids[i], seed, 31)) / step) * step;
          s.kick.splice(0, 3, ...velocity);
          s.normalImpulse = normalImpulse;
          s.inherit = inherit;
          if (s.at <= time() + 1e-10) launch(i);
        } else {
          starting(i);
          s.mode = DRIFT;
          s.at = time();
          for (let a = 0; a < 3; a++) s.velocity[a] += velocity[a] + normalImpulse * s.display.normal[a];
        }
      }
      if (selected.length) emit('release', selected);
      render();
      return selected.length;
    }
    function gather(name = 'home', settings = {}) {
      alive();
      validateSettings(settings, true);
      if (!targets.has(name)) throw new RangeError('Unknown materialisation target ' + name);
      if (!executingTimeline) refreshAnchors(elapsed);
      const chosen = select(settings),
        duration = settings.duration ?? 1.4,
        stagger = settings.stagger ?? 0;
      if (!finite(duration, step, 600) || !finite(stagger, 0, 600))
        throw new RangeError('Gathering needs a bounded duration and stagger');
      const selected = chosen.filter(i => {
        if (name !== 'home' || (state[i].mode !== HOME && state[i].mode !== WAIT)) return true;
        state[i].pending = null;
        if (state[i].mode === WAIT) attach(i);
        return false;
      });
      const key = JSON.stringify([name, settings.mapping ?? 'spatial', settings.links ?? 4, settings.transport]);
      let links = mappings.get(key);
      if (!links || settings.remap || typeof settings.transport?.cost === 'function') {
        links =
          name === 'home'
            ? Array.from({ length: n }, (_, i) => [[i, 1]])
            : correspondence(home, targets.get(name), settings, worldTime(executingTimeline ? time() : elapsed));
        if (mappings.size >= maxMappings) mappings.delete(mappings.keys().next().value);
        mappings.set(key, links);
      }
      refreshTarget(name, executingTimeline ? time() : elapsed);
      for (const i of selected) {
        const at = time() + Math.ceil((stagger * K.hash(ids[i], seed, 31)) / step) * step;
        const pending = { target: name, links: links[i], at, duration };
        if (at > time() + 1e-9) state[i].pending = pending;
        else beginGather(i, pending);
      }
      if (selected.length) emit('gather', selected, { target: name });
      render();
      return selected.length;
    }
    function beginGather(i, pending) {
      const s = starting(i);
      s.target = pending.target;
      s.links = pending.links;
      s.mode = GATHER;
      s.at = time();
      s.duration = pending.duration;
      s.fadeAt = Infinity;
      s.pending = null;
    }
    function flowAt(p, t, out) {
      out.fill(0);
      if (!flow) return;
      const result =
        typeof flow === 'function'
          ? flowContext
            ? flow.call(flow, p[0], p[1], p[2], worldTime(t), out, context)
            : flow(p[0], p[1], p[2], worldTime(t), out, context)
          : (flow.xyz ?? flow.sample).call(flow, p[0], p[1], p[2], worldTime(t), out, context);
      if (result !== undefined) {
        if (vector(result, 2)) {
          out[0] = result[0];
          out[1] = 0;
          out[2] = result[1];
        } else if (vector(result, 3)) for (let a = 0; a < 3; a++) out[a] = result[a];
        else throw new RangeError('Flow must return XYZ or XZ velocity');
      }
      if (!vector(out, 3)) throw new RangeError('Flow must produce finite velocity');
    }
    function integrate(s, i, h) {
      const age = Math.max(0, time() - s.at),
        gathering = s.mode === GATHER,
        progress = gathering ? unit(age / s.duration) : unit(age / peel),
        blend = smooth(progress);
      if (flowContext || forces.length) {
        context.id = ids[i];
        context.index = i;
        context.time = worldTime(time());
        context.localTime = time();
        context.age = age;
        context.progress = progress;
        context.airborne = gathering ? 4 * blend * (1 - blend) : blend;
        context.source = cache.get('home')[i];
        context.goal = gathering && forces.length ? targetSample(s) : null;
        context.seed = seeds[i];
        context.mode = MODES[s.mode];
        context.target = s.target;
        context.position = s.position;
        context.velocity = s.displayVelocity;
      }
      flowAt(s.free, time(), scratch);
      force[0] = gravity[0];
      force[1] = gravity[1];
      force[2] = gravity[2];
      for (const field of forces) {
        const out = [0, 0, 0],
          result = field(context, out) ?? out;
        if (!vector(result, 3)) throw new RangeError('Fragment force must be finite XYZ acceleration');
        for (let a = 0; a < 3; a++) force[a] += result[a];
      }
      const gain = Math.exp(-drag * h);
      for (let a = 0; a < 3; a++) {
        const previous = s.velocity[a];
        s.velocity[a] = s.velocity[a] * gain + scratch[a] * (1 - gain) + force[a] * h;
        s.free[a] += (previous + s.velocity[a]) * h * 0.5;
      }
    }
    function simulate(h) {
      const arrived = [];
      for (let i = 0; i < n; i++) {
        const s = state[i];
        if (s.pending && time() + 1e-9 >= s.pending.at) beginGather(i, s.pending);
        if (s.mode === WAIT) {
          if (time() + 1e-9 >= s.at) launch(i);
          else continue;
        }
        if (s.mode === HOME || s.mode === HIDDEN || s.mode === SETTLED) continue;
        if (s.mode === GATHER && time() < s.at - 1e-9) continue;
        integrate(s, i, h);
        if (s.mode === GATHER && time() - s.at >= s.duration - 1e-9) {
          s.mode = SETTLED;
          arrived.push(i);
        }
        if (s.mode === DRIFT && time() - s.at >= s.fadeAt + s.fadeDuration - 1e-9) {
          s.mode = HIDDEN;
          s.display.alpha = 0;
        }
      }
      return arrived;
    }
    function geometry(s, i) {
      const age = Math.max(0, time() - s.at);
      if (s.mode === HOME || s.mode === WAIT) {
        cloneSample(s.display, cache.get('home')[i]);
        for (let a = 0; a < 3; a++) s.position[a] = s.display.position[a];
        return;
      }
      if (s.mode === HIDDEN) {
        s.display.alpha = 0;
        return;
      }
      const gathering = s.mode === GATHER || s.mode === SETTLED;
      const progress = gathering ? (s.mode === SETTLED ? 1 : unit(age / s.duration)) : unit(age / peel),
        blend = smooth(progress);
      const departure = gathering ? 4 * blend * (1 - blend) : blend;
      const speed = Math.hypot(...s.velocity),
        x = speed > 1e-10 ? s.velocity[0] / speed : 1,
        y = speed > 1e-10 ? s.velocity[1] / speed : 0,
        z = speed > 1e-10 ? s.velocity[2] / speed : 0,
        w = width * width,
        d = length * length - w;
      flightCov[0] = w + d * x * x;
      flightCov[1] = d * x * y;
      flightCov[2] = d * x * z;
      flightCov[3] = w + d * y * y;
      flightCov[4] = d * y * z;
      flightCov[5] = w + d * z * z;
      const goal = gathering ? targetSample(s) : null;
      for (let a = 0; a < 3; a++) {
        s.position[a] = gathering ? mix(s.free[a], goal.position[a], blend) : s.free[a];
        s.display.normal[a] = gathering ? mix(s.start.normal[a], goal.normal[a], blend) : s.start.normal[a];
      }
      for (let a = 0; a < 6; a++) {
        const surface = gathering ? mix(s.start.covariance[a], goal.covariance[a], blend) : s.start.covariance[a];
        s.display.covariance[a] = mix(surface, flightCov[a], departure);
      }
      s.display.color = gathering ? packedMix(s.start.color, goal.color, blend) : s.start.color;
      s.display.alpha = gathering
        ? mix(s.start.alpha, goal.alpha, blend)
        : s.start.alpha * (1 - smooth((age - s.fadeAt) / s.fadeDuration));
      if (appearance.length || (gathering && progress > 0 && progress < 1 && pathContext)) {
        context.id = ids[i];
        context.index = i;
        context.time = worldTime(time());
        context.localTime = time();
        context.age = age;
        context.progress = progress;
        context.airborne = departure;
        context.seed = seeds[i];
        context.mode = MODES[s.mode];
        context.target = s.target;
        context.position = s.position;
        context.velocity = s.velocity;
        context.source = cache.get('home')[i];
        context.goal = gathering ? goal : null;
      }
      if (gathering && progress > 0 && progress < 1)
        for (const path of paths) {
          scratch.fill(0);
          const offset = path(context, scratch) ?? scratch;
          if (!vector(offset, 3)) throw new RangeError('Fragment path must produce a finite XYZ offset');
          const window = 16 * blend * blend * (1 - blend) * (1 - blend);
          for (let a = 0; a < 3; a++) s.position[a] += offset[a] * window;
        }
      for (let a = 0; a < 3; a++) s.display.position[a] = s.position[a];
      for (const style of appearance) style(context, s.display);
      if (appearance.length) api.anchors.validate(s.display);
      for (let a = 0; a < 3; a++) s.position[a] = s.display.position[a];
    }
    function write(i) {
      const s = state[i];
      if ((s.mode === HOME || s.mode === WAIT) && home.restore) return;
      // Validate once at the publication boundary, rather than repeating it at
      // every internal tick. Operator-supplied appearances are still validated
      // immediately above, including their covariance and material constraints.
      if (
        !vector(s.display.position, 3) ||
        !s.display.position.every(v => Number.isFinite(Math.fround(v))) ||
        !vector(s.display.normal, 3) ||
        !vector(s.display.covariance, 6) ||
        !s.display.covariance.every(v => Number.isFinite(Math.fround(v))) ||
        !finite(s.display.alpha, 0, 100) ||
        !Number.isInteger(s.display.color) ||
        s.display.color < 0 ||
        s.display.color > 0xffffff
      )
        throw new RangeError('Fragment appearance produced invalid geometry or color');
      const id = ids[i],
        q = id * 16,
        out = s.display;
      for (let a = 0; a < 3; a++) D[q + a] = s.position[a];
      D[q + 3] = out.alpha;
      D[q + 7] = out.color;
      for (let a = 0; a < 6; a++) D[q + covarianceIndices[a]] = out.covariance[a];
      let flags = Math.round(original[i * 16 + 11]);
      flags -= flags % 16;
      flags &= ~512;
      flags |= api.FLAG;
      if (options.emissive === true) flags |= 32;
      if (options.emissive === false) flags &= ~32;
      D[q + 11] = flags;
      D.fill(0, q + 12, q + 16);
      const nl = Math.hypot(...out.normal);
      for (let a = 0; a < 3; a++) scratch[a] = nl > 1e-10 ? out.normal[a] / nl : a === 1 ? 1 : 0;
      normals(i, scratch);
      stage.touch(id);
    }
    function render() {
      for (let i = 0; i < n; i++) {
        geometry(state[i], i);
        write(i);
      }
    }
    function command(event) {
      const settings = event.options ?? {};
      if (event.action === 'release') release(settings);
      else if (event.action === 'gather') gather(event.target, settings);
      else if (event.action === 'rejoin') gather('home', settings);
      else if (event.action === 'dissolve')
        release({ ...settings, fadeAt: settings.fadeAt ?? 0, fadeDuration: settings.duration ?? 1 });
    }
    function scheduled() {
      if (!program.length) return;
      while (programIndex < program.length) {
        const event = program[programIndex],
          due = event.tick + programCycle * period;
        if (due > ticks) return;
        programIndex++;
        executingTimeline = true;
        try {
          command(event);
        } finally {
          executingTimeline = false;
        }
        if (programIndex === program.length && period) {
          programIndex = 0;
          programCycle++;
        }
      }
    }
    function timeline(input, { loop } = {}) {
      alive();
      if (!Array.isArray(input) || input.length > 4096 || (loop !== undefined && !finite(loop, step, 3600)))
        throw new RangeError('A materialisation timeline needs bounded events and period');
      const draft = input
        .map((e, i) => {
          if (
            !finite(e?.at, 0, 3600) ||
            !['release', 'gather', 'rejoin', 'dissolve'].includes(e.action) ||
            (e.action === 'gather' && !targets.has(e.target)) ||
            (loop !== undefined && e.at >= loop)
          )
            throw new RangeError('Invalid materialisation timeline event');
          validateSettings(e.options ?? {}, e.action === 'gather' || e.action === 'rejoin');
          return {
            ...e,
            options: {
              ...e.options,
              ...(e.options?.ids && { ids: Array.from(e.options.ids) }),
              ...(e.options?.velocity && { velocity: Array.from(e.options.velocity) })
            },
            tick: Math.round(e.at / step),
            order: i
          };
        })
        .sort((a, b) => a.tick - b.tick || a.order - b.order);
      program = draft;
      period = loop === undefined ? 0 : Math.max(1, Math.round(loop / step));
      programIndex = 0;
      programCycle = period ? Math.floor(ticks / period) : 0;
      while (programIndex < program.length && program[programIndex].tick + programCycle * period < ticks)
        programIndex++;
      if (programIndex === program.length && period) {
        programIndex = 0;
        programCycle++;
      }
      scheduled();
      return binding;
    }
    function advance(duration, { sampleEveryStep = true } = {}) {
      alive();
      if (!finite(duration, 0, 600) || typeof sampleEveryStep !== 'boolean')
        throw new RangeError('Materialisation advance must be in [0,600] seconds');
      const count = Math.floor((accumulator + duration + 1e-10) / step);
      if (count > maxSubsteps || count * n > maxWork)
        throw new RangeError('Materialisation advance exceeds its fixed-step work budget');
      elapsed += duration;
      accumulator += duration;
      if (!sampleEveryStep) refreshAnchors(elapsed);
      scheduled();
      for (let j = 0; j < count; j++) {
        accumulator -= step;
        ticks++;
        if (sampleEveryStep) refreshAnchors(time());
        scheduled();
        const arrived = simulate(step);
        for (let i = 0; i < n; i++) {
          const s = state[i],
            x = s.position[0],
            y = s.position[1],
            z = s.position[2];
          geometry(s, i);
          if (s.mode !== HOME && s.mode !== WAIT) {
            s.displayVelocity[0] = (s.position[0] - x) / step;
            s.displayVelocity[1] = (s.position[1] - y) / step;
            s.displayVelocity[2] = (s.position[2] - z) / step;
          }
        }
        for (const i of arrived) if (state[i].target === 'home') attach(i);
        if (arrived.length) emit('arrive', arrived);
      }
      if (Math.abs(accumulator) < 1e-10) accumulator = 0;
      if (!count) {
        if (sampleEveryStep) refreshAnchors(elapsed);
        render();
      } else for (let i = 0; i < n; i++) write(i);
      return binding;
    }
    function reset() {
      alive();
      ticks = 0;
      elapsed = 0;
      accumulator = 0;
      lastAnchorTime = null;
      events.length = 0;
      programIndex = 0;
      programCycle = 0;
      refreshAnchors(0);
      for (let i = 0; i < n; i++) {
        attach(i);
        state[i].velocity.fill(0);
        state[i].displayVelocity.fill(0);
        homeVelocity[i].fill(0);
      }
      if (options.visible === false)
        for (let i = 0; i < n; i++) {
          starting(i);
          state[i].mode = HIDDEN;
          state[i].display.alpha = 0;
          write(i);
        }
      emit(
        'reset',
        Array.from({ length: n }, (_, i) => i)
      );
      return binding;
    }
    function snapshot() {
      alive();
      return {
        version: 1,
        signature,
        program: JSON.stringify(program),
        period,
        ticks,
        elapsed,
        accumulator,
        lastAnchorTime,
        programIndex,
        programCycle,
        particles: state.map(s =>
          JSON.parse(JSON.stringify({ ...s, fadeAt: s.fadeAt === Infinity ? null : s.fadeAt }))
        ),
        homeVelocity: homeVelocity.map(v => v.slice()),
        previousHome: previousHome.map(v => v.slice()),
        mappings: [...mappings].map(([key, links]) => [key, links.map(row => row.map(p => p.slice()))]),
        rows: ids.map(id => Array.from(D.subarray(id * 16, id * 16 + 16))),
        events: events.map(e => ({ ...e, ids: e.ids.slice() }))
      };
    }
    function restore(input) {
      alive();
      const snap = JSON.parse(JSON.stringify(input));
      if (
        snap?.version !== 1 ||
        snap.signature !== signature ||
        snap.program !== JSON.stringify(program) ||
        snap.period !== period ||
        !Number.isSafeInteger(snap.programIndex) ||
        snap.programIndex < 0 ||
        snap.programIndex > program.length ||
        !Number.isSafeInteger(snap.programCycle) ||
        snap.programCycle < 0 ||
        (snap.lastAnchorTime !== null && !finite(snap.lastAnchorTime)) ||
        !Array.isArray(snap.events) ||
        snap.events.length > maxEvents ||
        snap.events.some(
          e =>
            typeof e?.type !== 'string' ||
            !finite(e.time) ||
            !Array.isArray(e.ids) ||
            e.ids.some(id => !indexOf.has(id))
        ) ||
        !Number.isSafeInteger(snap.ticks) ||
        snap.ticks < 0 ||
        !finite(snap.elapsed) ||
        !finite(snap.accumulator, 0, step) ||
        !Array.isArray(snap.particles) ||
        snap.particles.length !== n ||
        !Array.isArray(snap.rows) ||
        snap.rows.length !== n ||
        snap.rows.some(r => !vector(r, 16)) ||
        !Array.isArray(snap.homeVelocity) ||
        snap.homeVelocity.length !== n ||
        snap.homeVelocity.some(v => !vector(v, 3)) ||
        !Array.isArray(snap.previousHome) ||
        snap.previousHome.length !== n ||
        snap.previousHome.some(v => !vector(v, 3)) ||
        snap.particles.some(
          s =>
            !Number.isInteger(s.mode) ||
            s.mode < HOME ||
            s.mode > HIDDEN ||
            !targets.has(s.target) ||
            !vector(s.position, 3) ||
            !vector(s.free, 3) ||
            !vector(s.velocity, 3) ||
            !vector(s.displayVelocity, 3) ||
            !vector(s.kick, 3) ||
            !finite(s.at) ||
            !finite(s.duration, step, 600) ||
            !(s.fadeAt === null || finite(s.fadeAt, 0, 600)) ||
            !finite(s.fadeDuration, step, 600) ||
            !finite(s.normalImpulse, -1000, 1000) ||
            !finite(s.inherit, 0, 10) ||
            (s.pending !== null &&
              s.pending !== undefined &&
              (!targets.has(s.pending.target) ||
                !finite(s.pending.at) ||
                !finite(s.pending.duration, step, 600) ||
                !Array.isArray(s.pending.links) ||
                s.pending.links.some(
                  p =>
                    !Array.isArray(p) ||
                    p.length !== 2 ||
                    !Number.isInteger(p[0]) ||
                    p[0] < 0 ||
                    p[0] >= targets.get(s.pending.target).count ||
                    !finite(p[1], 0, 1)
                ))) ||
            !Array.isArray(s.links) ||
            !s.links.length ||
            s.links.length > 16 ||
            s.links.some(
              p =>
                !Array.isArray(p) ||
                p.length !== 2 ||
                !Number.isInteger(p[0]) ||
                p[0] < 0 ||
                p[0] >= targets.get(s.target).count ||
                !finite(p[1], 0, 1)
            ) ||
            Math.abs(s.links.reduce((v, p) => v + p[1], 0) - 1) > 1e-8
        )
      )
        throw new RangeError('Invalid or incompatible materialisation checkpoint');
      if (
        !Array.isArray(snap.mappings) ||
        snap.mappings.length > maxMappings ||
        snap.mappings.some(entry => {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            !Array.isArray(entry[1]) ||
            entry[1].length !== n
          )
            return true;
          let name;
          try {
            name = JSON.parse(entry[0])[0];
          } catch {
            return true;
          }
          return (
            !targets.has(name) ||
            entry[1].some(
              row =>
                !Array.isArray(row) ||
                !row.length ||
                row.length > 16 ||
                row.some(
                  p =>
                    !Array.isArray(p) ||
                    p.length !== 2 ||
                    !Number.isInteger(p[0]) ||
                    p[0] < 0 ||
                    p[0] >= targets.get(name).count ||
                    !finite(p[1], 0, 1)
                ) ||
                Math.abs(row.reduce((v, p) => v + p[1], 0) - 1) > 1e-8
            )
          );
        })
      )
        throw new RangeError('Invalid materialisation correspondence checkpoint');
      // Validate all sample payloads before committing any geometry.
      for (const s of snap.particles)
        for (const key of ['start', 'display']) {
          const provider = api.anchors.custom({ count: 1, sample: () => s[key] });
          provider.sample(0, 0);
        }
      mappings.clear();
      for (const [key, value] of snap.mappings) mappings.set(key, value);
      ticks = snap.ticks;
      elapsed = snap.elapsed;
      accumulator = snap.accumulator;
      programIndex = snap.programIndex;
      programCycle = snap.programCycle;
      refreshAnchors(snap.lastAnchorTime ?? elapsed);
      lastAnchorTime = snap.lastAnchorTime;
      for (let i = 0; i < n; i++) {
        state[i] = snap.particles[i];
        state[i].fadeAt ??= Infinity;
        homeVelocity[i].splice(0, 3, ...snap.homeVelocity[i]);
        previousHome[i].splice(0, 3, ...snap.previousHome[i]);
        D.set(snap.rows[i], ids[i] * 16);
        if ((state[i].mode === HOME || state[i].mode === WAIT) && home.restore) {
          ownership.deactivate(owner, ids[i]);
          if (stage.rig?.free) stage.rig.free[ids[i]] = free[i];
          normals(i, null, true);
        } else {
          activate(i);
          normals(i, V.norm(state[i].display.normal, [0, 1, 0]));
        }
        stage.touch(ids[i]);
      }
      events.splice(0, events.length, ...snap.events);
      return binding;
    }
    const binding = {
      release,
      gather,
      rejoin: settings => gather('home', settings),
      dissolve: settings =>
        release({ ...settings, fadeAt: settings?.fadeAt ?? 0, fadeDuration: settings?.duration ?? 1 }),
      reveal: settings => gather('home', settings),
      timeline,
      advance,
      update(dt) {
        return advance(dt, { sampleEveryStep: false });
      },
      reset,
      snapshot,
      restore,
      paint(id, rgba) {
        const i = indexOf.get(id);
        if (i === undefined || ((state[i].mode === HOME || state[i].mode === WAIT) && home.restore)) return;
        const s = state[i].display;
        rgba[0] = (s.color & 255) / 255;
        rgba[1] = ((s.color >>> 8) & 255) / 255;
        rgba[2] = ((s.color >>> 16) & 255) / 255;
        rgba[3] = s.alpha;
      },
      inspect(id) {
        alive();
        const i = indexOf.get(id);
        if (i === undefined) throw new RangeError('Unknown materialisation carrier');
        const s = state[i];
        return {
          id,
          mode: MODES[s.mode],
          target: s.target,
          position: s.position.slice(),
          velocity: (s.mode === HOME || s.mode === WAIT ? homeVelocity[i] : s.displayVelocity).slice(),
          anchors: s.links.map(p => p.slice()),
          alpha: s.display.alpha
        };
      },
      drainEvents() {
        alive();
        return events.splice(0);
      },
      dispose() {
        if (disposed) return;
        refreshAnchors(elapsed);
        for (let i = 0; i < n; i++) attach(i);
        ownership.release(owner);
        if (!home.restore)
          for (let i = 0; i < n; i++) {
            D[ids[i] * 16 + 11] &= ~api.FLAG;
            if (stage.rig?.free) stage.rig.free[ids[i]] = free[i];
          }
        disposed = true;
        for (const list of [stage.systems, stage.painters]) {
          const index = list.indexOf(binding);
          if (index >= 0) list.splice(index, 1);
        }
      },
      get stats() {
        const modes = Object.fromEntries(MODES.map(m => [m, 0]));
        for (const s of state) modes[MODES[s.mode]]++;
        return { count: n, ...modes, time: elapsed, worldTime: worldTime(), ticks, pendingEvents: events.length };
      }
    };
    ownership.reserve(owner, ids);
    reset();
    return binding;
  };
  Object.freeze(api);
})(KIT);
