/**
 * task-client.js — asking a queue for a task, stopping it, and following what becomes of it. [kit: task-client.js v12]
 *
 * Everything here is a read or a write of a queue's document and a task's
 * document, or listening on their channels; nothing is sent to anyone. So it
 * works from any Repo that can reach those documents, in a page, a worker or
 * Node, whether or not a pool runs on the same machine. The rules it applies
 * are task-rules.js's, which sits beside it; the canonical copies of both are
 * in the tasks package.
 *
 * It also holds how the task system's messages travel (`send`, `listen`),
 * because hearing them is half of following a task; and, for a page, where
 * a person's list of served queues and their own queue are kept
 * (`ownQueue`, `tasksStorage`), and how a tool there has work done and
 * follows and stops it (`doWork`, `watchWork`, `stopWork`).
 */

import {
  BEAT_MS,
  LAPSE_MS,
  MAX_LOG_LINES,
  checkKey,
  checkNeeds,
  delistTask,
  endingRun,
  entryAt,
  Hearing,
  isFinished,
  isWanted,
  listTask,
  mayRelist,
  named,
  recordsOf,
  satisfies,
  stopTask,
  taskError,
  taskResult,
  taskState,
} from './task-rules.js';

/** @typedef {import('./task-rules.js').Task} Task */
/** @typedef {import('./task-rules.js').Queue} Queue */
/** @typedef {import('./task-rules.js').Run} Run */
/** @typedef {import('./task-rules.js').LogLine} LogLine */
/** @typedef {import('./task-rules.js').TaskState} TaskState */

// Messages
//
// Each goes out twice. Once as an ephemeral message on a document, which the
// sync server passes to everyone who has that document open: that is how it
// reaches other machines. And once on a BroadcastChannel, which reaches this
// machine's own pages and workers directly, with or without a server. A
// neighbour therefore hears most messages twice, so every message carries who
// sent it and a number (`from`, `seq`), and `listen` passes each on once.

/** The BroadcastChannel that carries messages between one origin's pages and workers (and one Node process's threads). */
export const LOCAL_MESSAGES_CHANNEL = 'patchwork-tasks-messages';

/**
 * Said on a task's channel by the pool running it, every BEAT_MS and
 * whenever there is news: the run is going on, with what its code last
 * reported and the lines it has logged since the last message.
 * @typedef {{ type: 'task progress', run: string, progress?: unknown, logs?: LogLine[], from: string, seq: number }} RunProgressMessage
 */

/**
 * Said on a queue's channel by each pool serving it, every BEAT_MS and
 * whenever how many of its slots are busy changes: who it is, how many slots
 * it has and how many are busy, and what it has (see `satisfies`). A pool
 * that stops, or stops serving the queue, says it last with no slots.
 * Advice: no rule depends on it. People and askers read it to say why work
 * waits; pools read it to hold back for the pool a task prefers.
 * @typedef {{ type: 'serving', pool: string, name: string, slots: number, busy: number, has: string[], from: string, seq: number }} ServingMessage
 */

/** @type {BroadcastChannel | undefined} */
let local;
/** @type {Set<(envelope: { channel: string, message: any }) => void>} */
const localListeners = new Set();

function localChannel() {
  if (!local) {
    local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    local.onmessage = ({ data }) => {
      for (const listener of localListeners) {
        listener(data);
      }
    };
    // a process that has only this left to wait for may end
    /** @type {any} */ (local).unref?.();
  }
  return local;
}

/**
 * Makes the stamps one sender puts on what it sends: a name of its own, new
 * each time it starts, and a count per channel.
 * @returns {(channel: string) => { from: string, seq: number }}
 */
export function stamper() {
  const from = crypto.randomUUID();
  /** @type {Map<string, number>} */
  const next = new Map();
  return (channel) => {
    const seq = next.get(channel) ?? 0;
    next.set(channel, seq + 1);
    return { from, seq };
  };
}

/**
 * Sends a stamped message to everyone listening on `handle`'s channel, near and far.
 * @param {any} handle  a DocHandle
 * @param {{ from: string, seq: number }} message
 */
export function send(handle, message) {
  handle.broadcast(message);
  localChannel().postMessage({ channel: handle.url, message });
}

/** How many recent stamps a listener remembers: far more than can be in flight at once. */
const REMEMBERED = 500;

/**
 * Calls `onMessage` once for each stamped message sent on `handle`'s channel,
 * by either route. Other tools broadcast on the same documents (presence, for
 * one); what they send carries no stamp and is not passed on. Returns how to stop.
 * @param {any} handle  a DocHandle
 * @param {(message: any) => void} onMessage
 * @returns {() => void}
 */
export function listen(handle, onMessage) {
  /** @type {Set<string>} */
  const seen = new Set();
  const deliver = (/** @type {any} */ message) => {
    if (typeof message?.from !== 'string' || typeof message?.seq !== 'number') {
      return;
    }
    const stamp = `${message.from}#${message.seq}`;
    if (seen.has(stamp)) {
      return;
    }
    seen.add(stamp);
    if (seen.size > REMEMBERED) {
      // a Set keeps the order things were added in, so this is the oldest
      seen.delete(/** @type {string} */ (seen.values().next().value));
    }
    onMessage(message);
  };
  const onEphemeral = (/** @type {{ message: unknown }} */ payload) => deliver(payload.message);
  const onLocal = (/** @type {{ channel: string, message: unknown }} */ envelope) => {
    if (envelope?.channel === handle.url) {
      deliver(envelope.message);
    }
  };
  handle.on('ephemeral-message', onEphemeral);
  localChannel();
  localListeners.add(onLocal);
  return () => {
    handle.off('ephemeral-message', onEphemeral);
    localListeners.delete(onLocal);
  };
}

// Where a task's code is

