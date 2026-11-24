/* Native geometry, pixel surfaces, point lamps and targets share a live hierarchy. */
(function (K) {
  const G = K.sceneGraph,
    { M, V } = K,
    check = (ok, message) => {
      if (!ok) throw new TypeError('Scene bindings: ' + message);
    };
  const xyz = p => p && p.length === 3 && Array.from(p).every(Number.isFinite);
  const unit = v => V.mul(v, 1 / V.len(v));
  const owned = new WeakMap();
  function attach(world, graph, definition = {}) {
    check(
      world?.data instanceof Float32Array && world.count * 16 <= world.data.length && graph?.frame && graph?.snapshot,
      'expected a baked world and scene graph'
    );
    check(
      definition &&
        Object.keys(definition).every(k => ['geometry', 'sprites', 'lights', 'sockets', 'adapters'].includes(k)),
      'unknown binding table'
    );
    check(!owned.has(world), 'world already has hierarchy bindings');
    const stage = world.anim ?? K.stage(world),
      priorGraph = world.sceneGraph,
      priorRig = stage.rig,
      geometry = definition.geometry ?? [],
      sprites = definition.sprites ?? [],
      lights = definition.lights ?? [],
      sockets = definition.sockets ?? [],
      adapters = definition.adapters ?? [];
    for (const rows of [geometry, sprites, lights, sockets, adapters])
      check(Array.isArray(rows) && rows.length <= 4096, 'binding table exceeds budget');
    const ref = row => {
      const r = G.reference(row.socket === undefined ? row.node : { node: row.node, socket: row.socket });
      check(r && graph.has(r.node), 'unknown binding node');
      graph.frame(r);
      return r;
    };
    const generatedParts = new Set();
    const generatedPart = i => {
      let name = 'hierarchy.' + i;
      while (generatedParts.has(name) || (priorRig?.has(name) && priorRig.list[priorRig.names.indexOf(name)].length))
        name += '.';
      generatedParts.add(name);
      return name;
    };
    const claims = new Set(),
      prepared = geometry.map((row, i) => {
        check(
          row && Object.keys(row).every(k => ['node', 'socket', 'part', 'indices', 'selector'].includes(k)),
          'invalid geometry binding'
        );
        const reference = ref(row);
        check(
          [row.part, row.indices, row.selector].filter(v => v !== undefined).length === 1,
          'geometry needs part, indices or selector'
        );
        let indices;
        if (row.part !== undefined) {
          check(priorRig?.has(row.part), 'unknown rig part ' + row.part);
          indices = Array.from(priorRig.list[priorRig.names.indexOf(row.part)]);
        } else if (row.selector) {
          const selector = TargetSelectors.prepare(row.selector),
            metadata = TargetSelectors.index(world);
          indices = [];
          for (let j = 0; j < world.count; j++) if (TargetSelectors.matches(selector, metadata.row(j))) indices.push(j);
        } else {
          check(Array.isArray(row.indices) || ArrayBuffer.isView(row.indices), 'expected splat indices');
          indices = Array.from(row.indices);
        }
        check(
          indices.length &&
            new Set(indices).size === indices.length &&
            indices.every(j => Number.isSafeInteger(j) && j >= 0 && j < world.count && !claims.has(j)),
          'invalid or overlapping geometry ownership'
        );
        for (const j of indices) {
          check(row.part !== undefined || !priorRig?.bid[j], 'use an existing rig part binding for owned geometry');
          const kind = Math.round(world.data[j * 16 + 11]) % 16;
          check(kind !== 12 && kind !== 13, 'use a skeletal adapter for skinned geometry');
          claims.add(j);
        }
        return {
          ref: reference,
          indices,
          part: row.part ?? generatedPart(i),
          created: row.part === undefined,
          rest: G.inverse(graph.frame(reference))
        };
      });
    const ranges = new Map(),
      surfaceRows = sprites.map(row => {
        check(
          row && Object.keys(row).every(k => ['node', 'socket', 'atlas', 'first', 'count'].includes(k)),
          'invalid sprite binding'
        );
        const reference = ref(row),
          atlas = row.atlas ?? world.spriteSurfaces,
          { first = 0, count = atlas?.vertices?.length / 5 } = row;
        check(
          Object.isExtensible(atlas) &&
            atlas?.vertices instanceof Float32Array &&
            atlas.vertices.length % 15 === 0 &&
            Number.isSafeInteger(first) &&
            Number.isSafeInteger(count) &&
            first >= 0 &&
            count > 0 &&
            first % 3 === 0 &&
            count % 3 === 0 &&
            (first + count) * 5 <= atlas.vertices.length,
          'sprite binding needs a triangle-aligned vertex range'
        );
        const rows = ranges.get(atlas) ?? [];
        check(!rows.some(r => first < r.first + r.count && r.first < first + count), 'overlapping sprite ownership');
        rows.push({ first, count });
        ranges.set(atlas, rows);
        return {
          ref: reference,
          atlas,
          first,
          count,
          base: atlas.vertices.slice(first * 5, (first + count) * 5),
          rest: G.inverse(graph.frame(reference))
        };
      });
    const usedLights = new Set(),
      lightRows = lights.map(row => {
        check(
          row &&
            Object.keys(row).every(k =>
              ['node', 'socket', 'light', 'source', 'offset', 'direction', 'scaleRange', 'touch'].includes(k)
            ),
          'invalid light binding'
        );
        const reference = ref(row),
          light = row.light,
          source = row.source ?? { ...light };
        check(
          light && typeof light === 'object' && Object.isExtensible(light) && !usedLights.has(light),
          'expected a unique mutable light'
        );
        usedLights.add(light);
        const lamp = 'r' in light || 's' in light;
        check(!('shape' in light), 'area emitters need an adapter for their authored surface');
        const offset = row.offset ?? [0, 0, 0],
          direction = row.direction ?? [0, 0, 1],
          range = lamp ? source.r : source.radius;
        check(
          xyz(offset) &&
            xyz(direction) &&
            V.len(direction) > 0 &&
            Number.isFinite(range) &&
            range > 0 &&
            (row.scaleRange === undefined || typeof row.scaleRange === 'boolean') &&
            (row.touch === undefined || typeof row.touch === 'function'),
          'invalid light offset, direction or range'
        );
        check(Number.isFinite(lamp ? source.s : source.intensity), 'light needs finite strength');
        return {
          ref: reference,
          light,
          source,
          lamp,
          offset: Array.from(offset),
          direction: Array.from(direction),
          scaleRange: row.scaleRange ?? true,
          touch: row.touch,
          saved: { ...light, p: light.p?.slice(), dir: light.dir?.slice() }
        };
      });
    const socketNames = new Set();
    const socketRows = sockets.map(row => {
      check(
        row &&
          Object.keys(row).every(k => ['node', 'socket', 'name', 'direction'].includes(k)) &&
          typeof row.name === 'string' &&
          row.name.length,
        'invalid exported socket'
      );
      check(
        !socketNames.has(row.name) && xyz(row.direction ?? [0, 1, 0]) && V.len(row.direction ?? [0, 1, 0]) > 0,
        'invalid or duplicate exported socket'
      );
      socketNames.add(row.name);
      return {
        ref: ref(row),
        name: row.name,
        direction: row.direction ?? [0, 1, 0],
        previous: stage.sockets[row.name]
      };
    });
    const custom = adapters.map(row => {
      check(
        row &&
          Object.keys(row).every(k => ['node', 'socket', 'apply', 'restore'].includes(k)) &&
          typeof row.apply === 'function' &&
          (row.restore === undefined || typeof row.restore === 'function'),
        'invalid custom adapter'
      );
      return { ...row, ref: ref(row) };
    });
    let rig = priorRig,
      createdRig = false,
      disposed = false;
    if (prepared.length) {
      if (!rig) {
        rig = K.rig.fromGroups(stage, Object.fromEntries(prepared.map(r => [r.part, r.indices])));
        createdRig = true;
      } else for (const row of prepared) if (row.created) rig.assign(row.part, row.indices);
      for (const row of prepared) {
        const i = rig.names.indexOf(row.part),
          k = i * 12;
        row.initial = {
          matrix: Array.from(rig.M.subarray(k, k + 9)),
          position: Array.from(rig.M.subarray(k + 9, k + 12))
        };
      }
    }
    const controlled = Int32Array.from(claims),
      density = Float32Array.from(controlled, i => stage.D[i * 16 + 3]),
      lastAlpha = Float32Array.from(density),
      masked = new Uint8Array(controlled.length),
      rowByIndex = new Map();

    for (let j = 0; j < controlled.length; j++) rowByIndex.set(controlled[j], j);
    const resolve = row => {
      if (!graph.has(row.ref.node) || (row.ref.socket && !graph.node(row.ref.node).sockets.includes(row.ref.socket)))
        return row.last
          ? { ...row.last, visible: false, version: 'missing' }
          : { position: [0, 0, 0], matrix: M.id(), visible: false, version: 'missing' };
      return graph.frame(row.ref);
    };
    function pre() {
      if (disposed) return;
      for (let j = 0; j < controlled.length; j++) if (masked[j]) stage.D[controlled[j] * 16 + 3] = density[j];
    }
    function update() {
      if (disposed) return;
      graph.update();
      let moved = false;
      for (const row of prepared) {
        const frame = resolve(row);
        const part = rig.names.indexOf(row.part),
          actual = rig.M.subarray(part * 12, part * 12 + 12),
          changed = row.last?.version !== frame.version;
        if (changed) row.pose = G.compose(G.compose(frame, row.rest), row.initial);
        if (changed || row.applied?.some((v, i) => v !== actual[i])) {
          rig.set(row.part, row.pose.matrix, [0, 0, 0], row.pose.position);
          row.applied = rig.M.slice(part * 12, part * 12 + 12);
          moved = true;
        }
        row.last = frame;
      }
      if (moved) rig.apply();
      const changed = new Map();
      for (const row of surfaceRows) {
        const frame = resolve(row);
        if (row.last?.version !== frame.version || row.last?.visible !== frame.visible) {
          const delta = G.compose(frame, row.rest);
          for (let i = 0; i < row.count; i++) {
            const n = i * 5,
              target = (row.first + i) * 5,
              p = frame.visible ? G.point(delta, Array.from(row.base.subarray(n, n + 3))) : frame.position;
            row.atlas.vertices.set(p, target);
          }
          const prior = changed.get(row.atlas);
          changed.set(row.atlas, {
            first: Math.min(prior?.first ?? row.first, row.first),
            end: Math.max(prior?.end ?? row.first + row.count, row.first + row.count)
          });
        }
        row.last = frame;
      }
      for (const [atlas, range] of changed)
        SpriteSurface.markGeometryDirty(atlas, { first: range.first, count: range.end - range.first });
      for (const row of lightRows) {
        const frame = resolve(row),
          p = G.point(frame, row.offset),
          dir = unit(M.app(frame.matrix, row.direction)),
          scale = row.scaleRange
            ? Math.max(...[0, 1, 2].map(i => Math.hypot(frame.matrix[i], frame.matrix[i + 3], frame.matrix[i + 6])))
            : 1,
          { light, source, lamp } = row;
        const before = JSON.stringify([light.p, light.dir, light.off, light.r, light.radius, light.s, light.intensity]);
        light.p = p;
        light.dir = dir;
        if (lamp) {
          light.r = source.r * scale;
          light.s = source.s;
          light.off = !!source.off || !frame.visible;
        } else {
          light.radius = source.radius * scale;
          light.intensity = frame.visible && source.off !== true ? source.intensity : 0;
        }
        if (before !== JSON.stringify([light.p, light.dir, light.off, light.r, light.radius, light.s, light.intensity]))
          row.touch?.();
        row.last = frame;
      }
      for (const row of custom) {
        const frame = resolve(row);
        if (row.last?.version !== frame.version || row.last?.visible !== frame.visible)
          row.apply(frame, { world, graph, stage });
        row.last = frame;
      }
      for (const row of socketRows) {
        const frame = resolve(row);
        if (frame.visible) stage.socket(row.name, frame.position, null, unit(M.app(frame.matrix, row.direction)));
        else delete stage.sockets[row.name];
      }
    }
    function post() {
      if (disposed) return;
      for (const row of prepared) {
        const visible = row.last?.visible ?? false;
        for (const i of row.indices) {
          const j = rowByIndex.get(i),
            offset = i * 16 + 3,
            free = rig.free[i] || stage.physicsOwned?.[i];
          density[j] = stage.D[offset];
          const value = visible || free ? density[j] : 0;
          masked[j] = !visible && !free ? 1 : 0;
          stage.D[offset] = value;
          if (value !== lastAlpha[j]) stage.touch(i);
          lastAlpha[j] = value;
        }
      }
    }
    const binding = {
      pre,
      update,
      post,
      apply() {
        pre();
        update();
        post();
        return binding;
      },
      dispose() {
        if (disposed) return;
        pre();
        if (rig) {
          for (const row of prepared) {
            rig.set(row.part, row.initial.matrix, [0, 0, 0], row.initial.position);
          }
          rig.apply();
          for (const row of prepared) if (row.created) rig.assign(0, row.indices);
          if (createdRig) {
            stage.rig = priorRig;
            stage.parts = null;
          }
        }
        for (const row of surfaceRows) {
          row.atlas.vertices.set(row.base, row.first * 5);
          SpriteSurface.markGeometryDirty(row.atlas, { first: row.first, count: row.count });
        }
        for (const row of lightRows) {
          for (const key of ['p', 'dir', 'r', 's', 'off', 'radius', 'intensity'])
            if (row.saved[key] === undefined) delete row.light[key];
            else row.light[key] = Array.isArray(row.saved[key]) ? row.saved[key].slice() : row.saved[key];
          row.touch?.();
        }
        for (const row of socketRows)
          if (row.previous) stage.sockets[row.name] = row.previous;
          else delete stage.sockets[row.name];
        for (const i of controlled) stage.touch(i);
        world.sceneGraph = priorGraph;
        owned.delete(world);
        stage.systems = stage.systems.filter(system => system !== binding);
        disposed = true;
        const errors = [];
        for (const row of custom)
          try {
            row.restore?.();
          } catch (error) {
            errors.push(error);
          }
        if (errors.length) throw new AggregateError(errors, 'Scene adapter restoration failed');
      },
      get disposed() {
        return disposed;
      }
    };
    world.sceneGraph = graph;
    owned.set(world, binding);
    stage.add(binding);
    try {
      binding.apply();
    } catch (error) {
      try {
        binding.dispose();
      } catch {}
      throw error;
    }
    return binding;
  }
  function fromRig(rig, { parts = {} } = {}) {
    check(rig?.M && rig?.names, 'bind the rig before importing it');
    const nodes = {};
    for (let i = 1; i < rig.names.length; i++) {
      const id = rig.names[i],
        joint = parts[id]?.joint ?? [0, 0, 0];
      nodes[id] = {
        kind: 'geometry',
        transform: { matrix: Array.from(rig.M.subarray(i * 12, i * 12 + 9)), position: rig.at(id, joint) }
      };
    }
    const graph = G.create({ nodes });
    for (const id of graph.ids()) if (parts[id]?.parent) graph.reparent(id, parts[id].parent);
    return {
      graph: G.create(graph.snapshot()),
      geometry: graph
        .ids()
        .filter(id => rig.list[rig.names.indexOf(id)].length)
        .map(id => ({ node: id, part: id }))
    };
  }
  function fromDiorama(world, env = {}) {
    check(world.spec, 'expected a built diorama');
    const expanded = K.authoring.scenePrefabs.expand(world.spec, env),
      rig = world.anim?.rig;
    const partSpecs = Object.fromEntries(
      (rig?.names.slice(1) ?? []).map(id => {
        const box = rig.box(id),
          source = expanded.spec.parts?.[id] ?? {};
        return [id, { ...source, joint: source.joint ?? (box.n ? [box.c[0], box.lo[1], box.c[2]] : [0, 0, 0]) }];
      })
    );
    const imported = rig ? fromRig(rig, { parts: partSpecs }) : { graph: G.create(), geometry: [] },
      graph = imported.graph;
    function placement(raw) {
      const t = K.diorama.solidTransform(raw ?? {}),
        axes = [
          [0, 1, 0],
          [1, 0, 0],
          [0, 0, 1]
        ],
        matrix = t.rotation.reduce((r, a, i) => M.mul(r, M.rot(axes[i], a)), M.id()).map(v => v * t.scale);
      return {
        matrix,
        position: V.sub(V.add(t.pivot ?? [0, 0, 0], t.translation), M.app(matrix, t.pivot ?? [0, 0, 0]))
      };
    }
    const prefabRoots = [];
    for (const [key, link] of expanded.instances) {
      const id = 'prefab.' + key;
      graph.add(id, { kind: 'prefab', label: key, transform: placement(link.instance.transform) });
      prefabRoots.push({ key, id });
    }
    prefabRoots.sort((a, b) => b.key.length - a.key.length);
    for (const id of imported.graph.ids())
      if (graph.node(id).kind === 'geometry' && !graph.node(id).parent) {
        const prefab = prefabRoots.find(p => id.startsWith(p.key + '.'));
        if (prefab) graph.reparent(id, prefab.id);
      }
    const metadata = TargetSelectors.index(world),
      groups = new Map();
    for (let i = 0; i < world.count; i++)
      if (!rig?.bid[i] && world.data[i * 16 + 3] > 0) {
        const key = String(metadata.row(i).entity ?? 'static');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
    for (const [key, indices] of groups) {
      let id = 'geometry.' + key;
      while (graph.has(id)) id += '.';
      const center = [0, 1, 2].map(k => indices.reduce((sum, i) => sum + world.data[i * 16 + k], 0) / indices.length);
      graph.add(id, { kind: 'geometry', label: key, transform: { position: center } });
      const prefab = prefabRoots.find(p => key.startsWith(p.key + '.'));
      if (prefab) graph.reparent(id, prefab.id);
      imported.geometry.push({ node: id, indices });
    }
    imported.graph = G.create(graph.snapshot());
    return imported;
  }
  Object.assign(G, { attach, fromRig, fromDiorama });
  Object.freeze(G);
})(KIT);
