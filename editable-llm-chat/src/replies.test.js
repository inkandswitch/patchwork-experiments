// The tool's actions on replies (replies.js) through the task system's
// doWork, watchWork and stopWork, stood in for (their own tests are the
// tasks package's), on a real Repo: Send, Stop here and on the queue, Try
// again, Edit, closing the tool, and where the provider's key goes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initSubduction, Repo } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { replyKey, requestFor, SYSTEM_PROMPT } from './reply.js';
import { LINES } from './reply-status.js';

await initSubduction();

const calls = vi.hoisted(() => ({ doWork: [], watch: [], stop: [] }));
vi.mock('./task-client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  doWork: (repo, request, options) =>
    new Promise((resolve, reject) => {
      calls.doWork.push({ repo, request, options, resolve, reject });
      options.signal?.addEventListener('abort', () => reject(new Error('The task was cancelled')));
    }),
  watchWork: (repo, key, onChange) => {
    const call = { repo, key, onChange, stopped: false };
    calls.watch.push(call);
    return () => (call.stopped = true);
  },
  stopWork: async (repo, key) => {
    calls.stop.push({ repo, key });
    return true;
  },
}));

const { chatReplies, generateTaskUrl } = await import('./replies.js');

const KEY = 'sk-test-secret-key';
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A chat with an earlier exchange, and whatever messages a case adds. */
function chat(more = [], config = {}) {
  const repo = new Repo({ network: [] });
  const handle = repo.create({
    '@patchwork': { type: 'editable-llm-chat' },
    config: { apiUrl: 'https://provider.invalid/v1/', model: 'm', ...config },
    messages: [
      { id: 'q0', role: 'user', content: 'Hi' },
      { id: 'a0', role: 'assistant', content: 'Hello!', run: 'run-0', ended: 'finished' },
      ...more,
    ],
  });
  let changes = 0;
  const replies = chatReplies(handle, repo, { apiKey: KEY, onChange: () => changes++ });
  return { repo, handle, replies, changes: () => changes };
}

const message = (handle, id) => handle.doc().messages.find((m) => m.id === id);
const watched = (handle, id) => calls.watch.filter((w) => w.key === replyKey(handle.url, id) && !w.stopped);
const view = (more) => ({ key: 'k', state: 'running', taskUrl: null, importUrl: 'x', input: null, progress: null, logs: [], result: undefined, error: null, runs: [], ...more });

beforeEach(() => {
  calls.doWork.length = 0;
  calls.watch.length = 0;
  calls.stop.length = 0;
});

describe('Send', () => {
  it('puts the message and an empty reply in the chat in one change, then asks for the reply under its key', async () => {
    const { handle, replies } = chat();
    const before = A.getAllChanges(handle.doc()).length;
    const id = replies.send('  Tell me a story  ');
    expect(A.getAllChanges(handle.doc()).length).toBe(before + 1);
    const [, , asked, reply] = handle.doc().messages;
    expect(asked).toMatchObject({ role: 'user', content: 'Tell me a story' });
    expect(reply).toMatchObject({ id, role: 'assistant', content: '' });
    expect(typeof asked.id).toBe('string');
    expect(asked.id).not.toBe(id);

    expect(calls.doWork.length).toBe(1);
    const { request } = calls.doWork[0];
    expect(request.key).toBe(replyKey(handle.url, id));
    expect(request.importUrl).toBe(generateTaskUrl());
    expect(request.importUrl).toMatch(/\/src\/generate-task\.js$/);
    expect(request).not.toHaveProperty('needs');
    expect(request.input).toEqual({
      chat: handle.url,
      message: id,
      request: {
        endpoint: 'https://provider.invalid/v1/chat/completions',
        model: 'm',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
          { role: 'user', content: 'Tell me a story' },
        ],
      },
      apiKey: KEY,
    });
    // the reply is followed by its key too, so work seen on the queue is shown
    expect(watched(handle, id).length).toBe(1);
  });

  it('shows the reply as being written while its work goes on, and sends nothing more meanwhile', async () => {
    const { handle, replies } = chat();
    const id = replies.send('One');
    expect(replies.shown(message(handle, id))).toMatchObject({ status: 'streaming', editable: false, stoppable: true });
    expect(replies.busy()).toBe(true);
    const heads = handle.heads();
    expect(replies.send('Two')).toBe(null);
    expect(handle.heads()).toEqual(heads);
    expect(calls.doWork.length).toBe(1);

    const { options, resolve } = calls.doWork[0];
    options.onProgress(view({ state: 'running', progress: { pieces: 1, chars: 4 } }));
    expect(replies.shown(message(handle, id)).work).toMatchObject({ state: 'running', taskUrl: null });
    handle.change((d) => {
      const r = d.messages.find((m) => m.id === id);
      r.content = 'Done';
      r.run = 'run-1';
      r.ended = 'finished';
    });
    options.onProgress(view({ state: 'succeeded', result: { ended: 'finished', pieces: 1, chars: 4 } }));
    resolve({ ended: 'finished', pieces: 1, chars: 4 });
    await settle();
    expect(replies.shown(message(handle, id))).toMatchObject({ status: 'finished', editable: true });
    expect(replies.busy()).toBe(false);
    // the ended reply is no longer followed
    expect(watched(handle, id).length).toBe(0);
  });

  it("passes the chat's own needs, when it has any", () => {
    const { replies } = chat([], { needs: ['ollama'] });
    replies.send('Local, please');
    expect(calls.doWork[0].request.needs).toEqual(['ollama']);
  });

  it('sends nothing for an empty message', () => {
    const { handle, replies } = chat();
    const heads = handle.heads();
    expect(replies.send('   ')).toBe(null);
    expect(handle.heads()).toEqual(heads);
    expect(calls.doWork.length).toBe(0);
  });
});

