// @vitest-environment node
//
// An independent check of `settles` and `foldStep` in task-rules.js,
// written from the header's words and the specification's table, not from the
// rules' helpers. The expectations below are written out again here, so that
// a rule and its test cannot share a mistake.
//
// 1. settles: every task shape a pool can hold (records before and after its
//    run, of every status, malformed ones included), every way an earlier open
//    run can be known (heard, first seen, never shown, lapsed), every key
//    reading, at times around a beat and a lapse.
// 2. foldStep: every combination of what can be under the spare's key, the
//    task it names, what is under own's key and the task that names, each of
//    them malformed in the ways the other readers tolerate (see recordsOf).
//    Each step a well-formed row gives is applied to real Automerge documents
//    and checked to lose nothing and to leave nothing for a second step.
// 3. Replicas: two and three replicas, each with a queue made apart, asking
//    under keys of their own and one shared key, folding, ending tasks and
//    syncing in every order of a fixed set of events; then healed. Checked:
//    F1 nothing is lost, F2 each task is listed into fewer queues than there
//    are marks and passes stop changing anything, F3 every replica has the
//    same documents and own lists what every spare lists.

import * as A from '@automerge/automerge';
import { stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { describe, expect, it } from 'vitest';
import {
  BEAT_MS,
  claimRun,
  delistTask,
  endRun,
  foldStep,
  Hearing,
  isEntry,
  LAPSE_MS,
  listTask,
  NOT_HAD,
  settles,
} from './task-rules.js';

/** A made-up url from fixed bytes. */
const madeUp = (n: number) => stringifyAutomergeUrl(new Uint8Array(16).fill(n) as any);

const H = 1_000_000; // when the pool's taking was saved

// ---------------------------------------------------------------------------
// 1. settles

describe('settles', () => {
  const mine = { id: 'm', pool: 'P', start: H };
  const open = (id: string) => ({ id, pool: 'Q', start: H - 1 });
  const done = (id: string, status: string) => ({ id, pool: 'Q', start: H - 1, end: H - 1, status });
  const stop = (id: string) => ({ id, start: H - 1, end: H - 1, status: 'cancelled' });

  // The task as the pool holding run m sees it. `e` is the only other run that
  // can be open; how it is known is crossed with every shape below.
  const shapes: [string, any][] = [
    ['m alone', { runs: [mine] }],
    ['earlier open e', { runs: [open('e'), mine] }],
    ['earlier e succeeded', { runs: [done('e', 'succeeded'), mine] }],
    ['earlier e failed', { runs: [done('e', 'failed'), mine] }],
    ['earlier e cancelled by its pool', { runs: [done('e', 'cancelled'), mine] }],
    ['earlier e lost', { runs: [done('e', 'lost'), mine] }],
    ['earlier e yielded', { runs: [done('e', 'yielded'), mine] }],
    ['earlier stop', { runs: [stop('s'), mine] }],
    ['later e succeeded', { runs: [mine, done('e', 'succeeded')] }],
    ['later e failed', { runs: [mine, done('e', 'failed')] }],
    ['later e lost', { runs: [mine, done('e', 'lost')] }],
    ['later open e', { runs: [mine, open('e')] }],
    ['later stop', { runs: [mine, stop('s')] }],
    ['earlier lost, then earlier open e', { runs: [done('x', 'lost'), open('e'), mine] }],
    ['m completed lost', { runs: [{ ...mine, end: H, status: 'lost' }] }],
    ['m completed succeeded', { runs: [{ ...mine, end: H, status: 'succeeded' }] }],
    ['m not listed', { runs: [open('e')] }],
    ['no runs at all', {}],
    ['runs not a list', { runs: 'm' }],
    ['junk records, then m', { runs: [null, 3, 'm', mine] }],
    ['junk, earlier open e, m', { runs: [null, open('e'), 7, mine] }],
  ];

  // How the pool knows e, given as when it first saw e and when it last heard
  // e's pool, both relative to H; `null` first sight means e was never shown.
  const knowings: [string, number | null, number | null][] = [
    ['e heard after the taking', 0, 100],
    ['e first seen at the taking, never heard', 0, null],
    ['e first seen a lapse before the taking, never heard', -LAPSE_MS, null],
    ['e last heard just under a lapse before the taking', -LAPSE_MS, -LAPSE_MS + 1],
    ['e never shown before it is asked about', null, null],
  ];

  const elapsed = [-1, 0, 1, BEAT_MS - 1, BEAT_MS, BEAT_MS + 1, LAPSE_MS - 1, LAPSE_MS, LAPSE_MS + 1, 3 * LAPSE_MS];
  const isses = ['this', 'other', 'none'] as const;

  const FINAL = ['succeeded', 'failed', 'cancelled'];
  const records = (task: any) =>
    Array.isArray(task.runs) ? task.runs.filter((r: any) => r && typeof r === 'object') : [];

  // The header's words: held for a beat and nothing stops it. What stops it:
  // it is not this pool's open run; the work is done anywhere; the task is
  // stopped (any cancelled record); a run before it ended the task; the key
  // names another; an earlier open run is heard.
  function expected(task: any, is: string, earlierHeard: boolean, dt: number) {
    const rs = records(task);
    const at = rs.findIndex((r: any) => r.id === 'm');
    let stopped =
      at < 0 ||
      rs[at].status !== undefined ||
      rs.some((r: any) => r.status === 'succeeded') ||
      rs.some((r: any) => r.status === 'cancelled') ||
      rs.slice(0, Math.max(at, 0)).some((r: any) => FINAL.includes(r.status)) ||
      is === 'other';
    if (!stopped && rs.slice(0, at).some((r: any) => r.id === 'e' && r.status === undefined)) {
      stopped = earlierHeard;
    }
    return dt >= BEAT_MS && !stopped;
  }

  it('is true exactly when the run has been held a beat and nothing stops it, in every case', () => {
    const wrong: string[] = [];
    let rows = 0;
    for (const [shape, task] of shapes) {
      for (const [knowing, seen, heardAt] of knowings) {
        for (const dt of elapsed) {
          for (const is of isses) {
            const clock = { t: 0, now() { return this.t; } };
            const hearing = new Hearing(clock);
            if (seen !== null) {
              clock.t = H + seen;
              hearing.saw([{ id: 'e' }]);
            }
            if (heardAt !== null) {
              clock.t = H + heardAt;
              hearing.heardFrom('e');
            }
            clock.t = H + dt;
            // e counts as heard: last heard, or first seen, under a lapse ago;
            // never shown means first seen now.
            const since = heardAt ?? seen ?? dt;
            const earlierHeard = dt - since < LAPSE_MS;
            const want = expected(task, is, earlierHeard, dt);
            const got = settles(task, 'm', is, hearing.heard, H, H + dt);
            rows++;
            if (got !== want) {
              wrong.push(`${shape} / ${knowing} / +${dt} / ${is}: got ${got}, want ${want}`);
            }
          }
        }
      }
    }
    expect(rows).toBe(shapes.length * knowings.length * elapsed.length * isses.length);
    expect(wrong).toEqual([]);
  });

  it('turns at exactly a beat, not a millisecond before', () => {
    const task = { runs: [mine] };
    const none = () => false;
    expect(settles(task, 'm', 'this', none, H, H + BEAT_MS - 1)).toBe(false);
    expect(settles(task, 'm', 'this', none, H, H + BEAT_MS)).toBe(true);
    // a clock that went back, or a heldSince that is not a number, never settles
    expect(settles(task, 'm', 'this', none, H, H - 1)).toBe(false);
    expect(settles(task, 'm', 'this', none, Number.NaN, H + BEAT_MS)).toBe(false);
  });

  it('an earlier open run first seen at the taking holds it off until a lapse, then it settles', () => {
    const clock = { t: H, now() { return this.t; } };
    const hearing = new Hearing(clock);
    const task = { runs: [open('e'), mine] };
    hearing.saw(task.runs);
    clock.t = H + BEAT_MS;
    expect(settles(task, 'm', 'this', hearing.heard, H, clock.t)).toBe(false);
    clock.t = H + LAPSE_MS - 1;
    expect(settles(task, 'm', 'this', hearing.heard, H, clock.t)).toBe(false);
    clock.t = H + LAPSE_MS;
    expect(settles(task, 'm', 'this', hearing.heard, H, clock.t)).toBe(true);
  });

  it('a key that names nothing does not hold it off; one that names another does', () => {
    const task = { runs: [mine] };
    expect(settles(task, 'm', 'none', () => false, H, H + BEAT_MS)).toBe(true);
    expect(settles(task, 'm', 'other', () => false, H, H + BEAT_MS)).toBe(false);
  });

  it('settling is not exclusivity: an earlier run whose taking arrives after the beat is not counted, though its pool is heard', () => {
    // Two pools take one task at once. P's copy has only P's run; Q's pool is
    // heard on the task's channel before the beat, but Q's record reaches P
    // only after it. Until then nothing in P's copy is earlier than P's run.
    const base = A.from<any>({ importUrl: 'data:x', input: null, key: 'k', runs: [] });
    const atP = A.change(A.clone(base, { actor: 'aa'.repeat(16) }), (d: any) => claimRun(d, { id: 'p', pool: 'P', start: H }));
    const atQ = A.change(A.clone(base, { actor: 'ff'.repeat(16) }), (d: any) => claimRun(d, { id: 'q', pool: 'Q', start: H }));
    const clock = { t: H, now() { return this.t; } };
    const hearing = new Hearing(clock);
    hearing.saw(atP.runs);
    clock.t = H + 500;
    hearing.heardFrom('q');
    clock.t = H + BEAT_MS;
    expect(settles(atP as any, 'p', 'this', hearing.heard, H, clock.t)).toBe(true);
    const merged = A.merge(A.clone(atP), atQ);
    const order = merged.runs.map((r: any) => r.id);
    // whichever lands first in the merged list is the one the other yields to
    const later = order[1];
    expect(settles(merged as any, later, 'this', hearing.heard, H, clock.t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. foldStep, every combination

const U = madeUp(1); // the task the spare's key names: T
const V = madeUp(2); // another task own's key may name: T′

const entryFor = (url: string) => ({ taskUrl: url, askedAt: 1, needs: [] });

const task = (runs: any[]) => ({ importUrl: 'data:text/javascript,', input: null, key: 'k', runs });
const ran = (status?: string, id = 'r') =>
  status ? { id, pool: 'Q', start: 1, end: 2, status } : { id, pool: 'Q', start: 1 };
const stopRecord = { id: 's', start: 1, end: 1, status: 'cancelled' };

type Kind = 'notHad' | 'notTask' | 'wanted' | 'ended';

// Every value a folder can be handed as a task, with what it is, written out
// rather than computed.
const TASKS: [string, unknown, Kind][] = [
  ['NOT_HAD', NOT_HAD, 'notHad'],
  ['undefined', undefined, 'notHad'],
  ['null', null, 'notHad'],
  ['0', 0, 'notHad'],
  ['a string', 'task', 'notHad'],
  ['true', true, 'notHad'],
  ['another symbol', Symbol('not had'), 'notHad'],
  ['{}', {}, 'notTask'],
  ['no runs', { importUrl: 'data:x', input: null, key: 'k' }],
  ['runs not a list', { importUrl: 'data:x', runs: 'none' }, 'notTask'],
  ['importUrl not a string', { importUrl: 5, runs: [] }, 'notTask'],
  ['no importUrl', { runs: [] }, 'notTask'],
  ['never taken', task([]), 'wanted'],
  ['open run', task([ran()]), 'wanted'],
  ['lost run', task([ran('lost')]), 'wanted'],
  ['yielded run', task([ran('yielded')]), 'wanted'],
  ['junk records only', task([null, 7, 'x']), 'wanted'],
  ['succeeded', task([ran('succeeded')]), 'ended'],
  ['failed', task([ran('failed')]), 'ended'],
  ['cancelled by its pool', task([ran('cancelled')]), 'ended'],
  ['stopped', task([stopRecord]), 'ended'],
  ['open, then a later run succeeded', task([ran(undefined, 'a'), ran('succeeded', 'b')]), 'ended'],
  ['junk, then failed', task([null, ran('failed')]), 'ended'],
  ['open run, then a stop', task([ran(), stopRecord]), 'ended'],
].map(([name, value, kind]) => [name, value, kind ?? 'notTask']) as [string, unknown, Kind][];

type Spare = 'none' | 'entry';
const SPARES: [string, unknown, Spare][] = [
  ['nothing', undefined, 'none'],
  ['null', null, 'none'],
  ['a string', U, 'none'],
  ['{}', {}, 'none'],
  ['taskUrl a number', { taskUrl: 7 }, 'none'],
  ['an entry for T', entryFor(U), 'entry'],
  ['an entry for T with no askedAt', { taskUrl: U }, 'entry'],
];

type Own = 'none' | 'T' | "T'";
const OWNS: [string, unknown, Own][] = [
  ['nothing', undefined, 'none'],
  ['null', null, 'none'],
  ['a string', V, 'none'],
  ['{}', {}, 'none'],
  ['taskUrl null', { taskUrl: null }, 'none'],
  ['an entry for T', entryFor(U), 'T'],
  ['a bare entry for T', { taskUrl: U }, 'T'],
  ["an entry for T'", entryFor(V), "T'"],
  ["a bare entry for T'", { taskUrl: V }, "T'"],
];

/** The specification's table, Part 2 "Folding", with what foldStep's JSDoc adds for what is not an entry. */
function tableStep(spare: Spare, t: Kind, own: Own, other: Kind) {
  if (spare === 'none') return 'keep';
  if (t === 'ended' || t === 'notTask') return 'drop';
  if (own === 'T') return 'keep';
  if (own === "T'") {
    if (other === 'wanted') return 'adopt';
    if (other === 'notHad') return 'keep';
  }
  return t === 'wanted' ? 'list' : 'keep';
}

describe('foldStep', () => {
  it('gives the table\'s step for every spare entry, task, own entry and other task', () => {
    const wrong: string[] = [];
    let rows = 0;
    for (const [sName, spare, sKind] of SPARES) {
      for (const [tName, t, tKind] of TASKS) {
        for (const [oName, own, oKind] of OWNS) {
          for (const [xName, other, xKind] of TASKS) {
            rows++;
            const want = tableStep(sKind, tKind, oKind, xKind);
            const got = foldStep(spare, t, own, other);
            if (got !== want) {
              wrong.push(`spare ${sName} / T ${tName} / own ${oName} / T' ${xName}: got ${got}, want ${want}`);
            }
          }
        }
      }
    }
    expect(rows).toBe(SPARES.length * TASKS.length * OWNS.length * TASKS.length);
    expect(wrong).toEqual([]);
  });

  it('changes nothing it is handed', () => {
    const spare = entryFor(U);
    const own = entryFor(V);
    const t = task([ran()]);
    const other = task([]);
    const before = JSON.stringify([spare, t, own, other]);
    for (const step of [foldStep(spare, t, own, other), foldStep(spare, t, undefined, NOT_HAD)]) {
      expect(['adopt', 'list']).toContain(step);
    }
    expect(JSON.stringify([spare, t, own, other])).toBe(before);
  });

  // Applies a step as the Fold JSDoc says, to real documents.
  function apply(step: string, spare: A.Doc<any>, own: A.Doc<any>, k: string) {
    const p = spare.jobs[k];
    const o = own.jobs[k];
    if (step === 'drop') spare = A.change(spare, (d: any) => delistTask(d, k, p.taskUrl));
    if (step === 'adopt') spare = A.change(spare, (d: any) => listTask(d, k, o, p.taskUrl));
    if (step === 'list') own = A.change(own, (d: any) => listTask(d, k, p, isEntry(o) ? o.taskUrl : undefined));
    return { spare, own };
  }

  const urlOf = (q: A.Doc<any>, k: string) => (isEntry(q.jobs?.[k]) ? q.jobs[k].taskUrl : null);

  // Every entry isEntry accepts, those with no askedAt included: each step
  // the rules give can be applied to it.
  it('each step, applied to Automerge documents, loses no task and leaves nothing for a second step', () => {
    const k = 'k';
    const wrong: string[] = [];
    let applied = 0;
    const spareEntries = SPARES.filter(([, , kind]) => kind === 'entry');
    for (const [pName, p] of spareEntries) {
      for (const [tName, t, tKind] of TASKS) {
        for (const [oName, o, oKind] of OWNS) {
          for (const [xName, other, xKind] of TASKS) {
            if (oKind !== "T'" && xName !== 'NOT_HAD') continue; // other is not read
            let spare = A.from<any>({ jobs: { [k]: p } });
            let own = A.from<any>({ jobs: o === undefined ? {} : { [k]: o } });
            const step = foldStep(spare.jobs[k], t, own.jobs[k], other);
            try {
              ({ spare, own } = apply(step, spare, own, k));
            } catch (error) {
              wrong.push(`spare ${pName} / T ${tName} / own ${oName} / T' ${xName} (${step}): ${(error as Error).message}`);
              continue;
            }
            applied++;
            const row = `spare ${pName} / T ${tName} / own ${oName} / T' ${xName} (${step})`;
            const inSpare = urlOf(spare, k);
            const inOwn = urlOf(own, k);
            // F1: T leaves the spare only when it has ended or is no task (drop),
            // or when own's key names a wanted other (adopt), which the spare then names.
            if (tKind === 'wanted' || tKind === 'notHad') {
              const kept = inSpare === U || inOwn === U;
              const adopted = step === 'adopt' && inSpare === V && inOwn === V && xKind === 'wanted';
              if (!kept && !adopted) wrong.push(`${row}: T is in neither queue`);
            }
            // own's entry is replaced only when it named nothing, or a task had and not wanted
            if (oKind === "T'" && inOwn !== V && !(xKind === 'ended' || xKind === 'notTask')) {
              wrong.push(`${row}: own's entry for T' was replaced`);
            }
            // a second step, on what is there now, does nothing
            if (spare.jobs[k] !== undefined) {
              const tNow = inSpare === U ? t : other;
              const xNow = inOwn !== null && inOwn !== inSpare ? (inOwn === U ? t : other) : NOT_HAD;
              const again = foldStep(spare.jobs[k], tNow, own.jobs[k], xNow);
              if (again !== 'keep') wrong.push(`${row}: then ${again}`);
            }
          }
        }
      }
    }
    expect(applied).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Replicas, merged in every order

type Q = string;

class Replica {
  queues = new Map<Q, A.Doc<any>>();
  tasks = new Map<string, A.Doc<any>>();
  marks = new Set<Q>();
  constructor(
    readonly name: string,
    readonly actor: string,
  ) {}
}

/** Everything one run of events did, for the checks. */
type World = {
  replicas: Replica[];
  rank: Map<Q, number>; // the order Automerge's winner gives the marks: higher wins
  asked: Map<string, string>; // task url -> key
  adoptedAway: Set<string>;
  listedInto: Map<string, Set<Q>>;
};

const ownOf = (w: World, r: Replica) =>
  [...r.marks].reduce((a, b) => ((w.rank.get(a) ?? -1) >= (w.rank.get(b) ?? -1) ? a : b));

const headsOf = (d: A.Doc<any>) => A.getHeads(d).join(',');

function copyInto(r: Replica, have: A.Doc<any> | undefined, from: A.Doc<any>) {
  if (have && headsOf(have) === headsOf(from)) return have;
  return A.merge(have ?? A.init<any>({ actor: r.actor }), from);
}

function send(from: Replica, to: Replica, what: 'queues' | 'tasks') {
  if (what === 'queues') {
    for (const m of from.marks) to.marks.add(m);
    for (const [q, doc] of from.queues) to.queues.set(q, copyInto(to, to.queues.get(q), doc));
  } else {
    for (const [u, doc] of from.tasks) to.tasks.set(u, copyInto(to, to.tasks.get(u), doc));
  }
}

/** A pass, as the specification has it: every spare this replica knows, key by key, into the own it sees. */
function pass(w: World, r: Replica) {
  const own = ownOf(w, r);
  if (!r.queues.has(own)) return;
  for (const s of r.marks) {
    if (s === own || !r.queues.has(s)) continue;
    expect(w.rank.get(s)!).toBeLessThan(w.rank.get(own)!); // F2: moves go up
    for (const k of Object.keys(r.queues.get(s)!.jobs ?? {})) {
      const spare = r.queues.get(s)!;
      const ownDoc = r.queues.get(own)!;
      const p = spare.jobs[k];
      const o = ownDoc.jobs?.[k];
      const t = isEntry(p) ? (r.tasks.get(p.taskUrl) ?? NOT_HAD) : NOT_HAD;
      const other = isEntry(p) && isEntry(o) && o.taskUrl !== p.taskUrl ? (r.tasks.get(o.taskUrl) ?? NOT_HAD) : NOT_HAD;
      const step = foldStep(p, t, o, other);
      if (step === 'drop') {
        r.queues.set(s, A.change(spare, (d: any) => delistTask(d, k, p.taskUrl)));
      } else if (step === 'adopt') {
        w.adoptedAway.add(p.taskUrl);
        r.queues.set(s, A.change(spare, (d: any) => listTask(d, k, o, p.taskUrl)));
      } else if (step === 'list') {
        const into = w.listedInto.get(p.taskUrl) ?? new Set();
        into.add(own);
        w.listedInto.set(p.taskUrl, into);
        r.queues.set(own, A.change(ownDoc, (d: any) => listTask(d, k, p, isEntry(o) ? o.taskUrl : undefined)));
      }
    }
  }
}

const wanted = (doc: any) =>
  !!doc && !doc.runs.some((x: any) => ['succeeded', 'failed', 'cancelled'].includes(x?.status));

/** A pool on this replica runs the task to the end, and delists it wherever this replica sees it listed. */
function finish(r: Replica, url: string) {
  const t = r.tasks.get(url);
  if (!t || !wanted(t)) return;
  r.tasks.set(
    url,
    A.change(t, (d: any) => {
      claimRun(d, { id: `run-${r.name}`, pool: r.name, start: 1 });
      endRun(d, `run-${r.name}`, { status: 'succeeded', result: 1, end: 2 });
    }),
  );
  sweep(r);
}

/** What every pool does on its own: delist an entry whose task this replica has, ended (mayDelist). */
function sweep(r: Replica) {
  for (const [q, doc] of r.queues) {
    for (const [k, e] of Object.entries<any>(doc.jobs ?? {})) {
      const t = r.tasks.get(e.taskUrl);
      if (t && !wanted(t)) r.queues.set(q, A.change(r.queues.get(q)!, (d: any) => delistTask(d, k, e.taskUrl)));
    }
  }
}

/** Each replica made its queue alone and asked into it: its own key, and the shared key `s`. */
function makeWorld(names: string[]): { w: World; byName: Map<string, Replica>; taskOf: Map<string, string> } {
  const replicas = names.map((n, i) => new Replica(n, (i + 1).toString(16).padStart(2, '0').repeat(16)));
  const rank = new Map<Q, number>();
  const asked = new Map<string, string>();
  const taskOf = new Map<string, string>();
  replicas.forEach((r, i) => {
    const q = madeUp(100 + i);
    rank.set(q, i);
    r.marks.add(q);
    let queue = A.from<any>({ jobs: {} }, { actor: r.actor });
    for (const key of [`only-${r.name}`, 's']) {
      const url = madeUp(10 * (i + 1) + (key === 's' ? 1 : 0));
      r.tasks.set(url, A.from<any>(task([]), { actor: r.actor }));
      asked.set(url, key);
      taskOf.set(`${r.name}:${key}`, url);
      queue = A.change(queue, (d: any) => listTask(d, key, entryFor(url)));
    }
    r.queues.set(q, queue);
  });
  return {
    w: { replicas, rank, asked, adoptedAway: new Set(), listedInto: new Map() },
    byName: new Map(replicas.map((r) => [r.name, r])),
    taskOf,
  };
}

const state = (w: World) =>
  JSON.stringify(
    w.replicas.map((r) => [
      [...r.queues.entries()].map(([q, d]) => [q, A.getHeads(d)]),
      [...r.tasks.entries()].map(([u, d]) => [u, A.getHeads(d)]),
    ]),
  );

function syncAll(w: World) {
  for (const a of w.replicas) for (const b of w.replicas) if (a !== b) { send(a, b, 'queues'); send(a, b, 'tasks'); }
  for (const a of w.replicas) for (const b of w.replicas) if (a !== b) { send(a, b, 'queues'); send(a, b, 'tasks'); }
}

/** Heals the partition: everyone syncs, passes and sweeps, until nothing changes. Returns how many rounds changed something. */
function heal(w: World) {
  let rounds = 0;
  for (;;) {
    syncAll(w);
    const before = state(w);
    for (const r of w.replicas) pass(w, r);
    for (const r of w.replicas) sweep(r);
    syncAll(w);
    if (state(w) === before) return rounds;
    rounds++;
    if (rounds > 6) return rounds;
  }
}

/** The promises, checked once the partition has healed. Returns what is wrong. */
function promises(w: World): string[] {
  const wrong: string[] = [];
  const [first, ...rest] = w.replicas;
  // F3: every replica has the same documents, and sees the same own
  for (const r of rest) {
    for (const [q, d] of first.queues) {
      if (JSON.stringify(A.getHeads(d)) !== JSON.stringify(A.getHeads(r.queues.get(q)!))) wrong.push(`${r.name} differs on a queue`);
    }
    if (ownOf(w, r) !== ownOf(w, first)) wrong.push(`${r.name} sees another own`);
  }
  const own = ownOf(w, first);
  const ownDoc = first.queues.get(own)!;
  // F3: own names a wanted task under every key it lists
  for (const [k, e] of Object.entries<any>(ownDoc.jobs)) {
    if (!wanted(first.tasks.get(e.taskUrl))) wrong.push(`own lists an ended task under ${k}`);
  }
  // F3: a spare lists only what own lists
  for (const [q, d] of first.queues) {
    if (q === own) continue;
    for (const [k, e] of Object.entries<any>(d.jobs)) {
      if (ownDoc.jobs[k]?.taskUrl !== e.taskUrl) wrong.push(`a spare lists ${k} as own does not`);
    }
  }
  // F1: every task still wanted is listed somewhere, or own's key took it over
  for (const [url, key] of w.asked) {
    if (!wanted(first.tasks.get(url))) continue;
    const listed = [...first.queues.values()].some((d) => d.jobs[key]?.taskUrl === url);
    if (!listed && !w.adoptedAway.has(url)) wrong.push(`wanted task under ${key} is listed nowhere`);
  }
  // F2: each task listed into fewer queues than there are marks
  for (const [url, into] of w.listedInto) {
    if (into.size > w.rank.size - 1) wrong.push(`${url} listed into ${into.size} queues`);
  }
  return wrong;
}

/**
 * A wanted task that a spare's key gave over to own's (adopt), listed nowhere
 * now, and own names nothing under its key: the task own's key named has
 * since ended and been delisted. Nobody
 * runs it; its asker follows the key to the task that took it over, and has
 * that one's ending, as when two asks under one key merge in one queue.
 */
function takenOverAndUnlisted(w: World) {
  const first = w.replicas[0];
  const ownDoc = first.queues.get(ownOf(w, first))!;
  return [...w.asked].some(
    ([url, key]) =>
      wanted(first.tasks.get(url)) &&
      w.adoptedAway.has(url) &&
      ![...first.queues.values()].some((d) => d.jobs[key]?.taskUrl === url) &&
      ownDoc.jobs[key] === undefined,
  );
}

/**
 * An event, with the parts of the world it reads and writes: a replica's
 * queues and marks (`A:q`) or its tasks (`A:t`). Two events that touch
 * nothing the other writes give the same world in either order.
 */
type Event = { name: string; run: (env: ReturnType<typeof makeWorld>) => void; reads: string[]; writes: string[] };

const independent = (a: Event, b: Event) =>
  !a.writes.some((x) => b.reads.includes(x) || b.writes.includes(x)) &&
  !b.writes.some((x) => a.reads.includes(x) || a.writes.includes(x));

/**
 * Every order of the events, but of two neighbours that are independent only
 * the order in which they were given: each other order of those two gives the
 * same world, so every distinct world is still reached.
 */
function orders(events: Event[]): Event[][] {
  const out: Event[][] = [];
  const index = new Map(events.map((e, i) => [e, i]));
  const walk = (prefix: Event[], rest: Event[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (const e of rest) {
      const last = prefix.at(-1);
      if (last && independent(last, e) && index.get(last)! > index.get(e)!) continue;
      walk([...prefix, e], rest.filter((x) => x !== e));
    }
  };
  walk([], events);
  return out;
}

function everyOrder(names: string[], events: Event[]) {
  const failures = new Map<string, string[]>();
  let count = 0;
  let maxRounds = 0;
  let adopted = 0;
  let takenOverThenGone = 0;
  for (const order of orders(events)) {
    const env = makeWorld(names);
    for (const { run } of order) run(env);
    const rounds = heal(env.w);
    maxRounds = Math.max(maxRounds, rounds);
    if (env.w.adoptedAway.size > 0) adopted++;
    if (takenOverAndUnlisted(env.w)) takenOverThenGone++;
    const wrong = rounds > 6 ? ['passes never stop changing things'] : promises(env.w);
    count++;
    for (const r of env.w.replicas) for (const d of [...r.queues.values(), ...r.tasks.values()]) A.free(d);
    if (wrong.length > 0 && failures.size < 5) failures.set(order.map((e) => e.name).join(', '), wrong);
  }
  return { failures: Object.fromEntries(failures), orders: count, maxRounds, adopted, takenOverThenGone };
}

const at = (env: ReturnType<typeof makeWorld>, n: string) => env.byName.get(n)!;

const sendEvent = (x: string, y: string, what: 'queues' | 'tasks'): Event => {
  const part = what === 'queues' ? 'q' : 't';
  return { name: `${x}→${y} ${what}`, run: (e) => send(at(e, x), at(e, y), what), reads: [`${x}:${part}`], writes: [`${y}:${part}`] };
};
const passEvent = (r: string): Event => ({ name: `pass ${r}`, run: (e) => pass(e.w, at(e, r)), reads: [`${r}:q`, `${r}:t`], writes: [`${r}:q`] });
const finishEvent = (r: string, key: string): Event => ({
  name: `${r} ends its ${key}`,
  run: (e) => finish(at(e, r), e.taskOf.get(`${r}:${key}`)!),
  reads: [`${r}:q`, `${r}:t`],
  writes: [`${r}:q`, `${r}:t`],
});

describe('folding across replicas, in every order', () => {
  // Two replicas, A and B, each made a queue with no network (B's wins), and
  // asked under a key of its own and under the shared key `s`. Each sends the
  // other its queues (with the marks) and its tasks separately, each passes
  // once, and one task ends, in every order; then the partition heals.
  const two = (ending: Event): Event[] => [
    sendEvent('B', 'A', 'queues'),
    sendEvent('B', 'A', 'tasks'),
    sendEvent('A', 'B', 'queues'),
    sendEvent('A', 'B', 'tasks'),
    passEvent('A'),
    passEvent('B'),
    ending,
  ];

  it("two replicas: the spare's task under the shared key ends part way", () => {
    const r = everyOrder(['A', 'B'], two(finishEvent('A', 's')));
    expect(r.failures).toEqual({});
    expect(r.orders).toBeGreaterThan(100);
    expect(r.maxRounds).toBeLessThanOrEqual(2);
    expect(r.adopted).toBeGreaterThan(0);
  }, 120_000);

  it("two replicas: own's task under the shared key ends part way", () => {
    const r = everyOrder(['A', 'B'], two(finishEvent('B', 's')));
    expect(r.failures).toEqual({});
    expect(r.maxRounds).toBeLessThanOrEqual(2);
    // A took B's task over its own under `s` (adopt) and B's then ended: A's
    // task is listed nowhere and nobody runs it; its asker follows the key to
    // B's, as F1 says. It happens in some orders, never as a loss F1 does not name.
    expect(r.takenOverThenGone).toBeGreaterThan(0);
  }, 120_000);

  it("two replicas: a spare's task under its own key ends part way", () => {
    const r = everyOrder(['A', 'B'], two(finishEvent('A', 'only-A')));
    expect(r.failures).toEqual({});
    expect(r.takenOverThenGone).toBe(0);
  }, 120_000);

  // Three replicas: C's queue wins, B's beats A's. Meetings carry queues and
  // marks both ways; the tasks reach everyone at one moment, so passes before
  // it fold with tasks not had.
  const meet = (x: string, y: string): Event => ({
    name: `${x}⇄${y} queues`,
    run: (e) => {
      send(at(e, x), at(e, y), 'queues');
      send(at(e, y), at(e, x), 'queues');
    },
    reads: [`${x}:q`, `${y}:q`],
    writes: [`${x}:q`, `${y}:q`],
  });
  const tasksEverywhere: Event = {
    name: 'tasks everywhere',
    run: (e) => {
      for (const a of e.w.replicas) for (const b of e.w.replicas) if (a !== b) send(a, b, 'tasks');
    },
    reads: ['A:t', 'B:t', 'C:t'],
    writes: ['A:t', 'B:t', 'C:t'],
  };
  const passes = ['A', 'B', 'C'].map(passEvent);

  it("three replicas: A meets B, B meets C, B's task under the shared key ends", () => {
    const r = everyOrder(['A', 'B', 'C'], [meet('A', 'B'), meet('B', 'C'), tasksEverywhere, ...passes, finishEvent('B', 's')]);
    expect(r.failures).toEqual({});
    expect(r.orders).toBeGreaterThan(100);
    expect(r.maxRounds).toBeLessThanOrEqual(3);
  }, 120_000);

  it("three replicas: A meets C, A meets B, A's task under the shared key ends", () => {
    const r = everyOrder(['A', 'B', 'C'], [meet('A', 'C'), meet('A', 'B'), tasksEverywhere, ...passes, finishEvent('A', 's')]);
    expect(r.failures).toEqual({});
    expect(r.orders).toBeGreaterThan(100);
    expect(r.maxRounds).toBeLessThanOrEqual(3);
  }, 120_000);
});
