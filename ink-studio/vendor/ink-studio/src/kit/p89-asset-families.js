/* Declarative asset families, variants, sockets and replacement contracts. */
(function (K) {
  const A = K.authoring, { clone, freeze, merge, hash } = A.data;
  const has = (o, k) => Object.hasOwn(o, k);
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const name = x => typeof x === 'string' && x.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(x);
  const snapshot = source => typeof source.snapshot === 'function' ? source.snapshot() : source;
  const transaction = (doc, label, fn) => doc.pending() ? fn() : doc.transact(label, fn);
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  function family(raw) {
    const f = clone(raw);
    if (!object(f) || !name(f.id) || !name(f.kind) || !Number.isSafeInteger(f.version) || f.version < 1) throw new Error('Asset family needs id, kind and a positive integer version');
    if (!f.bounds || !vector(f.bounds.min) || !vector(f.bounds.max) || f.bounds.min.some((v, i) => v > f.bounds.max[i])) throw new Error('Invalid asset bounds: ' + f.id);
    f.tags = f.tags || []; f.sockets = f.sockets || {}; f.requiredSockets = f.requiredSockets || [];
    if (!Array.isArray(f.tags) || !f.tags.every(name) || !object(f.sockets) || !Array.isArray(f.requiredSockets) || !f.requiredSockets.every(name)) throw new Error('Invalid asset tags or sockets: ' + f.id);
    for (const [id, socket] of Object.entries(f.sockets)) if (!name(id) || !object(socket) || !vector(socket.p) || !vector(socket.dir) || Math.hypot(...socket.dir) < 1e-9) throw new Error('Invalid asset socket: ' + id);
    for (const id of f.requiredSockets) if (!has(f.sockets, id)) throw new Error('Family lacks its required socket: ' + id);
    if (!Array.isArray(f.variants) || !f.variants.length) throw new Error('Asset family needs variants: ' + f.id);
    const seen = new Set(); let weight = 0;
    for (const v of f.variants) {
      if (!object(v) || !name(v.id) || seen.has(v.id) || !object(v.recipe) || !name(v.recipe.type)) throw new Error('Invalid or duplicate asset variant in ' + f.id);
      if (v.weight === undefined) v.weight = 1;
      if (!Number.isFinite(v.weight) || v.weight < 0) throw new Error('Invalid variant weight: ' + v.id);
      weight += v.weight; seen.add(v.id);
    }
    if (weight <= 0) throw new Error('Asset family needs a positive variant weight');
    return f;
  }
  A.assets = initial => {
    let families = {};
    const reg = {};
    reg.register = raw => {
      const f = family(raw), old = families[f.id];
      if (old && (f.version < old.version || (f.version === old.version && JSON.stringify(f) !== JSON.stringify(old)))) throw new Error('Changed asset families need a newer version: ' + f.id);
      families[f.id] = f;
      return f.id;
    };
    reg.get = id => has(families, id) ? freeze(clone(families[id])) : null;
    reg.list = filter => freeze(Object.values(families).filter(f => !filter || (filter.kind ? f.kind === filter.kind : true) && (filter.tag ? f.tags.includes(filter.tag) : true)).map(f => clone(f)));
    reg.export = () => freeze({ format: 'ink-studio/asset-families', version: 1, families: Object.values(families).map(f => clone(f)) });
    reg.load = manifest => {
      const data = clone(typeof manifest === 'string' ? JSON.parse(manifest) : manifest);
      if (!data || data.format !== 'ink-studio/asset-families' || data.version !== 1 || !Array.isArray(data.families)) throw new Error('Invalid asset family manifest');
      const before = families; families = clone(families);
      try { const seen = new Set(); for (const f of data.families) { if (seen.has(f.id)) throw new Error('Duplicate family: ' + f.id); seen.add(f.id); reg.register(f); } }
      catch (err) { families = before; throw err; }
      return reg;
    };
    reg.choose = (id, key, seed, variant) => {
      const f = reg.get(id);
      if (!f) throw new Error('Unknown asset family: ' + id);
      if (variant) {
        const selected = f.variants.find(v => v.id === variant);
        if (!selected) throw new Error('Unknown variant ' + variant + ' in ' + id);
        return selected;
      }
      let value = hash(String(key), seed) / 4294967296 * f.variants.reduce((n, v) => n + v.weight, 0);
      for (const v of f.variants) { value -= v.weight; if (value < 0) return v; }
      return f.variants[f.variants.length - 1];
    };
    reg.compatible = (from, to) => {
      const a = reg.get(from), b = reg.get(to);
      return !!a && !!b && a.kind === b.kind && (a.compatibility || a.kind) === (b.compatibility || b.kind) && a.requiredSockets.every(id => has(b.sockets, id));
    };
    reg.resolve = (doc, id) => {
      const env = snapshot(doc).environment, map = env.assetReplacements || {}, seen = new Set();
      if (!object(map)) throw new Error('Asset replacements must be a map');
      while (has(map, id)) {
        if (seen.has(id)) throw new Error('Cyclic asset replacement');
        seen.add(id);
        if (!reg.compatible(id, map[id])) throw new Error('Incompatible asset replacement: ' + id + ' → ' + map[id]);
        id = map[id];
      }
      const f = reg.get(id);
      if (!f) throw new Error('Unknown asset family: ' + id);
      return f;
    };
    reg.replace = (doc, from, to) => {
      if (!reg.compatible(from, to)) throw new Error('Incompatible asset replacement: ' + from + ' → ' + to);
      const proposed = clone(doc.snapshot());
      proposed.environment = merge(proposed.environment, { assetReplacements: { [from]: to } });
      reg.resolve(proposed, from);
      return transaction(doc, 'Replace asset family', () => {
        doc.setEnvironment({ assetReplacements: { [from]: to } });
      });
    };
    if (initial) reg.load(initial);
    return reg;
  };
})(KIT);
