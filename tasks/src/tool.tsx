import React, { Suspense, useEffect, useState } from 'react';
import { useRepo, useDocument, useDocHandle, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { EditorProps, useCurrentAccount } from '@patchwork/sdk';
import { InlineContactAvatar } from '@patchwork/sdk/components';
import { RunInfo, Runner, Task, TaskQueue } from './datatype';
import { TaskRunner } from './task-runner';
import { AutomergeUrl, DocHandle, Repo, updateText } from '@automerge/automerge-repo';
import { createRoot } from 'react-dom/client';

let runner: TaskRunner;

async function startRunner(repo: Repo, queueId: AutomergeUrl, contactUrl: AutomergeUrl) {
  runner = await TaskRunner.factory(repo).withQueue(queueId);
  runner.setContactUrl(contactUrl);
  await runner.start();
  console.log('started runner!', runner);
}

function stopRunner() {
  runner?.stop();
}

const IRunner: React.FC<any> = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<Runner>(docUrl, { suspense: true });
  return (
    <div className="m-4">
      <div>
        {doc.contactUrl && <InlineContactAvatar url={doc.contactUrl} size={'default'} />} /{' '}
        {doc.name}
      </div>
      <div>
        {doc.currentTask ? (
          <TaskBrowserTool docUrl={doc.currentTask} />
        ) : (
          'idle'
        )}
      </div>
    </div>
  );
};

const RunnerComponent: React.FC<any> = ({ docUrl }: { docUrl: AutomergeUrl }) => (
  <Suspense fallback="...">
    <IRunner docUrl={docUrl} />
  </Suspense>
);


// TODO: element.repo is not ideal
export const Tool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <div className="flex flex-col items-center justify-center h-full">
        <Suspense fallback="..."><ITaskBrowserTool docUrl={handle.url} /></Suspense>
      </div>
    </RepoContext.Provider>
  );
  return () => root.unmount();
};

const ITaskBrowserTool: React.FC<EditorProps<Task<any, any>, string>> = ({ docUrl }) => {
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
  return (
    <span>
      → {status === 'succeeded' ? result : '✗'} ({timeAgo})
    </span>
  );
};

export const TaskBrowserTool: React.FC<EditorProps<Task<any, any>, string>> = (props) => (
  <Suspense fallback="...">
    <ITaskBrowserTool {...props} />
  </Suspense>
);

const ITaskQueueBrowserTool: React.FC<EditorProps<TaskQueue, string>> = ({ docUrl }) => {
  const repo = useRepo();
  const [doc, changeDoc] = useDocument<TaskQueue>(docUrl, { suspense: true });

  const handle = useDocHandle<TaskQueue>(docUrl, { suspense: true });

  const [runners, setRunners] = useState({});

  useEffect(() => {
    const messageHandler = (m: any) => {
      setRunners((r) => ({ ...r, [m.message.runnerUrl]: Date.now() }));
    };
    handle.on('ephemeral-message', messageHandler);
    const intervalId = setInterval(() => {
      if (!runner) {
        return;
      }
    }, 3000);
    return () => {
      clearInterval(intervalId);
      handle.off('ephemeral-message', messageHandler);
    };
  }, [handle]);

  const account = useCurrentAccount();
  const contactUrl = account?.contactHandle?.url;

  useEffect(() => {
    if (!contactUrl) return;
    startRunner(repo as unknown as Repo, docUrl, contactUrl);
    return stopRunner;
  }, [repo, docUrl, contactUrl]);

  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setTime(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

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
        {runner ? (
          <div className="mb-4">
            <div className="text-2xl">Task Runners:</div>
            {Object.entries(runners)
              .filter(([, lastHeartbeat]: any) => time < lastHeartbeat + 5_000)
              .map(([url]) => (
                <RunnerComponent key={url} docUrl={url} />
              ))}
          </div>
        ) : null}
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
    // </div>
  );

  function renderTasks(urls: AutomergeUrl[]) {
    return urls.length === 0 ? (
      <div className="text-gray-400">(none)</div>
    ) : (
      <ul>
        {urls.map((url) => (
          <li key={url}>
            <TaskBrowserTool docUrl={url}/>
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

export const TaskQueueBrowserTool: React.FC<EditorProps<TaskQueue, string>> = (props) => (
  <Suspense fallback="...">
    <ITaskQueueBrowserTool {...props} />
  </Suspense>
);
