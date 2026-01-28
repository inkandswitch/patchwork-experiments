/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';
import type { Router } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel } from './protocol';

import { getRepo } from './webworker-lib';

interface WorkerState {
  workerUrl: AutomergeUrl | null;
  currentTask: { taskUrl: AutomergeUrl; taskQueueUrl: AutomergeUrl } | null;
}

interface TaskQueueState {
  myRouter: Worker;
  activeRouterHandle: DocHandle<Router> | null;
}

let repo: Repo;

const workers = new Map<number, WorkerState>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

console.log('worker pool: ready to roll!');

setInterval(() => {
  console.log('worker pool: alive!!');
}, 1000);

self.addEventListener('connect', (e: any) => {
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    console.log('worker pool: received message', e.data);
    const msg: MessageToWorkerPool = e.data;
    try {
      switch (msg.type) {
        case 'init':
          init(msg.repoPort);
          break;
        case 'worker update':
          processWorkerUpdate(msg.workerId, msg.workerUrl, msg.currentTask);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker pool', { msg, error });
    }
  };
});

async function init(port: MessagePort) {
  if (!repo) {
    console.log('worker pool: Ignoring init message -- already initialized');
    return;
  }

  console.log('worker pool: Initializing');
  repo = await getRepo(port, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);

  // "processes"
  pSendWorkerStatuses();
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
        if (workerUrl && currentTask?.taskQueueUrl === taskQueueUrl) {
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
