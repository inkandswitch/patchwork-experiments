/* eslint-env worker */

console.log('task worker script starting; self.name =', (self as any).name);

import type {
  TaskQueueDoc,
  TaskDoc,
  RunStatus,
  WorkerDoc,
  RunLogEntry,
  TaskQueueSet,
} from './datatype';
import type {
  MessageToTaskChannel,
  MessageToWorker,
  MessageToWorkerChannel,
  MessageToWorkerPoolProxy,
  RepoConfig,
} from './protocol';
import type { Repo, AutomergeUrl, DocHandle } from '@automerge/automerge-repo/slim';

import generateName from 'boring-name-generator';
import { getRepo, importModule, setUpImportMap } from './webworker-lib';
import { DeliveryStats, reportDeliveryStats, Sequencer } from './delivery-stats';
import { assignmentId } from './claims';
import { listen, send } from './messages';
import { retireForNewerBuild } from './retire';
import { acceptanceOf, accepts } from './acceptance';
import { finishJob, isJobEntry, lostTooOften } from './jobs';
import type { TaskContext } from './job-context';
import { trace } from './trace';

let status: 'not initialized' | 'initializing' | 'ready' = 'not initialized';

declare global {
  // Declare `repo` like this to prevent its name from getting mangled by the TS compiler.
  // This makes it possible for the task code to access this variable by name.
  var repo: Repo;
}

let workerHandle: DocHandle<WorkerDoc>;
let sequencer: Sequencer;

const deliveryStats = new DeliveryStats();

// Set once a newer build's workers are up (see version.ts). A worker in the
// middle of a task finishes it first; one with nothing to do goes at once.
let retiring = false;

function retire() {
  retiring = true;
  if (!workerHandle?.doc().currentTask) {
    closeDown();
  }
}
retireForNewerBuild(retire);

async function closeDown() {
  try {
    await globalThis.repo?.flush();
  } catch (error) {
    console.error('could not save before stepping down', error);
  }
  self.close();
}

function handleConnect(e: any) {
  console.log('got a connection!');
  const port = e.ports[0];
  port.onmessage = (e: any) => {
    const msg: MessageToWorker = e.data;
    console.log('received message', e.data);
    try {
      switch (msg.type) {
        case 'init':
          init(port, msg.repoConfig, msg.contactUrl, msg.importMap, msg.baseURI);
          break;
        case 'update task queue set':
          setTaskQueues(msg.taskQueues);
          break;
      }
    } catch (error) {
      console.error('uh-oh, error handling message', { msg, error });
    }
  };
  (port as any).start?.();
}

(self as any).onconnect = handleConnect;
self.addEventListener('connect', handleConnect as any);

// The queues this worker works on and whose code it runs from each (see
// acceptance.ts), as whoever started it last said. Until it has been told, it
// runs nothing.
let taskQueues: TaskQueueSet = {};

function setTaskQueues(said: TaskQueueSet | undefined) {
  taskQueues = said ?? {};
  sayWhatThisTakes();
}

/** What this worker takes from each queue, as its doc should say it. */
function takenNow(): NonNullable<WorkerDoc['accepts']> {
  const taken: NonNullable<WorkerDoc['accepts']> = {};
  for (const taskQueueUrl of Object.keys(taskQueues).sort() as AutomergeUrl[]) {
    const acceptance = acceptanceOf(taskQueues[taskQueueUrl]);
    if (acceptance !== undefined) {
      taken[taskQueueUrl] = acceptance === 'any' ? 'any' : [...acceptance].sort();
    }
  }
  return taken;
}

/**
 * Keeps this worker's own doc saying whose code it runs. A router goes by
 * that, so a task is only sent where it will be taken; the worker checks
 * again itself before it imports anything (see `run`).
 */
function sayWhatThisTakes() {
  if (!workerHandle) {
    return; // said when the doc is made
  }
  const taken = takenNow();
  const said = workerHandle.doc().accepts;
  const sorted = said && Object.fromEntries(Object.keys(said).sort().map((url) => [url, (said as any)[url]]));
  if (JSON.stringify(sorted ?? null) === JSON.stringify(taken)) {
    return;
  }
  workerHandle.change((doc) => {
    doc.accepts = taken;
  });
}

