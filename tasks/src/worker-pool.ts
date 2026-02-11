/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';
import type { Worker, Router, TaskQueue } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel } from './protocol';

import { getRepo } from './webworker-lib';

interface WorkerState {
  workerUrl: AutomergeUrl | null;
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
}

interface TaskQueueState {
  activeRouterHandle: DocHandle<Router> | null;
}

const toDoAfterInit: (() => Promise<void>)[] = [];
let repo: Repo;

const workers = new Map<number, WorkerState>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

console.log('hi there!');

self.addEventListener('connect', (e: any) => {
  console.log('connected to', e);
  const port = e.ports[0];
  receiveMessagesOn(port);
});

function receiveMessagesOn(port: MessagePort) {
  port.onmessage = (e: any) => {
    console.log('received message', e.data);
    const msg: MessageToWorkerPool = e.data;
    try {
      switch (msg.type) {
        case 'init':
          init(msg.repoPort);
          break;
        case 'join':
          join(msg.taskQueueUrl);
          break;
        case 'listen to worker':
          listenToWorker(msg.workerId, msg.workerUrl);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker pool', { msg, error });
    }
  };
}

async function init(port: MessagePort) {
  if (repo) {
    console.log('ignoring init message -- already initialized');
    return;
  }

  console.log('initializing');
  repo = await getRepo(port, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);
  while (toDoAfterInit.length > 0) {
    await toDoAfterInit.shift()!();
  }

  console.log('ready');

  // "processes"
  pSendWorkerStatuses();
}

async function join(taskQueueUrl: AutomergeUrl) {
  if (!repo) {
    // haven't initialized yet, so save this for later
    toDoAfterInit.push(() => join(taskQueueUrl));
    return;
  }

  console.log('joining task queue', taskQueueUrl);
  const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
  taskQueueHandle.on('change', (payload) => setTaskQueueState(payload.doc));
  await setTaskQueueState(taskQueueHandle.doc());

  async function setTaskQueueState(taskQueue: TaskQueue) {
    taskQueueState.set(taskQueueUrl, {
      activeRouterHandle: taskQueue.router ? await repo.find<Router>(taskQueue.router) : null,
    });
  }
}

async function listenToWorker(workerId: number, workerUrl: AutomergeUrl) {
  if (!repo) {
    // haven't initialized yet, so save this for later
    toDoAfterInit.push(() => listenToWorker(workerId, workerUrl));
    return;
  }

  console.log('listening to worker', workerId);
  const workerHandle = await repo.find<Worker>(workerUrl);
  workerHandle.addListener('change', (payload) => {
    processWorkerUpdate(workerId, workerUrl, payload.handle.doc().currentTask);
  });
  processWorkerUpdate(workerId, workerUrl, null);
}

function processWorkerUpdate(
  workerId: number,
  workerUrl: AutomergeUrl,
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null,
) {
  let state = workers.get(workerId);
  if (!state) {
    state = { workerUrl, currentTask };
    workers.set(workerId, state);
  } else {
    state.workerUrl = workerUrl;
    state.currentTask = currentTask;
  }
}

async function pSendWorkerStatuses() {
  while (true) {
    await seconds(1);

    for (const [taskQueueUrl, { activeRouterHandle }] of taskQueueState.entries()) {
      if (!activeRouterHandle) {
        continue;
      }

      for (const { workerUrl, currentTask } of workers.values()) {
        // don't bother sending the heartbeats of workers that are busy with tasks from other queues
        if (workerUrl && (!currentTask || currentTask?.taskQueueUrl === taskQueueUrl)) {
          activeRouterHandle.broadcast({
            type: 'worker heartbeat',
            workerUrl,
            currentTask,
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

export {}; // to ensure this is a module
