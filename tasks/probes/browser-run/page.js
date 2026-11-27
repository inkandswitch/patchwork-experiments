// The probe page's side (see index.html): starts automerge as the site
// would, makes this tab's tasks Repo, stands in for the frame's tool-storage
// provider, and offers the harness `window.probe`: make the account and a
// queue, mount what a frame mounts from the built package (its background
// components, the titlebar tool) and its queue browser, and ask, watch and
// stop tasks through the built task client: the package's library
// `tasks-next`, as a page's registry gives it.
import { Repo, parseAutomergeUrl } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { decodeChange, getActorId, getAllChanges, initializeWasm } from '@automerge/automerge/slim';
import { initSync } from '@automerge/automerge-subduction/slim';
import { plugins } from '/dist/index.js';

// Nothing listens here, and no document leaves this machine. This tab's Repo
// and the pool's work from the shared database alone; each worker's Repo
// has no storage, and what a task writes through ctx.repo
// reaches this page by the pipe the pool host makes to the Repo it is given
// (src/browser/pool-host.ts; checks 15 and 19). A page opened with `?sync=`
// works through that sync server too, as a site does (check 22).
//
// A page opened with `?site` has, besides this tab's tasks Repo, a "site"
// Repo of its own: its own database and heads channel, sharing no storage
// with the task system's Repos, as the site's keyhive Repo shares none. The
// account, the task storage the provider makes, and what the background
// components and the titlebar tool are handed are that Repo's, so the only
// way between it and the pool is the pipe (checks 26 to 30). Without `?site`
// the two are one Repo, the tasks Repo. Two `?site` pages of one profile
// are joined as the site's tabs are: their site Repos share one database
// (`probe-site`) and one heads channel (`probe-site-heads`), and nothing else
// (checks 41 and 42).
const client = await plugins.find((p) => p.id === 'tasks-next').load();
const params = new URLSearchParams(location.search);
const SYNC = params.get('sync') ?? 'ws://127.0.0.1:9';

const [automergeWasm, subductionWasm] = await Promise.all([
  fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
  fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
]);
initSync(new Uint8Array(subductionWasm));
await initializeWasm(new Uint8Array(automergeWasm));

const repo = new Repo({
  storage: new IndexedDBStorageAdapter('patchwork-tasks'),
  peerId: `probe-tab-${crypto.randomUUID()}`,
  subductionWebsocketEndpoints: [SYNC],
  headsChannel: 'patchwork-tasks-heads',
  enableRemoteHeadsGossiping: true,
});

const site = params.has('site')
  ? new Repo({
      storage: new IndexedDBStorageAdapter('probe-site'),
      peerId: `probe-site-${crypto.randomUUID()}`,
      subductionWebsocketEndpoints: [SYNC],
      headsChannel: 'probe-site-heads',
      enableRemoteHeadsGossiping: true,
    })
  : repo;

// The account's handle, where the site sets it, once the harness has made
// the account (in this tab or an earlier one).
const accountUrl = localStorage.getItem('tinyPatchworkAccountUrl');
if (accountUrl) {
  window.accountDocHandle = await site.find(accountUrl);
}

// The frame's tool-storage provider, standing in as Patchwork's
// ToolStorageProvider answers through patchwork-providers' accept(): it
// takes a `patchwork:subscribe` for `{ type: 'patchwork:tool-storage',
// toolId }`, stops it, listens on its port for `{ type: 'unsubscribe' }`,
// and posts `{ type: 'change', value: url }`: the document the account names
// under `toolStorage[toolId]`, made and linked there first if it names none.
// Every tool on the page is under it, as every tool in a frame is.
const providerAsked = [];
document.addEventListener('patchwork:subscribe', (event) => {
  const { selector, port } = event.detail ?? {};
  if (selector?.type !== 'patchwork:tool-storage' || typeof selector.toolId !== 'string' || !selector.toolId) return;
  event.stopPropagation();
  let alive = true;
  port.onmessage = (message) => {
    if (message.data?.type === 'unsubscribe' && alive) {
      alive = false;
      port.close();
    }
  };
  const account = window.accountDocHandle;
  if (!account) return;
  const { toolId } = selector;
  providerAsked.push(toolId);
  if (!account.doc()?.toolStorage?.[toolId]) {
    const made = site.create({ '@patchwork': { type: 'patchwork:tool-storage' } });
    account.change((doc) => {
      if (!doc.toolStorage) doc.toolStorage = {};
      if (!doc.toolStorage[toolId]) doc.toolStorage[toolId] = made.url;
    });
  }
  if (alive) port.postMessage({ type: 'change', value: account.doc().toolStorage[toolId] });
});

