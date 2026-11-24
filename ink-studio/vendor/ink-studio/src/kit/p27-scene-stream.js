/* Plan visible draw payloads before asking the residency scheduler to load them. */
(function(K) {
  const { chunks } = K.procedural;
  const integer = Number.isSafeInteger, name = value => typeof value === 'string' && value.length > 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const empty = Object.freeze([]);

  chunks.createSceneStream = function createSceneStream({
    budgetBytes, maxSplats, startsPerFrame = 2, concurrency = 2, maxPortals = 1, maxCandidates = 4096,
    query, load, release, sizeOf, splatsOf
  } = {}) {
    if (!integer(budgetBytes) || budgetBytes < 1 || !integer(maxSplats) || maxSplats < 1 ||
        !integer(maxPortals) || maxPortals < 0 || maxPortals > 16 || !integer(maxCandidates) || maxCandidates < 1)
      throw new RangeError('Scene streaming needs positive memory, splat and candidate budgets, and up to 16 portals');
    if (typeof query !== 'function' || typeof load !== 'function' ||
        [sizeOf, splatsOf, release].some(fn => fn !== undefined && typeof fn !== 'function'))
      throw new TypeError('Scene streaming needs chunk query and load callbacks');
    const { visibility } = chunks;
    let descriptions = new Map(), plan, published, disposed = false;
    const scheduler = chunks.createScheduler({
      budgetBytes, concurrency, startsPerFrame,
      describe: key => descriptions.get(key),
      load: ({ input }, context) => load(input, context),
      release: release && ((value, descriptor) => release(value, descriptor.input)),
      sizeOf(value, { input }) {
        const count = splatsOf ? splatsOf(value, input) : value?.splats?.count ?? value?.count ?? input.splats;
        if (!integer(count) || count < 0 || count > input.splats)
          throw new RangeError('Loaded chunk exceeds its frame splat reservation or has an invalid count');
        return sizeOf ? sizeOf(value, input) : input.bytes;
      }
    });
    const interest = scheduler.interest('scene-stream');
    function guard() {
      if (disposed) throw new Error('The scene stream has been disposed');
    }
    function levels(place, row) {
      if (!Array.isArray(row.levels) || !row.levels.length || row.levels.length > 16)
        throw new RangeError('Streaming chunks need one to sixteen levels');
      const ids = new Set();
      let prior = { bytes: 0, splats: 0 };
      return Array.from(row.levels, raw => {
        const { id, bytes, splats, revision, maxDistance = Infinity, input } = raw ?? {};
        if (!name(id) || ids.has(id) || !integer(bytes) || bytes < 1 || bytes < prior.bytes ||
            !integer(splats) || splats < 0 || splats < prior.splats || !(integer(revision) || name(revision)) ||
            !(maxDistance > 0) || typeof maxDistance !== 'number')
          throw new TypeError('Chunk levels need unique IDs, a revision and increasing byte and splat reservations');
        const key = JSON.stringify([place, row.id, id]);
        const descriptor = Object.freeze({ key, place, chunk: row.id, level: id, bytes, splats, revision, input });
        ids.add(id);
        prior = descriptor;
        return { key, id, bytes, splats, maxDistance, revision: JSON.stringify([revision, splats]), input: descriptor };
      });
    }

    function viewsFor(place, camera, portals, limit) {
      if (!Array.isArray(portals) || portals.length > maxCandidates) throw new TypeError('Expected a bounded portal list');
      const ids = new Set();
      const options = [];
      for (const portal of portals) {
        const { id, to, opening } = portal ?? {};
        if (!name(id) || ids.has(id) || !name(to?.place)) throw new TypeError('Streaming portals need unique IDs and a destination place');
        ids.add(id);
        if (!limit || portal.active === false || opening == null || portal.from && portal.from.place !== place) continue;
        const projected = visibility.aperture(camera, opening);
        if (projected) options.push({ id: 'portal/' + id, portalId: id, place: to.place, opening, ...projected });
      }
      options.sort((a, b) => b.area - a.area || order(a.id, b.id));
      return [{ id: 'main', place, camera, window: visibility.screen },
        ...options.slice(0, limit).map(portal => {
          const { opening } = portal;
          return { ...portal, camera: visibility.camera({ ...camera, ...opening.camera(camera),
            observer: opening.point(camera.observer) }) };
        })].map(view => Object.freeze(view));
    }

    function discover(views, selected) {
      const candidates = new Map();
      let count = 0;
      for (const view of views) {
        const { camera, window, opening, place } = view;
        const planes = visibility.frustum(camera, window, opening?.to);
        const rows = query(view);
        if (!Array.isArray(rows) || (count += rows.length) > maxCandidates)
          throw new RangeError('Scene stream query exceeds its candidate budget');
        const seen = new Set();
        for (const row of rows) {
          if (!name(row?.id) || seen.has(row.id) || row.subjects !== undefined &&
              (!Array.isArray(row.subjects) || !Array.from(row.subjects).every(name)))
            throw new TypeError('Streaming chunks need unique IDs per view and optional subject IDs');
          seen.add(row.id);
          const box = visibility.bounds(row.bounds);
          if (!visibility.visible(box, planes)) continue;
          const key = JSON.stringify([place, row.id]), variants = levels(place, row);
          const distance = visibility.distance(box, camera.observer);
          const chosen = selected.has(row.id) || Boolean(row.subjects?.some(id => selected.has(id)));
          const previous = candidates.get(key);
          if (previous) {
            if (previous.levels.length !== variants.length || variants.some((v, i) => {
              const old = previous.levels[i];
              return v.id !== old.id || v.bytes !== old.bytes || v.revision !== old.revision ||
                v.maxDistance !== old.maxDistance;
            })) throw new Error('A visible chunk must describe the same levels in every view');
            previous.views.push(view.id);
            previous.distance = Math.min(previous.distance, distance);
            previous.selected ||= chosen;
          } else {
            candidates.set(key, { key, place, id: row.id, levels: variants, distance,
              selected: chosen, views: [view.id] });
          }
        }
      }
      return [...candidates.values()].sort((a, b) => Number(b.selected) - Number(a.selected) ||
        a.distance - b.distance || order(a.key, b.key));
    }

    function allocate(candidates, views) {
      let bytes = 0, splats = 0;
      const admitted = new Map();
      function fit(candidate, level) {
        const old = admitted.get(candidate.key)?.level;
        const nextBytes = bytes - (old?.bytes ?? 0) + level.bytes;
        const nextSplats = splats + (level.splats - (old?.splats ?? 0)) * candidate.views.length;
        if (nextBytes > budgetBytes || nextSplats > maxSplats) return false;
        bytes = nextBytes;
        splats = nextSplats;
        admitted.set(candidate.key, { candidate, level });
        return true;
      }
      function upgrade(candidate) {
        if (!admitted.has(candidate.key)) return;
        for (let i = candidate.levels.length - 1; i > 0; i--) {
          const level = candidate.levels[i];
          if ((candidate.selected || candidate.distance <= level.maxDistance) && fit(candidate, level)) break;
        }
      }
      // Give each live view a base before spending the budget on refinements.
      for (const view of views) {
        const first = candidates.find(candidate => candidate.views.includes(view.id));
        if (first && !admitted.has(first.key)) fit(first, first.levels[0]);
      }
      for (const candidate of candidates) {
        if (!candidate.selected) break;
        if (!admitted.has(candidate.key)) fit(candidate, candidate.levels[0]);
        upgrade(candidate);
      }
      for (const candidate of candidates) if (!admitted.has(candidate.key)) fit(candidate, candidate.levels[0]);
      for (const candidate of candidates) if (!candidate.selected) upgrade(candidate);

      // Keep a resident coarse level until its upgrade is available if the
      // extra residency fits. It replaces the planned draw while loading.
      let fallbackBytes = 0;
      const requests = new Map();
      for (const entry of admitted.values()) requests.set(entry.level.key, entry.level);
      for (const entry of admitted.values()) {
        const { candidate, level } = entry;
        if (resident(level)) continue;
        for (const lower of candidate.levels.slice(0, candidate.levels.indexOf(level)).reverse()) {
          if (!resident(lower) || bytes + fallbackBytes + lower.bytes > budgetBytes) continue;
          entry.fallback = lower;
          requests.set(lower.key, lower);
          fallbackBytes += lower.bytes;
          break;
        }
      }
      return { admitted, requests, bytes, splats, fallbackBytes };
    }
    function resident(level) {
      const entry = scheduler.get(level.key);
      return entry?.descriptor.revision === level.revision && entry.descriptor.bytes === level.bytes ? entry : null;
    }

    function advance({ place, camera, portals = [], selected = [], portalLimit = maxPortals } = {}) {
      guard();
      if (!name(place) || !Array.isArray(selected) || !Array.from(selected).every(name) ||
          !integer(portalLimit) || portalLimit < 0)
        throw new TypeError('Scene streaming needs a place and optional selected subject IDs');
      const views = viewsFor(place, visibility.camera(camera), portals, Math.min(portalLimit, maxPortals));
      const candidates = discover(views, new Set(selected));
      const { admitted, requests, bytes, splats, fallbackBytes } = allocate(candidates, views);
      const refresh = [...requests].some(([key, row]) => {
        const old = descriptions.get(key);
        return old && (old.bytes !== row.bytes || old.revision !== row.revision);
      });
      descriptions = requests;
      interest.update([...requests.keys()].map((key, i) => ({ key, priority: -i })));
      if (refresh) scheduler.refresh();
      scheduler.advance();
      plan = { views, admitted, visible: candidates.length, bytes, splats, fallbackBytes };
      published = undefined;
      return snapshot();
    }

    function snapshot() {
      const state = scheduler.snapshot();
      if (published?.state === state && published.plan === plan) return published.result;
      const byView = new Map(plan?.views.map(view => [view.id, []]));
      let ready = 0, fallback = 0, drawSplats = 0;
      for (const { candidate, level, fallback: backup } of plan?.admitted.values() ?? empty) {
        const current = resident(level), entry = current ?? (backup && resident(backup));
        if (!entry) continue;
        if (current) ready++;
        else fallback++;
        const descriptor = entry.descriptor.input;
        drawSplats += descriptor.splats * candidate.views.length;
        const row = Object.freeze({ ...descriptor, value: entry.value, fallback: !current });
        for (const id of candidate.views) byView.get(id).push(row);
      }
      const result = Object.freeze({ sequence: state.sequence, views: Object.freeze((plan?.views ?? empty).map(view =>
        Object.freeze({ ...view, entries: Object.freeze(byView.get(view.id)) }))),
        budget: Object.freeze({ maxSplats, budgetBytes, startsPerFrame, drawSplats, ready, fallback,
          visible: plan?.visible ?? 0, admitted: plan?.admitted.size ?? 0, plannedSplats: plan?.splats ?? 0,
          plannedBytes: plan?.bytes ?? 0, fallbackBytes: plan?.fallbackBytes ?? 0 })
      });
      published = { state, plan, result };
      return result;
    }

    return Object.freeze({ advance, snapshot, stats: scheduler.stats,
      status: scheduler.status,
      ready(options) { guard(); return interest.ready({ ...options, keys: [...(plan?.admitted.values() ?? empty)].map(entry => entry.level.key) }); },
      retry() { guard(); scheduler.refresh(); },
      dispose() {
        if (disposed) return;
        disposed = true;
        scheduler.dispose();
        descriptions.clear();
        plan = published = undefined;
      }
    });
  };
})(KIT);
