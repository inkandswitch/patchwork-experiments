import { loadSimulationModules } from './simulation-worker-modules.mjs';

/** Run eligible solver partitions on same-origin browser module workers. */
export async function createBrowserSimulationWorkers(size, { bundle, modules = [], timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(size) || size < 1 || size > 32) throw Error('Worker count must be 1–32');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw Error('Simulation worker timeout must be 1–60000 ms');
  if (typeof Worker !== 'function') throw Error('Browser simulation workers need the Worker API');
  const isURL = value => value instanceof URL || typeof value === 'string' && value.length > 0;
  if (!isURL(bundle) || !Array.isArray(modules) || !modules.every(isURL))
    throw Error('Browser simulation workers need an explicit module bundle and module URLs');
  const url = value => new URL(value, globalThis.location.href).href;
  const bundleURL = url(bundle), moduleURLs = modules.map(url);
  const implementations = await loadSimulationModules(moduleURLs);
  const lanes = [];
  let closed = false, tail = Promise.resolve();

  function shutdown(error) {
    if (closed) return;
    closed = true;
    for (const lane of lanes) lane.close(error);
    lanes.length = 0;
  }

  function open() {
    const worker = new Worker(new URL('./simulation-worker.mjs', import.meta.url), { type: 'module' });
    let finish, world;
    worker.addEventListener('message', ({ data }) => finish?.(null, data));
    worker.addEventListener('error', event => shutdown(Error(event.message || 'Simulation worker failed to load')));
    worker.addEventListener('messageerror', () => shutdown(Error('Invalid simulation worker message')));
    return {
      send(current, jobs) {
        if (closed) return Promise.reject(Error('Simulation worker pool is closed'));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => shutdown(Error('Simulation worker timed out')), timeoutMs);
          finish = (error, data) => {
            finish = undefined;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(data);
          };
          try {
            worker.postMessage({
              ...(!world && { bundle: bundleURL, modules: moduleURLs }),
              ...(world !== current && { world: current }), jobs
            });
            world = current;
          } catch (error) {
            shutdown(error);
          }
        });
      },
      close(error) {
        finish?.(error);
        worker.terminate();
      }
    };
  }

  async function batch(world, jobs) {
    if (closed) throw Error('Simulation worker pool is closed');
    const workers = Math.min(jobs.length, size);
    const batches = Array.from({ length: workers }, () => []);
    for (let i = 0; i < jobs.length; i++) batches[i % workers].push(jobs[i]);
    try {
      const lanesInUse = batches.map((_, i) => lanes[i] ??= open());
      const replies = await Promise.all(lanesInUse.map((lane, i) => lane.send(world, batches[i])));
      const results = new Map();
      for (const [i, reply] of replies.entries()) {
        if (reply?.error) throw Error(reply.error.message, { cause: reply.error });
        if (!Array.isArray(reply?.results) || reply.results.length !== batches[i].length)
          throw Error('Invalid simulation worker reply');
        for (const [j, [name, result]] of reply.results.entries()) {
          if (name !== batches[i][j].name || !result) throw Error('Invalid simulation worker job result');
          results.set(name, result);
        }
      }
      return { workers, results };
    } catch (error) {
      shutdown(error);
      throw error;
    }
  }

  function solve(world, jobs) {
    const pending = tail.then(() => batch(world, jobs));
    tail = pending.catch(() => {});
    return pending;
  }

  return Object.freeze({ size, async: true, implementations, solve,
    close: () => shutdown(Error('Simulation worker pool is closed')) });
}