async function init(
  workerPoolProxyPort: MessagePort,
  repoConfig: RepoConfig,
  _contactUrl: AutomergeUrl,
  _importMap: any,
  _baseURI: string,
) {
  // SharedWorkers survive tab reloads and new Patchwork tabs open new MessagePorts.
  // A second `init` must still announce this worker to the pool; otherwise the pool
  // never hears `register worker` and the router gets empty worker lists.
  if (status === 'ready') {
    workerPoolProxyPort.postMessage({
      type: 'register worker',
      sharedWorkerName: self.name,
      workerUrl: workerHandle.url,
    } satisfies MessageToWorkerPoolProxy);
    return;
  }

  if (status !== 'not initialized') {
    return;
  }

  console.log('initializing...');
  status = 'initializing';

  await setUpImportMap(_importMap, _baseURI);

  // Important: if I take out the `globalThis.` from the assignment below, it doesn't work.
  // I get "ReferenceError: repo is not defined." This is probably b/c that variable only
  // counts as declared once it exists as a property in globalThis.
  globalThis.repo = await getRepo(
    repoConfig,
    `task-worker-${Math.round(Math.random() * 1_000_000)}`,
  );

  // create the worker document
  workerHandle = repo.create<WorkerDoc>({
    name: generateName().dashed,
    contactUrl: _contactUrl,
    currentTask: null,
    // present from the start, so a router can tell this worker will report
    lastFinished: null,
    taskCount: 0,
    accepts: takenNow(),
  });
  sequencer = new Sequencer(workerHandle.url);

  // tell the worker pool proxy that I exist
  workerPoolProxyPort.postMessage({
    type: 'register worker',
    sharedWorkerName: self.name,
    workerUrl: workerHandle.url,
  } satisfies MessageToWorkerPoolProxy);

  // listen to messages on my channel
  listen<MessageToWorkerChannel>(workerHandle, (msg) => {
    switch (msg.type) {
      case 'work on':
        deliveryStats.record(workerHandle.url, msg);
        if (retiring) {
          // on its way out; the router's claim lapses and the task goes elsewhere
          break;
        }
        if (workerHandle.doc().currentTask) {
          // One task at a time. The router only sends work to a worker it
          // believes is idle, so this is a repeat or a stale view; its claim
          // on this worker lapses and the task is routed again.
          console.log('busy, ignoring request to work on', msg.taskUrl);
          break;
        }
        processTask(msg.taskUrl, msg.taskQueueUrl, assignmentId(msg), msg.key);
        break;
    }
  });
  reportDeliveryStats((self as any).name || 'task-worker', deliveryStats);

  workerHandle.change((doc) => {
    doc.currentTask = null;
  });

  console.log('ready', { workerUrl: workerHandle.url });
  console.log('hola, me llamo', workerHandle.doc().name);
}

const tally = { numSuccesses: 0, numFailures: 0, numBails: 0 };

function logTally() {
  const { numSuccesses, numFailures, numBails } = tally;
  const total = numSuccesses + numFailures + numBails;
  console.log('');
  console.log(`Processed ${total} tasks so far.`);
  console.log(`  ${numSuccesses} successes (${(numSuccesses / total) * 100 || 100}%)`);
  console.log(`  ${numFailures} failures (${(numFailures / total) * 100 || 0}%)`);
  console.log(`  ${numBails} bails (${(numBails / total) * 100 || 0}%)`);
  console.log('');
}

async function processTask(
  taskUrl: AutomergeUrl,
  taskQueueUrl: AutomergeUrl,
  assignment: string,
  /** For a task asked for by key, the key: said in this worker's doc, for routers (see jobs.ts). */
  key?: string,
) {
  console.log('executing task', taskUrl);
  trace('worker told', taskUrl);

  workerHandle.change((doc) => {
    doc.currentTask = key === undefined ? { taskUrl, taskQueueUrl } : { taskUrl, taskQueueUrl, key };
    doc.taskCount = (doc.taskCount ?? 0) + 1;
  });

  let ok = true;

  let taskHandle: DocHandle<TaskDoc<any, any>>;
  try {
    taskHandle = await findSoon<TaskDoc<any, any>>(taskUrl);
  } catch (error) {
    console.error('unable to get doc handle for task', { taskUrl, error });
    ok = false;
  }

  let taskQueueHandle: DocHandle<TaskQueueDoc>;
  if (ok) {
    try {
      taskQueueHandle = await getTaskQueueHandle(taskQueueUrl);
    } catch (error) {
      console.error('unable to get doc handle for task queue', { taskQueueUrl, error });
      ok = false;
    }
  }

  if (!ok) {
    console.log('bailing on task', taskUrl);
    tally.numBails++;
    workerHandle.change((doc) => {
      doc.currentTask = null;
      doc.lastFinished = { assignment, done: false };
    });
    logTally();
    return;
  }

  taskHandle = taskHandle!;
  taskQueueHandle = taskQueueHandle!;
  trace('worker has the task', taskUrl);

  // whether the task is finished with (off its queue's waiting work), as far as this worker knows
  let done = false;
  try {
    const { status, ended } = await run(taskHandle, taskQueueHandle, assignment, key);
    if (status === 'not mine') {
      tally.numBails++;
    } else if (status === 'failed') {
      console.error('task failed');
      tally.numFailures++;
    } else {
      console.log(`task ${status}!`);
      tally.numSuccesses++;
    }
    done = ended;
  } catch (error) {
    console.error('impossible error:', error);
  } finally {
    workerHandle.change((doc) => {
      doc.currentTask = null;
      doc.lastFinished = { assignment, done };
    });
    trace('worker says it is free', taskUrl);
  }
  logTally();
  if (retiring) {
    closeDown();
  }
}

