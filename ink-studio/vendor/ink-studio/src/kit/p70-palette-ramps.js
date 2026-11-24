/* Perceptual ramps in OKLab with chroma-preserving gamut adjustment in OKLCh. */
(function (K) {
  const P = K.procedural, TAU = 2 * Math.PI,
    clamp = n => Math.max(0, Math.min(1, n)),
    lerp = (a,b,t) => a + (b - a) * t,
    lab = ColorSpace.toOKLab,
    gamut = ColorSpace.fromOKLab;

  function parse(input) {
    if (Array.isArray(input) && input.length === 3 && input.every(v => Number.isFinite(v) && v >= 0 && v <= 1))
      return input.slice();
    const number = typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? parseInt(input.slice(1), 16) : input;
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffff)
      throw new Error('Palette ramp anchors need normalized RGB or six-digit hex colors');
    return [number >> 16,(number >> 8) & 255,number & 255].map(v => v / 255);
  }
  const toHex = ([r,g,b]) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  function angle(a, b, mode) {
    const forward = ((b - a) % TAU + TAU) % TAU,
      backward = forward - TAU;
    if (forward < 1e-8) return 0;
    if (mode === 'increasing') return forward;
    if (mode === 'decreasing') return backward;
    if (mode === 'long') return forward >= Math.PI ? forward : backward;
    return forward <= Math.PI ? forward : backward;
  }

  function ramp(input, { steps = 7, space = 'lab', hue = 'short', interpolation = 'linear' } = {}) {
    if (!Array.isArray(input) || input.length < 2 || input.length > 64 ||
      !Number.isSafeInteger(steps) || steps < 2 || steps > 4096 ||
        !['lab','lch'].includes(space) || !['short','long','increasing','decreasing'].includes(hue) ||
        !ColorCurves.modes.includes(interpolation))
      throw new Error('Palette ramps need ordered anchors, steps and a perceptual interpolation mode');
    let previous = -1;
    const stops = input.map((entry, i) => {
      const object = entry && typeof entry === 'object' && !Array.isArray(entry), at = object ? entry.at : i / (input.length - 1),
        color = parse(object ? entry.color : entry);
      if (!Number.isFinite(at) || at < 0 || at > 1 || at <= previous) throw new Error('Palette stops must increase over zero to one');
      previous = at;
      const [L,a,b] = lab(color);
      return { at, color, lab: [L,a,b], lch: [L,Math.hypot(a,b),Math.atan2(b,a)] };
    });
    if (stops[0].at !== 0 || stops.at(-1).at !== 1) throw new Error('Palette ramp stops must include both endpoints');
    function sample(t) {
      if (!Number.isFinite(t)) throw new Error('Palette ramp coordinates must be finite');
      t = clamp(t);
      const high = ColorCurves.segmentIndex(stops, t), b = stops[high];
      if (b.at === t || high === 0) return b.color.slice();
      const a = stops[high - 1];
      if (interpolation === 'step') return a.color.slice();
      const w = ColorCurves.weight(interpolation, (t - a.at) / (b.at - a.at));
      if (space === 'lab') return gamut(a.lab.map((v,i) => lerp(v,b.lab[i],w)));
      const [L1,C1,H1] = a.lch, [L2,C2,H2] = b.lch,
        h1 = C1 < 1e-6 ? H2 : H1, h2 = C2 < 1e-6 ? H1 : H2,
        h = h1 + angle(h1,h2,hue) * w, c = lerp(C1,C2,w);
      return gamut([lerp(L1,L2,w), c * Math.cos(h), c * Math.sin(h)]);
    }
    const colors = Array.from({ length: steps }, (_, i) => sample(i / (steps - 1)));
    return P.data.freeze({ rgb: colors, hex: colors.map(toHex), sample });
  }

  P.materials.perceptual = Object.freeze({ parse, lab, gamut, angle, toHex });
  P.materials.ramp = ramp;
  P.materials.colorCurves = ColorCurves;
})(KIT);
