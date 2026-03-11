/* eslint-env worker */

import type { Router, Worker as TaskWorker, TaskQueue } from './datatype';
import type {
  MessageToRouter,
  MessageToRouterChannel,
  MessageToTaskQueueChannel,
  MessageToWorkerChannel,
} from './protocol';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/vanillajs/slim';

import { getRepo } from './webworker-lib';
import generateName from 'boring-name-generator';

interface WorkerState {
  workerUrl: AutomergeUrl;
  currentTaskUrl: AutomergeUrl | null;
  lastTimestamp: number;
  handle: DocHandle<TaskWorker>;
}

let repo: Repo;
let contactUrl: AutomergeUrl;
let taskQueueHandle: DocHandle<TaskQueue>;
let thisRouterHandle: DocHandle<Router>;
let activeRouter: { url: AutomergeUrl; lastTimestamp: number } | null = null;
const workers = new Map<AutomergeUrl, WorkerState>();

self.addEventListener('connect', (e: any) => {
  console.log('got a connection!');
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToRouter = e.data;
    console.log('received message', e.data);
    try {
      switch (msg.type) {
        case 'init':
          init(msg.repoPort, msg.contactUrl, msg.taskQueueUrl);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message', { msg, error });
    }
  };
});

async function init(repoPort: MessagePort, _contactUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  if (repo) {
    console.log('already initialized');
    return;
  }

  console.log('initializing');

  repo = await getRepo(
    repoPort,
    `task-router-${taskQueueUrl}-${Math.round(Math.random() * 10_000)}`,
  );
  contactUrl = _contactUrl;

  taskQueueHandle = await repo.find<TaskQueue>(taskQueueUrl);
  taskQueueHandle.on('change', (payload) => updateActiveRouter(payload.doc));
  taskQueueHandle.on('ephemeral-message', (payload) => {
    const msg: MessageToTaskQueueChannel = payload.message as any;
    switch (msg.type) {
      case 'router heartbeat':
        processRouterHeartbeat(msg.routerUrl);
        break;
    }
  });
  updateActiveRouter(taskQueueHandle.doc());

  thisRouterHandle = repo.create<Router>({
    name: generateName().dashed,
    contactUrl: contactUrl ?? null,
  });
  thisRouterHandle.on('ephemeral-message', (payload) => {
    const msg: MessageToRouterChannel = payload.message as any;
    switch (msg.type) {
      case 'worker heartbeat':
        processWorkerHeartbeat(msg.workerUrl, msg.currentTask?.taskUrl ?? null);
        break;
    }
  });

  pHeartbeat();
  pTakeOverWhenActiveRouterDropsOut();
  pDropStaleWorkerInfos();

  console.log('ready!', thisRouterHandle.url);
  console.log('hola, me llamo', thisRouterHandle.doc().name);
}

async function pHeartbeat() {
  while (true) {
    if (thisIsTheActiveRouter()) {
      const heartbeat = {
        type: 'router heartbeat',
        routerUrl: thisRouterHandle.url,
        workerUrls: [...workers.keys()],
      } satisfies MessageToTaskQueueChannel;
      // console.log('Sending heartbeat to task queue', heartbeat);
      taskQueueHandle.broadcast(heartbeat);
    }
    await seconds(1);
  }
}

async function pTakeOverWhenActiveRouterDropsOut() {
  while (true) {
    if (
      !thisIsTheActiveRouter() &&
      (activeRouter == null || Date.now() - activeRouter.lastTimestamp > 3 * 1_000)
    ) {
      await pTakeOver();
    } else {
      await seconds(1);
    }
  }
}

async function pTakeOver() {
  workers.clear();

  console.log('attempting takeover!');
  taskQueueHandle.change((doc) => {
    doc.router = thisRouterHandle.url;
  });

  // this wait is important!
  // - it enables this router to gather info from workers (who's around, who's working on what)
  // - it also gives the change to the task queue doc (to set the active router) a chance to propagate
  await seconds(3);

  if (thisIsTheActiveRouter()) {
    console.log('I am now the router for this task queue!');
  }

  // note that we check that this router is active every time around the loop
  // this is to avoid a situation where we *thought* we successfully promoted ourselves
  // when another router got there later and updated the doc.
  while (thisIsTheActiveRouter()) {
    const pendingTasks = taskQueueHandle.doc().pending.filter(isReallyPending);
    const idleWorkers = [...workers.values()].filter((w) => w.currentTaskUrl == null);
    if (pendingTasks.length > 0 && idleWorkers.length === 0) {
      console.log(`${pendingTasks.length} pending tasks but no idle workers!`);
    }
    while (pendingTasks.length > 0 && idleWorkers.length > 0) {
      const taskUrl = pendingTasks.shift()!;
      const worker = idleWorkers.shift()!;
      const message: MessageToWorkerChannel = {
        type: 'work on',
        taskUrl,
        taskQueueUrl: taskQueueHandle.url,
      };
      console.log(
        'telling',
        worker.handle.url,
        'to work on',
        taskUrl,
        'from task queue',
        taskQueueHandle.url,
      );
      worker.handle.broadcast(message);
      worker.currentTaskUrl = taskUrl;
    }

    await seconds(1);
  }

  // helpers

  function isReallyPending(taskUrl: AutomergeUrl) {
    for (const { currentTaskUrl } of workers.values()) {
      if (taskUrl === currentTaskUrl) {
        return false;
      }
    }
    return true;
  }
}

async function pDropStaleWorkerInfos() {
  while (true) {
    for (const { workerUrl, lastTimestamp: timestamp } of workers.values()) {
      if (Date.now() - timestamp! > 10 * 1_000) {
        workers.delete(workerUrl);
      }
    }
    await seconds(0.5);
  }
}

function updateActiveRouter({ router }: TaskQueue) {
  if (router == null && activeRouter != null) {
    activeRouter = null;
  } else if (router != null && router !== activeRouter?.url) {
    activeRouter = { url: router, lastTimestamp: Date.now() };
  }
}

function processRouterHeartbeat(routerUrl: AutomergeUrl) {
  if (routerUrl === activeRouter?.url) {
    activeRouter.lastTimestamp = Date.now();
  }
}

async function processWorkerHeartbeat(
  workerUrl: AutomergeUrl,
  currentTaskUrl: AutomergeUrl | null,
) {
  const lastTimestamp = Date.now();
  const state = workers.get(workerUrl);
  if (state) {
    state.currentTaskUrl = currentTaskUrl;
    state.lastTimestamp = lastTimestamp;
  } else {
    workers.set(workerUrl, {
      workerUrl,
      currentTaskUrl,
      lastTimestamp,
      handle: await repo.find(workerUrl),
    });
  }
}

const thisIsTheActiveRouter = () => activeRouter?.url === thisRouterHandle.url;

const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });

export { }; // to ensure this is a module
