/**
 * task-client.js — asking a queue for a task, stopping it, and following what becomes of it.
 *
 * Everything here is a read or a write of a queue's document and a task's
 * document, or listening on their channels; nothing is sent to anyone. So it
 * works from any Repo that can reach those documents, in a page, a worker or
 * Node, whether or not a pool runs on the same machine. The rules it applies
 * are task-rules.js's. Other packages get both from the registry (client.js).
 *
 * It also holds how the task system's messages travel (`send`, `listen`),
 * because hearing them is half of following a task; and, for a page, where
 * a person's list of served queues and their own queue are kept, made and
 * folded (`ownQueue`, `tasksStorage`, `fold`), and how a tool there has work
 * done and follows and stops it (`doWork`, `watchWork`, `stopWork`).
 */

import {
  LAPSE_MS,
  MAX_LOG_LINES,
  NOT_HAD,
  checkKey,
  checkNeeds,
  delistTask,
  endingRun,
  entryAt,
  foldStep,
  Hearing,
  isFinished,
  isWanted,
  listTask,
  mayRelist,
  named,
  recordsOf,
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
 * it has and how many are busy, and what it has (see `satisfies`). No slots
 * means it is not taking: a pool says so while it is still listening to the
 * queue (its first LISTEN_MS there), and last, as it stops or stops serving it.
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
 * by either route, or, with `local: false`, only by the handle's own (what
 * reaches its Repo, by the sync server). Other tools broadcast on the same
 * documents (presence, for one); what they send carries no stamp and is not
 * passed on. Returns how to stop.
 * @param {any} handle  a DocHandle
 * @param {(message: any) => void} onMessage
 * @param {{ local?: boolean }} [options]
 * @returns {() => void}
 */
