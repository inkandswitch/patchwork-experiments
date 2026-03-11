import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import { TaskQueue } from './datatype';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import { WorkerPoolProxy } from './worker-pool-proxy';
import { getTaskQueues } from './helpers';

const TitlebarToolComponent: React.FC<{ element: HTMLElement }> = ({ element }) => {
  const accountUrl = localStorage.getItem('tinyPatchworkAccountUrl') as AutomergeUrl;
  const [accountDoc] = useDocument<any>(accountUrl, { suspense: true });
  const selfContactUrl: AutomergeUrl | null = accountDoc.contactUrl;
  const taskQueueUrls = getTaskQueues(accountDoc);

  const [, setWorkerPool] = useState<WorkerPoolProxy | null>(null);
  useEffect(() => {
    if (selfContactUrl) {
      const importMapElement = document.querySelector('script[type="importmap"]');
      let importMap = {};
      if (importMapElement) {
        try {
          importMap = JSON.parse(importMapElement.textContent || '{}');
        } catch (e) {
          console.warn('Failed to parse import map:', e);
        }
      }

      const proxy = new WorkerPoolProxy(selfContactUrl, importMap as any, document.baseURI);
      console.log('titlebar-tool created worker pool proxy', proxy);
      setWorkerPool(proxy);
    }
  }, [selfContactUrl]);

  return (
    <div style={{ display: 'flex', gap: '0.25em', alignItems: 'center', height: '100%' }}>
      {Object.keys(taskQueueUrls).map((taskQueueUrl) => (
        <TaskQueueComponent
          key={taskQueueUrl}
          element={element}
          taskQueueUrl={taskQueueUrl as AutomergeUrl}
        />
      ))}
    </div>
  );
};

const TaskQueueComponent: React.FC<{ element: HTMLElement; taskQueueUrl: AutomergeUrl }> = ({
  element,
  taskQueueUrl,
}) => {
  const [doc] = useDocument<TaskQueue>(taskQueueUrl, { suspense: true });
  return (
    <div
      className="h-full flex items-center"
      onClick={() => element.dispatchEvent(createOpenEvent({ url: taskQueueUrl }))}
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
      <>
        <TitlebarToolComponent element={element} />
      </>
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
