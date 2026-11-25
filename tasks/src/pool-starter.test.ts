// The background component starts the page's pool host and lets go of it,
// with the host stood in for; and the host itself, in a page with no Web
// Locks, is watched without being started and let go when nothing holds it.

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('the background component', () => {
  afterEach(() => {
    vi.doUnmock('./browser/pool-host');
    vi.resetModules();
  });

  it('starts the pool host when mounted, with the Repo it is handed, and lets go of it on cleanup', async () => {
    const started: unknown[] = [];
    let released = 0;
    vi.doMock('./browser/pool-host', () => ({
      startPoolHost: (repo: unknown) => {
        started.push(repo);
        return () => {
          released += 1;
        };
      },
    }));
    const { PoolStarter } = await import('./pool-starter');
    const element = document.createElement('div');
    const repo = { site: true } as any;

    const cleanup = PoolStarter(element, repo);
    expect(started).toEqual([repo]);
    expect(released).toBe(0);
    expect(element.childNodes.length).toBe(0); // it draws nothing

    cleanup();
    expect(released).toBe(1);
  });
});

describe("a page's pool host", () => {
  afterEach(() => {
    delete (window as any).patchworkTasks;
    vi.resetModules();
  });

  it('is not started by watching it, and is let go when the last hold is', async () => {
    // happy-dom has no Web Locks, so a held host says it cannot run a pool
    // here, and says nothing of trying again: without locks it never will.
    expect((navigator as any).locks).toBeFalsy();
    const { startPoolHost, watchPoolHost } = await import('./browser/pool-host');
    const seen: string[] = [];
    const stop = watchPoolHost((status) => seen.push(status.state));
    expect(seen).toEqual(['not started']);
    expect((window as any).patchworkTasks.poolHosts).toEqual({});

    const first = startPoolHost(undefined);
    const second = startPoolHost(undefined);
    expect(Object.keys((window as any).patchworkTasks.poolHosts)).toHaveLength(1);
    expect(seen.at(-1)).toBe('unavailable');

    first();
    first(); // letting go twice is letting go once
    expect(seen.at(-1)).toBe('unavailable');
    second();
    expect(seen.at(-1)).toBe('not started');

    stop();
  });

  it('is heard by a view mounted before it was started', async () => {
    const { startPoolHost, watchPoolHost } = await import('./browser/pool-host');
    const seen: { state: string; problem?: string; retryAt?: number }[] = [];
    const stop = watchPoolHost((status) => seen.push(status));
    const release = startPoolHost(undefined);
    const states = seen.map((status) => status.state).filter((state, i, all) => state !== all[i - 1]);
    expect(states).toEqual(['not started', 'waiting', 'unavailable']);
    expect(seen.at(-1)?.problem).toMatch(/Web Locks/);
    expect(seen.at(-1)?.retryAt).toBeUndefined();
    release();
    stop();
  });
});
