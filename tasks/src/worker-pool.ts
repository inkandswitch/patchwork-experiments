/* eslint-env worker */

import { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import {
  MessageToWorker,
  MessageToRouter,
  MessageToWorkerPool,
  MessageToRouterChannel,
} from './protocol';
import { Router, TaskQueue } from './datatype';
import { getRepo } from './webworker-lib';

interface WorkerState {
  webWorker: Worker;
  workerUrl: AutomergeUrl | null;
  currentTask: { url: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
}

interface TaskQueueState {
  myRouter: Worker;
  activeRouterHandle: DocHandle<Router> | null;
}

let repo: Repo;
let contactUrl: AutomergeUrl;

let nextWorkerId = 1;
const workers: WorkerState[] = [];
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

self.onmessage = (e) => {
  const msg: MessageToWorkerPool = e.data;
  switch (msg.type) {
    case 'init':
      init(msg.port, msg.contactUrl, msg.workerPorts, msg.importMap, msg.baseURI);
      break;
    case 'join task queue':
      joinTaskQueue(msg.port, msg.url);
      break;
    case 'leave task queue':
      leaveTaskQueue(msg.url);
      break;
  }
};

async function init(
  port: MessagePort,
  _contactUrl: AutomergeUrl,
  workerPorts: MessagePort[],
  importMap: ImportMap,
  baseURI: string,
) {
  if (repo) {
    console.log('worker pool: Ignoring init message -- already initialized');
  } else {
    console.log('worker pool: initializing');
    repo = await getRepo(port, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);
    contactUrl = _contactUrl;
    for (const workerPort of workerPorts) {
      addWorker(workerPort, importMap, baseURI);
    }

    pSendWorkerStatuses();
  }
}

function addWorker(port: MessagePort, importMap: any, baseURI: string) {
  const webWorker = new Worker(new URL('./worker.ts', import.meta.url), {
    name: `task-worker-${nextWorkerId++}`,
    type: 'module',
  });
  webWorker.postMessage(
    { type: 'init', port, contactUrl: contactUrl, importMap, baseURI } satisfies MessageToWorker,
    [port],
  );

  const state: WorkerState = { webWorker, workerUrl: null, currentTask: null };
  webWorker.onmessage = (e) => {
    const msg = e.data as MessageToWorkerPool;
    if (msg.type === 'update worker state') {
      state.workerUrl = msg.workerUrl;
      state.currentTask = msg.currentTask;
    }
  };

  workers.push(state);
}

// TODO: setNumWorkers(n)

async function joinTaskQueue(port: MessagePort, taskQueueUrl: AutomergeUrl) {
  if (taskQueueState.has(taskQueueUrl)) {
    return;
  }

  const myRouter = new Worker(new URL('./router.ts', import.meta.url), {
    name: `task-router-${taskQueueUrl}`,
    type: 'module',
  });
  myRouter.postMessage(
    { type: 'init', port, contactUrl: contactUrl, taskQueueUrl } satisfies MessageToRouter,
    [port],
  );
  taskQueueState.set(taskQueueUrl, { myRouter, activeRouterHandle: null });

  try {
    const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
    console.log('worker pool: Found task queue document', {
      queueUrl: taskQueueHandle.url,
      hasDoc: !!taskQueueHandle.doc(),
      docKeys: taskQueueHandle.doc() ? Object.keys(taskQueueHandle.doc()) : [],
    });
    taskQueueHandle.on('change', (payload) => updateActiveRouter(taskQueueUrl, payload.doc));
    updateActiveRouter(taskQueueUrl, taskQueueHandle.doc());
  } catch (findError) {
    console.error('worker pool: Failed to find queue document', { taskQueueUrl, error: findError });
    throw findError;
  }
}

function leaveTaskQueue(taskQueueUrl: AutomergeUrl) {
  const state = taskQueueState.get(taskQueueUrl);
  if (!state) {
    return;
  }

  const { myRouter } = state;
  myRouter.terminate();
  taskQueueState.delete(taskQueueUrl);
}

async function updateActiveRouter(taskQueueUrl: AutomergeUrl, taskQueue: TaskQueue) {
  const state = taskQueueState.get(taskQueueUrl);
  if (!state) {
    return;
  }

  if (
    (taskQueue.router == null && state.activeRouterHandle == null) ||
    taskQueue.router === state.activeRouterHandle?.url
  ) {
    return;
  }

  state.activeRouterHandle = taskQueue.router ? await repo.find(taskQueue.router) : null;
}

async function pSendWorkerStatuses() {
  while (true) {
    await seconds(1);

    for (const [taskQueueUrl, { activeRouterHandle }] of taskQueueState.entries()) {
      if (!activeRouterHandle) {
        continue;
      }

      for (const { workerUrl, currentTask } of workers) {
        // don't bother sending the heartbeats of workers that are busy with tasks from other queues
        if (workerUrl && currentTask?.taskQueueUrl === taskQueueUrl) {
          activeRouterHandle.broadcast({
            type: 'worker heartbeat',
            workerUrl,
            currentTaskUrl: currentTask.url,
          } satisfies MessageToRouterChannel);
        }
      }
    }
  }
}

const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });
