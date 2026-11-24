// The worker: an EvaluationServer, connected to whoever started it. See remote.ts.

import { EvaluationServer, type ToWorker } from './remote';

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
};

const server = new EvaluationServer((message) => scope.postMessage(message));
scope.onmessage = (event) => server.receive(event.data);