/** How long, at the least, between two messages about a running task's progress. */
const SAY_EVERY_MS = 100;

/** How often a running task's latest progress is said again, for whoever has only just started watching. */
const SAY_AGAIN_EVERY_MS = 2_000;

/** How long a cancelled task's code is given to stop before its worker moves on without it. */
const STOP_GRACE_MS = 5_000;

/** How long a worker sits on a task it won't run before saying so, so that being sent it again and again is slow. */
const REFUSAL_PAUSE_MS = 2_000;

/** What waiting on a cancelled task's code comes to when it doesn't stop. */
const GAVE_UP = Symbol('gave up');

/** A copy that can be sent in a message, or null. */
function sendable(value: unknown): any {
  try {
    return value === undefined ? null : JSON.parse(JSON.stringify(value)) ?? null;
  } catch {
    return String(value);
  }
}

/**
 * Runs a task once and records how it went.
 *
 * `status` is the run's: `succeeded`, `failed` (its code couldn't be loaded,
 * or threw, or the task had lost too many runs to be started again),
 * `cancelled` (someone asked it to stop, before or during the run), or
 * `not mine`, when this worker doesn't run code from where the task's is (see
 * acceptance.ts) and nothing is recorded. `ended` says the task is finished
 * with: it has left its queue's waiting work. Every run that is recorded ends
 * its task (see jobs.ts).
 *
 * While it runs, the task doc's `current` is this run, and the worker says so
 * on the task doc's channel every SAY_AGAIN_EVERY_MS, with whatever the code
 * reports (see `TaskProgressMessage`). A second worker handed the same task
 * (it can happen; see lab note 2) records this run as lost and replaces
 * `current` with its own; this one then leaves `current` alone, and when it
 * finishes all the same, its record shows it was never lost.
 */
