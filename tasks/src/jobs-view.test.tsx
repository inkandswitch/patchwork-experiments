// The queue view keeps one row, with one watcher, per listed key while the
// queue changes around it, and says why a task waits when no pool heard
// serving the queue has what it needs.

import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { Queue } from './datatype';

const watched: string[] = [];
const unwatched: string[] = [];

vi.mock('./use-doc', () => ({ useRepo: () => ({}) }));
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ask: async () => ({}),
  cancel: async () => true,
  // every task reads waiting, as one nobody has taken does
  watch: (_repo: unknown, _queueUrl: string, key: string, onChange: (view: unknown) => void) => {
    watched.push(key);
    onChange({ key, state: 'waiting', taskUrl: `automerge:${key}`, importUrl: 'data:text/javascript,', input: null, progress: null, logs: [], result: undefined, error: null, runs: [] });
    return () => unwatched.push(key);
  },
}));

const { AcceptanceChoice, JobsSection, unmetNeeds } = await import('./jobs-view');

const entry = (n: number, needs: unknown = []) => ({ taskUrl: `automerge:task${n}`, askedAt: n, package: null, needs: needs as string[] });
const pool = (id: string, has: string[]) => ({ pool: id, name: `pool ${id}`, slots: 1, busy: 0, has });

describe('the queue view', () => {
  it('makes a row once per key, and lets it go only when the key is no longer listed', () => {
    const [queue, setQueue] = createSignal<Queue>({ jobs: { a: entry(1) } });
    const element = document.createElement('div');
    const handle = { url: 'automerge:queue' } as any;
    const dispose = render(() => <JobsSection handle={handle} queue={queue()} />, element);
    expect(watched).toEqual(['a']);

    // each change to a queue is a new document value, with new entries in it
    setQueue({ jobs: { a: entry(1), b: entry(2) } });
    setQueue({ jobs: { a: entry(1), b: entry(2) }, title: 'renamed' });
    expect(watched).toEqual(['a', 'b']);
    expect(unwatched).toEqual([]);

    setQueue({ jobs: { b: entry(2) } });
    expect(unwatched).toEqual(['a']);
    dispose();
    expect(unwatched).toEqual(['a', 'b']);
  });
});

describe('why a task waits', () => {
  const names = { name: (id: string) => `pool ${id}`, mine: () => false };

  // Each row: what the task needs, the pools heard (each with what it has), and what its row says, when more than "waiting".
  const cases: [string, unknown, ReturnType<typeof pool>[], string | null][] = [
    ['needs nothing', [], [], null],
    ['needs nothing written', undefined, [], null],
    ['a pool heard has it', ['unix'], [pool('A', ['node', 'unix'])], null],
    ['one of several pools has it all', ['unix', 'gpu'], [pool('A', ['unix']), pool('B', ['unix', 'gpu'])], null],
    ['nobody is heard', ['unix'], [], 'waiting: it needs unix, and no device serving this queue has it'],
    ['the pools heard lack it', ['unix'], [pool('A', ['browser'])], 'waiting: it needs unix, and no device serving this queue has it'],
    ['each pool has only part of it', ['unix', 'gpu'], [pool('A', ['unix']), pool('B', ['gpu'])], 'waiting: it needs unix and gpu, and no device serving this queue has them all'],
    ['one pool, by name, not heard', ['pool:P'], [pool('A', ['pool:A'])], 'waiting for pool P to serve this queue'],
    ['one pool, by name, heard', ['pool:P'], [pool('P', ['pool:P'])], null],
    ['one pool, by name, with a label it lacks', ['pool:P', 'unix'], [pool('P', ['pool:P'])], 'waiting for pool P to serve this queue, with unix'],
    ['needs that are not a list', 'unix', [pool('A', ['unix'])], 'waiting: what it needs is not something any device can have'],
    ['an empty label', [''], [pool('A', [''])], 'waiting: what it needs is not something any device can have'],
  ];
  for (const [name, needs, pools, words] of cases) {
    it(`${name}: ${words ?? 'waiting'}`, () => {
      expect(unmetNeeds(needs, pools, names)).toBe(words);
    });
  }

  it('the row says it, and says it again as pools are heard and lost, never stale', () => {
    const [pools, setPools] = createSignal<ReturnType<typeof pool>[]>([]);
    const element = document.createElement('div');
    const queue: Queue = { jobs: { k: entry(1, ['unix']), plain: entry(2) } };
    const dispose = render(() => <JobsSection handle={{ url: 'automerge:queue' } as any} queue={queue} pools={pools()} />, element);
    const outcome = () => [...element.querySelectorAll('.tq-waits')].map((it) => it.textContent);
    // newest first
    expect(outcome()).toEqual(['waiting', 'waiting: it needs unix, and no device serving this queue has it']);
    setPools([pool('A', ['node', 'unix'])]);
    expect(outcome()).toEqual(['waiting', 'waiting']);
    setPools([pool('B', ['browser'])]);
    expect(outcome()).toEqual(['waiting', 'waiting: it needs unix, and no device serving this queue has it']);
    dispose();
  });
});

describe('whose code a queue runs', () => {
  const buttons = (element: HTMLElement) => [...element.querySelectorAll('button')];

  it('says it is saving while a change it asked for is made, and takes no other change until then', () => {
    const [state, setState] = createSignal({ working: false, disabled: false });
    const changes: unknown[] = [];
    const element = document.createElement('div');
    const dispose = render(
      () => (
        <AcceptanceChoice acceptance="any" onChange={(a) => changes.push(a)} working={state().working} disabled={state().disabled} />
      ),
      element,
    );
    expect(element.textContent).not.toContain('Saving…');
    expect(buttons(element).every((button) => !button.disabled)).toBe(true);

    setState({ working: true, disabled: true });
    expect(element.textContent).toContain('Saving…');
    expect(buttons(element).length).toBeGreaterThan(0);
    expect(buttons(element).every((button) => button.disabled)).toBe(true);

    setState({ working: false, disabled: false });
    expect(element.textContent).not.toContain('Saving…');
    expect(buttons(element).every((button) => !button.disabled)).toBe(true);
    expect(changes).toEqual([]);
    dispose();
  });
});
