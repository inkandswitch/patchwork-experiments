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
//   another peer, posted on a run worker's port, after its Repo announced
//   itself or before it did: the pool stays linked; a worker's Repo that
//   ends is forgotten alone; a Repo made with an id other than the one the
//   page chose for its link is not heard at all.
// - Kept before reported: the page saves, of the documents a run names,
//   those its link carried, and no other.
// - The gate's claim that a dropped message never carries a change, read
//   off every message it drops: with a page that changes a document many
//   times before the worker names it, and a later worker on the same
//   storage, which the page keeps a sync state for.
// - Ten links at once, each worker writing; then every link taken out, and
//   the page still syncing with a peer of its own.
// - A 5 MB document across the link, and a link taken out in the middle of
//   sending one.
// - A worker's code in another's name and in its own: as the page, the pool,
//   another run worker or a made-up id, before its Repo is made and after,
//   and from a worker linked later, reaches nothing; a leave in its own name
//   and an arrive after it cost no other link anything (the page does not
//   take it back: it only cuts itself off), and its link's end
//   still takes it out. Two costs it could put on the page without bound
//   until the page's end admitted one first word per link and read what it
//   passes: every arrive in its own name made the page's Repo take it for a
//   new peer again (on the stand-in page, with 200 documents open, 2000 of
//   them held the page's main thread for seconds), and every malformed
//   message about a document it named made the page's Repo log an error. Now
//   the page takes it once, and the first malformed message ends its link.
//
// Sample document ids are made up. Real time.

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { stringifyAutomergeUrl, type AutomergeUrl, type DocHandle, type DocumentId, type Repo, type StorageAdapterInterface } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageLinks, gatedAdapterClass, type GatedAdapterClass, type PortAdapterClass } from './link';
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

const make = (network: unknown[] = [], storage = memoryStorage(), peerId = `peer-${crypto.randomUUID()}`) =>
  new SiteRepo({ storage, network, peerId } as any) as unknown as Repo;

/** A worker's Repo on a new link named `name`, made with the peer id the page chose for it, as a worker's is. */
function linkedRepo(links: PageLinks, name: string, storage = memoryStorage()) {
  const { port, peer } = links.open(name);
  return make([new MessageChannelNetworkAdapter(port as any)], storage, peer);
}

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
    const { port, peer } = links.open('worker');
    const heard: any[] = [];
    (port as any).addEventListener('message', (event: MessageEvent) => heard.push(event.data));
    const worker = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
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
// that peer to itself and then cut the pool off. The page names each link's
// one peer, and its end admits that peer's own messages to the page alone
// (link.ts, `LinkGate.fromPort`), whatever order they come in. A message
// addressed to another peer would make the adapter throw in the page; it is
// dropped before the adapter sees it.
describe('the handshake', () => {
  it("is gated: a run worker's code that says 'arrive' and 'leave' in the pool's name does not cut the page off from the pool", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const { port: runPort, peer: runPeer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(runPort as any)], undefined, runPeer));
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
    const pool = keep(linkedRepo(links, 'pool'));
    const { port: runPort, peer: runPeer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(runPort as any)], undefined, runPeer));
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

  // A worker's Repo announces itself only once it has its storage id
  // (NetworkSubsystem connects its adapters after the Repo's peer metadata
  // resolves), and run-worker.ts imports a task's code without waiting for
  // that: on the stand-in page, in 6 of 6 fresh run workers, the code ran at
  // import 5 to 17 ms before its Repo announced itself. Code that has the
  // pool's id there (an earlier run's, kept in the origin's IndexedDB) and
  // speaks first in the pool's name is heard by nothing, since the page named
  // the link's peer, and not as the pool.
  it("a forged arrive and leave in the pool's name, posted before the run worker's Repo announces itself, do not cut the page off from the pool", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const queue = page.create<{ jobs: number }>({ jobs: 0 });
    const poolQueue = await pool.find<{ jobs: number }>(queue.url);
    const adaptersBefore = page.networkSubsystem.adapters.length;

    // the run worker's code, first on its port (no Repo of its own is made: what it would hear is addressed to the pool)
    const { port: runPort } = links.open('run 1');
    runPort.postMessage({ type: 'arrive', senderId: pool.peerId, peerMetadata: { isEphemeral: true } });
    runPort.postMessage({ type: 'leave', senderId: pool.peerId });
    await quiet(300);

    queue.change((d) => void (d.jobs = 1));
    expect({
      reached: await until(() => poolQueue.doc()?.jobs === 1, 2000),
      poolIsPeer: page.peers.includes(pool.peerId),
      adapters: page.networkSubsystem.adapters.length - adaptersBefore,
    }).toEqual({ reached: true, poolIsPeer: true, adapters: 1 });
  }, 15_000);

  it("a run worker whose Repo ends says leave in its own name: the page forgets it alone, its adapter leaves the Repo, and taking the link out after is harmless", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const run = linkedRepo(links, 'run 1');
    const queue = page.create<{ jobs: number }>({ jobs: 0 });
    const poolQueue = await pool.find<{ jobs: number }>(queue.url);
    await run.find<{ jobs: number }>(queue.url);
    expect(page.networkSubsystem.adapters.length).toBe(2);

    await run.shutdown();
    expect(await until(() => !page.peers.includes(run.peerId))).toBe(true);
    expect(page.networkSubsystem.adapters.length).toBe(1);
    links.remove('run 1');
    expect({ links: links.size, adapters: page.networkSubsystem.adapters.length, peers: page.peers }).toEqual({ links: 1, adapters: 1, peers: [pool.peerId] });
    queue.change((d) => void (d.jobs = 1));
    expect(await until(() => poolQueue.doc()?.jobs === 1, 2000)).toBe(true);
  }, 15_000);
});

