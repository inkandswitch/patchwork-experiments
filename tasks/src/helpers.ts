import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { servedOf, setServed, type TasksStorage } from './task-client.js';

// The queues this person's browsers serve live in the task system's tool
// storage on their account (see `A person's queues` in task-client.js, which
// says what that document holds). These read and write it only through
// task-client.js's `servedOf` and `setServed`. Reading takes whatever the
// account names, or nothing; the first write goes through `tasksStorage`,
// which asks the frame to make the document.

/**
 * The url of the account open on this page. The frame's tool-storage
 * provider writes to the account whose handle the site sets on the page, so
 * that one comes first; the others are where a site without it says which
 * account is open.
 */
export function getAccountDocUrl(): AutomergeUrl {
  return (
    (globalThis as any).accountDocHandle?.url ??
    (window as any).patchwork?.account?.url ??
    (localStorage.getItem('tinyPatchworkAccountUrl') as AutomergeUrl)
  );
}

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: true };

/** The queues this person's browsers lend their workers to, from the task storage document: each one it lists under any truthy value. No document serves none. */
export function getTaskQueues(storage: unknown): TaskQueues {
  const queues: TaskQueues = {};
  for (const [url, setting] of Object.entries(servedOf(storage))) {
    if (setting) {
      queues[url as AutomergeUrl] = true;
    }
  }
  return queues;
}

export function isOnTaskQueue(storage: unknown, taskQueueUrl: AutomergeUrl) {
  return Object.hasOwn(getTaskQueues(storage), taskQueueUrl);
}

/** Serves a queue, unless it is served already. Call it inside a change to the storage document. */
export function joinTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  if (!isOnTaskQueue(storage, taskQueueUrl)) {
    setServed(storage, taskQueueUrl, true);
  }
}

/** Stops serving a queue. Call it inside a change to the storage document. */
export function leaveTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  setServed(storage, taskQueueUrl, null);
}
