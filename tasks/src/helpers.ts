import { AutomergeUrl, isValidAutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';

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