describe('Stop', () => {
  it("stops this page's own work by its signal; then this page shows what the chat says, as every other page does", async () => {
    // after a stop, what a page shows comes from the message, and from no work, since none goes on
    const pages = (handle, repo, id) => {
      const other = chatReplies(handle, repo, { apiKey: KEY });
      // the other page's queue has nothing under the key: the work was this page's
      watched(handle, id).forEach((w) => w.onChange(view({ state: 'missing', taskUrl: null })));
      return other;
    };

    // stopped once its run had begun: the run marks its own message stopped
    {
      const { repo, handle, replies } = chat();
      const id = replies.send('One');
      calls.doWork[0].options.onProgress(view({ state: 'running' }));
      handle.change((d) => {
        const at = d.messages.findIndex((m) => m.id === id);
        d.messages[at] = { id, role: 'assistant', content: 'Half', run: 'run-1' };
      });
      replies.stop(id);
      expect(calls.doWork[0].options.signal.aborted).toBe(true);
      handle.change((d) => (d.messages.find((m) => m.id === id).ended = 'stopped'));
      await settle();
      expect(calls.stop.length).toBe(0);
      const other = pages(handle, repo, id);
      expect(replies.shown(message(handle, id))).toEqual({ status: 'stopped', line: LINES.stopped, editable: true, stoppable: false, retry: true });
      expect(other.shown(message(handle, id))).toEqual(replies.shown(message(handle, id)));
    }

    // stopped before any run began: nothing was written, so the reply is interrupted here as everywhere
    {
      const { repo, handle, replies } = chat();
      const id = replies.send('One');
      replies.stop(id);
      await settle();
      watched(handle, id).forEach((w) => w.onChange(view({ state: 'missing', taskUrl: null })));
      const other = pages(handle, repo, id);
      expect(replies.shown(message(handle, id))).toEqual({ status: 'interrupted', line: LINES.interrupted, editable: true, stoppable: false, retry: true });
      expect(other.shown(message(handle, id))).toEqual(replies.shown(message(handle, id)));
    }
  });

  it('stops work seen on the queue by its key, for a reply being written elsewhere', () => {
    const { handle, replies } = chat([{ id: 'r', role: 'assistant', content: 'Part', run: 'run-1' }]);
    // before the queue has been heard from, the reply may be being written: nothing is sent
    expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'looking', line: LINES.looking, editable: false });
    expect(replies.send('More')).toBe(null);
    watched(handle, 'r')[0].onChange(view({ state: 'running', taskUrl: 'automerge:task' }));
    expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'streaming', stoppable: true, work: { taskUrl: 'automerge:task' } });
    expect(replies.busy()).toBe(true);
    replies.stop('r');
    expect(calls.stop).toEqual([{ repo: expect.anything(), key: replyKey(handle.url, 'r') }]);
    expect(calls.doWork.length).toBe(0);
  });
});

