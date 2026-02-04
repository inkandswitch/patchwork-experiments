import { AutomergeUrl, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo/slim';

// TODO: replace this with the real thing -- how do we get the account doc?
export async function getSelfContactUrl(repo: Repo): Promise<AutomergeUrl | null> {
  const accountDocUrl = localStorage.getItem('accountDocUrl');
  console.log('accountDocUrl is', accountDocUrl);
  if (!isValidAutomergeUrl(accountDocUrl)) {
    console.log('account doc url invalid', accountDocUrl);
    return null;
  }
  const accountHandle = await repo.find<any>(accountDocUrl);
  if (!accountHandle) {
    console.log('no doc at account doc url', accountDocUrl);
    return null;
  }
  return accountHandle.doc().contactUrl;
}
