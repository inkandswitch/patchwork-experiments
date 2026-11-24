/* Paint recipes are evaluated on edits; the garden renders a baked shade palette. */
function paintAtelier(kit) {
  const K = kit.KIT,
    P = K.paint,
    garden = paletteGarden(kit),
    world = garden.world;
  const book = P.book({
    blue: { preset: 'blue' },
    yellow: { preset: 'yellow' },
    red: { preset: 'red' },
    white: { preset: 'white' },
    black: { preset: 'black' }
  });
  const controls = { blue: 0.5, yellow: 0.5, red: 0, tint: 0, shade: 0, mode: 'pigment' },
    saved = [];
  let binding,
    current,
    physical,
    ramp,
    buildMs = 0;
  const blend = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t),
    color = paint => paint.rgb;
  const weights = () => {
    const total = controls.blue + controls.yellow + controls.red;
    return total > 0 ? [controls.blue / total, controls.yellow / total, controls.red / total] : [0.5, 0.5, 0];
  };
  const rgbMix = () => {
    const w = weights();
    return [0, 1, 2].map(c => w.reduce((s, v, i) => s + v * book.get(['blue', 'yellow', 'red'][i]).rgb[c], 0));
  };
  function physicalRamp(paint, steps) {
    return P.bakeRamp(
      P.gradient({
        stops: [
          { at: 0, paint: P.shade(paint, 0.75) },
          { at: 0.52, paint },
          { at: 1, paint: P.tint(paint, 0.88) }
        ]
      }),
      { steps }
    ).rgb;
  }
  function rgbRamp(rgb, steps) {
    const dark = blend(rgb, book.get('black').rgb, 0.75),
      light = blend(rgb, book.get('white').rgb, 0.88);
    return Array.from({ length: steps }, (_, i) => {
      const t = i / (steps - 1);
      return t <= 0.52 ? blend(dark, rgb, t / 0.52) : blend(rgb, light, (t - 0.52) / 0.48);
    });
  }
  function rebuild(override) {
    const start = performance.now(),
      w = weights();
    physical = override ?? P.mix(['blue', 'yellow', 'red'].map((n, i) => ({ paint: book.get(n), weight: w[i] })));
    physical = P.shade(P.tint(physical, controls.tint), controls.shade);
    current =
      controls.mode === 'pigment'
        ? physical.rgb
        : blend(blend(rgbMix(), book.get('white').rgb, controls.tint), book.get('black').rgb, controls.shade);
    const colors = controls.mode === 'pigment' ? physicalRamp(physical, 7) : rgbRamp(current, 7);
    ramp = colors;
    const yellow = book.get('yellow'),
      blue = book.get('blue'),
      red = book.get('red');
    const role = (paint, steps) => ({
      path: { colors: controls.mode === 'pigment' ? physicalRamp(paint, steps) : rgbRamp(paint.rgb, steps) },
      steps
    });
    const recipe = K.palette.recipe({
      anchors: { paint: current },
      background: '#09171a',
      roles: {
        stone: { path: { colors }, steps: 7 },
        foliage: role(
          P.mix([
            { paint: physical, weight: 0.85 },
            { paint: yellow, weight: 0.15 }
          ]),
          7
        ),
        bark: role(P.shade(red, 0.48), 5),
        metal: role(
          P.mix([
            { paint: yellow, weight: 0.92 },
            { paint: red, weight: 0.08 }
          ]),
          5
        ),
        glow: role(P.tint(yellow, 0.6), 4),
        water: role(
          P.mix([
            { paint: blue, weight: 0.8 },
            { paint: physical, weight: 0.2 }
          ]),
          4
        )
      }
    });
    binding = K.palette.bind(world, recipe, {
      roles: Object.fromEntries(Object.keys(world.paletteRoles).map(n => [n, n]))
    });
    buildMs = performance.now() - start;
  }
  const blueYellow = P.gradient({
      stops: [
        { at: 0, paint: book.get('blue') },
        { at: 1, paint: book.get('yellow') }
      ]
    }),
    gradient = P.bakeRamp(blueYellow, { steps: 257 });
  const table = P.bakeTable({ paints: [book.get('blue'), book.get('yellow'), book.get('red')], size: 17 });
  rebuild();
  return {
    world,
    book,
    controls,
    saved,
    gradient,
    table,
    rebuild,
    get rgb() {
      return current;
    },
    get paint() {
      return physical;
    },
    get ramp() {
      return ramp;
    },
    get buildMs() {
      return buildMs;
    },
    update: () => binding.world,
    save() {
      saved.push(controls.mode === 'pigment' ? physical : P.swatch({ name: 'RGB comparison swatch', color: current }));
      return saved.length - 1;
    },
    load(i) {
      controls.tint = controls.shade = 0;
      rebuild(saved[i]);
    },
    snapshot: () => Object.fromEntries(saved.map((paint, i) => ['mix-' + (i + 1), paint.snapshot()]))
  };
}
if (typeof module !== 'undefined') module.exports = paintAtelier;
