const { workerData } = require('node:worker_threads');
const loadImplementations = require('./simulation-worker-implementations.js');

const { bundle, port, ready, files } = workerData;
const details = error => ({ name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack });
let kernel, implementations;

port.on('message', ({ world, jobs }) => {
  let reply;
  try {
    if (world) {
      implementations ??= loadImplementations(files);
      kernel = require(bundle).KIT.world.runtime.partitionKernel(world, implementations);
    }
    reply = { results: jobs.map(job => {
      try {
        return [job.name, kernel(job)];
      } catch (error) {
        return [job.name, { error: details(error) }];
      }
    }) };
    port.postMessage(reply);
  } catch (error) {
    port.postMessage({ error: details(error) });
  } finally {
    Atomics.store(ready, 0, 1);
    Atomics.notify(ready, 0);
  }
});