const AUTOMERGE_DOC = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}(#[^/?#]+)?$/;

/**
 * An import URL that names a file in a package kept in automerge.
 * @typedef {object} AutomergeImport
 * @property {string} docUrl  The package's folder doc, as the URL names it: `automerge:<id>`, with `#<heads>` if it says.
 * @property {string} packageUrl  The package, whatever its version: `automerge:<id>`.
 * @property {string | null} heads  The heads it is pinned to, if it is.
 * @property {string} path  The file within the package: `dist/task.js`.
 * @property {string} search  Anything after the path (`?retry=1`), kept as it was.
 */

/**
 * Reads an import URL as a file in an automerge package, or null if it isn't
 * one. Code kept in automerge is reached the way a site reaches it, through
 * its service worker, whose URLs look like
 * `https://site/automerge%3A<package>%23<heads>/dist/task.js`. The origin is
 * not looked at, nor needed: a URL without one reads the same, and means "on
 * whatever site this is".
 * @param {string} importUrl
 * @returns {AutomergeImport | null}
 */
export function parseAutomergeImport(importUrl) {
  let url;
  try {
    url = new URL(importUrl, 'https://nowhere.invalid');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  const slash = url.pathname.indexOf('/', 1);
  if (slash < 0) {
    return null; // a package, but no file in it
  }
  let docUrl;
  try {
    docUrl = decodeURIComponent(url.pathname.slice(1, slash));
  } catch {
    return null;
  }
  const path = url.pathname.slice(slash + 1);
  if (!AUTOMERGE_DOC.test(docUrl) || !path) {
    return null;
  }
  const hash = docUrl.indexOf('#');
  return {
    docUrl,
    packageUrl: hash < 0 ? docUrl : docUrl.slice(0, hash),
    heads: hash < 0 ? null : docUrl.slice(hash + 1),
    path,
    search: url.search,
  };
}

/**
 * The package an import URL's code is in (`automerge:<id>`), or null: a
 * `data:` URL, or code from elsewhere.
 * @param {string} importUrl
 * @returns {string | null}
 */
export function packageOf(importUrl) {
  return parseAutomergeImport(importUrl)?.packageUrl ?? null;
}

/**
 * The import URL of `path` in the same package as `fromUrl` (a module's own
 * `import.meta.url`), with no origin, so that it means "this package's file"
 * on whatever machine runs it; null if `fromUrl` is not in a package.
 * @param {string} fromUrl
 * @param {string} path
 * @returns {string | null}
 */
export function inSamePackage(fromUrl, path) {
  const found = parseAutomergeImport(fromUrl);
  return found ? `/${encodeURIComponent(found.docUrl)}/${path}` : null;
}

// Asking

/**
 * @typedef {object} Ask
 * @property {string} importUrl  Where the task's code is: anything `import()` takes. A module whose default export is a function of `(input, ctx)`.
 * @property {unknown} [input]  What to hand it. Anything JSON can carry.
 * @property {string} [key]  What makes this the same task as another: asking twice under one key, while the first has not ended, is asking once. Left out, the task gets a key of its own.
 * @property {string[]} [needs]  What a machine must have to run it: plain labels (`unix`, `node`, `browser`, `pool:<id>` for one machine in particular). Only a pool that has every one takes it; until one serves the queue, it waits.
 * @property {string} [near]  The id of the pool the asker is next to: that pool takes it at once whenever it may, and the others hold back for it (see `preferred` in task-rules.js).
 */

const copy = (/** @type {unknown} */ value) =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));

/**
 * Asks `queueUrl` for a task. If the key names a task that has not ended,
 * that is the task, and nothing new is made.
 *
 * Two askers at once each list their own; the merge keeps one, and both find
 * the same task under the key from then on. Which is why the task this
 * returns is only where the key pointed when asked: follow the key (`watch`,
 * `run`), not the url. The task asked once keeps the needs it was asked with.
 *
 * Throws, writing nothing, for a key that cannot be one, for needs that are
 * not a list of labels, and for a `near` that is not a pool's id.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {Ask} ask
 * @returns {Promise<{ key: string, taskUrl: string }>}
 */
export async function ask(repo, queueUrl, { importUrl, input, key, needs, near }) {
  const jobKey = key ?? crypto.randomUUID();
  checkKey(jobKey);
  checkNeeds(needs);
  if (near !== undefined && near !== null && typeof near !== 'string') {
    throw new Error("`near` names a pool by its id, a string.");
  }
  const queue = await repo.find(queueUrl);
  const listed = entryAt(queue.doc(), jobKey);
  /** @type {string | undefined} */
  let over;
  if (listed) {
    // The task the key names is the one while it is still wanted. A document
    // that is no task at all, a task some record has ended, and one that
    // cannot be found (nobody could run it either) are listed over.
    const wanted = await repo.find(listed.taskUrl).then(
      (/** @type {any} */ handle) => isWanted(handle.doc()),
      () => false,
    );
    if (wanted) {
      return { key: jobKey, taskUrl: listed.taskUrl };
    }
    over = listed.taskUrl;
  }
  // needs are written on the task only when there are some: a task without them needs nothing
  const task = repo.create({
    importUrl,
    input: copy(input),
    key: jobKey,
    ...(needs && needs.length > 0 ? { needs: [...needs] } : {}),
    runs: [],
  });
  // Saved before the queue names it, so that a pool that sees the entry finds the task.
  await repo.flush([task.documentId]);
  queue.change((/** @type {Queue} */ doc) =>
    listTask(
      doc,
      jobKey,
      { taskUrl: task.url, askedAt: Date.now(), package: packageOf(importUrl), needs: needs ?? [], near: near ?? undefined },
      over,
    ),
  );
  await repo.flush([queue.documentId]).catch(() => {
    // it is saved a moment later all the same
  });
  return { key: jobKey, taskUrl: queue.doc().jobs[jobKey].taskUrl };
}

/**
 * Asks the task under `key` to stop: appends a stop to its list and takes it
 * off the queue. One that is waiting never starts; one that is running has
 * its signal aborted and its worker ended soon after. False when the key
 * names nothing, or its task had ended already.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function cancel(repo, queueUrl, key) {
  const queue = await repo.find(queueUrl);
  const listed = entryAt(queue.doc(), key);
  if (!listed) {
    return false;
  }
  // A task that cannot be found cannot be stopped, or run: its entry goes.
  const task = await repo.find(listed.taskUrl).catch(() => null);
  let stopped = false;
  task?.change((/** @type {Task} */ doc) => {
    stopped = stopTask(doc, { id: crypto.randomUUID(), at: Date.now() });
  });
  queue.change((/** @type {Queue} */ doc) => delistTask(doc, key, listed.taskUrl));
  await repo
    .flush([...(task ? [task.documentId] : []), queue.documentId])
    .catch(() => {});
  return stopped;
}

