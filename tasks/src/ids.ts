// Every name this package registers or claims, in one place.
//
// They all carry "next" because an older copy of the task framework ships with
// the Patchwork site itself, under the plain names. Patchwork keeps whichever
// plugin registered last under an id, so two packages sharing ids take turns
// winning from one page load to the next. With names of its own, this one
// never meets the other.

// The datatype of a queue made here, and the tool id the task system's
// storage is kept under on an account (`account.toolStorage[...]`). Both are
// defined in the asker's client, which makes a person's own queue from any
// package that carries it, and are the same names here.
export { QUEUE_DATATYPE_ID, TASKS_STORAGE_ID } from './task-client.js';

export const QUEUE_TOOL_ID = 'task-queue-next-browser';
export const TITLEBAR_TOOL_ID = 'task-titlebar-next';
export const TRAY_COMPONENT_ID = 'task-tray-next';
export const POOL_COMPONENT_ID = 'task-pool-next';

/**
 * Where, in this package as it is published, the task it brings along is
 * (see src/tasks/wait.ts): a way to try a queue out without writing any code.
 * The build puts it there under that name (vite.config.ts).
 */
export const WAIT_TASK_PATH = 'dist/tasks/wait.js';

// The task system's Repos, in the workers and in each tab, keep their
// documents in a database of their own and tell each other what they've saved
// on a channel of their own, rather than sharing the site's. That makes them
// one family: what any of them saves, the rest have a moment later, with or
// without a network. It's also what keeps them apart from the site's own Repo,
// which on a keyhive site is no ordinary one.
export const TASKS_DATABASE = 'patchwork-tasks';
export const TASKS_HEADS_CHANNEL = 'patchwork-tasks-heads';
