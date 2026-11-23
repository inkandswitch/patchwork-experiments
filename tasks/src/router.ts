/* eslint-env worker */

import type { TaskQueueDoc, RouterDoc, WorkerDoc, TaskQueueSet } from './datatype';
import type {
  MessageToRouter,
  MessageToRouterChannel,
  MessageToTaskQueueChannel,
  MessageToWorkerChannel,
  RepoConfig,
} from './protocol';
import type {
  AutomergeUrl,
  DocHandle,
  DocHandleEphemeralMessagePayload,
  Repo,
} from '@automerge/automerge-repo/slim';

import { getRepo, setUpImportMap } from './webworker-lib';
import generateName from 'boring-name-generator';
import { seconds, shuffle } from './helpers';
import { DeliveryStats, reportDeliveryStats, Sequencer } from './delivery-stats';
import { RouterWatch } from './takeover';

let repo: Repo;
let contactUrl: AutomergeUrl;
let thisRouterHandle: DocHandle<RouterDoc>;

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';
let sequencer: Sequencer;
const deliveryStats = new DeliveryStats();

const taskQueueHandles = new Map<AutomergeUrl, DocHandle<TaskQueueDoc>>();
const routerWatch = new RouterWatch();
const attemptingToTakeOverTaskQueueUrls = new Set<AutomergeUrl>();

interface WorkerState {
  handle: DocHandle<WorkerDoc>;
  /** Last task URL reported by the worker pool heartbeat (replica of WorkerDoc). */
  currentTaskUrl: AutomergeUrl | null;
  /** Task URL this router assigned via broadcast but the worker doc may not reflect yet. */
  claimedTaskUrl: AutomergeUrl | null;
  /** When {@link claimedTaskUrl} was set; used to drop stuck claims if replicas miss the busy state. */
  claimIssuedAt: number;
  taskQueues: TaskQueueSet;
  lastTimestamp: number;
  /** Whether the worker's host wants it given work just now (see availability.ts). */
  available: boolean;
}

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
          init(msg.repoConfig, msg.contactUrl, msg.importMap, msg.baseURI);
          break;
        case 'update task queue set':
          updateTaskQueueSet(msg.taskQueues);
          break;
        case 'terminate':
          self.close();
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message', { msg, error });
    }
  };
});

const { promise: repoPromise, resolve: repoResolve } = Promise.withResolvers();

async function init(
  repoConfig: RepoConfig,
  _contactUrl: AutomergeUrl,
  importMap: any,
  baseURI: string,
) {
  // Every tab sends `init`, and a second one can arrive while the first is
  // still waiting on the Repo. Without this it would start a second Repo, a
  // second router doc and a second copy of each loop below.
  if (status !== 'not initialized') {
    console.log('already', status === 'ready' ? 'initialized' : 'initializing');
    return;
  }

  console.log('initializing');
  status = 'initializing';

  contactUrl = _contactUrl;

  await setUpImportMap(importMap, baseURI);
  repo = await getRepo(repoConfig, `task-router-${Math.round(Math.random() * 1_000_000)}`);
  repoResolve(repo);

  thisRouterHandle = repo.create<RouterDoc>({ name: generateName().dashed, contactUrl });
  sequencer = new Sequencer(thisRouterHandle.url);
  thisRouterHandle.on('ephemeral-message', (payload) => {
    console.log('received ephemeral message directed at me (as the active router)');
    const msg: MessageToRouterChannel = payload.message as any;
    switch (msg.type) {
      case 'worker heartbeat':
        deliveryStats.record(thisRouterHandle.url, msg);
        processWorkerHeartbeat(
          msg.workerUrl,
          msg.currentTask?.taskUrl ?? null,
          msg.taskQueues,
          // a pool from before there was a choice is always available
          msg.available ?? true,
        );
        break;
    }
  });
  reportDeliveryStats('router', deliveryStats);

  pRouteTasks();
  pSendHeartbeats();
  pDropStaleWorkerInfos();
  pTakeOverFromInactiveRouters();

  status = 'ready';
  console.log('ready!', thisRouterHandle.url);
  console.log('hola, me llamo', thisRouterHandle.doc().name);
}