async function run(
  taskHandle: DocHandle<TaskDoc<any, any>>,
  taskQueueHandle: DocHandle<TaskQueueDoc>,
  assignment: string,
  key: string | undefined,
): Promise<{ status: RunStatus | 'not mine'; ended: boolean }> {
  const taskUrl = taskHandle.url;
  const taskQueueUrl = taskQueueHandle.url;
  const { importUrl, input } = taskHandle.doc();

  /** Takes the task off its queue's waiting work. */
  const delist = () => {
    if (key === undefined) {
      moveToDone(taskUrl, taskQueueHandle);
    } else {
      taskQueueHandle.change((doc) => finishJob(doc, key, taskUrl));
    }
  };

  // Cancelled is said in the task's own doc. A task asked for by key also
  // stops when its key has been finished with by another task: a second ask
  // took this one's place under the key and was then cancelled, so nobody is
  // waiting on this run any more.
  const isCancelled = () => {
    if (taskHandle.doc().cancelled) {
      return true;
    }
    const job = key === undefined ? undefined : taskQueueHandle.doc().jobs?.[key];
    return isJobEntry(job) && !!job.done && job.taskUrl !== taskUrl;
  };

  const ended = taskHandle.doc().outcome;
  if (ended) {
    // Over already: this hand-out was made on an old view of the queue.
    delist();
    return { status: ended, ended: true };
  }
  if (isCancelled()) {
    // cancelled before it got anywhere: nothing ran, so there's no run to record
    delist();
    return { status: 'cancelled', ended: true };
  }

  if (!accepts(acceptanceOf(taskQueues[taskQueueUrl]), importUrl)) {
    // The router sent it on an out-of-date view of this worker, or the queue
    // says the task's code is somewhere it isn't. It goes to another worker.
    console.log('not running code from', importUrl.slice(0, 120), 'for', taskUrl);
    await new Promise((resolve) => setTimeout(resolve, REFUSAL_PAUSE_MS));
    return { status: 'not mine', ended: false };
  }

  // Being handed a task that says a run of it is going on means that run's
  // worker is taken to have gone away. This worker says so for it; and when
  // the task has lost as many runs as it may, that is how it ends.
  const startTimeMillis = Date.now();
  trace('run starts', taskUrl);
  let lost = false;
  taskHandle.change((doc) => {
    const before = doc.current;
    if (before && before.assignment !== assignment) {
      doc.runs.push({
        workerUrl: before.workerUrl,
        status: 'lost',
        result: null,
        startTimeMillis: before.startTimeMillis,
        endTimeMillis: startTimeMillis,
        run: before.assignment,
      });
    }
    if (lostTooOften(doc)) {
      lost = true;
      doc.current = null;
      if (!doc.outcome) {
        doc.outcome = 'failed';
      }
      return;
    }
    doc.current = { workerUrl: workerHandle.url, assignment, startTimeMillis };
  });
  if (lost) {
    console.error('task lost too many runs to be started again', taskUrl);
    delist();
    saveNow(taskHandle, taskQueueHandle);
    return { status: 'failed', ended: true };
  }

  // What is said of the run on the task's channel. That it is going on: now,
  // and again every SAY_AGAIN_EVERY_MS, whatever its code does, because that
  // word is the only thing that tells a reader the run is alive (see
  // `taskState`). And what its code reports: at most every SAY_EVERY_MS, with
  // the latest progress again each time it says it is going on.
  const logs: RunLogEntry[] = [];
  let logsSaid = 0;
  let progress: unknown;
  let progressChanged = false;
  let sayTimer: ReturnType<typeof setTimeout> | null = null;
  const say = (again = false) => {
    sayTimer = null;
    const freshLogs = logs.slice(logsSaid);
    if (!again && !progressChanged && freshLogs.length === 0) {
      return;
    }
    const withProgress = progressChanged || (again && progress !== undefined);
    send(taskHandle, {
      type: 'task progress',
      ...sequencer.stamp(taskUrl),
      assignment,
      ...(withProgress ? { progress: sendable(progress) } : {}),
      ...(freshLogs.length > 0 ? { logs: freshLogs } : {}),
    } satisfies MessageToTaskChannel);
    logsSaid = logs.length;
    progressChanged = false;
  };
  const saySoon = () => {
    sayTimer ??= setTimeout(say, SAY_EVERY_MS);
  };
  say(true);
  const sayAgainTimer = setInterval(() => say(true), SAY_AGAIN_EVERY_MS);

  // Its code is asked to stop when the task is cancelled, and when the task
  // has ended without it: another run of it, one this worker was handed the
  // task in place of, finished after all.
  const controller = new AbortController();
  const stopIfCancelled = () => {
    if (controller.signal.aborted) {
      return;
    }
    if (isCancelled()) {
      console.log('task cancelled', taskUrl);
      controller.abort(new DOMException('The task was cancelled', 'AbortError'));
    } else if (taskHandle.doc().outcome) {
      console.log('task ended by another run', taskUrl);
      controller.abort(new DOMException('The task has ended', 'AbortError'));
    }
  };
  taskHandle.on('change', stopIfCancelled);
  taskQueueHandle.on('change', stopIfCancelled);
  // resolves a while after a cancel, for code that doesn't stop by itself
  const gaveUpWaiting = new Promise<typeof GAVE_UP>((resolve) => {
    controller.signal.addEventListener('abort', () =>
      setTimeout(() => resolve(GAVE_UP), STOP_GRACE_MS),
    );
  });

  const context: TaskContext = {
    log(...args: unknown[]) {
      const message = args.map((arg) => '' + arg).join(' ');
      logs.push({ timestampMillis: Date.now(), message });
      console.log('Task log:', message);
      saySoon();
    },
    progress(value: unknown) {
      progress = value;
      progressChanged = true;
      saySoon();
    },
    signal: controller.signal,
    repo,
    taskUrl,
    run: assignment,
    key: key ?? null,
  };

  let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded';
  let result: any;
  try {
    // Dynamic import of the task module, with import map support
    const module = await importModule(importUrl);
    trace('code loaded', taskUrl);
    const taskFunction = module?.default;
    if (typeof taskFunction !== 'function') {
      throw new Error("the task's code has no default export to call");
    }
    // Execute the task with its context as `this`, as ever, and as a second argument
    const running = Promise.resolve().then(() => taskFunction.call(context, input, context));
    const outcome = await Promise.race([running, gaveUpWaiting]);
    if (outcome === GAVE_UP) {
      running.catch(() => {}); // whatever it does now, nobody is listening
    } else {
      result = outcome;
    }
  } catch (error: any) {
    if (!controller.signal.aborted) {
      console.error('task execution failed:', error);
      logs.push({ timestampMillis: Date.now(), message: error?.message ?? '' + error });
      status = 'failed';
    }
  } finally {
    clearInterval(sayAgainTimer);
    if (sayTimer) {
      clearTimeout(sayTimer);
    }
    taskHandle.off('change', stopIfCancelled);
    taskQueueHandle.off('change', stopIfCancelled);
  }
  trace('code ran', taskUrl);
  if (isCancelled() || (controller.signal.aborted && status !== 'succeeded')) {
    // however its code ended: a result nobody wants any more isn't one, and
    // code that was stopped and threw for it didn't fail
    status = 'cancelled';
  }
  say(); // whatever hasn't been said yet

  // The run, and with it, in the same change, that it ends the task: a
  // reader of the task has both or neither (see `taskState`). However the run
  // went, the task is over (see jobs.ts): unless another run ended it first,
  // in which case that one's word stands.
  taskHandle.change((doc) => {
    doc.runs.push({
      workerUrl: workerHandle.url,
      status,
      result: status === 'succeeded' ? (result ?? null) : null,
      startTimeMillis,
      endTimeMillis: Date.now(),
      logs: logs.map((entry) => ({ ...entry })),
      run: assignment,
    });
    if (doc.current?.assignment === assignment) {
      doc.current = null;
    }
    if (!doc.outcome) {
      doc.outcome = status;
    }
  });
  trace('run recorded', taskUrl);
  delist();
  // Saved at once: whoever asked shares this worker's database, in a browser,
  // and hears of the result as it is saved, which left alone is a tenth of a
  // second from now (and the same again for the router to see the queue).
  saveNow(taskHandle, taskQueueHandle).then(() => trace('run saved', taskUrl));
  return { status, ended: true };
}

