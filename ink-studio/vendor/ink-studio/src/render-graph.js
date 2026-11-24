/* Ordered screen-space passes and named image and mask dependencies. */
const RenderGraph = (() => {
  let stacks, luts, targets, compositor, effects;
  try {
    stacks = ColorStack;
    luts = ColorLUT;
    targets = TargetSelectors;
    compositor = FrameComposite;
    effects = RenderEffects;
  } catch {
    stacks = require('./color-stack.js');
    luts = require('./color-lut.js');
    targets = require('./target-selectors.js');
    compositor = require('./frame-composite.js');
    effects = require('./render-effects.js');
  }
  const operations = Object.freeze({
    mask: 1,
    grade: 2,
    reflection: 3,
    distortion: 4,
    composite: 5,
    history: 6,
    feedback: 7,
    bloom: 8,
    halation: 9,
    outline: 10,
    chromatic: 11,
    blocks: 12,
    pixelSort: 13
  });
  const fields = {
    mask: ['rect', 'feather', 'invert', 'volume'],
    grade: ['stack', 'cubeSize'],
    reflection: ['source', 'axis', 'line'],
    distortion: ['source', 'offset', 'amplitude', 'period', 'rate', 'phase', 'rows', 'depthThreshold', 'blend', 'wrap'],
    composite: ['source', 'layer', 'blend', 'isolated'],
    history: ['mode', 'halfLife', 'cameraMotion'],
    ...Object.fromEntries(
      effects.types.map(type => [type, [...effects.fields[type], 'maskMode', 'depthThreshold', 'protectObjects']])
    ),
    feedback: [
      'displayMask',
      'source',
      'layer',
      'halfLife',
      'cameraMotion',
      'gain',
      'threshold',
      'filter',
      'blend',
      'warp'
    ]
  };
  const editorSnapshot = Symbol.for('ink-studio.renderGraph.snapshot');
  const compiled = new WeakMap(),
    cubes = new WeakMap();
  const maxHistoryPasses = 4,
    maxHistoryPixels = 8388608;
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const tuple = (value, len) =>
    Array.isArray(value) && value.length === len && Array.from(value).every(Number.isFinite);
  const clamp = x => Math.min(1, Math.max(0, x));
  const byte = x => Math.round(x * 255);

  function record(value, keys, name) {
    if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid ' + name);
  }
  function finite(value, field) {
    if (!Number.isFinite(value)) throw new RangeError(field + ' must be finite');
    return value;
  }

  const identityRow = [0, 0, 1, 1, 0, 0, 0, 0];
  function rowValues(row, keys) {
    record(row, keys, 'distortion row');
    const { offset = [0, 0], scale = [1, 1], tint = [0, 0, 0] } = row;
    if (
      !tuple(offset, 2) ||
      !tuple(scale, 2) ||
      !tuple(tint, 3) ||
      [...offset, ...scale].some(n => !Number.isFinite(Math.fround(n))) ||
      tint.some(n => n < -255 || n > 255)
    )
      throw new RangeError('A distortion row needs finite XY offset and scale and RGB tint in [-255, 255]');
    return [...offset, ...scale, ...tint, 0];
  }

  function prepareRows(rows) {
    if (rows === undefined || typeof rows === 'function') return rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 4096)
      throw new TypeError('Distortion rows need a sampler or 1 to 4096 row keys');
    let previous = -1;
    return Array.from(rows, row => {
      const values = rowValues(row, ['at', 'offset', 'scale', 'tint']);
      const { at } = row;
      if (!Number.isFinite(at) || at < 0 || at > 1 || at <= previous)
        throw new RangeError('Distortion row keys need strictly increasing positions in [0, 1]');
      previous = at;
      return { at, values };
    });
  }

  function rowTable(rows, width, height, time) {
    if (!rows) return;
    const table = new Float32Array(height * 8),
      dynamic = typeof rows === 'function';
    let left = 0;
    for (let y = 0; y < height; y++) {
      const v = height === 1 ? 0 : y / (height - 1),
        index = y * 8;
      if (dynamic) {
        const row = rows({ y, v, width, height, time });
        table.set(row === undefined ? identityRow : rowValues(row, ['offset', 'scale', 'tint']), index);
      } else {
        while (left + 1 < rows.length && v >= rows[left + 1].at) left++;
        const a = rows[left],
          b = rows[Math.min(left + 1, rows.length - 1)];
        const t = a === b ? 0 : clamp((v - a.at) / (b.at - a.at));
        for (let k = 0; k < 7; k++) table[index + k] = a.values[k] * (1 - t) + b.values[k] * t;
      }
    }
    return table;
  }

  function prepare(value) {
    const readSnapshot = value?.[editorSnapshot];
    if (readSnapshot) value = readSnapshot();
    if (value === undefined || value === false) return null;
    if (compiled.has(value)) return compiled.get(value);
    record(value, ['passes', 'output', 'budget'], 'render graph');
    if (!Array.isArray(value.passes) || value.passes.length > 32)
      throw new RangeError('A render graph needs up to 32 passes');
    const outputs = new Map([['scene', 'image']]),
      nodes = [];
    let current = 'scene';
    function reference(id, type) {
      if (outputs.get(id) !== type) throw new TypeError('Expected an earlier ' + type + ' output: ' + id);
      return id;
    }
    for (const pass of value.passes) {
      if (!Object.hasOwn(fields, pass?.type)) throw new TypeError('Unknown render graph pass: ' + pass?.type);
      const { id, type, enabled = true, opacity = 1 } = pass;
      record(
        pass,
        [
          'id',
          'type',
          'enabled',
          'opacity',
          'select',
          'mask',
          'depth',
          ...(['history', 'feedback', ...effects.types].includes(type) ? ['budget'] : []),
          ...(type === 'mask' ? [] : ['input']),
          ...fields[type]
        ],
        'render graph ' + type + ' pass'
      );
      if (typeof id !== 'string' || !id.trim() || outputs.has(id))
        throw new TypeError('Render graph pass IDs must be distinct and nonempty');
      if (typeof enabled !== 'boolean' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
        throw new RangeError('A pass needs a boolean enabled flag and opacity in [0, 1]');
      const mask = pass.mask === undefined ? undefined : reference(pass.mask, 'mask');
      const select = pass.select === undefined ? undefined : targets.prepare(pass.select);
      const input = type === 'mask' ? undefined : reference(pass.input ?? current, 'image');
      const node = {
        depth: effects.depth(pass.depth),
        ...(pass.budget !== undefined && { budget: effects.budget(pass.budget) }),
        id,
        type,
        operation: operations[type],
        enabled,
        opacity,
        select,
        mask,
        input
      };
      if (effects.types.includes(type)) Object.assign(node, effects.settings(pass));
      switch (type) {
        case 'mask': {
          const { rect, feather = 0, invert = false, volume } = pass;
          if (
            (rect !== undefined && (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0)) ||
            !Number.isFinite(feather) ||
            feather < 0 ||
            typeof invert !== 'boolean'
          )
            throw new TypeError('A mask needs a positive rectangle, nonnegative feather and boolean invert');
          Object.assign(node, { rect: rect?.slice(), feather, invert });
          if (volume !== undefined) {
            record(volume, ['at', 'extent', 'feather'], 'world reveal volume');
            const { at, extent, feather = 0.25 } = volume;
            if (
              !tuple(at, 3) ||
              !tuple(extent, 3) ||
              extent.some(radius => radius <= 0) ||
              !Number.isFinite(feather) ||
              feather < 0 ||
              feather > 1
            )
              throw new RangeError('A world reveal needs a finite center, positive XYZ radii and a feather in [0, 1]');
            node.volume = { at: at.slice(), extent: extent.slice(), feather };
            node.needsCamera = true;
          }
          break;
        }
        case 'grade': {
          const { stack, cubeSize = 33 } = pass;
          if (!Number.isInteger(cubeSize) || cubeSize < 2 || cubeSize > 65)
            throw new RangeError('Grade cubeSize must be an integer in [2, 65]');
          if (!stacks.prepare(stack)) throw new TypeError('A grade pass needs an RGB color stack');
          Object.assign(node, { stack, cubeSize });
          break;
        }
        case 'reflection': {
          const { axis = 'y', line } = pass;
          if (axis !== 'x' && axis !== 'y') throw new TypeError('Reflection axis must be x or y');
          if (line !== undefined) finite(line, 'Reflection line');
          Object.assign(node, { axis, line, source: reference(pass.source ?? input, 'image') });
          break;
        }
        case 'distortion': {
          const {
            offset = [0, 0],
            amplitude = [0, 0],
            period = 32,
            rate = 0,
            phase = 0,
            rows,
            depthThreshold,
            blend = 'replace',
            wrap = false
          } = pass;
          if (!tuple(offset, 2) || !tuple(amplitude, 2) || !Number.isFinite(period) || period <= 0)
            throw new RangeError('Distortion needs finite XY offset and amplitude and a positive period');
          if (
            !['replace', 'over'].includes(blend) ||
            typeof wrap !== 'boolean' ||
            (depthThreshold !== undefined && (!Number.isFinite(depthThreshold) || depthThreshold < 0))
          )
            throw new RangeError(
              'Distortion needs replace or over blending, boolean wrap and a nonnegative depth threshold'
            );
          Object.assign(node, {
            offset: offset.slice(),
            amplitude: amplitude.slice(),
            period,
            rate: finite(rate, 'Distortion rate'),
            phase: finite(phase, 'Distortion phase'),
            source: reference(pass.source ?? input, 'image'),
            rows: prepareRows(rows),
            depthThreshold,
            blend,
            wrap
          });
          break;
        }
        case 'history': {
          const { mode = 'persistence', halfLife = 0.45, cameraMotion = 'reset' } = pass;
          if (
            !select ||
            !['hold', 'persistence'].includes(mode) ||
            !['reset', 'keep'].includes(cameraMotion) ||
            !Number.isFinite(halfLife) ||
            halfLife <= 0
          )
            throw new TypeError(
              'Screen history needs a target selector, hold or persistence, a positive halfLife and a camera policy'
            );
          Object.assign(node, {
            mode,
            halfLife,
            cameraMotion,
            needsCamera: cameraMotion === 'reset',
            historyKey: JSON.stringify([input, mask, Object.entries(select).sort(), mode, cameraMotion])
          });
          break;
        }
        case 'feedback': {
          const {
            halfLife = 0.55,
            cameraMotion = 'reset',
            gain = 1,
            threshold,
            filter = 'linear',
            blend = 'add',
            warp = {}
          } = pass;
          if (
            !(Number.isFinite(halfLife) && halfLife > 0) ||
            !['reset', 'keep'].includes(cameraMotion) ||
            !Number.isFinite(gain) ||
            gain < 0 ||
            gain > 1 ||
            !['nearest', 'linear'].includes(filter) ||
            !['over', 'add'].includes(blend) ||
            (threshold !== undefined &&
              (!tuple(threshold, 2) || threshold[0] < 0 || threshold[1] > 1 || threshold[0] >= threshold[1]))
          )
            throw new RangeError(
              'Feedback needs a positive halfLife, valid gain, threshold, blend, filter and camera policy'
            );
          if (pass.layer !== undefined && pass.source !== undefined)
            throw new TypeError('Feedback accepts an image source or an emission layer');
          const layer = pass.layer;
          const source = layer === undefined ? reference(pass.source ?? input, 'image') : undefined;
          const needsCamera = layer !== undefined && compositor.settings({ layers: [layer] }).needsCamera;
          if (pass.displayMask !== undefined && typeof pass.displayMask !== 'boolean')
            throw new TypeError('Feedback displayMask must be boolean');
          Object.assign(node, {
            displayMask: pass.displayMask ?? false,
            halfLife,
            cameraMotion,
            gain,
            threshold: threshold?.slice(),
            filter,
            blend,
            layer,
            source,
            warp: feedbackWarp(warp),
            needsCamera: needsCamera || cameraMotion === 'reset',
            historyKey: JSON.stringify([
              type,
              input,
              source,
              mask,
              select && Object.entries(select).sort(),
              cameraMotion
            ])
          });
          break;
        }
        case 'composite': {
          if ((pass.layer === undefined) === (pass.source === undefined))
            throw new TypeError('A composite pass needs a previous image source or one mixed-resolution layer');
          if (pass.isolated !== undefined && typeof pass.isolated !== 'boolean')
            throw new TypeError('Composite isolated must be boolean');
          node.isolated = pass.isolated === true;
          if (pass.layer !== undefined) {
            if (pass.blend !== undefined) throw new TypeError('Set layer blending on the layer');
            node.needsCamera = compositor.settings({ layers: [pass.layer] }).needsCamera;
            node.layer = pass.layer;
          } else {
            const { blend = 'over' } = pass;
            if (blend !== 'over' && blend !== 'add') throw new TypeError('Composite blend must be over or add');
            Object.assign(node, { source: reference(pass.source, 'image'), blend });
          }
          break;
        }
      }
      node.dependencies = [
        ...new Set(
          node.enabled
            ? [node.isolated ? undefined : input, mask, node.source].filter(Boolean)
            : [input].filter(Boolean)
        )
      ];
      outputs.set(id, type === 'mask' ? 'mask' : 'image');
      if (type !== 'mask') current = id;
      nodes.push(node);
    }
    const output = reference(value.output ?? current, 'image'),
      live = new Set([output]);
    for (let i = nodes.length - 1; i >= 0; i--)
      if (live.has(nodes[i].id)) for (const dependency of nodes[i].dependencies) live.add(dependency);
    const passes = nodes.filter(node => live.has(node.id)),
      lastUse = new Map();
    passes.forEach((node, i) => node.dependencies.forEach(id => lastUse.set(id, i)));
    const historyPasses = passes.filter(node => node.enabled && (node.type === 'history' || node.type === 'feedback'));
    if (historyPasses.length > maxHistoryPasses)
      throw new RangeError('A graph supports up to four live screen history passes');
    const plan = {
      passes,
      output,
      lastUse,
      historyPasses,
      budget: graphBudget(value.budget),
      needsDepth: passes.some(node => node.enabled && (node.volume || node.depth || node.depthThreshold !== undefined)),
      needsOwner: passes.some(node => node.enabled && (node.select || node.effect || node.depth)),
      needsCamera: passes.some(node => node.enabled && node.needsCamera)
    };
    if (readSnapshot) compiled.set(value, plan);
    return plan;
  }

  function graphBudget(value = {}) {
    record(value, ['maxTransientPixels', 'maxHistoryPixels', 'maxWork'], 'render graph budget');
    const result = { maxTransientPixels: 67108864, maxHistoryPixels, maxWork: 268435456, ...value };
    for (const [key, number] of Object.entries(result))
      if (!Number.isSafeInteger(number) || number < 1) throw new RangeError('Invalid render graph ' + key);
    return result;
  }

  // Inspectable upper bounds, checked before target allocation. Output images always
  // remain full resolution; only effect packets and retained signals use work grids.
  function resources(plan, w, h) {
    if (!plan || !Array.isArray(plan.passes)) throw new TypeError('Expected a prepared render graph');
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w > 32768 || h > 32768)
      throw new RangeError('Invalid render graph dimensions');
    const full = w * h,
      live = new Map([['scene', 0]]),
      free = [],
      rows = [];
    let peak = full,
      historyPixels = 0,
      allocated = 1,
      scratchPeak = 0,
      work = 0;
    for (const [index, node] of plan.passes.entries()) {
      const budget = node.budget;
      const scale = budget ? Math.min(budget.scale, Math.sqrt(budget.maxPixels / full)) : 1;
      let width = Math.max(1, Math.floor(w * scale)),
        height = Math.max(1, Math.floor(h * scale));
      if (budget && width * height > budget.maxPixels) {
        if (width >= height) width = Math.max(1, Math.floor(budget.maxPixels / height));
        else height = Math.max(1, Math.floor(budget.maxPixels / width));
      }
      const samples =
        node.type === 'outline'
          ? Math.min(8, budget.maxSamples)
          : node.type === 'pixelSort'
            ? Math.min(node.span, budget.maxSamples)
            : (budget?.maxSamples ?? 1);
      const cost =
        !node.enabled && node.type !== 'mask'
          ? 0
          : node.effect
            ? width *
                height *
                (node.type === 'pixelSort'
                  ? samples * samples + 2 * samples
                  : ['bloom', 'halation', 'outline'].includes(node.type)
                    ? samples
                    : 3) +
              full * 5
            : full;
      work += cost;
      if (node.enabled || node.type === 'mask') {
        const buffer = free.length ? free.pop() : allocated++;
        live.set(node.id, buffer);
        scratchPeak = Math.max(scratchPeak, node.effect ? width * height : 0);
        peak = Math.max(peak, allocated * full + scratchPeak);
        if (node.enabled && (node.type === 'history' || node.type === 'feedback')) historyPixels += width * height;
      } else live.set(node.id, live.get(node.input) ?? 0);
      rows.push({
        id: node.id,
        type: node.type,
        width,
        height,
        pixels: width * height,
        samples,
        work: cost,
        enabled: node.enabled
      });
      for (const id of node.dependencies)
        if (plan.lastUse.get(id) === index) {
          const used = live.get(id);
          live.delete(id);
          if (used !== 0 && ![...live.values()].includes(used)) free.push(used);
        }
    }
    const limits = plan.budget ?? graphBudget();
    if (peak > limits.maxTransientPixels) throw new RangeError('Render graph exceeds its transient pixel budget');
    if (historyPixels > limits.maxHistoryPixels) throw new RangeError('Screen history exceeds its pixel budget');
    if (work > limits.maxWork) throw new RangeError('Render graph exceeds its work budget');
    return {
      width: w,
      height: h,
      passes: rows,
      transientPixels: peak,
      transientBytes: peak * 4,
      historyPixels,
      historyBytes: historyPixels * 8,
      work,
      limits
    };
  }

  function ownerGroups(world) {
    const data = new Uint32Array(world.count + 1),
      index = targets.index(world),
      groups = new Map();
    for (let i = 0; i < world.count; i++) {
      const row = index.row(i),
        key = JSON.stringify(
          row.entity != null
            ? ['entity', row.entity]
            : row.object != null
              ? ['object', row.object]
              : row.material != null
                ? ['material', row.material]
                : ['unnamed']
        );
      if (!groups.has(key)) groups.set(key, groups.size + 1);
      data[i + 1] = groups.get(key);
    }
    return data;
  }

  function snapshot(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
    if (plain(value))
      return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
    return value;
  }

  function create(value) {
    let definition;
    function save(value) {
      const next = snapshot(value),
        plan = prepare(next);
      if (!plan) throw new TypeError('An editable render graph needs a definition');
      compiled.set(next, plan);
      definition = next;
    }
    const position = id => {
      const index = definition.passes.findIndex(pass => pass.id === id);
      if (index < 0) throw new RangeError('Unknown render graph pass: ' + id);
      return index;
    };
    function edit(change) {
      const passes = [...definition.passes];
      change(passes);
      save({ ...definition, passes });
    }
    save(value);
    const current = () => definition;
    return Object.freeze({
      [editorSnapshot]: current,
      snapshot: current,
      replace: save,
      update(id, changes) {
        edit(passes => {
          const i = position(id);
          passes[i] = { ...passes[i], ...changes };
        });
      },
      move(id, index) {
        if (!Number.isInteger(index) || index < 0 || index >= definition.passes.length)
          throw new RangeError('Invalid pass position');
        edit(passes => {
          const [pass] = passes.splice(position(id), 1);
          passes.splice(index, 0, pass);
        });
      },
      insert(pass, index = definition.passes.length) {
        if (!Number.isInteger(index) || index < 0 || index > definition.passes.length)
          throw new RangeError('Invalid pass position');
        edit(passes => passes.splice(index, 0, pass));
      },
      remove(id) {
        edit(passes => passes.splice(position(id), 1));
      }
    });
  }

  function cube({ stack, cubeSize: size }) {
    let cache = cubes.get(stack);
    const key = JSON.stringify(stack);
    if (cache?.key !== key) cubes.set(stack, (cache = { key, sizes: new Map() }));
    if (!cache.sizes.has(size)) {
      const transform = stacks.prepare(stack),
        samples = [],
        data = new Uint8Array(size ** 3 * 4),
        rgb = [0, 0, 0];
      for (let b = 0, i = 0; b < size; b++)
        for (let g = 0; g < size; g++)
          for (let r = 0; r < size; r++, i += 4) {
            transform.sample([r / (size - 1), g / (size - 1), b / (size - 1)], rgb);
            for (let c = 0; c < 3; c++) {
              const value = byte(clamp(rgb[c]));
              samples.push(value / 255);
              data[i + c] = value;
            }
            data[i + 3] = 255;
          }
      cache.sizes.set(size, {
        size,
        data,
        sample: luts.prepare(luts.normalize({ size, interpolation: 'trilinear', data: samples }, true)).sample
      });
    }
    return cache.sizes.get(size);
  }

  function selection(world, select) {
    const data = new Uint8Array(world.count + 1),
      index = targets.index(world),
      found = new Map();
    for (let i = 0; i < world.count; i++) {
      const target = index.row(i);
      if (!found.has(target)) found.set(target, targets.matches(select, target) ? 255 : 0);
      data[i + 1] = found.get(target);
    }
    return data;
  }

  function layer(node, w, h, world, time, text, camera, resolve, gl) {
    const plan = compositor.prepare({ layers: [node.layer] }, w, h);
    return compositor.layers(plan, world, time, text, camera, resolve, gl)[0];
  }

  function history({ release = () => {} } = {}) {
    const entries = new Map();
    let previousFrame;
    function drop(id) {
      const entry = entries.get(id);
      entries.delete(id);
      if (entry) release(entry.value);
    }
    function clear() {
      for (const id of entries.keys()) drop(id);
      previousFrame = undefined;
    }
    function begin(plan, { source, w, h, time, camera, reset } = {}) {
      if (!plan?.historyPasses.length) {
        clear();
        return;
      }
      if (!Number.isFinite(time)) throw new RangeError('Screen history needs a finite frame time');
      const layout = resources(plan, w, h);
      const signature = camera && [...camera.view, camera.tangent, camera.aspect, +camera.ortho, ...camera.depthRange];
      const before = previousFrame;
      if (reset || !before || before.source !== source || before.w !== w || before.h !== h || before.time > time)
        clear();
      const still =
        signature && before?.signature && signature.every((value, i) => Math.abs(value - before.signature[i]) < 1e-5);
      const active = new Map(plan.historyPasses.map(node => [node.id, node]));
      const keys = new Map(
        layout.passes.map(row => [row.id, active.get(row.id)?.historyKey + '/' + row.width + '/' + row.height])
      );
      for (const [id, entry] of entries) {
        const node = active.get(id);
        if (!node || keys.get(id) !== entry.key || (node.cameraMotion === 'reset' && !still)) drop(id);
      }
      previousFrame = { source, w, h, time, signature };
      return node => {
        const prior = entries.get(node.id);
        return {
          value: prior?.value,
          capture: !prior || prior.time < time,
          elapsed: prior ? time - prior.time : 0,
          decay: prior ? 2 ** (-(time - prior.time) / node.halfLife) : 0,
          save(value) {
            drop(node.id);
            entries.set(node.id, {
              key: keys.get(node.id),
              time,
              value
            });
          }
        };
      };
    }
    return Object.freeze({ begin, clear });
  }

  function feedbackWarp(value) {
    record(
      value,
      ['velocity', 'rotation', 'zoom', 'wave', 'period', 'rate', 'phase', 'blockSize', 'center'],
      'feedback warp'
    );
    const {
      velocity = [0, 0],
      rotation = 0,
      zoom = 1,
      wave = [0, 0],
      period = 32,
      rate = 0,
      phase = 0,
      blockSize = 0,
      center = [0.5, 0.5]
    } = value;
    if (
      !tuple(velocity, 2) ||
      !tuple(wave, 2) ||
      !tuple(center, 2) ||
      !center.every(n => n >= 0 && n <= 1) ||
      ![...velocity, ...wave, rotation, rate].every(n => Math.abs(n) <= 1e6) ||
      ![rotation, zoom, period, rate, phase, blockSize].every(Number.isFinite) ||
      zoom < 0.01 ||
      zoom > 100 ||
      period < 0.01 ||
      blockSize < 0
    )
      throw new RangeError('Feedback warp needs finite controls, positive zoom and period, and a normalized center');
    return {
      velocity: velocity.slice(),
      rotation,
      zoom,
      wave: wave.slice(),
      period,
      rate,
      phase,
      blockSize,
      center: center.slice()
    };
  }

  function feedbackMotion({ warp }, time, elapsed, w, h) {
    const { rotation, zoom, phase, rate, period, blockSize } = warp;
    const inverse = Math.exp(Math.max(-20, Math.min(20, -Math.log(zoom) * elapsed)));
    const tau = 2 * Math.PI;
    const angle = rotation ? (elapsed % Math.abs(tau / rotation)) * rotation : 0;
    const cycle = rate ? (time % Math.abs(1 / rate)) * rate : 0;
    const theta = tau * (((phase % 1) + cycle) % 1);
    return {
      pivot: [warp.center[0] * w, warp.center[1] * h],
      blockSize,
      transform: [Math.cos(angle) * inverse, Math.sin(angle) * inverse],
      offset: warp.velocity.map(n => n * elapsed),
      wave: warp.wave.map(n => n * elapsed),
      frequency: (2 * Math.PI) / period,
      theta
    };
  }

  // Render every tick from the same origin, including unexported ticks before a trim.
  function replay({ fps = 24, start = 0, maxSteps = 36000, cuts = [] } = {}) {
    if (
      !(Number.isFinite(fps) && fps > 0 && fps <= 240) ||
      !Number.isFinite(start) ||
      !Number.isSafeInteger(maxSteps) ||
      maxSteps < 1 ||
      maxSteps > 1000000
    )
      throw new RangeError('Feedback replay needs a finite start, a rate up to 240 and a positive step budget');
    if (
      !Array.isArray(cuts) ||
      cuts.length > 4096 ||
      !Array.from(cuts).every(cut => Number.isFinite(cut) && cut >= start && (cut - start) * fps <= maxSteps - 1)
    )
      throw new RangeError('Feedback replay cuts need finite times within the replay range');
    const cutTicks = new Set(cuts.map(cut => Math.ceil((cut - start) * fps - 1e-8)));
    let next = 0,
      priorTime,
      value;
    function reset() {
      next = 0;
      priorTime = value = undefined;
    }
    function sample(time, render) {
      if (!Number.isFinite(time) || time < start || typeof render !== 'function')
        throw new RangeError('Feedback replay needs a time at or after start and a render callback');
      const end = Math.floor((time - start) * fps + 1e-8);
      if (!Number.isSafeInteger(end) || end >= maxSteps)
        throw new RangeError('Feedback replay exceeds its step budget');
      if (priorTime !== undefined && time < priorTime) reset();
      priorTime = time;
      while (next <= end) {
        const frame = render(start + next / fps, next === 0 || cutTicks.has(next));
        if (frame?.then) throw new TypeError('Feedback replay requires synchronous rendering');
        value = frame;
        next++;
      }
      return value;
    }
    return Object.freeze({ sample, reset });
  }

  // Depth is the axial camera distance at the center of the native texel.
  function volumeCoverage(volume, camera, u, v, depth) {
    if (!Number.isFinite(depth)) return 0;
    const view = camera.view,
      scale = camera.tangent * (camera.ortho ? 1 : depth);
    const x = (2 * u - 1) * scale * camera.aspect,
      y = (1 - 2 * v) * scale;
    const [a, b, c] = volume.at,
      [rx, ry, rz] = volume.extent,
      eye = camera.eye;
    const distance = Math.hypot(
      (eye[0] + x * view[0] + y * view[1] - depth * view[2] - a) / rx,
      (eye[1] + x * view[4] + y * view[5] - depth * view[6] - b) / ry,
      (eye[2] + x * view[8] + y * view[9] - depth * view[10] - c) / rz
    );
    return volume.feather ? clamp((1 - distance) / volume.feather) : Number(distance <= 1);
  }

  return Object.freeze({
    effects,
    resources,
    ownerGroups,
    prepare,
    create,
    cube,
    selection,
    layer,
    history,
    feedbackMotion,
    replay,
    volumeCoverage,
    rowTable
  });
})();
if (typeof module !== 'undefined') module.exports = RenderGraph;
