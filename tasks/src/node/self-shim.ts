// What a shared worker's script expects of `self`, in a Node worker thread.
//
// The router, the pool and the worker are written as shared workers: each
// waits for tabs to connect, and talks to whoever does over the port the
// connection brings. Here the process's main thread (host.ts) is the one tab
// there is. It "connects" by posting a port to the thread, and this turns
// that into the `connect` event the script is waiting for. With this in
// place the three scripts run as they are.
//
// Imported first by each thread's entry point, before the script itself.

import { parentPort, workerData } from 'node:worker_threads';

interface ThreadData {
  /** The name a tab would have given the shared worker. */
  name: string;
  /** Print what the script logs as it goes; without it, only warnings and errors. */
  verbose: boolean;
  /** Where code fetched from automerge is kept (see package-files.ts). */
  codeDir?: string;
}

const data = workerData as ThreadData;
const scope = globalThis as any;
const listeners = new Set<(event: { ports: unknown[] }) => void>();

scope.self = scope;
scope.name = data.name;
scope.__tasksCodeDir = data.codeDir;
scope.addEventListener = (type: string, listener: (event: { ports: unknown[] }) => void) => {
  if (type === 'connect') {
    listeners.add(listener);
  }
};
// in a worker thread this ends the thread, not the process
scope.close = () => process.exit(0);

// The scripts say a good deal as they go (a router, once a second, that it's
// sending a heartbeat), which suits a browser's console and floods a terminal.
if (!data.verbose) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}
const say = (print: (...args: unknown[]) => void) => (...args: unknown[]) => print(`[${data.name}]`, ...args);
console.warn = say(console.warn.bind(console));
console.error = say(console.error.bind(console));

parentPort!.on('message', (message: { type?: string; port?: unknown }) => {
  if (message?.type !== 'connect' || !message.port) {
    return;
  }
  const event = { ports: [message.port] };
  scope.onconnect?.(event);
  for (const listener of listeners) {
    if (listener !== scope.onconnect) {
      listener(event);
    }
  }
});
