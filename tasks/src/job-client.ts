// Asking a queue for a task by key, stopping it, and following what becomes
// of it (see jobs.ts).
//
// Everything here is a read or a write of the queue's doc and the task's doc,
// or listening on the task doc's channel: nothing is sent to anyone. So it
// works from any Repo that can reach those docs, with or without the task
// workers running in the same browser, and from Node.
//
// Other packages can't be built against this one, and needn't be: the file is
// published under a name of its own (`JOB_CLIENT_PATH` in ids.ts), to import
// at run time from the package's URL. Or do without it: asking is making a
// task doc and listing it under a key, a few lines.

import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import type { RunInfo, RunLogEntry, TaskDoc, TaskQueueDoc } from './datatype';
import type { MessageToTaskChannel } from './protocol';
import {
  finishJob,
  forgetJob,
  HEARD_WITHIN_MS,
  isFinished,
  isHeard,
  isJobEntry,
  listJob,
  taskResult,
  taskState,
  type TaskState,
} from './jobs';
import { packageOf } from './import-url';
import { listen } from './messages';
import { trace } from './trace';

export { tracing, type Trace } from './trace';

export interface Ask<Input = unknown> {
  /**
   * Where the task's code is: anything `import()` takes. A module whose
   * default export is a function of the input (see job-context.ts).
   */
  importUrl: string;
  /** What to hand it. Anything that can go in a document. */
  input?: Input;
  /**
   * What makes this the same task as another: asking twice under one key is
   * asking once. Left out, the task gets a key of its own.
   */
  key?: string;
}

/** A task asked for by key, as someone following it sees it. */
export interface JobView<Result = unknown> {
  key: string;
  /** `missing`: nothing is listed under the key (never asked for, or forgotten). */
  state: TaskState | 'missing';
  taskUrl: AutomergeUrl | null;
  importUrl: string | null;
  input: unknown;
  /** What its code last reported, while it runs. Heard, not read: null until the worker next says. */
  progress: unknown;
  /** The log of the run going on, as far as it has been heard, or of the last run. */
  logs: RunLogEntry[];
  /** Its result, once it has succeeded. */
  result: Result | undefined;
  /** Why it failed, once it has: what its code threw, or that its workers kept going away. */
  error: string | null;
  runs: RunInfo<Result>[];
}

/** What has been heard of the run going on. */
export interface Heard {
  /** The hand-out it was heard about: news of another run starts again from nothing. */
  assignment: string | null;
  progress: unknown;
  logs: RunLogEntry[];
  /** When it was last heard, on the listener's own clock; null if never. */
  at: number | null;
}

const nothingHeard = (): Heard => ({ assignment: null, progress: null, logs: [], at: null });

const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/**
 * Asks `queueUrl` for a task. If one is listed under the key already, running
 * or finished, that is the task, and nothing new is made.
 *
 * Two askers at once each list their own; the merge keeps one, and both find
 * the same task under the key from then on. Which is why the task this
 * returns is only where the key pointed when asked: follow the key (`watch`),
 * not the url.
 */
export async function ask(repo: Repo, queueUrl: AutomergeUrl, { importUrl, input, key }: Ask) {
  const queue = await repo.find<TaskQueueDoc>(queueUrl);
  const jobKey = key ?? crypto.randomUUID();
  const listed = queue.doc().jobs?.[jobKey];
  if (isJobEntry(listed)) {
    return { key: jobKey, taskUrl: listed.taskUrl };
  }

  const task = repo.create<TaskDoc<any, any>>({
    input: copy(input) ?? null,
    importUrl,
    runs: [],
    key: jobKey,
  });
  trace('task made', task.url);
  // Saved before the queue names it, so that a worker handed the task finds
  // it in the shared database rather than having to wait for it.
  await repo.flush([task.documentId]);
  trace('task saved', task.url);
  queue.change((doc) =>
    listJob(doc, jobKey, { taskUrl: task.url, askedAt: Date.now(), package: packageOf(importUrl) }),
  );
  trace('listed', task.url);
  saveNow(repo, queue).then(() => trace('listing saved', task.url));
  return { key: jobKey, taskUrl: queue.doc().jobs![jobKey].taskUrl };
}