async function pRouteTasks() {
  while (true) {
    releaseRouterClaimsAckedByWorkerDoc();
    const idleWorkersByTaskQueueUrl = getIdleWorkersByTaskQueueUrl();
    const taskQueuesWithPendingTasks = shuffle(
      [...taskQueueHandles.values()]
        .filter(thisIsTheActiveRouterFor)
        .filter((taskQueue) => taskQueue.doc().pending.length > 0),
    );
    while (taskQueuesWithPendingTasks.length > 0) {
      const taskQueue = taskQueuesWithPendingTasks.shift()!;
      const nextPendingTaskUrl = nextPendingTask(taskQueue);
      if (!nextPendingTaskUrl) {
        continue;
      }

      const idleWorkers = idleWorkersByTaskQueueUrl.get(taskQueue.url);
      if (!idleWorkers || idleWorkers.size === 0) {
        continue;
      }

      const worker = shuffle([...idleWorkers])[0];
      worker.claimedTaskUrl = nextPendingTaskUrl;
      worker.claimIssuedAt = Date.now();
      console.log('routing task', nextPendingTaskUrl, 'to worker', worker.handle.url);
      worker.handle.broadcast({
        type: 'work on',
        ...sequencer.stamp(worker.handle.url),
        taskUrl: nextPendingTaskUrl,
        taskQueueUrl: taskQueue.url,
      } satisfies MessageToWorkerChannel);

      // remove this worker from all idle workers sets
      for (const idleWorkers of idleWorkersByTaskQueueUrl.values()) {
        idleWorkers.delete(worker);
      }

      // this task queue may have more pending tasks, so we add it back to the list
      taskQueuesWithPendingTasks.push(taskQueue);
    }

    await seconds(1);
  }
}

async function pSendHeartbeats() {
  while (true) {
    for (const taskQueueHandle of taskQueueHandles.values()) {
      if (thisIsTheActiveRouterFor(taskQueueHandle)) {
        console.log('sending router heartbeat');
        const included = [...workers.values()].filter((worker) =>
          shouldIncludeInHeartbeat(worker, taskQueueHandle.url),
        );
        taskQueueHandle.broadcast({
          type: 'router heartbeat',
          ...sequencer.stamp(taskQueueHandle.url),
          routerUrl: thisRouterHandle.url,
          workerUrls: included.map((worker) => worker.handle.url),
          pausedWorkerUrls: included
            .filter((worker) => !worker.available)
            .map((worker) => worker.handle.url),
        } satisfies MessageToTaskQueueChannel);
      }
    }
    await seconds(1);
  }

  // helpers

  function shouldIncludeInHeartbeat(worker: WorkerState, taskQueueUrl: AutomergeUrl) {
    if (!worker.taskQueues[taskQueueUrl]) {
      return false;
    }

    const { currentTask } = worker.handle.doc();
    return !currentTask || currentTask.taskQueueUrl === taskQueueUrl;
  }
}

async function pDropStaleWorkerInfos() {
  while (true) {
    for (const { handle, lastTimestamp: timestamp } of workers.values()) {
      if (Date.now() - timestamp! > 10 * 1_000) {
        workers.delete(handle.url);
      }
    }
    await seconds(0.5);
  }
}

async function pTakeOverFromInactiveRouters() {
  while (true) {
    for (const taskQueueHandle of taskQueueHandles.values()) {
      const activeRouterUrl = taskQueueHandle.doc().activeRouter;
      if (activeRouterUrl === thisRouterHandle.url) {
        routerWatch.stopWatching(taskQueueHandle.url);
        continue;
      }
      if (attemptingToTakeOverTaskQueueUrls.has(taskQueueHandle.url)) {
        continue;
      }

      if (routerWatch.shouldTakeOver(taskQueueHandle.url, activeRouterUrl)) {
        attemptToTakeOver(taskQueueHandle);
      }
    }
    await seconds(1);
  }
}

function attemptToTakeOver(taskQueueHandle: DocHandle<TaskQueueDoc>) {
  console.log('attempting takeover of', taskQueueHandle.url);
  attemptingToTakeOverTaskQueueUrls.add(taskQueueHandle.url);
  taskQueueHandle.change((doc) => {
    doc.activeRouter = thisRouterHandle.url;
  });

  (async () => {
    // this wait is important!
    // - it enables this router to gather info from workers (who's around, who's working on what)
    // - it also gives the change to the task queue doc (to set the active router) a chance to propagate
    await seconds(3);

    if (thisIsTheActiveRouterFor(taskQueueHandle)) {
      console.log('I am now the router for this task queue!');
    }

    attemptingToTakeOverTaskQueueUrls.delete(taskQueueHandle.url);
  })();
}

// helpers

/** Drop router-side claims once we know the worker took the task, or recover from missed replicas. */
function releaseRouterClaimsAckedByWorkerDoc() {
  const now = Date.now();
  for (const worker of workers.values()) {
    const claimed = worker.claimedTaskUrl;
    if (!claimed) {
      continue;
    }

    const docTask = worker.handle.doc().currentTask?.taskUrl;
    if (docTask === claimed) {
      worker.claimedTaskUrl = null;
      continue;
    }

    // Pool heartbeat saw this worker busy with our claim — safe to drop claim; busy is tracked via currentTaskUrl.
    if (worker.currentTaskUrl === claimed) {
      worker.claimedTaskUrl = null;
      continue;
    }

    // Fast tasks can finish between heartbeats so we never observe currentTask === claimed on this replica.
    const idleOnRouter = !docTask && !worker.currentTaskUrl;
    if (idleOnRouter && now - worker.claimIssuedAt > 4_000) {
      worker.claimedTaskUrl = null;
    }
  }
}

