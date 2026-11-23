/* eslint-env worker */

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { WorkerDoc, RouterDoc, TaskQueueDoc, TaskQueueSet } from './datatype';
import type { MessageToWorkerPool, MessageToRouterChannel, RepoConfig } from './protocol';

import { getRepo, setUpImportMap } from './webworker-lib';
import { seconds } from './helpers';
import { Sequencer } from './delivery-stats';
import {
  AVAILABILITY_CHANNEL,
  decideAvailability,
  DEFAULT_AVAILABILITY_MODE,
  type AvailabilityStatus,
  type PressureState,
  type TabReport,
} from './availability';

interface TaskQueueState {
  activeRouterHandle: DocHandle<RouterDoc> | null;
}

let repo: Repo;

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';
const toDoAfterInit: (() => Promise<void>)[] = [];

const sharedWorkerNames = new Set<string>();
const workerByUrl = new Map<AutomergeUrl, WorkerDoc>();

const taskQueueUrls = new Set<AutomergeUrl>();
const taskQueueState = new Map<AutomergeUrl, TaskQueueState>();

// A new id each time the pool starts, so routers count this run's heartbeats
// apart from the last one's.
const sequencer = new Sequencer(`pool-${crypto.randomUUID()}`);

// What this browser's tabs last said about their host, and the CPU pressure
// reading if the browser gives one: what `availability` is decided from.
const tabReports = new Map<string, TabReport>();
let pressure: PressureState | null = null;
let availability: AvailabilityStatus = {
  mode: DEFAULT_AVAILABILITY_MODE,
  ...decideAvailability(DEFAULT_AVAILABILITY_MODE, { tabs: [], pressure }),
};
const availabilityChannel = new BroadcastChannel(AVAILABILITY_CHANNEL);

console.log('hi there, I am the worker pool!');
watchPressure();

self.addEventListener('connect', (e: any) => {
  console.log('got a connection!');
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorkerPool = e.data;
    if (msg.type === 'host activity') {
      // every couple of seconds from every tab: too many to log
      if (msg.report) {
        tabReports.set(msg.tabId, msg.report);
      } else {
        tabReports.delete(msg.tabId);
      }
      updateAvailability();
      return;
    }
    console.log('received message', msg);
    try {
      switch (msg.type) {
        case 'init':
          init(msg.repoConfig, msg.importMap, msg.baseURI);
          break;
        case 'update task queue set':
          updateTaskQueueSet(msg.taskQueues);
          break;
        case 'register worker':
          registerWorker(msg.sharedWorkerName, msg.workerUrl);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message in worker pool', { msg, error });
    }
  };
});

async function init(repoConfig: RepoConfig, importMap: any, baseURI: string) {
  if (status !== 'not initialized') {
    // every tab sends `init`; the first one is the one that counts
    return;
  }

  console.log('initializing...');
  status = 'initializing';

  await setUpImportMap(importMap, baseURI);
  repo = await getRepo(repoConfig, `task-worker-pool-${Math.round(Math.random() * 10_000)}`);
  pSendWorkerStatuses(); // this is a "process", meant to be running in the background (hence no `await`)

  console.log('ready');
  status = 'ready';

  while (toDoAfterInit.length > 0) {
    await toDoAfterInit.shift()!();
  }
}

async function updateTaskQueueSet(newTaskQueueUrls: TaskQueueSet) {
  if (status !== 'ready') {
    // haven't initialized yet, so save this for later
    toDoAfterInit.push(() => updateTaskQueueSet(newTaskQueueUrls));
    return;
  }

  // remove task queues that are no longer in the set
  for (const taskQueueUrl of taskQueueUrls) {
    if (!newTaskQueueUrls[taskQueueUrl]) {
      taskQueueUrls.delete(taskQueueUrl);
      taskQueueState.delete(taskQueueUrl);
    }
  }

  // add the new ones
  for (const taskQueueUrl of Object.keys(newTaskQueueUrls) as AutomergeUrl[]) {
    if (taskQueueUrls.has(taskQueueUrl)) {
      continue;
    }

    console.log('joining task queue', taskQueueUrl);

    let taskQueueHandle: DocHandle<TaskQueueDoc>;
    try {
      taskQueueHandle = await repo.find<TaskQueueDoc>(taskQueueUrl);
    } catch (error) {
      console.error('did not join task queue, unable to get its doc handle', {
        taskQueueUrl,
        error,
      });
      return;
    }

    taskQueueUrls.add(taskQueueUrl);
    taskQueueState.set(taskQueueUrl, { activeRouterHandle: null });

    async function setTaskQueueState(taskQueue: TaskQueueDoc) {
      try {
        const activeRouterHandle = taskQueue.activeRouter
          ? await repo.find<RouterDoc>(taskQueue.activeRouter)
          : null;
        taskQueueState.set(taskQueueUrl, { activeRouterHandle });
      } catch (error) {
        console.error('error finding doc for active router', { taskQueueUrl, error });
      }
    }

    taskQueueHandle.on('change', (payload) => setTaskQueueState(payload.doc));
    await setTaskQueueState(taskQueueHandle.doc());

    console.log('done joining task queue', taskQueueUrl);
  }
}

