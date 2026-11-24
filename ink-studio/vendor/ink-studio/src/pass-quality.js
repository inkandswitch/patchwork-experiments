/* Stable quality controls for draw rows and secondary captures. */
const PassQuality = (() => {
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const silhouettes = typeof SilhouetteProtection === 'undefined' ? require('./silhouette-protection.js') : SilhouetteProtection;
  const empty = Object.freeze([]);
  function record(value, keys, label) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key)))
      throw new TypeError('Invalid ' + label + ' quality settings');
    return value;
  }
  function number(value, min, max, label) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(label + ' is out of range');
    return value;
  }
  function selectors(value = empty) {
    if (!Array.isArray(value) || value.length > 64) throw new TypeError('Pass quality needs up to 64 target selectors');
    return Object.freeze(Array.from(value, targets.prepare));
  }
  function prepare(value) {
    if (value === undefined || value === false) return null;
    const { background, particles, reflections, preserve } = record(value,
      ['background', 'particles', 'reflections', 'preserve'], 'pass');
    const back = background === undefined ? null : record(background, ['select', 'retain'], 'background');
    const effects = particles === undefined ? null : record(particles, ['select', 'retain'], 'particle');
    const reflection = reflections === undefined ? null :
      record(reflections, ['primary', 'secondaryScale', 'maxSecondary'], 'reflection');
    const backgroundRate = number(back?.retain ?? 1, .125, 1, 'Background retain');
    const particleRate = number(effects?.retain ?? 1, 0, 1, 'Particle retain');
    const backgroundSelectors = selectors(back?.select), particleSelectors = selectors(effects?.select);
    if (backgroundRate < 1 && !backgroundSelectors.length)
      throw new TypeError('Background reduction requires explicit target selectors');
    let captures = null;
    if (reflection) {
      const { primary, secondaryScale = 1, maxSecondary = Infinity } = reflection;
      if (primary !== undefined && (!Array.isArray(primary) || primary.length > 64 ||
          !Array.from(primary).every(targets.name) || new Set(primary).size !== primary.length))
        throw new TypeError('Primary reflections need unique capture IDs');
      if (reflection.maxSecondary !== undefined && (!Number.isSafeInteger(maxSecondary) || maxSecondary < 0))
        throw new RangeError('Max secondary reflections must be a nonnegative integer');
      number(secondaryScale, .125, 1, 'Secondary reflection scale');
      if (secondaryScale < 1 || maxSecondary !== Infinity)
        captures = Object.freeze({ primary: primary && Object.freeze(primary.slice()), secondaryScale, maxSecondary });
    }
    const protectedTargets = selectors(preserve);
    const rows = backgroundRate < 1 || particleRate < 1;
    return rows || captures ? Object.freeze({ rows, backgroundRate, backgroundSelectors, particleRate,
      particleSelectors, protectedTargets, captures }) : null;
  }

  function reflectionPlan(settings, ids) {
    const config = settings?.captures;
    if (!config) return null;
    const primary = new Set(config.primary ?? ids.slice(0, 1));
    let secondaries = 0;
    return new Map(ids.map(id => [id, primary.has(id) ? 1 :
      secondaries++ < config.maxSecondary ? config.secondaryScale : 0]));
  }

  // The rank depends only on the source row, so animated poses and quality
  // changes can reuse the same subset without re-randomizing a frame.
  function rank(i) {
    let h = Math.imul(i + 1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function planRows(world, settings, { data = world.data, count = world.count, particleStart = world.count,
    silhouette, protection } = {}) {
    if (!settings?.rows) return null;
    const { backgroundRate, particleRate, backgroundSelectors, particleSelectors, protectedTargets } = settings;
    const knownParticles = particleRate < 1 && new Uint8Array(world.count);
    if (knownParticles) {
      for (const ranges of [world.effectParticles, world.qualityParticleRanges, world.precipitationRanges, world.fallingSnowRanges])
        for (const { first, end, count } of ranges ?? []) knownParticles.fill(1, first, end ?? first + count);
    }
    const protectedSubjects = protection === undefined ? silhouettes.prepare(world.look?.silhouetteProtection, silhouette) : protection;
    const protect = protectedTargets.concat(protectedSubjects?.targets.map(row => row.select) ?? empty);
    const indices = targets.index(world), decisions = new WeakMap();
    const matches = (rules, target) => rules.some(rule => targets.matches(rule, target));
    const keep = new Uint8Array(count).fill(1);
    let backgroundSkipped = 0, particlesSkipped = 0;
    for (let i = 0; i < count; i++) {
      const q = i * 16, code = Math.round(data[q + 11]);
      let decision;
      if (i < world.count) {
        const target = indices.row(i);
        decision = decisions.get(target);
        if (!decision) {
          const preserve = Boolean(target.mark || target.markLayer || target.material === 'data-mark' || matches(protect, target));
          decision = { preserve, background: backgroundRate < 1 && matches(backgroundSelectors, target),
            particle: particleRate < 1 && matches(particleSelectors, target), first: true };
          decisions.set(target, decision);
        }
      }
      if (decision?.preserve) continue;
      if (world.paintCorrections && data[q + 14] === world.paintCorrections.marker) continue;
      const kind = code & 15;
      const particle = i >= particleStart || knownParticles?.[i] || decision?.particle || kind === 2 || kind === 3 || kind === 6;
      if (particle && particleRate < 1 && rank(i) >= particleRate) {
        keep[i] = 0;
        particlesSkipped++;
      } else if (!particle && decision?.background && !(code & (15 | 32 | 256 | 512 | 2048 | 32768)) &&
          data[q + 3] >= 1 && !world.opticalSplats?.[i * 12 + 3]) {
        if (decision.first) decision.first = false;
        else if (rank(i) >= backgroundRate) {
          keep[i] = 0;
          backgroundSkipped++;
        }
      }
    }
    return backgroundSkipped || particlesSkipped ? { keep, backgroundSkipped, particlesSkipped,
      submitted: count - backgroundSkipped - particlesSkipped } : null;
  }
  return Object.freeze({ prepare, planRows, reflectionPlan });
})();
if (typeof module !== 'undefined') module.exports = PassQuality;
