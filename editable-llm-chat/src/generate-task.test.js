// The reply as work (generate-task.js), in a real Repo, with a stand-in
// provider (test/provider.js) streaming pieces. Each case is one way a reply
// can be written, read back from the chat's own history: every change the
// work made, as the patches between that change and the one before it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSubduction, Repo, splice } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { generate, streamPieces, STOPPED } from './generate-task.js';
import { provider } from './test/provider.js';

await initSubduction();

const PIECES = ['Once ', 'upon ', 'a ', 'time, ', 'the ', 'text ', 'grew ', 'by ', 'appends.'];
const WHOLE = PIECES.join('');
const KEY = 'sk-test-key';
const REQUEST = { endpoint: 'https://provider.invalid/v1/chat/completions', model: 'm', messages: [{ role: 'user', content: 'Tell me a story' }] };

/** How many changes each chat was made with: what came after is the work's, and the test's. */
const bases = new WeakMap();

/** A chat with a question and an empty reply, in a Repo of its own. */
function chat() {
  const repo = new Repo({ network: [] });
  const handle = repo.create({
    '@patchwork': { type: 'editable-llm-chat' },
    config: { apiUrl: 'https://provider.invalid/v1', model: 'm' },
    messages: [
      { id: 'q', role: 'user', content: 'Tell me a story' },
      { id: 'r', role: 'assistant', content: '' },
    ],
  });
  bases.set(handle, A.getAllChanges(handle.doc()).length);
  return { repo, handle, input: { chat: handle.url, message: 'r', request: REQUEST, apiKey: KEY } };
}

/** A run's context: its own run id and signal, and what it reported. */
function context(repo, run, controller = new AbortController()) {
  const progress = [];
  return { ctx: { repo, run, signal: controller.signal, progress: (v) => progress.push(v), log: () => {} }, progress, controller };
}

const reply = (handle) => handle.doc().messages.find((m) => m.id === 'r');

/** Every change made to a chat after it was made, each as the patches it made, in order. */
function history(handle, from = bases.get(handle)) {
  const doc = handle.doc();
  return A.getAllChanges(doc)
    .map((c) => A.decodeChange(c))
    .slice(from)
    .map((c) => A.diff(doc, c.deps, [c.hash]));
}

const isDelete = (p) => p.action === 'del';
// Automerge makes every string it is given a text: setting a field is a put of an empty text and a splice into it
const set = (path, value) => [{ action: 'put', path, value: '' }, { action: 'splice', path: [...path, 0], value }];
const appendsOf = (changes) => changes.filter((ps) => ps.some((p) => p.action === 'splice' && p.path[2] === 'content'));

