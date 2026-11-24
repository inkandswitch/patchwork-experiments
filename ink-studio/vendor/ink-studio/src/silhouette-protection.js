/* Per-subject fog, contrast, and local shot focus using the scene's target selectors. */
const SilhouetteProtection = (() => {
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const number = (n, lo, hi, label) => {
    if (!Number.isFinite(n) || n < lo || n > hi) throw new RangeError(label + ' is out of range');
    return n;
  };
  const record = (value, keys) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !keys.includes(k)))
      throw new TypeError('Invalid silhouette protection settings');
    return value;
  };
  function prepareFocus(value, subjects) {
    if (value === undefined || value === false) return null;
    const { subjects: ids = subjects.map(row=>row.id), radius = 24, depthBias = .2, background = {}, rain = {} } =
      record(value,['subjects','radius','depthBias','background','rain']);
    const { contrast = 1, pivot = .5, saturation = 1, detail = 1 } =
      record(background,['contrast','pivot','saturation','detail']);
    const { subject = 1, surroundings = 1 } = record(rain,['subject','surroundings']);
    const slots = new Set(Array.isArray(ids) ? ids : []);
    if (!slots.size || slots.size !== ids.length || [...slots].some(id=>!subjects.some(row=>row.id===id)))
      throw new TypeError('Shot focus needs unique IDs from silhouette protection targets');
    number(radius,1,128,'Focus radius');
    number(depthBias,0,20,'Focus depth bias');
    number(pivot,0,1,'Background contrast pivot');
    number(contrast,0,2,'Background contrast');
    number(saturation,0,2,'Background saturation');
    number(detail,0,1,'Background detail');
    number(subject,0,1,'Subject rain visibility');
    number(surroundings,0,1,'Surrounding rain visibility');
    const grades = contrast !== 1 || saturation !== 1 || detail !== 1;
    if (!grades && subject === 1 && surroundings === 1) return null;
    return Object.freeze({ slots:Object.freeze(subjects.filter(row=>slots.has(row.id)).map(row=>row.slot)), radius, depthBias,
      contrast,pivot,saturation,detail,subject,surroundings,grades });
  }
  function prepare(authored, override) {
    const source = override === true ? authored : override ?? authored;
    if (source == null || source === false) return null;
    const { targets: rules, focus } = record(source, ['targets','focus']);
    if (!Array.isArray(rules) || rules.length > 64) throw new TypeError('Silhouette protection needs up to 64 targets');
    const ids = new Set();
    const prepared = Array.from(rules, (row,i) => {
      const { id = 'target-' + (i+1), select, fogScale = 1, contrast = 1, pivot = .5 } =
        record(row, ['id','select','fogScale','contrast','pivot']);
      if (!targets.name(id) || ids.has(id)) throw new TypeError('Silhouette protection target IDs must be unique names');
      ids.add(id);
      const selection = targets.prepare(select);
      if ('medium' in selection || 'mediumKind' in selection)
        throw new TypeError('Silhouette protection selectors must identify a scene subject');
      return Object.freeze({ id, slot: i+1, select: selection, fogScale: number(fogScale,0,2,'Subject fog scale'),
        contrast: number(contrast,0,4,'Subject contrast'), pivot: number(pivot,0,1,'Subject contrast pivot') });
    });
    const shot = prepareFocus(focus,prepared);
    if (!prepared.length) return null;
    function match(target) {
      const rule = prepared.find(row => targets.matches(row.select,target));
      return rule ?? null;
    }
    function bind(world) {
      const index = targets.index(world), cache = new WeakMap();
      return i => {
        if (i < 0 || i >= world.count) return null;
        const target = index.row(i);
        if (!cache.has(target)) cache.set(target,match(target));
        return cache.get(target);
      };
    }
    return Object.freeze({ targets: Object.freeze(prepared), affectsFog: prepared.some(r=>r.fogScale!==1), focus:shot, match, bind });
  }
  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = SilhouetteProtection;
