// The badge is a view of the pool: mounting it starts no pool, and for each
// served queue it says how many tasks are listed and what this browser's pool
// is doing, with the reason, for every state of the page's pool host. Mounted,
// it asks for the person's own queue, which makes it if there is none.

import { describe, expect, it, vi } from 'vitest';
import type { PoolHostState, PoolHostStatus } from './browser/pool-host';
import { poolWords } from './pool-words';

const QUEUE = 'automerge:2XzPUSj52GAd1wnWv1vR5JXH94VZ';
const STORAGE = 'automerge:3WewSgnLmFK4FjUXUCzPa939hyNe';
const ACCOUNT = 'automerge:tuasnaJMthhBUKLv9unCJSvTFrC';

const docs: Record<string, unknown> = {
  [ACCOUNT]: { toolStorage: { 'tasks-next': STORAGE } },
  [STORAGE]: { [QUEUE]: true, own: QUEUE },
  [QUEUE]: {
    title: 'My tasks',
    jobs: {
      a: { taskUrl: 'automerge:task1', askedAt: 1 },
      b: { taskUrl: 'automerge:task2', askedAt: 2 },
    },
  },
};

vi.mock('./helpers', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAccountDocUrl: () => ACCOUNT,
}));
vi.mock('./use-doc', () => ({
  WithTasksRepo: (props: { children: unknown }) => props.children,
  useDoc: (url: () => string | null) => () => (url() ? docs[url()!] : undefined),
}));

let making: { resolve: (url: string) => void; reject: (error: Error) => void } | null = null;
const asked: unknown[][] = [];
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ownQueue: (...args: unknown[]) => {
    asked.push(args);
    return new Promise<string>((resolve, reject) => (making = { resolve, reject }));
  },
}));

let started = 0;
let status: PoolHostStatus = { state: 'not started', busy: 0, slots: 2, id: null, name: null };
const listeners = new Set<(status: PoolHostStatus) => void>();
const setStatus = (next: Partial<PoolHostStatus>) => {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
};
vi.mock('./browser/pool-host', () => ({
  NOT_STARTED: { state: 'not started', busy: 0, slots: 2, id: null, name: null },
  startPoolHost: () => {
    started += 1;
    return () => {};
  },
  watchPoolHost: (listener: (status: PoolHostStatus) => void) => {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  },
}));

const { TaskTray } = await import('./titlebar-tool');