export function listen(handle, onMessage, { local = true } = {}) {
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
  if (local) {
    localChannel();
    localListeners.add(onLocal);
  }
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
      { taskUrl: task.url, askedAt: Date.now(), needs: needs ?? [], near: near ?? undefined },
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
          listTask(q, key, { taskUrl: again, askedAt: Date.now(), needs: doc.needs }),
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

/** What waiting for a task (`doWork`, `run`) rejects with when it was stopped. */
export const CANCELLED = 'The task was cancelled';

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
 * is not taking (it has only begun to listen to the queue, or has stopped
 * serving it), and is not listed. With `local: false`, only what reaches
 * `repo` itself is heard (see `listen`). Returns how to stop.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {(pools: Serving[]) => void} onChange
 * @param {{ local?: boolean }} [options]
 * @returns {() => void}
 */
export function served(repo, queueUrl, onChange, options = {}) {
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
        unlisten = listen(
          queue,
          (message) => {
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
          },
          options,
        );
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
// is the queue's url, holding `true`; `own` is a root key holding
// a url; and `own:<queueUrl>`, holding `true`, marks a queue made to be one's
// own. Nothing in it is a container a writer has to make first: the root is
// there from the moment the provider makes the document. So writes to
// different queues never meet, whatever the order or timing; writes to one
// queue's key keep one value, whole (Automerge keeps a value written
// alongside a delete it did not see, so a join outlasts a
// leave made at the same moment). Keys that are not queue urls (the
// provider's `@patchwork`, `own`, the marks) are never read as queues.
//
// Own. `own` is written only by a making that sees none, in one change with
// the new queue's mark and its url key (serving it for any code), and
// nothing ever deletes or rewrites `own` or a mark. So every write of `own`
// is concurrent with every other, and the one that stands is Automerge's
// winner among them, the same on every replica that has the same changes;
// a replica that has a mark has the write of `own` made with it, so the own
// it reads is never one that loses to a mark it has. A making that sees a
// pointer to a queue whose document this Repo does not have makes a queue
// of its own, with its mark and url key and no pointer, and uses that until
// own's document comes. Every marked queue that is not own is a SPARE: it
// stays served by its url key, so what it lists runs whether or not it has
// been folded, and `fold` moves what it lists into own (FOLDING in
// task-rules.js).

/** The tool id the task system's storage is kept under on an account (`account.toolStorage[TASKS_STORAGE_ID]`). */
export const TASKS_STORAGE_ID = 'tasks-next';

/** The datatype of a queue made by the tasks package (and by `ownQueue`). */
export const QUEUE_DATATYPE_ID = 'task-queue-next';

/** The title of a queue of one's own: it is only ever shown to its owner. */
export const OWN_QUEUE_TITLE = 'My tasks';

/** How long a page waits for its frame's tool-storage provider to answer before saying there is none. */
export const PROVIDER_WAIT_MS = 5_000;

/**
 * The task system's storage document: each served queue's url as a key of
 * its own, holding `true`, `own`, and a mark `own:<queueUrl>` for each
 * queue made to be one's own. Write it only through `setServed`, `ownQueue`
 * and `mergeStorages` (helpers.ts); read it through `servedOf`, `ownQueueOf`,
 * `marksOf` and `sparesOf`.
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
 * The queues a storage document says to serve, each under the value it is
 * written with (any truthy one serves it); none for a document that is not
 * there. Only the document's own keys that are queue
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

const MARK = 'own:';

/**
 * The key that marks a queue as made to be one's own: `own:<queueUrl>`.
 * @param {string} queueUrl
 */
export const markOf = (queueUrl) => `${MARK}${queueUrl}`;

/**
 * The queues a storage document marks as made to be one's own, in the order
 * of their urls: each key `own:<queueUrl>` of the document's own that holds
 * `true` and names a queue url. None for a document that is not there.
 * @param {unknown} storage
 * @returns {string[]}
 */
export function marksOf(storage) {
  if (!storage || typeof storage !== 'object') {
    return [];
  }
  return Object.keys(storage)
    .filter((key) => key.startsWith(MARK) && /** @type {any} */ (storage)[key] === true && isQueueKey(key.slice(MARK.length)))
    .map((key) => key.slice(MARK.length))
    .sort();
}

/**
 * The spares a storage document has: every marked queue but own, in the
 * order of their urls. Each stays served by its own key, and is folded into own.
 * @param {unknown} storage
 * @returns {string[]}
 */
export function sparesOf(storage) {
  const own = ownQueueOf(storage);
  return marksOf(storage).filter((url) => url !== own);
}

/**
 * Serves a queue (`true`), or, given null, stops serving it: one write of the
 * queue's own root key. Call it inside a change to the storage document.
 * Throws on a url that is no queue's, so that nothing but a queue is ever
 * written as one.
 * @param {TasksStorage} storage
 * @param {string} queueUrl
 * @param {true | null} setting
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
  storage[queueUrl] = true;
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

/** The first tool-storage provider in this page, as a frame mounts it, or null (outside a page, or a page with none). */
function firstProvider() {
  return /** @type {any} */ (globalThis).document?.querySelector?.('patchwork-view[component="patchwork-tool-storage-provider"]') ?? null;
}

const PAGE_ONLY = 'Task queues can only be kept from a Patchwork page with your account open.';
const NOWHERE = 'This page has nowhere to keep your task queues, so nothing was changed.';

/**
 * The handle on this person's task storage document, through `repo`, the
 * Repo the page's account is in (the site's). The url the account names is
 * read first. If it names none yet, the frame's tool-storage provider is
 * asked for it, from `element` (the element a tool was mounted on) or, with
 * no element, from the first provider in the page; the provider makes it
 * and links it into the account. The document is found as `findWhenThere`
 * finds one, which waits for it while it has not arrived. Rejects, having
 * written nothing, where there is no account open (outside a page, in Node),
 * where no provider answers within PROVIDER_WAIT_MS (or the page has none),
 * or where the document never comes.
 * @param {any} repo
 * @param {any} [element]
 * @returns {Promise<any>}  a DocHandle of {@link TasksStorage}
 */
export async function tasksStorage(repo, element) {
  const account = /** @type {any} */ (globalThis).accountDocHandle;
  if (!account) {
    throw new Error(PAGE_ONLY);
  }
  let url = storageUrlOf(account.doc?.());
  if (!url) {
    const asker = typeof element?.dispatchEvent === 'function' ? element : firstProvider();
    if (!asker) {
      throw new Error(/** @type {any} */ (globalThis).document ? NOWHERE : PAGE_ONLY);
    }
    const answer = await askProvider(asker, { type: 'patchwork:tool-storage', toolId: TASKS_STORAGE_ID }, PROVIDER_WAIT_MS);
    url = typeof answer === 'string' && answer.startsWith('automerge:') ? answer : null;
  }
  if (!url) {
    throw new Error(NOWHERE);
  }
  const handle = await findWhenThere(repo, url).catch(() => null);
  if (!handle) {
    throw new Error('The list of your task queues could not be found, so nothing was changed.');
  }
  return handle;
}

/**
 * How long this Repo is given to produce a document from what it keeps
 * before the document is taken as not here: what loading it from this
 * browser's storage takes, with room to spare. Nothing here waits longer on
 * a document that has to come over the network.
 */
export const HERE_MS = 1_000;

/**
 * The handle on a document if `repo` has it, or produces it within HERE_MS;
 * otherwise null. The find goes on after that, and a later asking may have it.
 * @param {any} repo
 * @param {string} url
 * @returns {Promise<any | null>}
 */
function findHere(repo, url) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), HERE_MS);
    Promise.resolve()
      .then(() => repo.find(url))
      .then(
        (/** @type {any} */ handle) => {
          clearTimeout(timer);
          resolve(handle?.doc?.() ? handle : null);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
  });
}

