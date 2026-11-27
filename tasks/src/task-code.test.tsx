// A checker's cases of the queue browser's code view and of `keys` hidden:
// a data: URL whose code needs decoding, a fetch refused and one that
// throws, a 1 MB source, the details closed (mid-load too) and opened again,
// `keys` two levels down beside `keysmith`, and inputs that are not objects.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { Queue } from './datatype';

/** What a key's task reads, where it is more than a waiting task with no input. */
const views: Record<string, object> = {};

vi.mock('@automerge/automerge-repo-solid-primitives', () => ({ useRepo: () => ({}) }));
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ask: async () => ({}),
  cancel: async () => true,
  watch: (_repo: unknown, _queueUrl: string, key: string, onChange: (view: unknown) => void) => {
    onChange({ key, state: 'waiting', taskUrl: `automerge:${key}`, importUrl: 'data:text/javascript,', input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...views[key] });
    return () => {};
  },
}));

const { JobsSection } = await import('./jobs-view');
const { showValue, decodeDataUrl, openableUrl } = await import('./task-code');

const entry = (n: number) => ({ taskUrl: `automerge:task${n}`, askedAt: n, needs: [] as string[] });

// made up
const PACKAGE_PATH = `/${encodeURIComponent('automerge:3xMadeUpCheckerPkg99#HeadsMadeUp77')}/lib/deep/work.js`;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(views)) {
    delete views[key];
  }
  document.body.innerHTML = '';
});

/** One task under key `k`, rendered in the document, its details closed. */
function oneTask(view: object) {
  views.k = view;
  const [queue, setQueue] = createSignal<Queue>({ jobs: { k: entry(1) } });
  const element = document.body.appendChild(document.createElement('div'));
  const dispose = render(() => <JobsSection handle={{ url: 'automerge:queue' } as any} queue={queue()} />, element);
  const details = () => element.querySelector<HTMLDetailsElement>('details.tq-task')!;
  const setOpen = (open: boolean) => {
    details().open = open;
    details().dispatchEvent(new Event('toggle'));
  };
  const button = () => [...element.querySelectorAll('button')].find((it) => /code$/.test(it.textContent ?? ''));
  const source = () => element.querySelector('.tq-code-source')?.textContent ?? null;
  const notes = () => [...element.querySelectorAll('.tq-code-note')].map((it) => it.textContent);
  return { element, setQueue, setOpen, button, source, notes, dispose };
}

function standInFetch(answer: (url: string) => Promise<Response> | Response) {
  const fetch = vi.fn(async (url: string) => answer(String(url)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Show code, checked', () => {
  it('decodes a data: URL whose code has escapes, a +, a #, newlines and characters past ASCII', async () => {
    const fetch = standInFetch(() => new Response('never'));
    const code = 'export default (a) => {\n  // 100% sure: a+b #1 — ünïcødé 🙂 \\ "quoted" \'single\'\n  return a + 1;\n};';
    const view = oneTask({ importUrl: `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}` });
    view.setOpen(true);
    expect(view.source()).toBeNull();
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()).toBe(code));
    expect(fetch).not.toHaveBeenCalled();
    expect(decodeDataUrl('data:,a+b%20c')).toBe('a+b c');
    expect(decodeDataUrl(`data:text/javascript;base64,${btoa('x = 1;')}`)).toBe('x = 1;');
    view.dispose();
  });

  it('says a sentence when the site answers 404, and when fetch throws', async () => {
    standInFetch(() => new Response('', { status: 404 }));
    const refused = oneTask({ importUrl: PACKAGE_PATH });
    refused.setOpen(true);
    refused.button()!.click();
    await vi.waitFor(() => expect(refused.notes()).toEqual(['Could not load this code: the site answered 404.']));
    expect(refused.source()).toBeNull();
    refused.dispose();

    standInFetch(() => {
      throw new TypeError('NetworkError when attempting to fetch resource');
    });
    const thrown = oneTask({ importUrl: PACKAGE_PATH });
    thrown.setOpen(true);
    thrown.button()!.click();
    await vi.waitFor(() =>
      expect(thrown.notes()).toEqual(['Could not load this code: NetworkError when attempting to fetch resource.']),
    );
    thrown.dispose();
  });

  it('shows the first 200,000 characters of a 1 MB source and says it was cut', async () => {
    const big = 'a'.repeat(1_000_000);
    standInFetch(() => new Response(big));
    const view = oneTask({ importUrl: PACKAGE_PATH });
    view.setOpen(true);
    view.button()!.click();
    await vi.waitFor(() => expect(view.source()?.length).toBe(200_000));
    expect(view.notes()).toHaveLength(1);
    expect(view.notes()[0]).toMatch(/^Cut short: the first 200 KB of 1[,.]?000 KB are shown\.$/);
    view.dispose();
  });

  it('fetches nothing while closed, and once per opening, a load cut short by closing included', async () => {
    let release: (r: Response) => void = () => {};
    const fetch = standInFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const view = oneTask({ importUrl: PACKAGE_PATH });
    expect(view.button()).toBeUndefined(); // closed: nothing to press
    view.setOpen(true);
    expect(fetch).not.toHaveBeenCalled();

    view.button()!.click();
    expect(view.notes()).toEqual(['Loading the code…']);
    expect(fetch).toHaveBeenCalledTimes(1);
    // closed while it loads; the late answer lands on nothing
    view.setOpen(false);
    release(new Response('late'));
    await new Promise((r) => setTimeout(r, 10));
    view.setOpen(true);
    expect(view.source()).toBeNull();
    expect(view.button()?.textContent).toBe('Show code');
    expect(fetch).toHaveBeenCalledTimes(1);

    view.button()!.click();
    expect(fetch).toHaveBeenCalledTimes(2);
    release(new Response('fresh'));
    await vi.waitFor(() => expect(view.source()).toBe('fresh'));

    // redraws: the queue changes, the task's view changes, Hide and Show
    for (let i = 0; i < 5; i++) {
      view.setQueue({ jobs: { k: entry(1) }, title: `t${i}` });
      view.button()!.click();
      view.button()!.click();
    }
    expect(view.source()).toBe('fresh');
    expect(fetch).toHaveBeenCalledTimes(2);
    view.dispose();
  });

  it('links a package path and an http URL, never a data: or javascript: URL', () => {
    expect(openableUrl(PACKAGE_PATH)).toContain(PACKAGE_PATH);
    expect(openableUrl('http://example.invalid/a.js')).toBe('http://example.invalid/a.js');
    expect(openableUrl('data:text/javascript,1')).toBeNull();
    expect(openableUrl('javascript:alert(1)')).toBeNull();
    expect(openableUrl('//example.invalid/a.js')).toBeNull();
  });

  it('says which file of which package, in words', () => {
    standInFetch(() => new Response(''));
    const view = oneTask({ importUrl: PACKAGE_PATH });
    view.setOpen(true);
    expect(view.element.querySelector('.tq-code-where')?.textContent).toBe(
      'The file lib/deep/work.js of the package automerge:3xMadeUp…, at version HeadsMad….',
    );
    view.dispose();
  });
});