describe('the page names the peer', () => {
  it("a worker's Repo made with another id than the one the page chose is not heard: the page has no such peer and gives it nothing", async () => {
    const page = keep(make());
    const doc = page.create<{ n: number }>({ n: 1 });
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const { port } = links.open('run 1');
    const stranger = keep(make([new MessageChannelNetworkAdapter(port as any)]));
    const found = stranger.find(doc.url).then(
      () => 'found',
      () => 'unavailable',
    );
    expect(await Promise.race([found, quiet(1500).then(() => 'nothing')])).not.toBe('found');
    expect(page.peers).not.toContain(stranger.peerId);
  }, 15_000);
});

// Kept before reported. Before a linked run is reported, the page saves in
// its Repo the documents the run names (pool-host.ts, `keep`), and of those
// only the ones its link carried: what the worker named on it.
describe('kept before reported', () => {
  it("the page saves, of the documents a run names, those its link carried, and no other; a link that has ended says so", async () => {
    const page = keep(make());
    const flushed: unknown[] = [];
    const flush = page.flush.bind(page);
    (page as any).flush = (documents?: unknown[]) => (flushed.push(documents), flush(documents as never));
    const carried = page.create<{ n: number }>({ n: 1 });
    const notCarried = page.create<{ n: number }>({ n: 1 });
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const worker = keep(linkedRepo(links, 'run 1'));
    const there = await worker.find<{ n: number }>(carried.url);
    there.change((d) => void (d.n = 2));
    expect(await until(() => carried.doc()?.n === 2)).toBe(true);

    await links.keep('run 1', [carried.documentId, notCarried.documentId, 'not-an-id', 7, carried.documentId]);
    expect(flushed).toEqual([[carried.documentId]]);
    await links.keep('run 1', [notCarried.documentId]);
    expect(flushed).toEqual([[carried.documentId]]);
    links.remove('run 1');
    await expect(links.keep('run 1', [carried.documentId])).rejects.toThrow(/ended/);
  }, 15_000);
});