function getIdleWorkersByTaskQueueUrl() {
  const idleWorkers = [...workers.values()].filter((worker) => {
    const docBusy = !!worker.handle.doc().currentTask;
    const heartbeatBusy = !!worker.currentTaskUrl;
    return worker.available && !docBusy && !heartbeatBusy && !worker.claimedTaskUrl;
  });
  const idleWorkersByTaskQueueUrl = new Map<AutomergeUrl, Set<WorkerState>>();
  for (const worker of idleWorkers) {
    for (const taskQueueUrl of Object.keys(worker.taskQueues) as AutomergeUrl[]) {
      if (!idleWorkersByTaskQueueUrl.has(taskQueueUrl)) {
        idleWorkersByTaskQueueUrl.set(taskQueueUrl, new Set<WorkerState>());
      }
      idleWorkersByTaskQueueUrl.get(taskQueueUrl)!.add(worker);
    }
  }
  return idleWorkersByTaskQueueUrl;
}

function nextPendingTask(taskQueueHandle: DocHandle<TaskQueueDoc>) {
  for (const taskUrl of taskQueueHandle.doc().pending) {
    if (isReallyPending(taskUrl)) {
      return taskUrl;
    }
  }
  return null;
}

function isReallyPending(taskUrl: AutomergeUrl) {
  for (const worker of workers.values()) {
    const docTask = worker.handle.doc().currentTask?.taskUrl;
    if (
      taskUrl === docTask ||
      taskUrl === worker.claimedTaskUrl ||
      taskUrl === worker.currentTaskUrl
    ) {
      return false;
    }
  }
  return true;
}

async function updateTaskQueueSet(taskQueues: TaskQueueSet) {
  // remove task queues that are no longer in the set
  for (const taskQueueUrl of taskQueueHandles.keys()) {
    if (!Object.keys(taskQueues).includes(taskQueueUrl)) {
      leaveTaskQueue(taskQueueUrl);
    }
  }

  // add task queues that are new
  for (const taskQueueUrl of Object.keys(taskQueues)) {
    if (!taskQueueHandles.has(taskQueueUrl as AutomergeUrl)) {
      joinTaskQueue(taskQueueUrl as AutomergeUrl);
    }
  }
}

async function joinTaskQueue(taskQueueUrl: AutomergeUrl) {
  let handle: DocHandle<TaskQueueDoc>;
  try {
    await repoPromise;
    handle = await repo.find<TaskQueueDoc>(taskQueueUrl);
  } catch (error) {
    console.error('unable to get doc handle for task queue', { taskQueueUrl, error });
    return;
  }

  taskQueueHandles.set(taskQueueUrl, handle);
  handle.on('ephemeral-message', handleEphemeralMessages);
}

async function leaveTaskQueue(taskQueueUrl: AutomergeUrl) {
  const handle = taskQueueHandles.get(taskQueueUrl);
  handle?.off('ephemeral-message', handleEphemeralMessages);
  taskQueueHandles.delete(taskQueueUrl);
  routerWatch.stopWatching(taskQueueUrl);
}

function handleEphemeralMessages(payload: DocHandleEphemeralMessagePayload<TaskQueueDoc>) {
  const msg: MessageToTaskQueueChannel = payload.message as any;
  console.log('received ephemeral message (directed at task queue)', msg);
  switch (msg.type) {
    case 'router heartbeat':
      deliveryStats.record(payload.handle.url, msg);
      processRouterHeartbeat(msg.routerUrl);
      break;
  }
}

function processRouterHeartbeat(routerUrl: AutomergeUrl) {
  routerWatch.heardFrom(routerUrl);
}

async function processWorkerHeartbeat(
  workerUrl: AutomergeUrl,
  currentTaskUrl: AutomergeUrl | null,
  taskQueues: TaskQueueSet,
  available: boolean,
) {
  const lastTimestamp = Date.now();
  const state = workers.get(workerUrl);
  if (state) {
    state.currentTaskUrl = currentTaskUrl;
    state.taskQueues = taskQueues;
    state.lastTimestamp = lastTimestamp;
    state.available = available;
    // Heartbeat proves the pool saw the worker pick up this assignment; router doc can still lag.
    if (state.claimedTaskUrl && currentTaskUrl === state.claimedTaskUrl) {
      state.claimedTaskUrl = null;
    }
  } else {
    try {
      await repoPromise;
      workers.set(workerUrl, {
        handle: await repo.find(workerUrl),
        currentTaskUrl,
        claimedTaskUrl: null,
        claimIssuedAt: 0,
        taskQueues,
        lastTimestamp,
        available,
      });
    } catch (error) {
      console.error('unable to get doc handle for worker', { workerUrl, error });
    }
  }
}

function thisIsTheActiveRouterFor(taskQueueHandle: DocHandle<TaskQueueDoc>) {
  return (
    taskQueueHandle.doc().activeRouter === thisRouterHandle?.url &&
    !attemptingToTakeOverTaskQueueUrls.has(taskQueueHandle.url)
  );
}

export { }; // to ensure this is a module
