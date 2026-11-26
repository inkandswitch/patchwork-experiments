// @vitest-environment node
//
// A checker's cases of "What a run wrote" (run-worker.ts) through the local
// link (link.ts), with real Repos: the page's Repo and a run worker's, each
// with storage of its own, joined by the gated MessageChannel as pool-host.ts
// joins them, the run's Repo handed to the code as the run worker hands it
// (`patient`, noting what the run has had from the heads it held as the code
// was called). Each case is timed against the bound it is given:
//
// - a run that reads three documents (two keyhive protects, from the
//   worker's own database, which the page will never take; one from the
//   page) and changes the page's: reported as soon as the page has that one;
// - a run that reads the same three and changes nothing: reported at once;
// - a run that makes a document: reported once the page has it;
// - the sequence of the deployed site's row 3: a run worker stopped mid-run
//   (its change to the session saved in its own database, never sent), the
//   page writing to the session, then a new run worker on that database
//   changing the session: reported once the page has it, the stopped run's
//   change with it;
// - a run whose change the page cannot get (its link gone): said in the log
//   at the bound, naming how many and of what kind, by the start of each id.
// Real time.

import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { initSubduction, stringifyAutomergeUrl, type DocHandle, type DocumentId, type Repo, type StorageAdapterInterface } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, describe, expect, it } from 'vitest';
import { PageLinks, gatedAdapterClass, type PortAdapterClass } from './link';
import { notReachedPage, patient, reachPage } from '../run-worker';

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

const Gated = gatedAdapterClass(MessageChannelNetworkAdapter as unknown as PortAdapterClass);
const site = (options: Record<string, unknown>) => new SiteRepo({ peerId: `peer-${crypto.randomUUID()}`, ...options } as any) as unknown as Repo;
/** A made-up id of 32 bytes with something in its last 16: one keyhive protects, which the link never carries. */
const protectedId = (byte: number) => {
  const bytes = new Uint8Array(32).fill(byte);
  return { bytes, id: (stringifyAutomergeUrl({ documentId: bytes } as any) as string).slice('automerge:'.length) as DocumentId };
};
const urlOf = (bytes: Uint8Array) => stringifyAutomergeUrl({ documentId: bytes } as any);
const headsOf = (repo: Repo) => new Map(Object.entries(repo.handles).map(([id, h]) => [id, (h as DocHandle<unknown>).heads().map(String).sort().join(',')]));
const until = async (done: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
  return done();
};
const own = protectedId(42).id;