async function registerWorker(sharedWorkerName: string, workerUrl: AutomergeUrl) {
  if (sharedWorkerNames.has(sharedWorkerName)) {
    // already added!
    console.log('registerWorker: already know about', sharedWorkerName);
    return;
  } else if (status !== 'ready') {
    // haven't initialized yet, so save this for later
    console.log('registerWorker: will register', sharedWorkerName, 'after init');
    toDoAfterInit.push(() => registerWorker(sharedWorkerName, workerUrl));
    return;
  }

  console.log('adding worker', { sharedWorkerName, workerUrl });

  sharedWorkerNames.add(sharedWorkerName);

  try {
    const workerHandle = await repo.find<WorkerDoc>(workerUrl);
    workerHandle.on('change', (payload) => workerByUrl.set(workerUrl, payload.doc));
    workerByUrl.set(workerUrl, workerHandle.doc());
  } catch (error) {
    console.error('did not add worker, unable to get its doc handle', { workerUrl, error });
    sharedWorkerNames.delete(sharedWorkerName);
  }
}

/**
 * Decides again whether this browser's workers should be given work, and tells
 * the tabs. The router hears with the next heartbeat.
 */
function updateAvailability() {
  const now = Date.now();
  let latest: TabReport | null = null;
  for (const [tabId, report] of tabReports) {
    if (now - report.sentAt > 10 * 60_000) {
      // closed without saying so; even a tab hidden for hours reports every minute
      tabReports.delete(tabId);
    } else if (report.sentAt > (latest?.sentAt ?? 0)) {
      latest = report;
    }
  }

  // The mode is whatever the tabs last said. With none left to say, keep it.
  const mode = latest?.mode ?? availability.mode;
  const decision = decideAvailability(mode, { tabs: [...tabReports.values()], pressure }, now);
  if (
    decision.available !== availability.available ||
    decision.reason !== availability.reason ||
    mode !== availability.mode
  ) {
    console.log(decision.available ? 'taking tasks:' : 'not taking tasks:', decision.reason);
  }
  availability = { mode, ...decision };
  availabilityChannel.postMessage(availability);
}

/** Keeps `pressure` current where the browser reports it (Chrome and Edge). */
function watchPressure() {
  const PressureObserver = (self as any).PressureObserver;
  if (!PressureObserver) {
    return;
  }
  try {
    const observer = new PressureObserver((records: { state: PressureState }[]) => {
      pressure = records.at(-1)?.state ?? pressure;
      updateAvailability();
    });
    Promise.resolve(observer.observe('cpu', { sampleInterval: 2_000 })).catch((error: unknown) => {
      console.log('no CPU pressure readings here:', error);
    });
  } catch (error) {
    console.log('no CPU pressure readings here:', error);
  }
}

async function pSendWorkerStatuses() {
  while (true) {
    await seconds(1);

    // time passing changes the answer too: "quiet for 30 seconds" comes true
    updateAvailability();

    const taskQueues: TaskQueueSet = {};
    for (const taskQueueUrl of taskQueueUrls) {
      taskQueues[taskQueueUrl] = true;
    }

    for (const [taskQueueUrl, { activeRouterHandle }] of taskQueueState.entries()) {
      if (!activeRouterHandle) {
        continue;
      }

      for (const [workerUrl, { currentTask }] of workerByUrl.entries()) {
        if (currentTask && currentTask.taskQueueUrl !== taskQueueUrl) {
          // don't bother sending the heartbeats of workers that are busy with tasks from other queues
        } else {
          console.log('sending worker heartbeat to', activeRouterHandle.url, { workerUrl, currentTask });
          activeRouterHandle.broadcast({
            type: 'worker heartbeat',
            ...sequencer.stamp(activeRouterHandle.url),
            workerUrl,
            currentTask,
            taskQueues,
            available: availability.available,
          } satisfies MessageToRouterChannel);
        }
      }
    }
  }
}

export { }; // to ensure this is a module
