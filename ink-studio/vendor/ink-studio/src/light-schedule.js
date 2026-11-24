/* Daylight-driven emission and bounded point-light selection. */
const LightSchedule = (() => {
  const emissionKind = 7, emissionMarker = -7;
  const marker = Object.freeze({ k: emissionKind, ex: emissionMarker, em: true });
  const smooth = (a, b, value) => {
    const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
  };

  function gain(daylight = 1) {
    if (!Number.isFinite(daylight) || daylight < 0 || daylight > 1)
      throw new RangeError('Daylight must be in [0, 1]');
    return 1 - smooth(.16, .58, daylight);
  }

  function select(lights, eye, { daylight, duskOnly = false, limit = 8 } = {}) {
    if (!Array.isArray(lights) || !Number.isSafeInteger(limit) || limit < 0 || limit > 64)
      throw Error('Light selection needs a source list and a limit from zero to 64');
    const dusk = gain(daylight), ranked = [];
    for (const light of lights) {
      const automatic = light.schedule === 'dusk';
      if (duskOnly && !automatic) continue;
      const intensity = light.intensity * (automatic ? dusk : 1);
      if (!(intensity > 0)) continue;
      const distance = Math.hypot(...light.p.map((v, i) => v - eye[i]));
      ranked.push({ light, intensity, weight: intensity * light.radius / (4 + distance) });
    }
    ranked.sort((a, b) => b.weight - a.weight);
    return ranked.slice(0, limit).map(({ light, intensity }) => ({ ...light, intensity }));
  }

  const emissionScale = dusk => .22 + .78 * dusk;
  function contribution(light, x, y, z) {
    const delta = [x - light.p[0], y - light.p[1], z - light.p[2]];
    const distance = Math.hypot(...delta);
    if (distance >= light.radius) return 0;
    const facing = light.normal ? smooth(-.07, .25, delta.reduce((v, d, i) => v + d * light.normal[i], 0)) : 1;
    return (1 - distance / light.radius) ** 2 * light.intensity * facing;
  }

  function transfer(lights, x, y, z) {
    const color = [0, 0, 0];
    let power = 0;
    for (const light of lights) {
      const amount = contribution(light, x, y, z);
      if (!amount) continue;
      power += amount;
      for (let k = 0; k < 3; k++) color[k] += light.color[k] * amount;
    }
    return { gain: 1 + .65 * power, color: color.map(v => .25 * v) };
  }

  const glsl = `
float scheduledFalloff(vec3 delta, float radius, vec4 direction) {
  float radial = max(0.0, 1.0 - length(delta) / radius);
  float facing = direction.w > 0.5 ? smoothstep(-.07, .25, dot(delta, direction.xyz)) : 1.0;
  return radial * radial * facing;
}
`;
  return Object.freeze({ gain, select, marker, emissionKind, emissionMarker, emissionScale, contribution, transfer, glsl });
})();
if (typeof module !== 'undefined') module.exports = LightSchedule;
