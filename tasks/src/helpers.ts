import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { acceptanceOf, type Acceptance, type QueueSetting } from './acceptance';
import { servedOf, type TasksStorage } from './task-client.js';

// The queues this person's browsers serve live in the task system's tool
// storage on their account (see `tasksStorage` in task-client.js): these read
// and write that document. Reading takes whatever the account names, or
// nothing; the first write goes through `tasksStorage`, which asks the frame
// to make the document.

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

/** The queues this person's browsers lend their workers to, from the task storage document. No document serves none. */
export function getTaskQueues(storage: unknown): TaskQueues {
  return servedOf(storage) as TaskQueues;
}

export function isOnTaskQueue(storage: unknown, taskQueueUrl: AutomergeUrl) {
  return acceptanceOf(getTaskQueues(storage)[taskQueueUrl]) !== undefined;
}

/** Adds a queue to the served list, for any code. Call it inside a change to the storage document. */
export function joinTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  const queues = servedList(storage);
  if (acceptanceOf(queues[taskQueueUrl]) === undefined) {
    queues[taskQueueUrl] = true;
  }
}

/** Whose code this person's browsers run from a queue they serve (see acceptance.ts). */
export function getAcceptance(storage: unknown, taskQueueUrl: AutomergeUrl): Acceptance | undefined {
  return acceptanceOf(getTaskQueues(storage)[taskQueueUrl]);
}

/**
 * Says whose code this person's browsers run from a queue: any, or only
 * what is in these packages. Call it inside a change to the storage document.
 */
export function setAcceptance(storage: TasksStorage, taskQueueUrl: AutomergeUrl, acceptance: Acceptance) {
  servedList(storage)[taskQueueUrl] = acceptance === 'any' ? true : { packages: [...acceptance] };
}

/** Takes a queue off the served list. Call it inside a change to the storage document. */
export function leaveTaskQueue(storage: TasksStorage, taskQueueUrl: AutomergeUrl) {
  const queues = storage.served;
  if (queues && typeof queues === 'object' && Object.hasOwn(queues, taskQueueUrl)) {
    delete queues[taskQueueUrl];
  }
}

/**
 * The document's served list, made empty the first time it is needed (or
 * when what is there is no list). Two replicas that each make the list at
 * once keep one of the two whole after the merge, so what was put in the
 * other is lost: a queue joined that way reads as not joined, and the queue
 * browser offers to join it again.
 */
function servedList(storage: TasksStorage): { [url: string]: QueueSetting } {
  if (!storage.served || typeof storage.served !== 'object' || Array.isArray(storage.served)) {
    storage.served = {};
  }
  return storage.served;
}
