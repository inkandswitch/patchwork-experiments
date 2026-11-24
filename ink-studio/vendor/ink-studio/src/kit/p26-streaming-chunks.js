/* Bounded residency over independent client interests and unbounded grid addresses. */
(function (K) {
  const { chunks } = K.procedural;
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const name = value => typeof value === 'string' && value.length > 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const vector = (value, n, check) => Array.isArray(value) && value.length === n && Array.from(value).every(check);
  const matching = (a, b) => a && b && a.revision === b.revision && a.bytes === b.bytes;

  chunks.grid = function grid({ size = 16, dimensions = 3, origin = Array(dimensions === 2 ? 2 : 3).fill(0) } = {}) {
    if (![2, 3].includes(dimensions) || !vector(origin, dimensions, finite) || !finite(size) || size <= 0)
      throw new RangeError('Chunk grids need two or three dimensions, a finite origin and positive cell size');
    const base = origin.slice();
    const cell = (value, axis) => (value - base[axis]) / size;
    const boundary = (id, axis) => base[axis] + id * size;
    function locate(value, axis) {
      let id = Math.floor(cell(value, axis));
      if (value < boundary(id, axis)) id--;
      else if (value >= boundary(id + 1, axis)) id++;
      if (!integer(id) || !(value >= boundary(id, axis) && value < boundary(id + 1, axis)))
        throw new RangeError('Point exceeds the coordinate precision of this grid');
      return id === 0 ? 0 : id;
    }
    const coordinates = value => {
      if (!vector(value, dimensions, integer)) throw new RangeError('Expected signed safe-integer chunk coordinates');
      return Object.freeze(value.slice());
    };
    function index(point) {
      if (!vector(point, dimensions, finite)) throw new TypeError('Expected a finite grid point');
      return Object.freeze(point.map(locate));
    }
    function bounds(at) {
      const ids = coordinates(at);
      const min = ids.map(boundary);
      const max = ids.map((id, axis) => boundary(id + 1, axis));
      if (!min.every((value, axis) => finite(value) && finite(max[axis]) && max[axis] > value))
        throw new RangeError('Chunk bounds exceed the coordinate precision of this grid');
      return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) });
    }
    function cover({ min, max } = {}, { limit = 4096 } = {}) {
      if (!vector(min, dimensions, finite) || !vector(max, dimensions, finite) ||
          max.some((value, axis) => value <= min[axis]) || !integer(limit) || limit < 1)
        throw new RangeError('Chunk windows need finite, nonempty bounds and a positive limit');
      const first = index(min), last = index(max).map((id, axis) => max[axis] === boundary(id, axis) ? id - 1 : id);
      const count = first.reduce((product, value, axis) => product * (last[axis] - value + 1), 1);
      if (!integer(count) || count < 1 || count > limit) throw new RangeError('Chunk window exceeds its limit');
      const point = first.slice(), result = [];
      for (let i = 0; i < count; i++) {
        result.push(Object.freeze(point.slice()));
        for (let axis = dimensions - 1; axis >= 0; axis--) {
          if (point[axis] < last[axis]) { point[axis]++; break; }
          point[axis] = first[axis];
        }
      }
      return Object.freeze(result);
    }
    function key(place, at) {
      if (!name(place)) throw new TypeError('A chunk address needs a place ID');
      return JSON.stringify([place, ...coordinates(at)]);
    }
    function address(value) {
      const parts = typeof value === 'string' && JSON.parse(value);
      if (!Array.isArray(parts) || !name(parts[0])) throw new TypeError('Expected a grid chunk key');
      const [place, ...at] = parts, index = coordinates(at);
      if (value !== key(place, index)) throw new TypeError('Expected a canonical grid chunk key');
      return Object.freeze({ place, index });
    }
    return Object.freeze({ index, bounds, cover, key, address });
  };

  chunks.createScheduler = function createScheduler({
    budgetBytes, concurrency = 2, describe, load, release, sizeOf, startsPerFrame
  } = {}) {
    if (!integer(budgetBytes) || budgetBytes < 1 || !integer(concurrency) || concurrency < 1)
      throw new RangeError('Chunk scheduling needs a positive byte budget and concurrency');
    if (startsPerFrame !== undefined && (!integer(startsPerFrame) || startsPerFrame < 1))
      throw new RangeError('Chunk starts per frame must be a positive integer');
    if (typeof describe !== 'function' || typeof load !== 'function' ||
        release !== undefined && typeof release !== 'function' || sizeOf !== undefined && typeof sizeOf !== 'function')
      throw new TypeError('Chunk scheduling needs describe and load callbacks');

    const interests = new Map(), residents = new Map(), loading = new Map(), failures = new Map(), waiters = new Set();
    let demand = new Map(), admitted = new Map(), descriptions = new Map();
    let dirty = true, refreshAll = false, scheduled = false, disposed = false;
    let bytes = 0, reservedBytes = 0, sequence = 0, published, releaseError = null;
    let starts = startsPerFrame === undefined ? Infinity : 0;
    let completed = [];

    function schedule(replan = false) {
      dirty ||= replan;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(pump);
    }
    function guard() {
      if (disposed) throw new Error('The chunk scheduler has been disposed');
    }
    function reclaim(value, descriptor) {
      try {
        const result = release?.(value, descriptor);
        if (typeof result?.then === 'function') Promise.resolve(result).catch(error => { releaseError = error; });
      } catch (error) {
        releaseError = error;
      }
    }
    function evict(key, entry) {
      residents.delete(key);
      bytes -= entry.bytes;
      sequence++;
      published = undefined;
      reclaim(entry.value, entry.descriptor);
    }
    function described(key) {
      try {
        const raw = describe(key);
        if (raw == null) return { descriptor: null };
        if (!(integer(raw.revision) || name(raw.revision)) || !integer(raw.bytes) || raw.bytes < 1)
          throw new TypeError('A chunk description needs a revision and a positive byte reservation');
        return { descriptor: Object.freeze({ key, revision: raw.revision, bytes: raw.bytes, input: raw.input }) };
      } catch (error) {
        return { error };
      }
    }
    function plan() {
      dirty = false;
      const next = new Map();
      for (const interest of interests.values()) for (const [key, priority] of interest.requests)
        if (!next.has(key) || priority > next.get(key)) next.set(key, priority);
      const ranked = [...next].sort((a, b) => b[1] - a[1] || order(a[0], b[0]));
      const known = new Map(), selected = new Map();
      const refresh = refreshAll;
      refreshAll = false;
      let space = budgetBytes;
      for (const [key] of ranked) {
        const info = (!refresh && descriptions.get(key)) || described(key);
        known.set(key, info);
        const descriptor = info.descriptor, resident = residents.get(key);
        if (refresh || !matching(failures.get(key)?.descriptor, descriptor)) failures.delete(key);
        if (!descriptor || failures.has(key)) continue;
        const cost = matching(resident?.descriptor, descriptor) ? resident.bytes : descriptor.bytes;
        if (cost > space) continue;
        selected.set(key, descriptor);
        space -= cost;
      }
      for (const key of failures.keys()) if (!next.has(key)) failures.delete(key);
      demand = next;
      descriptions = known;
      admitted = selected;
      for (const [key, entry] of residents) if (!matching(entry.descriptor, admitted.get(key))) evict(key, entry);
      for (const [key, job] of loading)
        if (!matching(job.descriptor, admitted.get(key))) job.controller.abort();
    }
    function settle(job, succeeded, result) {
      completed.push({ job, succeeded, result });
      schedule();
    }
    function publish({ job: { descriptor, controller }, succeeded, result }) {
      const { key } = descriptor;
      loading.delete(key);
      reservedBytes -= descriptor.bytes;
      const current = !disposed && !controller.signal.aborted && matching(descriptor, admitted.get(key));
      if (!current) {
        if (succeeded) reclaim(result, descriptor);
        return;
      }
      if (!succeeded) {
        failures.set(key, { descriptor, error: result });
        dirty = true;
        return;
      }
      try {
        const used = sizeOf ? sizeOf(result, descriptor) : descriptor.bytes;
        if (!integer(used) || used < 0 || used > descriptor.bytes)
          throw new RangeError('Loaded chunk exceeds its byte reservation or has an invalid size');
        residents.set(key, Object.freeze({ key, descriptor, bytes: used, value: result }));
        bytes += used;
        sequence++;
        published = undefined;
        if (used < descriptor.bytes) dirty = true;
      } catch (error) {
        failures.set(key, { descriptor, error });
        reclaim(result, descriptor);
        dirty = true;
      }
    }
    function status(key) {
      const info = descriptions.get(key);
      if (!info) return Object.freeze({ state: 'missing' });
      if ('error' in info) return Object.freeze({ state: 'failed', error: info.error });
      const { descriptor } = info;
      if (!descriptor) return Object.freeze({ state: 'unavailable' });
      if (failures.has(key)) return Object.freeze({ state: 'failed', descriptor, error: failures.get(key).error });
      if (!admitted.has(key)) return Object.freeze({ state: 'budget', descriptor });
      if (residents.has(key)) return Object.freeze({ state: 'ready', descriptor });
      const job = loading.get(key);
      return Object.freeze({ state: job && !job.controller.signal.aborted ? 'loading' : 'queued', descriptor });
    }
    function notify() {
      for (const waiter of waiters) {
        const { interest, keys, finish } = waiter;
        if (disposed || interest.closed || keys.some(key => !interest.requests.has(key))) {
          finish(null);
          continue;
        }
        const ready = [];
        for (const key of keys) {
          const { state, error } = status(key);
          if (state === 'ready') ready.push(residents.get(key));
          if (state === 'failed') { finish(null, true, error); break; }
          if (state === 'unavailable' || state === 'budget') {
            finish(null, true, new RangeError('Chunk ' + key + ' is ' + (state === 'budget' ? 'outside the active byte budget' : 'unavailable')));
            break;
          }
        }
        if (ready.length === keys.length) finish(Object.freeze(ready));
      }
    }
    function pump() {
      scheduled = false;
      if (dirty && !disposed) plan();
      const finished = completed;
      completed = [];
      for (const job of finished) publish(job);
      if (dirty && !disposed) plan();
      if (!disposed) for (const [key, descriptor] of admitted) {
        if (loading.size >= concurrency || starts === 0) break;
        if (residents.has(key) || loading.has(key) || failures.has(key)) continue;
        // A superseded job keeps its reservation until it settles.
        if (descriptor.bytes > budgetBytes - bytes - reservedBytes) break;
        const controller = new AbortController(), job = { controller, descriptor };
        loading.set(key, job);
        reservedBytes += descriptor.bytes;
        starts--;
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return load(descriptor, { signal: controller.signal });
        }).then(
          result => settle(job, true, result), error => settle(job, false, error));
      }
      notify();
    }
    function interest(id, { priority = 0 } = {}) {
      guard();
      if (!name(id) || interests.has(id) || !finite(priority))
        throw new TypeError('A chunk interest needs a unique ID and finite priority');
      const state = { requests: new Map(), closed: false };
      interests.set(id, state);
      return Object.freeze({
        update(requests, { priority: next = priority } = {}) {
          guard();
          if (state.closed) throw new Error('The chunk interest has closed');
          if (!Array.isArray(requests) || !finite(next)) throw new TypeError('Expected chunk requests and a finite priority');
          const list = new Map();
          for (const request of requests) {
            const key = typeof request === 'string' ? request : request?.key;
            const offset = typeof request === 'string' ? 0 : request?.priority ?? 0;
            if (!name(key) || !finite(offset) || !finite(next + offset))
              throw new TypeError('Chunk requests need a key and finite priority');
            list.set(key, Math.max(list.get(key) ?? -Infinity, next + offset));
          }
          priority = next;
          if (list.size === state.requests.size && [...list].every(([key, weight]) => state.requests.get(key) === weight)) return;
          state.requests = list;
          schedule(true);
        },
        ready({ keys = [...state.requests.keys()], signal } = {}) {
          guard();
          if (state.closed || signal?.aborted) return Promise.resolve(null);
          if (!Array.isArray(keys) || !Array.from(keys).every(key => state.requests.has(key)))
            throw new TypeError('Wait keys must belong to this chunk interest');
          return new Promise((resolve, reject) => {
            const waiter = { interest: state, keys: [...new Set(keys)], finish(value, failed, error) {
              waiters.delete(waiter);
              signal?.removeEventListener('abort', abort);
              if (failed) reject(error);
              else resolve(value);
            } };
            const abort = () => waiter.finish(null);
            signal?.addEventListener('abort', abort, { once: true });
            waiters.add(waiter);
            schedule();
          });
        },
        close() {
          if (state.closed) return false;
          state.closed = true;
          interests.delete(id);
          schedule(true);
          return true;
        }
      });
    }
    return Object.freeze({
      interest, status,
      advance() {
        guard();
        starts = startsPerFrame ?? Infinity;
        schedule();
      },
      refresh() { guard(); refreshAll = true; schedule(true); },
      get: key => residents.get(key) ?? null,
      snapshot() {
        if (published?.sequence !== sequence) published = Object.freeze({ sequence,
          entries: Object.freeze([...residents.values()].sort((a, b) => order(a.key, b.key))) });
        return published;
      },
      stats: () => Object.freeze({
        budgetBytes, bytes, reservedBytes, requested: demand.size, admitted: admitted.size,
        loaded: residents.size, loading: loading.size, interests: interests.size, releaseError
      }),
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const interest of interests.values()) interest.closed = true;
        interests.clear();
        demand.clear();
        admitted.clear();
        descriptions.clear();
        failures.clear();
        for (const job of loading.values()) job.controller.abort();
        for (const [key, entry] of residents) evict(key, entry);
        notify();
      }
    });
  };
})(KIT);
