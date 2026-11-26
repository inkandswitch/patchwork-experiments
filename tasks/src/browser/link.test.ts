// @vitest-environment node
//
// The local link (link.ts): the gate's verdict for every kind of message,
// both ways, in a finite table, and for what arrives on the page's port (the
// handshake, and whose message it is); then a page's Repo and a worker's, each with
// storage of its own and no sync server, joined only by a MessageChannel
// whose page end is gated, as pool-host.ts adds it, and whose worker end is
// the plain MessageChannel adapter, as a worker's Repo takes it, with no
// socket to a sync server, as a linked worker has none (webworker-lib.ts).
// The page's Repo and the worker's are each of the two kinds the tests know:
// the task system's, and the site's (a browser's workers load the site's).
// Real time.

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import {
  initSubduction,
  Repo,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
  type StorageAdapterInterface,
} from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkGate, PageLinks, gatedAdapterClass, isUnprotectedDocId, unprotected, type PortAdapterClass, type Verdict } from './link';
import { notReachedPage, reachPage } from '../run-worker';

await initSubduction();
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

const KINDS = {
  "the task system's Repo": (network: unknown[] = []) => new Repo({ storage: memoryStorage(), network, peerId: `peer-${crypto.randomUUID()}` } as any),
  "the site's Repo": (network: unknown[] = []) => new SiteRepo({ storage: memoryStorage(), network, peerId: `peer-${crypto.randomUUID()}` } as any) as unknown as Repo,
} as const;
const PAIRS = Object.entries(KINDS).flatMap(([pageKind, makePage]) =>
  Object.entries(KINDS).map(([workerKind, makeWorker]) => ({ pageKind, workerKind, makePage: () => makePage(), makeWorker })),
);

const Gated = gatedAdapterClass(MessageChannelNetworkAdapter as unknown as PortAdapterClass);

/** A document id of `bytes` (16 bytes: what a Repo makes; 32: what keyhive protects, unless its last 16 are zero). */
const idOf = (bytes: Uint8Array) => (stringifyAutomergeUrl({ documentId: bytes } as any) as string).slice('automerge:'.length) as DocumentId;
const madeUp = (length: number, byte: number, tail = byte) => {
  const bytes = new Uint8Array(length).fill(byte);
  bytes.fill(tail, 16);
  return bytes;
};

const until = async (done: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  return done();
};
const quiet = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

describe('which documents keyhive leaves unprotected', () => {
  it('an id shorter than 32 bytes, or of 32 whose last 16 are zero; not one of 32 with anything in its last 16', () => {
    expect(isUnprotectedDocId(madeUp(16, 7))).toBe(true);
    expect(isUnprotectedDocId(madeUp(32, 7, 0))).toBe(true);
    expect(isUnprotectedDocId(madeUp(32, 7))).toBe(false);
    const oneByte = madeUp(32, 7, 0);
    oneByte[31] = 1;
    expect(isUnprotectedDocId(oneByte)).toBe(false);
    expect(unprotected(idOf(madeUp(16, 3)))).toBe(true);
    expect(unprotected(idOf(madeUp(32, 3)))).toBe(false);
    expect(unprotected('not a document id')).toBe(false);
  });
});