describe('a dropped message never carries a change', () => {
  it('a page that changes a document many times before the worker names it, and a later worker on storage the page keeps a sync state for', async () => {
    const page = keep(make());
    const doc = page.create<{ n: number; log: number[] }>({ n: 0, log: [] });
    for (let i = 1; i <= 100; i++) doc.change((d) => void ((d.n = i), d.log.push(i)));

    // a first worker names it, syncs, and goes
    const storage = memoryStorage();
    const links = new PageLinks(page as any, Watched as unknown as GatedAdapterClass);
    linkSets.push(links);
    const first = linkedRepo(links, 'first', storage);
    const there = await first.find<{ n: number }>(doc.url);
    expect(await until(() => there.doc()?.n === 100)).toBe(true);
    await first.flush();
    links.remove('first');
    await first.shutdown();

    // the page changes it on; a later worker on the same storage (the same storage id) is linked, and the page changes it more before it names it
    for (let i = 101; i <= 130; i++) doc.change((d) => void ((d.n = i), d.log.push(i)));
    const later = keep(linkedRepo(links, 'later', storage));
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
    const workers = Array.from({ length: 10 }, (_, i) => keep(linkedRepo(links, `run ${i}`)));
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

// A third checker's. A run worker's code can reach its own end of its link
// (`ctx.repo.networkSubsystem.adapters[0].messagePortRef.port`) and post
// anything on it, before its Repo is made and after.
describe("a worker's code in another's name and in its own", () => {
  const empty = () => A.generateSyncMessage(A.init(), A.initSyncState())[1]!.slice().buffer;

  it('as the page, the pool, another run worker or a made-up id, before its Repo is made and after, and from a worker linked later: the page keeps its peers and goes on syncing', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const b = keep(linkedRepo(links, 'run 1'));
    const doc = page.create<{ n: number; by?: string }>({ n: 0 });
    const poolDoc = await pool.find<{ n: number; by?: string }>(doc.url);
    const bDoc = await b.find<{ n: number; by?: string }>(doc.url);
    const peersBefore = [...page.peers];

    const { port: cPort, peer: cPeer } = links.open('run 2');
    const speakAs = (port: MessagePort, ids: string[]) => {
      for (const senderId of ids) {
        port.postMessage({ type: 'arrive', senderId, peerMetadata: { isEphemeral: true } });
        port.postMessage({ type: 'welcome', senderId, targetId: page.peerId, peerMetadata: {} });
        port.postMessage({ type: 'sync', senderId, targetId: page.peerId, documentId: doc.documentId, data: empty() });
        port.postMessage({ type: 'leave', senderId });
        port.postMessage({ type: 'leave', senderId, targetId: page.peerId });
      }
    };
    const others = [page.peerId, pool.peerId, b.peerId, 'made-up', `task-link-${crypto.randomUUID()}`];
    speakAs(cPort, others);
    await quiet(200);
    const c = keep(make([new MessageChannelNetworkAdapter(cPort as any)], undefined, cPeer));
    expect(await until(() => c.peers.length > 0)).toBe(true);
    speakAs(cPort, others);
    await quiet(200);
    const { port: dPort, peer: dPeer } = links.open('run 3');
    const d = keep(make([new MessageChannelNetworkAdapter(dPort as any)], undefined, dPeer));
    expect(await until(() => d.peers.length > 0)).toBe(true);
    speakAs(dPort, [...others, cPeer]);
    await quiet(300);

    expect([...page.peers].sort()).toEqual([...peersBefore, cPeer, dPeer].sort());
    expect(page.networkSubsystem.adapters.length).toBe(4);
    doc.change((x) => void (x.n = 1));
    expect(await until(() => poolDoc.doc()?.n === 1 && bDoc.doc()?.n === 1)).toBe(true);
    bDoc.change((x) => void (x.by = 'b'));
    expect(await until(() => doc.doc()?.by === 'b' && poolDoc.doc()?.by === 'b')).toBe(true);
  }, 20_000);

  it("a leave in its own name, messages after it and an arrive again cost no other link anything: the worker only cuts itself off; the link's end still takes it out", async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    const doc = page.create<{ n: number; by?: string }>({ n: 0 });
    const poolDoc = await pool.find<{ n: number; by?: string }>(doc.url);
    const runDoc = await run.find<{ n: number; by?: string }>(doc.url);

    port.postMessage({ type: 'leave', senderId: peer });
    expect(await until(() => !page.peers.includes(peer as never))).toBe(true);
    for (let i = 0; i < 20; i++) port.postMessage({ type: 'sync', senderId: peer, targetId: page.peerId, documentId: doc.documentId, data: empty() });
    port.postMessage({ type: 'arrive', senderId: peer, peerMetadata: { isEphemeral: true } });
    await quiet(300);
    // the page does not take it back: what it writes no longer reaches the page
    expect(page.peers).toEqual([pool.peerId]);
    runDoc.change((x) => void (x.by = 'run'));
    await quiet(300);
    expect(doc.doc()?.by).toBeUndefined();
    doc.change((x) => void (x.n = 1));
    expect(await until(() => poolDoc.doc()?.n === 1)).toBe(true);

    links.remove('run 1');
    expect({ peers: page.peers, adapters: page.networkSubsystem.adapters.length, links: links.size }).toEqual({ peers: [pool.peerId], adapters: 1, links: 1 });
    doc.change((x) => void (x.n = 2));
    expect(await until(() => poolDoc.doc()?.n === 2)).toBe(true);
  }, 20_000);

  it('an arrive in its own name, said again and again, makes the page take it for a new peer once, not each time', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    expect(await until(() => run.peers.length > 0)).toBe(true);
    let taken = 0;
    page.networkSubsystem.on('peer', () => void taken++);
    for (let i = 0; i < 500; i++) port.postMessage({ type: 'arrive', senderId: peer, peerMetadata: { isEphemeral: true } });
    await quiet(500);
    // before the page admitted one first word per link: 500, each running the page's Repo's addPeer over every document it has open
    expect(taken).toBeLessThanOrEqual(1);
  }, 15_000);

  it('malformed messages about a document it named do not make the page log without end', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    const doc = page.create<{ n: number }>({ n: 0 });
    await run.find(doc.url);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 300; i++) {
        port.postMessage({ type: 'sync', senderId: peer, targetId: page.peerId, documentId: doc.documentId, data: crypto.getRandomValues(new Uint8Array(64)).buffer });
      }
      await quiet(500);
      // before the gate read what it passes: one "error handling inbound message" for each of the 300
      expect(errors.mock.calls.length).toBeLessThan(10);
    } finally {
      errors.mockRestore();
    }
  }, 15_000);

  it('the first malformed message ends its link alone: the page forgets that worker, says so once, and goes on with the pool', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const pool = keep(linkedRepo(links, 'pool'));
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    const doc = page.create<{ n: number }>({ n: 0 });
    const poolDoc = await pool.find<{ n: number }>(doc.url);
    await run.find(doc.url);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < 300; i++) {
        port.postMessage({ type: 'sync', senderId: peer, targetId: page.peerId, documentId: doc.documentId, data: crypto.getRandomValues(new Uint8Array(64)).buffer });
      }
      await quiet(500);
      // before the gate read what it passes: one "error handling inbound message" for each of the 300
      expect(errors.mock.calls.length).toBeLessThan(10);
      expect(warnings.mock.calls.filter(([line]) => String(line).startsWith('tasks: the page ended its link')).length).toBe(1);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
    // the page forgot the worker alone, and its adapter left the Repo; the pool goes on
    expect({ peers: page.peers, adapters: page.networkSubsystem.adapters.length }).toEqual({ peers: [pool.peerId], adapters: 1 });
    doc.change((x) => void (x.n = 1));
    expect(await until(() => poolDoc.doc()?.n === 1)).toBe(true);
    links.remove('run 1');
    expect(links.size).toBe(1);
  }, 15_000);
});