/**
 * How long this Repo's own storage is waited on, once HERE_MS has passed, for
 * a document it is still reading: a document kept here but slow to load (a
 * cold start) is not taken as not here. Storage that has not answered by then
 * is taken as not having it.
 */
const LOAD_MS = 30_000;

/**
 * The handle on a document this Repo keeps: as `findHere`, except that a
 * document this Repo's storage is still reading when HERE_MS has passed is
 * waited for until the storage answers (no longer than LOAD_MS). So null
 * means that this Repo's storage does not have it, not only that loading it
 * is slow. A Repo that does not say what its storage is doing (one that keeps
 * nothing, or reports no `storage` source on `findWithProgress`) is given
 * HERE_MS, as `findHere` gives it. Nothing here waits on the network.
 * @param {any} repo
 * @param {string} url
 * @returns {Promise<any | null>}
 */
async function findKept(repo, url) {
  const handle = await findHere(repo, url);
  if (handle) {
    return handle;
  }
  /** @type {any} */
  let query = null;
  try {
    query = repo.findWithProgress?.(url) ?? null;
  } catch {
    query = null;
  }
  if (typeof query?.peek !== 'function' || typeof query?.subscribe !== 'function') {
    return null;
  }
  return new Promise((resolve) => {
    let answered = false;
    /** @type {() => void} */
    let unsubscribe = () => {};
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const answer = (/** @type {any} */ found) => {
      if (answered) {
        return;
      }
      answered = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(found);
    };
    const look = (/** @type {any} */ state) => {
      if (state?.state === 'ready') {
        answer(state.handle?.doc?.() ? state.handle : null);
      } else if (state?.sources?.storage !== 'pending') {
        answer(null);
      }
    };
    timer = setTimeout(() => answer(null), LOAD_MS);
    unsubscribe = query.subscribe(look);
    look(query.peek());
  });
}

/**
 * A new queue of one's own in `repo`, saved there before anything names it,
 * unless this Repo's storage has not answered within LOAD_MS: it is named
 * then all the same, as a storage that answers nothing keeps nothing anyway.
 * @param {any} repo
 */
