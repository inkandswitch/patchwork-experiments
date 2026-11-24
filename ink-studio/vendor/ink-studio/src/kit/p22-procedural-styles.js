/* Caller-defined appearance profiles with ordered inheritance and material roles. */
(function (K) {
  const P = K.procedural;
  const { clone, freeze, merge } = P.data;
  const compiled = new WeakSet(),
    materialCache = new WeakMap();
  const name = value =>
    typeof value === 'string' && value.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(value);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const colorFields = ['color', 'shade', 'sun', 'emissive'];

  function rgb(color) {
    if (Array.isArray(color) && color.length === 3 && color.every(v => Number.isFinite(v) && v >= 0 && v <= 1))
      return color.slice();
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) color = Number.parseInt(color.slice(1), 16);
    if (Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
      return [color >> 16, (color >> 8) & 255, color & 255].map(v => v / 255);
    }
    throw new Error('Expected #rrggbb, a 24-bit color or three normalized color components');
  }

  function normalize(value) {
    const profile = clone(value);
    if (!record(profile)) throw new Error('A style profile must be a JSON record');
    const parents =
      profile.extends === undefined ? [] : Array.isArray(profile.extends) ? profile.extends : [profile.extends];
    if (parents.length > 32 || !parents.every(name)) throw new Error('Style extends needs up to 32 names');
    delete profile.extends;
    if (profile.materials !== undefined && profile.materials !== null) {
      if (!record(profile.materials)) throw new Error('Style materials must be a record or null');
      for (const [role, value] of Object.entries(profile.materials)) {
        if (!name(role)) throw new Error('Invalid material role');
        if (typeof value === 'string' && !value.startsWith('#')) {
          if (!name(value)) throw new Error('Invalid material alias');
        } else if (record(value)) {
          if (value.alias !== undefined && !K.materialReferences.reference(value.alias))
            throw new Error('Invalid material alias');
          for (const key of colorFields) if (value[key] !== undefined) rgb(value[key]);
        } else {
          rgb(value);
          profile.materials[role] = { color: value };
        }
      }
    }
    return { profile, parents };
  }

  function material(profile, role) {
    if (!record(profile) || !name(role)) throw new Error('Material resolution needs a profile and a role');
    const own = role,
      saved = materialCache.get(profile);
    if (saved?.has(own)) return saved.get(own);
    const result = K.materialReferences.resolve(profile.materials || {}, role);
    for (const key of colorFields) if (key === 'color' || result[key] !== undefined) result[key] = rgb(result[key]);
    freeze(result);
    if (compiled.has(profile)) {
      if (!saved) materialCache.set(profile, new Map([[own, result]]));
      else saved.set(own, result);
    }
    return result;
  }

  function catalog(definitions = {}) {
    if (!record(definitions) || Object.keys(definitions).length > 512)
      throw new Error('A style catalog needs up to 512 profiles');
    const entries = new Map();
    for (const [id, value] of Object.entries(definitions)) {
      if (!name(id)) throw new Error('Invalid style name');
      entries.set(id, normalize(value));
    }
    const named = new Map(),
      cache = new Map(),
      active = new Set();
    function load(id) {
      if (named.has(id)) return named.get(id);
      if (active.has(id)) throw new Error('Cyclic style inheritance: ' + [...active, id].join(' → '));
      const entry = entries.get(id);
      if (!entry) throw new Error('Unknown style: ' + id);
      active.add(id);
      try {
        const value = finish(flatten(entry));
        named.set(id, value);
        return value;
      } finally {
        active.delete(id);
      }
    }
    function flatten({ profile, parents }) {
      const base = parents.reduce((out, id) => merge(out, load(id)), {});
      return merge(base, profile);
    }
    function finish(result) {
      freeze(result);
      compiled.add(result);
      return result;
    }
    for (const id of entries.keys()) load(id);

    function resolve(...layers) {
      if (layers.length > 128) throw new Error('A style stack supports up to 128 layers');
      if (layers.length === 1 && typeof layers[0] === 'string') return load(layers[0]);
      const values = layers.map(layer => (typeof layer === 'string' ? load(layer) : flatten(normalize(layer))));
      const key = JSON.stringify(values);
      if (cache.has(key)) return cache.get(key);
      const value = finish(values.reduce((out, layer) => merge(out, layer), {}));
      cache.set(key, value);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
      return value;
    }
    return Object.freeze({ names: Object.freeze([...entries.keys()]), resolve });
  }

  function sample(profile, channels) {
    if (!record(profile) || !Array.isArray(channels) || !channels.every(name)) {
      throw new Error('Style sampling needs a profile and named channels');
    }
    return freeze(
      Object.fromEntries(
        channels
          .filter(key => Object.prototype.hasOwnProperty.call(profile, key))
          .map(key => [key, clone(profile[key])])
      )
    );
  }

  const empty = catalog();
  function recolor(profile,role,color){
    if(!record(profile)||!name(role))throw Error('Recoloring needs a profile and a material role');
    return freeze(K.materialReferences.recolor(profile.materials?.[role],rgb(color)));
  }
  P.styles = { catalog, compose: empty.resolve, sample, material, recolor, rgb };
})(KIT);
