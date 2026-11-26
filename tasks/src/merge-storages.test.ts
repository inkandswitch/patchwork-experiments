// @vitest-environment node
//
// Two task storage documents made at once, and linked into one account at
// once (M1 to M3): the account is in the site's Repo, whose Automerge is
// another copy than the page's own, so the first case shows that the page's
// Automerge (what helpers.ts imports) reads the account's conflicts through
// the site's handles at all. Then `mergeStorages` moves what the losing
// document lists into the winner, once.

import { Repo as SiteRepo, initSubduction } from 'site-automerge-repo';
import { getConflicts } from '@automerge/automerge/slim';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeStorages, storageLosersOf } from './helpers';
import { TASKS_STORAGE_ID, markOf, marksOf, ownQueue, ownQueueOf, servedOf, setServed, sparesOf, storageUrlOf } from './task-client.js';

await initSubduction();

const S1 = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P';
const S2 = 'automerge:3x7cLUJEpjP2EvgFz948PS6YhfhK';
const OTHER = 'automerge:bstquQmZKqNMFBRgzm57aYAKFgX';

const g = globalThis as any;
afterEach(() => {
  delete g.accountDocHandle;
});

const newRepo = () => new SiteRepo({ network: [] } as any);

/**
 * One account on two devices that have not met: each Repo has a replica,
 * which are then changed apart. `base` is what the account held before they
 * parted.
 */
function apart(base: object) {
  const one = newRepo();
  const two = newRepo();
  const a = one.create<any>(base);
  const b = two.create<any>({});
  b.merge(a as any);
  return { one, two, a, b };
}

/** What a device's provider and `ownQueue` make: a storage document in `repo`, with own in it. */
async function storageWithOwn(repo: any) {
  const storage = repo.create({ '@patchwork': { type: 'patchwork:tool-storage' } });
  g.accountDocHandle = { doc: () => ({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } }) };
  const own = await ownQueue(repo);
  return { storage, own };
}

describe("the account's conflicts, read with the page's Automerge through the site's handles", () => {
  it('two links written into one map at once: both are read, and the one that lost is a loser', () => {
    const { a, b } = apart({ toolStorage: {} });
    a.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = S1));
    b.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = S2));
    a.merge(b as any);
    expect(Object.values(getConflicts(a.doc().toolStorage, TASKS_STORAGE_ID) ?? {}).sort()).toEqual([S1, S2].sort());
    const winner = storageUrlOf(a.doc());
    expect([S1, S2]).toContain(winner);
    expect(storageLosersOf(a.doc())).toEqual([winner === S1 ? S2 : S1]);
  });

  it("two toolStorage maps written at once, each with a link: the losing map's link is a loser", () => {
    const { a, b } = apart({});
    a.change((doc: any) => (doc.toolStorage = { [TASKS_STORAGE_ID]: S1, other: OTHER }));
    b.change((doc: any) => (doc.toolStorage = { [TASKS_STORAGE_ID]: S2 }));
    a.merge(b as any);
    const maps = Object.values(getConflicts(a.doc(), 'toolStorage') ?? {}) as any[];
    expect(maps.map((map) => map[TASKS_STORAGE_ID]).sort()).toEqual([S1, S2].sort());
    const winner = storageUrlOf(a.doc());
    expect(storageLosersOf(a.doc())).toEqual([winner === S1 ? S2 : S1]);
  });

  it('none for an account with one link, none, or that is no Automerge document', () => {
    const { a } = apart({ toolStorage: { [TASKS_STORAGE_ID]: S1 } });
    expect(storageLosersOf(a.doc())).toEqual([]);
    expect(storageLosersOf(apart({}).a.doc())).toEqual([]);
    for (const account of [undefined, null, {}, { toolStorage: { [TASKS_STORAGE_ID]: S1 } }]) {
      expect(storageLosersOf(account)).toEqual([]);
    }
  });
});

describe('mergeStorages', () => {
  for (const how of ['two links written into one map at once', 'two toolStorage maps written at once'] as const) {
    it(`${how}: the winner gets the loser's marks and served queues, keeps its own own, the loser keeps its marks and own and serves nothing more, and a second merge changes nothing`, async () => {
      const { one, a, b } = apart(how === 'two links written into one map at once' ? { toolStorage: {} } : {});
      // both storage documents are had in the first device's Repo, as they are once the devices meet
      const first = await storageWithOwn(one);
      const second = await storageWithOwn(one);
      second.storage.change((doc: any) => setServed(doc, OTHER, { packages: ['automerge:pkg'] }));
      if (how === 'two links written into one map at once') {
        a.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = first.storage.url));
        b.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = second.storage.url));
      } else {
        a.change((doc: any) => (doc.toolStorage = { [TASKS_STORAGE_ID]: first.storage.url }));
        b.change((doc: any) => (doc.toolStorage = { [TASKS_STORAGE_ID]: second.storage.url }));
      }
      a.merge(b as any);
      const won = storageUrlOf(a.doc()) === first.storage.url ? first : second;
      const lost = won === first ? second : first;
      expect(storageLosersOf(a.doc())).toEqual([lost.storage.url]);
      const lostOwn = lost.own;

      await mergeStorages(one, a.doc());
      const w = won.storage.doc();
      expect(ownQueueOf(w)).toBe(won.own);
      expect(marksOf(w)).toEqual([won.own, lostOwn].sort());
      expect(sparesOf(w)).toEqual([lostOwn]);
      expect(servedOf(w)).toEqual({ [won.own]: true, [lostOwn]: true, [OTHER]: { packages: ['automerge:pkg'] } });
      const l = lost.storage.doc();
      expect(ownQueueOf(l)).toBe(lostOwn);
      expect(l[markOf(lostOwn)]).toBe(true);
      expect(servedOf(l)).toEqual({});

      const heads = [won.storage.heads(), lost.storage.heads()];
      await mergeStorages(one, a.doc());
      expect([won.storage.heads(), lost.storage.heads()]).toEqual(heads);
    });
  }

  it("a winner with no own takes the loser's, with its mark, as a making that saw none would", async () => {
    // Which link wins is Automerge's choice, by the replicas' actors: tried until the empty document wins.
    for (let tries = 0; tries < 50; tries++) {
      const { one, a, b } = apart({ toolStorage: {} });
      const empty = one.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
      const full = await storageWithOwn(one);
      a.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = empty.url));
      b.change((doc: any) => (doc.toolStorage[TASKS_STORAGE_ID] = full.storage.url));
      a.merge(b as any);
      if (storageUrlOf(a.doc()) !== empty.url) {
        continue;
      }
      await mergeStorages(one, a.doc());
      expect(ownQueueOf(empty.doc())).toBe(full.own);
      expect(marksOf(empty.doc())).toEqual([full.own]);
      expect(servedOf(empty.doc())).toEqual({ [full.own]: true });
      return;
    }
    throw new Error('the empty document never won');
  });
});
