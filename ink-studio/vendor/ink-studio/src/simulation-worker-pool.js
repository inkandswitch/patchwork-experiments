const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const loadImplementations = require('./simulation-worker-implementations.js');

module.exports = function createSimulationWorkers(size, { timeoutMs = 30000, modules = [] } = {}) {
  if (!Number.isInteger(size) || size < 1 || size > 32) throw Error('Worker count must be 1–32');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw Error('Simulation worker timeout must be 1–60000 ms');
  if (!Array.isArray(modules) || !modules.every(file => typeof file === 'string' && file))
    throw Error('Simulation worker modules need explicit file paths');
  const files = modules.map(file => path.resolve(file));
  const implementations = files.length ? loadImplementations(files) : undefined;
  const lanes = [];
  let closed = false;
  let bundle;

  function open() {
    if (!bundle) {
      require('..').load();
      bundle = path.join(__dirname, '../dist/standalone.js');
    }
    const { port1: port, port2: remote } = new MessageChannel();
    const ready = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const thread = new Worker(path.join(__dirname, 'simulation-worker.js'), {
      workerData: { bundle, port: remote, ready, files },
      transferList: [remote]
    });
    thread.on('error', () => {});
    thread.unref();
    port.unref();
    const lane = { thread, port, ready, world: null };
    lanes.push(lane);
    return lane;
  }

  function close() {
    closed = true;
    for (const { thread, port } of lanes) {
      port.close();
      thread.terminate().catch(() => {});
    }
    lanes.length = 0;
  }

  function solve(world, jobs) {
    if (closed) throw Error('Simulation worker pool is closed');
    const workers = Math.min(jobs.length, size);
    const batches = Array.from({ length: workers }, () => []);
    for (let i = 0; i < jobs.length; i++) batches[i % workers].push(jobs[i]);
    const deadline = performance.now() + timeoutMs;
    const results = new Map();
    try {
      for (let i = 0; i < workers; i++) {
        const lane = lanes[i] ?? open();
        Atomics.store(lane.ready, 0, 0);
        lane.port.postMessage({ ...(lane.world !== world && { world }), jobs: batches[i] });
        lane.world = world;
      }
      for (let i = 0; i < workers; i++) {
        const { port, ready } = lanes[i];
        if (Atomics.wait(ready, 0, 0, Math.max(0, deadline - performance.now())) === 'timed-out')
          throw Error('Simulation worker timed out');
        const reply = receiveMessageOnPort(port)?.message;
        if (reply?.error) throw Error(reply.error.message, { cause: reply.error });
        if (!reply || reply.results.length !== batches[i].length) throw Error('Invalid simulation worker reply');
        for (const [name, result] of reply.results) results.set(name, result);
      }
    } catch (error) {
      close();
      throw error;
    }
    return { workers, results };
  }

  return Object.freeze({ size, implementations, solve, close });
};