describe('Try again', () => {
  it('asks for an interrupted reply again under the same key, with the messages before it', () => {
    const { handle, replies } = chat([
      { id: 'q1', role: 'user', content: 'And then?' },
      { id: 'r', role: 'assistant', content: 'Half a', run: 'run-1' },
      { id: 'q2', role: 'user', content: 'Later' },
    ]);
    watched(handle, 'r')[0].onChange(view({ state: 'missing', taskUrl: null }));
    expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'interrupted', retry: true, editable: true });
    replies.tryAgain('r');
    expect(calls.doWork.length).toBe(1);
    const { request } = calls.doWork[0];
    expect(request.key).toBe(replyKey(handle.url, 'r'));
    expect(request.input.message).toBe('r');
    expect(request.input.request.messages.map((m) => m.content)).toEqual([SYSTEM_PROMPT, 'Hi', 'Hello!', 'And then?']);
    expect(replies.shown(message(handle, 'r')).status).toBe('streaming');
  });

  it('puts a stopped or failed reply back as Send made it, in one change, and asks for it again', () => {
    for (const ended of [{ ended: 'stopped' }, { ended: 'failed', error: "The provider's reply ended early, before it said it was complete." }]) {
      calls.doWork.length = 0;
      const { handle, replies } = chat([
        { id: 'q1', role: 'user', content: 'And then?' },
        { id: 'r', role: 'assistant', content: 'Half a', run: 'run-1', ...ended },
      ]);
      expect(replies.shown(message(handle, 'r')).retry).toBe(true);
      const before = A.getAllChanges(handle.doc()).length;
      replies.tryAgain('r');
      expect(A.getAllChanges(handle.doc()).length).toBe(before + 1);
      expect(message(handle, 'r')).toEqual({ id: 'r', role: 'assistant', content: '' });
      expect(calls.doWork.length).toBe(1);
      expect(calls.doWork[0].request.key).toBe(replyKey(handle.url, 'r'));
      expect(calls.doWork[0].request.input.request.messages.map((m) => m.content)).toEqual([SYSTEM_PROMPT, 'Hi', 'Hello!', 'And then?']);
      expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'streaming', stoppable: true });
    }
  });

  it('is offered for a reply no run began, with no work going on (the page closed between sending and asking)', () => {
    const { handle, replies } = chat([
      { id: 'q1', role: 'user', content: 'And then?' },
      { id: 'r', role: 'assistant', content: '' },
    ]);
    expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'looking', retry: false });
    watched(handle, 'r')[0].onChange(view({ state: 'missing', taskUrl: null }));
    expect(replies.shown(message(handle, 'r'))).toMatchObject({ status: 'interrupted', retry: true });
    replies.tryAgain('r');
    expect(calls.doWork.length).toBe(1);
  });

  it('is not offered, and does nothing, for a reply that finished or one being written', () => {
    const { handle, replies } = chat([{ id: 'r', role: 'assistant', content: 'Part', run: 'run-1' }]);
    const heads = handle.heads();
    replies.tryAgain('a0');
    watched(handle, 'r')[0].onChange(view({ state: 'running', taskUrl: 'automerge:task' }));
    replies.tryAgain('r');
    expect(calls.doWork.length).toBe(0);
    expect(handle.heads()).toEqual(heads);
  });
});

describe('Edit', () => {
  it('replaces the text of a reply whose work has ended, found by its id after others were inserted before it', () => {
    const { handle, replies } = chat();
    handle.change((d) => d.messages.splice(0, 0, { id: 'x', role: 'user', content: 'inserted' }));
    expect(replies.edit('a0', 'Hello, edited!')).toBe(true);
    expect(message(handle, 'a0').content).toBe('Hello, edited!');
    expect(message(handle, 'x').content).toBe('inserted');
  });

  it('is refused while the reply is being written', () => {
    const { handle, replies } = chat();
    const id = replies.send('One');
    expect(replies.edit(id, 'mine')).toBe(false);
    expect(message(handle, id).content).toBe('');
  });
});

describe('closing the tool', () => {
  it("stops this page's own work done here, leaves work on the queue going, and stops following", () => {
    const { handle, replies } = chat();
    const id = replies.send('Here');
    calls.doWork[0].options.onProgress(view({ state: 'running', taskUrl: null }));
    replies.dispose();
    expect(calls.doWork[0].options.signal.aborted).toBe(true);
    expect(watched(handle, id).length).toBe(0);

    const other = chat();
    const queued = other.replies.send('On the queue');
    calls.doWork[1].options.onProgress(view({ state: 'running', taskUrl: 'automerge:task' }));
    other.replies.dispose();
    expect(calls.doWork[1].options.signal.aborted).toBe(false);
    expect(watched(other.handle, queued).length).toBe(0);
  });
});

describe("the provider's key", () => {
  it("is in the task's input and nowhere else: not in the chat, the key, the needs or the request", () => {
    const { handle, replies } = chat([], { needs: ['ollama'] });
    const id = replies.send('Secret?');
    const { request } = calls.doWork[0];
    expect(request.input.apiKey).toBe(KEY);
    const { apiKey, ...rest } = request.input;
    expect(JSON.stringify({ ...request, input: rest })).not.toContain(KEY);
    expect(JSON.stringify(handle.doc())).not.toContain(KEY);
    expect(calls.watch.map((w) => w.key).join(' ')).not.toContain(KEY);
    expect(replyKey(handle.url, id)).not.toContain(KEY);
  });
});

describe('the request', () => {
  it('leaves out messages with no text and replies being written', () => {
    const doc = {
      config: { apiUrl: 'https://p.invalid/v1', model: 'm' },
      messages: [
        { id: 'a', role: 'user', content: 'one' },
        { id: 'b', role: 'assistant', content: '' },
        { id: 'c', role: 'assistant', content: 'being written' },
        { id: 'd', role: 'user', content: 'two' },
        { id: 'e', role: 'assistant', content: '' },
        { id: 'f', role: 'user', content: 'after' },
      ],
    };
    expect(requestFor(doc, 'e', (id) => id === 'c')).toEqual({
      endpoint: 'https://p.invalid/v1/chat/completions',
      model: 'm',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'one' },
        { role: 'user', content: 'two' },
      ],
    });
  });
});
