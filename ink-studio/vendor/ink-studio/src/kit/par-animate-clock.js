/* Reusable graph clocks, authored channels and deterministic raster frame selection. */
(function (K) {
  const P = K.procedural, S = P.rasterSimSupport;
  const A = P.animationGraph = {};
  const { int, range, clamp, wrap, record, vector } = S;

  function clock(time, { range: span = [0, 1], rate = 1, delay = 0, reverse = false, mode = 'hold' } = {}) {
    if (!Number.isFinite(time) || !vector(span, 2) || span[1] <= span[0] || !range(rate, 1e-5, 1e5) ||
        !range(delay, -1e6, 1e6) || typeof reverse !== 'boolean' || !['hold', 'loop', 'pingpong'].includes(mode))
      throw new RangeError('Invalid animation clock range, delay, rate or playback');
    const duration = span[1] - span[0], elapsed = Math.max(0, time - delay) * rate;
    if (!Number.isFinite(elapsed)) throw new RangeError('Animation clock overflows its playback range');
    let amount = Math.min(elapsed, duration), direction = 1;
    if (mode === 'loop') amount = wrap(elapsed, duration);
    if (mode === 'pingpong') {
      amount = wrap(elapsed, duration * 2);
      if (amount >= duration) { amount = duration * 2 - amount; direction = -1; }
    }
    if (reverse) { amount = duration - amount; direction *= -1; }
    return { value: span[0] + amount, progress: amount / duration, direction,
      active: time >= delay && (mode !== 'hold' || elapsed <= duration) };
  }

  function stagger(time, { count, interval = .1, offset = 0, reverseOrder = false, ...timing } = {}) {
    if (!int(count, 0, 8192) || !range(interval, 0, 1200) || !range(offset, 0, 1e6) || typeof reverseOrder !== 'boolean')
      throw new RangeError('Invalid animation stagger count, interval or order');
    const clocks = Array.from({ length: count }, (_, i) =>
      clock(time, { ...timing, delay: offset + (timing.delay ?? 0) + (reverseOrder ? count - i - 1 : i) * interval }));
    return { value: clocks.map(entry => entry.value), clocks };
  }

  function track(schema, keys) {
    if (!record(schema) || !int(Object.keys(schema).length, 1, 64) ||
        !Array.isArray(keys) || !int(keys.length, 1, 8192)) throw new RangeError('Expected named channels and a bounded key array');
    return K.anim.keyframeTrack.create(schema, keys);
  }

  function frameIndex(length, time, { fps = 12, mode = 'hold', first = 0, end = length, ...timing } = {}) {
    if (!int(length, 1, 8192) || !range(fps, .01, 1000) || !int(first, 0, length - 1) || !int(end, first + 1, length))
      throw new RangeError('Invalid raster frame range or rate');
    const sampled = clock(time, { ...timing, range: [0, (end - first) / fps], mode });
    const frame = sampled.direction < 0 ? Math.ceil(sampled.value * fps - 1e-8) - 1 : Math.floor(sampled.value * fps + 1e-8);
    return { index: clamp(first + frame, first, end - 1), time: sampled.value };
  }

  const options = { type: 'record', default: {} };
  function groupOp(spec, groups) {
    const group = Object.hasOwn(groups, spec.group) && groups[spec.group];
    if (!group?.instantiate || Object.hasOwn(group.inputs, 'timing'))
      throw new TypeError('anim.retime needs a reusable group without an input named timing');
    return { inputs: { ...group.inputs, timing: options }, outputs: group.outputs, time: true,
      instantiate() {
        const evaluate = group.instantiate();
        const run = ({ timing, ...inputs }, ctx) => evaluate(inputs, { ...ctx, time: clock(timing.time ?? ctx.time, timing).value });
        run.clear = () => evaluate.clear?.();
        run.inspect = () => evaluate.inspect?.();
        return run;
      }
    };
  }

  Object.assign(A, { clock, stagger, track, frameIndex, operations: {
    'anim.clock': {
      inputs: { options }, outputs: { value: 'number', progress: 'number', direction: 'number', active: 'boolean' }, time: true,
      run({ options }, { time }) { return clock(options.time ?? time, options); }
    },
    'anim.stagger': {
      inputs: { count: 'number', options }, outputs: { value: 'array<number>', clocks: 'array<record>' }, time: true,
      run({ count, options }, { time }) { return stagger(options.time ?? time, { ...options, count }); }
    },
    'anim.keyframes': {
      inputs: { channels: 'record', keys: 'array<record>', options }, outputs: { value: 'record', duration: 'number' }, time: true,
      instantiate() {
        let compiled, priorKeys, priorChannels;
        return ({ channels, keys, options }, { time }) => {
          if (keys !== priorKeys || channels !== priorChannels) {
            compiled = track(channels, keys);
            priorKeys = keys;
            priorChannels = channels;
          }
          return { value: compiled.sample(options.time ?? time), duration: compiled.duration };
        };
      }
    },
    'anim.frame': {
      inputs: { frames: 'array<raster>', options }, outputs: { value: 'raster', index: 'number', time: 'number' }, time: true,
      run({ frames, options }, { time }) {
        const sample = frameIndex(frames.length, options.time ?? time, options);
        return { index: sample.index, time: sample.time, value: frames[sample.index] };
      }
    },
    'anim.retime': { specialize: groupOp }
  } });
})(KIT);
