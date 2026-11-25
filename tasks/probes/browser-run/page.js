// The probe page's side (see index.html): starts automerge as the site
// would, makes this tab's tasks Repo, and offers the harness `window.probe`:
// make the account and its queue, mount the real titlebar tool from the
// built package, and ask, watch and stop tasks through the built task-client.
import { Repo, parseAutomergeUrl } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { initializeWasm } from '@automerge/automerge/slim';
import { initSync, SedimentreeId } from '@automerge/automerge-subduction/slim';
import * as client from '/vendor/task-client.js';

// Nothing listens here, and no document leaves this machine. This tab's Repo
// and the pool's work from the shared database alone; each run worker's
// Repo has a database of its own, so what a task writes through ctx.repo
// never reaches this page here (see check 15).
const SYNC = 'ws://127.0.0.1:9';

const [automergeWasm, subductionWasm] = await Promise.all([
  fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
  fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
]);
initSync(new Uint8Array(subductionWasm));
await initializeWasm(new Uint8Array(automergeWasm));

localStorage.setItem('tasksSyncServerUrl', SYNC);
const repo = new Repo({
  storage: new IndexedDBStorageAdapter('patchwork-tasks'),
  peerId: `probe-tab-${crypto.randomUUID()}`,
  subductionWebsocketEndpoints: [SYNC],
  headsChannel: 'patchwork-tasks-heads',
  enableRemoteHeadsGossiping: true,
});
// The hook tasks-repo.ts leaves for a page that has a Repo of the family already.
window.patchworkTasks = { repo: Promise.resolve(repo) };

const queueUrl = () => localStorage.getItem('probeQueue');
const statusLog = [];
const views = {};

