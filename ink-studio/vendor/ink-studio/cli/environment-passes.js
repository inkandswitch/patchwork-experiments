const { environment } = require('../src/art-passes.js');

function createEnvironmentPasses(selected, w, h, world) {
  if (!environment.some(channel => selected.has(channel))) return null;
  const size = w * h;
  const passes = Object.fromEntries(environment.filter(channel => selected.has(channel)).map(channel => {
    const components = channel === 'precipitation' ? 4 : channel === 'sky' || channel === 'reflections' ? 3 : 1;
    return [channel, new Float32Array(size * components)];
  }));
  const { precipitation, reflections, foregroundCoverage, fogTransmittance } = passes;
  fogTransmittance?.fill(1);
  const falling = (precipitation || foregroundCoverage) && new Uint8Array(world.count);
  if (falling) {
    for (let i = 0; i < falling.length; i++) falling[i] = Number(Math.round(world.data[i * 16 + 11]) % 16 === 2);
    for (const ranges of [world.precipitationRanges, world.fallingSnowRanges])
      for (const {first,end} of ranges ?? []) falling.fill(1, first, end);
  }
  const patternWeight = reflections && new Float32Array(size);
  const top = p => (h - 1 - Math.floor(p / w)) * w + p % w;

  function fragment(pixel, i, a, r, g, b, reflected, winner) {
    const p = top(pixel), through = 1 - a;
    const falls = falling?.[i];
    if (foregroundCoverage && !falls)
      foregroundCoverage[p] = a + foregroundCoverage[p] * through;
    if (precipitation) {
      const q = p * 4, weight = falls ? a : 0;
      precipitation[q] = r * weight + precipitation[q] * through;
      precipitation[q + 1] = g * weight + precipitation[q + 1] * through;
      precipitation[q + 2] = b * weight + precipitation[q + 2] * through;
      precipitation[q + 3] = weight + precipitation[q + 3] * through;
    }
    if (reflections) {
      const q = p * 3;
      for (let c = 0; c < 3; c++) reflections[q + c] = (reflected?.[c] ?? 0) * a + reflections[q + c] * through;
      patternWeight[p] = winner ? a : patternWeight[p] * through;
    }
  }

  return {
    passes, top,
    fragment: precipitation || reflections || foregroundCoverage ? fragment : undefined,
    pattern(pixel, reflected) {
      const p = top(pixel), weight = patternWeight[p];
      for (let c = 0; c < 3; c++) reflections[p * 3 + c] += reflected[c] * weight;
    }
  };
}

module.exports = { createEnvironmentPasses };
