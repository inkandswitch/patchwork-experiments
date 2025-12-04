import React, { Suspense, useEffect, useState } from 'react';
import { useRepo, useDocument, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { AutomergeUrl, DocHandle, Repo, updateText } from '@automerge/automerge-repo';
import { Router, RunInfo, Worker as TaskWorker, Task, TaskQueue } from './datatype';
import * as router from './router';
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';

const NUM_WORKERS = 2;

const IRouter: React.FC<any> = ({ docUrl, isMine }: { docUrl: AutomergeUrl; isMine: boolean }) => {
  const [doc] = useDocument<Router>(docUrl, { suspense: true });
  return (
    <div className="m-4">
      {doc.contactUrl /* && <InlineContactAvatar url={doc.contactUrl} size={'default'} />*/} /{' '}
      {doc.name}
      {isMine ? ' (mine)' : ''}
    </div>
  );
};

export const RouterComponent: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <IRouter {...props} />
  </Suspense>
);

const IWorker: React.FC<any> = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<TaskWorker>(docUrl, { suspense: true });
  return (
    <div className="m-4">
      <div>
        {doc.contactUrl /*&& <InlineContactAvatar url={doc.contactUrl} size={'default'} />*/} /{' '}
        {doc.name}
      </div>
      <div>
        {doc.currentTask ? <TaskBrowserTool docUrl={doc.currentTask} docPath={[]} /> : 'idle'}
      </div>
    </div>
  );
};

export const WorkerComponent: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <IWorker {...props} />
  </Suspense>
);

// TODO: element.repo is not ideal
export const Tool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <div className="flex flex-col items-center justify-center h-full">
        <Suspense fallback="...">
          <ITaskQueueBrowserTool docUrl={handle.url} />
        </Suspense>
      </div>
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

// TODO: EditorProps replacement type
const ITaskBrowserTool: React.FC<any> = ({ docUrl }) => {
  const [doc] = useDocument<Task<any, any>>(docUrl, { suspense: true });
  const hasntRun = doc.runs.length === 0;
  const failed = doc.runs.every((run) => run.status === 'failed');
  const [code, setCode] = useState('');

  useEffect(() => {
    fetch(doc.importUrl)
      .then((res) => res.text())
      .then((text) => {
        setCode(text);
      });
  }, [doc.importUrl]);

  return (
    <div
      className={`m-4 p-4 border ${
        hasntRun ? 'border-l-gray-500' : failed ? 'border-l-red-500' : 'border-l-lime-500'
      } border-l-8 m`}
    >
      {doc.runs.map((run: RunInfo<any>) => (
        <div key={run.startTime} className="bg-black text-white pl-2 mb-2">
          <div className="align-text-top">
            {JSON.stringify(doc.input)}
            <Run key={run.startTime} run={run} />
            {run.log && run.log.length > 0 && (
              <details>
                <summary>logs</summary>
                {run.log.map(([timestamp, msg]) => (
                  <div key={timestamp}>
                    {new Date(timestamp).toLocaleString()}: {msg}
                  </div>
                ))}
              </details>
            )}
          </div>
        </div>
      ))}
      <div>{code ? <pre>{code}</pre> : <div>Loading code...</div>}</div>
    </div>
  );
};

const Run: React.FC<any> = ({ run }: { run: RunInfo<any> }) => {
  const { startTime, endTime, result, status } = run;
  const timeAgo = `${endTime - startTime}ms`;
  const [doc] = useDocument<TaskWorker>(run.worker as AutomergeUrl, { suspense: true });
  return (
    <div>
      <div>
        {doc.contactUrl /*&& <InlineContactAvatar url={doc.contactUrl} size={'default'} />*/} /{' '}
        {doc.name} → {status === 'succeeded' ? result : '✗'} ({timeAgo})
      </div>
    </div>
  );
};

export const TaskBrowserTool: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <ITaskBrowserTool {...props} />
  </Suspense>
);

