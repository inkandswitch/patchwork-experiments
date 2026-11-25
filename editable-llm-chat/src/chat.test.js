// @vitest-environment happy-dom
//
// The chat view (chat.tsx) rendered into a page, on a real Repo, with the
// person's clicks. The reply is written by the real doWork, done in this page
// because the task's code is a file of this source; only the provider is a
// stand-in (test/provider.js, as the global fetch), and watchWork, which here
// has no queue to look on, says what a test tells it to.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initSubduction, Repo } from '@automerge/automerge-repo';
import { provider } from './test/provider.js';
import { LINES } from './reply-status.js';

await initSubduction();

const watching = vi.hoisted(() => /** @type {{ key: string, onChange: (view: any) => void }[]} */ ([]));
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  watchWork: (_repo, key, onChange) => {
    const call = { key, onChange };
    watching.push(call);
    return () => {};
  },
  stopWork: async () => false,
}));

const { EditableChatTool } = await import('./chat');

const PIECES = ['Once ', 'upon ', 'a ', 'time.'];
const WHOLE = PIECES.join('');

/** A provider whose pieces go out only as far as the test allows. */
function paced(pieces) {
  let allowed = 0;
  const waiting = [];
  const p = provider(pieces, { gate: (i) => (i < allowed ? undefined : new Promise((resolve) => waiting.push({ i, resolve }))) });
  return {
    ...p,
    allow(n) {
      allowed = n;
      for (const w of waiting.splice(0)) (w.i < n ? w.resolve() : waiting.push(w));
    },
  };
}

/** Waits for what the page shows to pass a check, and says what it showed when it does not. */
async function until(check, what) {
  for (let t = 0; t < 400; t++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`${what}; the page shows: ${document.body.textContent}`);
}

let element;
let dispose;

/** The tool, rendered into the page for a chat in a Repo of its own. */
function open(messages = []) {
  const repo = new Repo({ network: [] });
  const handle = repo.create({
    '@patchwork': { type: 'editable-llm-chat' },
    config: { apiUrl: 'https://provider.invalid/v1', model: 'anthropic/claude-sonnet-4.6' },
    messages,
  });
  element = document.createElement('div');
  element.repo = repo;
  document.body.append(element);
  dispose = EditableChatTool(handle, element);
  return handle;
}

const replyEl = () => [...element.querySelectorAll('.ec-message-assistant')].at(-1);
const buttons = (within) => [...(within ?? element).querySelectorAll('button')].map((b) => b.textContent);
const press = (within, text) => [...within.querySelectorAll('button')].find((b) => b.textContent === text).click();

function send(text) {
  const box = element.querySelector('.ec-input-textarea');
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  element.querySelector('.ec-send-btn').click();
}

beforeEach(() => {
  watching.length = 0;
  // the browser's, which happy-dom lacks
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  dispose?.();
  element?.remove();
  vi.unstubAllGlobals();
});

describe('the chat view', () => {
  it('shows a sent reply growing piece by piece, with Stop while it is written, and Edit once it has finished', async () => {
    const source = paced(PIECES);
    vi.stubGlobal('fetch', source.fetch);
    const handle = open();
    await until(() => element.querySelector('.ec-input-textarea'), 'the chat to open');
    send('Tell me a story');
    await until(() => replyEl() && buttons(replyEl()).includes('Stop'), 'Stop while the reply is written');
    expect(element.querySelector('.ec-send-btn').textContent).toBe('Replying…');

    const seen = [];
    for (let n = 1; n <= PIECES.length; n++) {
      source.allow(n);
      const text = PIECES.slice(0, n).join('').trim();
      await until(() => replyEl().querySelector('.ec-markdown')?.textContent.trim() === text, `the reply at ${n} pieces`);
      seen.push(replyEl().querySelector('.ec-markdown').textContent.trim());
      expect(buttons(replyEl())).toContain('Stop');
    }
    expect(seen).toEqual(['Once', 'Once upon', 'Once upon a', 'Once upon a time.']);

    source.allow(PIECES.length + 1);
    await until(() => !buttons(replyEl()).includes('Stop'), 'Stop gone once the reply finished');
    expect(buttons(replyEl())).toEqual(['Edit']);
    expect(handle.doc().messages.at(-1)).toMatchObject({ content: WHOLE, ended: 'finished' });
    expect(element.querySelector('.ec-send-btn').textContent).toBe('Send');
  });

  it('stops the reply when Stop is pressed, and then offers Try again', async () => {
    const source = paced(PIECES);
    vi.stubGlobal('fetch', source.fetch);
    const handle = open();
    await until(() => element.querySelector('.ec-input-textarea'), 'the chat to open');
    send('Tell me a story');
    source.allow(2);
    await until(() => replyEl()?.querySelector('.ec-markdown')?.textContent.trim() === 'Once upon', 'two pieces');
    press(replyEl(), 'Stop');
    await until(() => replyEl().textContent.includes(LINES.stopped), 'the reply shown stopped');
    expect(buttons(replyEl())).toEqual(['Edit', 'Try again']);
    expect(handle.doc().messages.at(-1)).toMatchObject({ content: 'Once upon ', ended: 'stopped' });
    expect(source.calls[0].init.signal.aborted).toBe(true);
    source.allow(PIECES.length + 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(handle.doc().messages.at(-1).content).toBe('Once upon ');
  });

  it('offers Try again on an interrupted reply, and asking again writes it afresh', async () => {
    const source = paced(PIECES);
    vi.stubGlobal('fetch', source.fetch);
    const handle = open([
      { id: 'q', role: 'user', content: 'Tell me a story' },
      { id: 'r', role: 'assistant', content: 'Half a', run: 'run-0' },
    ]);
    await until(() => replyEl()?.textContent.includes(LINES.looking), 'the reply looked for');
    expect(buttons(replyEl())).not.toContain('Try again');
    // no work under the reply's key on any queue of the person's
    watching.filter((w) => w.key.endsWith(':r')).forEach((w) => w.onChange({ state: 'missing', taskUrl: null }));
    await until(() => buttons(replyEl()).includes('Try again'), 'Try again on the interrupted reply');
    expect(replyEl().textContent).toContain(LINES.interrupted);

    press(replyEl(), 'Try again');
    await until(() => buttons(replyEl()).includes('Stop'), 'Stop while it is written again');
    source.allow(PIECES.length + 1);
    await until(() => handle.doc().messages.at(-1).ended === 'finished' && buttons(replyEl()).join() === 'Edit', 'the reply finished');
    expect(replyEl().querySelector('.ec-markdown').textContent.trim()).toBe(WHOLE);
    expect(source.calls.length).toBe(1);
    expect(JSON.parse(source.calls[0].init.body).messages.map((m) => m.content)).toEqual(['You are a helpful assistant.', 'Tell me a story']);
  });
});
