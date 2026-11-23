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
  Repo,
} from '@automerge/automerge-repo/slim';

import { getRepo, setUpImportMap } from './webworker-lib';
import generateName from 'boring-name-generator';
import { seconds, shuffle } from './helpers';
import { DeliveryStats, reportDeliveryStats, Sequencer } from './delivery-stats';
import { RouterWatch } from './takeover';
import { assignmentId, claimIsSettled, type Claim } from './claims';
import { listen, send } from './messages';
import { retireForNewerBuild } from './retire';
import { BUILD, compatible, protocolOf, WIRE_PROTOCOL } from './version';

let repo: Repo;
let contactUrl: AutomergeUrl;
let thisRouterHandle: DocHandle<RouterDoc>;

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';
let sequencer: Sequencer;

// Set once a newer build's workers are up (see version.ts): this router is on
// its way out, and mustn't take a queue back in its last moments.
let retiring = false;
const deliveryStats = new DeliveryStats();

const taskQueueHandles = new Map<AutomergeUrl, DocHandle<TaskQueueDoc>>();
/** The queues this router has been told to serve, joined yet or not. */
const wantedTaskQueues = new Set<AutomergeUrl>();
/** How to stop listening on each joined queue's channel. */
const stopListeningTo = new Map<AutomergeUrl, () => void>();
const routerWatch = new RouterWatch();

// Tasks a worker has reported finished with, and when. A worker's "done" tends
// to get here before the queue's own record of it does; until then the task
// still looks pending, and this is what stops it being handed out again.
const finishedTasks = new Map<AutomergeUrl, number>();
const FINISHED_TASK_MEMORY_MS = 60_000;
const attemptingToTakeOverTaskQueueUrls = new Set<AutomergeUrl>();

