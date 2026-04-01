import { createResource, type Accessor } from 'solid-js';
import { useDocument } from '@automerge/automerge-repo-solid-primitives';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

export function useTitle(url: Accessor<AutomergeUrl | undefined>): Accessor<string> {
  const [doc] = useDocument<HasPatchworkMetadata>(() => url());

  const docType = () => doc()?.['@patchwork']?.type ?? '';

  const [datatype] = createResource(docType, (dt) =>
    dt ? getRegistry('patchwork:datatype').load(dt) : Promise.resolve(null),
  );

  return () => {
    const d = doc();
    if (!d) return 'Untitled';
    return (datatype()?.module as any)?.getTitle?.(d) || 'Untitled';
  };
}

export async function getDocTitle(repo: Repo, url: AutomergeUrl): Promise<string> {
  try {
    const handle = await repo.find(url);
    const doc = await handle.doc();
    if (doc && typeof doc === 'object') {
      const patchworkDoc = doc as HasPatchworkMetadata;
      const docType = patchworkDoc['@patchwork']?.type;
      if (docType) {
        const datatype = await getRegistry('patchwork:datatype').load(docType);
        if (datatype?.module?.getTitle) {
          return (datatype.module as any).getTitle(doc) || 'Untitled';
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return 'Untitled';
}