// Following

/**
 * A task asked for by key, as someone following it sees it.
 * @typedef {object} TaskView
 * @property {string} key
 * @property {TaskState | 'missing'} state  `missing`: the key names nothing, and this watcher never saw it name a task.
 * @property {string | null} taskUrl
 * @property {string | null} importUrl
 * @property {unknown} input
 * @property {unknown} progress  What its code last reported, while it runs. Heard, not read: null until its pool next says.
 * @property {LogLine[]} logs  The log of the run that has it, as far as it has been heard; once it has ended, of the run that ended it.
 * @property {unknown} result  Its result, once it has succeeded.
 * @property {string | null} error  Why it failed, once it has.
 * @property {Run[]} runs
 */

/**
 * Calls `onChange` with the task under `key` now, and again whenever
 * anything about it changes or is heard. It follows the key: whichever task
 * the key names, and when the key names nothing, the last task it named
 * (`from`, to begin with, if given). Returns how to stop.
 *
 * With `keep`, the watcher is someone waiting for the task: if its key comes
 * to name nothing while the task is still wanted and unheard, it is listed
 * again (see `mayRelist`).
 *
 * It reports nothing until it has the queue's document, asking for it again
 * every two seconds: what the key names can only be read there, and
 * `missing` from here always means the queue said so. A page that must say
 * something sooner about a person's own work follows it with `watchWork`.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {string} key
 * @param {(view: TaskView) => void} onChange
 * @param {{ keep?: boolean, from?: string }} [options]
 * @returns {() => void}
 */