describe('the gate, for every kind of message', () => {
  const OPEN = idOf(madeUp(16, 1));
  const OTHER = idOf(madeUp(16, 2));
  const SHUT = idOf(madeUp(32, 3));
  const TYPES = ['request', 'sync', 'ephemeral', 'doc-unavailable', 'remote-heads-changed', 'remote-subscription-change', 'subduction', 'arrive'];
  const message = (type: string, documentId?: string) => ({ type, documentId, senderId: 'a', targetId: 'b' });

  it('from the worker: request and sync name an unprotected document and pass, and are refused for a protected one; the rest pass only for a named document', () => {
    for (const type of TYPES) {
      const gate = new LinkGate();
      const naming = type === 'request' || type === 'sync';
      const aboutOne = ['request', 'sync', 'ephemeral', 'doc-unavailable', 'remote-heads-changed'].includes(type);
      const expected: Record<string, Verdict> = {
        unnamed: naming ? 'pass' : 'drop',
        protected: naming ? 'refuse' : 'drop',
        noDocument: 'drop',
      };
      expect([type, gate.fromWorker(message(type, OPEN))]).toEqual([type, expected.unnamed]);
      expect([type, gate.fromWorker(message(type, SHUT))]).toEqual([type, expected.protected]);
      expect([type, gate.fromWorker(message(type))]).toEqual([type, expected.noDocument]);
      expect(gate.named.has(SHUT)).toBe(false);
      // once named, every message about that document passes, and no other document is named by it
      gate.named.add(OPEN);
      expect([type, gate.fromWorker(message(type, OPEN))]).toEqual([type, aboutOne ? 'pass' : 'drop']);
      expect(gate.named.has(OTHER)).toBe(false);
    }
  });

  it('to the worker: only messages about a named document pass; a request for any other is refused, the rest dropped', () => {
    for (const type of TYPES) {
      const gate = new LinkGate();
      const aboutOne = ['request', 'sync', 'ephemeral', 'doc-unavailable', 'remote-heads-changed'].includes(type);
      expect([type, gate.toWorker(message(type, OPEN))]).toEqual([type, type === 'request' ? 'refuse' : 'drop']);
      expect([type, gate.toWorker(message(type, SHUT))]).toEqual([type, type === 'request' ? 'refuse' : 'drop']);
      expect([type, gate.toWorker(message(type))]).toEqual([type, 'drop']);
      gate.fromWorker(message('request', OPEN));
      expect([type, gate.toWorker(message(type, OPEN))]).toEqual([type, aboutOne ? 'pass' : 'drop']);
      expect([type, gate.toWorker(message(type, OTHER))]).toEqual([type, type === 'request' ? 'refuse' : 'drop']);
      // what the page sends never names a document
      expect(gate.named.has(OTHER)).toBe(false);
    }
  });

  it("on the port: the first peer announced is the link's one peer; a later announcement, a leave or message in another's name, and one addressed to another peer are dropped", () => {
    const PAGE = 'page';
    const at = (type: string, senderId: string, targetId?: string) => ({ type, senderId, ...(targetId === undefined ? {} : { targetId }) });
    for (const first of [at('arrive', 'w'), at('welcome', 'w', PAGE)]) {
      const gate = new LinkGate();
      // nothing before the announcement, nor anything that is not a message from a peer
      expect(gate.fromPort(at('sync', 'w', PAGE), PAGE)).toBe(false);
      expect([null, undefined, 'arrive', 7, {}, { type: 'arrive' }, at('arrive', '')].map((m) => gate.fromPort(m, PAGE))).toEqual(Array(7).fill(false));
      expect(gate.fromPort(at('welcome', 'w', 'elsewhere'), PAGE)).toBe(false);
      expect(gate.fromPort(at('arrive', 'w', PAGE), PAGE)).toBe(false);
      expect(gate.peer).toBe(null);
      expect(gate.fromPort(first, PAGE)).toBe(true);
      expect(gate.peer).toBe('w');
      // its messages to the page pass, whatever their type (what they name is the other half's to judge)
      for (const type of TYPES) {
        if (type !== 'arrive') {
          expect([type, gate.fromPort(at(type, 'w', PAGE), PAGE)]).toEqual([type, true]);
        }
      }
      // later announcements, its own too, and anything in another's name or to another peer
      for (const later of [at('arrive', 'w'), at('welcome', 'w', PAGE), at('arrive', 'pool'), at('welcome', 'pool', PAGE)]) {
        expect(gate.fromPort(later, PAGE)).toBe(false);
      }
      expect(gate.fromPort(at('sync', 'pool', PAGE), PAGE)).toBe(false);
      expect(gate.fromPort(at('sync', 'w', 'pool'), PAGE)).toBe(false);
      expect(gate.fromPort(at('sync', 'w'), PAGE)).toBe(false);
      expect(gate.fromPort(at('leave', 'pool'), PAGE)).toBe(false);
      expect(gate.fromPort(at('leave', 'w', 'pool'), PAGE)).toBe(false);
      expect(gate.peer).toBe('w');
      // its own leave passes
      expect(gate.fromPort(at('leave', 'w'), PAGE)).toBe(true);
      // and nothing passes while the page has no id
      expect(gate.fromPort(at('sync', 'w', PAGE), undefined)).toBe(false);
    }
  });
});

