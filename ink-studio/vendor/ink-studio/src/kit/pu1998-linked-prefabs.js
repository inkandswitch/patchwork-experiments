/* Apply one prefab release to every linked assembly in a set of saved worlds. */
(function (K) {
  const W = K.world, { check, copy, equal, id, own, record } = W.data;
  const { freeze } = K.procedural.data;
  const revision = definition => definition?.revision ?? 1;

  function sync(scenes, release, { implementations } = {}) {
    check(Array.isArray(scenes) && scenes.length > 0, 'Prefab synchronization needs saved scenes');
    check(record(release) && Object.keys(release).every(key => ['id', 'definition', 'migration', 'fromDefinitions'].includes(key)) &&
      id(release.id) && record(release.definition) && Number.isSafeInteger(release.definition.revision) &&
      release.definition.revision > 0, 'A prefab release needs an ID and a revisioned definition');
    const { id: link, migration = {}, fromDefinitions = {} } = copy(release);
    const definition = W.manifest({ prefabs: { [link]: release.definition } }).prefabs[link];
    check(record(migration) && record(fromDefinitions) && Object.entries(fromDefinitions).every(([key, row]) =>
      /^[1-9]\d*$/.test(key) && record(row) && revision(row) === Number(key)), 'Invalid release migration or earlier definitions');

    const reports = [], results = [];
    for (const [index, source] of scenes.entries()) {
      check(record(source) && record(source.world), 'Expected a world in scene ' + index);
      const world = W.manifest(source.world), checkpoint = source.checkpoint;
      const existing = world.prefabs[link], instances = Object.keys(world.entities).filter(name => {
        const entity = world.entities[name];
        return entity.kind === 'assembly' && entity.prefab === link;
      }).sort();
      const report = { index, scene: world.id, status: 'unchanged', instances: [], issues: [] };
      reports.push(report);
      if (checkpoint) check(checkpoint.format === W.runtime.checkpointFormat && checkpoint.version === 1 &&
        equal(checkpoint.world, world), 'The saved checkpoint belongs to a different world');
      if (!existing && !instances.length) {
        try {
          const validated = W.runtime.validate(world, { implementations });
          report.status = 'unlinked';
          results.push({ world: validated, ...(checkpoint && { checkpoint }) });
        } catch (error) {
          report.issues.push({ reason: error.message });
        }
        continue;
      }
      const version = definition.revision;
      if (existing && (revision(existing) > version || revision(existing) === version && !equal(existing, definition))) {
        report.issues.push({ reason: 'The release would replace a newer or different definition at the same revision' });
        continue;
      }

      let draft = existing && equal(existing, definition) ? world :
        W.apply(world, [{ op: 'set', path: ['prefabs', link], value: definition }]).world;
      let saved = checkpoint && (draft === world ? checkpoint : { ...checkpoint, world: draft });
      let upgraded = false;
      for (const instance of instances) {
        const old = world.entities[instance].revision ?? 1;
        if (old === version) {
          report.instances.push({ instance, status: 'current' });
          continue;
        }
        const previous = existing && revision(existing) === old ? existing :
          own(fromDefinitions, old) ? fromDefinitions[old] : migration.fromDefinition;
        if (old > version || !previous || revision(previous) !== old) {
          report.issues.push({ instance, reason: 'The placed revision cannot be advanced using this release', revision: old });
          continue;
        }
        const result = W.upgradePrefab(draft, instance, link, { implementations, checkpoint: saved,
          migration: { ...migration, fromDefinition: previous } });
        report.instances.push(result.report);
        if (!result.report.ok) {
          report.issues.push({ instance, reason: 'The assembly needs migration repairs' });
          continue;
        }
        draft = result.world;
        saved = result.checkpoint;
        upgraded = true;
      }
      if (!report.issues.length) {
        try {
          const validated = W.runtime.validate(draft, { implementations });
          if (saved && draft !== world && !upgraded) W.runtime.create(validated, { checkpoint: saved, implementations });
          if (draft !== world) report.status = 'updated';
          results.push({ world: validated, ...(saved && { checkpoint: saved }) });
        } catch (error) {
          report.issues.push({ reason: error.message });
        }
      }
    }
    for (const report of reports) if (report.issues.length) report.status = 'blocked';
    const ok = reports.every(report => !report.issues.length);
    return freeze({ report: { ok, prefab: link, revision: definition.revision, scenes: reports },
      ...(ok && { scenes: results }) });
  }

  W.syncPrefab = sync;
})(KIT);
