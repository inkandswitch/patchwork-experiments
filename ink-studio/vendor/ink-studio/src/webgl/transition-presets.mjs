import { defineTransition } from './transition-timeline.mjs';

const BLACK = [0, 0, 0, 1], WHITE = [1, 1, 1, 1];
const pass = (shader, span, from = 'from', to = 'to', extra = {}) => ({ shader, span, from, to, ...extra });
const hold = (source, span) => pass('mix', span, source, source, { start: 0, end: 0 });
const out = (shader, span, extra) => pass(shader, span, 'from', 'cover', extra);
const into = (shader, span, extra) => pass(shader, span, 'cover', 'to', extra);
const close = (shader, span, extra) => pass(shader, span, 'cover', 'from', { start: 1, end: 0, ...extra });
const single = shader => [pass(shader, 1)];
const around = (shader, { target }) => [
  close(shader, 0.43), hold('cover', 0.14), into(shader, 0.43, { anchor: target })
];
const through = shader => [out(shader, 0.42), hold('cover', 0.14), into('mix', 0.44)];
const entry = (id, name, duration, passes, options = {}, cues) => ({ id, name, duration, passes, options, cues });

const groups = {
  'Blackouts and fades': [
    entry('hard-blackout', 'Hard blackout', 0.48, [hold('cover', 0.82), hold('to', 0.18)]),
    entry('fade-out-cut-in', 'Fade out, cut in', 0.75, [out('mix', 0.78), hold('cover', 0.13), hold('to', 0.09)]),
    entry('cut-out-fade-in', 'Cut out, fade in', 0.83, [hold('cover', 0.26), into('mix', 0.74)]),
    entry('stepped-fade', 'Stepped fade', 0.95, [out('stepped', 0.45), hold('cover', 0.1), into('stepped', 0.45)], { steps: 5 }),
    entry('fade-through-white', 'Fade through white', 0.84, through('mix'), { color: WHITE }),
    entry('fade-through-color', 'Fade through a shared color', 1.05, through('mix'), { color: [0.09, 0.16, 0.33, 1] }),
    entry('silhouette-to-black', 'Silhouette to black', 1.05,
      [out('silhouette', 0.81, { mask: 'subject' }), hold('cover', 0.11), hold('to', 0.08)]),
    entry('last-light-out', 'Last light out', 1.18,
      [out('light', 0.83, { mask: 'light' }), hold('cover', 0.1), hold('to', 0.07)], { width: 0.16, anchor: [0.69, 0.35] })
  ],
  'Waking, sleeping, and coming to': [
    entry('first-slit-of-light', 'First slit of light', 1.48,
      [hold('cover', 0.18), into('slit', 0.20, { end: 0.09, easing: 'out' }),
        into('slit', 0.62, { start: 0.09, easing: 'in' })]),
    entry('eyelid-reveal', 'Eyelid reveal', 1.13,
      [hold('cover', 0.15), into('eyelid', 0.85, { easing: 'inOut' })], { strength: 0.68 }),
    entry('sleepy-double-blink', 'Sleepy double blink', 1.68,
      [hold('cover', 0.1), into('eyelid', 0.16, { end: 0.43 }),
        into('eyelid', 0.09, { start: 0.43, end: 0 }), hold('cover', 0.11),
        into('eyelid', 0.54, { easing: 'inOut' })], { strength: 0.64 }),
    entry('squint-into-daylight', 'Squint into daylight', 1.65,
      [hold('cover', 0.1), into('squint', 0.19, { end: 0.36, width: 1 }),
        into('squint', 0.14, { start: 0.36, end: 0.13, width: 1 }),
        into('squint', 0.57, { start: 0.13, width: ({ phase }) => 1 - phase, easing: 'inOut' })], { strength: 0.55 }),
    entry('come-to-in-fragments', 'Come to in fragments', 1.66,
      [hold('cover', 0.14), hold('fragment1', 0.09), hold('cover', 0.2), hold('fragment2', 0.11),
        hold('cover', 0.16), into('mix', 0.16), hold('to', 0.14)]),
    entry('drift-off', 'Drift off', 1.83,
      [close('upperLid', 0.27, { end: 0.52, easing: 'in' }), close('upperLid', 0.12, { start: 0.52, end: 0.79 }),
        close('upperLid', 0.20, { start: 0.79, end: 0.22 }), close('upperLid', 0.12, { start: 0.22, end: 0.4 }),
        close('upperLid', 0.17, { start: 0.4, easing: 'in' }), hold('cover', 0.12)], { strength: 0.75 }),
    entry('faint', 'Faint', 0.99, [close('faint', 0.73, { easing: 'in' }), hold('cover', 0.27)],
      { direction: [-0.35, 1], strength: 0.28 }),
    entry('wake-from-a-dream', 'Wake from a dream', 1.43,
      [close('eyelid', 0.25, { easing: 'in' }), hold('cover', 0.23), into('eyelid', 0.52, { easing: 'out' })],
      { strength: 0.65 }),
    entry('wake-in-darkness', 'Wake in darkness', 2.08,
      [hold('cover', 0.59), into('mix', 0.41, { easing: 'in' })], {},
      ({ cue = 'rain', cueAt = 0, cueDetail }) => [{ at: cueAt, name: cue, detail: cueDetail }])
  ],
  'Irises, wipes, and room changes': [
    entry('character-centered-iris', 'Character-centered iris', 0.88,
      [close('circle', 0.74, { easing: 'in' }), hold('cover', 0.16), hold('to', 0.10)]),
    entry('destination-iris', 'Destination iris', 0.88,
      ({ target }) => [hold('cover', 0.22), into('circle', 0.78, { anchor: target, easing: 'out' })]),
    entry('diamond-iris', 'Diamond iris', 0.88, opts => around('diamond', opts)),
    entry('horizontal-squeeze', 'Horizontal squeeze', 0.66, opts => around('slit', opts)),
    entry('vertical-split', 'Vertical split', 0.69, opts => around('split', opts)),
    entry('side-wipe', 'Side wipe', 0.59, single('wipe')),
    entry('diagonal-wipe', 'Diagonal wipe', 0.65, single('wipe'), { direction: [1, 0.75] }),
    entry('stair-step-wipe', 'Stair-step wipe', 0.71, single('stairs'), { direction: [1, 0.85], bands: 9 }),
    entry('clock-wipe', 'Clock wipe', 0.76, single('clock'), { width: 0 }),
    entry('blind-wipe', 'Blind wipe', 0.74, single('blinds'), { bands: 12 }),
    entry('doorframe-wipe', 'Doorframe wipe', 0.81, [pass('door', 1, 'from', 'to', { mask: 'jamb' })], { width: 0.13, color: [0.13, 0.08, 0.11, 1] }),
    entry('stairwell-blackout', 'Stairwell blackout', 0.94,
      [out('wipe', 0.49), hold('cover', 0.16), into('wipe', 0.35, { direction: [0, 1] })], { direction: [0, -1] })
  ],
  'Tiles, dissolves, and encounter transitions': [
    entry('checkerboard-swap', 'Checkerboard swap', 0.68, single('checker'), { cellSize: 13 }),
    entry('random-block-blackout', 'Random block blackout', 0.60,
      [out('random', 0.75), hold('cover', 0.13), hold('to', 0.12)], { cellSize: 11, steps: 6 }),
    entry('tile-flood', 'Tile flood', 0.72,
      [out('flood', 0.73), hold('cover', 0.13), hold('to', 0.14)], { cellSize: 10 }),
    entry('spiral-blackout', 'Spiral blackout', 0.82,
      [out('spiral', 0.77), hold('cover', 0.12), hold('to', 0.11)], { cellSize: 14 }),
    entry('scanline-build', 'Scanline build', 0.58, single('scan')),
    entry('pixelate-and-rebuild', 'Pixelate and rebuild', 0.87, single('pixel'), { cellSize: 35 }),
    entry('dither-dissolve', 'Dither dissolve', 0.72, single('dither'), { cellSize: 1 }),
    entry('color-by-color-dissolve', 'Color-by-color dissolve', 0.81, single('colors'), { steps: 5 }),
    entry('strip-pull-apart', 'Strip pull-apart', 0.51, single('strips'), { bands: 10 }),
    entry('rush-to-black', 'Rush to black', 0.56,
      [out('rush', 0.69, { easing: 'in' }), hold('cover', 0.17), hold('to', 0.14)], { bands: 45, strength: 0.82 }),
    entry('freeze-flash-swap', 'Freeze, flash, swap', 0.52,
      [hold('from', 0.49), hold('cover', 0.14), hold('to', 0.37)], { color: WHITE },
      () => [{ at: 0, name: 'freeze' }, { at: 0.49, name: 'flash' }, { at: 0.63, name: 'swap' }]),
    entry('threat-centered-blackout', 'Threat-centered blackout', 0.76,
      [out('threat', 0.75, { mask: 'threat' }), hold('cover', 0.12), hold('to', 0.13)],
      { anchor: [0.73, 0.54], width: 0.21 })
  ],
  'Dreams, memories, and jumps in time': [
    entry('bright-memory-wash', 'Bright memory wash', 1.2,
      [out('exposure', 0.43), hold('cover', 0.16), into('mix', 0.41, { easing: 'in' })], { color: WHITE }),
    entry('palette-drift', 'Palette drift', 1.08,
      [pass('palette', 0.73), hold('to', 0.27)], { steps: 6, strength: 0.98, color: [0.63, 0.19, 0.72, 1] }),
    entry('same-room-time-jump', 'Same-room time jump', 1.22, single('mix')),
    entry('alternating-era-bands', 'Alternating-era bands', 0.91, single('era'), { bands: 16 }),
    entry('lingering-afterimage', 'Lingering afterimage', 1.04,
      [hold('from', 0.12), pass('afterimage', 0.88, 'from', 'to', { mask: 'subject', easing: 'out' })],
      { strength: 0.76, width: 0.30 }),
    entry('ripple-into-a-vision', 'Ripple into a vision', 0.92, single('ripple'),
      { direction: [1, 0.32], strength: 0.073, bands: 57, softness: 0.035 }),
    entry('ink-soak', 'Ink soak', 1.22,
      [out('ink', 0.43), hold('cover', 0.15), pass('ink', 0.42, 'to', 'cover', { start: 1, end: 0 })], { cellSize: 2 }),
    entry('black-between-fragments', 'Black between fragments', 1.87,
      [hold('from', 0.13), hold('cover', 0.14), hold('fragment1', 0.13), hold('cover', 0.10),
        hold('fragment2', 0.13), hold('cover', 0.1), hold('to', 0.27)])
  ]
};

