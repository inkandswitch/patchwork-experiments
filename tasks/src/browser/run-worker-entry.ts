// A run worker (../run-worker.ts) in a browser: a dedicated worker made by
// the pool's worker (pool-worker.ts), whose port is its own channel to it.

import { serve, type ToRunWorker } from '../run-worker';

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<ToRunWorker>) => void) | null;
};

serve({
  post: (message) => scope.postMessage(message),
  onMessage: (listener) => {
    scope.onmessage = (event) => listener(event.data);
  },
});