describe('the badge', () => {
  it('starts nothing, and says for each pool state what this browser does for the queue and why', () => {
    const element = document.createElement('div');
    const dispose = TaskTray(element, {} as any);
    const badge = () => element.querySelector<HTMLButtonElement>('.task-titlebar')!;
    const line = () => badge().querySelector('.task-titlebar-count')!.textContent;

    expect(started).toBe(0);
    expect(badge().dataset.poolState).toBe('not started');
    expect(line()).toBe('2 listed · not running here');
    expect(badge().title).toBe(
      "My tasks: 2 listed. This page has no part in this browser's pool: nothing on it has started it (a frame's background components do, and so does asking for work).",
    );

    setStatus({ state: 'waiting' });
    expect(line()).toBe('2 listed · served by another tab');
    expect(badge().title).toMatch(/Another tab of this browser runs its pool/);

    setStatus({ state: 'running', id: 'pool-1', name: 'Chrome on this Mac', busy: 1 });
    expect(line()).toBe('2 listed · 1 running here');
    expect(badge().title).toMatch(/This tab runs this browser's pool \(Chrome on this Mac\): 1 of 2 slots busy/);

    setStatus({ busy: 0 });
    expect(line()).toBe('2 listed · served here');

    setStatus({ state: 'handing over' });
    expect(line()).toBe('2 listed · finishing up');
    expect(badge().title).toMatch(/A newer version of tasks is open in another tab/);

    // It knows only that a newer version was heard, not whether it serves anything.
    setStatus({ state: 'stood down' });
    expect(line()).toBe('2 listed · not running here');
    expect(badge().title).toBe(
      "My tasks: 2 listed. A newer version of tasks is open in another tab, so this tab stood down from this browser's pool. It runs nothing until this tab has the newer version too.",
    );

    setStatus({ state: 'reading' });
    expect(line()).toBe('2 listed · not running here');
    expect(badge().title).toMatch(/has not yet read which task queues this browser serves/);

    setStatus({ state: 'serves nothing' });
    expect(line()).toBe('2 listed · not running here');
    expect(badge().title).toMatch(
      /This browser serves none of your task queues, so this page runs no pool: your own queue is made when a page first needs it, and served unless you leave it\./,
    );

    setStatus({ state: 'winding down' });
    expect(line()).toBe('2 listed · finishing up');
    expect(badge().title).toMatch(/stopped serving its last task queue: this tab's pool finishes what it is running/);

    setStatus({ state: 'out of sight' });
    expect(line()).toBe("2 listed · can't see the pool from here");
    expect(badge().title).toBe(
      "My tasks: 2 listed. This view is in a frame walled off from the page around it, so it cannot see this browser's pool from here.",
    );

    setStatus({ state: 'letting go' });
    expect(line()).toBe('2 listed · finishing up');
    expect(badge().title).toMatch(/This page let go of this browser's pool/);

    setStatus({ state: 'unavailable', problem: 'this browser cannot keep its tabs to one pool (it has no Web Locks)' });
    expect(line()).toBe('2 listed · not running here');
    expect(badge().title).toMatch(/not running: this browser cannot keep its tabs to one pool \(it has no Web Locks\)\.$/);

    const retryAt = new Date(2026, 10, 25, 14, 0, 0).getTime();
    setStatus({ state: 'unavailable', problem: 'its worker could not be started', retryAt });
    expect(badge().title).toContain(
      `not running: its worker could not be started. It tries again at ${new Date(retryAt).toLocaleTimeString()}.`,
    );

    expect(started).toBe(0);
    dispose();
    expect(listeners.size).toBe(0);
  });
});

describe('own, from the badge', () => {
  const element = () => {
    const it = document.createElement('div');
    return it;
  };

  it('asks for own once on mount, with the Repo and element it was given, and says it is making it until that resolves; no Make my queue, no "No task queues"', async () => {
    const served = docs[STORAGE];
    docs[STORAGE] = {};
    try {
      asked.length = 0;
      const where = element();
      const repo = { site: true } as any;
      const dispose = TaskTray(where, repo);
      expect(asked).toEqual([[repo, where]]);
      expect(where.textContent).toBe('Making your queue…');
      expect(where.querySelector('[data-offer="make"]')).toBeNull();
      // made: the storage serves it, and the badge shows it
      docs[STORAGE] = served;
      making!.resolve(QUEUE);
      await Promise.resolve();
      expect(where.textContent).not.toMatch(/Making your queue|No task queues|Make my queue/);
      dispose();
    } finally {
      docs[STORAGE] = served;
    }
  });

  it('where the page has nowhere to keep the queues, says so and offers nothing to press', async () => {
    const served = docs[STORAGE];
    docs[STORAGE] = {};
    try {
      const where = element();
      const dispose = TaskTray(where, {} as any);
      making!.reject(new Error('This page has nowhere to keep your task queues, so nothing was changed.'));
      await Promise.resolve();
      await Promise.resolve();
      expect(where.querySelector('[role="alert"]')?.textContent).toBe('This page has nowhere to keep your task queues, so nothing was changed.');
      expect(where.textContent).not.toMatch(/Making your queue/);
      expect(where.querySelector('button')).toBeNull();
      dispose();
    } finally {
      docs[STORAGE] = served;
    }
  });

  it('a left own is offered to open, to join again', () => {
    const served = docs[STORAGE];
    docs[STORAGE] = { own: QUEUE };
    try {
      const where = element();
      const dispose = TaskTray(where, {} as any);
      expect(where.querySelector('[data-offer="open"]')?.textContent).toBe('My queue');
      dispose();
    } finally {
      docs[STORAGE] = served;
    }
  });
});

describe('the words for the pool', () => {
  // Every state, so that a state added without words of its own fails here.
  const states: Record<PoolHostState, true> = {
    'not started': true,
    'out of sight': true,
    reading: true,
    'serves nothing': true,
    waiting: true,
    starting: true,
    running: true,
    'letting go': true,
    'winding down': true,
    'handing over': true,
    'stood down': true,
    unavailable: true,
  };

  it('say something for every state, and the reason differs between any two states not the same to a person', () => {
    const said = (Object.keys(states) as PoolHostState[]).map((state) => ({
      state,
      ...poolWords({ state, busy: 0, slots: 2, id: null, name: 'Chrome on macOS (abcd)' }),
    }));
    for (const words of said) {
      expect(words.short, words.state).toBeTruthy();
      expect(words.long, words.state).toMatch(/\.$/);
    }
    // 'starting' and 'running' are one to a person: this tab runs the pool.
    const reasons = new Set(said.filter((words) => words.state !== 'starting').map((words) => words.long));
    expect(reasons.size).toBe(said.length - 1);
  });

  it('claim nothing about who serves the queues where the page cannot know it', () => {
    for (const state of ['stood down', 'out of sight', 'reading'] as PoolHostState[]) {
      const { short, long } = poolWords({ state, busy: 0, slots: 2, id: null, name: null });
      expect(`${short} ${long}`, state).not.toMatch(/serves the queues|served by|runs its pool|nothing on it has started/);
    }
  });
});