const defaults = {
  color: BLACK, anchor: [0.5, 0.5], direction: [1, 0], cellSize: 8, bands: 12, steps: 6,
  strength: 0.65, seed: 27, softness: 0, width: 0.19
};
const controls = {
  color: 'u_color', anchor: 'u_anchor', direction: 'u_direction', cellSize: 'u_cells', bands: 'u_bands',
  steps: 'u_steps', strength: 'u_strength', seed: 'u_seed', softness: 'u_softness', width: 'u_width'
};
const lengths = { color: 4, anchor: 2, direction: 2 };
const ranges = {
  color: [0, 1], anchor: [0, 1], direction: [-1, 1], cellSize: [1, 512], bands: [1, 512],
  steps: [1, 256], strength: [0, 1], seed: [0, 16777215], softness: [0, 0.5], width: [0, 1]
};

function checked(name, value) {
  const [min, max] = ranges[name];
  const values = lengths[name] ? value : [value];
  if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== (lengths[name] ?? 1) ||
      !Array.from(values).every(v => Number.isFinite(v) && v >= min && v <= max))
    throw new RangeError('Invalid transition ' + name + ' (expected values in [' + min + ', ' + max + '])');
  if (name === 'anchor') return [values[0], 1 - values[1]];
  if (name === 'direction') return [values[0], -values[1]];
  return lengths[name] ? Array.from(values) : value;
}

