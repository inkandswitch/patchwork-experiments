import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { acceptanceOf, type Acceptance, type QueueSetting } from './acceptance';
import { servedOf, setServed, type TasksStorage } from './task-client.js';

// The queues this person's browsers serve live in the task system's tool
// storage on their account (see `tasksStorage` in task-client.js, which also
// says how that document is shaped and why). These read and write it only
// through task-client.js's `servedOf` and `setServed`. Reading takes whatever
// the account names, or nothing; the first write goes through `tasksStorage`,
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

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: QueueSetting };

/** The queues this person's browsers lend their workers to, from the task storage document, each with a setting that serves it. No document serves none. */
export function getTaskQueues(storage: unknown): TaskQueues {
  const queues: TaskQueues = {};
  for (const [url, setting] of Object.entries(servedOf(storage))) {
    if (acceptanceOf(setting) !== undefined) {
      queues[url as AutomergeUrl] = setting as QueueSetting;
    }
  }
  return queues;
}

export function isOnTaskQueue(storage: unknown, taskQueueUrl: AutomergeUrl) {
  return getAcceptance(storage, taskQueueUrl) !== undefined;
}

/** Serves a queue for any code, unless it is served already (when its setting stands). Call it inside a change to the storage document. */
export function joinTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  if (!isOnTaskQueue(storage, taskQueueUrl)) {
    setServed(storage, taskQueueUrl, true);
  }
}

/** Whose code this person's browsers run from a queue they serve (see acceptance.ts). */
export function getAcceptance(storage: unknown, taskQueueUrl: AutomergeUrl): Acceptance | undefined {
  const served = servedOf(storage);
  return Object.hasOwn(served, taskQueueUrl) ? acceptanceOf(served[taskQueueUrl]) : undefined;
}

/**
 * Says whose code this person's browsers run from a queue: any, or only
 * what is in these packages. Call it inside a change to the storage document.
 */
export function setAcceptance(storage: TasksStorage, taskQueueUrl: AutomergeUrl, acceptance: Acceptance) {
  setServed(storage, taskQueueUrl, acceptance === 'any' ? true : { packages: [...acceptance] });
}

/** Stops serving a queue. Call it inside a change to the storage document. */
export function leaveTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  setServed(storage, taskQueueUrl, null);
}
