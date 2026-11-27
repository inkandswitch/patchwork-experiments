// The queue view keeps one row, with one watcher, per listed key while the
// queue changes around it, says why a task waits when no pool heard serving
// the queue has what it needs, shows a task's code on request, and never
// shows what an input keeps under `keys`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { Queue } from './datatype';

const watched: string[] = [];
const unwatched: string[] = [];
/** What a key's task reads, where it is more than a waiting task with no input. */
const views: Record<string, object> = {};

vi.mock('@automerge/automerge-repo-solid-primitives', () => ({ useRepo: () => ({}) }));
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ask: async () => ({}),
  cancel: async () => true,
  // every task reads waiting, as one nobody has taken does
  watch: (_repo: unknown, _queueUrl: string, key: string, onChange: (view: unknown) => void) => {
    watched.push(key);
    onChange({ key, state: 'waiting', taskUrl: `automerge:${key}`, importUrl: 'data:text/javascript,', input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...views[key] });
    return () => unwatched.push(key);
  },
}));

const { JobsSection, unmetNeeds } = await import('./jobs-view');

const entry = (n: number, needs: unknown = []) => ({ taskUrl: `automerge:task${n}`, askedAt: n, needs: needs as string[] });
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

describe("a task's code", () => {
  // made up
  const PACKAGE = 'automerge:2UbGsSi8MadeUpPackage1234';
  const HEADS = 'Abc123DefMadeUpHeads';
  const PACKAGE_PATH = `/${encodeURIComponent(`${PACKAGE}#${HEADS}`)}/dist/sum-task.js`;

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(views)) {
      delete views[key];
    }
  });

  /** One task under key `k` whose code is at `importUrl`, its row rendered and its details opened. */
  function oneTask(importUrl: string, input: unknown = null) {
    views.k = { importUrl, input };
    const [queue, setQueue] = createSignal<Queue>({ jobs: { k: entry(1) } });
    // in the document, where Solid hears clicks
    const element = document.body.appendChild(document.createElement('div'));
    const stop = render(() => <JobsSection handle={{ url: 'automerge:queue' } as any} queue={queue()} />, element);
    const dispose = () => (stop(), element.remove());
    const details = () => element.querySelector<HTMLDetailsElement>('details.tq-task')!;
    const toggleDetails = (open: boolean) => {
      details().open = open;
      details().dispatchEvent(new Event('toggle'));
    };
    toggleDetails(true);
    const button = () => [...element.querySelectorAll('button')].find((it) => /code$/.test(it.textContent ?? ''));
    const source = () => element.querySelector('.tq-code-source')?.textContent ?? null;
    const notes = () => [...element.querySelectorAll('.tq-code-note')].map((it) => it.textContent);
    return { element, setQueue, toggleDetails, button, source, notes, dispose };
  }

  /** A stand-in fetch, answering each request with what `answer` makes of it. */
  function standInFetch(answer: (url: string) => Promise<Response> | Response) {
    const fetch = vi.fn(async (url: string) => answer(String(url)));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('decodes a data: URL where it stands, and links to nothing', async () => {
    const fetch = standInFetch(() => new Response('nothing'));
    const code = 'export default async function (input) { return input?.value ?? 100%; }';
    const view = oneTask(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(view.element.querySelector('.tq-code-where')?.textContent).toBe('Code written into the task itself, as a data: URL.');
    expect(view.element.querySelector('.tq-code-view a')).toBeNull();
    expect(view.button()?.textContent).toBe('Show code');
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()).toBe(code));
    expect(view.button()?.textContent).toBe('Hide code');
    expect(fetch).not.toHaveBeenCalled();
    view.dispose();
  });

  it('decodes a base64 data: URL, and one with a % that starts no escape', async () => {
    standInFetch(() => new Response('nothing'));
    const code = 'export default () => "héllo";';
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(code)));
    const view = oneTask(`data:text/javascript;base64,${base64}`);
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()).toBe(code));
    view.dispose();

    const raw = oneTask('data:text/javascript,export default () => 5 % 2;');
    raw.button()!.click();
    await vi.waitFor(() => expect(raw.source()).toBe('export default () => 5 % 2;'));
    raw.dispose();
  });

  it("fetches a package's file at its path, says which file of which package it is, and links to it", async () => {
    const fetch = standInFetch(() => new Response('export default (input) => input.numbers.reduce((a, b) => a + b, 0);'));
    const view = oneTask(PACKAGE_PATH);
    expect(view.element.querySelector('.tq-code-where')?.textContent).toBe(
      'The file dist/sum-task.js of the package automerge:2UbGsSi8…, at version Abc123De….',
    );
    const link = view.element.querySelector<HTMLAnchorElement>('.tq-code-view a')!;
    expect(link.getAttribute('href')).toContain(PACKAGE_PATH);
    expect(link.target).toBe('_blank');
    expect(link.textContent).toBe(PACKAGE_PATH);
    view.button()!.click();
    expect(view.notes()).toEqual(['Loading the code…']);
    await vi.waitFor(() => expect(view.source()).toBe('export default (input) => input.numbers.reduce((a, b) => a + b, 0);'));
    expect(view.notes()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(PACKAGE_PATH);
    view.dispose();
  });

  it('links to an http(s) URL, and says nothing more of where it is', () => {
    standInFetch(() => new Response(''));
    const view = oneTask('https://example.invalid/task.js');
    expect(view.element.querySelector('.tq-code-where')).toBeNull();
    expect(view.element.querySelector('.tq-code-view a')?.getAttribute('href')).toBe('https://example.invalid/task.js');
    view.dispose();
  });

  it('says in a sentence why the code could not be loaded', async () => {
    standInFetch(() => new Response('gone', { status: 404, statusText: 'Not Found' }));
    const view = oneTask(PACKAGE_PATH);
    view.button()!.click();
    await vi.waitFor(() => expect(view.notes()).toEqual(['Could not load this code: the site answered 404 Not Found.']));
    expect(view.source()).toBeNull();
    view.dispose();

    standInFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const offline = oneTask(PACKAGE_PATH);
    offline.button()!.click();
    await vi.waitFor(() => expect(offline.notes()).toEqual(['Could not load this code: Failed to fetch.']));
    offline.dispose();
  });

  it('shows about 200 KB of a long source, and says it was cut', async () => {
    standInFetch(() => new Response('x'.repeat(250_000)));
    const view = oneTask(PACKAGE_PATH);
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()?.length).toBe(200_000));
    expect(view.notes()).toEqual(['Cut short: the first 200 KB of 250 KB are shown.']);
    view.dispose();
  });

  it('fetches nothing until asked, and once per opening of the details', async () => {
    const fetch = standInFetch(() => new Response('export default () => 1;'));
    const view = oneTask(PACKAGE_PATH);
    expect(fetch).not.toHaveBeenCalled();

    view.button()!.click();
    await vi.waitFor(() => expect(view.source()).toBe('export default () => 1;'));
    expect(fetch).toHaveBeenCalledTimes(1);

    // hidden and shown again, and the queue changing around it: no fetch
    view.button()!.click();
    expect(view.source()).toBeNull();
    view.setQueue({ jobs: { k: entry(1) }, title: 'renamed' });
    view.button()!.click();
    expect(view.source()).toBe('export default () => 1;');
    expect(fetch).toHaveBeenCalledTimes(1);

    // closed, and opened again: nothing until asked, then once more
    view.toggleDetails(false);
    expect(view.button()).toBeUndefined();
    view.toggleDetails(true);
    expect(view.source()).toBeNull();
    expect(view.button()?.textContent).toBe('Show code');
    expect(fetch).toHaveBeenCalledTimes(1);
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()).toBe('export default () => 1;'));
    expect(fetch).toHaveBeenCalledTimes(2);
    view.dispose();
  });
});

