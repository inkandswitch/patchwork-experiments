// @vitest-environment node
//
// A checker's cases of the local link (link.ts), beside link.test.ts: real
// Repos of the site's kind (a browser's workers load the site's), each with
// storage of its own and no sync server, joined only by MessageChannels
// whose page ends are gated as pool-host.ts adds them.
//
// - What a worker's code can post on its port by hand, past its own Repo:
//   a protected document named in any other field, or in another spelling,
//   gets it nothing.
// - The handshake, and messages in another peer's name or addressed to
//   another peer, posted on a run worker's port: the pool stays linked.
// - The gate's claim that a dropped message never carries a change, read
//   off every message it drops: with a page that changes a document many
//   times before the worker names it, and a later worker on the same
//   storage, which the page keeps a sync state for.
// - Ten links at once, each worker writing; then every link taken out, and
//   the page still syncing with a peer of its own.
// - A 5 MB document across the link, and a link taken out in the middle of
//   sending one.
//
// Sample document ids are made up. Real time.

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { stringifyAutomergeUrl, type AutomergeUrl, type DocHandle, type DocumentId, type Repo, type StorageAdapterInterface } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, describe, expect, it } from 'vitest';
import { PageLinks, gatedAdapterClass, type PortAdapterClass } from './link';
import { reachPage } from '../run-worker';

await initSiteSubduction();

function memoryStorage(): StorageAdapterInterface {
  const kept = new Map<string, Uint8Array>();
  const name = (key: string[]) => key.join('\u0000');
  return {
    load: async (key) => kept.get(name(key)),
    loadRange: async (prefix) =>
      [...kept.entries()].filter(([key]) => key.startsWith(name(prefix))).map(([key, data]) => ({ key: key.split('\u0000'), data })),
    save: async (key, data) => void kept.set(name(key), data),
    saveBatch: async (entries: [string[], Uint8Array][]) => entries.forEach(([key, data]) => kept.set(name(key), data)),
    remove: async (key) => void kept.delete(name(key)),
    removeRange: async (prefix) => [...kept.keys()].filter((key) => key.startsWith(name(prefix))).forEach((key) => kept.delete(key)),
  } as StorageAdapterInterface;
}

const make = (network: unknown[] = [], storage = memoryStorage()) =>
  new SiteRepo({ storage, network, peerId: `peer-${crypto.randomUUID()}` } as any) as unknown as Repo;

const Gated = gatedAdapterClass(MessageChannelNetworkAdapter as unknown as PortAdapterClass);

/** Every sync or request message the page's end of a link drops or refuses on its way to the worker, with how many changes it carried. */
const droppedToWorker: { type: string; documentId: string; changes: number }[] = [];
class Watched extends (Gated as unknown as PortAdapterClass) {
  send(message: any) {
    const verdict = (this as any).gate.toWorker(message);
    if (verdict !== 'pass' && (message.type === 'sync' || message.type === 'request')) {
      droppedToWorker.push({ type: message.type, documentId: message.documentId, changes: A.decodeSyncMessage(message.data).changes.length });
    }
    super.send(message);
  }
}

const idOf = (bytes: Uint8Array) => (stringifyAutomergeUrl({ documentId: bytes } as any) as string).slice('automerge:'.length) as DocumentId;
const madeUp = (length: number, byte: number, tail = byte) => {
  const bytes = new Uint8Array(length).fill(byte);
  bytes.fill(tail, 16);
  return bytes;
};
const urlOf = (id: string) => `automerge:${id}` as AutomergeUrl;

const until = async (done: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  return done();
};
const quiet = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const headsOf = (repo: Repo) => new Map(Object.entries(repo.handles).map(([id, h]) => [id, (h as DocHandle<unknown>).heads().map(String).sort().join(',')]));
const OWN = idOf(madeUp(16, 42));

const opened: Repo[] = [];
const linkSets: PageLinks[] = [];
afterEach(async () => {
  for (const links of linkSets.splice(0)) links.removeAll();
  await Promise.all(opened.splice(0).map((repo) => repo.shutdown?.().catch?.(() => {})));
  droppedToWorker.length = 0;
});
const keep = (repo: Repo) => (opened.push(repo), repo);

/** A peer of the page's own, ungated (the site's other classic peers stand for it): the page and it, joined. */
function everyoneElse(page: Repo) {
  const { port1, port2 } = new MessageChannel();
  page.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(port1 as any) as any);
  return keep(make([new MessageChannelNetworkAdapter(port2 as any)]));
}

/** Whether the page and `other` still sync both ways: a change on each reaches the other. */
async function stillSyncing(page: Repo, other: Repo) {
  const doc = page.create<{ from?: string; back?: string }>({ from: 'page' });
  const there = await Promise.race([other.find<{ from?: string; back?: string }>(doc.url), quiet(3000).then(() => null)]);
  if (!there || !(await until(() => there.doc()?.from === 'page'))) return false;
  there.change((d) => void (d.back = 'other'));
  return until(() => doc.doc()?.back === 'other');
}

describe("what a worker's code posts on its port by hand", () => {
  it('a protected document named in another field, or spelt another way, gets it nothing; the page goes on syncing', async () => {
    const page = keep(make());
    const open = page.create<{ open: boolean }>({ open: true });
    const shutBytes = madeUp(32, 5);
    const SHUT = idOf(shutBytes);
    page.import(A.save(A.from({ secret: true })), { docId: SHUT } as any);
    const other = everyoneElse(page);
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const port = links.open('worker');
    const heard: any[] = [];
    (port as any).addEventListener('message', (event: MessageEvent) => heard.push(event.data));
    const worker = keep(make([new MessageChannelNetworkAdapter(port as any)]));
    expect(await until(() => worker.peers.length > 0)).toBe(true);

    const data = A.generateSyncMessage(A.init(), A.initSyncState())[1]!;
    const raw = (message: Record<string, unknown>) => {
      const copy = data.slice().buffer;
      port.postMessage({ senderId: worker.peerId, targetId: page.peerId, data: copy, ...message });
    };
    // a protected id in other spellings
    for (const spelling of [`automerge:${SHUT}`, `${SHUT}#${SHUT}`, ` ${SHUT}`, `${SHUT} `, SHUT.toLowerCase(), `${SHUT}/x`]) {
      raw({ type: 'request', documentId: spelling });
      raw({ type: 'sync', documentId: spelling });
    }
    // named inside a message about a document the worker may have
    raw({ type: 'sync', documentId: open.documentId, url: urlOf(SHUT), documentIds: [SHUT], target: SHUT });
    raw({ type: 'request', documentId: open.documentId, also: { documentId: SHUT } });
    raw({ type: 'remote-subscription-change', documentId: SHUT, add: [], remove: [] });
    raw({ type: 'remote-heads-changed', documentId: SHUT, newHeads: {} });
    raw({ type: 'ephemeral', documentId: open.documentId, count: 1, sessionId: 's', data: new TextEncoder().encode(urlOf(SHUT)).buffer });
    raw({ type: 'doc-unavailable', documentId: SHUT });
    await quiet(500);

    const aboutShut = heard.filter((message) => typeof message?.documentId === 'string' && message.documentId.includes(SHUT.slice(0, 20)));
    expect(aboutShut.every((message) => message.type === 'doc-unavailable')).toBe(true);
    expect(heard.filter((message) => message?.type === 'sync' || message?.type === 'ephemeral').map((message) => message.documentId).filter((id) => id !== open.documentId)).toEqual([]);
    // what the worker's Repo holds of the protected document: nothing
    expect((worker.handles[SHUT] as DocHandle<any> | undefined)?.isReady?.() ? worker.handles[SHUT].doc() : undefined).toBeUndefined();
    // the document it named in the usual way still crosses, and the page still syncs with its own peer
    expect((await worker.find<{ open: boolean }>(open.url)).doc()).toEqual({ open: true });
    expect(await stillSyncing(page, other)).toBe(true);
  }, 15_000);
});

