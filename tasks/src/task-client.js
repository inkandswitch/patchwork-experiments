/**
 * task-client.js — asking a queue for a task, stopping it, and following what becomes of it. [kit: task-client.js v1]
 *
 * Everything here is a read or a write of a queue's document and a task's
 * document, or listening on their channels; nothing is sent to anyone. So it
 * works from any Repo that can reach those documents, in a page, a worker or
 * Node, whether or not a pool runs on the same machine. The rules it applies
 * are task-rules.js's, which sits beside it; the canonical copies of both are
 * in the tasks package.
 *
 * It also holds how the task system's messages travel (`send`, `listen`),
 * because hearing them is half of following a task.
 */

import {
  LAPSE_MS,
  MAX_LOG_LINES,
  Hearing,
  allHeard,
  delistTask,
  ending,
  endingRun,
  entryAt,
  isFinished,
  listTask,
  mayRelist,
  named,
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
 * Said on a queue's channel by each pool serving it, every BEAT_MS. Advice
 * for people and askers: nothing is decided by it.
 * @typedef {{ type: 'serving', pool: string, name: string, slots: number, busy: number, from: string, seq: number }} ServingMessage
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
      seen.delete(seen.values().next().value);
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
 * `run`), not the url.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {Ask} ask
 * @returns {Promise<{ key: string, taskUrl: string }>}
 */
export async function ask(repo, queueUrl, { importUrl, input, key }) {
  const queue = await repo.find(queueUrl);
  const jobKey = key ?? crypto.randomUUID();
  const listed = entryAt(queue.doc(), jobKey);
  let over;
  if (listed) {
    // One look, with nobody listening: a task with a run still open has not
    // ended, and neither has one that is not here to be read yet.
    const task = await repo.find(listed.taskUrl).then(
      (/** @type {any} */ handle) => handle.doc(),
      () => undefined,
    );
    if (!task || ending(task, allHeard) === null) {
      return { key: jobKey, taskUrl: listed.taskUrl };
    }
    over = listed.taskUrl;
  }
  const task = repo.create({ importUrl, input: copy(input), key: jobKey, runs: [] });
  // Saved before the queue names it, so that a pool that sees the entry finds the task.
  await repo.flush([task.documentId]);
  queue.change((/** @type {Queue} */ doc) =>
    listTask(
      doc,
      jobKey,
      { taskUrl: task.url, askedAt: Date.now(), package: packageOf(importUrl) },
      over,
    ),
  );
  await repo.flush([queue.documentId]).catch(() => {
    // it is saved a moment later all the same
  });
  return { key: jobKey, taskUrl: queue.doc().jobs[jobKey].taskUrl };
}

/**
 * Asks the task under `key` to stop: flags it and takes it off the queue. One
 * that is waiting never starts; one that is running has its signal aborted
 * and its worker ended soon after. False when the key names nothing, or its
 * task was already ended by a run.
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
  const task = await repo.find(listed.taskUrl);
  const over = !!endingRun(task.doc());
  if (!over) {
    task.change((/** @type {Task} */ doc) => {
      if (!doc.cancelled) {
        doc.cancelled = true;
      }
    });
  }
  queue.change((/** @type {Queue} */ doc) => delistTask(doc, key, listed.taskUrl));
  await repo.flush([task.documentId, queue.documentId]).catch(() => {});
  return !over;
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
  const hearing = new Hearing();
  /** What has been heard from the run that has the task: @type {{ run: string | null, progress: unknown, logs: LogLine[] }} */
  let said = { run: null, progress: null, logs: [] };

  /** @type {string | null} */ let reported = null;

  const report = (/** @type {unknown} */ onTimer) => {
    if (stopped) {
      return;
    }
    clearTimeout(lapse);
    /** @type {Queue | undefined} */ const jobs = queue?.doc();
    /** @type {Task | undefined} */ const doc = task?.doc();
    hearing.saw(doc?.runs);
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
          listTask(q, key, { taskUrl: again, askedAt: Date.now(), package: packageOf(doc.importUrl) }),
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
    const has = doc?.runs?.find((run) => run.status == null && hearing.heard(run.id));
    const live = !!has && said.run === has.id;
    onChange({
      key,
      state,
      taskUrl: following,
      importUrl: doc?.importUrl ?? null,
      input: doc?.input,
      progress: live ? said.progress : null,
      logs: by ? (by.logs ?? []) : live ? said.logs : [],
      result: state === 'succeeded' ? taskResult(doc) : undefined,
      error: taskError(doc, hearing.heard),
      runs: doc?.runs ?? [],
    });
  };

  const changed = () => report(false);

  const unfollow = () => {
    task?.off('change', changed);
    unlisten?.();
    unlisten = undefined;
    task = undefined;
    said = { run: null, progress: null, logs: [] };
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
              const same = said.run === message.run;
              said = {
                run: message.run,
                progress: 'progress' in message ? message.progress : same ? said.progress : null,
                logs: [...(same ? said.logs : []), ...(message.logs ?? [])].slice(-MAX_LOG_LINES),
              };
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

/**
 * Asks for a task and waits for it: resolves to its result when it succeeds,
 * rejects when it fails or is cancelled. `onProgress` hears every change on
 * the way. While it waits it keeps the task listed (see `watch`).
 * @param {any} repo
 * @param {string} queueUrl
 * @param {Ask} request
 * @param {(view: TaskView) => void} [onProgress]
 * @returns {Promise<unknown>}
 */
export async function run(repo, queueUrl, request, onProgress) {
  const { key, taskUrl } = await ask(repo, queueUrl, request);
  return new Promise((resolve, reject) => {
    const stop = watch(
      repo,
      queueUrl,
      key,
      (view) => {
        onProgress?.(view);
        if (!isFinished(view.state)) {
          return;
        }
        stop();
        if (view.state === 'succeeded') {
          resolve(view.result);
        } else {
          reject(
            new Error(
              view.state === 'cancelled' ? 'The task was cancelled' : (view.error ?? 'The task failed'),
            ),
          );
        }
      },
      { keep: true, from: taskUrl },
    );
  });
}

/**
 * A pool heard serving a queue.
 * @typedef {{ pool: string, name: string, slots: number, busy: number }} Serving
 */

/**
 * Calls `onChange` with the pools heard serving `queueUrl` within the lapse,
 * now and whenever that changes: an empty list means nobody is heard, so a
 * task asked of it would wait. Returns how to stop.
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
      .map(({ pool, name, slots, busy }) => ({ pool, name, slots, busy }))
      .sort((a, b) => (a.pool < b.pool ? -1 : 1));
    const json = JSON.stringify(list);
    if (json !== reported) {
      reported = json;
      onChange(list);
    }
    if (pools.size > 0) {
      timer = setTimeout(report, LAPSE_MS / 4);
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
          pools.set(message.pool, {
            pool: message.pool,
            name: String(message.name ?? ''),
            slots: Number(message.slots) || 0,
            busy: Number(message.busy) || 0,
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
