/* Use the same scene labels before baking and when resolving visible pixels. */
const DetailBudgets = (() => {
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const ENABLE_CLEANUP = 1, DISABLE_CLEANUP = 2, PROTECT_SILHOUETTE = 4, OWNED = 8;

  function prepare(definition) {
    if (definition == null || definition === false) return null;
    if (!Array.isArray(definition) || definition.length > 64)
      throw new TypeError('Detail budgets need an array of up to 64 rules');
    const rules = Array.from(definition, rule => {
      if (!rule || Object.getPrototypeOf(rule) !== Object.prototype ||
          Object.keys(rule).some(key => !['select', 'spacing', 'fine', 'cleanup', 'protectSilhouette'].includes(key)))
        throw new TypeError('Invalid detail budget rule');
      const { spacing, fine, cleanup, protectSilhouette } = rule;
      const select = targets.prepare(rule.select);
      if (Object.keys(select).some(key => !['object', 'entity', 'tag'].includes(key)))
        throw new TypeError('Detail budgets select by object, entity or tag');
      if (spacing !== undefined && (!Number.isFinite(spacing) || spacing < 0.25 || spacing > 4))
        throw new RangeError('Detail budget spacing must be between 0.25 and 4');
      for (const [key, value] of Object.entries({ fine, cleanup, protectSilhouette }))
        if (value !== undefined && typeof value !== 'boolean')
          throw new TypeError('Detail budget ' + key + ' must be a boolean');
      return Object.freeze({ ...rule, select });
    });
    if (!rules.length) return null;

    function match(target) {
      return rules.find(rule => targets.matches(rule.select, target));
    }
    function bind(world) {
      const index = targets.index(world), cache = new WeakMap();
      return i => {
        if (i < 0 || i >= world.count) return undefined;
        const target = index.row(i);
        if (!cache.has(target)) cache.set(target, match(target));
        return cache.get(target);
      };
    }
    return Object.freeze({
      rules: Object.freeze(rules), match, bind,
      fineOn: rules.some(rule => rule.fine === true),
      fineOff: rules.some(rule => rule.fine === false),
      affectsCleanup: rules.some(rule => flags(rule) !== 0),
      enablesCleanup: rules.some(rule => rule.cleanup === true)
    });
  }

  function flags(rule) {
    return (rule?.cleanup === true ? ENABLE_CLEANUP : rule?.cleanup === false ? DISABLE_CLEANUP : 0) |
      (rule?.protectSilhouette ? PROTECT_SILHOUETTE : 0);
  }
  function cleans(value, fallback) {
    if (value & DISABLE_CLEANUP) return false;
    return !!(value & ENABLE_CLEANUP) || fallback;
  }
  function protects(value) {
    return !!(value & (DISABLE_CLEANUP | PROTECT_SILHOUETTE));
  }
  return Object.freeze({ prepare, flags, cleans, protects, OWNED });
})();
if (typeof module !== 'undefined') module.exports = DetailBudgets;
