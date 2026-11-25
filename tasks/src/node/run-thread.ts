// A run worker (../run-worker.ts) in a Node worker thread: its port is the
// thread's own channel to the process's main thread, where the pool is.

import { parentPort } from 'node:worker_threads';
import { serve, type ToRunWorker } from '../run-worker';
import { shareAutomerge } from './task-imports';

// Before the first message, so before any task's code is imported: a task
// that imports Automerge by bare name gets this thread's own (task-imports.ts).
shareAutomerge();

const port = parentPort!;
serve({
  post: (message) => port.postMessage(message),
  onMessage: (listener) => port.on('message', (message: ToRunWorker) => listener(message)),
});
