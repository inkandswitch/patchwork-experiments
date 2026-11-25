// The badge is a view: mounting it starts nothing, and for each served queue
// it says how many tasks are listed and what this browser's pool is doing,
// with the reason, for every state of the page's pool host.

import { describe, expect, it, vi } from 'vitest';
import type { PoolHostStatus } from './browser/pool-host';

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
    expect(badge().title).toBe("My tasks: 2 listed. This page has no part in this browser's pool: nothing in this frame has started it.");

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

    setStatus({ state: 'stood down' });
    expect(line()).toBe('2 listed · served by another tab');

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
