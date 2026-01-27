import { AutomergeUrl, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo/slim';

// TODO: replace this with the real thing -- how do we get the account doc?
export async function getSelfContactUrl(repo: Repo): Promise<AutomergeUrl | null> {
  const accountDocUrl = localStorage.getItem('accountDocUrl');
  if (!isValidAutomergeUrl(accountDocUrl)) {
    return null;
  }
  const accountHandle = await repo.find<any>(accountDocUrl);
  if (!accountHandle) {
    return null;
  }
  return accountHandle.doc().contactUrl;
}
