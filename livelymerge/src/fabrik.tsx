import type { AutomergeUrl } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { DatatypeImplementation, ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { createRoot } from 'react-dom/client';
import fabrikSource from '../Fabrik.js?raw';
import newdefsSource from '../newdefs.js?raw';
import { LivelymergeDatatype } from './datatype';
import { LivelymergeEditor } from './Livelymerge';
import type { LivelymergeDoc } from './types';

function stripTrailingInit(src: string) {
  return src.replace(/\binit\(\)\s*(?:\/\/[^\n]*\s*)*$/, '');
}

/** newdefs classes + Fabrik surface (populateLively is skipped). */
export const FABRIK_BOOT_SOURCE = stripTrailingInit(newdefsSource) + '\n' + fabrikSource;

/** A Fabrik document is a Livelymerge heap that boots newdefs, then Fabrik.js. */
export const FabrikDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc, ...rest: unknown[]) {
    (LivelymergeDatatype.init as (...args: unknown[]) => void)(doc, ...rest);
    (doc as any)['@patchwork'] = { type: 'fabrik' };
    doc.title = 'Untitled Fabrik';
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Fabrik';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};

export function renderFabrikEditor(handle: { url: AutomergeUrl }, element: ToolElement): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo as any}>
      <LivelymergeEditor docUrl={handle.url} bootSource={FABRIK_BOOT_SOURCE} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
}
