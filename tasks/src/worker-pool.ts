/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';
import type { Worker, Router, TaskQueue } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel } from './protocol';

import { getRepo } from './webworker-lib';

interface TaskQueueState {
  activeRouterHandle: DocHandle<Router> | null;
}

let repo: Repo;

const toDoAfterInit: (() => Promise<void>)[] = [];
const workers = new Map<AutomergeUrl, Worker>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

console.log('hi there, I am the worker pool!');

self.addEventListener('connect', (e: any) => {
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
        case 'add worker':
          addWorker(msg.workerId, msg.workerUrl);
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

  pSendWorkerStatuses(); // this is a "process", meant to be running in the background (hence no `await`)

  console.log('ready');
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

async function addWorker(workerId: number, workerUrl: AutomergeUrl) {
  if (!repo) {
    // haven't initialized yet, so save this for later
    toDoAfterInit.push(() => addWorker(workerId, workerUrl));
    return;
  }

  console.log('adding worker', workerId);
  const workerHandle = await repo.find<Worker>(workerUrl);
  workerHandle.on('change', (payload) => {
    workers.set(workerUrl, payload.doc);
  });
  workers.set(workerUrl, workerHandle.doc());
}

async function pSendWorkerStatuses() {
  while (true) {
    await seconds(1);

    for (const [taskQueueUrl, { activeRouterHandle }] of taskQueueState.entries()) {
      if (!activeRouterHandle) {
        continue;
      }

      for (const [workerUrl, { currentTask }] of workers.entries()) {
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
