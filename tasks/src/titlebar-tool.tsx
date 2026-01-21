import React from 'react';
import { createRoot } from 'react-dom/client';
import { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import { TaskQueue } from './datatype';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';

const TitlebarToolComponent: React.FC<{ element: HTMLElement; docUrl: AutomergeUrl }> = ({
  element,
  docUrl,
}) => {
  const [doc] = useDocument<TaskQueue>(docUrl, { suspense: true });

  return (
    <div
      className="h-full flex items-center"
      onClick={() => element.dispatchEvent(createOpenEvent({ url: docUrl }))}
    >
      <span>{doc.title ?? 'TQ'}</span>
      <span>{doc.pending.length}</span>/<span>{doc.done.length}</span>
    </div>
  );
};

export const TitlebarTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <TitlebarToolComponent
        element={element}
        docUrl={'automerge:38YYaP6izqpmgUcTK2NNhmDJj1fD' as AutomergeUrl}
      />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

function createOpenEvent(detail: OpenDocumentEventDetail) {
  const openEvent = new CustomEvent('patchwork:open-document', {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}
