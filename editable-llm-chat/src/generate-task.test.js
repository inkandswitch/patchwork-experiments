// The reply as work (generate-task.js), in a real Repo, with a stand-in
// provider (test/provider.js) streaming pieces. Each case is one way a reply
// can be written, read back from the chat's own history: every change the
// work made, as the patches between that change and the one before it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSubduction, Repo, splice } from '@automerge/automerge-repo';
import * as A from '@automerge/automerge';
import { generate, streamPieces, ENDED_EARLY } from './generate-task.js';
import { provider } from './test/provider.js';
import { shownReply } from './reply-status.js';

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
// A run's beginning: a fresh message put in the reply's place, whole, as Automerge reports a new map
// (each key an empty text, then each text's characters; the empty content has none)
const replaced = (at, run) => [
  { action: 'put', path: ['messages', at], value: {} },
  ...['content', 'id', 'role', 'run'].map((k) => ({ action: 'put', path: ['messages', at, k], value: '' })),
  ...[['id', 'r'], ['role', 'assistant'], ['run', run]].map(([k, v]) => ({ action: 'splice', path: ['messages', at, k, 0], value: v })),
];

describe('a reply written by a run', () => {
  it("the history of a run: one replace at the start, one insertion at the end per piece, and the ending", async () => {
    const { repo, handle, input } = chat();
    const { ctx, progress } = context(repo, 'run-1');
    const p = provider(PIECES);
    const result = await generate(input, ctx, { fetch: p.fetch });

    expect(result).toEqual({ ended: 'finished', pieces: PIECES.length, chars: WHOLE.length });
    expect(reply(handle)).toEqual({ id: 'r', role: 'assistant', content: WHOLE, run: 'run-1', ended: 'finished' });
    const changes = history(handle);
    // the run's beginning: a message of its own in the reply's place, in one assignment
    expect(changes[0]).toEqual(replaced(1, 'run-1'));
    // one change per piece, each one splice at the end of the text as it stood
    let length = 0;
    changes.slice(1, -1).forEach((patches, k) => {
      expect(patches).toEqual([{ action: 'splice', path: ['messages', 1, 'content', length], value: PIECES[k] }]);
      length += PIECES[k].length;
    });
    expect(changes.length).toBe(PIECES.length + 2);
    // finishing is one field of the run's own message
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

  it('a run after a lost one puts a message of its own in the reply\'s place, so the lost text goes with the message it was in', async () => {
    const { repo, handle, input } = chat();
    // the first run's machine goes away after three pieces: told `stopping`, it leaves the reply to the next run
    const first = context(repo, 'run-1');
    const lost = generate(input, first.ctx, {
      fetch: provider(PIECES, { gate: (i) => (i === 3 ? (first.controller.abort('stopping'), new Promise(() => {})) : undefined) }).fetch,
    });
    expect(await lost).toEqual({ ended: 'taken', pieces: 3, chars: 12 });
    expect(reply(handle)).toEqual({ id: 'r', role: 'assistant', content: PIECES.slice(0, 3).join(''), run: 'run-1' });
    const before = history(handle).length;

    const result = await generate(input, context(repo, 'run-2').ctx, { fetch: provider(PIECES).fetch });
    expect(result).toEqual({ ended: 'finished', pieces: PIECES.length, chars: WHOLE.length });
    expect(reply(handle)).toEqual({ id: 'r', role: 'assistant', content: WHOLE, run: 'run-2', ended: 'finished' });
    const after = history(handle).slice(before);
    // the take-over is one replace, then appends from the start of the new text, then the ending; nothing is deleted
    expect(after[0]).toEqual(replaced(1, 'run-2'));
    let length = 0;
    after.slice(1, -1).forEach((patches, k) => {
      expect(patches).toEqual([{ action: 'splice', path: ['messages', 1, 'content', length], value: PIECES[k] }]);
      length += PIECES[k].length;
    });
    expect(after.length).toBe(PIECES.length + 2);
    expect(history(handle).flat().some(isDelete)).toBe(false);
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
    expect(await generate(input, run.ctx, { fetch: p.fetch })).toEqual({ ended: 'stopped', pieces: 4, chars: 18 });
    expect(Date.now() - stoppedAt).toBeLessThan(200);
    expect(p.calls[0].init.signal.aborted).toBe(true);
    expect(reply(handle)).toMatchObject({ content: PIECES.slice(0, 4).join(''), ended: 'stopped', run: 'run-1' });
    expect(history(handle).at(-1)).toEqual(set(['messages', 1, 'ended'], 'stopped'));
  });

  it('a run stopped before it has the chat writes nothing', async () => {
    const { repo, handle, input } = chat();
    const run = context(repo, 'run-1');
    run.controller.abort('cancelled');
    const heads = handle.heads();
    const p = provider(PIECES);
    expect(await generate(input, run.ctx, { fetch: p.fetch })).toEqual({ ended: 'stopped', pieces: 0, chars: 0 });
    expect(handle.heads()).toEqual(heads);
    expect(p.calls.length).toBe(0);
  });

  it('a run stopped because another holds its task (yielded) leaves the reply to that run', async () => {
    const { repo, handle, input } = chat();
    const run = context(repo, 'run-1');
    const p = provider(PIECES, { gate: (i) => (i === 2 ? (run.controller.abort('yielded'), new Promise(() => {})) : undefined) });
    expect(await generate(input, run.ctx, { fetch: p.fetch })).toEqual({ ended: 'taken', pieces: 2, chars: 10 });
    expect(reply(handle).ended).toBeUndefined();
  });

  it('a run that took the reply over and is then told it yielded leaves it unended, so it shows as interrupted', async () => {
    const { repo, handle, input } = chat();
    let releaseA;
    const holdA = new Promise((resolve) => (releaseA = resolve));
    const a = generate(input, context(repo, 'run-a').ctx, { fetch: provider(['A0 ', 'A1 '], { gate: (i) => (i === 1 ? holdA : undefined) }).fetch });
    for (let t = 0; reply(handle).content !== 'A0 ' && t < 200; t++) await new Promise((r) => setTimeout(r, 5));
    // a later run of the same task takes the reply over, writes a piece, then hears the earlier run and yields
    const second = context(repo, 'run-b');
    const b = generate(input, second.ctx, { fetch: provider(['B0 ', 'B1 '], { gate: (i) => (i === 1 ? (second.controller.abort('yielded'), new Promise(() => {})) : undefined) }).fetch });
    expect(await b).toEqual({ ended: 'taken', pieces: 1, chars: 3 });
    releaseA();
    // the earlier run finds the reply another's, writes nothing, and returns: its task succeeds without finishing the reply
    const resultA = await a;
    expect(resultA).toEqual({ ended: 'taken', pieces: 1, chars: 3 });
    expect(reply(handle)).toMatchObject({ content: 'B0 ', run: 'run-b' });
    expect(reply(handle).ended).toBeUndefined();
    expect(shownReply(reply(handle), { state: 'succeeded', result: resultA, taskUrl: 'automerge:t' })).toMatchObject({ status: 'interrupted', retry: true });
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

// Two machines that cannot hear each other each hold a replica of the chat:
// an Automerge document with an actor of its own, changed only on that
// machine, until the test lets them meet, when each merges what the other
// has. A run sees only its own machine's replica, as a run cut off from the
// sync server does. Each case is checked on every replica after they meet.
describe('runs on replicas that cannot hear each other', () => {
  const ACTORS = { a: 'aa'.repeat(16), b: 'bb'.repeat(16), c: 'cc'.repeat(16), p: 'dd'.repeat(16) };
  // the chat as the server had it before any run: one document, which every machine's replica starts from
  const BASE = () =>
    A.from({
      '@patchwork': { type: 'editable-llm-chat' },
      config: { apiUrl: 'https://provider.invalid/v1', model: 'm' },
      messages: [
        { id: 'q', role: 'user', content: 'Tell me a story' },
        { id: 'r', role: 'assistant', content: '' },
      ],
    }, { actor: 'ee'.repeat(16) });
  const INPUT = { chat: 'automerge:chat', message: 'r', request: REQUEST, apiKey: KEY };

  /** A machine's replica of the chat, made from what another had, and a Repo that finds it there. */
  function replica(from, actor) {
    let doc = A.clone(from, { actor });
    const handle = {
      doc: () => doc,
      change: (fn) => (doc = A.change(doc, fn)),
      take: (other) => (doc = A.merge(doc, other)),
    };
    return { handle, repo: { find: async () => handle } };
  }

  /** The machines hear each other: each merges what every other had when they met. */
  function meet(...replicas) {
    const had = replicas.map((r) => A.clone(r.handle.doc()));
    replicas.forEach((r, i) => had.forEach((doc, j) => i !== j && r.handle.take(A.clone(doc))));
    const heads = replicas.map((r) => [...A.getHeads(r.handle.doc())].sort());
    heads.forEach((h) => expect(h).toEqual(heads[0]));
  }

  const replyOn = (r) => r.handle.doc().messages.find((m) => m.id === 'r');

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

  /** Lets a run write its first n pieces, and waits until it has. */
  async function upTo(run, source, n) {
    source.allow(n);
    for (let t = 0; run.progress.length < n && t < 400; t++) await new Promise((r) => setTimeout(r, 5));
    expect(run.progress.length).toBe(n);
  }

  const ALL = 100;

  for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
    it(`the review's case (actors ${first} then ${second}): a run cut off writes on and ends its own copy, and after they meet the reply is the run's that took over, exactly`, async () => {
      const machineA = replica(BASE(), ACTORS[first]);
      const fromA = paced(['A0 ', 'A1 ', 'A2 ', 'A3 ']);
      const runA = context(machineA.repo, 'run-a');
      const a = generate(INPUT, runA.ctx, { fetch: fromA.fetch });
      await upTo(runA, fromA, 2);

      // the server had run A's beginning and two pieces; A is cut off, and another machine takes the task over
      const machineB = replica(machineA.handle.doc(), ACTORS[second]);
      const fromB = paced(['B0 ', 'B1 ', 'B2 ']);
      fromB.allow(ALL);
      expect(await generate(INPUT, context(machineB.repo, 'run-b').ctx, { fetch: fromB.fetch })).toEqual({ ended: 'finished', pieces: 3, chars: 9 });

      // A, still cut off, appends the rest to its own copy and ends it
      fromA.allow(ALL);
      expect(await a).toEqual({ ended: 'finished', pieces: 4, chars: 12 });
      expect(replyOn(machineA)).toEqual({ id: 'r', role: 'assistant', content: 'A0 A1 A2 A3 ', run: 'run-a', ended: 'finished' });

      meet(machineA, machineB);
      for (const machine of [machineA, machineB]) {
        expect(replyOn(machine)).toEqual({ id: 'r', role: 'assistant', content: 'B0 B1 B2 ', run: 'run-b', ended: 'finished' });
      }
    });
  }

  it('two first runs at once: after they meet one whole reply stands, the same on both, and the run whose message lost stops at its next piece', async () => {
    const winners = new Set();
    for (const [first, second] of [['a', 'b'], ['b', 'a']]) {
      const base = BASE();
      const machineA = replica(base, ACTORS[first]);
      const machineB = replica(base, ACTORS[second]);
      const fromA = paced(['A0 ', 'A1 ', 'A2 ', 'A3 ']);
      const fromB = paced(['B0 ', 'B1 ', 'B2 ', 'B3 ']);
      const runA = context(machineA.repo, 'run-a');
      const runB = context(machineB.repo, 'run-b');
      const a = generate(INPUT, runA.ctx, { fetch: fromA.fetch });
      const b = generate(INPUT, runB.ctx, { fetch: fromB.fetch });
      await upTo(runA, fromA, 2);
      await upTo(runB, fromB, 2);

      meet(machineA, machineB);
      const standing = replyOn(machineA);
      expect(replyOn(machineB)).toEqual(standing);
      const won = standing.run === 'run-a' ? 'a' : 'b';
      winners.add(won);
      expect(standing).toEqual({ id: 'r', role: 'assistant', content: won === 'a' ? 'A0 A1 ' : 'B0 B1 ', run: `run-${won}` });

      fromA.allow(ALL);
      fromB.allow(ALL);
      const [winner, loser] = won === 'a' ? [a, b] : [b, a];
      expect(await loser).toEqual({ ended: 'taken', pieces: 2, chars: 6 });
      expect(await winner).toEqual({ ended: 'finished', pieces: 4, chars: 12 });

      meet(machineA, machineB);
      const whole = won === 'a' ? 'A0 A1 A2 A3 ' : 'B0 B1 B2 B3 ';
      for (const machine of [machineA, machineB]) {
        expect(replyOn(machine)).toEqual({ id: 'r', role: 'assistant', content: whole, run: `run-${won}`, ended: 'finished' });
      }
    }
    // the two orders of actors make each run the one whose message lost once
    expect([...winners].sort()).toEqual(['a', 'b']);
  });

  it('three runs, each taking over from one cut off, all ending their own copies: after they meet the last one stands; a run on the finished reply changes nothing', async () => {
    const machineA = replica(BASE(), ACTORS.a);
    const fromA = paced(['A0 ', 'A1 ', 'A2 ']);
    const runA = context(machineA.repo, 'run-a');
    const a = generate(INPUT, runA.ctx, { fetch: fromA.fetch });
    await upTo(runA, fromA, 1);

    const machineB = replica(machineA.handle.doc(), ACTORS.b);
    const fromB = paced(['B0 ', 'B1 ', 'B2 ']);
    const runB = context(machineB.repo, 'run-b');
    const b = generate(INPUT, runB.ctx, { fetch: fromB.fetch });
    await upTo(runB, fromB, 2);

    const machineC = replica(machineB.handle.doc(), ACTORS.c);
    const fromC = paced(['C0 ', 'C1 ', 'C2 ']);
    fromC.allow(ALL);
    expect(await generate(INPUT, context(machineC.repo, 'run-c').ctx, { fetch: fromC.fetch })).toEqual({ ended: 'finished', pieces: 3, chars: 9 });

    fromA.allow(ALL);
    fromB.allow(ALL);
    expect(await a).toEqual({ ended: 'finished', pieces: 3, chars: 9 });
    expect(await b).toEqual({ ended: 'finished', pieces: 3, chars: 9 });

    meet(machineA, machineB, machineC);
    const last = { id: 'r', role: 'assistant', content: 'C0 C1 C2 ', run: 'run-c', ended: 'finished' };
    for (const machine of [machineA, machineB, machineC]) expect(replyOn(machine)).toEqual(last);

    // the task taken once more, on the finished reply: the run writes nothing and asks the provider nothing
    const heads = A.getHeads(machineA.handle.doc());
    const again = provider(['D0 ']);
    expect(await generate(INPUT, context(machineA.repo, 'run-d').ctx, { fetch: again.fetch })).toEqual({ ended: 'finished', pieces: 0, chars: 0, already: true });
    expect(A.getHeads(machineA.handle.doc())).toEqual(heads);
    expect(again.calls.length).toBe(0);
    expect(replyOn(machineA)).toEqual(last);
  });

  it("a person's edit of the reply's text, made while a piece is appended elsewhere: both stand", async () => {
    const machine = replica(BASE(), ACTORS.a);
    const source = paced(['A0 ', 'A1 ', 'A2 ', 'A3 ']);
    const run = context(machine.repo, 'run-a');
    const writing = generate(INPUT, run.ctx, { fetch: source.fetch });
    await upTo(run, source, 2);

    const person = replica(machine.handle.doc(), ACTORS.p);
    person.handle.change((d) => splice(d, ['messages', 1, 'content'], 0, 2, 'Twice'));
    await upTo(run, source, 3);
    expect(replyOn(person).content).toBe('Twice A1 ');
    expect(replyOn(machine).content).toBe('A0 A1 A2 ');

    meet(machine, person);
    for (const r of [machine, person]) expect(replyOn(r).content).toBe('Twice A1 A2 ');

    source.allow(ALL);
    expect(await writing).toEqual({ ended: 'finished', pieces: 4, chars: 12 });
    meet(machine, person);
    for (const r of [machine, person]) expect(replyOn(r)).toEqual({ id: 'r', role: 'assistant', content: 'Twice A1 A2 A3 ', run: 'run-a', ended: 'finished' });
  });

  it('a person deletes the reply while a piece is appended elsewhere: after they meet it is gone, the run stops, and nothing makes it again', async () => {
    const machine = replica(BASE(), ACTORS.a);
    const source = paced(['A0 ', 'A1 ', 'A2 ', 'A3 ']);
    const run = context(machine.repo, 'run-a');
    const writing = generate(INPUT, run.ctx, { fetch: source.fetch });
    await upTo(run, source, 2);

    const person = replica(machine.handle.doc(), ACTORS.p);
    person.handle.change((d) => d.messages.splice(1, 1));
    await upTo(run, source, 3);

    meet(machine, person);
    for (const r of [machine, person]) expect(r.handle.doc().messages.map((m) => m.id)).toEqual(['q']);

    source.allow(ALL);
    expect(await writing).toEqual({ ended: 'gone', pieces: 3, chars: 9 });
    expect(source.calls[0].init.signal.aborted).toBe(true);
    meet(machine, person);
    for (const r of [machine, person]) expect(r.handle.doc().messages.map((m) => m.id)).toEqual(['q']);
  });
});

describe('the stream', () => {
  const body = (chunks) => () => new ReadableStream({ start: (c) => (chunks.forEach((t) => c.enqueue(new TextEncoder().encode(t))), c.close()) });
  const read = async (chunks) => {
    const got = [];
    try {
      for await (const piece of streamPieces(async () => new Response(body(chunks)()), REQUEST, '', new AbortController().signal)) got.push(piece);
    } catch (error) {
      return { got, error: error.message };
    }
    return { got };
  };

  it('reads pieces across chunk boundaries, skips comments and lines that are not JSON, and ends at [DONE], also at the end of the body', async () => {
    const chunks = [': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"con', 'tent":"a"}}]}\n\ndata: nonsense\n\ndata: {"choices":[{"delta":{}}]}\n', '\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DO', 'NE]'];
    // the end marker has no blank line after it: the end of the body ends its line
    expect(await read(chunks)).toEqual({ got: ['a', 'b'] });
  });

  it("a body that closes without the provider's end marker is not a finished reply: it throws, after the pieces it carried", async () => {
    expect(await read(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n'])).toEqual({ got: ['a'], error: ENDED_EARLY });
    expect(await read([])).toEqual({ got: [], error: ENDED_EARLY });
  });
});

describe('a stream that closes early', () => {
  it('ends the reply failed, keeping what came, with a plain sentence, and Try again is offered', async () => {
    const { repo, handle, input } = chat();
    const p = provider(PIECES.slice(0, 2), { after: '' });
    await expect(generate(input, context(repo, 'run-1').ctx, { fetch: p.fetch })).rejects.toThrow(ENDED_EARLY);
    expect(reply(handle)).toEqual({ id: 'r', role: 'assistant', content: 'Once upon ', run: 'run-1', ended: 'failed', error: ENDED_EARLY });
    expect(shownReply(reply(handle), null)).toEqual({ status: 'failed', line: `Error: ${ENDED_EARLY}`, editable: true, stoppable: false, retry: true });
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
