/* Spatial descriptors and derivation rules for retained documents. */
(function (K) {
  const A = K.authoring,
    { clone, freeze } = A.data,
    V = K.V;
  const { bounds, overlap, expand, boxOf, rayBox } = K.procedural.spatial;
  const EPS = 1e-8,
    vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const name = v => typeof v === 'string' && v.length > 0;
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  A.context = (doc, options) => {
    const opts = Object.assign(
      { cellSize: 4, maxPasses: 16, maxCells: 4096, environmentKey: environment => environment },
      options
    );
    if (
      !Number.isFinite(opts.cellSize) ||
      opts.cellSize <= 0 ||
      !Number.isSafeInteger(opts.maxPasses) ||
      opts.maxPasses < 1 ||
      !Number.isSafeInteger(opts.maxCells) ||
      opts.maxCells < 1 ||
      typeof opts.environmentKey !== 'function'
    )
      throw new Error('Invalid context index settings');
    const rayFilters = new Map(),
      adapters = new Map(),
      rules = new Map(),
      records = new Map(),
      grid = new Map(),
      large = new Set(),
      membership = new Map(),
      jobs = new Map(),
      adapterReads = new Map(),
      adapterCollections = new Map(),
      adapterWatches = new Map(),
      collectionCache = new Map();
    let previous = null,
      view = null,
      running = false,
      active = null,
      full = true,
      disposed = false,
      synchronizing = false,
      describing = null,
      describingCollections = null,
      describingWatches = null,
      ensureRecord = null;
    let dirty = new Map(),
      stylesDirty = true;
    const stats = { adapterUpdates: 0, queries: 0, jobsRun: 0, passes: 0 };
    const ctx = {};
    function cellKeys(b) {
      const lo = b.min.map(v => Math.floor(v / opts.cellSize)),
        hi = b.max.map(v => Math.floor(v / opts.cellSize));
      if (!lo.every(Number.isSafeInteger) || !hi.every(Number.isSafeInteger)) return null;
      if (lo.reduce((n, v, i) => n * (hi[i] - v + 1), 1) > opts.maxCells) return null;
      const keys = [];
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) keys.push(x + ',' + y + ',' + z);
      return keys;
    }
    function unindex(id) {
      large.delete(id);
      for (const key of membership.get(id) || []) {
        const ids = grid.get(key);
        ids.delete(id);
        if (!ids.size) grid.delete(key);
      }
      membership.delete(id);
      records.delete(id);
    }
    function index(id, rec) {
      records.set(id, rec);
      const keys = cellKeys(rec.bounds);
      if (!keys) {
        large.add(id);
        return;
      }
      membership.set(id, keys);
      for (const key of keys) {
        if (!grid.has(key)) grid.set(key, new Set());
        grid.get(key).add(id);
      }
    }
    function alive() {
      if (disposed) throw new Error('Context has been disposed');
    }
    function sync() {
      alive();
      if (synchronizing) return ctx;
      const next = doc.snapshot();
      // A retained document reuses its immutable view until intent changes.
      // Adapter registration still forces a rebuild even with the same view.
      if (!full && next === previous) return ctx;
      const globalChanged =
        !previous ||
        JSON.stringify(previous.styles) !== JSON.stringify(next.styles) ||
        JSON.stringify(clone(opts.environmentKey(previous.environment))) !==
          JSON.stringify(clone(opts.environmentKey(next.environment)));
      const changes = new Set(),
        prepared = new Map(),
        preparedReads = new Map(),
        preparedCollections = new Map(),
        preparedWatches = new Map(),
        collectionIds = new Map(),
        visiting = new Set();
      for (const id of new Set([...Object.keys(previous ? previous.entities : {}), ...Object.keys(next.entities)])) {
        const old = previous && previous.entities[id],
          e = next.entities[id];
        if (full || globalChanged || (old !== e && JSON.stringify(old) !== JSON.stringify(e))) changes.add(id);
      }
      if (changes.size || globalChanged || full) collectionCache.clear();
      const idsFor = f => {
        const key = JSON.stringify(f);
        if (!collectionIds.has(key))
          collectionIds.set(
            key,
            collect(next, f).map(e => e.id)
          );
        return collectionIds.get(key);
      };
      for (const [id, reads] of adapterCollections)
        if (reads.some(r => JSON.stringify(idsFor(r.filter)) !== JSON.stringify(r.ids))) changes.add(id);
      for (const [id, watches] of adapterWatches)
        if (!changes.has(id) && watches.some(watch => watchChanged(watch, next))) changes.add(id);
      let more = true;
      while (more) {
        more = false;
        for (const e of Object.values(next.entities))
          if (!changes.has(e.id)) {
            const deps = [
              e.parent,
              e.anchor && e.anchor.host,
              e.derived && e.derived.owner,
              ...(adapterReads.get(e.id) || [])
            ];
            if (deps.some(id => changes.has(id))) {
              changes.add(e.id);
              more = true;
            }
          }
      }
      view = next;
      function prepare(id) {
        if (prepared.has(id)) return prepared.get(id);
        if (!changes.has(id)) return records.get(id) || null;
        if (visiting.has(id)) throw new Error('Cyclic spatial descriptor: ' + id);
        visiting.add(id);
        const e = next.entities[id],
          adapter = e && adapters.get(e.type);
        if (!adapter) {
          prepared.set(id, null);
          visiting.delete(id);
          return null;
        }
        for (const dep of [e.parent, e.anchor && e.anchor.host, e.derived && e.derived.owner]) if (dep) prepare(dep);
        const previousReads = describing,
          previousCollections = describingCollections,
          previousWatches = describingWatches,
          reads = new Set(),
          collections = [],
          watches = [];
        describing = reads;
        describingCollections = collections;
        describingWatches = watches;
        let raw;
        try {
          raw = adapter.describe(e, ctx);
        } finally {
          describing = previousReads;
          describingCollections = previousCollections;
          describingWatches = previousWatches;
        }
        preparedReads.set(id, reads);
        preparedCollections.set(id, collections);
        preparedWatches.set(id, watches);
        if (!raw) {
          prepared.set(id, null);
          visiting.delete(id);
          return null;
        }
        const rec = {
          id,
          type: e.type,
          entity: e,
          bounds: bounds(raw.bounds),
          tags: clone(raw.tags || []),
          surfaces: raw.surfaces || [],
          adapter
        };
        if (!Array.isArray(rec.tags) || !rec.tags.every(name) || !Array.isArray(rec.surfaces))
          throw new Error('Invalid spatial descriptor: ' + id);
        const ids = new Set();
        for (const s of rec.surfaces) {
          if (
            !s ||
            !name(s.id) ||
            ids.has(s.id) ||
            typeof s.sample !== 'function' ||
            (s.samplePointNormal !== undefined && typeof s.samplePointNormal !== 'function') ||
            typeof s.closest !== 'function' ||
            typeof s.raycast !== 'function'
          )
            throw new Error('Invalid or duplicate host surface: ' + id);
          if (
            (s.periodicU !== undefined && typeof s.periodicU !== 'boolean') ||
            (s.breaks !== undefined &&
              (!Array.isArray(s.breaks) ||
                !s.breaks.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1 && (!i || v > s.breaks[i - 1])))) ||
            (s.floorAt !== undefined && typeof s.floorAt !== 'function') ||
            (s.ceilingAt !== undefined && typeof s.ceilingAt !== 'function') ||
            (s.vRangeAt !== undefined && typeof s.vRangeAt !== 'function')
          )
            throw new Error('Invalid optional surface domain or height datum: ' + id);
          ids.add(s.id);
        }
        prepared.set(id, rec);
        visiting.delete(id);
        stats.adapterUpdates++;
        return rec;
      }
      synchronizing = true;
      ensureRecord = prepare;
      try {
        for (const id of changes) prepare(id);
      } finally {
        synchronizing = false;
        ensureRecord = null;
        describing = null;
        describingCollections = null;
        describingWatches = null;
      }
      for (const id of changes) {
        const old = records.get(id),
          rec = prepared.get(id),
          pending = dirty.get(id);
        dirty.set(id, { old: pending ? pending.old : old, next: rec });
        unindex(id);
        if (rec) index(id, rec);
        if (preparedCollections.has(id)) adapterCollections.set(id, preparedCollections.get(id));
        else adapterCollections.delete(id);
        if (preparedWatches.get(id)?.length) adapterWatches.set(id, preparedWatches.get(id));
        else adapterWatches.delete(id);
        if (preparedReads.has(id)) adapterReads.set(id, preparedReads.get(id));
        else adapterReads.delete(id);
      }
      stylesDirty = stylesDirty || globalChanged;
      previous = next;
      full = false;
      return ctx;
    }
    function ready() {
      alive();
      if (!running && !synchronizing) sync();
    }
    function read(id) {
      ready();
      if (active) active.ids.add(id);
      if (describing) describing.add(id);
      return Object.prototype.hasOwnProperty.call(view.entities, id) ? view.entities[id] : null;
    }
    function matches(rec, filter) {
      const f = filter || {};
      return (
        (!f.types || f.types.includes(rec.type)) &&
        (!f.tags || f.tags.every(t => rec.tags.includes(t))) &&
        (!f.exclude || !f.exclude.includes(rec.id))
      );
    }
    function query(raw, filter) {
      if (synchronizing)
        throw new Error('Spatial descriptors may read entities/anchors, but cannot query their incomplete index');
      ready();
      const b = bounds(raw),
        f = clone(filter || {});
      stats.queries++;
      for (const key of ['types', 'tags', 'exclude'])
        if (f[key] && (!Array.isArray(f[key]) || !f[key].every(name)))
          throw new Error('Query ' + key + ' must be an array of names');
      if (active) active.regions.push({ bounds: b, filter: f });
      const keys = cellKeys(b),
        candidates = keys ? new Set(large) : new Set(records.keys());
      if (keys) for (const key of keys) for (const id of grid.get(key) || []) candidates.add(id);
      const out = [...candidates]
        .map(id => records.get(id))
        .filter(r => overlap(r.bounds, b) && matches(r, f))
        .sort((a, b) => order(a.id, b.id));
      return freeze(
        out.map(r => ({ id: r.id, type: r.type, bounds: clone(r.bounds), tags: clone(r.tags), entity: r.entity }))
      );
    }
    function nearest(point, filter) {
      if (!vector(point)) throw new Error('Nearest query needs a finite point');
      const f = Object.assign({ radius: 10000 }, filter);
      if (!Number.isFinite(f.radius) || f.radius < 0) throw new Error('Nearest radius must be finite and non-negative');
      const candidates = query(expand({ min: point, max: point }, f.radius), f),
        hits = [];
      for (const c of candidates) {
        const r = records.get(c.id);
        if (r.surfaces.length)
          for (const s of r.surfaces) {
            const hit = s.closest(point),
              distance = V.dist(point, hit.p);
            if (distance <= f.radius) hits.push(Object.assign({ id: c.id, surface: s.id, distance }, hit));
          }
        else {
          const p = point.map((v, i) => Math.max(r.bounds.min[i], Math.min(r.bounds.max[i], v))),
            distance = V.dist(p, point);
          if (distance <= f.radius) hits.push({ id: c.id, surface: null, p, distance });
        }
      }
      hits.sort((a, b) => a.distance - b.distance || order(a.id, b.id) || order(String(a.surface), String(b.surface)));
      return hits.length ? freeze(clone(hits[0])) : null;
    }
    function raycast(origin, direction, filter) {
      if (!vector(origin) || !vector(direction) || V.len(direction) < EPS)
        throw new Error('Ray needs a finite origin and nonzero direction');
      const f = Object.freeze(Object.assign({ maxDistance: 10000 }, filter)),
        dir = V.norm(direction);
      if (!Number.isFinite(f.maxDistance) || f.maxDistance <= 0) throw new Error('Invalid ray distance');
      const filters = f.rayFilters === false ? [] : Array.from(rayFilters.values());
      const candidates = query(boxOf([origin, V.mad(origin, dir, f.maxDistance)]), f)
          .map(c => ({ c, near: rayBox(records.get(c.id).bounds, origin, dir, f.maxDistance) }))
          .filter(c => c.near !== null)
          .sort((a, b) => a.near - b.near),
        hits = [],
        accept = (hit, entity) =>
          filters.every(fn => fn(Object.assign({ id: entity.id }, hit), entity, ctx, f) !== false);
      let closest = f.maxDistance;
      for (const { c, near } of candidates) {
        const limit = Math.min(f.maxDistance, closest + 1e-7 * (1 + closest));
        if (near > limit) break;
        const rec = records.get(c.id);
        if (rec.adapter.raycast) {
          const hit = rec.adapter.raycast(rec.entity, origin, dir, limit, ctx);
          if (hit && accept(hit, rec.entity)) {
            hits.push(Object.assign({ id: c.id }, hit));
            closest = Math.min(closest, hit.distance);
          }
        } else
          for (const surface of rec.surfaces) {
            const hit = surface.raycast(origin, dir, limit);
            if (hit && accept(Object.assign({ surface: surface.id }, hit), rec.entity)) {
              hits.push(Object.assign({ id: c.id, surface: surface.id }, hit));
              closest = Math.min(closest, hit.distance);
            }
          }
      }
      hits.sort((a, b) => a.distance - b.distance || order(a.id, b.id));
      return hits.length ? freeze(clone(hits[0])) : null;
    }
    function anchor(value) {
      const a = typeof value === 'string' ? (read(value) || {}).anchor : value;
      if (!a || !name(a.host) || !name(a.surface)) throw new Error('Expected a host/surface anchor');
      read(a.host);
      const rec = synchronizing ? ensureRecord(a.host) : records.get(a.host),
        s = rec && rec.surfaces.find(s => s.id === a.surface);
      if (!s) throw new Error('Missing host surface: ' + a.host + '/' + a.surface);
      const hit = s.sample(a.uv),
        offset = a.offset === undefined ? 0 : a.offset;
      if (!Number.isFinite(offset)) throw new Error('Anchor offset must be finite');
      return freeze(clone({ ...hit, p: V.mad(hit.p, hit.n, offset) }));
    }
    function collect(state, filter) {
      const parameters = filter.parameters && Object.entries(filter.parameters);
      return Object.values(state.entities)
        .filter(e =>
          (filter.type === undefined || e.type === filter.type) &&
          (filter.anchorHost === undefined || e.anchor?.host === filter.anchorHost) &&
          (filter.parent === undefined || e.parent === filter.parent) &&
          (!parameters || parameters.every(([key, value]) => e.parameters[key] === value))
        )
        .sort((a, b) => order(a.id, b.id));
    }
    function collection(filter) {
      ready();
      if (!filter || (filter.type === undefined && filter.anchorHost === undefined &&
          filter.parent === undefined && filter.parameters === undefined))
        throw new Error('Entity collections need a type or relation, or a parameter filter');
      const f = {};
      for (const key of ['type', 'anchorHost', 'parent']) {
        if (filter[key] === undefined) continue;
        if (!name(filter[key])) throw new Error('Entity collection identities must be nonempty names');
        f[key] = filter[key];
      }
      if (filter.parameters !== undefined) {
        const entries = Object.entries(filter.parameters || {});
        if (typeof filter.parameters !== 'object' || Array.isArray(filter.parameters) || !entries.length ||
            !entries.every(([key, value]) => name(key) &&
              (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value))))
          throw new Error('Collection parameters need named scalar values');
        f.parameters = Object.fromEntries(entries);
      }
      const key = JSON.stringify(f);
      if (!collectionCache.has(key)) collectionCache.set(key, freeze(collect(view, f)));
      const entities = collectionCache.get(key),
        record = { filter: f, ids: entities.map(e => e.id) };
      if (describingCollections) describingCollections.push(record);
      if (active) (active.collections || (active.collections = [])).push(record);
      for (const e of entities) {
        if (describing) describing.add(e.id);
        if (active) active.ids.add(e.id);
      }
      return entities;
    }
    function watchChanged({ select, value }, next) {
      return !Object.is(select(next), value);
    }
    function watch(select) {
      if (typeof select !== 'function') throw new Error('Context watches require a snapshot selector');
      ready();
      const value = select(view), entry = { select, value };
      if (describingWatches) describingWatches.push(entry);
      if (active) (active.watches || (active.watches = [])).push(entry);
      return value;
    }
    function affected(job, changes, global) {
      if (global || !job) return true;
      if (job.watches?.some(watch => watchChanged(watch, view))) return true;
      if (
        (job.collections || []).some(
          r => JSON.stringify(collect(view, r.filter).map(e => e.id)) !== JSON.stringify(r.ids)
        )
      )
        return true;
      for (const [id, change] of changes) {
        if (job.ids.has(id)) return true;
        if (
          job.regions.some(({ bounds, filter }) => [change.old, change.next].some(record =>
            record && matches(record, filter) && overlap(bounds, record.bounds)
          ))
        )
          return true;
      }
      return false;
    }
    function evaluate() {
      if (running) throw new Error('Recursive context reconciliation');
      running = true;
      try {
        for (let pass = 0; pass < opts.maxPasses; pass++) {
          sync();
          stats.passes++;
          const changes = dirty,
            global = stylesDirty;
          dirty = new Map();
          stylesDirty = false;
          let count = 0;
          const validJobs = new Set();
          for (const rule of [...rules.values()].sort((a, b) => order(a.id, b.id))) {
            for (const e of Object.values(view.entities)
              .filter(e => rule.types.includes(e.type))
              .sort((a, b) => order(a.id, b.id))) {
              // An earlier rule in this pass may have pruned this generated owner.
              if (!doc.get(e.id)) continue;
              const key = JSON.stringify([rule.id, e.id]),
                old = jobs.get(key);
              validJobs.add(key);
              if (!affected(old, changes, global)) continue;
              const reads = { ids: new Set([e.id]), regions: [], rule: rule.id, owner: e.id };
              active = reads;
              let children;
              try {
                children = rule.generate(e, ctx);
              } finally {
                active = null;
              }
              if (!Array.isArray(children))
                throw new Error('Generation rule must return child specifications: ' + rule.id);
              doc.derive(e.id, rule.id, children);
              jobs.set(key, reads);
              stats.jobsRun++;
              count++;
            }
          }
          for (const key of jobs.keys()) if (!validJobs.has(key)) jobs.delete(key);
          if (!count) return ctx.stats();
          const after = doc.snapshot();
          if (after === view || JSON.stringify(after) === JSON.stringify(view)) return ctx.stats();
        }
        throw new Error('Context rules did not converge within ' + opts.maxPasses + ' passes');
      } catch (err) {
        previous = null;
        full = true;
        jobs.clear();
        throw err;
      } finally {
        active = null;
        running = false;
      }
    }
    ctx.register = (type, adapter) => {
      alive();
      if (!name(type) || !adapter || typeof adapter.describe !== 'function')
        throw new Error('Spatial adapter needs type and describe');
      adapters.set(type, adapter);
      full = true;
      return ctx;
    };
    ctx.rule = spec => {
      alive();
      if (
        !spec ||
        !name(spec.id) ||
        rules.has(spec.id) ||
        !Array.isArray(spec.types) ||
        !spec.types.every(name) ||
        typeof spec.generate !== 'function'
      )
        throw new Error('Rule needs unique id, types and generate');
      const rule = { id: spec.id, types: spec.types.slice(), generate: spec.generate };
      rules.set(rule.id, rule);
      stylesDirty = true;
      return () => {
        alive();
        rules.delete(rule.id);
        const remove = () => {
          const owners = new Set(
            doc
              .entities()
              .filter(e => e.derived && e.derived.rule === rule.id)
              .map(e => e.derived.owner)
          );
          for (const owner of owners) doc.derive(owner, rule.id, []);
        };
        if (doc.pending()) remove();
        else doc.transact('Remove generation rule', remove);
        for (const [key, job] of jobs) if (job.rule === rule.id) jobs.delete(key);
      };
    };
    ctx.rayFilter = (id, fn) => {
      alive();
      if (!name(id) || typeof fn !== 'function' || rayFilters.has(id))
        throw new Error('Ray filters need a unique id and function');
      rayFilters.set(id, fn);
      return () => rayFilters.get(id) === fn && rayFilters.delete(id);
    };
    ctx.collection = collection;
    ctx.watch = watch;
    ctx.snapshot = () => {
      alive();
      return doc.snapshot();
    };
    ctx.read = read;
    ctx.query = query;
    ctx.nearest = nearest;
    ctx.raycast = raycast;
    ctx.anchor = anchor;
    ctx.style = id => {
      read(id);
      return A.styles.resolve(view, id);
    };
    ctx.describe = id => {
      read(id);
      const rec = synchronizing ? ensureRecord(id) : records.get(id);
      return rec ? freeze({ bounds: clone(rec.bounds), tags: clone(rec.tags),
        surfaces: rec.surfaces.map(({id, kind}) => ({id, kind: kind || 'parametric'})) }) : null;
    };
    ctx.surfaces = id => {
      read(id);
      const r = synchronizing ? ensureRecord(id) : records.get(id);
      return Object.freeze(
        r
          ? r.surfaces.map(s =>
              Object.freeze({
                id: s.id,
                kind: s.kind || 'parametric',
                data: s.data ? freeze(clone(s.data)) : null,
                sample: s.sample,
                ...(s.samplePointNormal ? { samplePointNormal: s.samplePointNormal } : {}),
                project: s.project,
                closest: s.closest,
                raycast: s.raycast,
                ...(s.periodicU !== undefined ? { periodicU: s.periodicU } : {}),
                ...(s.breaks ? { breaks: freeze(clone(s.breaks)) } : {}),
                ...(s.floorAt ? { floorAt: s.floorAt } : {}),
                ...(s.ceilingAt ? { ceilingAt: s.ceilingAt } : {}),
                ...(s.vRangeAt ? { vRangeAt: s.vRangeAt } : {})
              })
            )
          : []
      );
    };
    ctx.sync = sync;
    ctx.reconcile = () => {
      alive();
      return doc.pending() ? evaluate() : doc.transact('Reconcile context', evaluate);
    };
    ctx.stats = () => freeze(clone(stats));
    ctx.resetStats = () => {
      for (const k of Object.keys(stats)) stats[k] = 0;
    };
    ctx.dependencies = () =>
      freeze(
        [...jobs.values()].map(j => ({
          owner: j.owner,
          rule: j.rule,
          ids: [...j.ids].sort(),
          regions: clone(j.regions.map(region => region.bounds))
        }))
      );
    const unsubscribe = doc.beforeCommit(() => evaluate());
    ctx.dispose = () => {
      unsubscribe();
      disposed = true;
      records.clear();
      rayFilters.clear();
      grid.clear();
      jobs.clear();
      membership.clear();
      large.clear();
      adapterReads.clear();
      adapterCollections.clear();
      adapterWatches.clear();
      collectionCache.clear();
    };
    return ctx;
  };
})(KIT);