const ITaskQueueBrowserTool: React.FC<any> = ({ docUrl }) => {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<TaskQueue>(docUrl, { suspense: true });

  const handle = useDocHandle<TaskQueue>(docUrl, { suspense: true });

  const [myRouterUrl, setMyRouterUrl] = useState<AutomergeUrl | null>(null);
  const [myWorkers, setMyWorkers] = useState<Worker[]>([]);
  const [workers, setWorkers] = useState<AutomergeUrl[]>([]);

  useEffect(() => {
    const messageHandler = (m: any) => {
      if (m?.message?.workers) {
        setWorkers(m.message.workers);
      }
    };
    handle.on('ephemeral-message', messageHandler);
    return () => {
      handle.off('ephemeral-message', messageHandler);
    };
  }, [handle]);

  // const account = useCurrentAccount();
  // const contactUrl = account?.contactHandle?.url;

  // everyone is pvh until grjte saves us
  const contactUrl = 'automerge:2GNWv5e8GRirMDEff14LfQKCc9J6' as AutomergeUrl;

  useEffect(() => {
    if (!contactUrl) {
      return;
    }

    setMyRouterUrl(
      router.start(
        repo as unknown as Repo,
        handle as unknown as DocHandle<TaskQueue>,
        setWorkers,
        contactUrl
      )
    );
    setMyWorkers(startWorkers(handle as unknown as DocHandle<TaskQueue>, contactUrl));
    return () => {
      setMyRouterUrl(null);
      router.stop();
      for (const worker of myWorkers) {
        worker.terminate();
      }
      setMyWorkers([]);
    };
  }, [repo, docUrl, contactUrl]);

  return (
    <div className="task-browser h-full overflow-y-auto">
      <div className="flex flex-col items-left h-full overflow-y-auto">
        <h1>{doc.title}</h1>
        <h2 className="text-2xl font-bold mb-4">{doc.title ?? 'Task Queue'}</h2>
        <div className="mb-4 flex flex-col">
          <div className="flex-grow">
            <textarea
              className="font-mono p-2 border rounded w-full h-full"
              rows={5}
              value={doc.inputExpr || ''}
              onChange={(e) => {
                handle.change((doc) => {
                  updateText(doc, ['inputExpr'], e.target.value);
                });
              }}
            />
          </div>
          <div className="flex-grow">
            <textarea
              className="font-mono p-2 border rounded w-full h-full"
              rows={5}
              value={doc.code || ''}
              onChange={(e) => {
                handle.change((doc) => {
                  updateText(doc, ['code'], e.target.value);
                });
              }}
            />
          </div>
          <div className="mb-4">
            <button
              className="px-4 py-2 bg-gray-800 text-white rounded cursor-pointer"
              onClick={addTask}
            >
              add task
            </button>
          </div>
        </div>
        {doc.router ? (
          <div className="mb-4">
            <div className="text-2xl">Router:</div>
            <RouterComponent
              key={doc.router}
              docUrl={doc.router}
              isMine={doc.router === myRouterUrl}
            />
          </div>
        ) : null}
        <div className="mb-4">
          <div className="text-2xl">Workers:</div>
          {workers.map((url) => (
            <WorkerComponent key={url} docUrl={url} />
          ))}
        </div>
        <div className="mb-4">
          <div className="text-2xl">{doc.pending.length} pending:</div>
          {renderTasks(doc.pending.toReversed())}
        </div>
        <div className="mb-4">
          <div className="text-2xl">{doc.done.length} done:</div>
          {renderTasks(doc.done.toReversed())}
        </div>
      </div>
    </div>
  );

  function renderTasks(urls: AutomergeUrl[]) {
    return urls.length === 0 ? (
      <div className="text-gray-400">(none)</div>
    ) : (
      <ul>
        {urls.map((url) => (
          <li key={url}>
            <TaskBrowserTool docUrl={url} docPath={[]} />
          </li>
        ))}
      </ul>
    );
  }

  function addTask() {
    const input = eval(`(${doc.inputExpr || '[]'})`);
    const importUrl = `data:application/javascript;base64,${btoa(doc.code || '')}`;
    const taskDoc = repo.create<Task<any, any>>({ input, importUrl, runs: [] });
    changeDoc((doc) => doc.pending.push(taskDoc.url));
  }
};

export const TaskQueueBrowserTool: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <ITaskQueueBrowserTool {...props} />
  </Suspense>
);

function startWorkers(queueHandle: DocHandle<TaskQueue>, contactUrl: AutomergeUrl): Worker[] {
  // Check if SharedWorker is available (for tiny-patchwork)
  // @ts-ignore - window.__sharedworker may exist
  const existingSharedWorker = (window as any).__sharedworker as SharedWorker | undefined;

  if (!existingSharedWorker) {
    console.warn(
      'no shared worker available (window.__sharedworker not found), workers cannot be initialized'
    );
    return [];
  }

  // Extract import map from the main thread
  const importMapElement = document.querySelector('script[type="importmap"]');
  let importMap = null;
  if (importMapElement) {
    try {
      importMap = JSON.parse(importMapElement.textContent || '{}');
    } catch (e) {
      console.warn('Failed to parse import map:', e);
    }
  }

  const workers: Worker[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    // Create a new SharedWorker connection for this worker
    // Each new SharedWorker instance (even with the same name) triggers a 'connect' event
    // in the SharedWorker, which adds the port to the repo's network adapters
    // Hardcoded for testing - this is the actual built file path
    const sharedWorkerUrl = '/assets/automerge-worker-BYRQdlqy.js';
    console.log('sharedWorkerUrl', sharedWorkerUrl);
    const workerSharedWorker = new SharedWorker(sharedWorkerUrl, {
      type: 'module',
      name: 'automerge-repo-shared-worker',
    });
    // Don't start the port yet - wait until the worker is ready
    console.log('workerSharedWorker', workerSharedWorker);
    console.log('workerSharedWorker.port', workerSharedWorker.port);
    // Create and initialize autonomous worker
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });

    // Add diagnostic listeners to the SharedWorker port
    workerSharedWorker.port.addEventListener('message', (e) => {
      console.log('main: SharedWorker port received message', e.data);
    });
    workerSharedWorker.port.addEventListener('messageerror', (e) => {
      console.error('main: SharedWorker port message error', e);
    });

    // Send the SharedWorker port, queue URL, contact URL, and import map to the worker
    // The port from workerSharedWorker.port is already connected to the SharedWorker's repo
    console.log('main: Sending port to worker', {
      queueUrl: queueHandle.url,
      portType: workerSharedWorker.port.constructor.name,
    });
    worker.postMessage(
      {
        port: workerSharedWorker.port,
        queueUrl: queueHandle.url,
        contactUrl: contactUrl!,
        importMap,
        baseURI: document.baseURI,
      },
      [workerSharedWorker.port]
    );
    console.log('main: Port transferred to worker');
    workers.push(worker);
  }
  return workers;
}
