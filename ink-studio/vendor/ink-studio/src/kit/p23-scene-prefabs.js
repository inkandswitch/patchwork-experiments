/* Expand linked visual recipes into the native diorama schema at build time. */
(function (K) {
  const A = K.authoring, DIO = K.diorama, { M, V } = K;
  const tables = ['solids', 'parts', 'groups', 'motion', 'effects'];
  const axes = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];

  function frame(raw, fallback) {
    const { translation, rotation, scale, pivot = fallback ?? [0, 0, 0] } =
      DIO.solidTransform(raw === undefined ? {} : raw);
    const basis = rotation.reduce((out, angle, i) => M.mul(out, M.rot(axes[i], angle)), M.id());
    const direction = value => M.app(basis, value);
    const offset = V.sub(V.add(pivot, translation), V.mul(direction(pivot), scale));
    return { scale, basis, direction, point: value => V.mad(offset, direction(value), scale) };
  }

  function combine(placement, solid) {
    const local = frame(solid.transform, solid.at);
    const rotation = M.mul(placement.basis, local.basis);
    const pitch = Math.atan2(-rotation[5], Math.hypot(rotation[2], rotation[8]));
    const level = Math.hypot(rotation[2], rotation[8]) > 1e-8;
    const yaw = level ? Math.atan2(rotation[2], rotation[8]) : Math.atan2(-rotation[6], rotation[0]);
    const roll = level ? Math.atan2(rotation[3], rotation[4]) : 0;
    return { translation: placement.point(local.point([0, 0, 0])), rotation: [yaw, pitch, roll],
      scale: placement.scale * local.scale, pivot: [0, 0, 0] };
  }

  function scopedSolid(solid, name, tasks, { primary, key, placement, prefab }) {
    const next = { ...solid };
    if (primary || solid.id !== undefined) next.id = name(primary ? key : solid.id);
    if (primary) {
      next.prefabs = [prefab, ...new Set((solid.prefabs ?? []).filter(value => value !== prefab))];
      if (placement) next.transform = combine(placement, solid);
    }
    if (solid.part !== undefined) next.part = name(solid.part);
    if (solid.group !== undefined) next.group = name(solid.group);
    for (const field of DIO.operandFields(solid)) if (tasks.record(solid[field]))
      next[field] = scopedSolid(solid[field], name, tasks, { primary: false });
    if (Array.isArray(solid.modifiers)) next.modifiers = solid.modifiers.map(row => tasks.record(row?.shape) ?
      { ...row, shape: scopedSolid(row.shape, name, tasks, { primary: false }) } : row);
    return next;
  }

  function expand(source, { prefabs: external } = {}) {
    if (!source || source.prefabs === undefined && source.instances === undefined && source.prefabLibrary === undefined)
      return { spec: source, instances: new Map() };
    const W = K.world, tasks = W.data, { check, own, record, id, selector } = tasks;
    const { prefabs = {}, instances = {}, prefabLibrary, ...rest } = source;
    check(record(prefabs) && record(instances) && (external === undefined || record(external)), 'Expected prefab and instance maps');
    if (prefabLibrary !== undefined)
      check(typeof prefabLibrary === 'string' && prefabLibrary.length && external, 'Load the named prefabLibrary before building');
    const available = new Map();
    for (const [key, def] of [...Object.entries(external ?? {}), ...Object.entries(prefabs)]) {
      check(id(key) && record(def) && !available.has(key) && Number.isSafeInteger(def.revision) && def.revision >= 1 &&
        Object.keys(def).every(field => field === 'revision' || tables.includes(field)) && record(def.solids),
      'Invalid or duplicate visual prefab ' + key);
      for (const field of tables)
        check(def[field] === undefined || record(def[field]) && Object.entries(def[field]).every(([key, row]) => id(key) && record(row)),
          'Expected named records in prefab ' + key + '/' + field);
      available.set(key, def);
    }
    const spec = { ...rest, solids: [...(rest.solids ?? [])], parts: { ...rest.parts }, groups: { ...rest.groups },
      motion: [...(rest.motion ?? [])], effects: [...(rest.effects ?? [])] };
    const links = new Map();
    for (const [key, instance] of Object.entries(instances)) {
      try {
        check(id(key) && record(instance) &&
          Object.keys(instance).every(field => ['prefab', 'transform', 'overrides'].includes(field)) &&
          available.has(instance.prefab), 'Unknown visual prefab or invalid instance');
        const definition = available.get(instance.prefab);
        const edits = instance.overrides ?? [];
        check(Array.isArray(edits), 'Prefab overrides must be an ordered edit list');
        for (const edit of edits) {
          const path = selector(edit?.path);
          check(tables.includes(path[0]) && path.length >= 2 && id(path[1]) &&
            !(path[0] === 'solids' && path[2] === 'id') && ['set', 'merge', 'remove', 'test'].includes(edit.op),
          'Prefab overrides must address local records without changing their IDs');
        }
        const baseline = Object.fromEntries(tables.map(table => [table, definition[table] ?? {}]));
        // A missing member usually means the library revision retired it.
        // Refuse to recreate or silently discard overridden members.
        for (const edit of edits) {
          const [table, member] = selector(edit.path);
          check(own(baseline[table], member), 'Override refers to missing ' + table + '/' + member);
        }
        const resolved = W.apply(baseline, edits, { validate: null }).world;
        const name = local => key + '.' + local;
        const placement = instance.transform === undefined ? null : frame(instance.transform);
        const ids = [];
        for (const [local, solid] of Object.entries(resolved.solids)) {
          check(record(solid), 'Expected a solid at ' + local);
          const next = scopedSolid(solid, name, tasks, { primary: true, key: local, placement, prefab: instance.prefab });
          spec.solids.push(next);
          ids.push(next.id);
        }
        for (const [local, row] of Object.entries(resolved.parts)) {
          check(!own(spec.parts, name(local)), 'Part ID is already in use: ' + name(local));
          spec.parts[name(local)] = { ...row, ...(row.parent !== undefined && { parent: name(row.parent) }),
            ...(placement && row.joint && { joint: placement.point(row.joint) }) };
        }
        for (const [local, row] of Object.entries(resolved.groups)) {
          check(!own(spec.groups, name(local)), 'Group ID is already in use: ' + name(local));
          spec.groups[name(local)] = { ...row, ...(placement && { blend: row.blend * placement.scale }) };
        }
        for (const row of Object.values(resolved.motion)) {
          const next = { ...row, part: name(row.part) };
          if (placement) {
            next.axis = placement.direction(row.axis ?? [0, 1, 0]);
            if (row.do === 'bob') {
              next.amount = (row.amount ?? .3) * placement.scale;
              if (row.keys) next.keys = row.keys.map((value, i) => i % 2 ? value * placement.scale : value);
            }
          }
          spec.motion.push(next);
        }
        for (const row of Object.values(resolved.effects)) {
          const next = { ...row, ...(row.follow !== undefined && { follow: name(row.follow) }) };
          if (placement) {
            if (row.at) next.at = placement.point(row.at);
            if (row.v) next.v = V.mul(placement.direction(row.v), placement.scale);
            if (row.dir) next.dir = placement.direction(row.dir);
            for (const field of ['r', 'spread', 'speed']) if (row[field] !== undefined) next[field] *= placement.scale;
            if (row.box) {
              const [lo, hi] = row.box;
              const corners = [lo[0], hi[0]].flatMap(x => [lo[1], hi[1]].flatMap(y => [lo[2], hi[2]].map(z => placement.point([x, y, z]))));
              next.box = [Math.min, Math.max].map(fn => [0, 1, 2].map(i => fn(...corners.map(point => point[i]))));
            }
          }
          spec.effects.push(next);
        }
        links.set(key, { instance, revision: definition.revision, solids: ids });
      } catch (error) {
        const problem = { level: 'error', path: 'instances.' + key, problem: error.message, hint: '' };
        const failure = new Error(DIO.report([problem]));
        failure.problems = [problem];
        throw failure;
      }
    }
    return { spec, instances: links };
  }

  A.scenePrefabs = Object.freeze({ expand });
})(KIT);
