import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRepo, useDocument, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { RouterDoc, RunInfo, WorkerDoc, TaskDoc, TaskQueueDoc } from './datatype';
import type { MessageToTaskQueueChannel } from './protocol';

const DEFAULT_INPUT_EXPR = `[
  (Math.floor(Math.random() * 10) + 1,
  Math.floor(Math.random() * 10) + 1)
]`;

const DEFAULT_CODE = `export default async function ([x, y]) {
  await seconds(Math.random() * 3);
  if (Math.random() < 0.1) { throw new Error("Oh no!") }
  return x + y;
}
  
async function seconds(s) {
  return new Promise((resolve) => {
    setTimeout(resolve, s * 1000);
  });
}`;

export const TaskQueueTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo; // TODO: better way to get the repo
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <div className="flex flex-col items-center justify-center h-full">
        <Suspense fallback="...">
          <ITaskQueueBrowserTool docUrl={handle.url} />
        </Suspense>
      </div>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

const ITaskQueueBrowserTool: React.FC<any> = ({ docUrl }) => {
  const repo = useRepo();
  const [{ title, activeRouter, pending, done }, changeDoc] = useDocument<TaskQueueDoc>(docUrl, {
    suspense: true,
  });

  const handle = useDocHandle<TaskQueueDoc>(docUrl, { suspense: true });

  const [workers, setWorkers] = useState<AutomergeUrl[]>([]);
  const [inputExpr, setInputExpr] = useState(DEFAULT_INPUT_EXPR);
  const [code, setCode] = useState(DEFAULT_CODE);

  useEffect(() => {
    const messageHandler = (m: any) => {
      const msg = m.message as MessageToTaskQueueChannel;
      if (msg) {
        console.log('received router heartbeat', msg);
        setWorkers(msg.workerUrls);
      }
    };
    handle.on('ephemeral-message', messageHandler);
    return () => {
      handle.off('ephemeral-message', messageHandler);
    };
  }, [handle]);

  return (
    <div className="task-browser h-full overflow-y-auto">
      <div className="flex flex-col items-left h-full overflow-y-auto">
        <h1>title: {title}</h1>
        <h2 className="text-2xl font-bold mb-4">{title ?? 'Task Queue'}</h2>
        <div className="mb-4 flex flex-col">
          <div className="grow">
            <textarea
              className="font-mono p-2 border rounded w-full h-full"
              rows={5}
              value={inputExpr}
              onChange={(e) => setInputExpr(e.target.value)}
            />
          </div>
          <div className="grow">
            <textarea
              className="font-mono p-2 border rounded w-full h-full"
              rows={5}
              value={code}
              onChange={(e) => setCode(e.target.value)}
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
        {activeRouter ? (
          <div className="mb-4">
            <div className="text-2xl">Router:</div>
            <Router key={activeRouter} docUrl={activeRouter} />
          </div>
        ) : null}
        <div className="mb-4">
          <div className="text-2xl">Workers:</div>
          {workers.map((url) => (
            <Worker key={url} docUrl={url} />
          ))}
        </div>
        <div className="mb-4">
          <div className="text-2xl">{pending.length} pending:</div>
          {renderTasks(pending.toReversed().slice(0, 20))}
        </div>
        <div className="mb-4">
          <div className="text-2xl">{done.length} done:</div>
          {renderTasks(done.toReversed().slice(0, 20))}
        </div>
      </div>
    </div>
  );

  function renderTasks(urls: AutomergeUrl[]) {
    return urls.length === 0 ? (
      <div className="text-gray-400">(none)</div>
    ) : (
      <ul>
        {[...new Set(urls)].map((url) => (
          <li key={url}>
            <Task docUrl={url} docPath={[]} />
          </li>
        ))}
      </ul>
    );
  }

  function addTask() {
    const input = eval(inputExpr);
    const importUrl = `data:application/javascript;base64,${btoa(code)}`;
    const taskDoc = repo.create<TaskDoc<any, any>>({ input, importUrl, runs: [] });
    changeDoc((doc) => doc.pending.push(taskDoc.url));
  }
};

export const Router: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <IRouter {...props} />
  </Suspense>
);

const IRouter: React.FC<any> = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [{ name, contactUrl }] = useDocument<RouterDoc>(docUrl, { suspense: true });
  return (
    <div className="m-4">
      <patchwork-view doc-url={contactUrl} tool-id="contact-inline" /> / {name}
    </div>
  );
};

export const Worker: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <IWorker {...props} />
  </Suspense>
);

const IWorker: React.FC<any> = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [{ name, contactUrl, currentTask }] = useDocument<WorkerDoc>(docUrl, { suspense: true });
  return (
    <div className="m-4 p-2">
      <div>
        <patchwork-view doc-url={contactUrl} tool-id="contact-inline" /> / {name}{' '}
        {currentTask ? <Task docUrl={currentTask.taskUrl} docPath={[]} /> : '(idle)'}
      </div>
    </div>
  );
};

const Task: React.FC<any> = (props) => (
  <Suspense fallback="...">
    <ITask {...props} />
  </Suspense>
);

const ITask: React.FC<any> = ({ docUrl }) => {
  const [{ importUrl, runs, input }] = useDocument<TaskDoc<any, any>>(docUrl, { suspense: true });
  const hasntRun = runs.length === 0;
  const failed = runs.every((run) => run.status === 'failed');
  const [code, setCode] = useState('');

  useEffect(() => {
    fetch(importUrl)
      .then((res) => res.text())
      .then((text) => setCode(text));
  }, [importUrl]);

  return (
    <div
      className={`m-4 p-4 border ${
        hasntRun ? 'border-l-gray-500' : failed ? 'border-l-red-500' : 'border-l-lime-500'
      } border-l-8 m`}
    >
      {runs.map((run: RunInfo<any>, idx) => (
        <div key={idx} className="bg-black text-white pl-2 mb-2">
          <Run input={input} run={run} />
        </div>
      ))}
      <div>{code ? <pre>{code}</pre> : <div>Loading code...</div>}</div>
    </div>
  );
};

const Run: React.FC<any> = ({ input, run }: { input: any; run: RunInfo<any> }) => {
  const { startTimeMillis, endTimeMillis, result, status } = run;
  const timeAgo = `${endTimeMillis - startTimeMillis}ms`;
  const [{ contactUrl, name }] = useDocument<WorkerDoc>(run.workerUrl as AutomergeUrl, {
    suspense: true,
  });
  return (
    <div className="align-text-top">
      {JSON.stringify(input)}
      <div>
        <div>
          <patchwork-view doc-url={contactUrl} tool-id="contact-inline" /> / {name}{' '}
          {status === 'succeeded' ? (result === undefined ? '' : '→ ' + result) : '✗'} ({timeAgo})
        </div>
      </div>
      {run.logs && run.logs.length > 0 && (
        <details>
          <summary>logs</summary>
          {run.logs.map(({ timestampMillis, message }, idx) => (
            <div key={idx}>
              {new Date(timestampMillis).toLocaleString()}: {message}
            </div>
          ))}
        </details>
      )}
    </div>
  );
};
