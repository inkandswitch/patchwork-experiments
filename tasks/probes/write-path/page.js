// The page's side of probes/write-path/browser.mjs (see index.html): starts
// automerge as the site would, makes this tab's tasks Repo and a second Repo
// that stands in for the site's own, both on the real sync server, stands in
// for the frame's tool-storage provider, and offers the harness
// `window.probe`: make an account, whose own queue the mounted package
// makes with nothing pressed, and measure how a document travels between a
// task's run worker and this page.
//
// The run worker's Repo keeps its documents in a database of its own and
// meets this page's Repos only at the sync server, so that is the path
// measured. The "site" Repo here is a plain Repo, as the tasks Repo is: the
// deployed site's own Repo is a keyhive Repo, which this is not.
import { Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { initializeWasm } from '@automerge/automerge/slim';
import { initSync } from '@automerge/automerge-subduction/slim';
import * as client from '/vendor/task-client.js';

const SYNC = new URL(location.href).searchParams.get('sync') || 'wss://subduction.sync.inkandswitch.com';

const [automergeWasm, subductionWasm] = await Promise.all([
  fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
  fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
]);
initSync(new Uint8Array(subductionWasm));
await initializeWasm(new Uint8Array(automergeWasm));

// The pool and its run workers read the sync server from here (repo-config.ts).
localStorage.setItem('tasksSyncServerUrl', SYNC);
const repo = new Repo({
  storage: new IndexedDBStorageAdapter('patchwork-tasks'),
  peerId: `write-path-tab-${crypto.randomUUID()}`,
  subductionWebsocketEndpoints: [SYNC],
  headsChannel: 'patchwork-tasks-heads',
  enableRemoteHeadsGossiping: true,
});
window.patchworkTasks = { repo: Promise.resolve(repo) };
// Where documents are made and found, on a database of its own as the site's Repo is.
const site = new Repo({
  storage: new IndexedDBStorageAdapter('write-path-site'),
  peerId: `write-path-site-${crypto.randomUUID()}`,
  subductionWebsocketEndpoints: [SYNC],
});

// The frame's tool-storage provider, as probes/browser-run/page.js stands in for it.
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
  if (!account.doc()?.toolStorage?.[toolId]) {
    const made = repo.create({ '@patchwork': { type: 'patchwork:tool-storage' } });
    account.change((doc) => {
      if (!doc.toolStorage) doc.toolStorage = {};
      if (!doc.toolStorage[toolId]) doc.toolStorage[toolId] = made.url;
    });
  }
  if (alive) port.postMessage({ type: 'change', value: account.doc().toolStorage[toolId] });
});

const now = () => performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(size) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 65536) crypto.getRandomValues(bytes.subarray(at, Math.min(size, at + 65536)));
  return bytes;
}

/** As probes/write-path.mjs's reach: finds until the bytes are right, asking again 250 ms after a rejection. */
async function reach(url, size, want, limitMs) {
  const t0 = now();
  const deadline = t0 + limitMs;
  const rejections = [];
  let finds = 0;
  let firstFind = null;
  while (now() < deadline) {
    const at = Math.round(now() - t0);
    finds++;
    const got = await Promise.race([
      site.find(url).then((handle) => ({ handle }), (error) => ({ error })),
      sleep(deadline - now()).then(() => ({ pending: true })),
    ]);
    const after = Math.round(now() - t0) - at;
    if (got.pending) {
      firstFind ??= { pendingAtLimit: true };
      return { ok: false, ms: Math.round(now() - t0), observed: `a find was still waiting at the limit (${finds} finds)`, finds, firstFind, rejections };
    }
    if (got.error) {
      firstFind ??= { rejectedAfterMs: after };
      rejections.push({ at, after, message: String(got.error?.message ?? got.error).replace(/Document \w+ /, 'document ').slice(0, 60) });
      await sleep(250);
      continue;
    }
    firstFind ??= { resolvedAfterMs: after };
    for (;;) {
      const content = got.handle.doc()?.content;
      if (content?.byteLength === size && (await sha256(content)) === want) {
        return { ok: true, ms: Math.round(now() - t0), finds, firstFind, rejections };
      }
      if (now() > deadline) {
        return { ok: false, ms: Math.round(now() - t0), observed: content ? `found, ${content.byteLength} bytes not hashing right` : 'found, no content', finds, firstFind, rejections };
      }
      await sleep(100);
    }
  }
  return { ok: false, ms: Math.round(now() - t0), observed: `never found (${finds} finds)`, finds, firstFind, rejections };
}
const shortRejections = (list) => ({ count: list.length, first: list.slice(0, 3), last: list.length > 3 ? list.at(-1) : undefined });

