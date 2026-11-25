// A run, asked of a machine: a task in a task queue (the study's Server
// field), whose code is daemon/run-task.mjs in this package. The kit files
// beside this (task-client.js, task-rules.js: copies of the tasks package's)
// do the asking, stopping and following; this names the code, keys each task
// by its run doc's url, and reads the queue the way the study tool and the
// agent's tools show it.

import { ask, cancel, served, inSamePackage } from "./task-client.js";
import { allHeard, isTask, taskError, taskState, waitingWork, BEAT_MS } from "./task-rules.js";

/** The run's code, within this package. */
export const RUN_CODE = "daemon/run-task.mjs";

let givenPackage = null;

/**
 * Names this package (`automerge:<id>`) for code that isn't loaded from it
 * (tests, a probe in Node): the url a run's task names its code by is
 * otherwise read from where this module was loaded.
 * @param {string | null} packageUrl
 */
export function setPackageUrl(packageUrl) {
  givenPackage = packageUrl;
}

/** The url a run's task names its code by. Throws a plain sentence when this package can't be named. */
export function runCodeUrl() {
  const here = inSamePackage(import.meta.url, RUN_CODE);
  if (here) return here;
  if (givenPackage) return `/${encodeURIComponent(givenPackage)}/${RUN_CODE}`;
  throw new Error("This copy of the FEA tool wasn't loaded from its package, so it can't say which code runs a study; open it from Patchwork.");
}

/** Whether a document is a task queue (what a study's Server field names). */
export const isQueue = (doc) => !!doc && typeof doc === "object" && !!doc.jobs && typeof doc.jobs === "object";

/**
 * Asks the run's queue for it: a task keyed by the run doc's url, so asking
 * twice is asking once. The run doc keeps the task's url, which is where its
 * status is read from when nobody writes the run doc (see `shownRun`).
 * @returns {Promise<string>} the task's url
 */
export async function askRun(repo, queueUrl, runHandle, opts) {
  const { taskUrl } = await ask(repo, queueUrl, { importUrl: runCodeUrl(), input: { run: runHandle.url }, key: runHandle.url });
  runHandle.change((d) => {
    d.task = taskUrl;
  }, opts);
  return taskUrl;
}

/**
 * Cancels a run: records the stop in its task and takes it off the queue. A
 * run waiting never starts; one running is stopped within seconds and its
 * run doc says cancelled. False when its queue no longer lists it (it ended)
 * or its task had ended already.
 */
export function cancelRun(repo, run, runUrl) {
  if (!run?.server) return Promise.resolve(false);
  return cancel(repo, run.server, runUrl);
}

/**
 * A run's task as one look at its document reads it (nobody listening: an
 * open run counts as going on), with its runs for `shownRun`, or null when
 * the run names no task or it can't be read here.
 * @returns {Promise<{ state: string, error: string | null, runs: object[] } | null>}
 */
export async function lookAtTask(repo, run) {
  if (!run?.task) return null;
  try {
    const doc = (await repo.find(run.task)).doc();
    if (!isTask(doc)) return null;
    return { state: taskState(doc, allHeard), error: taskError(doc, allHeard), runs: doc.runs };
  } catch {
    return null;
  }
}

/**
 * The machines heard serving a queue within `ms` (a little over one beat):
 * resolves as soon as one is heard, else with an empty list.
 * @returns {Promise<import("./task-client.js").Serving[]>}
 */
export function hearServing(repo, queueUrl, ms = BEAT_MS + 500) {
  return new Promise((resolve) => {
    let stop = null;
    let done = false;
    const finish = (pools) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(pools);
    };
    const timer = setTimeout(() => finish([]), ms);
    stop = served(repo, queueUrl, (pools) => {
      if (pools.length) finish(pools);
    });
    if (done) stop();
  });
}

/**
 * The queue as people see it: how many of what it lists are running (what
 * the machines heard serving it say they are busy with) and how many wait.
 * @param {object | undefined} queueDoc
 * @param {{ name: string, slots: number, busy: number }[]} pools
 */
export function queueCounts(queueDoc, pools) {
  const listed = waitingWork(queueDoc).length;
  const running = Math.min(listed, pools.reduce((n, p) => n + (p.busy || 0), 0));
  return { listed, running, waiting: listed - running, slots: pools.reduce((n, p) => n + (p.slots || 0), 0) };
}

/** How many runs the queue lists ahead of this one (asked earlier, not ended), or null when it isn't listed. */
export function aheadOf(queueDoc, runUrl) {
  const at = waitingWork(queueDoc).findIndex((w) => w.key === runUrl);
  return at < 0 ? null : at;
}

/** Who serves a queue, for people: "FEA on studio (2 at once)", or null when nobody is heard. */
export function servedBy(pools) {
  if (!pools.length) return null;
  return pools.map((p) => `${p.name || "a machine"}${p.slots > 1 ? ` (${p.slots} at once)` : ""}`).join(", ");
}
