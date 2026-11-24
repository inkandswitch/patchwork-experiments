/* Select where a retained static sculpt may supply opaque coverage. */
const SdfAssist = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!record(value) || Object.keys(value).some(key => !['rules','epsilon','steps'].includes(key)))
      throw new TypeError('SDF assist needs a boolean or an object with rules, epsilon and steps');
    const { rules: authored, epsilon = .0015, steps = 160 } = value;
    if (!Number.isFinite(epsilon) || epsilon < .0001 || epsilon > .05 ||
        !Number.isSafeInteger(steps) || steps < 16 || steps > 512)
      throw new RangeError('SDF assist needs epsilon in .0001–.05 and 16–512 trace steps');
    if (authored !== undefined && (!Array.isArray(authored) || authored.length > 64))
      throw new TypeError('SDF assist rules need an array of up to 64 entries');
    const rules = authored && Array.from(authored, rule => {
      if (!record(rule) || Object.keys(rule).some(key => !['select','bounds','enabled'].includes(key)))
        throw new TypeError('Invalid SDF assist rule');
      const { select, bounds, enabled = true } = rule;
      if (typeof enabled !== 'boolean') throw new TypeError('SDF assist rule enabled must be a boolean');
      if (bounds !== undefined && (!record(bounds) || !vector(bounds.min) || !vector(bounds.max) ||
          bounds.min.some((n,i) => n >= bounds.max[i])))
        throw new RangeError('SDF assist bounds need increasing world-space XYZ limits');
      return { select:select === undefined ? null : selectors.prepare(select), bounds, enabled };
    });
    const matches = (rule,target) => !rule.select || selectors.matches(rule.select,target);
    const contains = (rule,point) => !rule.bounds ||
      point.every((n,i)=>n >= rule.bounds.min[i] && n <= rule.bounds.max[i]);
    return {
      epsilon, steps,
      candidates: target => !rules || rules.some(rule=>rule.enabled && matches(rule,target)),
      allows: (target,point) => !rules || (rules.find(rule=>matches(rule,target) && contains(rule,point))?.enabled ?? false)
    };
  }

  function opaque(material) {
    return !material.skip && (material.a === undefined || material.a >= 1) && !material.glass &&
      !material.optical && !material.surface?.opacity &&
      !Object.values(material.surface?.layers ?? {}).some(layer=>layer?.type==='projected' &&
        (layer.revealChannel || typeof layer.pattern==='function')) && !material.em && !material.fur && !material.leaf &&
      !material.blade && !material.fl?.nd && !material.fl?.k && !material.motionAt &&
      (!material.top || opaque(material.top));
  }
  return Object.freeze({ prepare, opaque });
})();
if (typeof module !== 'undefined') module.exports = SdfAssist;
