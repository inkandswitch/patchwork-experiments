import type { AutomergeUrl } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { DatatypeImplementation, ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { createRoot } from 'react-dom/client';
import kitdefsSource from '../kitdefs.js?raw';
import { LivelymergeDatatype } from './datatype';
import { LivelymergeEditor } from './Livelymerge';
import type { LivelymergeDoc } from './types';

/** A Kit document is a Livelymerge heap that boots kitdefs.js instead of newdefs. */
export const KitDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc, ...rest: unknown[]) {
    (LivelymergeDatatype.init as (...args: unknown[]) => void)(doc, ...rest);
    (doc as any)['@patchwork'] = { type: 'kit' };
    doc.title = 'Untitled Kit';
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Kit';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};

export function renderKitEditor(handle: { url: AutomergeUrl }, element: ToolElement): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo as any}>
      <LivelymergeEditor docUrl={handle.url} bootSource={kitdefsSource} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
}
