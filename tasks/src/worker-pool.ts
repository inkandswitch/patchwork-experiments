/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';
import type { Router, TaskQueue } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel } from './protocol';

import { getRepo } from './webworker-lib';

interface WorkerState {
  workerUrl: AutomergeUrl | null;
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
}

interface TaskQueueState {
  // myRouter: Worker;
  activeRouterHandle: DocHandle<Router> | null;
}

const taskQueuesToJoin: AutomergeUrl[] = [];
let repo: Repo;

const workers = new Map<number, WorkerState>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

console.log('worker pool: hi there!');

self.addEventListener('connect', (e: any) => {
  console.log('worker pool: connected to', e);
  const port = e.ports[0];
  receiveMessagesOn(port);
});

function listenToWorker(workerId: number, workerPort: MessagePort) {
  console.log('listening to worker', workerId);
  receiveMessagesOn(workerPort);
}

function receiveMessagesOn(port: MessagePort) {
  port.onmessage = (e: any) => {
    console.log('worker pool: received message', e.data);
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
          listenToWorker(msg.workerId, msg.workerPort);
          break;
        case 'worker update':
          processWorkerUpdate(msg.workerId, msg.workerUrl, msg.currentTask);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker pool', { msg, error });
    }
  };
}

async function init(port: MessagePort) {
  if (repo) {
    console.log('worker pool: Ignoring init message -- already initialized');
    return;
  }

  console.log('worker pool: Initializing');
  repo = await getRepo(port, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);
  console.log('worker pool: ready');
  while (taskQueuesToJoin.length > 0) {
    await join(taskQueuesToJoin.shift()!);
  }

  // "processes"
  pSendWorkerStatuses();
}

async function join(taskQueueUrl: AutomergeUrl) {
  if (!repo) {
    // haven't initialized yet, so save this for later
    taskQueuesToJoin.push(taskQueueUrl);
    return;
  }

  console.log('worker pool: joining task queue', taskQueueUrl);
  const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
  taskQueueHandle.on('change', async (payload) => {
    setTaskQueueState(payload.doc);
  });
  setTaskQueueState(taskQueueHandle.doc());

  async function setTaskQueueState(taskQueue: TaskQueue) {
    taskQueueState.set(taskQueueUrl, {
      activeRouterHandle: taskQueue.router ? await repo.find<Router>(taskQueue.router) : null,
    });
  }
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
        console.log('activeRouterHandle is null');
        continue;
      }

      console.log('sending worker statuses');
      for (const { workerUrl, currentTask } of workers.values()) {
        // don't bother sending the heartbeats of workers that are busy with tasks from other queues
        if (workerUrl && (!currentTask || currentTask?.taskQueueUrl === taskQueueUrl)) {
          console.log('sending heartbeat to task queue', taskQueueUrl, 'about worker', workerUrl);
          activeRouterHandle.broadcast({
            type: 'worker heartbeat',
            workerUrl,
            currentTask,
          } satisfies MessageToRouterChannel);
        } else {
          console.log(
            'not sending heartbeat',
            workerUrl,
            currentTask,
            currentTask?.taskQueueUrl,
            taskQueueUrl,
          );
        }
      }
      console.log('sending worker statuses (done)');
    }
  }
}

const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });

export {}; // to ensure this is a module
