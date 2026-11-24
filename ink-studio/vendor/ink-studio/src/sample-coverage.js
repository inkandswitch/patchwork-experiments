/* A deterministic transition order for retained samples. The packed rank is
   independent of the low motion bits and stays exact in a Float32. */
const SampleCoverage = (() => {
  const bins = 128, stride = 65536, enabled = 32768, entering = 8388608;

  function cohort(x, y, z, spacing, seed) {
    if (![x, y, z, spacing, seed].every(Number.isFinite) || spacing <= 0)
      throw new RangeError('Coverage cohorts need finite coordinates, seed and positive spacing');
    const h = Math.imul(Math.floor(x / spacing), 0x7feb352d) ^
      Math.imul(Math.floor(y / spacing), 0x846ca68b) ^
      Math.imul(Math.floor(z / spacing), 0x9e3779b9) ^ seed;
    const mixed = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((mixed ^ (mixed >>> 16)) >>> 0) % bins;
  }

  function pack(rank, enter = false) {
    if (!Number.isInteger(rank) || rank < 0 || rank >= bins)
      throw new RangeError('Sample coverage rank must be between 0 and ' + (bins - 1));
    if (typeof enter !== 'boolean') throw new TypeError('Sample coverage direction must be a boolean');
    return enabled + rank * stride + (enter ? entering : 0);
  }

  function amount(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Sample withdrawal amount must be between 0 and 1');
    return value;
  }

  function visible(code, withdrawal) {
    if (!(code & enabled)) return true;
    const passed = withdrawal >= (((code >>> 16) & (bins - 1)) + .5) / bins;
    return passed === !!(code & entering);
  }

  const glsl = `
bool sampleCoverageVisible(int code, float withdrawal) {
  if ((code & ${enabled}) == 0) return true;
  bool passed = withdrawal >= (float((code / ${stride}) & ${bins - 1}) + 0.5) / ${bins}.0;
  return passed == ((code & ${entering}) != 0);
}
`;
  return Object.freeze({ bins, enabled, entering, cohort, pack, amount, visible, glsl });
})();
if (typeof module !== 'undefined') module.exports = SampleCoverage;