// The handshake. A Repo routes its messages for a peer through the adapter
// that last announced that peer ("a replacement connection"), and forgets a
// peer whose adapter says it left. So a run worker's code that knows another
// peer's id (here the pool's, from an ephemeral message the page relays with
// its sender's id) and says 'arrive' and 'leave' in that peer's name on its
// own port would, were the handshake not gated, turn the page's messages for
// that peer to itself and then cut the pool off. The page's end keeps the one
// peer its link first announced (link.ts, `LinkGate.fromPort`). A message
// addressed to another peer would make the adapter throw in the page; it is
// dropped before the adapter sees it.
describe('the handshake', () => {
  it("is gated: a run worker's code that says 'arrive' and 'leave' in the pool's name does not cut the page off from the pool", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(make([new MessageChannelNetworkAdapter(links.open('pool') as any)]));
    const runPort = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(runPort as any)]));
    const queue = page.create<{ jobs: number }>({ jobs: 0 });
    const poolQueue = await pool.find<{ jobs: number }>(queue.url);
    const runQueue = await run.find<{ jobs: number }>(queue.url);
    const senders: string[] = [];
    runQueue.on('ephemeral-message', ({ senderId }) => void senders.push(senderId));
    await quiet(100);
    poolQueue.broadcast({ type: 'serving' });
    expect(await until(() => senders.length > 0)).toBe(true);
    const learned = senders[0];
    queue.change((d) => void (d.jobs = 1));
    expect(await until(() => poolQueue.doc()?.jobs === 1)).toBe(true);

    // the run worker's code, past its Repo: its Repo stops listening (so the page's answers addressed to the pool are not read there), and it speaks on the port
    (run.networkSubsystem.adapters[0] as any).messagePortRef.stop();
    runPort.postMessage({ type: 'arrive', senderId: learned, peerMetadata: { isEphemeral: true } });
    runPort.postMessage({ type: 'leave', senderId: learned });
    await quiet(300);
    queue.change((d) => void (d.jobs = 2));
    // what should be true: the page still syncs with the pool, and has it as a peer
    expect(await until(() => poolQueue.doc()?.jobs === 2, 2000)).toBe(true);
    expect(page.peers).toContain(pool.peerId);
  }, 15_000);

  it("messages in the pool's name, a second welcome, and messages addressed to another peer reach nothing and throw nothing in the page; the run worker's own still cross", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(make([new MessageChannelNetworkAdapter(links.open('pool') as any)]));
    const runPort = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(runPort as any)]));
    const queue = page.create<{ jobs: number; by?: string }>({ jobs: 0 });
    const poolQueue = await pool.find<{ jobs: number; by?: string }>(queue.url);
    const runQueue = await run.find<{ jobs: number; by?: string }>(queue.url);
    await quiet(100);

    // a sync in the pool's name that says it has nothing (were it read, the page would take the pool for empty), welcomes, and messages addressed elsewhere
    const empty = A.generateSyncMessage(A.init(), A.initSyncState())[1]!;
    const raw = (message: Record<string, unknown>) => runPort.postMessage({ data: empty.slice().buffer, ...message });
    raw({ type: 'sync', senderId: pool.peerId, targetId: page.peerId, documentId: queue.documentId });
    raw({ type: 'request', senderId: pool.peerId, targetId: page.peerId, documentId: queue.documentId });
    raw({ type: 'welcome', senderId: pool.peerId, targetId: page.peerId });
    raw({ type: 'welcome', senderId: run.peerId, targetId: page.peerId });
    raw({ type: 'sync', senderId: run.peerId, targetId: pool.peerId, documentId: queue.documentId });
    raw({ type: 'sync', senderId: run.peerId, targetId: 'someone-else', documentId: queue.documentId });
    raw({ type: 'leave', senderId: run.peerId, targetId: pool.peerId });
    raw({ type: 'leave', senderId: pool.peerId });
    await quiet(300);

    expect(page.peers.sort()).toEqual([pool.peerId, run.peerId].sort());
    queue.change((d) => void (d.jobs = 3));
    expect(await until(() => poolQueue.doc()?.jobs === 3 && runQueue.doc()?.jobs === 3, 2000)).toBe(true);
    runQueue.change((d) => void (d.by = 'run'));
    expect(await until(() => queue.doc()?.by === 'run' && poolQueue.doc()?.by === 'run', 2000)).toBe(true);
  }, 15_000);
});

describe('a dropped message never carries a change', () => {
  it('a page that changes a document many times before the worker names it, and a later worker on storage the page keeps a sync state for', async () => {
    const page = keep(make());
    const doc = page.create<{ n: number; log: number[] }>({ n: 0, log: [] });
    for (let i = 1; i <= 100; i++) doc.change((d) => void ((d.n = i), d.log.push(i)));

    // a first worker names it, syncs, and goes
    const storage = memoryStorage();
    const links = new PageLinks(page as any, Watched as unknown as PortAdapterClass);
    linkSets.push(links);
    const first = make([new MessageChannelNetworkAdapter(links.open('first') as any)], storage);
    const there = await first.find<{ n: number }>(doc.url);
    expect(await until(() => there.doc()?.n === 100)).toBe(true);
    await first.flush();
    links.remove('first');
    await first.shutdown();

    // the page changes it on; a later worker on the same storage (the same storage id) is linked, and the page changes it more before it names it
    for (let i = 101; i <= 130; i++) doc.change((d) => void ((d.n = i), d.log.push(i)));
    const later = keep(make([new MessageChannelNetworkAdapter(links.open('later') as any)], storage));
    expect(await until(() => later.peers.length > 0)).toBe(true);
    for (let i = 131; i <= 150; i++) {
      doc.change((d) => void ((d.n = i), d.log.push(i)));
      await quiet(5);
    }
    await quiet(200);
    const droppedBeforeNaming = droppedToWorker.filter((message) => message.documentId === doc.documentId);
    const found = await later.find<{ n: number; log: number[] }>(doc.url);
    expect(await until(() => found.doc()?.n === 150)).toBe(true);
    expect(found.doc()?.log).toHaveLength(150);
    // the page did offer it, and every offer dropped carried nothing
    expect(droppedBeforeNaming.length).toBeGreaterThan(0);
    expect(droppedToWorker.filter((message) => message.changes > 0)).toEqual([]);
  }, 20_000);
});