// A fifth checker's, kept as it.fails. Three costs a run worker's code can
// still put on the page in its own name, after the gate admits one first word
// and ends a link on a message it cannot read.
//
// - The adapter reads `data` before the gate does: it makes
//   `new Uint8Array(message.data)` of any message that has one, of any type,
//   and only then emits it for the gate to judge. A number that is no length
//   throws there, in the page's port listener (on the stand-in page, 1000 such
//   messages gave 1000 uncaught exceptions, and the link stayed); an
//   array-like `{ length }` is copied element by element on the page's main
//   thread (ten of about 60 bytes each, length 3e7, held it for 3.4 s). A type
//   the gate drops ends nothing, so neither has a bound.
// - A link the page ends (the worker's leave in its own name, or a message it
//   cannot read) leaves the worker as it was: its Repo still takes the page
//   for a peer, and the pool keeps the run worker and hands it the next job
//   (its idle list is last in, first out). On the stand-in page, with the
//   network and without, the next work that wrote a page document on it had
//   no answer in 45 s, and a worker cut off this way was still handed work
//   minutes later.
// - Each `request` for a made-up unprotected id passes, and the page's Repo
//   makes and keeps a handle for it, after the link has ended. On the stand-in
//   page, 5000 of them left 5000 handles, and work asked through the site's
//   Repo ran again only after 100 s with no network, 65 s with it.
describe("what a worker's code can still cost the page in its own name", () => {
  /** A port the test drives by hand, so that what the page's adapter throws as it listens is seen. */
  function handPort() {
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const port = {
      addEventListener: (type: string, listener: (event: { data: unknown }) => void) => void (type === 'message' && listeners.push(listener)),
      removeEventListener: () => {},
      start: () => {},
      close: () => {},
      postMessage: () => {},
    };
    return { port, deliver: (data: unknown) => listeners.forEach((listener) => listener({ data })) };
  }
  /** The page's end of a link to `peer` whose first word has been heard, on a hand-driven port. */
  function openEnd(peer: string) {
    const { port, deliver } = handPort();
    const adapter = new Gated(port as any, peer) as any;
    adapter.connect('page-peer', {});
    deliver({ type: 'arrive', senderId: peer, peerMetadata: {} });
    return { adapter, deliver };
  }

  it.fails('a message to the page whose data is a number throws nothing in the page', () => {
    const { deliver } = openEnd('worker-peer');
    let threw = 0;
    for (let i = 0; i < 20; i++) {
      try {
        deliver({ type: 'anything', senderId: 'worker-peer', targetId: 'page-peer', data: -1 });
      } catch {
        threw++;
      }
    }
    // today: 20, each "Invalid typed array length: -1", and the link stays
    expect(threw).toBe(0);
  });

  it.fails('a message to the page whose data is an array-like of a large length costs the page little', () => {
    const { deliver } = openEnd('worker-peer');
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) {
      try {
        deliver({ type: 'anything', senderId: 'worker-peer', targetId: 'page-peer', data: { length: 5e7 } });
      } catch {
        // what it throws is the case above
      }
    }
    // today: a 50 MB copy each, element by element, before the gate sees it
    expect(performance.now() - t0).toBeLessThan(100);
  }, 30_000);

  it.fails('a worker whose link the page ended is told: its Repo no longer takes the page for a peer', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    const doc = page.create<{ n: number }>({ n: 0 });
    await run.find(doc.url);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // its code, in its own name: a message the page cannot read
      port.postMessage({ type: 'sync', senderId: peer, targetId: page.peerId, documentId: doc.documentId, data: new Uint8Array([1, 2, 3]).buffer });
      expect(await until(() => !page.peers.includes(peer as never))).toBe(true);
    } finally {
      warnings.mockRestore();
    }
    // the pool hands this worker the next job; it waits on a page that no longer hears it
    expect(await until(() => run.peers.length === 0, 2000)).toBe(true);
  }, 15_000);

  it.fails('requests for made-up unprotected ids leave the page no handle once the link has ended', async () => {
    const page = keep(make());
    const links = new PageLinks(page as any, Gated);
    linkSets.push(links);
    const { port, peer } = links.open('run 1');
    const run = keep(make([new MessageChannelNetworkAdapter(port as any)], undefined, peer));
    expect(await until(() => run.peers.length > 0)).toBe(true);
    const before = Object.keys(page.handles).length;
    for (let i = 0; i < 300; i++) {
      port.postMessage({ type: 'request', senderId: peer, targetId: page.peerId, documentId: idOf(crypto.getRandomValues(new Uint8Array(16))), data: empty() });
    }
    await quiet(1000);
    links.remove('run 1');
    await quiet(200);
    // today: 300
    expect(Object.keys(page.handles).length - before).toBeLessThan(10);
  }, 15_000);

  const empty = () => A.generateSyncMessage(A.init(), A.initSyncState())[1]!.slice().buffer;
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
    const worker = keep(linkedRepo(links, 'w'));
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
    const worker = linkedRepo(links, 'w', storage);
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

    const later = keep(linkedRepo(links, 'later', storage));
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