export function watch(repo, queueUrl, key, onChange, options = {}) {
  let stopped = false;
  /** @type {any} */ let queue;
  /** @type {any} */ let task;
  /** @type {string | null} */ let following = null;
  /** @type {string | null} */ let last = options.from ?? null;
  /** @type {(() => void) | undefined} */ let unlisten;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let retry;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let lapse;
  /** @type {number | null} */ let noneSince = null;
  // What has been heard of the runs of the task followed. Each task has its
  // own: a copy of a task carries the original's runs, names and all.
  let hearing = new Hearing();
  /**
   * What has been heard from each run of the task followed, by run. Kept per
   * run because two runs can be heard at once (two pools took the task
   * together, and the later has not yet given way), and the view shows the
   * one that has the task.
   * @type {Map<string, { progress: unknown, logs: LogLine[] }>}
   */
  let said = new Map();

  /** @type {string | null} */ let reported = null;

  const report = (/** @type {unknown} */ onTimer) => {
    if (stopped) {
      return;
    }
    clearTimeout(lapse);
    /** @type {Queue | undefined} */ const jobs = queue?.doc();
    /** @type {Task | undefined} */ const doc = task?.doc();
    hearing.saw(recordsOf(doc));
    const is = following ? named(jobs, key, following) : 'none';
    if (is !== 'none') {
      noneSince = null;
    } else if (queue && noneSince === null) {
      noneSince = Date.now();
    }
    if (options.keep && following && doc && noneSince !== null) {
      if (mayRelist(doc, is, hearing.heard, noneSince, Date.now())) {
        const again = following;
        noneSince = null;
        queue.change((/** @type {Queue} */ q) =>
          listTask(q, key, { taskUrl: again, askedAt: Date.now(), package: packageOf(doc.importUrl), needs: doc.needs }),
        );
      }
    }
    const state = following ? taskState(doc, hearing.heard) : 'missing';
    // Looked at again when what is heard may have lapsed: a run that falls
    // silent changes nothing, so nothing else would bring the watcher back.
    if (following && !isFinished(state)) {
      lapse = setTimeout(report, LAPSE_MS / 4, true);
    }
    if (onTimer === true && state === reported) {
      return; // nothing has lapsed
    }
    reported = state;
    const by = endingRun(doc);
    const has = recordsOf(doc).find((run) => run.status == null && hearing.heard(run.id));
    const live = has ? said.get(has.id) : undefined;
    onChange({
      key,
      state,
      taskUrl: following,
      importUrl: doc?.importUrl ?? null,
      input: doc?.input,
      progress: live ? live.progress : null,
      logs: by ? (by.logs ?? []) : live ? live.logs : [],
      result: state === 'succeeded' ? taskResult(doc) : undefined,
      error: taskError(doc, hearing.heard),
      runs: recordsOf(doc),
    });
  };

  const changed = () => report(false);

  const unfollow = () => {
    task?.off('change', changed);
    unlisten?.();
    unlisten = undefined;
    task = undefined;
    said = new Map();
    hearing = new Hearing();
  };

  const follow = () => {
    const listed = entryAt(queue?.doc(), key);
    if (listed) {
      last = listed.taskUrl;
    }
    if (last !== following) {
      unfollow();
      following = last;
      clearTimeout(retry);
      const wanted = following;
      const load = () => {
        repo.find(wanted).then(
          (/** @type {any} */ found) => {
            if (stopped || following !== wanted) {
              return;
            }
            task = found;
            found.on('change', changed);
            unlisten = listen(found, (message) => {
              if (message?.type !== 'task progress' || typeof message.run !== 'string') {
                return;
              }
              hearing.heardFrom(message.run);
              const was = said.get(message.run);
              // anyone who can read the task can send on its channel, so lines that are not a list are not lines
              const logs = Array.isArray(message.logs) ? message.logs : [];
              said.set(message.run, {
                progress: 'progress' in message ? message.progress : was ? was.progress : null,
                logs: [...(was?.logs ?? []), ...logs].slice(-MAX_LOG_LINES),
              });
              report(false);
            });
            report(false);
          },
          () => {
            // named before it has got here: not an error so much as "not yet"
            if (!stopped && following === wanted) {
              retry = setTimeout(load, 2_000);
            }
          },
        );
      };
      if (wanted) {
        load();
      }
    }
    report(false);
  };

  const loadQueue = () => {
    repo.find(queueUrl).then(
      (/** @type {any} */ found) => {
        if (stopped) {
          return;
        }
        queue = found;
        found.on('change', follow);
        follow();
      },
      () => {
        if (!stopped) {
          retry = setTimeout(loadQueue, 2_000);
        }
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

/** What waiting for a task rejects with when it was stopped. */
const CANCELLED = 'The task was cancelled';

/**
 * Asks for a task and waits for it: resolves to its result when it succeeds,
 * rejects when it fails or is cancelled. `onProgress` hears every change on
 * the way. While it waits it keeps the task listed (see `watch`).
 * @param {any} repo
 * @param {string} queueUrl
 * @param {Ask} request
 * @param {(view: TaskView) => void} [onProgress]
 * @param {AbortSignal} [signal]  aborting it stops the task (`cancel`), and this then rejects; aborted already, nothing is asked
 * @returns {Promise<unknown>}
 */
export async function run(repo, queueUrl, request, onProgress, signal) {
  if (signal?.aborted) {
    throw new Error(CANCELLED);
  }
  const { key, taskUrl } = await ask(repo, queueUrl, request);
  return new Promise((resolve, reject) => {
    const stopIt = () => void cancel(repo, queueUrl, key).catch(() => {});
    const stop = watch(
      repo,
      queueUrl,
      key,
      (view) => {
        onProgress?.(view);
        if (!isFinished(view.state)) {
          return;
        }
        signal?.removeEventListener('abort', stopIt);
        stop();
        if (view.state === 'succeeded') {
          resolve(view.result);
        } else {
          reject(
            new Error(
              view.state === 'cancelled' ? CANCELLED : (view.error ?? 'The task failed'),
            ),
          );
        }
      },
      { keep: true, from: taskUrl },
    );
    if (signal?.aborted) {
      stopIt();
    } else {
      signal?.addEventListener('abort', stopIt, { once: true });
    }
  });
}

/**
 * A pool heard serving a queue, as it last said: what it has is only ever
 * labels, and none when it said something else.
 * @typedef {{ pool: string, name: string, slots: number, busy: number, has: string[] }} Serving
 */

/**
 * Calls `onChange` with the pools heard serving `queueUrl` within the lapse,
 * now and whenever that changes: an empty list means nobody is heard, so a
 * task asked of it would wait. A pool whose last word says it has no slots
 * has stopped serving it, and is not listed. Returns how to stop.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {(pools: Serving[]) => void} onChange
 * @returns {() => void}
 */
export function served(repo, queueUrl, onChange) {
  let stopped = false;
  /** @type {(() => void) | undefined} */ let unlisten;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  /** @type {Map<string, Serving & { at: number }>} */
  const pools = new Map();
  let reported = '';

  const report = () => {
    if (stopped) {
      return;
    }
    clearTimeout(timer);
    const now = Date.now();
    for (const [id, pool] of pools) {
      if (now - pool.at >= LAPSE_MS) {
        pools.delete(id);
      }
    }
    const list = [...pools.values()]
      .map(({ pool, name, slots, busy, has }) => ({ pool, name, slots, busy, has }))
      .sort((a, b) => (a.pool < b.pool ? -1 : 1));
    const json = JSON.stringify(list);
    if (json !== reported) {
      reported = json;
      onChange(list);
    }
    if (pools.size > 0) {
      // looked at again when the pool heard longest ago would lapse
      const oldest = Math.min(...[...pools.values()].map((pool) => pool.at));
      timer = setTimeout(report, Math.max(0, oldest + LAPSE_MS - now) + 1);
    }
  };

  const load = () => {
    repo.find(queueUrl).then(
      (/** @type {any} */ queue) => {
        if (stopped) {
          return;
        }
        unlisten = listen(queue, (message) => {
          if (message?.type !== 'serving' || typeof message.pool !== 'string') {
            return;
          }
          if (!(Number(message.slots) > 0)) {
            pools.delete(message.pool);
            report();
            return;
          }
          pools.set(message.pool, {
            pool: message.pool,
            name: String(message.name ?? ''),
            slots: Number(message.slots) || 0,
            busy: Number(message.busy) || 0,
            has: Array.isArray(message.has) ? message.has.filter((/** @type {unknown} */ label) => typeof label === 'string' && label !== '') : [],
            at: Date.now(),
          });
          report();
        });
      },
      () => {
        if (!stopped) {
          timer = setTimeout(load, 2_000);
        }
      },
    );
  };
  onChange([]);
  reported = '[]';
  load();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unlisten?.();
  };
}

// A person's queues
//
// Which queues a person's browsers serve, and which queue is their own, are
// kept in the task system's tool storage on their account: a document of its
// own that the account names under `toolStorage[TASKS_STORAGE_ID]`. Patchwork's
// frame makes that document the first time a tool asks its tool-storage
// provider for it, and links it into the account; nothing here writes the
// account. Reading goes straight off the account's map, so that only looking
// makes nothing.
//
// The storage document's root is the list. A served queue is a root key that
// is the queue's url, whose value is its setting; `own` is a root key holding
// a url. Nothing in it is a container a writer has to make first: the root is
// there from the moment the provider makes the document. So writes to
// different queues never meet, whatever the order or timing; writes to one
// queue's key keep one value, whole (Automerge keeps a value written
// alongside a delete it did not see, so a join or a new setting outlasts a
// leave made at the same moment); and two pointers written at once keep one,
// while both queues they name stay served. Keys that are not queue urls (the
// provider's `@patchwork`, `own`) are never read as queues.

/** The tool id the task system's storage is kept under on an account (`account.toolStorage[TASKS_STORAGE_ID]`). */
export const TASKS_STORAGE_ID = 'tasks-next';

/** The datatype of a queue made by the tasks package (and by `ownQueue`). */
export const QUEUE_DATATYPE_ID = 'task-queue-next';

/** The title of a queue of one's own: it is only ever shown to its owner. */
export const OWN_QUEUE_TITLE = 'My tasks';

/** How long a page waits for its frame's tool-storage provider to answer before saying there is none. */
export const PROVIDER_WAIT_MS = 5_000;

/**
 * How a served queue is listed: `true` runs any code from it; `{ packages }`
 * only code in those packages.
 * @typedef {true | { packages: string[] }} QueueSetting
 */

/**
 * The task system's storage document: each served queue's url as a key of
 * its own, holding its setting, and `own`. Write it only through `setServed`
 * and `ownQueue`; read it through `servedOf` and `ownQueueOf`.
 * @typedef {{ own?: string, [key: string]: unknown }} TasksStorage
 */

const DOCUMENT_URL = /^automerge:[1-9A-HJ-NP-Za-km-z]{16,64}$/;

/** Whether a key of the storage document names a queue: only a document's automerge url does. */
const isQueueKey = (/** @type {unknown} */ key) => typeof key === 'string' && DOCUMENT_URL.test(key);

/**
 * The url of the task system's storage document an account names, or null
 * if it names none.
 * @param {unknown} account
 * @returns {string | null}
 */
export function storageUrlOf(account) {
  const storage = /** @type {any} */ (account)?.toolStorage;
  if (!storage || typeof storage !== 'object' || !Object.hasOwn(storage, TASKS_STORAGE_ID)) {
    return null;
  }
  const url = storage[TASKS_STORAGE_ID];
  return typeof url === 'string' && url.startsWith('automerge:') ? url : null;
}

/**
 * The queues a storage document says to serve, each with its setting as it
 * is written (acceptance.ts says what a setting amounts to); none for a
 * document that is not there. Only the document's own keys that are queue
 * urls count.
 * @param {unknown} storage
 * @returns {{ [queueUrl: string]: unknown }}
 */
export function servedOf(storage) {
  if (!storage || typeof storage !== 'object') {
    return {};
  }
  return Object.fromEntries(Object.entries(storage).filter(([key]) => isQueueKey(key)));
}

/**
 * The url of the queue a storage document says is this person's own, or null.
 * @param {unknown} storage
 * @returns {string | null}
 */
export function ownQueueOf(storage) {
  const own = storage && typeof storage === 'object' && Object.hasOwn(storage, 'own') ? /** @type {any} */ (storage).own : null;
  return isQueueKey(own) ? own : null;
}

/**
 * Serves a queue with `setting`, or, given null, stops serving it: one write
 * of the queue's own root key. Call it inside a change to the storage
 * document. A setting is written as a fresh value each time, never edited in
 * place, so two settings made at once keep one of the two, whole. Throws on a
 * url that is no queue's, or a setting that is neither `true` nor a list of
 * packages, so that nothing but a queue's setting is ever written as one.
 * @param {TasksStorage} storage
 * @param {string} queueUrl
 * @param {QueueSetting | null} setting
 */
export function setServed(storage, queueUrl, setting) {
  if (!isQueueKey(queueUrl)) {
    throw new Error(`${String(queueUrl)} is not a queue's automerge: url`);
  }
  if (setting === null) {
    if (Object.hasOwn(storage, queueUrl)) {
      delete storage[queueUrl];
    }
    return;
  }
  if (setting === true) {
    storage[queueUrl] = true;
    return;
  }
  const packages = /** @type {any} */ (setting)?.packages;
  if (!Array.isArray(packages) || !packages.every((url) => typeof url === 'string')) {
    throw new Error('A queue is served for any code (true) or for a list of packages ({ packages }).');
  }
  storage[queueUrl] = { packages: [...packages] };
}

/**
 * Asks the providers above `element` for one value of `selector`, by the
 * `patchwork:subscribe` event and port that Patchwork's providers answer
 * (patchwork-providers' `accept`): resolves to the first value sent back, or
 * to undefined if nothing answers within `waitMs`. It unsubscribes either way.
 * @param {any} element
 * @param {{ type: string, [key: string]: unknown }} selector
 * @param {number} waitMs
 * @returns {Promise<unknown>}
 */
function askProvider(element, selector, waitMs) {
  return new Promise((resolve) => {
    const target = element.closest?.('patchwork-view') ?? element;
    const channel = new MessageChannel();
    const port = channel.port2;
    let done = false;
    const finish = (/** @type {unknown} */ value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        port.postMessage({ type: 'unsubscribe' });
      } catch {
        // the provider's end is closed already
      }
      port.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), waitMs);
    port.onmessage = (/** @type {MessageEvent} */ event) => {
      if (event.data?.type === 'change') {
        finish(event.data.value);
      }
    };
    port.start?.();
    target.dispatchEvent(
      new CustomEvent('patchwork:subscribe', {
        detail: { selector, port: channel.port1 },
        bubbles: true,
        composed: true,
      }),
    );
  });
}

/**
 * The handle on this person's task storage document, through `repo`, the
 * Repo the page's account is in (the site's). If the account names none
 * yet, the frame's tool-storage provider is asked for it from `element` (the
 * element a tool was mounted on), which makes it and links it into the
 * account. Rejects, having written nothing, where there is no account open
 * (outside a page, in Node) or no provider answers within PROVIDER_WAIT_MS.
 * @param {any} repo
 * @param {any} element
 * @returns {Promise<any>}  a DocHandle of {@link TasksStorage}
 */
export async function tasksStorage(repo, element) {
  const account = /** @type {any} */ (globalThis).accountDocHandle;
  if (!account || typeof element?.dispatchEvent !== 'function') {
    throw new Error('Task queues can only be kept from a Patchwork page with your account open.');
  }
  let url = storageUrlOf(account.doc());
  if (!url) {
    const answer = await askProvider(
      element,
      { type: 'patchwork:tool-storage', toolId: TASKS_STORAGE_ID },
      PROVIDER_WAIT_MS,
    );
    url = typeof answer === 'string' && answer.startsWith('automerge:') ? answer : null;
  }
  if (!url) {
    throw new Error('This page has nowhere to keep your task queues, so nothing was changed.');
  }
  try {
    return await repo.find(url);
  } catch {
    throw new Error('The list of your task queues could not be found, so nothing was changed.');
  }
}

/**
 * The url of this person's own queue, made the first time it is asked for:
 * a queue whose audience is its owner, so it is served for any code. Making
 * it is one change to the task storage (see `tasksStorage`, whose rejections
 * this passes on): the pointer `own`, if it is still unset, and the queue's
 * own key, serving it. `repo` is the Repo the page's account is in; the
 * queue is made there too.
 *
 * Two tabs or machines that make one at the same moment each make a queue,
 * serve it and set `own`. The merge keeps one pointer, the same everywhere,
 * and both queues stay served, so the pointer always names a served queue.
 * The other queue is served and empty, and nobody else has its url: its
 * maker, if it sees the other pointer before this call returns, takes it
 * back out of the list. Seen only after a later sync, it is left served and
 * empty, which costs nothing, since no task is ever asked of it. The maker
 * never takes out the queue the pointer names: the pointer it reads is the
 * one that stands among those it has seen, so the pointer that stands
 * everywhere is never beaten in its own maker's eyes. One made here while
 * this tab waited for its own to save, when another pointer arrived first,
 * is named and served by nothing, and left.
 * @param {any} repo
 * @param {any} element
 * @returns {Promise<string>}
 */
export async function ownQueue(repo, element) {
  const storage = await tasksStorage(repo, element);
  const already = ownQueueOf(storage.doc());
  if (already) {
    return already;
  }
  const queue = repo.create({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} });
  // Saved before the storage names it, so that a pool told to serve it finds it.
  await repo.flush([queue.documentId]);
  storage.change((/** @type {TasksStorage} */ doc) => {
    if (ownQueueOf(doc)) {
      return;
    }
    doc.own = queue.url;
    setServed(doc, queue.url, true);
  });
  await repo.flush([storage.documentId]).catch(() => {
    // it is saved a moment later all the same
  });
  const own = /** @type {string} */ (ownQueueOf(storage.doc()));
  if (own !== queue.url && Object.hasOwn(storage.doc(), queue.url)) {
    storage.change((/** @type {TasksStorage} */ doc) => {
      if (ownQueueOf(doc) !== queue.url) {
        setServed(doc, queue.url, null);
      }
    });
  }
  return own;
}

