import { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import generateName from 'boring-name-generator';
import {
  MessageToWorker,
  Router,
  RouterHeartbeat,
  Worker as TaskWorker,
  WorkerStatus,
  TaskQueue,
} from './datatype';

interface WorkerInfo extends WorkerStatus {
  lastTimestamp: number;
  handle: DocHandle<TaskWorker>;
}

let repo: Repo;
let taskQueueHandle: DocHandle<TaskQueue>;
let setWorkers: (workers: AutomergeUrl[]) => void;
let contactUrl: AutomergeUrl | null;
let thisRouterHandle: DocHandle<Router>;
let activeRouter: { url: AutomergeUrl; lastTimestamp: number } | null = null;
const workerInfos = new Map<string, WorkerInfo>();
let running = false;

export function start(
  _repo: Repo,
  _taskQueueHandle: DocHandle<TaskQueue>,
  _setWorkers: (workers: AutomergeUrl[]) => void,
  _contactUrl: AutomergeUrl | null
) {
  // console.log('router: starting');

  repo = _repo;
  taskQueueHandle = _taskQueueHandle;
  setWorkers = _setWorkers;
  contactUrl = _contactUrl;

  console.log('router: task queue doc', taskQueueHandle.doc());
  taskQueueHandle.on('change', (payload) => updateActiveRouter(payload.doc));
  taskQueueHandle.on('ephemeral-message', (payload) =>
    processRouterHeartbeat(payload.message as RouterHeartbeat)
  );

  updateActiveRouter(taskQueueHandle.doc());

  thisRouterHandle = repo.create<Router>({
    name: generateName().dashed,
    contactUrl: contactUrl ?? null,
  });
  thisRouterHandle.on('ephemeral-message', (payload) =>
    processWorkerStatus(payload.message as WorkerStatus)
  );

  console.log('router: hey there, I am router', thisRouterHandle.url);
  running = true;

  pHeartbeat();
  pTakeOverWhenActiveRouterDropsOut();
  pDropStaleWorkerInfos();

  return thisRouterHandle.url;
}

export function stop() {
  taskQueueHandle.off('change');
  taskQueueHandle.off('ephemeral-message');
  thisRouterHandle.off('ephemeral-message');
  running = false;
}

async function pHeartbeat() {
  while (running) {
    if (thisIsTheActiveRouter()) {
      console.log('router: sending heartbeat');
      const workers = [...workerInfos.keys()] as AutomergeUrl[];
      setWorkers(workers);
      const h: RouterHeartbeat = { router: thisRouterHandle.url, workers };
      taskQueueHandle.broadcast(h);
    }
    await seconds(1);
  }
}

async function pTakeOverWhenActiveRouterDropsOut() {
  while (running) {
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
  workerInfos.clear();

  console.log('router: attempting takeover!');
  taskQueueHandle.change((doc) => {
    doc.router = thisRouterHandle.url;
  });

  // this wait is important!
  // - it enables this router to gather info from workers (who's around, who's working on what)
  // - it also gives the change to the task queue (to set the active router) a chance to propagate
  await seconds(3);

  // note that we check that this router is active every time around the loop
  // this is to avoid a situation where we *thought* we successfully promoted ourselves
  // when another router got there later and updated the doc.
  while (running && thisIsTheActiveRouter()) {
    const pendingTasks = taskQueueHandle.doc().pending.filter(isReallyPending);
    const idleWorkers = [...workerInfos.values()].filter((w) => w.currentTask == null);
    if (pendingTasks.length > 0 && idleWorkers.length === 0) {
      console.log(`router: ${pendingTasks.length} pending tasks but no idle workers!`);
    }
    while (pendingTasks.length > 0 && idleWorkers.length > 0) {
      const task = pendingTasks.shift()!;
      const worker = idleWorkers.shift()!;
      const message: MessageToWorker = { type: 'work on', task };
      console.log('router: telling', worker.handle.url, 'to work on', task);
      worker.handle.broadcast(message);
      worker.currentTask = task;
    }

    await seconds(1);
  }

  // helpers

  function isReallyPending(task: AutomergeUrl) {
    for (const { currentTask } of workerInfos.values()) {
      if (task === currentTask) {
        return false;
      }
    }
    return true;
  }
}

async function pDropStaleWorkerInfos() {
  while (running) {
    for (const { worker, lastTimestamp: timestamp } of workerInfos.values()) {
      if (Date.now() - timestamp! > 10 * 1_000) {
        workerInfos.delete(worker);
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

function processRouterHeartbeat({ router }: RouterHeartbeat) {
  if (router === activeRouter?.url) {
    activeRouter.lastTimestamp = Date.now();
  }
}

async function processWorkerStatus(status: WorkerStatus) {
  let info = workerInfos.get(status.worker);
  if (info) {
    Object.assign(info, status);
    info.lastTimestamp = Date.now();
  } else {
    workerInfos.set(status.worker, {
      ...status,
      lastTimestamp: Date.now(),
      handle: await repo.find(status.worker),
    });
  }
}

const thisIsTheActiveRouter = () => activeRouter?.url === thisRouterHandle.url;

const seconds = async (s: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, s * 1_000);
  });
