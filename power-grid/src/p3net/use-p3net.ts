import { useState, useEffect } from 'react';
import { useRepo } from '@automerge/automerge-repo-react-hooks';
import type { DocHandle } from '@automerge/automerge-repo';
import type { P3NetDoc } from './doc';
import type { PetriNet } from './lib';

/**
 * Loads the p3net factory from the linked source doc via the service worker,
 * binds it to the given handle + repo, and returns the live PetriNet instance.
 */
export function useP3Net(
  handle: DocHandle<P3NetDoc>,
  sourceUrl: string | undefined,
): { net: PetriNet | null; loadError: string | null } {
  const repo = useRepo();
  const [net, setNet] = useState<PetriNet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedSourceUrl, setLoadedSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceUrl) return;
    if (sourceUrl === loadedSourceUrl) return;

    // "automerge:abc123" → "/automerge%3Aabc123" for the service worker
    const swUrl = sourceUrl.replace('automerge:', '/automerge%3A');

    import(/* @vite-ignore */ swUrl)
      .then((mod) => {
        const factory = mod.default;
        if (typeof factory !== 'function') {
          setLoadError('Source must export a defineNet() result as default export.');
          return;
        }
        setNet(factory(handle, repo));
        setLoadedSourceUrl(sourceUrl);
        setLoadError(null);
      })
      .catch((err) => setLoadError(String(err)));
  }, [sourceUrl, handle, repo, loadedSourceUrl]);

  return { net, loadError };
}