const probe = {
  repo,
  statusLog,
  views,
  queueUrl,

  /** The account document with one queue on its list, served for any code. */
  async makeAccount() {
    const queue = repo.create({ '@patchwork': { type: 'task-queue-next' }, title: 'Probe queue', jobs: {} });
    const account = repo.create({ __servedQueues__: { [queue.url]: true } });
    await repo.flush();
    localStorage.setItem('probeQueue', queue.url);
    localStorage.setItem('tinyPatchworkAccountUrl', account.url);
    return queue.url;
  },

  /** Mounts the built package's titlebar tool, as a frame would, with this Repo standing in for the site's. */
  async mount(dist = '/dist') {
    const { plugins } = await import(`${dist}/index.js`);
    const TitlebarTool = await plugins.find((plugin) => plugin.id === 'task-titlebar-next').load();
    const element = document.createElement('div');
    element.id = 'badge';
    element.repo = repo;
    document.body.append(element);
    TitlebarTool(null, element);
    const host = Object.values(window.patchworkTasks.poolHosts)[0];
    statusLog.push({ t: Date.now(), ...host.status() });
    host.subscribe((status) => statusLog.push({ t: Date.now(), ...status }));
    return true;
  },

  /** Mounts the built package's queue browser on the probe's queue, as a frame would. */
  async mountQueueView(dist = '/dist') {
    const { plugins } = await import(`${dist}/index.js`);
    const TaskQueueTool = await plugins.find((plugin) => plugin.id === 'task-queue-next-browser').load();
    const element = document.createElement('div');
    element.id = 'queue-view';
    element.repo = repo;
    document.body.append(element);
    TaskQueueTool(await repo.find(queueUrl()), element);
    return true;
  },

  /** What the queue browser shows: the pools heard serving, and each task row with its runs. */
  queueView() {
    const view = document.querySelector('#queue-view');
    if (!view) return null;
    for (const details of view.querySelectorAll('details.tq-task')) details.open = true;
    const sections = [...view.querySelectorAll('.tq-section')];
    const serving = sections.find((section) => /Serving it/.test(section.querySelector('h2')?.textContent ?? ''));
    return {
      serving: [...(serving?.querySelectorAll('li') ?? [])].map((li) => li.textContent),
      tasks: [...view.querySelectorAll('details.tq-task')].map((details) => ({
        row: details.querySelector('summary')?.textContent,
        runs: [...details.querySelectorAll('.tq-runs li')].map((li) => li.textContent),
        stop: !!details.querySelector('summary button'),
      })),
    };
  },

  /** Presses the Stop of the first task row that has one, as a person would. */
  pressStop() {
    const button = document.querySelector('#queue-view details.tq-task summary button:not([disabled])');
    button?.click();
    return !!button;
  },

  status() {
    const hosts = Object.values(window.patchworkTasks?.poolHosts ?? {});
    return hosts.length ? hosts[0].status() : null;
  },

  badge() {
    const button = document.querySelector('#badge .task-titlebar');
    return button ? { state: button.dataset.poolState, text: button.textContent, title: button.title } : null;
  },

  async locks() {
    const { held, pending } = await navigator.locks.query();
    const count = (list, name) => list.filter((lock) => lock.name === name).length;
    return {
      held: count(held, 'patchwork-tasks-pool'),
      pending: count(pending, 'patchwork-tasks-pool'),
      // the one each pool's worker holds for its life (pool-worker.ts)
      workerHeld: count(held, 'patchwork-tasks-pool-worker'),
      workerPending: count(pending, 'patchwork-tasks-pool-worker'),
      // the one each run worker holds for its life, named as its database (webworker-lib.ts)
      runHeld: held.map((lock) => lock.name).filter((name) => /^patchwork-tasks-run-\d+$/.test(name)).sort(),
    };
  },

  /**
   * Which of this origin's task databases have stored anything of the
   * document `url`: the shared one, and each run worker's. Read straight
   * from IndexedDB, by the key the Repo stores a document's id under (its
   * sedimentree id, made as the Repo makes it), and never opening a
   * database that does not exist (that would make it).
   */
  async storedIn(url) {
    const id = parseAutomergeUrl(url).binaryDocumentId;
    const padded = new Uint8Array(32);
    padded.set(id.subarray(0, 32));
    const sid = SedimentreeId.fromBytes(padded).toString();
    const names = (await indexedDB.databases()).map((db) => db.name).filter((name) => /^patchwork-tasks(-run-\d+)?$/.test(name));
    const found = [];
    for (const name of names) {
      const keys = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('documents')) return resolve((db.close(), []));
          const request = db.transaction('documents').objectStore('documents').getAllKeys();
          request.onsuccess = () => resolve((db.close(), request.result));
          request.onerror = () => reject(request.error);
        };
      });
      if (keys.some((key) => JSON.stringify(key).includes(sid))) found.push(name);
    }
    return { databases: names.sort(), found };
  },

  /** Whether this tab's Repo can get the document `url` within `ms`. */
  async has(url, ms = 2000) {
    const found = repo.find(url).then((handle) => !!handle.doc(), () => false);
    return Promise.race([found, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
  },

  /** Asks and waits; how long from asking to the result, in ms. */
  async timeRun(importUrl, input = null) {
    const t0 = performance.now();
    const result = await client.run(repo, queueUrl(), { importUrl, input });
    return { ms: performance.now() - t0, result };
  },

  /** Asks, and keeps every view of the task the watcher reports in `views[key]`. */
  async ask(importUrl, input = null) {
    const { key, taskUrl } = await client.ask(repo, queueUrl(), { importUrl, input });
    probe.watch(key, taskUrl);
    return key;
  },

  watch(key, from) {
    const seen = (views[key] = []);
    client.watch(
      repo,
      queueUrl(),
      key,
      (view) =>
        seen.push({
          t: Date.now(),
          state: view.state,
          progress: view.progress,
          logs: view.logs.map((line) => line.message),
          error: view.error,
          result: view.result,
          runs: view.runs.map((run) => ({ pool: run.pool ?? null, status: run.status ?? null, start: run.start, end: run.end ?? null, logs: (run.logs ?? []).map((l) => l.message) })),
        }),
      { keep: true, from },
    );
  },

  last(key) {
    return views[key]?.at(-1) ?? null;
  },

  states(key) {
    return (views[key] ?? []).map((view) => view.state).filter((state, i, all) => state !== all[i - 1]);
  },

  cancel(key) {
    return client.cancel(repo, queueUrl(), key);
  },

  /** The pools heard serving the queue, after `ms` of listening. */
  served(ms = 5000) {
    return new Promise((resolve) => {
      let pools = [];
      const stop = client.served(repo, queueUrl(), (list) => (pools = list));
      setTimeout(() => (stop(), resolve(pools)), ms);
    });
  },
};
window.probe = probe;
window.ready = true;
