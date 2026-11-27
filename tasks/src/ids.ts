// Every name this package registers or claims, in one place.
//
// They all carry "next" because an older copy of the task framework ships with
// the Patchwork site itself, under the plain names. Patchwork keeps whichever
// plugin registered last under an id, so two packages sharing ids take turns
// winning from one page load to the next. With names of its own, this one
// never meets the other.

// The datatype of a queue made here, the tool id the task system's storage
// is kept under on an account (`account.toolStorage[...]`), and the
// background component that puts a page in its browser's pool. All three are
// defined in the asker's client, which makes a person's own queue and joins
// the pool from any page that asks for work, and are the same names here.
export { POOL_COMPONENT_ID, QUEUE_DATATYPE_ID, TASKS_STORAGE_ID } from './task-client.js';
import * as client from './client.js';

/**
 * The task system as a library in the plugin registry: one module with the
 * client, the rules and the run helpers (client.js). Code asks for it as a
 * page does, `(await getRegistry(TASKS_LIBRARY.type).loadWhenReady(TASKS_LIBRARY.id)).module`.
 * The package registers it (index.ts), and every pool registers it in its own
 * registry as it starts, from its own build, where nothing installed has
 * (run-worker.ts).
 */
export const TASKS_LIBRARY = {
  type: 'patchwork:library',
  id: 'tasks-next',
  name: 'Tasks client (experimental)',
  load: async () => client,
};

export const QUEUE_TOOL_ID = 'task-queue-next-browser';
export const TITLEBAR_TOOL_ID = 'task-titlebar-next';
export const TRAY_COMPONENT_ID = 'task-tray-next';

/**
 * Where, in this package as it is published, the task it brings along is
 * (see src/tasks/wait.ts): a way to try a queue out without writing any code.
 * The build puts it there under that name (vite.config.ts).
 */
export const WAIT_TASK_PATH = 'dist/tasks/wait.js';

// The pool's worker keeps its documents in a database of its own, rather than the site's.
export const TASKS_DATABASE = 'patchwork-tasks';

/** How the peer id of a browser worker's Repo starts: the site's Repo offers such a peer nothing (browser/pool-host.ts). */
export const WORKER_PEER = 'task-worker-';