const queueUrl = () => localStorage.getItem('probeQueue');
/** What letting go of each background component mounted here is, as a frame would on unmounting it. */
const backgrounds = [];
const statusLog = [];
const views = {};
let queueView = null;

const probe = {
  repo,
  site,
  statusLog,
  views,
  queueUrl,
  providerAsked,

  /** A fresh account, which serves nothing (it names no task storage), and a queue it does not serve yet. */
  async makeAccount() {
    const queue = site.create({ '@patchwork': { type: 'task-queue-next' }, title: 'Probe queue', jobs: {} });
    const account = site.create({});
    await site.flush();
    localStorage.setItem('probeQueue', queue.url);
    localStorage.setItem('tinyPatchworkAccountUrl', account.url);
    window.accountDocHandle = account;
    return queue.url;
  },

  /** The task storage document the account names, as it is now, or null. */
  async storage() {
    const url = client.storageUrlOf(window.accountDocHandle?.doc());
    return url ? (await site.find(url)).doc() : null;
  },

  /** The queues the task storage document serves now, each with its setting, as the client reads them. */
  async servedNow() {
    return client.servedOf(await probe.storage());
  },

  /** The queue the task storage document names as this person's own, as the client reads it, or null. */
  async ownNow() {
    return client.ownQueueOf(await probe.storage());
  },

  /** What the titlebar tool shows, as text, or null before it shows anything. */
  titlebar() {
    return document.querySelector('#badge .task-titlebar-list')?.textContent ?? null;
  },

  /** This person's own queue, through the built client, from the titlebar tool's element. */
  ownQueue() {
    return client.ownQueue(site, document.querySelector('#badge') ?? document.body);
  },

  /** Opens the queue browser on the probe's queue, presses Join queue as a person would, and closes it again once the list says so. */
  async join() {
    await probe.mountQueueView();
    const until = Date.now() + 15_000;
    let button;
    while (!(button = [...document.querySelectorAll('#queue-view button')].find((b) => b.textContent.trim() === 'Join queue')) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    button?.click();
    while (!client.servedOf(await probe.storage())[queueUrl()] && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    probe.unmountQueueView();
    return { pressed: !!button, served: client.servedOf(await probe.storage())[queueUrl()] ?? null };
  },

  /**
   * Mounts what a frame mounts of the built package, with this Repo standing
   * in for the site's: every component it registers tagged `background`,
   * found by tag in its plugin list (nothing registers the package here; the list is
   * what the package would register), each once, as a frame mounts them;
   * then its titlebar tool. With `background: false`, only the titlebar tool:
   * a frame that mounts no background components.
   */
  async mount(dist = '/dist', { background = true } = {}) {
    const { plugins } = await import(`${dist}/index.js`);
    if (background) {
      await probe.mountBackground(dist);
    }
    const TitlebarTool = await plugins.find((plugin) => plugin.id === 'task-titlebar-next').load();
    const element = document.createElement('div');
    element.id = 'badge';
    element.repo = site;
    document.body.append(element);
    TitlebarTool(null, element);
    const host = Object.values(window.patchworkTasks?.poolHosts ?? {})[0];
    if (host) {
      statusLog.push({ t: Date.now(), ...host.status() });
      host.subscribe((status) => statusLog.push({ t: Date.now(), ...status }));
    }
    return true;
  },

  /** Mounts every component the built package tags `background`, once each, as a frame does; how many. */
  async mountBackground(dist = '/dist') {
    const { plugins } = await import(`${dist}/index.js`);
    const tagged = plugins.filter((p) => p.type === 'patchwork:component' && p.tags?.includes('background'));
    for (const plugin of tagged) {
      const element = document.createElement('div');
      element.className = 'background';
      element.style.display = 'contents';
      element.repo = site;
      document.body.append(element);
      const cleanup = (await plugin.load())(element, site);
      backgrounds.push(() => (cleanup?.(), element.remove()));
    }
    return tagged.length;
  },

  /** Lets go of the background components, as a frame that goes away does. */
  unmountBackground() {
    for (const cleanup of backgrounds.splice(0)) cleanup();
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
    queueView = { element, dispose: TaskQueueTool(await repo.find(queueUrl()), element) };
    return true;
  },

  unmountQueueView() {
    queueView?.dispose?.();
    queueView?.element.remove();
    queueView = null;
  },

  /** What the queue browser shows: the pools heard serving, its line for this browser's pool, and each task row with its runs. */
  queueView() {
    const view = document.querySelector('#queue-view');
    if (!view) return null;
    for (const details of view.querySelectorAll('details.tq-task')) details.open = true;
    const sections = [...view.querySelectorAll('.tq-section')];
    const serving = sections.find((section) => /Serving it/.test(section.querySelector('h2')?.textContent ?? ''));
    return {
      serving: [...(serving?.querySelectorAll('li') ?? [])].map((li) => li.textContent),
      here: (() => {
        const line = view.querySelector('.tq-pool-here');
        return line ? { state: line.dataset.poolState, text: line.textContent } : null;
      })(),
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
    };
  },

  /** The IndexedDB databases of this origin whose names are a run worker's or the pool worker's own: none, since a worker has no storage. */
  async workerDatabases() {
    return (await indexedDB.databases()).map((db) => db.name).filter((name) => /^patchwork-tasks-run-\d+$/.test(name));
  },

  /**
   * Has work done through the site's Repo with the built client's `doWork`,
   * as a tool in a page does, and says what came of it: the result or the
   * error, how long it took, every state and progress `onProgress` heard, the
   * task's url, and how many of the pool's progress messages the site's Repo
   * heard by its own route (the task's handle), not this browser's channel.
   * With `stopAfterMs`, stops the work that long after asking, as a tool
   * stops its own: by aborting the signal it passed.
   */
  async work(importUrl, input = null, { key = `probe:${crypto.randomUUID()}`, stopAfterMs } = {}) {
    const views = [];
    let taskUrl = null;
    let heard = 0;
    const t0 = performance.now();
    const listening = new Set();
    const onProgress = (view) => {
      views.push({ state: view.state, progress: view.progress ?? null, logs: (view.logs ?? []).length, runs: (view.runs ?? []).map((run) => run.pool ?? null) });
      if (view.taskUrl && !taskUrl) {
        taskUrl = view.taskUrl;
        site.find(taskUrl).then((handle) => {
          if (listening.has(handle)) return;
          listening.add(handle);
          handle.on('ephemeral-message', ({ message }) => {
            if (message?.type === 'task progress') heard++;
          });
        });
      }
    };
    const stop = new AbortController();
    if (stopAfterMs) setTimeout(() => stop.abort(), stopAfterMs);
    const outcome = await client.doWork(site, { importUrl, input, key }, { onProgress, signal: stop.signal }).then(
      (result) => ({ result }),
      (error) => ({ error: String(error?.message ?? error) }),
    );
    return { ...outcome, ms: performance.now() - t0, taskUrl, heard, states: views.map((v) => v.state).filter((state, i, all) => state !== all[i - 1]), views };
  },

  /** Work started as `work` does it, not waited for: what came of it is in `probe.outcomes[key]` once it settles. */
  startWork(importUrl, input, key) {
    const outcome = (probe.outcomes[key] = { pending: true });
    probe.work(importUrl, input, { key }).then((work) => Object.assign(outcome, work, { pending: false }));
    return key;
  },
  outcomes: {},

  /** Follows the work under `key` with the built client's `watchWork` through the site's Repo: each state it reports, in `probe.watched[key]`. */
  watchWork(key) {
    const states = (probe.watched[key] = []);
    client.watchWork(site, key, (view) => {
      if (states.at(-1) !== view.state) states.push(view.state);
    });
    return true;
  },
  watched: {},

  /** Stops the work under `key` with the built client's `stopWork` through the site's Repo. */
  stopWork(key) {
    return client.stopWork(site, key);
  },

  /** A document made in the site's Repo, with `value`; its url. */
  async siteDoc(value) {
    const handle = site.create(value);
    await site.flush([handle.documentId]);
    return handle.url;
  },

  /** What the site's Repo has of `url` now, without asking anyone: its value, or null. */
  siteNow(url) {
    const handle = site.handles[parseAutomergeUrl(url).documentId];
    try {
      return handle?.isReady?.() ? JSON.parse(JSON.stringify(handle.doc())) : null;
    } catch {
      return null;
    }
  },

  /** How long after this call the site's Repo has `url` with `ready(doc)` true, looked at every 10 ms and asked for every 250 ms until then, up to `ms`; null if not by then. */
  async siteWhen(url, ready, ms = 2000) {
    const t0 = performance.now();
    const id = parseAutomergeUrl(url).documentId;
    let asked = -Infinity;
    while (performance.now() - t0 < ms) {
      const handle = site.handles[id];
      try {
        if (handle?.isReady?.() && ready(handle.doc())) return performance.now() - t0;
      } catch {}
      if (!handle?.isReady?.() && performance.now() - asked > 250) {
        asked = performance.now();
        site.find(url).catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return null;
  },

  /** The pools heard serving own through the site's Repo alone (`served` with `local: false`), after `ms`. */
  async servedThroughSite(ms = 4000) {
    const own = await client.ownQueue(site, document.body);
    return new Promise((resolve) => {
      let pools = [];
      const stop = client.served(site, own, (list) => (pools = list), { local: false });
      setTimeout(() => (stop(), resolve(pools)), ms);
    });
  },

  /** What the site's Repo gives for `url` when asked, within `ms` (from what this browser keeps, with no network): its value, or null, and how long it took. */
  async siteFind(url, ms = 2000) {
    const t0 = performance.now();
    const found = site.find(url).then((handle) => JSON.parse(JSON.stringify(handle.doc() ?? null)), () => null);
    const value = await Promise.race([found, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
    return { value, ms: performance.now() - t0 };
  },

  /** How many network adapters the site's Repo has: one per pipe to a worker of this page's pool. */
  siteLinks() {
    return site.networkSubsystem.adapters.length;
  },

  /** Whether this tab's Repo can get the document `url` within `ms`. */
  async has(url, ms = 2000) {
    const found = repo.find(url).then((handle) => !!handle.doc(), () => false);
    return Promise.race([found, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
  },

  /**
   * Makes a document with an empty `text`, asks for the task at `importUrl`
   * (probes/append-task.js) to append `pieces` to it, and keeps every text
   * this tab's Repo shows while it runs. Then what probes/append-check.js
   * reads of the document, with what the task returned, the text this tab
   * had when it heard the run end, and how long after that it had the whole
   * text (null if not within 2 s).
   */
  async append(importUrl, pieces, everyMs) {
    const handle = repo.create({ text: '' });
    await repo.flush();
    const seen = [];
    let firstAt = null;
    handle.on('change', ({ doc }) => {
      seen.push(doc.text);
      firstAt ??= doc.text.length > 0 ? performance.now() : null;
    });
    const t0 = performance.now();
    const result = await client.run(repo, queueUrl(), { importUrl, input: { doc: handle.url, pieces, everyMs } }).catch((error) => ({ error: String(error?.message ?? error) }));
    const atEnd = handle.doc().text;
    const ms = performance.now() - t0;
    const t1 = performance.now();
    while (handle.doc().text !== pieces.join('') && performance.now() - t1 < 2000) await new Promise((r) => setTimeout(r, 5));
    const wholeMs = handle.doc().text === pieces.join('') ? performance.now() - t1 : null;
    const { appendedHow, appendedWell } = await import('/append-check.js');
    const how = appendedHow(handle.doc(), pieces, seen, { decodeChange, getActorId, getAllChanges });
    return { result, atEnd, wholeMs, ms, firstMs: firstAt === null ? null : firstAt - t0, well: appendedWell(how, pieces), ...how };
  },

  /**
   * Installs a package as core's page does once its discovery worker has
   * described it: its plugins registered under its url at heads, each loading
   * through the service worker's paths (here served by the harness). The same
   * package at other heads replaces what it registered before.
   */
  async install(url, descriptions) {
    const { registerPlugins } = await import('@inkandswitch/patchwork-plugins');
    const { importPluginFromFolderDocUrl } = await import('@inkandswitch/patchwork-filesystem');
    registerPlugins(descriptions.map((d) => ({ ...d, load: () => importPluginFromFolderDocUrl(url, d.type, d.id) })), url);
  },

  /** What core's page does when a package leaves the settings. */
  async uninstall(url) {
    (await import('@inkandswitch/patchwork-plugins')).unregisterPlugins(url);
  },

  /** Asks and waits; how long from asking to the result, in ms. */
  async timeRun(importUrl, input = null, queue = queueUrl()) {
    const t0 = performance.now();
    const result = await client.run(repo, queue, { importUrl, input });
    return { ms: performance.now() - t0, result };
  },

  /** Asks, and keeps every view of the task the watcher reports in `views[key]`. */
  async ask(importUrl, input = null) {
    const { key, taskUrl } = await client.ask(repo, queueUrl(), { importUrl, input });
    probe.watch(key, taskUrl);
    return key;
  },

  watch(key, from, queue = queueUrl()) {
    const seen = (views[key] = []);
    client.watch(
      repo,
      queue,
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
