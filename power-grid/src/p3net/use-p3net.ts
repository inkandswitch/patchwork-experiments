import { useState, useEffect } from 'react';
import { useRepo } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { getRegistry, createDocOfDatatype2 } from '@inkandswitch/patchwork-plugins';
import { importModuleFromFolderDocUrl } from '@inkandswitch/patchwork-filesystem';
import type { P3NetDoc } from './doc';
import { defineNet } from './lib';
import type { NetApi, PetriNet } from './lib';
import { runLLMProcess } from '../../../llm/src/llm-process';

/**
 * Loads the p3net factory from the source folder via the service worker,
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

    const api: NetApi = {
      datatypes: getRegistry('patchwork:datatype'),
      createDocOfDatatype2,
      runLLMProcess,
    };

    importModuleFromFolderDocUrl(sourceUrl as AutomergeUrl)
      .then((mod) => {
        const factory = mod.default;
        if (typeof factory !== 'function') {
          setLoadError('Source must default-export a function (repo, api) => NetDef.');
          return;
        }
        setNet(defineNet(factory(repo, api))(handle, repo));
        setLoadedSourceUrl(sourceUrl);
        setLoadError(null);
      })
      .catch((err) => setLoadError(String(err)));
  }, [sourceUrl, handle, repo, loadedSourceUrl]);

  return { net, loadError };
}
