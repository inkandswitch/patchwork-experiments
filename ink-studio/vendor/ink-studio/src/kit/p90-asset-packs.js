/* Portable declarative asset packs and per-scene replacement stacks. */
(function (K) {
  const A = K.authoring, { clone, freeze } = A.data;
  const format = 'ink-studio/asset-pack';
  const bundleFormat = 'ink-studio/asset-bundle';
  const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  const canonical = value => JSON.stringify(value, (_, node) => object(node)
    ? Object.fromEntries(Object.keys(node).sort().map(key => [key,node[key]]))
    : node);
  const manifests = new WeakSet();

  function manifest(input) {
    if (manifests.has(input)) return input;
    const value = clone(parse(input));
    if (!object(value) || value.format !== format || value.version !== 1 || !identifier(value.id) ||
        !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100)
      throw Error('Invalid versioned asset pack');
    const { families: sourceFamilies = [], looks: sourceLooks = [], materials: sourceMaterials = [],
      environments: sourceEnvironments = [], environmentImages: sourceImages = [] } = value;
    if (!Array.isArray(sourceFamilies) || !Array.isArray(sourceLooks) || sourceLooks.length > 128 ||
        !Array.isArray(sourceMaterials) || sourceMaterials.length > 256 ||
        !Array.isArray(sourceEnvironments) || sourceEnvironments.length > 128 ||
        !Array.isArray(sourceImages) || sourceImages.length > 64 ||
        (!sourceFamilies.length && !sourceLooks.length && !sourceMaterials.length && !sourceEnvironments.length && !sourceImages.length))
      throw Error('An asset pack needs families, looks, materials, environments or environment images');
    const registry = A.assets();
    registry.load({ format: 'ink-studio/asset-families', version: 1, families: sourceFamilies });
    const families = registry.list();
    for (const family of families) {
      if (!family.id.startsWith(value.id + '/') || !identifier(family.id.slice(value.id.length + 1)))
        throw Error('Asset family must be namespaced by its pack: ' + family.id);
    }
    const replacements = value.replacements ?? {};
    if (!object(replacements)) throw Error('Pack replacements must be a map');
    for (const [from, to] of Object.entries(replacements)) {
      if (!from.trim() || !registry.get(to)) throw Error('Replacement must name a family in its own pack');
    }
    const looks = sourceLooks.map(look => A.looks.definition(look, value.id));
    if (new Set(looks.map(look => look.id)).size !== looks.length) throw Error('Duplicate look asset in ' + value.id);
    const materials = sourceMaterials.map(material => A.physicalMaterials.definition(material, value.id));
    if (new Set(materials.map(material => material.id)).size !== materials.length)
      throw Error('Duplicate physical material in ' + value.id);
    const environments = sourceEnvironments.map(environment => A.environments.definition(environment,value.id));
    const environmentImages = sourceImages.map(image => A.environments.image(image,value.id));
    if (new Set(environments.map(environment => environment.id)).size !== environments.length)
      throw Error('Duplicate environment preset in '+value.id);
    if (new Set(environmentImages.map(image => image.id)).size !== environmentImages.length)
      throw Error('Duplicate environment image in '+value.id);
    if (environmentImages.reduce((total,image) => total+image.width*image.height,0) > 2097152)
      throw Error('Environment images exceed the pack pixel budget');
    const result = freeze({ format, version: 1, id: value.id, revision: value.revision, title: value.title.trim(),
      families, replacements, ...(looks.length && { looks }), ...(materials.length && { materials }),
      ...(environments.length && { environments }), ...(environmentImages.length && { environmentImages }) });
    manifests.add(result);
    return result;
  }

  function packMap(packs) {
    if (!Array.isArray(packs)) throw Error('Expected an array of asset packs');
    const index = new Map();
    for (const raw of packs) {
      const pack = manifest(raw);
      if (index.has(pack.id)) throw Error('Duplicate asset pack: ' + pack.id);
      index.set(pack.id,pack);
    }
    return index;
  }

  function bundle(packs, ids) {
    const index = packMap(packs);
    if (ids !== undefined && (!Array.isArray(ids) ||
        !Array.from(ids).every(id => index.has(id)) || new Set(ids).size !== ids.length))
      throw Error('Bundle selection needs unique installed pack IDs');
    const include = new Set(ids ?? index.keys());
    if (!include.size) throw Error('An asset bundle needs at least one pack');

    const owner = new Map(), images = new Map();
    for (const pack of index.values()) {
      for (const family of pack.families) owner.set(family.id,pack.id);
      for (const image of pack.environmentImages ?? []) images.set(image.id,{ image,pack:pack.id,revision:pack.revision });
    }
    const artwork = { getEnvironmentImage:id => images.get(id) };
    for (const id of include) {
      const { replacements, environments } = index.get(id);
      for (const familyId of Object.keys(replacements)) {
        const dependency = owner.get(familyId);
        if (dependency !== undefined) include.add(dependency);
      }
      for (const environment of environments ?? []) for (const ref of A.environments.references(environment.settings))
        include.add(A.environments.requireImage(artwork,ref).pack);
    }
    return freeze({format:bundleFormat,version:1,packs:[...index.values()].filter(pack=>include.has(pack.id))});
  }

  function merge(installed, input) {
    const index = packMap(installed), payload = parse(input);
    let incoming;
    if (payload?.format === bundleFormat) {
      if (payload.version !== 1 || !Array.isArray(payload.packs) || !payload.packs.length)
        throw Error('Invalid versioned asset bundle');
      incoming = packMap(payload.packs).values();
    } else incoming = [manifest(payload)];

    const added = [], updated = [], unchanged = [], keptNewer = [];
    for (const next of incoming) {
      const previous = index.get(next.id);
      if (previous && next.revision < previous.revision) {
        keptNewer.push(next.id);
        continue;
      }
      if (previous && next.revision === previous.revision) {
        if (canonical(previous) !== canonical(next))
          throw Error('Conflicting content for ' + next.id + ' revision ' + next.revision);
        unchanged.push(next.id);
        continue;
      }
      index.set(next.id,next);
      (previous ? updated : added).push(next.id);
    }
    return freeze({packs:[...index.values()],added,updated,unchanged,keptNewer});
  }

  // Live imports can update the contents of a family while scenes retain its ID.
  function reviseFamily(input, id, changes) {
    const pack = manifest(input), index = pack.families.findIndex(f => f.id === id);
    if (index === -1) throw Error('Unknown asset family: ' + id);
    const fields = ['label','tags','bounds','sockets','variants'];
    if (!object(changes) || Object.keys(changes).some(key => !fields.includes(key)))
      throw Error('Asset revision needs editable family fields');

    const previous = pack.families[index], families = pack.families.slice();
    families[index] = { ...previous, ...changes };
    const staged = manifest({ ...pack, families });
    if (canonical(previous) === canonical(staged.families[index])) return pack;

    families[index] = { ...staged.families[index], version: previous.version + 1 };
    return manifest({ ...pack, revision: pack.revision + 1, families });
  }

  function reviseLook(input, id, changes) {
    const pack = manifest(input), looks = pack.looks?.slice() ?? [];
    const index = looks.findIndex(look => look.id === id);
    if (index === -1) throw Error('Unknown look asset: ' + id);
    if (!object(changes) || Object.keys(changes).some(key => !['label', 'params', 'stack', 'palette', 'lightingRamp', 'mask', 'stage', 'paletteStage', 'order', 'weight'].includes(key)))
      throw Error('Look revision needs editable look fields');
    looks[index] = A.looks.definition(clone({ ...looks[index], ...changes }), pack.id);
    if (canonical(looks[index]) === canonical(pack.looks[index])) return pack;
    return manifest({ ...pack, revision: pack.revision + 1, looks });
  }

  function savePaletteLook(definition, input) {
    const pack = input === undefined ? null : manifest(input);
    const id = definition?.id;
    const packId = typeof id === 'string' ? id.split('/')[0] : undefined;
    if (pack && pack.id !== packId) throw Error('Palette look must belong to pack ' + pack.id);
    const previous = pack?.looks?.find(look => look.id === id);
    const look = A.looks.paletteFinding(definition, previous);
    if (!pack) return manifest({ format, version:1, id:packId, revision:1, title:look.label, looks:[look] });
    if (previous) {
      const { id, ...changes } = look;
      return reviseLook(pack, id, changes);
    }
    return manifest({ ...pack, revision:pack.revision+1, looks:[...(pack.looks ?? []),look] });
  }

  function reviseEnvironment(input, id, changes) {
    const pack = manifest(input), environments = pack.environments?.slice() ?? [];
    const index = environments.findIndex(environment => environment.id === id);
    if (index === -1) throw Error('Unknown environment preset: '+id);
    if (!object(changes) || Object.keys(changes).some(key => !['label','settings'].includes(key)))
      throw Error('Environment revision needs a label or settings');
    const next = A.environments.definition(clone({ ...environments[index], ...changes }),pack.id);
    if (canonical(next) === canonical(environments[index])) return pack;
    environments[index] = next;
    return manifest({ ...pack, revision:pack.revision+1, environments });
  }

  function create({ families = [], packs = [] } = {}) {
    if (!Array.isArray(families)) throw Error('Asset catalog needs a family array');
    const registry = A.assets();
    registry.load({ format: 'ink-studio/asset-families', version: 1, families });
    const extensions = packMap(packs), owners = new Map(), looks = new Map(), materials = new Map();
    const environments = new Map(), images = new Map();
    for (const pack of extensions.values()) {
      for (const look of pack.looks ?? []) looks.set(look.id, freeze({ look, pack: pack.id, revision: pack.revision }));
      for (const material of pack.materials ?? []) materials.set(material.id,freeze({material,pack:pack.id,revision:pack.revision}));
      for (const environment of pack.environments ?? [])
        environments.set(environment.id,freeze({ environment,pack:pack.id,revision:pack.revision }));
      for (const image of pack.environmentImages ?? [])
        images.set(image.id,freeze({ image,pack:pack.id,revision:pack.revision }));
      for (const family of pack.families) {
        if (registry.get(family.id)) throw Error('Duplicate asset family: ' + family.id);
        registry.register(family);
        owners.set(family.id, pack.id);
      }
    }
    const listed = registry.list(), byId = new Map(listed.map(family => [family.id, family]));
    for (const pack of extensions.values()) {
      for (const [from, to] of Object.entries(pack.replacements)) {
        if (!registry.compatible(from, to)) throw Error('Incompatible asset replacement: ' + from + ' → ' + to);
      }
      compile([pack.id]);
    }

    function compile(enabled = []) {
      if (!Array.isArray(enabled) || !Array.from(enabled).every(identifier) || new Set(enabled).size !== enabled.length)
        throw Error('Asset pack selection needs unique IDs');
      const missing = [], replacements = Object.create(null);
      for (const id of enabled) {
        const pack = extensions.get(id);
        if (!pack) missing.push(id);
        else Object.assign(replacements, pack.replacements);
      }
      const scene = { environment: { assetReplacements: replacements } }, resolved = new Map();
      for (const id of Object.keys(replacements)) resolved.set(id, registry.resolve(scene, id));
      const resolve = id => resolved.get(id) ?? byId.get(id) ?? null;
      return Object.freeze({
        missing: Object.freeze(missing),
        replacements: Object.freeze({ ...replacements }),
        resolve,
        choose(id, key, seed, variant) {
          const family = resolve(id);
          if (!family) return null;
          const requested = family.variants.some(item => item.id === variant) ? variant : undefined;
          return registry.choose(family.id, key, seed, requested);
        }
      });
    }
    const catalog = Object.freeze({
      packs: Object.freeze([...extensions.values()]),
      families: listed,
      looks: Object.freeze([...looks.values()]),
      materials: Object.freeze([...materials.values()]),
      environments: Object.freeze([...environments.values()]),
      environmentImages: Object.freeze([...images.values()]),
      getEnvironment: id => environments.get(id) ?? null,
      getEnvironmentImage: id => images.get(id) ?? null,
      getMaterial: id => materials.get(id) ?? null,
      getLook: id => looks.get(id) ?? null,
      get: id => byId.get(id) ?? null,
      owner: id => owners.get(id) ?? null,
      compile
    });
    for (const id of environments.keys()) A.environments.bind(id,catalog);
    return catalog;
  }
  A.assetPacks = Object.freeze({ create, manifest, bundle, merge, reviseFamily, reviseLook, reviseEnvironment, savePaletteLook });
})(KIT);
