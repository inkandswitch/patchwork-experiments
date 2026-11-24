/* Headless editing over the diorama JSON used by the CLI. */
(function (K) {
  const A = K.authoring, DIO = K.diorama;
  const { clone, freeze } = K.procedural.data;
  const modes = ['replace', 'add', 'toggle', 'remove'];
  const encodeSlot = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const stack = solid => Array.isArray(solid.modifiers) ? solid.modifiers : [];
  function patchFields(original, patch) {
    const result = { ...original };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result[key] = value;
    }
    return result;
  }

  function sceneIndex(scene, env) {
    const solids = scene.solids ?? [];
    const nodes = new Map(), byEntity = new Map(), roots = [], parts = new Map(), groups = new Map();
    function parent(kind, name) {
      const node = { key: kind + ':' + name, kind, name, children: [] };
      nodes.set(node.key, node);
      return node;
    }

    for (const name of new Set([...Object.keys(scene.parts ?? {}), ...solids.map(solid => solid.part).filter(Boolean)]))
      parts.set(name, parent('part', name));
    for (const [name, node] of parts) {
      const container = parts.get(scene.parts?.[name]?.parent);
      (container?.children ?? roots).push(node);
    }
    for (const name of Object.keys(scene.groups ?? {})) {
      const node = parent('group', name);
      groups.set(name, node);
      roots.push(node);
    }

    function solidNode(solid, path, operand, modifier) {
      const key = solid.id === undefined ? 'slot:' + path.join('/') : 'solid:' + solid.id;
      const operands = DIO.operandFields(solid).filter(field => record(solid[field]));
      const modifierOperands = stack(solid).filter(entry => typeof entry?.id === 'string' && record(entry.shape));
      const node = { key, kind: 'solid', shape: solid.kind, ...(operand && { operand }), ...(modifier && { modifier }),
        name: solid.id ?? solid.kind, solid, children: [
          ...operands.map(field => solidNode(solid[field], [...path, field], field)),
          ...modifierOperands.map(({ id, shape }) => solidNode(shape, [...path, 'modifiers', encodeSlot(id), 'shape'], 'shape', id))
        ] };
      nodes.set(key, node);
      if (solid.id !== undefined) byEntity.set(solid.id, key);
      return node;
    }
    const indexedNodes = solids.map((solid, i) => {
      const node = solidNode(solid, [i]);
      const owner = parts.get(solid.part) ?? groups.get(solid.group);
      (owner?.children ?? roots).push(node);
      return node;
    });
    const linked = A.scenePrefabs.expand(scene, env).instances;
    for (const [id, { instance, revision, solids }] of linked) {
      const node = Object.assign(parent('prefab', id), { instance, revision, solids });
      for (const name of solids) byEntity.set(name, node.key);
      roots.push(node);
    }
    const byStroke = new Map();
    if (scene.brushRegion) {
      const brushRegion = parent('brushRegion', 'Brush region');
      const strokes = scene.brushRegion.strokes;
      for (const stroke of Array.isArray(strokes) ? strokes : []) {
        if (typeof stroke?.id !== 'string') continue;
        const key = 'stroke:' + stroke.id;
        const node = { key, kind: 'stroke', name: stroke.id, stroke, children: [] };
        nodes.set(key, node);
        byStroke.set('brush-stroke:' + stroke.id, key);
        brushRegion.children.push(node);
      }
      roots.push(brushRegion);
    }
    const tree = freeze({ key: 'scene:' + scene.id, kind: 'scene', name: scene.name ?? scene.id, children: roots });
    nodes.set(tree.key, tree);

    // A preview tag identifies anonymous geometry without replacing its render ownership.
    const usedTags = new Set([...nodes.values()].flatMap(node => node.solid?.tags ?? []));
    const byTag = new Map(), preview = { ...scene, solids: solids.map((solid, i) => {
      if (solid.id !== undefined) return solid;
      let tag = '@editor/' + i;
      while (usedTags.has(tag)) tag += '_';
      usedTags.add(tag);
      byTag.set(tag, indexedNodes[i].key);
      return { ...solid, tags: [...(solid.tags ?? []), tag] };
    }) };
    return { tree, nodes, byEntity, byTag, byStroke, preview: freeze(preview) };
  }

  function create(source, { env, historyLimit } = {}) {
    const input = typeof source === 'string' ? JSON.parse(source) : source;
    if (A.projectBundles && input?.format === A.projectBundles.format)
      return A.projectBundles.open(input).editor({ env, historyLimit });
    const baked = input?.data instanceof Float32Array;
    if (baked && !input.spec) throw new TypeError('This splat bake has no retained diorama source');
    const scene = clone(baked ? input.spec : input);
    const buildEnv = { ...env, brushSession: A.brushRegions.create(), bakeCache: env?.bakeCache ?? A.bakeCache.create() };
    function validate(candidate, bindings = buildEnv) {
      const problems = DIO.check(candidate, bindings);
      if (problems.some(problem => problem.level === 'error')) {
        const error = new Error(DIO.report(problems));
        error.problems = problems;
        throw error;
      }
    }
    validate(scene);
    const document = A.document({ format: A.data.format, version: A.data.version, id: scene.id,
      seed: 1, nextId: 1, entities: {}, styles: {}, environment: scene }, { historyLimit });
    const snapshot = () => document.snapshot().environment;
    document.beforeCommit(() => validate(snapshot()));

    let selection = freeze([]), indexScene, index, previewWorld, cachedPick;
    function current() {
      const scene = snapshot();
      if (scene !== indexScene || !index) {
        indexScene = scene;
        index = sceneIndex(scene, buildEnv);
        previewWorld = cachedPick = undefined;
      }
      return index;
    }
    function keys(value, solidsOnly = false) {
      const requested = typeof value === 'string' ? [value] : value;
      const kinds = solidsOnly ? ['solid'] : ['solid', 'stroke', 'prefab'];
      if (!Array.isArray(requested) || Array.from(requested).some(key => !kinds.includes(current().nodes.get(key)?.kind)))
        throw new RangeError(solidsOnly ? 'Edits need keys of solids in the scene tree' :
          'Selection needs keys of solids, prefab instances, or brush strokes in the scene tree');
      return [...new Set(requested)];
    }

    function selectedKeys() {
      const { nodes } = current();
      return freeze(selection.filter(key => ['solid', 'stroke', 'prefab'].includes(nodes.get(key)?.kind)));
    }

    function select(requested, { mode = 'replace' } = {}) {
      if (!modes.includes(mode)) throw new RangeError('Selection mode must be replace, add, toggle or remove');
      const next = new Set(mode === 'replace' ? [] : selectedKeys());
      for (const key of keys(requested)) {
        if (mode === 'remove' || mode === 'toggle' && next.has(key)) next.delete(key);
        else next.add(key);
      }
      selection = freeze([...next]);
      return selection;
    }

    function edit(label, targets, update) {
      const selected = new Set(keys(targets, true).map(key => current().nodes.get(key).solid));
      if (!selected.size) return false;
      function rewrite(solid) {
        let next = solid;
        for (const field of DIO.operandFields(solid)) {
          if (!record(solid[field])) continue;
          const child = rewrite(solid[field]);
          if (child !== solid[field]) next = { ...next, [field]: child };
        }
        const modifiers = stack(solid).map(entry => {
          if (!record(entry?.shape)) return entry;
          const shape = rewrite(entry.shape);
          return shape === entry.shape ? entry : { ...entry, shape };
        });
        if (modifiers.some((entry, i) => entry !== solid.modifiers[i])) next = { ...next, modifiers };
        return selected.has(solid) ? update(next) : next;
      }
      const write = () => document.setEnvironment({ solids: (snapshot().solids ?? []).map(rewrite) });
      if (document.pending()) write();
      else document.transact(label, write);
      return true;
    }

    function setTransform(patch, targets = selectedKeys()) {
      const values = clone(patch);
      if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new TypeError('A transform edit needs an object');
      if (!Object.keys(values).length) return false;
      return edit('Transform solids', targets, solid => ({ ...solid, transform: { ...solid.transform, ...values } }));
    }
    function updateShape(patch, targets = selectedKeys()) {
      const fields = clone(patch);
      if (!record(fields)) throw new TypeError('A shape edit needs an object');
      return edit('Edit shape', targets, solid => {
        const { need, may } = DIO.kinds[solid.kind];
        for (const field of Object.keys(fields)) {
          if (!Object.hasOwn(need, field) && !Object.hasOwn(may ?? {}, field))
            throw new RangeError('Unknown ' + solid.kind + ' shape parameter: ' + field);
        }
        return patchFields(solid, fields);
      });
    }

    function setModifiers(modifiers, targets = selectedKeys()) {
      const list = clone(modifiers);
      if (!Array.isArray(list)) throw new TypeError('Modifiers must be an ordered list');
      return edit('Set sculpt modifiers', targets, solid =>
        list.length ? { ...solid, modifiers: list } : patchFields(solid, { modifiers: null }));
    }

    function updateModifier(id, patch, targets = selectedKeys()) {
      const fields = clone(patch);
      if (!TargetSelectors.name(id) || !record(fields) || Object.hasOwn(fields, 'id') || Object.hasOwn(fields, 'kind'))
        throw new TypeError('A modifier edit needs an ID and parameter fields');
      return edit('Edit sculpt modifier', targets, solid => {
        const modifiers = stack(solid);
        if (!modifiers.some(entry => entry?.id === id)) throw new RangeError('Unknown modifier: ' + id);
        return { ...solid, modifiers: modifiers.map(entry => entry?.id === id ? patchFields(entry, fields) : entry) };
      });
    }

    function setMaterial(material, targets = selectedKeys()) {
      const value = clone(material);
      return edit('Set solid material', targets, solid => ({ ...solid, mat: value }));
    }
    function setSurfaceState(state, targets = selectedKeys()) {
      const value = clone(state);
      return edit('Set rest surface state', targets, solid => patchFields(solid, { surfaceState: value }));
    }
    function setRole(name, ramp) {
      if (!TargetSelectors.name(name)) throw new TypeError('A material role needs a name');
      const indices = clone(ramp);
      if (!Array.isArray(indices) || !indices.length) throw new TypeError('A material role needs a nonempty palette ramp');
      const write = () => document.setEnvironment({ roles: { [name]: indices } });
      if (document.pending()) write();
      else document.transact('Edit material role ' + name, write);
    }

    const build = (inputs = buildEnv.parameterInputs) => Object.assign(
      DIO.build(current().preview, { ...buildEnv, parameterInputs: inputs }), { spec: snapshot() });

    function refreshPrefabs(prefabs, { assets = buildEnv.assets } = {}) {
      const bindings = { ...buildEnv, assets, prefabs: freeze(clone(prefabs)) };
      validate(snapshot(), bindings);
      Object.assign(buildEnv, bindings, { brushSession: A.brushRegions.create() });
      indexScene = undefined;
    }

    function setPrefabInstance(id, instance) {
      if (!K.world.data.id(id)) throw new TypeError('A prefab placement needs an instance ID');
      const value = clone(instance);
      const instances = { ...snapshot().instances };
      if (value === null) delete instances[id];
      else instances[id] = value;
      const write = () => {
        document.setEnvironment({ instances: null });
        document.setEnvironment({ instances });
      };
      if (document.pending()) write();
      else document.transact('Edit prefab instance ' + id, write);
    }

    function setBrushRegion(region) {
      const value = clone(region);
      const write = () => document.setEnvironment({ brushRegion: value });
      if (document.pending()) write();
      else document.transact('Select brush region', write);
    }

    function setBreakables(definitions) {
      const value = clone(definitions);
      function write() {
        document.setEnvironment({ breakables: null });
        if (value !== null) document.setEnvironment({ breakables: value });
        document.preview();
        return (previewWorld = build());
      }
      if (!document.pending()) return document.transact('Set breakable groups', write);
      try {
        return write();
      } catch (error) {
        document.cancel();
        throw error;
      }
    }

    function applyBrush(stroke) {
      const value = clone(stroke);
      const region = snapshot().brushRegion;
      if (!region) throw new Error('Select a brush region before applying a stroke');
      function edit() {
        document.setEnvironment({ brushRegion: { strokes: [...(region.strokes ?? []), value] } });
        document.preview();
        const world = build();
        previewWorld = world;
        return world;
      }
      if (!document.pending()) return document.transact('Brush ' + (value?.mode ?? 'edit'), edit);
      try {
        return edit();
      } catch (error) {
        document.cancel();
        throw error;
      }
    }

    function pick(ray, { world, time, reconstruction, sampleWithdrawal } = {}) {
      const { byEntity, byTag, byStroke } = current();
      const rendered = world ?? (previewWorld ??= build());
      const at = time ?? rendered.lookSnapshot?.time ?? 0;
      // A caller-owned world can be animated or edited in place between picks.
      if (world || !cachedPick || cachedPick.time !== at || cachedPick.reconstruction !== reconstruction ||
          cachedPick.sampleWithdrawal !== sampleWithdrawal) {
        const posed = K.reconstruction.frame(rendered, at, reconstruction ?? rendered.look?.reconstruction);
        const query = K.procedural.contributions.create(posed, { time: at, sampleWithdrawal });
        cachedPick = { time: at, reconstruction, sampleWithdrawal, query };
      }
      const result = cachedPick.query.ray(ray);
      if (world) cachedPick = undefined;
      for (const hit of [result.dominant, ...result.contributions]) {
        const target = hit?.target;
        const tag = target?.tags?.find(tag => byTag.has(tag));
        const stroke = target?.surface === 'brush-region' ? byStroke.get(target.entity) : undefined;
        const key = stroke ?? (tag ? byTag.get(tag) : byEntity.get(target?.entity));
        if (key) return { key, hit };
      }
      return null;
    }

    return Object.freeze({
      snapshot,
      serialize: (space = 2) => JSON.stringify(snapshot(), null, space),
      tree: () => current().tree,
      node: key => current().nodes.get(key),
      selection: selectedKeys,
      select,
      pick,
      suggestBreakable({ world, ...options } = {}) {
        current();
        return A.breakables.suggest(world ?? (previewWorld ??= build()), options);
      },
      selectRay(ray, { mode = 'replace', ...options } = {}) {
        const result = pick(ray, options);
        select(result ? [result.key] : [], { mode });
        return result;
      },
      setTransform,
      updateShape,
      setModifiers,
      updateModifier,
      setPrefabInstance,
      refreshPrefabs,
      setBrushRegion,
      setBreakables,
      applyBrush,
      setMaterial,
      setSurfaceState,
      setRole,
      materials: () => freeze(clone(DIO.sceneMaterials(snapshot()))),
      build,
      buildIncremental(previousWorld, inputs) {
        const world = build(inputs);
        return { world, frame: A.bakeCache.frameDiff(previousWorld, world) };
      },
      cacheStats: () => buildEnv.bakeCache.stats(),
      begin: label => { document.begin(label); },
      preview() { document.preview(); return snapshot(); },
      commit: () => document.commit(),
      cancel: () => document.cancel(),
      undo: () => document.undo(),
      redo: () => document.redo(),
      history: () => document.history(),
      revision: () => document.revision(),
      onChange(listener) {
        if (typeof listener !== 'function') throw new TypeError('Scene change listener must be a function');
        return document.onChange(({ type, label, revision }) => listener({ type, label, revision, snapshot: snapshot() }));
      }
    });
  }

  A.sceneEditor = Object.freeze({ create });
})(KIT);