// Finding a document that may not have arrived
//
// A document made a moment ago on another machine reaches this one by the
// sync server. A Repo asked for it too early says it is unavailable, and
// goes on saying so each time it is asked until the document comes.

/**
 * Finds a document, asking again while the Repo says it is unavailable or
 * hands it back empty: about half a minute in all with the defaults. No one
 * asking is waited on for longer than `each`. Throws what the last try threw.
 * @param {{ find(url: string): Promise<any> }} repo
 * @param {string} url
 * @param {{ tries?: number, wait?: number, each?: number, sleep?: (ms: number) => Promise<unknown> }} [options]  tries: attempts in all; wait: ms before the first retry, doubling, at most 8 s
 * @returns {Promise<any>} the document's handle
 */
export async function findWhenThere(
  repo,
  url,
  { tries = 8, wait = 500, each = 30_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  /** @type {unknown} */
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const handle = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${url} did not arrive in ${each} ms`)), each);
        repo.find(url).then(
          (found) => (clearTimeout(timer), resolve(found)),
          (error) => (clearTimeout(timer), reject(error)),
        );
      });
      if (handle?.doc?.()) {
        return handle;
      }
      last = new Error(`${url} came back empty`);
    } catch (error) {
      last = error;
    }
    if (i + 1 < tries) {
      await sleep(Math.min(8_000, wait * 2 ** i));
    }
  }
  throw last;
}

// Having work done, from a page
//
// A tool in a page that wants work done has it done by a task asked of the
// person's own queue, or here, by importing the same code and calling it in
// the page. Either way it is the one module the import url names, called
// with (input, ctx). What differs is what the person gets. Asked of their
// queue, the work goes on when this page closes, is done once however many
// pages ask for it under one key, and a stop ends it for good. Done here it
// is this page's alone, as a tool's own work always was, and code that does
// not heed its signal runs on. Nothing is made by asking: a person has a
// queue of their own only once they have said so (`ownQueue`).
//
// Which it is, in this order:
// 1. The person's own queue is asked when a pool heard serving it has what
//    the work needs (with no needs, any pool heard).
// 2. Otherwise, work that needs nothing a page lacks (its needs are among
//    PAGE_HAS) is done here.
// 3. Otherwise it is asked of the own queue all the same, and waits there
//    for a device that has what it needs; with no own queue, it rejects with
//    a sentence naming what was needed.
// A queue is asked only for code that can travel: a file in a package kept
// in automerge, or a `data:` URL. Any other url (http://localhost while a
// tool is developed, a file: url) names code that only this machine can
// reach, so that work is done here, or, when it needs what a page lacks,
// rejected.
//
// Work asked of the queue is near this browser's pool, when the page can
// read which that is: that pool takes it at once if it may, and the others
// hold back for it.
//
// What is known where. Work asked of the person's queue is seen by every page
// of theirs: `watchWork` follows the key on that queue from any tab or
// machine, and `stopWork` stops it from any of them. Work done in a page is
// known to that page alone, through the `onProgress` of the `doWork` call
// that started it: another tab, or another tool in the same page, neither
// sees it nor can stop it, and no document says that it is going on.

/** What a page has, as a pool's labels: work that needs only these can be done in it. */
export const PAGE_HAS = ['browser'];

/**
 * Where a browser profile keeps its pool's id, in localStorage. The pool's
 * host writes it; a page reads it to say which pool it is next to.
 */
export const POOL_ID_KEY = 'patchwork-tasks-pool-id';

/**
 * This browser profile's pool id, if this page can read one; null outside a
 * browser, before any pool has started here, or where localStorage cannot be
 * used.
 * @returns {string | null}
 */
function browserPoolIdHere() {
  try {
    const id = /** @type {any} */ (globalThis).localStorage?.getItem(POOL_ID_KEY);
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/**
 * The pools heard serving the queues this page has had work done on, by Repo
 * and queue, with until when the first listening lasts and who waits on a
 * change. Each queue is listened to from the first asking for as long as the
 * page lives, so that only an asking within a beat of the first waits to hear.
 * @type {WeakMap<object, Map<string, { pools: Serving[], until: number, changed: Set<() => void> }>>}
 */
const heardServing = new WeakMap();

/**
 * The pools heard serving a queue, as soon as one of them has what `needs`
 * asks for, or else once this page has listened to the queue for a beat and
 * a little: at once if it has already.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {string[]} needs
 * @returns {Promise<Serving[]>}
 */
function poolsHeard(repo, queueUrl, needs) {
  let queues = heardServing.get(repo);
  if (!queues) {
    heardServing.set(repo, (queues = new Map()));
  }
  let state = queues.get(queueUrl);
  if (!state) {
    const made = { pools: /** @type {Serving[]} */ ([]), until: Date.now() + BEAT_MS + 500, changed: new Set() };
    queues.set(queueUrl, (state = made));
    served(repo, queueUrl, (pools) => {
      made.pools = pools;
      for (const changed of [...made.changed]) {
        changed();
      }
    });
  }
  const heard = state;
  return new Promise((resolve) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const look = () => {
      if (heard.pools.some((pool) => satisfies(pool.has, needs)) || Date.now() >= heard.until) {
        heard.changed.delete(look);
        clearTimeout(timer);
        resolve(heard.pools);
      }
    };
    heard.changed.add(look);
    timer = setTimeout(look, Math.max(0, heard.until - Date.now()));
    look();
  });
}

/**
 * The url of the person's own queue as their storage says now, or null: no
 * account open, no storage, no queue of their own, or a storage document that
 * cannot be had. Only reads.
 * @param {any} repo
 * @returns {Promise<string | null>}
 */
async function ownQueueNow(repo) {
  const storageUrl = storageUrlOf(/** @type {any} */ (globalThis).accountDocHandle?.doc?.());
  if (!storageUrl) {
    return null;
  }
  return repo.find(storageUrl).then(
    (/** @type {any} */ storage) => ownQueueOf(storage.doc()),
    () => null,
  );
}

/**
 * The person's own queue, if they have one, with the pools heard serving it
 * (see `poolsHeard`); null when they have none. Only reads.
 * @param {any} repo
 * @param {string[]} needs
 * @returns {Promise<{ url: string, pools: Serving[] } | null>}
 */
async function ownQueueHeard(repo, needs) {
  const url = await ownQueueNow(repo);
  return url ? { url, pools: await poolsHeard(repo, url, needs) } : null;
}

/**
 * Whether a pool on another machine can import this code: a file in a
 * package kept in automerge, or a `data:` URL.
 * @param {string} importUrl
 */
const travels = (importUrl) => parseAutomergeImport(importUrl) !== null || /^data:/i.test(importUrl);

/**
 * What a person reads when work needs a device: "a device with unix and
 * ollama"; a `pool:` need is one particular device.
 * @param {string[]} needs
 */
function deviceWords(needs) {
  const labels = needs.filter((need) => !need.startsWith('pool:'));
  const listed = labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  if (labels.length === needs.length) {
    return `a device with ${listed}`;
  }
  return labels.length > 0 ? `one particular device, with ${listed}` : 'one particular device';
}

/**
 * Has work done, as the comment above says: asked of the person's own queue
 * (as `run`), or done here. Resolves to what the code returned; rejects with
 * what it threw, or "The task was cancelled" once `signal` is aborted, or,
 * for work that needs what neither this page nor any queue of theirs can
 * give it, with a sentence saying what it needs. `onProgress` hears the same
 * views either way (one for work done here has no `taskUrl` and no `runs`).
 * Aborted while it still listens for a pool, it rejects at once and neither
 * asks nor calls anything.
 * @param {any} repo  the Repo the page's account is in
 * @param {Ask} request
 * @param {{ onProgress?: (view: TaskView) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<unknown>}
 */
export async function doWork(repo, request, { onProgress, signal } = {}) {
  if (signal?.aborted) {
    throw new Error(CANCELLED);
  }
  const needs = request.needs ?? [];
  checkNeeds(needs);
  const travel = travels(request.importUrl);
  const own = travel ? await unlessStopped(ownQueueHeard(repo, needs).catch(() => null), signal) : null;
  const asked = { ...request, near: request.near ?? browserPoolIdHere() ?? undefined };
  if (own && own.pools.some((pool) => satisfies(pool.has, needs))) {
    return run(repo, own.url, asked, onProgress, signal);
  }
  if (satisfies(PAGE_HAS, needs)) {
    return workHere(repo, request, onProgress, signal);
  }
  if (own) {
    return run(repo, own.url, asked, onProgress, signal);
  }
  throw new Error(
    travel
      ? `This work needs ${deviceWords(needs)}, and you have no task queue for such a device to serve.`
      : `This work needs ${deviceWords(needs)}, and its code is only on this machine, so no other device can run it.`,
  );
}

/**
 * What `promise` resolves to, or a rejection with "The task was cancelled"
 * as soon as `signal` aborts, whichever comes first.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<T>}
 */
function unlessStopped(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error(CANCELLED));
    signal?.addEventListener('abort', stop, { once: true });
    promise.then((found) => {
      signal?.removeEventListener('abort', stop);
      resolve(found);
    });
  });
}

/**
 * Calls `onChange` with the work under `key` as this page can know it, now
 * and whenever that changes: the task under the key on the person's own
 * queue, as `watch` gives it. The account's pointer to the task system's
 * storage, that document and its `own` are followed as they change, since
 * the person may make their queue, or lose it, while a tool is open.
 *
 * Its state is `missing` when no work under this key is known on a queue of
 * this person's: no account is open, it has no storage, the storage names no
 * queue of their own, the key names nothing there, or that queue's document
 * has not been had. Work done in a page is never seen here (see above). It
 * always reports promptly: what cannot be told at once (no account, no
 * storage, no own queue) is reported at once, and a document not had within
 * LAPSE_MS is reported `missing` and looked for still, its work reported when
 * it comes. When the queue it watches changes, what was reported of the old
 * one is replaced by `missing` at once.
 *
 * The account is the page's (`accountDocHandle`), read when watching starts.
 * Returns how to stop; nothing is left behind once it is called.
 * @param {any} repo  the Repo the page's account is in
 * @param {string} key
 * @param {(view: TaskView) => void} onChange
 * @returns {() => void}
 */
export function watchWork(repo, key, onChange) {
  let stopped = false;
  const account = /** @type {any} */ (globalThis).accountDocHandle;
  /** @type {string | null} */ let storageUrl = null;
  /** @type {any} */ let storage;
  /** @type {string | null} */ let queueUrl = null;
  /** @type {(() => void) | undefined} */ let unwatch;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let retry;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let lapse;
  // The queue being watched now (a fresh object for each watch), and the
  // watch the last report came from: null before any report, NONE when it
  // was a `missing` made here.
  const NONE = {};
  /** @type {object | null} */ let current = null;
  /** @type {object | null} */ let said = null;
  let lastMissing = false;

  // Every `missing` view is the same, whoever made it, so one is reported
  // until something else is.
  /** @param {TaskView} view */
  const report = (view) => {
    clearTimeout(lapse);
    lapse = undefined;
    if (view.state === 'missing' && lastMissing) {
      return;
    }
    lastMissing = view.state === 'missing';
    onChange(view);
  };

  const missing = () => {
    if (stopped) {
      return;
    }
    said = NONE;
    report({ key, state: 'missing', taskUrl: null, importUrl: null, input: undefined, progress: null, logs: [], result: undefined, error: null, runs: [] });
  };

  const look = () => {
    if (stopped) {
      return;
    }
    const nextStorage = storageUrlOf(account?.doc?.());
    if (nextStorage !== storageUrl) {
      storage?.off('change', look);
      storage = undefined;
      clearTimeout(retry);
      storageUrl = nextStorage;
      if (storageUrl) {
        loadStorage(storageUrl);
      }
    }
    const nextQueue = storage ? ownQueueOf(storage.doc()) : null;
    if (nextQueue !== queueUrl) {
      unwatch?.();
      unwatch = undefined;
      current = null;
      queueUrl = nextQueue;
      if (queueUrl) {
        const source = (current = {});
        unwatch = watch(repo, queueUrl, key, (view) => {
          if (!stopped && current === source) {
            said = source;
            report(view);
          }
        });
      }
    }
    if (!storageUrl || (storage && !queueUrl)) {
      missing();
    } else if (!storage || said !== current) {
      // The storage or the queue is still being found. Before anything has
      // been reported, that is waited for up to the lapse; after, what was
      // reported came from a queue no longer watched, so it is withdrawn now.
      if (said !== null) {
        missing();
      } else {
        lapse ??= setTimeout(missing, LAPSE_MS);
      }
    }
  };

  /** @param {string} url */
  const loadStorage = (url) => {
    repo.find(url).then(
      (/** @type {any} */ found) => {
        if (stopped || storageUrl !== url || storage) {
          return;
        }
        storage = found;
        found.on('change', look);
        look();
      },
      () => {
        // not here yet, or not reachable now: asked again, as `watch` asks for a queue
        if (!stopped && storageUrl === url) {
          retry = setTimeout(() => loadStorage(url), 2_000);
        }
      },
    );
  };

  account?.on?.('change', look);
  look();

  return () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(lapse);
    account?.off?.('change', look);
    storage?.off('change', look);
    unwatch?.();
  };
}

/**
 * Stops the work under `key` on the person's own queue, as `cancel` does.
 * False when there is none to stop: no queue of their own, nothing under the
 * key, a task that had ended already, or a queue that cannot be had now.
 * @param {any} repo  the Repo the page's account is in
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function stopWork(repo, key) {
  const queueUrl = await ownQueueNow(repo);
  return queueUrl ? cancel(repo, queueUrl, key).catch(() => false) : false;
}

/**
 * Does work in this page: imports the code and calls it with a context like
 * a pool's, but for `taskUrl`, since there is no task. Aborting `signal`
 * rejects at once, as a stop does for work asked of a queue; the code is
 * told through its own signal, and anything it reports after that is not
 * passed on, since the work has ended for whoever asked.
 * @param {any} repo
 * @param {Ask} request
 * @param {((view: TaskView) => void) | undefined} onProgress
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<unknown>}
 */
async function workHere(repo, { importUrl, input, key }, onProgress, signal) {
  if (signal?.aborted) {
    throw new Error(CANCELLED);
  }
  /** @type {LogLine[]} */
  const logs = [];
  /** @type {unknown} */
  let progress = null;
  let over = false;
  const say = (/** @type {TaskState} */ state, /** @type {Partial<TaskView>} */ more = {}) => {
    if (over) {
      return;
    }
    over = isFinished(state);
    onProgress?.({
      key: key ?? '',
      state,
      taskUrl: null,
      importUrl,
      input,
      progress,
      logs: [...logs],
      result: undefined,
      error: null,
      runs: [],
      ...more,
    });
  };
  const stopped = new AbortController();
  /** @type {Promise<never>} */
  const cancelled = new Promise((_, reject) => {
    stopped.signal.addEventListener('abort', () => reject(new Error(CANCELLED)), { once: true });
  });
  const stopIt = () => stopped.abort('cancelled');
  signal?.addEventListener('abort', stopIt, { once: true });
  const context = {
    log(/** @type {unknown[]} */ ...args) {
      if (over) {
        return;
      }
      logs.push({ timestampMillis: Date.now(), message: args.map((arg) => '' + arg).join(' ') });
      logs.splice(0, logs.length - MAX_LOG_LINES);
      say('running');
    },
    progress(/** @type {unknown} */ value) {
      if (over) {
        return;
      }
      progress = value;
      say('running');
    },
    signal: stopped.signal,
    repo,
    taskUrl: null,
    key: key ?? null,
    run: crypto.randomUUID(),
  };
  say('running');
  const work = (async () => {
    const module = await import(/* @vite-ignore */ importUrl);
    if (typeof module?.default !== 'function') {
      throw new Error("the task's code has no default export to call");
    }
    return copy(await module.default.call(context, copy(input), context));
  })();
  // what the code does once it has been stopped is nobody's concern
  work.catch(() => {});
  try {
    const result = await Promise.race([work, cancelled]);
    say('succeeded', { result });
    return result;
  } catch (error) {
    if (stopped.signal.aborted) {
      say('cancelled');
      throw new Error(CANCELLED);
    }
    const message = /** @type {any} */ (error)?.message ?? '' + error;
    logs.push({ timestampMillis: Date.now(), message });
    say('failed', { error: message });
    throw new Error(message);
  } finally {
    signal?.removeEventListener('abort', stopIt);
  }
}
