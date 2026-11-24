const roots = new Set(['visual', 'finish', 'entities', 'prefabs', 'solids', 'assetPacks', 'style']);
const lookKeys = new Set(['look', 'lookAsset', 'terrainLookAsset', 'surface', 'terrainSurface']);

function touches(before, after, paths, { read, equal }) {
  function changesLook(a, b) {
    if (a === b) return false;
    const left = a && typeof a === 'object' ? a : {};
    const right = b && typeof b === 'object' ? b : {};
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (lookKeys.has(key) && !equal(left[key], right[key])) return true;
      if (changesLook(left[key], right[key])) return true;
    }
    return false;
  }
  return paths.some(path => {
    const [root] = path;
    if (!roots.has(root)) return false;
    const prior = read(before, path), next = read(after, path);
    if (root === 'assetPacks' || root === 'style' || path.some(key => lookKeys.has(key))) return !equal(prior, next);
    return changesLook(prior, next);
  });
}

function byTarget(report) {
  const groups = new Map();
  for (const { mode, stage, select, definition, matchedTargets } of report.rules) {
    const rule = { mode, stage, select, definition };
    for (const { count, ...target } of matchedTargets) {
      const key = JSON.stringify(Object.keys(target).sort().map(name => [name, target[name]]));
      if (!groups.has(key)) groups.set(key, { target, rules: [] });
      const rules = groups.get(key).rules;
      if (rules.at(-1) !== rule) rules.push(rule);
    }
  }
  return groups;
}

function impact(before, after, equal) {
  const left = byTarget(before), right = byTarget(after), compared = new WeakMap();
  function sameRule(a, b) {
    let matches = compared.get(a);
    if (!matches) compared.set(a, matches = new WeakMap());
    if (!matches.has(b)) matches.set(b, equal(a, b));
    return matches.get(b);
  }
  const targets = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    if (!a || !b || a.rules.length !== b.rules.length || a.rules.some((rule, i) => !sameRule(rule, b.rules[i])))
      targets.push((b ?? a).target);
  }
  const collect = values => [...new Set(values.filter(value => value !== undefined))].sort();
  return {
    materials: collect(targets.map(target => target.material)),
    surfaces: collect(targets.map(target => target.surface)),
    instances: collect(targets.flatMap(target => target.prefabs ?? [])),
    entities: collect(targets.map(target => target.entity)),
    targets
  };
}

module.exports = { touches, impact };