async function newOwnQueue(repo) {
  const queue = repo.create({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  await Promise.race([
    repo.flush([queue.documentId]).catch(() => {
      // it is saved a moment later all the same
    }),
    new Promise((resolve) => (timer = setTimeout(resolve, LOAD_MS))),
  ]);
  clearTimeout(timer);
  return queue;
}

/**
 * The makings going on in this copy of the client, by Repo and storage
 * document: one at a time for each, and whoever asks meanwhile shares it.
 * @type {WeakMap<object, Map<string, Promise<string>>>}
 */
const makings = new WeakMap();

/**
 * The url of a queue of this person's own that this Repo holds: own, made
 * the first time anything asks for it. Nobody presses anything: a page
 * asking for work, the pool's background component and the badge all ask.
 * `repo` is the Repo the page's account is in; the queue is made there too.
 * `element` is where to ask the frame for the task storage when the account
 * names none yet (see `tasksStorage`, whose rejections are the only ones
 * this passes on: no account open, or nowhere to keep the storage).
 *
 * With no `own`, it makes a queue and, in one change, writes `own`, the
 * queue's mark and its url key (serving it for any code), unless the change
 * finds an `own` there already, written meanwhile by another copy of this
 * client on the same Repo, or arrived from another replica as this one saved
 * its queue: then it writes nothing, and the queue it made is named, served
 * and asked by nothing, unless it is needed as the spare below. With an
 * `own` whose document this Repo has, that is the answer, and so is one its
 * storage is still reading: that is waited for until the storage answers
 * (`findKept`), and makes nothing. With an `own` whose document it does not
 * have (made on another device, and not yet here), the answer is a spare
 * this Repo holds (had, or being read from its storage), or else a queue
 * made here with its mark and its url key and no pointer, which is folded
 * into own once own's document comes. None of it waits on the network: it
 * writes in this Repo and resolves.
 *
 * Each call also starts a pass that folds every spare into own (`fold`), not
 * waited for; a pass that fails is done again by the next.
 * @param {any} repo
 * @param {any} [element]
 * @returns {Promise<string>}
 */
export async function ownQueue(repo, element) {
  return ownIn(repo, await tasksStorage(repo, element));
}

/**
 * `ownQueue`, given the storage document's handle.
 * @param {any} repo
 * @param {any} storage
 * @returns {Promise<string>}
 */
function ownIn(repo, storage) {
  let going = makings.get(repo);
  if (!going) {
    makings.set(repo, (going = new Map()));
  }
  const mine = going;
  let making = mine.get(storage.url);
  if (!making) {
    making = settleOwn(repo, storage).finally(() => mine.delete(storage.url));
    mine.set(storage.url, making);
  }
  return making;
}

/**
 * @param {any} repo
 * @param {any} storage  the storage document's handle
 * @returns {Promise<string>}
 */
async function settleOwn(repo, storage) {
  /** A queue made here that the storage does not name: it is made the spare, if one is needed. */
  let unnamed = null;
  if (!ownQueueOf(storage.doc())) {
    const queue = await newOwnQueue(repo);
    storage.change((/** @type {TasksStorage} */ doc) => {
      if (ownQueueOf(doc)) {
        return;
      }
      doc.own = queue.url;
      doc[markOf(queue.url)] = true;
      setServed(doc, queue.url, true);
    });
    unnamed = ownQueueOf(storage.doc()) === queue.url ? null : queue;
  }
  const own = /** @type {string} */ (ownQueueOf(storage.doc()));
  const found = (await findKept(repo, own)) ? own : await spareHere(repo, storage, unnamed);
  if (sparesOf(storage.doc()).length > 0) {
    foldSoon(repo, storage);
  }
  return found;
}

/**
 * A spare this Repo holds, or else a new one: a queue with its mark and its
 * url key, and no pointer (the queue `unnamed`, when this making made one
 * that nothing names). The change that marks it first looks at the marks
 * again: a spare marked meanwhile (by another copy of this client on the
 * same Repo, or arrived from another replica) is looked at before anything
 * is written, so two copies asking at once mark one spare, and the queue
 * the second made is left unnamed, as a second making of own leaves its own.
 * @param {any} repo
 * @param {any} storage
 * @param {any} unnamed
 * @returns {Promise<string>}
 */
async function spareHere(repo, storage, unnamed) {
  /** The spares looked at already, and not had here. */
  const seen = new Set();
  for (;;) {
    const spares = sparesOf(storage.doc()).filter((url) => !seen.has(url));
    const held = await Promise.all(spares.map((url) => findKept(repo, url)));
    const spare = spares.find((_, i) => held[i]);
    if (spare) {
      return spare;
    }
    for (const url of spares) {
      seen.add(url);
    }
    const queue = (unnamed ??= await newOwnQueue(repo));
    let marked = false;
    storage.change((/** @type {TasksStorage} */ doc) => {
      if (sparesOf(doc).some((url) => !seen.has(url))) {
        return;
      }
      doc[markOf(queue.url)] = true;
      setServed(doc, queue.url, true);
      marked = true;
    });
    if (marked) {
      return queue.url;
    }
  }
}

/**
 * The folding passes going on in this copy of the client, by Repo and
 * storage document, each with whether another was asked for meanwhile.
 * @type {WeakMap<object, Map<string, { again: boolean }>>}
 */
const passes = new WeakMap();

/**
 * Starts a pass that folds every spare into own, unless one is going on for
 * this Repo and storage document: then that one is followed by another.
 * @param {any} repo
 * @param {any} storage
 */
function foldSoon(repo, storage) {
  let going = passes.get(repo);
  if (!going) {
    passes.set(repo, (going = new Map()));
  }
  const mine = going;
  const pass = mine.get(storage.url);
  if (pass) {
    pass.again = true;
    return;
  }
  const state = { again: false };
  mine.set(storage.url, state);
  /** @returns {Promise<void>} */
  const next = () =>
    fold(repo, storage)
      .catch(() => {
        // done again by the next pass
      })
      .then(() => {
        if (state.again) {
          state.again = false;
          return next();
        }
        mine.delete(storage.url);
      });
  void next();
}

/**
 * One pass of folding (FOLDING in task-rules.js): for each spare the
 * storage document marks, each key it lists, in turn, the step `foldStep`
 * gives. Own is the one the storage names as the pass begins; its document
 * is waited for as `findWhenThere` waits, and a spare whose document this
 * Repo does not hold is left for a later pass. For each key, the task the
 * spare's entry names and, when own's entry names another, that one too are
 * fetched (as `findHere` does: a task not had is NOT_HAD); then, in one
 * synchronous turn, the two entries and the two tasks are read afresh, and
 * the step is applied unless an entry changed meanwhile or the storage names
 * another own by then (a later pass folds into that one).
 *
 * Nothing it does depends on doing it once: two passes at once, on one Repo
 * or on two, apply steps that each leave nothing for the other to do.
 * Resolves when the pass is over; rejects only when own's document never
 * comes.
 * @param {any} repo
 * @param {any} storage  the storage document's handle
 * @returns {Promise<void>}
 */
export async function fold(repo, storage) {
  const own = ownQueueOf(storage.doc());
  if (!own || sparesOf(storage.doc()).length === 0) {
    return;
  }
  const into = await findWhenThere(repo, own);
  for (const spare of sparesOf(storage.doc())) {
    if (ownQueueOf(storage.doc()) !== own) {
      return;
    }
    const from = await findHere(repo, spare);
    if (from) {
      await foldQueue(repo, storage, own, from, into);
    }
  }
}

/** Whether two entries read at two moments are the same. */
const sameEntry = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param {any} repo
 * @param {any} storage
 * @param {string} own
 * @param {any} from  the spare's handle
 * @param {any} into  own's handle
 */
async function foldQueue(repo, storage, own, from, into) {
  for (const key of Object.keys(from.doc()?.jobs ?? {})) {
    const spareEntry = entryAt(from.doc(), key);
    if (!spareEntry) {
      continue;
    }
    const ownEntry = entryAt(into.doc(), key);
    const other = ownEntry && ownEntry.taskUrl !== spareEntry.taskUrl ? ownEntry.taskUrl : null;
    const [task, otherTask] = await Promise.all([findHere(repo, spareEntry.taskUrl), other ? findHere(repo, other) : null]);
    // From here to the change, one synchronous turn.
    if (ownQueueOf(storage.doc()) !== own) {
      return;
    }
    const p = entryAt(from.doc(), key);
    const o = entryAt(into.doc(), key);
    if (!sameEntry(p, spareEntry) || !sameEntry(o, ownEntry)) {
      continue;
    }
    const step = foldStep(p, task?.doc() ?? NOT_HAD, o, other ? (otherTask?.doc() ?? NOT_HAD) : NOT_HAD);
    if (step === 'drop') {
      from.change((/** @type {Queue} */ doc) => delistTask(doc, key, /** @type {any} */ (p).taskUrl));
    } else if (step === 'adopt') {
      from.change((/** @type {Queue} */ doc) => listTask(doc, key, /** @type {any} */ (o), /** @type {any} */ (p).taskUrl));
    } else if (step === 'list') {
      into.change((/** @type {Queue} */ doc) => listTask(doc, key, /** @type {any} */ (p), o?.taskUrl));
    }
  }
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
// A tool in a page that wants work done asks the person's own queue for it,
// which `ownQueue` makes if there is none, and puts this page in its
// browser's pool if nothing has (`joinPool`), so that a pool there serves
// that queue. It never imports the code itself: whatever runs it is a pool.
// So the work goes on when this page closes, is done once however many
// pages ask for it under one key, a stop ends it for good, and every page of
// the person's sees it (`watchWork`) and can stop it (`stopWork`), from any
// tab or machine.
//
// Work asked of the queue is near this browser's pool, when the page can
// read which that is: that pool takes it at once if it may, and the others
// hold back for it. A pool on another machine can run only code that
// travels: a file in a package kept in automerge, or a `data:` URL. Any other
// url (http://localhost while a tool is developed, a file: url) names code
// that only this machine can reach, so that work is asked with the need
// `pool:<this browser's pool id>`, and only this browser's pool takes it.
//
// Nothing here listens for pools before asking. A page that does not hold
// its browser's pool does not hear the pool through its own Repo (the pool's
// messages reach another tab only on the task system's own channel), but
// what it writes reaches the tab that holds the pool, through the database
// and the heads channel the site's Repos share; so the queue is asked
// whoever is heard, and work that no pool serving it can take waits there
// until one can.

/**
 * Where a browser profile keeps its pool's id, in localStorage. The pool's
 * host writes it, keeping any id that is there already; a page reads it to
 * say which pool it is next to, and writes one only for work whose code
 * cannot travel, before any pool has started here.
 */
export const POOL_ID_KEY = 'patchwork-tasks-pool-id';

/**
 * This browser profile's pool id, if this page can read one; with `make`,
 * one is made and kept under POOL_ID_KEY first if there is none, as the
 * pool's host makes it, which then keeps it. Null outside a browser, where
 * localStorage cannot be used, or, without `make`, before any pool has
 * started here.
 * @param {{ make?: boolean }} [options]
 * @returns {string | null}
 */
function browserPoolIdHere({ make = false } = {}) {
  try {
    const storage = /** @type {any} */ (globalThis).localStorage;
    if (make && storage && !storage.getItem(POOL_ID_KEY)) {
      storage.setItem(POOL_ID_KEY, crypto.randomUUID());
    }
    const id = storage?.getItem(POOL_ID_KEY);
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Whether this page can read the browser's pool id, or keep one: its
 * localStorage is there and reads. Writes nothing.
 * @returns {boolean}
 */
function poolIdsKeptHere() {
  try {
    const storage = /** @type {any} */ (globalThis).localStorage;
    if (!storage) {
      return false;
    }
    storage.getItem(POOL_ID_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The person's queues this Repo holds now: own and every spare, of those the
 * storage document marks, whose documents it has (as `findHere` has them).
 * None with no account open, no storage, or a storage document not had.
 * Only reads.
 * @param {any} repo
 * @returns {Promise<string[]>}
 */
async function queuesHere(repo) {
  const storageUrl = storageUrlOf(/** @type {any} */ (globalThis).accountDocHandle?.doc?.());
  const storage = storageUrl ? await findHere(repo, storageUrl) : null;
  if (!storage) {
    return [];
  }
  const own = ownQueueOf(storage.doc());
  const urls = [...(own ? [own] : []), ...sparesOf(storage.doc())];
  const held = await Promise.all(urls.map((url) => findHere(repo, url)));
  return urls.filter((_, i) => held[i]);
}

/** The id of the tasks package's background component, which puts a page in its browser's pool. */
export const POOL_COMPONENT_ID = 'task-pool-next';

/**
 * Puts this page in its browser's pool if nothing has: unless the page has a
 * connected `patchwork-view` of the pool's component already, appends one
 * (drawing nothing), inside the first tool-storage provider, or else the
 * first `repo-provider`, or else the body, for the page's life. Looking and
 * appending are one synchronous step, so two tools asking at once append one.
 * Where the tasks package is not installed the element renders nothing.
 * True when it appended one; nothing to do outside a page.
 * @returns {boolean}
 */
export function joinPool() {
  const page = /** @type {any} */ (globalThis).document;
  if (!page?.querySelector || !page.body) {
    return false;
  }
  if (page.querySelector(`patchwork-view[component="${POOL_COMPONENT_ID}"]`)) {
    return false;
  }
  const view = page.createElement('patchwork-view');
  view.setAttribute('component', POOL_COMPONENT_ID);
  view.style.display = 'contents';
  const parent = page.querySelector('patchwork-view[component="patchwork-tool-storage-provider"]') ?? page.querySelector('repo-provider') ?? page.body;
  parent.append(view);
  return true;
}

/**
 * Whether a pool on another machine can import this code: a file in a
 * package kept in automerge, or a `data:` URL.
 * @param {string} importUrl
 */
const travels = (importUrl) => parseAutomergeImport(importUrl) !== null || /^data:/i.test(importUrl);

/**
 * Whether this page takes part in its browser's pool: the tasks package has
 * put a pool host in it (`window.patchworkTasks.poolHosts`). False where the
 * package is not installed, so that a tool can say why work waits.
 * @returns {boolean}
 */
export function poolHere() {
  const hosts = /** @type {any} */ (globalThis).patchworkTasks?.poolHosts;
  return !!hosts && typeof hosts === 'object' && Object.keys(hosts).length > 0;
}

/**
 * Has work done, as the comment above says: asks the queue `ownQueue` gives
 * (as `run`), making it if there is none, then puts the page in its
 * browser's pool (`joinPool`), and waits for the task. Its key and needs are
 * checked, and so is where its code is, before anything is written. Code
 * that cannot travel is asked with the need `pool:<this browser's pool id>`
 * (where no pool has started yet, the id is made here, as the pool's host
 * would make it, once the queue is had, so a refused asking writes nothing).
 *
 * Resolves to what the code returned; rejects with what it threw, with "The
 * task was cancelled" once `signal` is aborted (aborted while it still looks
 * for the queue, at once, asking nothing), or, with nothing asked, with one
 * sentence saying why no queue could be had: `ownQueue`'s (no account open,
 * nowhere to keep the list of queues, or that list not found), or that code
 * only this machine can reach cannot be asked where this browser keeps no
 * pool id. `onProgress` hears every change of the task, as `run`'s does.
 * Work that no pool serving the queue can take waits there.
 * @param {any} repo  the Repo the page's account is in
 * @param {Ask} request
 * @param {{ onProgress?: (view: TaskView) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<unknown>}
 */
export async function doWork(repo, request, { onProgress, signal } = {}) {
  if (signal?.aborted) {
    throw new Error(CANCELLED);
  }
  if (request.key !== undefined) {
    checkKey(request.key);
  }
  checkNeeds(request.needs);
  const stays = !travels(request.importUrl);
  const noPoolId = () =>
    new Error(
      `This work's code is only on this machine (${schemeOf(request.importUrl)} url), and this browser keeps no id for its pool, so no pool can be asked to run it.`,
    );
  if (stays && !poolIdsKeptHere()) {
    throw noPoolId();
  }
  const own = await unlessStopped(ownQueue(repo), signal);
  let needs = request.needs ?? [];
  let near = request.near ?? browserPoolIdHere() ?? undefined;
  if (stays) {
    // made only now that the queue is had, so a refused asking writes nothing
    const pool = browserPoolIdHere({ make: true });
    if (!pool) {
      throw noPoolId();
    }
    const mine = `pool:${pool}`;
    needs = needs.includes(mine) ? needs : [...needs, mine];
    near = request.near ?? pool;
  }
  joinPool();
  return run(repo, own, { ...request, needs, near }, onProgress, signal);
}

/** The scheme of a url, as a person reads it (`http`, `file`), or `this kind of` for one that is not a url. */
function schemeOf(/** @type {string} */ importUrl) {
  const found = /^([a-z][a-z0-9+.-]*):/i.exec(String(importUrl));
  return found ? found[1].toLowerCase() : 'this kind of';
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
    promise.then(
      (found) => {
        signal?.removeEventListener('abort', stop);
        resolve(found);
      },
      (error) => {
        signal?.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

/**
 * Calls `onChange` with the work under `key` as this page can know it, now
 * and whenever that changes: the task under the key on the person's queues,
 * as `watch` gives it. It follows own and every spare the storage marks; the
 * view reported is own's when the key names a task there, and otherwise the
 * first spare's, in the order of their urls, that names one (a spare is
 * where work was asked while own's document was not here). The account's
 * pointer to the task system's storage, that document, its `own` and its
 * marks are followed as they change. Watching makes nothing.
 *
 * Its state is `missing` when no work under this key is known on a queue of
 * this person's: no account is open, it has no storage, the storage names no
 * own, the key names nothing on own nor on any spare heard from within
 * HERE_MS of own, or own's document has not been had. It always reports
 * promptly: what cannot be told at once (no account, no storage, no own) is
 * reported at once, and own's document not had within LAPSE_MS is reported
 * `missing` and looked for still, its work reported when it comes. When the
 * queue a report came from is no longer followed, what it said is replaced
 * at once.
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
  /** @type {string | null} */ let own = null;
  /** @type {string[]} */ let order = [];
  /**
   * The queues followed, by url: how to stop following each, and the last
   * view its watch gave (null before the first).
   * @type {Map<string, { unwatch: () => void, view: TaskView | null }>}
   */
  const followed = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let retry;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let lapse;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let soon;
  // Where the last report came from: null before any report, NONE when it
  // was a `missing` made here, else the followed entry whose view it was.
  const NONE = {};
  /** @type {object | null} */ let said = null;
  let lastMissing = false;

  // Every `missing` view is the same, whoever made it, so one is reported
  // until something else is.
  /** @param {TaskView} view */
  const report = (view) => {
    clearTimeout(lapse);
    clearTimeout(soon);
    lapse = undefined;
    soon = undefined;
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

  /** @type {TaskView | null} */ let lastView = null;

  /** Reports what the queues followed say now, as the comment above says. */
  const decide = () => {
    if (stopped) {
      return;
    }
    for (const url of order) {
      const entry = followed.get(url);
      if (entry?.view && entry.view.state !== 'missing') {
        if (said !== entry || lastView !== entry.view) {
          said = entry;
          lastView = entry.view;
          report(entry.view);
        }
        return;
      }
    }
    lastView = null;
    const pending = order.some((url) => !followed.get(url)?.view);
    if (!storageUrl || (storage && !own)) {
      missing();
    } else if (said !== null && said !== NONE && ![...followed.values()].includes(/** @type {any} */ (said))) {
      // What was reported came from a queue no longer followed: withdrawn now.
      missing();
    } else if (own && followed.get(own)?.view) {
      // Own names nothing under the key. A spare this Repo holds says so a
      // moment later (its document is here); one it does not hold never
      // does, so they are waited for no longer than HERE_MS.
      if (pending) {
        soon ??= setTimeout(missing, HERE_MS);
      } else {
        missing();
      }
    } else if (said !== null) {
      missing();
    } else {
      // Before anything has been reported, own is waited for up to the lapse.
      lapse ??= setTimeout(missing, LAPSE_MS);
    }
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
    own = storage ? ownQueueOf(storage.doc()) : null;
    order = storage ? [...(own ? [own] : []), ...sparesOf(storage.doc())] : [];
    for (const [url, entry] of followed) {
      if (!order.includes(url)) {
        entry.unwatch();
        followed.delete(url);
      }
    }
    for (const url of order) {
      if (!followed.has(url)) {
        /** @type {{ unwatch: () => void, view: TaskView | null }} */
        const entry = { unwatch: () => {}, view: null };
        followed.set(url, entry);
        entry.unwatch = watch(repo, url, key, (view) => {
          if (!stopped && followed.get(url) === entry) {
            entry.view = view;
            decide();
          }
        });
      }
    }
    decide();
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
    clearTimeout(soon);
    account?.off?.('change', look);
    storage?.off('change', look);
    for (const entry of followed.values()) {
      entry.unwatch();
    }
    followed.clear();
  };
}

/**
 * Stops the work under `key` on the person's queues, as `cancel` does: on
 * own and on every spare whose document this Repo holds (see `queuesHere`).
 * True if any task was stopped; false when there is none to stop: no queue
 * of theirs here, nothing under the key, or tasks that had ended already.
 * @param {any} repo  the Repo the page's account is in
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function stopWork(repo, key) {
  const queues = await queuesHere(repo);
  const stopped = await Promise.all(queues.map((url) => cancel(repo, url, key).catch(() => false)));
  return stopped.some(Boolean);
}
