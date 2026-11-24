/* Bind authored palette bands or ramps to a physical scalar. */
const AtmospherePalette = (() => {
  const bands = typeof FieldBands === 'undefined' ? require('./field-bands.js') : FieldBands;
  const fields = typeof PaletteFields === 'undefined' ? require('./palette-fields.js') : PaletteFields;
  const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const clamp = n => Math.max(0, Math.min(1, n));

  function swatch(value) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value))
      return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
    if (Array.isArray(value) && value.length === 3 && Array.from(value).every(unit)) return value.slice();
    throw new TypeError('Atmosphere palette needs hex or normalized RGB swatches');
  }

  const paletteBands = fields.animate(({ settings, palette }, resolveColor) => {
    const bound = bands.bind({ ...settings,
      stops: settings.stops.map((stop,i)=>({ ...stop, color:palette[i] })) }, resolveColor);
    const stops = settings.stops.map(({ at }, i) => ({ at, rgb: bound.palette[i] }));
    if (settings.edge) {
      const { width } = settings.edge, first = stops[0];
      stops.unshift({ at: first.at, rgb: bound.palette.at(-1) });
      stops[1] = { ...first, at: first.at + width };
    }
    return { sampleUnit:t=>bound.sample(t)?.rgb, stops };
  }, 'bands');

  function compile(value, domains, resolveColor = swatch) {
    if (value === undefined || value === false) return null;
    if (!object(value) || Object.keys(value).some(key => !['source', 'domain', 'field', 'strength'].includes(key)))
      throw new TypeError('Atmosphere palette needs source, domain, field and optional strength');
    const { source = Object.keys(domains)[0], domain = domains[source], field, strength = 1 } = value;
    if (!Object.hasOwn(domains, source)) throw new RangeError('Atmosphere palette source must be ' + Object.keys(domains).join(', '));
    if (!Array.isArray(domain) || domain.length !== 2 || !Array.from(domain).every(Number.isFinite) ||
        !(domain[1] > domain[0]) || !Number.isFinite(domain[1] - domain[0]) || !object(field) || !unit(strength))
      throw new RangeError('Atmosphere palette needs an increasing finite domain, a field and strength in [0, 1]');
    const [low, high] = domain, span = high - low;
    let program;
    if (field.type === 'bands') {
      const { type, animation, ...definition } = field;
      const settings = bands.settings(definition);
      program = paletteBands({ settings, palette:settings.stops.map(stop=>stop.color), animation }, resolveColor);
    } else program = fields.ramp(field, resolveColor);

    function bound(current) {
      const color = [0,0,0];
      const { stops, sampleUnit = t => current.sample(t,color) } = current;
      function apply(value, input, out = input, gain = strength) {
        const tint = gain && Number.isFinite(value) ? sampleUnit(clamp((value - low) / span)) : undefined;
        for (let i = 0; i < 3; i++) out[i] = tint ? input[i] + (tint[i] - input[i]) * gain : input[i];
        return out;
      }
      return { source, low, span, strength, stops, sampleUnit, apply };
    }
    return Object.freeze({ ...bound(program), ...(program.frame && { frame:time=>bound(program.frame(time)) }) });
  }

  const volumeDomains = Object.freeze({ depth: [0, 24], altitude: [0, 12] });
  const cloudDomains = Object.freeze({ altitude: [0, 12], density: [0, 1], light: [0, 1] });
  const lightDomains = Object.freeze({ intensity: [0, 1] });
  const skyDomains = Object.freeze({ elevation: [0, Math.PI / 2], azimuth: [0, 2 * Math.PI], sunlight: [0, 1] });

  return Object.freeze({ compile, volumeDomains, cloudDomains, lightDomains, skyDomains });
})();
if (typeof module !== 'undefined') module.exports = AtmospherePalette;
