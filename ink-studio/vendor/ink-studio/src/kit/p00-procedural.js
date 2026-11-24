/* Renderer-independent procedural primitives. */
(function (K) {
  const A = (K.procedural = {});
  function json(value, path) {
    path = path || '$';
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Array.from(value, (v, i) => json(v, path + '[' + i + ']'));
    if (
      value &&
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ) {
      const out = {};
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(path + ': unsafe key ' + key);
        out[key] = json(value[key], path + '.' + key);
      }
      return out;
    }
    throw new Error(path + ': expected finite JSON data');
  }
  const frozenNodes = new WeakSet();
  function freeze(value) {
    if (value && typeof value === 'object') {
      if (frozenNodes.has(value)) return value;
      for (const v of Object.values(value)) freeze(v);
      Object.freeze(value);
      frozenNodes.add(value);
    }
    return value;
  }
  function merge(a, b) {
    const out = json(a);
    for (const [key, v] of Object.entries(json(b))) {
      out[key] =
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        out[key] &&
        typeof out[key] === 'object' &&
        !Array.isArray(out[key])
          ? merge(out[key], v)
          : v;
    }
    return out;
  }
  function hash(text, seed) {
    let h = seed === undefined ? 2166136261 : seed >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  A.data = Object.freeze({ clone: json, freeze, merge, hash, isImmutable: value => frozenNodes.has(value) });
})(KIT);