for (const { pageKind, workerKind, makePage, makeWorker } of PAIRS) {
  describe(`a page (${pageKind}) linked to a worker (${workerKind})`, () => {
    const opened: { page: Repo; worker: Repo; links: PageLinks }[] = [];
    afterEach(async () => {
      for (const { page, worker, links } of opened.splice(0)) {
        links.removeAll();
        await Promise.all([page.shutdown?.(), worker.shutdown?.()].map((p) => p?.catch?.(() => {})));
      }
    });

    /** The page's Repo, a worker's, and the link between them, its page end gated. */
    function linked(page = makePage()) {
      const links = new PageLinks(page as any, Gated);
      const port = links.open('worker');
      const worker = makeWorker([new MessageChannelNetworkAdapter(port as any)]);
      const link = { page, worker, links, gate: () => (links as any).links.get('worker').adapter.gate as LinkGate };
      opened.push(link);
      return link;
    }
    const connected = (repo: Repo) => until(() => repo.peers.length > 0);

    it('a document the worker asks for crosses, and so do changes to it, both ways', async () => {
      const { page, worker } = linked();
      const doc = page.create<{ n: number; w?: number }>({ n: 1 });
      expect(await connected(worker)).toBe(true);
      const there = await worker.find<{ n: number; w?: number }>(doc.url);
      expect(there.doc()).toEqual({ n: 1 });
      doc.change((d) => void (d.n = 2));
      expect(await until(() => there.doc()?.n === 2)).toBe(true);
      there.change((d) => void (d.w = 1));
      expect(await until(() => doc.doc()?.w === 1)).toBe(true);
    });

    it('the page offers the worker no document the worker has not named: its other open documents stay on the page', async () => {
      const page = makePage();
      const asked = page.create({ asked: true });
      const left = page.create({ secret: 1 });
      const { worker, gate } = linked(page);
      await worker.find(asked.url);
      left.change((d: any) => void (d.secret = 2));
      left.broadcast({ hello: 1 });
      await quiet();
      expect(Object.keys(worker.handles)).toEqual([asked.documentId]);
      expect([...gate().named]).toEqual([asked.documentId]);
    });

    it('a document the worker makes reaches the page, which finds it from the worker', async () => {
      const { page, worker } = linked();
      expect(await connected(page)).toBe(true);
      const made = worker.create<{ made: number }>({ made: 1 });
      made.change((d) => void (d.made = 2));
      expect(await until(() => !!page.handles[made.documentId])).toBe(true);
      const found = await page.find<{ made: number }>(made.url);
      expect(await until(() => found.doc()?.made === 2)).toBe(true);
    });

    it("the page's find of a document the worker has not named is not left waiting on the worker", async () => {
      const { page } = linked();
      expect(await connected(page)).toBe(true);
      const nowhere = stringifyAutomergeUrl({ documentId: madeUp(16, 9) } as any) as AutomergeUrl;
      const answer = await Promise.race([
        page.find(nowhere).then(
          () => 'found',
          () => 'unavailable',
        ),
        quiet(3000).then(() => 'waiting'),
      ]);
      expect(answer).toBe('unavailable');
    });

    it('ephemeral messages cross for a named document, both ways, and not for any other', async () => {
      const page = makePage();
      // with something in them: a document made empty has no history to give
      const named = page.create({ named: true });
      const other = page.create({ other: true });
      const { worker } = linked(page);
      const there = await worker.find(named.url);
      const atWorker: unknown[] = [];
      const atPage: unknown[] = [];
      there.on('ephemeral-message', ({ message }) => void atWorker.push(message));
      named.on('ephemeral-message', ({ message }) => void atPage.push(message));
      await quiet(100);
      named.broadcast({ from: 'page' });
      there.broadcast({ from: 'worker' });
      other.broadcast({ from: 'page, unnamed' });
      expect(await until(() => atWorker.length > 0 && atPage.length > 0)).toBe(true);
      await quiet();
      expect(atWorker).toEqual([{ from: 'page' }]);
      expect(atPage).toEqual([{ from: 'worker' }]);
    });

    it('a protected document is never given to the worker, and one the worker offers is never taken', async () => {
      const page = makePage();
      const shut = idOf(madeUp(32, 5));
      page.import(A.save(A.from({ secret: true })), { docId: shut } as any);
      const { worker } = linked(page);
      expect(await connected(worker)).toBe(true);
      const answer = await Promise.race([
        worker.find(stringifyAutomergeUrl({ documentId: madeUp(32, 5) } as any) as AutomergeUrl).then(
          (handle) => JSON.stringify(handle.doc()),
          () => 'unavailable',
        ),
        quiet(3000).then(() => 'waiting'),
      ]);
      expect(answer).toBe('unavailable');

      const offered = idOf(madeUp(32, 6));
      worker.import(A.save(A.from({ offered: true })), { docId: offered } as any);
      await quiet(300);
      const atPage = page.handles[offered] as DocHandle<any> | undefined;
      expect(atPage?.isReady?.() ? atPage.doc() : undefined).toBeUndefined();
    });

    it('a worker that already has an older copy of a document the page has open gets the page’s changes once it names it, however their first words cross', async () => {
      for (let round = 0; round < 5; round++) {
        const page = makePage();
        const doc = page.create<{ n: number }>({ n: 1 });
        const older = A.save(doc.doc() as A.Doc<{ n: number }>);
        doc.change((d) => void (d.n = 2));
        doc.change((d) => void (d.n = 3));
        const { worker } = linked(page);
        worker.import(older, { docId: doc.documentId } as any);
        const there = await worker.find<{ n: number }>(doc.url);
        expect([round, await until(() => there.doc()?.n === 3)]).toEqual([round, true]);
      }
    });

    it('a link taken out leaves the page working, and the worker without it as a peer', async () => {
      const { page, worker, links } = linked();
      const doc = page.create<{ n: number }>({ n: 1 });
      const there = await worker.find<{ n: number }>(doc.url);
      expect(page.peers).toHaveLength(1);
      links.remove('worker');
      expect(page.peers).toHaveLength(0);
      expect(await until(() => worker.peers.length === 0)).toBe(true);
      doc.change((d) => void (d.n = 2));
      const after = page.create({ after: true });
      await page.flush();
      expect((await page.find<{ after: boolean }>(after.url)).doc()).toEqual({ after: true });
      await quiet();
      expect(there.doc()?.n).toBe(1);
      expect(links.size).toBe(0);
    });

    // The site's Repo, which a browser's workers load, asks its classic peers
    // for a document only once its Subduction source has given up, and one
    // whose server cannot be reached keeps trying. (This package's own Repo,
    // in Node, gives up at once: the case is shown for the site's only.)
    it.runIf(workerKind === "the site's Repo")('why a linked worker has no socket of its own: one to a server it cannot reach keeps it from ever asking the page', async () => {
      const page = makePage();
      const doc = page.create({ here: true });
      const links = new PageLinks(page as any, Gated);
      const port = links.open('worker');
      const worker = new SiteRepo({
        storage: memoryStorage(),
        network: [new MessageChannelNetworkAdapter(port as any)],
        subductionWebsocketEndpoints: ['ws://127.0.0.1:9'],
        peerId: `peer-${crypto.randomUUID()}`,
      } as any) as unknown as Repo;
      opened.push({ page, worker, links });
      const answer = await Promise.race([
        worker.find(doc.url).then(
          () => 'found',
          () => 'unavailable',
        ),
        quiet(3000).then(() => 'still asking its server'),
      ]);
      expect(answer).toBe('still asking its server');
    });

    describe('a run linked to the page is reported once the page has what it wrote', () => {
      const own = idOf(madeUp(16, 42));
      const headsOf = (repo: Repo) => new Map(Object.entries(repo.handles).map(([id, h]) => [id, (h as DocHandle<unknown>).heads().map(String).sort().join(',')]));

      it('a document changed and one made: when it resolves, the page has both as the worker has them', async () => {
        const page = makePage();
        const existing = page.create<{ n: number }>({ n: 1 });
        const { worker } = linked(page);
        const there = await worker.find<{ n: number }>(existing.url);
        const before = headsOf(worker);
        there.change((d) => void (d.n = 2));
        const made = worker.create<{ made: boolean }>({ made: true });
        const logs: string[] = [];
        const waiting = reachPage(worker, before, own, (line) => logs.push(line));
        expect(waiting).not.toBeNull();
        await waiting;
        expect(existing.doc()).toEqual({ n: 2 });
        expect((page.handles[made.documentId] as DocHandle<any>).doc()).toEqual({ made: true });
        expect(logs).toEqual([]);
      });

      it('nothing changed: null, at once', async () => {
        const { worker } = linked();
        worker.create({ x: 1 });
        expect(reachPage(worker, headsOf(worker), own, () => {})).toBeNull();
      });

      it('the link gone, or a document the page will not take: said in the log at the limit', async () => {
        const { worker, links } = linked();
        expect(await connected(worker)).toBe(true);
        const before = headsOf(worker);
        const shut = idOf(madeUp(32, 8));
        worker.import(A.save(A.from({ shut: true })), { docId: shut } as any);
        const logs: string[] = [];
        await reachPage(worker, before, own, (line) => logs.push(line), 500);
        expect(logs).toEqual([notReachedPage(1, 1)]);

        links.remove('worker');
        await until(() => worker.peers.length === 0);
        const before2 = headsOf(worker);
        worker.create({ alone: true });
        const logs2: string[] = [];
        await reachPage(worker, before2, own, (line) => logs2.push(line), 300);
        expect(logs2).toEqual([notReachedPage(1, 1)]);
      });
    });
  });
}