/**
 * Saves a doc at once rather than a moment later. Repos that share a database
 * (a tab's tasks Repo and the workers') learn of each other's changes as they
 * are saved, and a Repo waits a tenth of a second before saving by itself:
 * without this, that wait is most of how long a quick task takes.
 */
function saveNow(repo: Repo, handle: DocHandle<any>) {
  return repo.flush([handle.documentId]).catch(() => {
    // it is saved a moment later all the same
  });
}

/**
 * Asks the task under `key` to stop. One that is waiting never starts; one
 * that is running has its signal aborted. Either way it is finished with from
 * now. False when there's no such task, or it had finished already.
 */
export async function cancel(repo: Repo, queueUrl: AutomergeUrl, key: string) {
  const queue = await repo.find<TaskQueueDoc>(queueUrl);
  const listed = queue.doc().jobs?.[key];
  if (!isJobEntry(listed) || listed.done) {
    return false;
  }
  const task = await repo.find<TaskDoc<any, any>>(listed.taskUrl);
  if (isFinished(taskState(task.doc()))) {
    return false; // over, and its worker's word that it is hasn't got here yet
  }
  task.change((doc) => {
    if (!doc.cancelled) {
      doc.cancelled = true;
    }
  });
  queue.change((doc) => finishJob(doc, key, listed.taskUrl));
  saveNow(repo, task);
  saveNow(repo, queue);
  return true;
}

/**
 * Takes the key off the queue's list, so that asking for it again makes a new
 * task. A task that is still going is cancelled first.
 */
export async function forget(repo: Repo, queueUrl: AutomergeUrl, key: string) {
  await cancel(repo, queueUrl, key);
  const queue = await repo.find<TaskQueueDoc>(queueUrl);
  queue.change((doc) => forgetJob(doc, key));
}

/**
 * A keyed task as the queue, its own doc and what has been heard of its run
 * say it is, as far as they're here. `alive` says whether the run the doc
 * says is going on is being heard (see `taskState`); `watch` keeps track.
 */
export function viewOf<Result = unknown>(
  key: string,
  queue: Pick<TaskQueueDoc, 'jobs'> | undefined,
  task: TaskDoc<any, Result> | undefined,
  heard: Heard = nothingHeard(),
  alive = true,
): JobView<Result> {
  const listed = queue?.jobs?.[key];
  if (!isJobEntry(listed)) {
    return {
      key,
      state: 'missing',
      taskUrl: null,
      importUrl: null,
      input: undefined,
      progress: null,
      logs: [],
      result: undefined,
      error: null,
      runs: [],
    };
  }
  const state = taskState(task, alive);
  const last = task?.runs?.findLast((run) => run.status !== 'lost');
  // what was heard counts only for the run going on now
  const live = !!task?.current && heard.assignment === task.current.assignment;
  return {
    key,
    state,
    taskUrl: listed.taskUrl,
    importUrl: task?.importUrl ?? null,
    input: task?.input,
    progress: live ? heard.progress : null,
    logs: task?.current ? (live ? heard.logs : []) : (last?.logs ?? []),
    result: state === 'succeeded' ? taskResult(task) : undefined,
    error:
      state !== 'failed'
        ? null
        : last?.status === 'failed'
          ? (last.logs?.at(-1)?.message ?? 'failed')
          : 'its worker went away too often for it to be started again',
    runs: task?.runs ?? [],
  };
}

/** Adds one message from a task's channel, heard at `now`, to what has been heard of its run. */
export function hear(heard: Heard, message: MessageToTaskChannel, now = Date.now()): Heard {
  if (message.type !== 'task progress') {
    return heard;
  }
  const same = heard.assignment === message.assignment;
  return {
    assignment: message.assignment,
    progress: 'progress' in message ? message.progress : same ? heard.progress : null,
    logs: [...(same ? heard.logs : []), ...(message.logs ?? [])],
    at: now,
  };
}

/**
 * Calls `onChange` with the task under `key` now, and again whenever anything
 * about it changes or is heard, whichever task the key turns out to name.
 * Returns how to stop.
 */
