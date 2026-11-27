// The task system as one module: the asker's client, the rules it applies,
// and the helpers for a run kept in a document of its own. It is what the
// library `tasks-next` gives (TASKS_LIBRARY in ids.ts), in a page and in every
// pool, and what dist-node/task-client.mjs is for a Node program that is not a
// pool. The types that more than one of them names are the same types,
// named here once.
/**
 * @typedef {import('./task-rules.js').Task} Task
 * @typedef {import('./task-rules.js').Queue} Queue
 * @typedef {import('./task-rules.js').Run} Run
 * @typedef {import('./task-rules.js').LogLine} LogLine
 * @typedef {import('./task-rules.js').TaskState} TaskState
 * @typedef {import('./task-client.js').Serving} Serving
 */
export * from './task-client.js';
export * from './task-rules.js';
export * from './task-runs.js';
