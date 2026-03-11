/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';
import type { Worker, Router, TaskQueue } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel } from './protocol';

import { getRepo } from './webworker-lib';

interface TaskQueueState {
  activeRouterHandle: DocHandle<Router> | null;
}

let repo: Repo;

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';
const toDoAfterInit: (() => Promise<void>)[] = [];

const sharedWorkerNames = new Set<string>();
const workerByUrl = new Map<AutomergeUrl, Worker>();

const taskQueueUrls = new Set<AutomergeUrl>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

console.log('hi there, I am the worker pool!');

self.addEventListener('connect', (e: any) => {
  console.log('got a connection!');
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorkerPool = e.data;
    console.log('received message', msg);
    try {
      switch (msg.type) {
        case 'init':
          init(msg.repoPort);
          break;
        case 'join':
          join(msg.taskQueueUrl);
          break;
        case 'add worker':
          addWorker(msg.sharedWorkerName, msg.workerUrl);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker pool', { msg, error });
    }
  };
});

async function init(port: MessagePort) {
  if (status !== 'not initialized') {
    return;
  }

  console.log('initializing...');
  status = 'initializing';

  repo = await getRepo(port, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);
  pSendWorkerStatuses(); // this is a "process", meant to be running in the background (hence no `await`)

  console.log('ready');
  status = 'ready';

  while (toDoAfterInit.length > 0) {
    await toDoAfterInit.shift()!();
  }
}

async function join(taskQueueUrl: AutomergeUrl) {
  if (taskQueueUrls.has(taskQueueUrl)) {
    // already joined or joining!
    return;
  } else if (status !== 'ready') {
    // haven't initialized yet, so save this for later
    toDoAfterInit.push(() => join(taskQueueUrl));
    return;
  }

  console.log('joining task queue', taskQueueUrl);

  taskQueueUrls.add(taskQueueUrl);

  const taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
  taskQueueHandle.on('change', (payload) => setTaskQueueState(payload.doc));
  await setTaskQueueState(taskQueueHandle.doc());

  async function setTaskQueueState(taskQueue: TaskQueue) {
    try {
      const activeRouterHandle = taskQueue.router
        ? await repo.find<Router>(taskQueue.router)
        : null;
      taskQueueState.set(taskQueueUrl, { activeRouterHandle });
    } catch (error) {
      console.error('error finding doc for active router', { taskQueueUrl, error });
    }
  }

  console.log('done joining task queue', taskQueueUrl);
}

async function addWorker(sharedWorkerName: string, workerUrl: AutomergeUrl) {
  if (sharedWorkerNames.has(sharedWorkerName)) {
    // already added!
    console.log('addWorker: already know about', sharedWorkerName);
    return;
  } else if (status !== 'ready') {
    // haven't initialized yet, so save this for later
    console.log('addWorker: will add', sharedWorkerName, 'after init');
    toDoAfterInit.push(() => addWorker(sharedWorkerName, workerUrl));
    return;
  }

  console.log('adding worker', { sharedWorkerName, workerUrl });

  sharedWorkerNames.add(sharedWorkerName);

  const workerHandle = await repo.find<Worker>(workerUrl);
  workerHandle.on('change', (payload) => workerByUrl.set(workerUrl, payload.doc));
  workerByUrl.set(workerUrl, workerHandle.doc());
}

async function pSendWorkerStatuses() {
  while (true) {
    await seconds(1);

    for (const [taskQueueUrl, { activeRouterHandle }] of taskQueueState.entries()) {
      if (!activeRouterHandle) {
        continue;
      }

      for (const [workerUrl, { currentTask }] of workerByUrl.entries()) {
        if (currentTask && currentTask.taskQueueUrl !== taskQueueUrl) {
          // don't bother sending the heartbeats of workers that are busy with tasks from other queues
        } else {
          // console.log('sending worker heartbeat to', activeRouterHandle.url, { workerUrl, currentTask });
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