export function watch<Result = unknown>(
  repo: Repo,
  queueUrl: AutomergeUrl,
  key: string,
  onChange: (job: JobView<Result>) => void,
) {
  let stopped = false;
  let queue: DocHandle<TaskQueueDoc> | undefined;
  let task: DocHandle<TaskDoc<any, Result>> | undefined;
  let stopListening: (() => void) | undefined;
  let heard = nothingHeard();
  let following: AutomergeUrl | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // The run the task's doc says is going on, and when this watcher first saw
  // it say so: a run not heard from yet is given from then (see `isHeard`).
  let seen: { assignment: string; at: number } | null = null;
  let lapse: ReturnType<typeof setTimeout> | undefined;

  const report = () => {
    if (stopped) {
      return;
    }
    clearTimeout(lapse);
    const current = task?.doc()?.current;
    let alive = true;
    if (current) {
      const now = Date.now();
      if (seen?.assignment !== current.assignment) {
        seen = { assignment: current.assignment, at: now };
      }
      const lastHeardAt = heard.assignment === current.assignment ? heard.at : null;
      alive = isHeard(lastHeardAt, seen.at, now);
      if (alive) {
        // looked at again when it would no longer count as heard
        lapse = setTimeout(report, (lastHeardAt ?? seen.at) + HEARD_WITHIN_MS - now + 20);
      }
    }
    onChange(viewOf(key, queue?.doc(), task?.doc(), heard, alive));
  };

  const unfollow = () => {
    task?.off('change', report);
    stopListening?.();
    stopListening = undefined;
    task = undefined;
    heard = nothingHeard();
    seen = null;
    clearTimeout(lapse);
  };

  const follow = () => {
    const listed = queue?.doc().jobs?.[key];
    const wanted = isJobEntry(listed) ? listed.taskUrl : null;
    if (wanted !== following) {
      unfollow();
      following = wanted;
      clearTimeout(retry);
      if (wanted) {
        const load = () => {
          repo.find<TaskDoc<any, Result>>(wanted).then(
            (found) => {
              if (stopped || following !== wanted) return;
              task = found;
              found.on('change', report);
              stopListening = listen<MessageToTaskChannel>(found, (message) => {
                heard = hear(heard, message);
                report();
              });
              report();
            },
            () => {
              // named before it has got here: not an error so much as "not yet"
              if (!stopped && following === wanted) retry = setTimeout(load, 2_000);
            },
          );
        };
        load();
      }
    }
    report();
  };

  const loadQueue = () => {
    repo.find<TaskQueueDoc>(queueUrl).then(
      (found) => {
        if (stopped) return;
        queue = found;
        found.on('change', follow);
        follow();
      },
      () => {
        if (!stopped) retry = setTimeout(loadQueue, 2_000);
      },
    );
  };
  loadQueue();

  return () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(lapse);
    queue?.off('change', follow);
    unfollow();
  };
}

/**
 * Asks for a task and waits for it: resolves to its result when it succeeds,
 * rejects when it fails for good or is cancelled. `onProgress` hears every
 * change on the way. If the key's entry goes missing while the task is wanted
 * (see `listJob`), it is asked for again.
 */
export function run<Result = unknown>(
  repo: Repo,
  queueUrl: AutomergeUrl,
  request: Ask,
  onProgress?: (job: JobView<Result>) => void,
): Promise<Result> {
  const key = request.key ?? crypto.randomUUID();
  return new Promise<Result>((resolve, reject) => {
    let asking = false;
    let stop = () => {};
    const askAgain = () => {
      if (asking) return;
      asking = true;
      ask(repo, queueUrl, { ...request, key })
        .catch((error) => {
          stop();
          reject(error);
        })
        .finally(() => (asking = false));
    };
    let sawRunning = false;
    stop = watch<Result>(repo, queueUrl, key, (job) => {
      onProgress?.(job);
      if (job.state === 'running' && !sawRunning && job.taskUrl) {
        sawRunning = true;
        trace('asker sees it running', job.taskUrl);
      }
      if (job.state === 'missing') {
        askAgain();
      } else if (isFinished(job.state)) {
        trace('asker has the result', job.taskUrl!);
        stop();
        if (job.state === 'succeeded') {
          resolve(job.result as Result);
        } else {
          reject(
            new Error(
              job.state === 'cancelled' ? 'The task was cancelled' : (job.error ?? 'The task failed'),
            ),
          );
        }
      }
    });
  });
}