let ownQueue = null;
let n = 0;
/** Asks the page's own queue and waits; with when it was taken, ran, and read succeeded (one clock: this machine's). */
async function ask(importUrl, input) {
  const asked = Date.now();
  let last = null;
  const result = await client.run(repo, ownQueue, { importUrl, input, key: `wp-${n++}-${crypto.randomUUID().slice(0, 8)}` }, (view) => (last = view));
  const done = Date.now();
  const ran = last?.runs?.find((r) => r.status === 'succeeded');
  return { result, askMs: done - asked, when: ran ? { toStart: ran.start - asked, ran: ran.end - ran.start, toAsker: done - ran.end } : null };
}

window.probe = {
  sync: SYNC,

  /**
   * An account, and what a frame mounts of the package (its background
   * components, found by tag in its plugin list, and the real titlebar tool),
   * which make the account's own queue as they mount: the pool then serves it.
   */
  async setUp() {
    const account = repo.create({});
    await repo.flush();
    window.accountDocHandle = account;
    const { plugins } = await import('/dist/index.js');
    for (const plugin of plugins.filter((p) => p.type === 'patchwork:component' && p.tags?.includes('background'))) {
      const element = document.createElement('div');
      element.style.display = 'contents';
      element.repo = repo;
      document.body.append(element);
      (await plugin.load())(element, repo);
    }
    const TitlebarTool = await plugins.find((plugin) => plugin.id === 'task-titlebar-next').load();
    const element = document.createElement('div');
    element.id = 'badge';
    element.repo = repo;
    document.body.append(element);
    TitlebarTool(null, element);
    const until = Date.now() + 30_000;
    // Once what was mounted has made the queue and served it, ownQueue() reads it back rather than making another.
    for (;;) {
      const url = client.storageUrlOf(account.doc());
      const storage = url ? (await repo.find(url)).doc() : null;
      const own = client.ownQueueOf(storage);
      if (own && client.servedOf(storage)[own]) break;
      if (Date.now() > until) throw new Error(`no queue of its own was made: ${document.querySelector('#badge')?.textContent}`);
      await sleep(50);
    }
    ownQueue = await client.ownQueue(repo, element);
    return ownQueue;
  },

  /** A task that does nothing, to start a run worker before anything is measured. */
  async warm() {
    const t0 = now();
    await client.run(repo, ownQueue, { importUrl: 'data:text/javascript,export%20default%20(x)%20%3D%3E%20x%3B', input: 1, key: `warm-${crypto.randomUUID()}` });
    return Math.round(now() - t0);
  },

  /** The task writes a document of `size` random bytes (and with `ack` waits for the server to hold it); this page finds it. */
  async out(task, size, ack, limitMs) {
    let asked;
    try {
      asked = await ask(task, { size, ack, limitMs });
    } catch (error) {
      return { ok: false, observed: `task: ${error?.message ?? error}` };
    }
    const [doc] = asked.result.docs;
    const got = await reach(doc.url, size, doc.sha256, limitMs);
    await site.removeFromCache(doc.url.slice('automerge:'.length)).catch(() => {});
    return {
      ok: got.ok,
      askMs: asked.askMs,
      when: asked.when,
      taskMs: asked.result.ms,
      flushedMs: asked.result.flushedMs,
      ack: asked.result.ack ?? undefined,
      reachMs: got.ms,
      firstFind: got.firstFind,
      finds: got.finds,
      rejections: shortRejections(got.rejections),
      ...(got.ok ? {} : { observed: got.observed }),
    };
  },

  /** This page makes a document of `size` random bytes and at once asks a task to read it. */
  async in(task, size, limitMs) {
    const content = randomBytes(size);
    const want = await sha256(content);
    const handle = site.create({ content });
    await site.flush([handle.documentId]);
    let asked;
    try {
      asked = await ask(task, { read: handle.url, sha256: want, size, limitMs });
    } catch (error) {
      return { ok: false, observed: `task: ${error?.message ?? error}` };
    }
    await site.removeFromCache(handle.documentId).catch(() => {});
    const r = asked.result;
    return { ok: r.ok, askMs: asked.askMs, when: asked.when, taskMs: r.ms, firstFind: r.firstFind, finds: r.finds, rejections: r.rejections, ...(r.ok ? {} : { observed: r.observed }) };
  },
};
window.ready = true;