const byId = new Map();
export const transitionPresets = Object.freeze(Object.entries(groups).flatMap(([group, entries]) =>
  entries.map(preset => {
    byId.set(preset.id, preset);
    const options = { ...preset.options };
    for (const name of Object.keys(options)) if (Array.isArray(options[name]))
      options[name] = Object.freeze([...options[name]]);
    const phases = typeof preset.passes === 'function' ? preset.passes({ target: defaults.anchor }) : preset.passes;
    return Object.freeze({
      id: preset.id, name: preset.name, group, duration: preset.duration, defaults: Object.freeze(options),
      spans: Object.freeze(phases.map(stage => stage.span))
    });
  })));

export function createTransition(id, options = {}) {
  const preset = byId.get(id);
  if (!preset) throw new RangeError('Unknown Ink Studio transition ' + id);
  const settings = { ...defaults, ...preset.options, ...options };
  settings.target ??= settings.anchor;
  checked('anchor', settings.target);
  const phases = typeof preset.passes === 'function' ? preset.passes(settings) : preset.passes;
  if (options.timing !== undefined && (!Array.isArray(options.timing) || options.timing.length !== phases.length ||
      !Array.from(options.timing).every(span => Number.isFinite(span) && span > 0)))
    throw new RangeError('Transition timing must contain one positive span for each stage');
  const stages = phases.map((stage, i) => {
    const parameters = Object.entries(controls).map(([name, uniform]) => {
      const value = stage[name] ?? settings[name];
      return [name, uniform, typeof value === 'function' ? value : checked(name, value)];
    });
    return {
      ...stage, span: options.timing?.[i] ?? stage.span, easing: options.easing ?? stage.easing,
      uniforms(frame) {
        return {
          ...Object.fromEntries(parameters.map(([name, uniform, value]) =>
            [uniform, typeof value === 'function' ? checked(name, value(frame)) : value])),
          ...(typeof options.uniforms === 'function' ? options.uniforms(frame) : options.uniforms)
        };
      }
    };
  });
  const cues = options.cues ?? preset.cues?.(options) ?? [];
  const retimedCues = options.timing && !options.cues && id === 'freeze-flash-swap'
    ? cues.map((cue, i) => ({ ...cue, at: stages.slice(0, i).reduce((a, b) => a + b.span, 0) /
        stages.reduce((a, b) => a + b.span, 0) }))
    : cues;
  return defineTransition({ duration: options.duration ?? preset.duration, stages, cues: retimedCues });
}