describe("a checker's cases: what a run wrote, waited for through the link", () => {
  const opened: { repos: Repo[]; links: PageLinks }[] = [];
  afterEach(async () => {
    for (const { repos, links } of opened.splice(0)) {
      links.removeAll();
      await Promise.all(repos.map((repo) => repo.shutdown?.().catch?.(() => {})));
    }
  });

  /** The page's Repo with a session it made, and a worker's database already holding two protected documents (an account and a catalogue, read by an earlier run). */
  async function stage() {
    const storage = memoryStorage();
    const account = protectedId(7);
    const catalogue = protectedId(8);
    const earlier = site({ storage });
    earlier.import(A.save(A.from({ account: true })), { docId: account.id } as any);
    earlier.import(A.save(A.from({ catalogue: true })), { docId: catalogue.id } as any);
    await earlier.flush();
    await earlier.shutdown();
    const page = site({ storage: memoryStorage() });
    const session = page.create<{ turns: string[] }>({ turns: ['hello'] });
    const links = new PageLinks(page as any, Gated);
    const entry = { repos: [page] as Repo[], links };
    opened.push(entry);
    /** A run worker on the shared database, linked to the page as `name`: its Repo, and that Repo as the code is handed it. */
    const worker = (name: string) => {
      const { port, peer } = links.open(name);
      const repo = site({ storage, network: [new MessageChannelNetworkAdapter(port as any)], peerId: peer });
      entry.repos.push(repo);
      const had = headsOf(repo);
      return { repo, had, code: patient(repo, had) };
    };
    return { page, session, links, worker, storage, account, catalogue };
  }

  /** The code: finds the account, the catalogue and the session through ctx.repo, and reads each. */
  async function readsThree(code: Repo, s: Awaited<ReturnType<typeof stage>>) {
    const account = await code.find<{ account: boolean }>(urlOf(s.account.bytes));
    const catalogue = await code.find<{ catalogue: boolean }>(urlOf(s.catalogue.bytes));
    const session = await code.find<{ turns: string[] }>(s.session.url);
    expect([account.doc(), catalogue.doc(), session.doc()?.turns[0]]).toEqual([{ account: true }, { catalogue: true }, 'hello']);
    return session;
  }

  it('reads three documents (two the page will never take) and changes one: reported as soon as the page has that one', async () => {
    const s = await stage();
    const { repo, had, code } = s.worker('run 1');
    const session = await readsThree(code, s);
    session.change((d) => void d.turns.push('notice: refused'));
    const logs: string[] = [];
    const t0 = Date.now();
    const waiting = reachPage(repo, had, own, (line) => logs.push(line), 10_000, { session: s.session.url });
    expect(waiting).not.toBeNull();
    await waiting;
    const ms = Date.now() - t0;
    expect(s.session.doc()?.turns).toEqual(['hello', 'notice: refused']);
    expect(logs).toEqual([]);
    expect(ms).toBeLessThan(2_000);
  });

  it('reads the same three and changes nothing: nothing to wait for, at once', async () => {
    const s = await stage();
    const { repo, had, code } = s.worker('run 1');
    await readsThree(code, s);
    // the page writes to the session meanwhile; the run only read it
    s.session.change((d) => void d.turns.push('a person typed'));
    await until(() => (repo.handles[s.session.documentId] as DocHandle<any>)?.doc()?.turns?.length === 2);
    const t0 = Date.now();
    const waiting = reachPage(repo, had, own, () => {}, 10_000);
    // others' changes to what it read are the page's own: at most a look to see the page has them
    if (waiting) await waiting;
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('makes a document: reported once the page has it, and the page finds it', async () => {
    const s = await stage();
    const { repo, had, code } = s.worker('run 1');
    await readsThree(code, s);
    const made = code.create<{ made: string }>({ made: 'by the run' });
    const logs: string[] = [];
    const t0 = Date.now();
    await reachPage(repo, had, own, (line) => logs.push(line), 10_000);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(logs).toEqual([]);
    const found = await s.page.find<{ made: string }>(made.url);
    expect(found.doc()).toEqual({ made: 'by the run' });
  });

  it("the deployed site's row 3: a run worker stopped mid-run, the page writes, a new run worker on the same database changes the session: reported once the page has it, the stopped run's change with it", async () => {
    for (let round = 0; round < 3; round++) {
      const s = await stage();
      // the first run: changes the session, saved in its own database, and is ended before it is sent
      const first = s.worker('run 1');
      const there = await readsThree(first.code, s);
      await until(() => s.page.peers.length > 0);
      s.links.remove('run 1');
      there.change((d) => void d.turns.push('half a turn, never sent'));
      await first.repo.flush();
      await first.repo.shutdown();
      expect(s.session.doc()?.turns).toEqual(['hello']);
      // a person stops it, and writes a message
      s.session.change((d) => void d.turns.push('Stopped by a person.'));
      s.session.change((d) => void d.turns.push('And now say hi.'));
      // the next run, on the same database: a refused request, said in the session
      const next = s.worker('run 2');
      const session = await readsThree(next.code, s);
      await until(() => (session.doc()?.turns.length ?? 0) >= 4);
      session.change((d) => void d.turns.push('notice: refused'));
      const logs: string[] = [];
      const t0 = Date.now();
      await reachPage(next.repo, next.had, own, (line) => logs.push(line), 10_000, { session: s.session.url });
      const ms = Date.now() - t0;
      expect([round, logs, ms < 2_000]).toEqual([round, [], true]);
      expect([round, [...(s.session.doc()?.turns ?? [])].sort()]).toEqual([
        round,
        ['And now say hi.', 'Stopped by a person.', 'half a turn, never sent', 'hello', 'notice: refused'].sort(),
      ]);
    }
  });

  it('a change the page cannot get (its link gone): said in the log at the bound, how many and of what kind', async () => {
    const s = await stage();
    const { repo, had, code } = s.worker('run 1');
    const session = await readsThree(code, s);
    s.links.remove('run 1');
    session.change((d) => void d.turns.push('notice: refused'));
    const made = code.create({ made: true });
    const logs: string[] = [];
    const t0 = Date.now();
    await reachPage(repo, had, own, (line) => logs.push(line), 800, { session: s.session.url });
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(790);
    expect(ms).toBeLessThan(1_500);
    expect(logs).toHaveLength(1);
    const [line] = logs;
    // two left, in either order of kind; never a whole url
    expect(line.startsWith(notReachedPage(2, 2, '').slice(0, -1))).toBe(true);
    expect(line).toContain(`named in its input: ${s.session.documentId.slice(0, 6)}…`);
    expect(line).toContain(`made by this run: ${made.documentId.slice(0, 6)}…`);
    expect(line).not.toContain(s.session.documentId);
    expect(line).not.toContain(s.account.id.slice(0, 6));
  });
});
