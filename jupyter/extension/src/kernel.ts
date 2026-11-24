import type { NotebookPanel } from '@jupyterlab/notebook';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { KernelBridge } from './bridge';

/** The kernel JupyterLite's Pyodide kernel registers. */
const PYODIDE_KERNEL = 'python';

/**
 * Give every Pyodide kernel the notebook starts (or restarts) its own
 * Patchwork node, so `import patchwork` can mount documents as files.
 */
export function connectKernels(sessionContext: NotebookPanel['sessionContext'], config: KernelBridge): void {
  const connected = new WeakSet<Kernel.IKernelConnection>();
  const onStatus = (kernel: Kernel.IKernelConnection) => {
    if (kernel.status === 'restarting' || kernel.status === 'autorestarting') {
      connected.delete(kernel);
    } else if (kernel.status === 'idle' && kernel.name === PYODIDE_KERNEL && !connected.has(kernel)) {
      connected.add(kernel);
      void connect(kernel, config);
    }
  };
  sessionContext.statusChanged.connect(() => {
    const kernel = sessionContext.session?.kernel;
    if (kernel) onStatus(kernel);
  });
}

async function connect(kernel: Kernel.IKernelConnection, config: KernelBridge): Promise<void> {
  const settings = { storagePrefix: config.storagePrefix, ...(config.syncServer ? { syncServer: config.syncServer } : {}) };
  const code = [
    'import piplite',
    'await piplite.install("patchwork")',
    'import patchwork',
    `await patchwork._connect(${JSON.stringify(config.moduleUrl)}, ${JSON.stringify(settings)})`,
    'del piplite, patchwork'
  ].join('\n');
  const reply = (await kernel.requestExecute({ code, silent: true, store_history: false }).done) as
    | KernelMessage.IExecuteReplyMsg
    | undefined;
  const content = reply?.content;
  if (content?.status === 'error') {
    console.warn(`Couldn't connect the kernel to Patchwork: ${content.ename}: ${content.evalue}`);
  }
}