describe('keys hidden, checked', () => {
  const SECRET = 'sk-made-up-checker-secret';

  it('hides keys two levels down and shows keysmith beside it, in the row and the details', () => {
    const view = oneTask({ input: { outer: { inner: { keys: { model: SECRET }, keysmith: 'smith-shown' } }, top: 1 } });
    const row = view.element.querySelector('.tq-task-input')!.textContent!;
    expect(row).toContain('"keys":(hidden)');
    expect(row).toContain('"keysmith":"smith-shown"');
    view.setOpen(true);
    const details = view.element.querySelector('.tq-input-value')!.textContent!;
    expect(details).toContain('"keys": (hidden)');
    expect(details).toContain('"keysmith": "smith-shown"');
    expect(details).toContain('"top": 1');
    expect(view.element.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
    view.dispose();
  });

  it('hides keys in a succeeded task\'s result too', () => {
    const view = oneTask({ state: 'succeeded', input: null, result: { keys: SECRET, ok: true } });
    view.setOpen(true);
    expect(view.element.textContent).not.toContain(SECRET);
    expect(view.element.textContent).toContain('"ok":true');
    view.dispose();
  });

  // input → what the row shows inside the parentheses
  const notObjects: [string, unknown, string][] = [
    ['a string', 'keys', '"keys"'],
    ['a string holding JSON', '{"keys":"x"}', '"{\\"keys\\":\\"x\\"}"'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
    ['a boolean', false, 'false'],
    ['a list of strings', ['keys', 'b'], '["keys","b"]'],
    ['a list of objects', [{ keys: SECRET }, { k: 2 }], '[{"keys":(hidden)},{"k":2}]'],
  ];
  for (const [name, input, inside] of notObjects) {
    it(`an input that is ${name} is shown as it was`, () => {
      const view = oneTask({ input });
      expect(view.element.querySelector('.tq-task-input')!.textContent).toBe(`data:(${inside})`);
      view.setOpen(true);
      expect(view.element.querySelector('.tq-input-value')!.textContent).toBe(showValue(input, 2));
      expect(view.element.textContent).not.toContain(SECRET);
      view.dispose();
    });
  }

  it('showValue: keys holding anything at all reads (hidden); a field named Keys or apikeys is not touched', () => {
    for (const value of [SECRET, 0, null, false, [], {}, [SECRET], { a: SECRET }]) {
      expect(showValue({ keys: value })).toBe('{"keys":(hidden)}');
    }
    expect(showValue({ Keys: 1, apikeys: 2, keysmith: 3 })).toBe('{"Keys":1,"apikeys":2,"keysmith":3}');
  });
});
