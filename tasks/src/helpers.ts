import { type AutomergeUrl, type DocHandle, type Repo } from '@automerge/automerge-repo/slim';

export const TASK_QUEUE_URLS_FIELD_NAME = '__taskQueues__';

// TODO: where's the type for account??
export async function getAccountHandle(repo: Repo): Promise<DocHandle<any>> {
  const accountDocUrl = getAccountDocUrl();
  // avoid importing isValidAutomergeUrl for BS packaging reasons
  if (!accountDocUrl.startsWith('automerge:')) {
    const errorMsg = `account doc url invalid: ${accountDocUrl}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  const accountHandle = await repo.find<any>(accountDocUrl);
  if (!accountHandle) {
    const errorMsg = `no doc at account doc url: ${accountDocUrl}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  return accountHandle;
}

// TODO: what's the right way to get this??
export function getAccountDocUrl(): AutomergeUrl {
  // The site knows which account is open; the localStorage key is only where
  // this particular site happens to remember it.
  return (
    (window as any).patchwork?.account?.url ??
    (localStorage.getItem('tinyPatchworkAccountUrl') as AutomergeUrl)
  );
}

export async function getSelfContactUrl(repo: Repo): Promise<AutomergeUrl> {
  const accountHandle = await getAccountHandle(repo);
  return accountHandle.doc().contactUrl;
}

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: true };

/**
 * The queue everyone works on who hasn't chosen otherwise. An account that has
 * never joined or left a queue has no list of its own, and is taken to be on
 * this one.
 */
export const DEFAULT_TASK_QUEUE_URL = 'automerge:2xrHArq3QwSGHaeUdquP7ECTpnEL' as AutomergeUrl;

/** The queues this account's browsers lend their workers to. */
export function getTaskQueues(account: any): TaskQueues {
  return account?.[TASK_QUEUE_URLS_FIELD_NAME] ?? { [DEFAULT_TASK_QUEUE_URL]: true };
}

export function isOnTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  return !!getTaskQueues(account)[taskQueueUrl];
}

/**
 * Adds a queue to the account's list. Call it inside a change to the account
 * doc.
 *
 * An account with no list yet is on the default queue without saying so, and
 * stays on it: its first list starts from that, not from nothing. Otherwise
 * joining a second queue would quietly take it off the first.
 */
export function joinTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  ownTaskQueues(account)[taskQueueUrl] = true;
}

/** Takes a queue off the account's list. Call it inside a change to the account doc. */
export function leaveTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  delete ownTaskQueues(account)[taskQueueUrl];
}

/** The account's own list, written down first if it was only implied. */
function ownTaskQueues(account: any): TaskQueues {
  if (!account[TASK_QUEUE_URLS_FIELD_NAME]) {
    account[TASK_QUEUE_URLS_FIELD_NAME] = { ...getTaskQueues(account) };
  }
  return account[TASK_QUEUE_URLS_FIELD_NAME];
}

export const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });

export function notNull<T>(value: T | null): value is T {
  return value !== null;
}

export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements array[i] and array[j]
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