function saveNow(...handles: DocHandle<any>[]) {
  return repo.flush(handles.map((handle) => handle.documentId)).catch((error) => {
    console.log('could not save at once; it is saved a moment later all the same', error);
  });
}

function moveToDone(taskUrl: AutomergeUrl, taskQueueHandle: DocHandle<TaskQueueDoc>) {
  taskQueueHandle.change((doc) => {
    const idx = doc.pending.indexOf(taskUrl);
    // The task may have been removed from the pending list by another worker.
    if (idx >= 0) {
      doc.pending.splice(idx, 1);
      doc.done.push(taskUrl);
    }
  });
}

/** How long one ask for a doc is waited on before asking again. */
const FIND_WAIT_MS = 8_000;

/**
 * The doc at `url`, asked for a few times before giving up. A task is named
 * in its queue the moment it's made, and where the worker doesn't share a
 * database with whoever made it (see src/node), the name can get here before
 * the doc does. Nor is an ask waited on for ever: one the sync server never
 * answers would otherwise hold the worker for as long as the server's own
 * patience lasts, a minute at a time. Giving up hands the task back, to be
 * sent out again.
 */
async function findSoon<T>(url: AutomergeUrl, tries = 3, gapMs = 700): Promise<DocHandle<T>> {
  for (let attempt = 1; ; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        repo.find<T>(url),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer for ${url} in ${FIND_WAIT_MS} ms`)), FIND_WAIT_MS);
        }),
      ]);
    } catch (error) {
      if (attempt >= tries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    } finally {
      clearTimeout(timer);
    }
  }
}

const taskQueueHandles = new Map<AutomergeUrl, DocHandle<TaskQueueDoc>>();

async function getTaskQueueHandle(taskQueueUrl: AutomergeUrl) {
  if (taskQueueHandles.has(taskQueueUrl)) {
    return taskQueueHandles.get(taskQueueUrl)!;
  }

  const handle = await findSoon<TaskQueueDoc>(taskQueueUrl);
  taskQueueHandles.set(taskQueueUrl, handle);
  return handle;
}

export { }; // to ensure this is a module
