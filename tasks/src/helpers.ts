import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { acceptanceOf, type Acceptance, type QueueSetting } from './acceptance';

export const TASK_QUEUE_URLS_FIELD_NAME = '__taskQueues__';

// TODO: what's the right way to get this??
export function getAccountDocUrl(): AutomergeUrl {
  // The site knows which account is open; the localStorage key is only where
  // this particular site happens to remember it.
  return (
    (window as any).patchwork?.account?.url ??
    (localStorage.getItem('tinyPatchworkAccountUrl') as AutomergeUrl)
  );
}

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: QueueSetting };

/** The queues this account's browsers lend their workers to. An account with no list serves none. */
export function getTaskQueues(account: any): TaskQueues {
  return account?.[TASK_QUEUE_URLS_FIELD_NAME] ?? {};
}

export function isOnTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  return !!getTaskQueues(account)[taskQueueUrl];
}

/** Adds a queue to the account's list. Call it inside a change to the account doc. */
export function joinTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  const queues = ownTaskQueues(account);
  if (!queues[taskQueueUrl]) {
    queues[taskQueueUrl] = true;
  }
}

/** Whose code this account's browsers run from a queue they work on (see acceptance.ts). */
export function getAcceptance(account: any, taskQueueUrl: AutomergeUrl): Acceptance | undefined {
  return acceptanceOf(getTaskQueues(account)[taskQueueUrl]);
}

/**
 * Says whose code this account's browsers run from a queue: any, or only
 * what is in these packages. Call it inside a change to the account doc.
 */
export function setAcceptance(account: any, taskQueueUrl: AutomergeUrl, acceptance: Acceptance) {
  ownTaskQueues(account)[taskQueueUrl] =
    acceptance === 'any' ? true : { packages: [...acceptance] };
}

/** Takes a queue off the account's list. Call it inside a change to the account doc. */
export function leaveTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  delete ownTaskQueues(account)[taskQueueUrl];
}

/** The account's own list, made empty the first time it is needed. */
function ownTaskQueues(account: any): TaskQueues {
  if (!account[TASK_QUEUE_URLS_FIELD_NAME]) {
    account[TASK_QUEUE_URLS_FIELD_NAME] = {};
  }
  return account[TASK_QUEUE_URLS_FIELD_NAME];
}
