/* Horizontal flow measured in scene units per second. Transport uses raw
   velocity, while flexible surfaces saturate smoothly as the wind increases. */
const Airflow = (() => {
  const calm = Object.freeze([0, 0]);
  const packedFlag = 8192;
  // The ASCII set bit is available to analytic fabric when the text flag is clear.
  const clothFlag = 4096, textFlag = 2048;
  const isCloth = code => (code & (clothFlag | textFlag)) === clothFlag;
  const mean = 0.5, first = 0.34, second = 0.16, harmonic = 1.81, shift = 0.85;

  function frame(wind = calm) {
    if (!Array.isArray(wind) || wind.length !== 2 || ![wind[0], wind[1]].every(value => Number.isFinite(value) && Math.abs(value) <= 20))
      throw new Error('Wind needs two finite horizontal components in [-20, 20]');
    const [x, z] = wind, scale = 1 / (1 + Math.hypot(x, z));
    return { velocity: [x, z], flex: [x * scale, z * scale] };
  }

  function bend(time, phase, frequency, reach) {
    const wave = time * frequency + phase;
    return reach * (mean + first * Math.sin(wave) + second * Math.sin(wave * harmonic + shift));
  }

  function pinned({ reach, phase = 0, frequency = 2.25, phaseTravel = 4, channel = 'foliage' } = {}) {
    if (!Number.isFinite(reach) || reach < 0 || !Number.isFinite(phase) ||
        !Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(phaseTravel) || !['foliage','cloth'].includes(channel))
      throw Error('Pinned airflow needs finite motion and nonnegative reach');
    return (station, freedom = station) => {
      const u = Math.max(0, Math.min(1, station));
      const free = Math.max(0, Math.min(1, freedom));
      return { k: 11, wind: true, ...(channel === 'cloth' && { cloth: true }), ph: phase - u * phaseTravel, sp: frequency, rg: reach * free * free };
    };
  }

  const glsl = `
float airflowBend(float time, float phase, float frequency, float reach) {
  float wave = time * frequency + phase;
  return reach * (${mean} + ${first} * sin(wave) + ${second} * sin(wave * ${harmonic} + ${shift}));
}
`;
  return Object.freeze({ frame, bend, pinned, packedFlag, clothFlag, textFlag, isCloth, glsl });
})();
if (typeof module !== 'undefined') module.exports = Airflow;
