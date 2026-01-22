/* eslint-env worker */

import generateName from 'boring-name-generator';
import { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import { Router, Worker as TaskWorker, TaskQueue } from './datatype';
import { MessageToRouter, MessageToRouterChannel, MessageToTaskQueueChannel, MessageToWorkerChannel } from './protocol';
import { getRepo } from './webworker-lib';

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

self.onmessage = (e) => {
  const msg: MessageToRouter = e.data;
  switch (msg.type) {
    case 'init':
      init(msg.port, msg.contactUrl, msg.taskQueueUrl);
      break;
  }
};

async function init(port: MessagePort, _contactUrl: AutomergeUrl, taskQueueUrl: AutomergeUrl) {
  if (repo) {
    const msg = 'router: Received two init messages!';
    console.error(msg);
    throw new Error(msg);
  }

  console.log('router: Initializing');

  repo = await getRepo(port, `task-router-${taskQueueUrl}-${Math.round(Math.random() * 10_000)}`);
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
        processWorkerHeartbeat(msg.workerUrl, msg.currentTaskUrl);
        break;
    }
  });

  pHeartbeat();
  pTakeOverWhenActiveRouterDropsOut();
  pDropStaleWorkerInfos();

  console.log('router: started!', thisRouterHandle.url);
}

async function pHeartbeat() {
  while (true) {
    if (thisIsTheActiveRouter()) {
      console.log('router: Sending heartbeat');
      taskQueueHandle.broadcast({ type: 'router heartbeat', routerUrl: thisRouterHandle.url, workerUrls: [...workers.keys()] } satisfies MessageToTaskQueueChannel);
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

  console.log('router: Attempting takeover!');
  taskQueueHandle.change((doc) => {
    doc.router = thisRouterHandle.url;
  });

  // this wait is important!
  // - it enables this router to gather info from workers (who's around, who's working on what)
  // - it also gives the change to the task queue doc (to set the active router) a chance to propagate
  await seconds(3);

  // note that we check that this router is active every time around the loop
  // this is to avoid a situation where we *thought* we successfully promoted ourselves
  // when another router got there later and updated the doc.
  while (thisIsTheActiveRouter()) {
    const pendingTasks = taskQueueHandle.doc().pending.filter(isReallyPending);
    const idleWorkers = [...workers.values()].filter((w) => w.currentTaskUrl == null);
    if (pendingTasks.length > 0 && idleWorkers.length === 0) {
      console.log(`router: ${pendingTasks.length} pending tasks but no idle workers!`);
    }
    while (pendingTasks.length > 0 && idleWorkers.length > 0) {
      const taskUrl = pendingTasks.shift()!;
      const worker = idleWorkers.shift()!;
      const message: MessageToWorkerChannel = { type: 'work on', taskUrl, taskQueueUrl: taskQueueHandle.url };
      console.log('router: Telling', worker.handle.url, 'to work on', taskUrl, 'from task queue', taskQueueHandle.url);
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

async function processWorkerHeartbeat(workerUrl: AutomergeUrl, currentTaskUrl: AutomergeUrl | null) {
  const lastTimestamp = Date.now();
  const state = workers.get(workerUrl);
  if (state) {
    state.currentTaskUrl = currentTaskUrl;
    state.lastTimestamp = lastTimestamp;
  } else {
    workers.set(workerUrl, { workerUrl, currentTaskUrl, lastTimestamp, handle: await repo.find(workerUrl) });
  }
}

const thisIsTheActiveRouter = () => activeRouter?.url === thisRouterHandle.url;

const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });
