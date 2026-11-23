// Every name this package registers or claims, in one place.
//
// They all carry "next" because an older copy of the task framework ships with
// the Patchwork site itself, under the plain names. Patchwork keeps whichever
// plugin registered last under an id, so two packages sharing ids take turns
// winning from one page load to the next. With names of its own, this one
// never meets the other.

/** The datatype of a queue made here. */
export const QUEUE_DATATYPE_ID = 'task-queue-next';

/** What queues made by the older copy are; this package's browser opens them too. */
export const LEGACY_QUEUE_DATATYPE_ID = 'task-queue';

export const QUEUE_TOOL_ID = 'task-queue-next-browser';
export const TITLEBAR_TOOL_ID = 'task-titlebar-next';
export const TRAY_COMPONENT_ID = 'task-tray-next';

/** Shared workers are found by name, so these are names to keep apart as well. */
export const WORKER_POOL_NAME = 'task-next-worker-pool';
export const ROUTER_NAME = 'task-next-router';
export const workerName = (id: number) => `task-next-worker-${id}`;
