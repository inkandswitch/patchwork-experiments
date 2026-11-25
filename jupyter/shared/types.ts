/** Lets Python in a Pyodide kernel run its own Patchwork node (see pyfs/). */
export type KernelBridge = {
  /** The worker module the `patchwork` Python package imports. */
  moduleUrl: string;
  storagePrefix: string;
  syncServer?: string;
};

/**
 * The code a fresh Pyodide kernel runs, silently, to connect `import
 * patchwork` to Patchwork.
 */
export function kernelBootstrap(config: KernelBridge): string {
  const settings = { storagePrefix: config.storagePrefix, ...(config.syncServer ? { syncServer: config.syncServer } : {}) };
  return [
    'import piplite',
    'await piplite.install("patchwork")',
    'import patchwork',
    `await patchwork._connect(${JSON.stringify(config.moduleUrl)}, ${JSON.stringify(settings)})`,
    'del piplite, patchwork'
  ].join('\n');
}
