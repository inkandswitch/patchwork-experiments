/* Incremental, cancellable realization of caller-owned scene chunks. */
(function (K) {
  const P = K.procedural;
  const MAX_CHUNKS = 4096;
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const name = id => typeof id === 'string' && id.length > 0;

  function descriptor(raw) {
    if (!raw || !name(raw.key) || !(name(raw.revision) || Number.isSafeInteger(raw.revision))) {
      throw new Error('Chunks need a stable key and a string or integer revision');
    }
    const dependencies = raw.dependencies ?? [];
    if (!Array.isArray(dependencies) || dependencies.length > MAX_CHUNKS || !dependencies.every(name)) {
      throw new Error('Chunk dependencies must be bounded lists of ids');
    }
    return Object.freeze({
      key: raw.key,
      revision: raw.revision,
      bounds: raw.bounds == null ? null : P.data.freeze(P.spatial.bounds(raw.bounds)),
      dependencies: Object.freeze([...new Set(dependencies)].sort(order)),
      input: raw.input
    });
  }

  function sameDescriptor(a, b) {
    if (
      !a ||
      a.revision !== b.revision ||
      a.dependencies.length !== b.dependencies.length ||
      a.dependencies.some((id, i) => id !== b.dependencies[i])
    )
      return false;
    if (!a.bounds || !b.bounds) return a.bounds === b.bounds;
    return a.bounds.min.every((v, i) => v === b.bounds.min[i] && a.bounds.max[i] === b.bounds.max[i]);
  }

  function realizer({ preview, refine = preview }, initial, sequence) {
    if (typeof preview !== 'function' || typeof refine !== 'function') {
      throw new Error('A chunk realizer needs preview and refinement builders');
    }
    let current = initial,
      active = null,
      serial = sequence;
    let dirtyIds = new Set(),
      dirtyRegions = [],
      allDirty = false;

    function cancel() {
      if (!active) return false;
      const request = active;
      active = null;
      request.abort();
      return true;
    }

    async function update(descriptors, { quality = 'final', changedIds = [], regions = [] } = {}) {
      if (
        !['preview', 'final'].includes(quality) ||
        !Array.isArray(descriptors) ||
        descriptors.length > MAX_CHUNKS ||
        !Array.isArray(changedIds) ||
        changedIds.length > MAX_CHUNKS ||
        !changedIds.every(name) ||
        !Array.isArray(regions) ||
        regions.length > MAX_CHUNKS
      ) {
        throw new Error('Invalid chunk update or dirty-region budget');
      }
      const next = descriptors.map(descriptor).sort((a, b) => order(a.key, b.key));
      if (next.some((entry, i) => i && entry.key === next[i - 1].key)) throw new Error('Chunk keys must be unique');
      const normalizedRegions = regions.map(P.spatial.bounds);
      cancel();
      const request = new AbortController();
      active = request;

      // An interrupted update may have carried invalidations apart from a revision
      // change. Retain them until some newer update publishes a complete patch.
      if (!allDirty) {
        for (const id of changedIds) dirtyIds.add(id);
        dirtyRegions.push(...normalizedRegions);
        if (dirtyIds.size + dirtyRegions.length > MAX_CHUNKS) {
          allDirty = true;
          dirtyIds.clear();
          dirtyRegions = [];
        }
      }
      const builder = quality === 'final' ? refine : preview,
        staged = new Map(),
        replaced = [];
      try {
        for (const entry of next) {
          const previous = current.get(entry.key),
            before = previous?.descriptor;
          const affected =
            allDirty ||
            !sameDescriptor(before, entry) ||
            (quality === 'final' && previous.quality !== 'final') ||
            dirtyIds.has(entry.key) ||
            entry.dependencies.some(id => dirtyIds.has(id)) ||
            dirtyRegions.some(
              region =>
                (before.bounds && P.spatial.overlap(before.bounds, region)) ||
                (entry.bounds && P.spatial.overlap(entry.bounds, region))
            );
          if (!affected) {
            staged.set(entry.key, previous);
            continue;
          }
          const value = await builder(
            entry,
            Object.freeze({
              signal: request.signal,
              quality,
              previous: previous?.value,
              previousQuality: previous?.quality
            })
          );
          if (active !== request) return null;
          const chunk = Object.freeze({ key: entry.key, descriptor: entry, quality, value });
          staged.set(entry.key, chunk);
          replaced.push(chunk);
        }
        if (active !== request) return null;
        const removed = [...current.keys()].filter(key => !staged.has(key));
        const oldBounds = [...replaced.map(chunk => chunk.key), ...removed].flatMap(key => {
          const box = current.get(key)?.descriptor.bounds;
          return box ? [box] : [];
        });
        const newBounds = replaced.flatMap(chunk => (chunk.descriptor.bounds ? [chunk.descriptor.bounds] : []));
        current = staged;
        dirtyIds.clear();
        dirtyRegions = [];
        allDirty = false;
        return Object.freeze({
          sequence: ++serial,
          quality,
          replaced: Object.freeze(replaced),
          removed: Object.freeze(removed),
          regions: Object.freeze([...oldBounds, ...newBounds])
        });
      } catch (error) {
        if (active !== request) return null;
        throw error;
      } finally {
        if (active === request) active = null;
      }
    }

    return Object.freeze({
      update,
      cancel,
      fork: () => realizer({ preview, refine }, current, serial),
      get: key => current.get(key) ?? null,
      entries: () => Object.freeze([...current.values()])
    });
  }

  P.chunks = { create: (options = {}) => realizer(options, new Map(), 0) };
})(KIT);
