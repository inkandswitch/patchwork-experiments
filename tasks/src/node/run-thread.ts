// A run worker (../run-worker.ts) in a Node worker thread: its port is the
// thread's own channel to the process's main thread, where the pool is.

import { parentPort } from 'node:worker_threads';
import { serve, type ToRunWorker } from '../run-worker';

const port = parentPort!;
serve({
  post: (message) => port.postMessage(message),
  onMessage: (listener) => port.on('message', (message: ToRunWorker) => listener(message)),
});
