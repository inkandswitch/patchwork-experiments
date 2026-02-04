import { AutomergeUrl, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo/slim';

export async function getSelfContactUrl(repo: Repo): Promise<AutomergeUrl | null> {
  const accountDocUrl = localStorage.getItem('tinyPatchworkAccountUrl');
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