describe('a reply written by a run', () => {
  it('takes the reply, appends each piece to the end of its text in a change of its own, and marks it finished in one more', async () => {
    const { repo, handle, input } = chat();
    const { ctx, progress } = context(repo, 'run-1');
    const p = provider(PIECES);
    const result = await generate(input, ctx, { fetch: p.fetch });

    expect(result).toEqual({ ended: 'finished', pieces: PIECES.length, chars: WHOLE.length });
    expect(reply(handle)).toMatchObject({ content: WHOLE, run: 'run-1', ended: 'finished' });
    const changes = history(handle);
    // the take-over names the run, and removes nothing: the reply was empty
    expect(changes[0]).toEqual(set(['messages', 1, 'run'], 'run-1'));
    // one change per piece, each one splice at the end of the text as it stood
    let length = 0;
    changes.slice(1, -1).forEach((patches, k) => {
      expect(patches).toEqual([{ action: 'splice', path: ['messages', 1, 'content', length], value: PIECES[k] }]);
      length += PIECES[k].length;
    });
    expect(changes.length).toBe(PIECES.length + 2);
    // finishing is one field
    expect(changes.at(-1)).toEqual(set(['messages', 1, 'ended'], 'finished'));
    expect(changes.flat().some(isDelete)).toBe(false);
    // progress counts pieces and characters; the result carries no text
    expect(progress.at(-1)).toEqual({ pieces: PIECES.length, chars: WHOLE.length });
    expect(progress.length).toBe(PIECES.length);
    expect(JSON.stringify(result)).not.toContain('Once');
  });

  it('sends the request as given, streaming, with the key only as the bearer of the request', async () => {
    const { repo, handle, input } = chat();
    const p = provider(['ok']);
    await generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch });
    expect(p.calls.length).toBe(1);
    expect(p.calls[0].url).toBe(REQUEST.endpoint);
    expect(JSON.parse(p.calls[0].init.body)).toEqual({ model: 'm', messages: REQUEST.messages, stream: true });
    expect(p.calls[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(handle.doc())).not.toContain(KEY);
  });

  it('puts every piece on the reply while messages are inserted and deleted before it', async () => {
    const { repo, handle, input } = chat();
    const gate = async (i) => {
      if (i === 2) handle.change((d) => d.messages.splice(0, 0, { id: 'a', role: 'user', content: 'inserted' }, { id: 'b', role: 'assistant', content: 'also' }));
      if (i === 5) handle.change((d) => d.messages.splice(0, 2));
      if (i === 7) handle.change((d) => d.messages.splice(0, 1));
    };
    const result = await generate(input, context(repo, 'run-1').ctx, { fetch: provider(PIECES, { gate }).fetch });
    expect(result.ended).toBe('finished');
    expect(handle.doc().messages.map((m) => [m.id, m.content])).toEqual([['r', WHOLE]]);
  });

  it("keeps a person's edit to the reply made while it streams, and puts the next pieces after it", async () => {
    const { repo, handle, input } = chat();
    const gate = async (i) => {
      if (i === 3) {
        handle.change((d) => {
          const at = d.messages.findIndex((m) => m.id === 'r');
          splice(d, ['messages', at, 'content'], 0, 4, 'Twice');
        });
      }
    };
    await generate(input, context(repo, 'run-1').ctx, { fetch: provider(PIECES, { gate }).fetch });
    expect(reply(handle).content).toBe(`Twice${WHOLE.slice(4)}`);
    expect(reply(handle).ended).toBe('finished');
  });

  it('a run after a lost one removes the lost text once, and the reply is one clean copy', async () => {
    const { repo, handle, input } = chat();
    // the first run's machine goes away after three pieces: told `stopping`, it leaves the reply to the next run
    const first = context(repo, 'run-1');
    const lost = generate(input, first.ctx, {
      fetch: provider(PIECES, { gate: (i) => (i === 3 ? (first.controller.abort('stopping'), new Promise(() => {})) : undefined) }).fetch,
    });
    await expect(lost).rejects.toThrow(STOPPED);
    const left = PIECES.slice(0, 3).join('');
    expect(reply(handle)).toMatchObject({ content: left, run: 'run-1' });
    expect(reply(handle).ended).toBeUndefined();
    const before = history(handle).length;

    const result = await generate(input, context(repo, 'run-2').ctx, { fetch: provider(PIECES).fetch });
    expect(result).toEqual({ ended: 'finished', pieces: PIECES.length, chars: WHOLE.length });
    expect(reply(handle)).toMatchObject({ content: WHOLE, run: 'run-2', ended: 'finished' });
    const all = history(handle);
    // the one write that is not an append: the take-over, removing exactly what was left
    const deletes = all.filter((ps) => ps.some(isDelete));
    expect(deletes.length).toBe(1);
    expect(deletes[0]).toEqual(expect.arrayContaining([{ action: 'del', path: ['messages', 1, 'content', 0], length: left.length }, ...set(['messages', 1, 'run'], 'run-2')]));
    expect(deletes[0].length).toBe(3);
    expect(all[before]).toBe(deletes[0]);
    expect(appendsOf(all.slice(before)).length).toBe(PIECES.length);
  });

  it('two runs at once: only the run the reply names writes, and the other stops at its next piece', async () => {
    const { repo, handle, input } = chat();
    const A_PIECES = ['A0 ', 'A1 ', 'A2 ', 'A3 '];
    const B_PIECES = ['B0 ', 'B1 ', 'B2 '];
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const first = context(repo, 'run-a');
    const a = generate(input, first.ctx, { fetch: provider(A_PIECES, { gate: (i) => (i === 2 ? held : undefined) }).fetch });
    // let the first run write two pieces and stop at its third
    for (let t = 0; reply(handle).content !== 'A0 A1 ' && t < 200; t++) await new Promise((r) => setTimeout(r, 5));
    expect(reply(handle).content).toBe('A0 A1 ');

    const second = context(repo, 'run-b');
    let bHeld;
    const bGate = new Promise((resolve) => (bHeld = resolve));
    const b = generate(input, second.ctx, { fetch: provider(B_PIECES, { gate: (i) => (i === 1 ? bGate : undefined) }).fetch });
    for (let t = 0; reply(handle).content !== 'B0 ' && t < 200; t++) await new Promise((r) => setTimeout(r, 5));
    expect(reply(handle)).toMatchObject({ content: 'B0 ', run: 'run-b' });

    // the first run's next piece finds the reply taken: it writes nothing and stops
    release();
    expect(await a).toEqual({ ended: 'taken', pieces: 2, chars: 6 });
    expect(reply(handle).content).toBe('B0 ');
    bHeld();
    expect(await b).toEqual({ ended: 'finished', pieces: 3, chars: 9 });
    expect(reply(handle)).toMatchObject({ content: 'B0 B1 B2 ', run: 'run-b', ended: 'finished' });
  });

  it('a stop mid-stream ends the run at once and marks the reply stopped, keeping what was streamed', async () => {
    const { repo, handle, input } = chat();
    const run = context(repo, 'run-1');
    let stoppedAt = 0;
    const p = provider(PIECES, { gate: (i) => (i === 4 ? ((stoppedAt = Date.now()), run.controller.abort('cancelled'), new Promise(() => {})) : undefined) });
    await expect(generate(input, run.ctx, { fetch: p.fetch })).rejects.toThrow(STOPPED);
    expect(Date.now() - stoppedAt).toBeLessThan(200);
    expect(p.calls[0].init.signal.aborted).toBe(true);
    expect(reply(handle)).toMatchObject({ content: PIECES.slice(0, 4).join(''), ended: 'stopped', run: 'run-1' });
    expect(history(handle).at(-1)).toEqual(set(['messages', 1, 'ended'], 'stopped'));
  });

  it('a run stopped because another holds its task (yielded) leaves the reply to that run', async () => {
    const { repo, handle, input } = chat();
    const run = context(repo, 'run-1');
    const p = provider(PIECES, { gate: (i) => (i === 2 ? (run.controller.abort('yielded'), new Promise(() => {})) : undefined) });
    await expect(generate(input, run.ctx, { fetch: p.fetch })).rejects.toThrow(STOPPED);
    expect(reply(handle).ended).toBeUndefined();
  });

  it("marks the reply failed with the provider's answer when the provider refuses", async () => {
    const { repo, handle, input } = chat();
    const p = provider(PIECES, { status: 401, body: '{"error":{"message":"No auth credentials found"}}' });
    const reason = 'LLM API error (401): {"error":{"message":"No auth credentials found"}}';
    await expect(generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch })).rejects.toThrow(reason);
    expect(reply(handle)).toMatchObject({ content: '', ended: 'failed', error: reason, run: 'run-1' });
  });

  it('marks the reply failed, keeping its text, when the provider sends an error mid-stream', async () => {
    const { repo, handle, input } = chat();
    const p = provider(PIECES.slice(0, 2), { after: 'data: {"error":{"message":"Provider overloaded"}}\n\n' });
    await expect(generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch })).rejects.toThrow('LLM API error: Provider overloaded');
    expect(reply(handle)).toMatchObject({ content: 'Once upon ', ended: 'failed', error: 'LLM API error: Provider overloaded' });
  });

  it('does nothing to a reply another run has ended, and says how it ended', async () => {
    for (const how of ['finished', 'stopped', 'failed']) {
      const { repo, handle, input } = chat();
      handle.change((d) => {
        const r = d.messages[1];
        splice(d, ['messages', 1, 'content'], 0, 0, 'Done.');
        r.run = 'run-0';
        r.ended = how;
      });
      const heads = handle.heads();
      const p = provider(PIECES);
      expect(await generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch })).toEqual({ ended: how, pieces: 0, chars: 0, already: true });
      expect(handle.heads()).toEqual(heads);
      expect(p.calls.length).toBe(0);
    }
  });

  it('stops, writing nothing more, when the reply is deleted while it streams', async () => {
    const { repo, handle, input } = chat();
    const p = provider(PIECES, { gate: (i) => (i === 3 ? handle.change((d) => d.messages.splice(1, 1)) : undefined) });
    expect(await generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch })).toEqual({ ended: 'gone', pieces: 3, chars: 12 });
    expect(p.calls[0].init.signal.aborted).toBe(true);
    expect(handle.doc().messages.map((m) => m.id)).toEqual(['q']);
  });
});

describe('the stream', () => {
  it('reads pieces across chunk boundaries, skips comments and lines that are not JSON, and ends at [DONE] or the end of the body', async () => {
    const chunks = [': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"con', 'tent":"a"}}]}\n\ndata: nonsense\n\ndata: {"choices":[{"delta":{}}]}\n', '\ndata: {"choices":[{"delta":{"content":"b"}}]}'];
    const body = () => new ReadableStream({ start: (c) => (chunks.forEach((t) => c.enqueue(new TextEncoder().encode(t))), c.close()) });
    const got = [];
    for await (const piece of streamPieces(async () => new Response(body()), REQUEST, '', new AbortController().signal)) got.push(piece);
    // the last event has no blank line after it: the end of the body ends it
    expect(got).toEqual(['a', 'b']);
  });
});

describe('what the work imports', () => {
  it('is Automerge by bare name and nothing else, so a page, a browser run worker and a Node thread can all run it', () => {
    const source = readFileSync(new URL('./generate-task.js', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@automerge/automerge-repo']);
    expect(source).not.toMatch(/\bimport\(/);
    expect(source).not.toMatch(/\b(document|window|localStorage)\./);
  });
});
