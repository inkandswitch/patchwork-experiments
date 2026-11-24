const ease = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  in: t => t * t,
  out: t => t * (2 - t),
  inOut: t => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2
};

export const transitionEasings = Object.freeze(Object.keys(ease));
const clamp = t => Math.max(0, Math.min(1, t));

export function defineTransition({ duration = 1, stages, cues = [] } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(stages) || !stages.length)
    throw new TypeError('A transition requires a positive duration in seconds and at least one stage');
  let total = 0;
  const passes = stages.map(stage => {
    const { span = 1, shader = 'mix', from = 'from', to = 'to', start = 0, end = 1, easing = 'linear',
      mask = 'mask', uniforms = {}, samplers = {} } = stage;
    if (!Number.isFinite(span) || span <= 0 || ![start, end].every(t => Number.isFinite(t) && t >= 0 && t <= 1) ||
        typeof easing !== 'function' && !Object.hasOwn(ease, easing) ||
        ![shader, from, to, mask].every(name => typeof name === 'string' && name.length))
      throw new TypeError('A transition stage requires a positive span, source names, an easing, and endpoints in [0, 1]');
    const begin = total;
    total += span;
    return { begin, finish: total, span, shader, from, to, start, end, easing, mask, uniforms, samplers };
  });
  if (!Number.isFinite(total)) throw new RangeError('Transition stage spans exceed the supported range');
  const markers = cues.map(cue => {
    const { at, name, detail } = cue;
    if (!Number.isFinite(at) || at < 0 || at > 1 || typeof name !== 'string' || !name)
      throw new TypeError('A transition cue requires a name and a normalized time in [0, 1]');
    return Object.freeze({ name, detail, at, time: at * duration });
  }).sort((a, b) => a.at - b.at);
  Object.freeze(markers);

  return Object.freeze({
    duration,
    cues: markers,
    sample(time) {
      if (!Number.isFinite(time)) throw new TypeError('Transition time must be finite');
      const progress = clamp(time / duration), position = progress * total;
      const pass = passes.find(stage => position < stage.finish) ?? passes.at(-1);
      const phase = progress === 1 ? 1 : clamp((position - pass.begin) / pass.span);
      const curve = typeof pass.easing === 'function' ? pass.easing : ease[pass.easing];
      const eased = curve(phase);
      if (!Number.isFinite(eased)) throw new TypeError('Transition easing must return a finite number');
      return {
        shader: pass.shader, from: pass.from, to: pass.to, mask: pass.mask, samplers: pass.samplers,
        progress, phase, time: progress * duration, value: pass.start + (pass.end - pass.start) * clamp(eased),
        uniforms: typeof pass.uniforms === 'function' ? pass.uniforms({ progress, phase, time: progress * duration }) : pass.uniforms
      };
    }
  });
}

export function createTransitionPlayback(transition, { onCue } = {}) {
  let last = -Infinity;
  return {
    update(time) {
      const frame = transition.sample(time);
      if (frame.time >= last) for (const cue of transition.cues)
        if (cue.time > last && cue.time <= frame.time) onCue?.(cue);
      last = frame.time;
      return frame;
    },
    seek(time) {
      const frame = transition.sample(time);
      last = frame.time;
      return frame;
    },
    reset() { last = -Infinity; }
  };
}
