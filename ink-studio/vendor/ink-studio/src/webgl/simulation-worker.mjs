import { loadSimulationModules } from './simulation-worker-modules.mjs';

const details = error => ({ name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack });
let runtime, implementations, kernel;

self.addEventListener('message', async ({ data: { bundle, modules, world, jobs } }) => {
  try {
    if (bundle) {
      const [{ KIT }, factories] = await Promise.all([import(bundle), loadSimulationModules(modules)]);
      runtime = KIT.world.runtime;
      implementations = factories;
    }
    if (world) kernel = runtime.partitionKernel(world, implementations);
    const results = jobs.map(job => {
      try {
        return [job.name, kernel(job)];
      } catch (error) {
        return [job.name, { error: details(error) }];
      }
    });
    self.postMessage({ results });
  } catch (error) {
    self.postMessage({ error: details(error) });
  }
});
