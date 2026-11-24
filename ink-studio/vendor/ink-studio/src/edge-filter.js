/* Resolve authored edge strengths using the scene's regular splat labels. */
const EdgeFilter = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  function strength(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Edge filter strength must be between 0 and 1');
    return value;
  }

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!record(value) || Object.keys(value).some(key => !['strength', 'rules'].includes(key)))
      throw new TypeError('Edge filter needs a boolean or an object with strength and rules');
    const { rules, strength: fallback = rules === undefined ? 1 : 0 } = value;
    strength(fallback);
    if (rules !== undefined && (!Array.isArray(rules) || rules.length > 64))
      throw new TypeError('Edge filter rules need an array of up to 64 entries');
    const prepared = Array.from(rules ?? [], rule => {
      if (!record(rule) || Object.keys(rule).some(key => !['select', 'strength'].includes(key)))
        throw new TypeError('Invalid edge filter rule');
      const { select: selector, strength: amount = 1 } = rule;
      const select = selectors.prepare(selector);
      if ('medium' in select || 'mediumKind' in select)
        throw new TypeError('Edge filter selectors must identify scene geometry');
      return { select, strength: strength(amount) };
    });
    if (!fallback && !prepared.some(rule => rule.strength)) return null;
    return {
      bind(world) {
        if (!prepared.length) return () => fallback;
        const index = selectors.index(world), cache = new WeakMap();
        return i => {
          const target = index.row(i);
          if (!cache.has(target)) {
            const rule = prepared.find(rule => selectors.matches(rule.select, target));
            cache.set(target, rule?.strength ?? fallback);
          }
          return cache.get(target);
        };
      }
    };
  }
  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = EdgeFilter;
