// The queue view keeps one row, with one watcher, per listed key while the
// queue changes around it.

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
  watch: (_repo: unknown, _queueUrl: string, key: string) => {
    watched.push(key);
    return () => unwatched.push(key);
  },
}));

const { AcceptanceChoice, JobsSection } = await import('./jobs-view');

const entry = (n: number) => ({ taskUrl: `automerge:task${n}`, askedAt: n, package: null });

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
