import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { TaskQueue } from './datatype';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import { WorkerPoolProxy } from './worker-pool-proxy';
import { getSelfContactUrl } from './helpers';

const TASK_QUEUE_URL: AutomergeUrl = 'automerge:4GWBHzg3fYXp338pErVYKkZPc4wE' as any;

const TitlebarToolComponent: React.FC<{ element: HTMLElement; docUrl: AutomergeUrl }> = ({
  element,
  docUrl,
}) => {
  const repo = useRepo();

  const [selfContactUrl, setSelfContactUrl] = useState<AutomergeUrl | null>(null);
  useEffect(() => {
    getSelfContactUrl(repo).then((url) => setSelfContactUrl(url));
  }, [repo]);

  const [workerPool, setWorkerPool] = useState<WorkerPoolProxy | null>(null);
  useEffect(() => {
    console.log('aaaaa');
    if (selfContactUrl) {
      console.log('bbbbb');
      const importMapElement = document.querySelector('script[type="importmap"]');
      let importMap = {};
      console.log('ccccc', importMapElement);
      if (importMapElement) {
        try {
          importMap = JSON.parse(importMapElement.textContent || '{}');
        } catch (e) {
          console.warn('Failed to parse import map:', e);
        }
      }

      console.log('creating wpp');
      const wp = new WorkerPoolProxy(selfContactUrl, importMap as any, document.baseURI);
      console.log('joining dummy task queue');
      // TODO: join/leave task queues based on the WorkerPool Automerge document
      // (see my plan in datatype.ts)
      wp.joinTaskQueue(docUrl);

      console.log('#### worker pool', wp);

      console.log('setting wpp');
      setWorkerPool(wp);
      console.log('done');
    }
  }, [selfContactUrl]);

  const [doc] = useDocument<TaskQueue>(docUrl, { suspense: true });

  return (
    <div
      className="h-full flex items-center"
      onClick={() => element.dispatchEvent(createOpenEvent({ url: docUrl }))}
    >
      <span>{doc.title ?? 'AAATQ'}</span>
      <span>{doc.pending.length}</span>/<span>{doc.done.length}</span>
    </div>
  );
};

export const TitlebarTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <TitlebarToolComponent element={element} docUrl={TASK_QUEUE_URL} />
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