interface WorkerState {
  handle: DocHandle<WorkerDoc>;
  /** Last task URL reported by the worker pool heartbeat (replica of WorkerDoc). */
  currentTaskUrl: AutomergeUrl | null;
  /** The task this router has handed the worker and not yet heard about (see claims.ts). */
  claim: Claim | null;
  taskQueues: TaskQueueSet;
  lastTimestamp: number;
  /** Whether the worker's host wants it given work just now (see availability.ts). */
  available: boolean;
  /** Its pool's build, where the pool says, and the protocol it speaks (see version.ts). */
  build: number | undefined;
  protocol: number;
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
  listen<MessageToRouterChannel>(thisRouterHandle, (msg) => {
    switch (msg.type) {
      case 'worker heartbeat':
        deliveryStats.record(thisRouterHandle.url, msg);
        processWorkerHeartbeat(
          msg.workerUrl,
          msg.currentTask?.taskUrl ?? null,
          msg.taskQueues,
          // a pool from before there was a choice is always available
          msg.available ?? true,
          msg.build,
          protocolOf(msg.protocol),
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
    releaseSettledClaims();
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
      const stamp = sequencer.stamp(worker.handle.url);
      worker.claim = {
        taskUrl: nextPendingTaskUrl,
        assignment: assignmentId(stamp),
        issuedAt: Date.now(),
      };
      console.log('routing task', nextPendingTaskUrl, 'to worker', worker.handle.url);
      send(worker.handle, {
        type: 'work on',
        ...stamp,
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

    await untilThereMayBeWorkToRoute();
  }
}

// Routing used to happen once a second, so a new task waited up to a second to
// be noticed and a worker that had just finished waited up to another. Now a
// change to a queue or to a worker's doc brings the next round forward. The
// second is still there for what arrives no other way: heartbeats, and time
// passing.
let routeNow: (() => void) | null = null;

function routeSoon() {
  routeNow?.();
}

async function untilThereMayBeWorkToRoute() {
  await Promise.race([seconds(1), new Promise<void>((resolve) => (routeNow = resolve))]);
  routeNow = null;
}

async function pSendHeartbeats() {
  while (true) {
    for (const taskQueueHandle of taskQueueHandles.values()) {
      if (thisIsTheActiveRouterFor(taskQueueHandle)) {
        console.log('sending router heartbeat');
        const included = [...workers.values()].filter((worker) =>
          shouldIncludeInHeartbeat(worker, taskQueueHandle.url),
        );
        send(taskQueueHandle, {
          type: 'router heartbeat',
          ...sequencer.stamp(taskQueueHandle.url),
          routerUrl: thisRouterHandle.url,
          workerUrls: included.map((worker) => worker.handle.url),
          pausedWorkerUrls: included
            .filter((worker) => !worker.available)
            .map((worker) => worker.handle.url),
          build: BUILD,
          protocol: WIRE_PROTOCOL,
          workerBuilds: Object.fromEntries(
            included
              .filter((worker) => worker.build !== undefined)
              .map((worker) => [worker.handle.url, worker.build!]),
          ),
          incompatibleWorkerUrls: included
            .filter((worker) => !compatible(worker.protocol))
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
        handle.off('change', routeSoon);
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

/**
 * Steps down for a newer build's router. Any queue this router is in charge of
 * is left with no active router rather than with this one's name on it: a
 * queue without one is taken at once, where a router that had only gone quiet
 * would be waited on for ten seconds first.
 */
async function retire() {
  retiring = true;
  for (const taskQueueHandle of taskQueueHandles.values()) {
    if (taskQueueHandle.doc().activeRouter === thisRouterHandle?.url) {
      taskQueueHandle.change((doc) => {
        doc.activeRouter = null;
      });
    }
  }
  try {
    await repo?.flush();
  } catch (error) {
    console.error('could not save before stepping down', error);
  }
  self.close();
}
retireForNewerBuild(retire);

function attemptToTakeOver(taskQueueHandle: DocHandle<TaskQueueDoc>) {
  if (retiring) {
    return;
  }
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

/** Lets go of every claim that has run its course (see claims.ts). */
function releaseSettledClaims() {
  for (const worker of workers.values()) {
    if (!worker.claim) {
      continue;
    }
    const doc = worker.handle.doc();
    const view = {
      docTaskUrl: doc.currentTask?.taskUrl ?? null,
      heartbeatTaskUrl: worker.currentTaskUrl,
      lastFinished: doc.lastFinished,
    };
    if (claimIsSettled(worker.claim, view)) {
      if (view.lastFinished?.assignment === worker.claim.assignment && view.lastFinished.done) {
        finishedTasks.set(worker.claim.taskUrl as AutomergeUrl, Date.now());
      }
      worker.claim = null;
    }
  }

  // Forget the ones the queues have caught up on. The age limit is for a task
  // that somehow stays pending anyway: better it runs twice than never again.
  const stillPending = new Set<AutomergeUrl>();
  for (const taskQueueHandle of taskQueueHandles.values()) {
    for (const taskUrl of taskQueueHandle.doc().pending) {
      stillPending.add(taskUrl);
    }
  }
  for (const [taskUrl, finishedAt] of finishedTasks) {
    if (!stillPending.has(taskUrl) || Date.now() - finishedAt > FINISHED_TASK_MEMORY_MS) {
      finishedTasks.delete(taskUrl);
    }
  }
}

function getIdleWorkersByTaskQueueUrl() {
  const idleWorkers = [...workers.values()].filter((worker) => {
    const docBusy = !!worker.handle.doc().currentTask;
    const heartbeatBusy = !!worker.currentTaskUrl;
    return (
      worker.available &&
      // one that speaks another protocol wouldn't understand what it was sent
      compatible(worker.protocol) &&
      !docBusy &&
      !heartbeatBusy &&
      !worker.claim
    );
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
  if (finishedTasks.has(taskUrl)) {
    return false;
  }
  for (const worker of workers.values()) {
    const docTask = worker.handle.doc().currentTask?.taskUrl;
    if (
      taskUrl === docTask ||
      taskUrl === worker.claim?.taskUrl ||
      taskUrl === worker.currentTaskUrl
    ) {
      return false;
    }
  }
  return true;
}

async function updateTaskQueueSet(taskQueues: TaskQueueSet) {
  wantedTaskQueues.clear();
  for (const taskQueueUrl of Object.keys(taskQueues) as AutomergeUrl[]) {
    wantedTaskQueues.add(taskQueueUrl);
  }

  // remove task queues that are no longer in the set
  for (const taskQueueUrl of taskQueueHandles.keys()) {
    if (!wantedTaskQueues.has(taskQueueUrl)) {
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
    // Not here yet, most likely: a queue's url is on the account before the
    // queue itself has synced. Ask again shortly, for as long as it's wanted.
    console.log('task queue not here yet', { taskQueueUrl, error });
    setTimeout(() => {
      if (wantedTaskQueues.has(taskQueueUrl) && !taskQueueHandles.has(taskQueueUrl)) {
        joinTaskQueue(taskQueueUrl);
      }
    }, 2_000);
    return;
  }
  if (!wantedTaskQueues.has(taskQueueUrl) || taskQueueHandles.has(taskQueueUrl)) {
    // left, or joined by an earlier attempt, while this one was loading
    return;
  }

  taskQueueHandles.set(taskQueueUrl, handle);
  stopListeningTo.set(
    taskQueueUrl,
    listen<MessageToTaskQueueChannel>(handle, (msg) => {
      switch (msg.type) {
        case 'router heartbeat':
          deliveryStats.record(taskQueueUrl, msg);
          routerWatch.heardFrom(msg.routerUrl, Date.now(), protocolOf(msg.protocol));
          break;
      }
    }),
  );
  handle.on('change', routeSoon);
  routeSoon();
}

async function leaveTaskQueue(taskQueueUrl: AutomergeUrl) {
  const handle = taskQueueHandles.get(taskQueueUrl);
  // If this router runs the queue, say it no longer does: a queue with no
  // active router is taken at once, where one whose router had just gone quiet
  // would be waited on for ten seconds first.
  if (handle && handle.doc().activeRouter === thisRouterHandle?.url) {
    handle.change((doc) => {
      doc.activeRouter = null;
    });
  }
  stopListeningTo.get(taskQueueUrl)?.();
  stopListeningTo.delete(taskQueueUrl);
  handle?.off('change', routeSoon);
  taskQueueHandles.delete(taskQueueUrl);
  routerWatch.stopWatching(taskQueueUrl);
}

async function processWorkerHeartbeat(
  workerUrl: AutomergeUrl,
  currentTaskUrl: AutomergeUrl | null,
  taskQueues: TaskQueueSet,
  available: boolean,
  build: number | undefined,
  protocol: number,
) {
  const lastTimestamp = Date.now();
  const state = workers.get(workerUrl);
  if (state) {
    state.currentTaskUrl = currentTaskUrl;
    state.taskQueues = taskQueues;
    state.lastTimestamp = lastTimestamp;
    state.available = available;
    state.build = build;
    state.protocol = protocol;
  } else {
    try {
      await repoPromise;
      const handle = await repo.find<WorkerDoc>(workerUrl);
      if (workers.has(workerUrl)) {
        // another heartbeat for this worker got here while its doc was loading
        return;
      }
      workers.set(workerUrl, {
        handle,
        currentTaskUrl,
        claim: null,
        taskQueues,
        lastTimestamp,
        available,
        build,
        protocol,
      });
      handle.on('change', routeSoon);
      routeSoon();
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
