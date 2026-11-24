/* Directional and point-light shadow controls shared by the bake and live sun. */
const ShadowArt = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const stride = 6;
  const fields = (value, keys, label) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key)))
      throw new TypeError('Invalid shadow ' + label);
  };
  function ramp(value) {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length < 2 || value.length > 16 ||
        !Array.from(value).every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1 && (i === 0 || v >= value[i - 1])) ||
        value.at(-1) !== 1)
      throw new RangeError('A shadow ramp needs 2 to 16 increasing gains in 0..1 ending at 1');
    return Object.freeze(value.slice());
  }
  function mask(value) {
    if (value === undefined) return;
    fields(value, ['include', 'exclude'], 'target mask');
    function read(list) {
      if (list === undefined) return;
      if (!Array.isArray(list)) throw new TypeError('Shadow include and exclude masks need arrays of selectors');
      return Object.freeze(Array.from(list, rule => {
        const selector = selectors.prepare(rule);
        if ('medium' in selector || 'mediumKind' in selector) throw new TypeError('Shadow masks select solids');
        return selector;
      }));
    }
    const include = read(value.include), exclude = read(value.exclude);
    return Object.freeze({ ...(include && { include }), ...(exclude && { exclude }) });
  }
  const allows = (mask, subject) => !mask ||
    (!mask.include || mask.include.some(rule => selectors.matches(rule, subject))) &&
    !mask.exclude?.some(rule => selectors.matches(rule, subject));
  function prepare(raw) {
    if (raw === undefined || raw === false) return null;
    fields(raw, ['ramp', 'cast', 'receive', 'small'], 'art settings');
    const gain = ramp(raw.ramp), cast = mask(raw.cast), receive = mask(raw.receive);
    let small;
    if (raw.small !== undefined) {
      fields(raw.small, ['belowPixels', 'referenceSize', 'ramp', 'strength'], 'small-size settings');
      const { belowPixels, referenceSize = 1, strength = 1 } = raw.small;
      if (!Number.isFinite(belowPixels) || belowPixels <= 0 || !Number.isFinite(referenceSize) || referenceSize <= 0 ||
          !Number.isFinite(referenceSize / belowPixels) || referenceSize / belowPixels <= 0 ||
          !Number.isFinite(strength) || strength < 0 || strength > 1)
        throw new RangeError('Small shadows need a positive pixel threshold and reference size, and strength in 0..1');
      const band = ramp(raw.small.ramp);
      small = Object.freeze({ belowPixels, referenceSize, strength, ...(band && { ramp: band }) });
    }
    const settings = Object.freeze({ ...(gain && { ramp: gain }), ...(cast && { cast }), ...(receive && { receive }),
      ...(small && { small }) });
    return Object.keys(settings).length ? Object.freeze({ ...settings, settings }) : null;
  }
  function transfer(art, visibility, small = false) {
    if (!art) return visibility;
    const coarse = small && art.small, steps = coarse?.ramp ?? art.ramp;
    const gain = steps ? steps[Math.round(Math.max(0, Math.min(1, visibility)) * (steps.length - 1))] : visibility;
    return coarse ? 1 - (1 - gain) * coarse.strength : gain;
  }
  function bind(art, world, mode) {
    const mask = art?.[mode];
    if (!mask) return;
    const { row } = selectors.index(world), cache = new WeakMap();
    return i => {
      const target = row(i);
      if (!cache.has(target)) cache.set(target, allows(mask, target));
      return cache.get(target);
    };
  }

  function frame(world, footprint) {
    const rows = world.shadowLod;
    if (!rows || !(footprint > 0)) return world;
    let data, pix, fine, surfaceData;
    for (let i = 0, q = 0; q < rows.length && i < world.count; i++, q += stride) {
      const threshold = rows[q], s = i * 16;
      // Retained painters can replace a baked colour. Their edits take precedence.
      if (!threshold || footprint <= threshold || world.data[s + 7] !== rows[q + 1]) continue;
      data ??= world.data.slice();
      data[s + 7] = rows[q + 2];
      if (world.pix?.[i * 8]) {
        pix ??= world.pix.slice();
        pix[i * 8] = rows[q + 3];
        pix[i * 8 + 1] = rows[q + 4];
      }
      if (world.fine?.[i * 12 + 11]) {
        fine ??= world.fine.slice();
        fine[i * 12 + 11] = 0;
      }
      if (world.surfaceData?.[i * 8]) {
        surfaceData ??= world.surfaceData.slice();
        surfaceData[i * 8 + 4] = rows[q + 5];
      }
    }
    return data ? { ...world, data, pix: pix ?? world.pix, fine: fine ?? world.fine,
      surfaceData: surfaceData ?? world.surfaceData } : world;
  }

  return Object.freeze({ stride, prepare, allows, transfer, bind, frame,
    small: (art, footprint) => Boolean(art?.small && footprint > art.small.referenceSize / art.small.belowPixels) });
})();
if (typeof module !== 'undefined') module.exports = ShadowArt;
