import { AutomergeUrl, isValidAutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';

export const TASK_QUEUE_URLS_FIELD_NAME = '__taskQueues__';

// TODO: where's the type for account??
export async function getAccountHandle(repo: Repo): Promise<DocHandle<any>> {
  const accountDocUrl = localStorage.getItem('tinyPatchworkAccountUrl');
  if (!isValidAutomergeUrl(accountDocUrl)) {
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

export async function getSelfContactUrl(repo: Repo): Promise<AutomergeUrl> {
  const accountHandle = await getAccountHandle(repo);
  return accountHandle.doc().contactUrl;
}

export type TaskQueues = { [taskQueueUrl: AutomergeUrl]: true };

export function getTaskQueues(account: any): TaskQueues {
  return account[TASK_QUEUE_URLS_FIELD_NAME] ?? { 'automerge:3AXXV4FHVom6sWu1rD8kBRWq9Bmd': true };
}

export function addTaskQueue(account: any, taskQueueUrl: AutomergeUrl) {
  const taskQueues: TaskQueues | null = account[TASK_QUEUE_URLS_FIELD_NAME];
  if (!taskQueues) {
    account[TASK_QUEUE_URLS_FIELD_NAME] = [];
  }
  taskQueues![taskQueueUrl] = true;
}