describe('ten links at once', () => {
  it('ten workers write at once; each run is reported once the page has what it wrote; all taken out, the page has no link left and still syncs with its own peer', async () => {
    const page = keep(make());
    const other = everyoneElse(page);
    const shared = page.create<{ counts: Record<string, number> }>({ counts: {} });
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const adaptersBefore = page.networkSubsystem.adapters.length;
    const workers = Array.from({ length: 10 }, (_, i) => keep(make([new MessageChannelNetworkAdapter(links.open(`run ${i}`) as any)])));
    expect(links.size).toBe(10);
    expect(page.networkSubsystem.adapters.length).toBe(adaptersBefore + 10);

    const runs = await Promise.all(
      workers.map(async (worker, i) => {
        const there = await worker.find<{ counts: Record<string, number> }>(shared.url);
        const before = headsOf(worker);
        const own = worker.create<{ by: number; n: number }>({ by: i, n: 0 });
        for (let k = 1; k <= 20; k++) {
          there.change((d) => void (d.counts[`w${i}`] = k));
          own.change((d) => void (d.n = k));
          await quiet(10 + Math.random() * 20);
        }
        const logs: string[] = [];
        const t0 = Date.now();
        await reachPage(worker, before, OWN, (line) => logs.push(line), 15_000);
        return { own: own.documentId, logs, ms: Date.now() - t0 };
      }),
    );
    // reported, and when each was, the page had what it wrote
    expect(runs.flatMap((run) => run.logs)).toEqual([]);
    for (const [i, run] of runs.entries()) {
      expect((page.handles[run.own] as DocHandle<any>).doc()).toEqual({ by: i, n: 20 });
    }
    expect(shared.doc()?.counts).toEqual(Object.fromEntries(workers.map((_, i) => [`w${i}`, 20])));

    links.removeAll();
    expect(links.size).toBe(0);
    expect(page.networkSubsystem.adapters.length).toBe(adaptersBefore);
    expect(page.peers).toEqual([other.peerId]);
    expect(await stillSyncing(page, other)).toBe(true);
  }, 30_000);
});

describe('a 5 MB document', () => {
  const blob = (bytes: number) => {
    const out = new Uint8Array(bytes);
    for (let at = 0; at < bytes; at += 65536) crypto.getRandomValues(out.subarray(at, Math.min(bytes, at + 65536)));
    return out;
  };

  it('crosses the link, and the run is reported once the page has it', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const worker = keep(make([new MessageChannelNetworkAdapter(links.open('w') as any)]));
    expect(await until(() => worker.peers.length > 0)).toBe(true);
    const before = headsOf(worker);
    const big = worker.create<{ blob: Uint8Array }>({ blob: blob(5 * 1024 * 1024) });
    const logs: string[] = [];
    await reachPage(worker, before, OWN, (line) => logs.push(line), 20_000);
    expect(logs).toEqual([]);
    expect((page.handles[big.documentId] as DocHandle<{ blob: Uint8Array }>).doc()?.blob.byteLength).toBe(5 * 1024 * 1024);
  }, 30_000);

  it('a link taken out in the middle of sending one leaves the page syncing with its own peer and with no link; a later worker on the same storage sends it whole', async () => {
    const page = keep(make());
    const other = everyoneElse(page);
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const adaptersBefore = page.networkSubsystem.adapters.length;
    const storage = memoryStorage();
    const worker = make([new MessageChannelNetworkAdapter(links.open('w') as any)], storage);
    expect(await until(() => worker.peers.length > 0)).toBe(true);
    const value = blob(5 * 1024 * 1024);
    const big = worker.create<{ blob: Uint8Array }>({ blob: value });
    await worker.flush();
    // the worker is ended mid-sync
    links.remove('w');
    await worker.shutdown();
    expect(page.networkSubsystem.adapters.length).toBe(adaptersBefore);
    expect(page.peers).toEqual([other.peerId]);
    expect(await stillSyncing(page, other)).toBe(true);

    const later = keep(make([new MessageChannelNetworkAdapter(links.open('later') as any)], storage));
    const mine = await later.find<{ blob: Uint8Array }>(big.url);
    expect(mine.doc()?.blob.byteLength).toBe(value.byteLength);
    const before = headsOf(later);
    mine.change((d) => void ((d as any).touched = true));
    const logs: string[] = [];
    await reachPage(later, before, OWN, (line) => logs.push(line), 20_000);
    expect(logs).toEqual([]);
    const atPage = page.handles[big.documentId] as DocHandle<{ blob: Uint8Array; touched?: boolean }>;
    expect(atPage.doc()?.touched).toBe(true);
    expect(atPage.doc()?.blob).toEqual(value);
  }, 40_000);
});
