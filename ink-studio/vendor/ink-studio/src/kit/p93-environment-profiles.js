/* Portable environment selections and per-profile overrides in retained documents. */
(function (K) {
  const A = K.authoring, { clone,freeze,merge } = A.data;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) && !['constructor','prototype'].includes(value);

  function create({ key, profiles, defaultId, defaults = {}, validate = () => {} }) {
    if (!id(key) || !Array.isArray(profiles) || !profiles.length || !object(defaults) ||
        typeof validate !== 'function')
      throw Error('Environment profiles need a key, defaults and one or more profiles');

    const registry = new Map(), cache = new WeakMap();
    const inherited = freeze(clone(defaults));
    for (const raw of profiles) {
      if(!object(raw))throw Error('Environment profile needs an ID, label and value map');
      const { id: name, label, values } = clone(raw);
      if (!id(name) || registry.has(name) || typeof label !== 'string' || !label.trim() || !object(values))
        throw Error('Environment profile needs a unique ID, label and value map');
      const resolved = freeze(merge(inherited,values));
      validate(resolved);
      registry.set(name,freeze({id:name,label:label.trim(),values:resolved}));
    }
    if (!registry.has(defaultId)) throw Error('Unknown default environment profile');

    const from = source => typeof source.snapshot === 'function' ? source.snapshot() : source;
    const placement = source => from(source).environment?.presentation?.profiles?.[key];
    function result(raw) {
      const requested = raw?.active ?? defaultId, profile = registry.get(requested) ?? registry.get(defaultId);
      const edits = raw?.overrides?.[profile.id];
      if (edits != null && !object(edits)) throw Error('Environment profile overrides need a value map');
      const values = edits ? freeze(merge(profile.values, edits)) : profile.values;
      if (edits) validate(values);
      return freeze({ id:profile.id, requested, label:profile.label, values, missing:!registry.has(requested) });
    }
    const initial = result();
    function resolve(source) {
      const raw = placement(source);
      if (raw == null) return initial;
      if (!object(raw) || raw.active !== undefined && !id(raw.active) ||
          raw.overrides !== undefined && !object(raw.overrides)) throw Error('Invalid saved environment profile selection');
      const immutable = A.data.isImmutable(raw);
      if (immutable && cache.has(raw)) return cache.get(raw);
      const resolved = result(raw);
      if (immutable) cache.set(raw,resolved);
      return resolved;
    }
    function set(doc,label,patch) {
      const run = () => doc.setEnvironment({presentation:{profiles:{[key]:patch}}});
      return doc.pending()?run():doc.transact(label,run);
    }
    function select(doc,name) {
      if (!registry.has(name)) throw Error('Unknown environment profile: '+name);
      const raw = placement(doc);
      const next = result({...raw,active:name});
      set(doc,'Switch environment', {active:name});
      return next;
    }
    function edit(doc,patch) {
      if (!object(patch)) throw Error('Environment profile edits need a value map');
      const current = resolve(doc);
      const overrides = placement(doc)?.overrides?.[current.id] ?? {};
      const merged = merge(overrides,patch);
      const next = result({active:current.id,overrides:{[current.id]:merged}});
      set(doc,'Edit environment profile',{active:current.id,overrides:{[current.id]:merged}});
      return next;
    }
    return Object.freeze({
      list: () => Object.freeze([...registry.values()]),
      resolve, select, edit,
      reset(doc) {
        const current = resolve(doc);
        set(doc,'Reset environment profile',{overrides:{[current.id]:null}});
        return resolve(doc);
      }
    });
  }
  A.environmentProfiles = Object.freeze({ create });
})(KIT);