describe('what an input keeps under keys', () => {
  afterEach(() => {
    for (const key of Object.keys(views)) {
      delete views[key];
    }
  });

  it('is hidden in the row and in the details, at any depth, and the rest is shown as before', () => {
    views.k = {
      input: {
        model: 'made-up-model',
        keys: { anthropic: 'sk-made-up-secret-1' },
        steps: [{ keys: 'made-up-secret-2', n: 1 }, { inner: { keys: ['made-up-secret-3'] } }],
      },
    };
    const element = document.createElement('div');
    const dispose = render(() => <JobsSection handle={{ url: 'automerge:queue' } as any} queue={{ jobs: { k: entry(1) } }} />, element);
    const row = element.querySelector('.tq-task-input')!.textContent!;
    expect(row).toBe('data:({"model":"made-up-model","keys":(hidden),"steps":[{"keys":(hidden),"n":1},{"inn…)');

    const details = element.querySelector<HTMLDetailsElement>('details.tq-task')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    const shown = element.querySelector('.tq-input-value')!.textContent!;
    expect(shown).toContain('"model": "made-up-model"');
    expect(shown).toContain('"n": 1');
    expect(shown.match(/"keys": \(hidden\)/g)).toHaveLength(3);

    expect(element.textContent).not.toMatch(/secret/);
    dispose();
  });

  it('leaves an input with no keys as it was', () => {
    views.k = { input: { ms: 5000, value: 'done', keyed: 'shown' } };
    const element = document.createElement('div');
    const dispose = render(() => <JobsSection handle={{ url: 'automerge:queue' } as any} queue={{ jobs: { k: entry(1) } }} />, element);
    expect(element.querySelector('.tq-task-input')!.textContent).toBe('data:({"ms":5000,"value":"done","keyed":"shown"})');
    dispose();
  });
});
