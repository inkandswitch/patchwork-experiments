/* Coverage, geometric sampling and transmission shared by rendering and ray queries. */
const ContributionRules = (() => {
  const cutoff = 4.5, minimum = .004, maximum = .99;
  const solidLow = .38, solidHigh = .62;
  const coverageModes = ['legacy', 'continuous', 'soft'];
  const continuousCoverage = 1, softCoverage = 2;
  const coverageStride = 4, continuousVariance = .25;
  const continuousLow = .16, continuousHigh = .30;
  // Motion kinds, non-depth strokes, emission, backgrounds, hidden rows, glass and text.
  const nonSurface = 15 | 16 | 32 | 64 | 128 | 256 | 2048;
  function coverageMode(value = 'legacy') {
    const mode = coverageModes.indexOf(value);
    if (mode < 0) throw new RangeError('Splat coverage must be legacy, continuous or soft');
    return mode;
  }
  function materialCoverage(packed, fallback) {
    const encoded = Math.floor(packed / coverageStride);
    return encoded ? encoded - 1 : fallback;
  }
  function materialEdge(packed) { return packed % coverageStride; }
  function continuous(mode, density, code, optical) {
    return mode === continuousCoverage && density >= 1 && !(code & nonSurface) && !optical;
  }
  const clamp = n => Math.max(0, Math.min(1, n));
  function alpha(power, density, solid, materialEdge = 0, continuous = false) {
    if (power > 0 || power < -cutoff) return 0;
    const g = density * Math.exp(power);
    if (continuous) {
      const t = clamp((g - continuousLow) / (continuousHigh - continuousLow));
      return t * t * (3 - 2 * t);
    }
    if (!solid) return Math.min(maximum, g);
    if (materialEdge >= 2) return g >= .5 ? maximum : 0;
    const width = materialEdge ? .36 * (2 - materialEdge) : 0;
    const low = materialEdge ? .5 - width : solidLow;
    const high = materialEdge ? .5 + width : solidHigh;
    const t = clamp((g - low) / (high - low));
    return maximum * t * t * (3 - 2 * t);
  }
  function axis({ axis = 'y', origin = [0,0,0] }) {
    const keys = { x:[1,0,0], y:[0,1,0], z:[0,0,1] };
    const v = typeof axis==='string' && Object.hasOwn(keys,axis) ? keys[axis] : axis;
    const xyz = value => Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);
    if (!xyz(v) || !xyz(origin)) throw new TypeError('An axis mask needs an XYZ axis and origin');
    const length = Math.hypot(...v);
    if (!Number.isFinite(length) || length <= 1e-8) throw new RangeError('An axis mask needs a nonzero direction');
    const direction = v.map(n=>n/length);
    return { direction, offset: -direction.reduce((sum,n,i)=>sum+n*origin[i],0) };
  }
  function plane({origin=[0,0,0],along=[1,0,0],across=[0,0,1]}={}) {
    const x=axis({axis:along}).direction, alongComponent=x.reduce((sum,n,i)=>sum+n*across[i],0);
    const z=axis({axis:across.map((n,i)=>n-x[i]*alongComponent)}).direction;
    return {x,z,origin};
  }
  const supportsMask = mask => !mask || mask.type === 'axis' || mask.type === 'texture' &&
    (mask.projection === undefined || mask.projection && typeof mask.projection === 'object' &&
      (mask.projection.type ?? 'plane') === 'plane');
  const glsl = `
float contributionAlpha(float power, float density, bool solid) {
  if (power > 0.0 || power < -${cutoff}) return 0.0;
  float g = density * exp(power);
  return solid ? ${maximum} * smoothstep(${solidLow}, ${solidHigh}, g) : min(${maximum}, g);
}
`;
  function reduce(layers, threshold = minimum) {
    let transmission = 1, spectrum;
    const contributions = [];
    for (const layer of layers) {
      const before = transmission;
      if (layer.transmissionRGB || spectrum) {
        spectrum ??= [transmission,transmission,transmission];
        for (let c=0;c<3;c++) spectrum[c] *= layer.transmissionRGB?.[c] ?? 1-layer.alpha;
        transmission = spectrum[0]*.30+spectrum[1]*.55+spectrum[2]*.15;
      } else transmission *= 1 - layer.alpha;
      const weight = before - transmission;
      if (weight >= threshold) contributions.push({ ...layer, weight, transmissionBefore: before, transmission });
    }
    return { contributions, transmission, ...(spectrum&&{transmissionRGB:spectrum}) };
  }
  return Object.freeze({ cutoff, minimum, maximum, alpha, axis, plane, supportsMask, reduce, glsl,
    coverageMode, materialCoverage, materialEdge, continuous, continuousCoverage, softCoverage,
    coverageStride, continuousVariance, continuousLow, continuousHigh, nonSurface });
})();
if (typeof module !== 'undefined') module.exports = ContributionRules;
