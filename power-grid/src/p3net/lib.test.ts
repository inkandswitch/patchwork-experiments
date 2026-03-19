import { describe, it, expect, vi } from 'vitest';
import {
  defineNet,
  type NetDef,
  type NetState,
  type P3NetDoc,
  type TokenState,
  type ReadonlyTokens,
} from './lib';
import type { DocHandle, Repo } from '@automerge/automerge-repo';

// ─── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal DocHandle mock. Stores doc in memory; change() applies mutations. */
function makeHandle(tokens: NetState = {}): DocHandle<P3NetDoc> {
  const doc: P3NetDoc = {
    '@patchwork': { type: 'p3net' },
    tokens,
    canvas: [],
  };
  return {
    doc: () => doc,
    change: (fn: (d: P3NetDoc) => void) => fn(doc),
  } as unknown as DocHandle<P3NetDoc>;
}

function makeRepo(): Repo {
  return {} as Repo;
}

/** Returns a snapshot of all place→[ids] for easy assertions. */
function tokenIds(handle: DocHandle<P3NetDoc>): Record<string, string[]> {
  const doc = handle.doc()!;
  const out: Record<string, string[]> = {};
  for (const [place, tokens] of Object.entries(doc.tokens ?? {})) {
    out[place] = tokens.map((t) => t.id);
  }
  return out;
}

function tokenStates(handle: DocHandle<P3NetDoc>, place: string): TokenState[] {
  return (handle.doc()?.tokens?.[place] ?? []).map((t) => t.state);
}

function tok(extra: Record<string, unknown> = {}): TokenState {
  return { type: 'test', documentUrl: '', ...extra } as TokenState;
}

// ─── Basic firing ─────────────────────────────────────────────────────────────

describe('basic firing', () => {
  it('forwards a token through a simple transition', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't1', from: ['a'], to: ['b'] }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok1', state: tok({ type: 'x' }) }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step).not.toBeNull();
    expect(step!.firings).toHaveLength(1);
    expect(step!.firings[0].transitionId).toBe('t1');

    step!.removeInputs();
    expect(tokenIds(handle).a).toHaveLength(0);

    for (const out of step!.firings[0].outputs) {
      step!.addOutput(out.id);
    }
    expect(handle.doc()!.tokens.b).toHaveLength(1);
    expect(handle.doc()!.tokens.b[0].state).toEqual(tok({ type: 'x' }));
  });

  it('returns null when no tokens are in input places', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't1', from: ['a'], to: ['b'] }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step).toBeNull();
  });

  it('preserves token state during forwarding', async () => {
    const def: NetDef = {
      places: ['src', 'dst'],
      transitions: [{ id: 't', from: ['src'], to: ['dst'] }],
      tokenTypes: [],
    };
    const richState = tok({ type: 'data', value: 42, nested: { x: true } });
    const handle = makeHandle({ src: [{ id: 'tok', state: richState }], dst: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    const [arrived] = tokenStates(handle, 'dst');
    expect(arrived).toEqual(richState);
  });

  it('assigns a fresh id to forwarded tokens', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't', from: ['a'], to: ['b'] }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'original', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    // The output token gets a new id
    expect(handle.doc()!.tokens.b[0].id).not.toBe('original');
  });
});

// ─── Guards ───────────────────────────────────────────────────────────────────

describe('guards', () => {
  it('skips a transition when the guard returns false', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [
        {
          id: 't1',
          from: ['a'],
          to: ['b'],
          guard: () => false,
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step).toBeNull();
    // Token must still be in 'a'
    expect(handle.doc()!.tokens.a).toHaveLength(1);
  });

  it('fires when guard returns true', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't', from: ['a'], to: ['b'], guard: () => true }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step).not.toBeNull();
  });

  it('handles an async guard returning false', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [
        { id: 't', from: ['a'], to: ['b'], guard: async () => false },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    expect(await net.prepareStep()).toBeNull();
  });

  it('handles an async guard returning true', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [
        { id: 't', from: ['a'], to: ['b'], guard: async () => true },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    expect(await net.prepareStep()).not.toBeNull();
  });

  it('receives the correct token state in the guard', async () => {
    const guardTokens: ReadonlyTokens[] = [];
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [
        {
          id: 't',
          from: ['a'],
          to: ['b'],
          guard: (tokens) => {
            guardTokens.push(tokens);
            return true;
          },
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok({ value: 99 }) }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    await net.prepareStep();
    expect(guardTokens).toHaveLength(1);
    expect((guardTokens[0].a.state as Record<string, unknown>).value).toBe(99);
  });
});

// ─── Guard-wait: token waits until condition becomes true ─────────────────────

describe('guard wait (token waits until guard becomes true)', () => {
  it('token stays put when guard is false, then fires once guard is true', async () => {
    let conditionMet = false;

    const def: NetDef = {
      places: ['waiting', 'done'],
      transitions: [
        {
          id: 'proceed',
          from: ['waiting'],
          to: ['done'],
          guard: () => conditionMet,
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      waiting: [{ id: 'w1', state: tok({ type: 'job' }) }],
      done: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    // ── Step 1: condition not yet met — nothing should fire ──────────────
    const step1 = await net.prepareStep();
    expect(step1).toBeNull();
    expect(handle.doc()!.tokens.waiting).toHaveLength(1);
    expect(handle.doc()!.tokens.done ?? []).toHaveLength(0);

    // ── Step 2: condition is still false — still nothing ─────────────────
    const step2 = await net.prepareStep();
    expect(step2).toBeNull();

    // ── Step 3: external condition becomes true ───────────────────────────
    conditionMet = true;

    const step3 = await net.prepareStep();
    expect(step3).not.toBeNull();
    expect(step3!.firings[0].transitionId).toBe('proceed');

    step3!.removeInputs();
    expect(handle.doc()!.tokens.waiting).toHaveLength(0);

    for (const out of step3!.firings[0].outputs) step3!.addOutput(out.id);
    expect(handle.doc()!.tokens.done).toHaveLength(1);
    expect(handle.doc()!.tokens.done[0].state).toEqual(tok({ type: 'job' }));
  });

  it('async guard reads external state (simulating async document lookup)', async () => {
    // Simulate a token that carries a reference, and the guard checks whether
    // some "external document" is marked done — mimicking the real LLM process
    // guard that does `await repo.find(token.state.documentUrl)`.
    const externalDocs = new Map<string, { done: boolean }>();
    externalDocs.set('doc-abc', { done: false });

    const def: NetDef = {
      places: ['running', 'completed'],
      transitions: [
        {
          id: 'finish',
          from: ['running'],
          to: ['completed'],
          guard: async ({ running }) => {
            const ref = running.state.documentUrl;
            const extDoc = externalDocs.get(ref);
            return extDoc?.done === true;
          },
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      running: [{ id: 'r1', state: { type: 'process', documentUrl: 'doc-abc' } }],
      completed: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    // Not done yet
    expect(await net.prepareStep()).toBeNull();

    // Simulate async completion of the external doc
    externalDocs.set('doc-abc', { done: true });

    const step = await net.prepareStep();
    expect(step).not.toBeNull();

    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    expect(handle.doc()!.tokens.completed).toHaveLength(1);
    expect(handle.doc()!.tokens.running).toHaveLength(0);
  });

  it('multiple tokens wait independently; only the ready one fires', async () => {
    const readyIds = new Set<string>(['tok-ready']);

    const def: NetDef = {
      places: ['queue', 'out'],
      transitions: [
        {
          id: 'process',
          from: ['queue'],
          to: ['out'],
          guard: ({ queue }) => readyIds.has(queue.id),
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      queue: [
        { id: 'tok-ready', state: tok({ label: 'first' }) },
        { id: 'tok-waiting', state: tok({ label: 'second' }) },
      ],
      out: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    // First prepareStep — 'tok-ready' fires (it's first in the array)
    const step = await net.prepareStep();
    expect(step).not.toBeNull();
    expect(step!.firings[0].inputs[0].id).toBe('tok-ready');

    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    // 'tok-waiting' should still be in queue
    expect(handle.doc()!.tokens.queue).toHaveLength(1);
    expect(handle.doc()!.tokens.queue[0].id).toBe('tok-waiting');

    // Nothing fires yet for tok-waiting
    expect(await net.prepareStep()).toBeNull();

    // Now unlock tok-waiting
    readyIds.add('tok-waiting');
    const step2 = await net.prepareStep();
    expect(step2).not.toBeNull();
    step2!.removeInputs();
    for (const out of step2!.firings[0].outputs) step2!.addOutput(out.id);
    expect(handle.doc()!.tokens.queue).toHaveLength(0);
    expect(handle.doc()!.tokens.out).toHaveLength(2);
  });
});

// ─── onConsumedTokens: produce ───────────────────────────────────────────────

describe('onConsumedTokens: produce', () => {
  it('produces explicit output tokens instead of forwarding', async () => {
    const def: NetDef = {
      places: ['src', 'dst'],
      transitions: [
        {
          id: 't',
          from: ['src'],
          to: ['dst'],
          onConsumedTokens: () => ({
            produce: [{ state: tok({ type: 'result', value: 'new' }) }],
          }),
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ src: [{ id: 'tok', state: tok({ type: 'input' }) }], dst: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    expect(handle.doc()!.tokens.dst).toHaveLength(1);
    expect(handle.doc()!.tokens.dst[0].state).toEqual(tok({ type: 'result', value: 'new' }));
    // Input was consumed, not forwarded
    expect(handle.doc()!.tokens.src).toHaveLength(0);
  });

  it('routes produced token to a specific toPlace', async () => {
    const def: NetDef = {
      places: ['src', 'out1', 'out2'],
      transitions: [
        {
          id: 't',
          from: ['src'],
          to: ['out1', 'out2'],
          onConsumedTokens: () => ({
            produce: [
              { state: tok({ type: 'a' }), toPlace: 'out1' },
              { state: tok({ type: 'b' }), toPlace: 'out2' },
            ],
          }),
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      src: [{ id: 'tok', state: tok() }],
      out1: [],
      out2: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    expect(tokenStates(handle, 'out1')).toEqual([tok({ type: 'a' })]);
    expect(tokenStates(handle, 'out2')).toEqual([tok({ type: 'b' })]);
  });

  it('async onConsumedTokens is awaited before building outputs', async () => {
    const def: NetDef = {
      places: ['in', 'out'],
      transitions: [
        {
          id: 't',
          from: ['in'],
          to: ['out'],
          onConsumedTokens: async ({ in: inp }) => {
            const n = (inp.state as unknown as Record<string, number>).n;
            const computed = n * 2;
            return { produce: [{ state: tok({ result: computed }) }] };
          },
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ in: [{ id: 'tok', state: tok({ n: 21 }) }], out: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    expect((handle.doc()!.tokens.out[0].state as unknown as Record<string, unknown>).result).toBe(42);
  });
});

// ─── onConsumedTokens: destroy ───────────────────────────────────────────────

describe('onConsumedTokens: destroy', () => {
  it('destroys one input and forwards the other', async () => {
    const def: NetDef = {
      places: ['a', 'b', 'out'],
      transitions: [
        {
          id: 't',
          from: ['a', 'b'],
          to: ['out'],
          onConsumedTokens: () => ({ destroy: ['b'] }),
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      a: [{ id: 'tokA', state: tok({ type: 'keeper' }) }],
      b: [{ id: 'tokB', state: tok({ type: 'consumed' }) }],
      out: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    // Only token from 'a' should be forwarded
    expect(handle.doc()!.tokens.out).toHaveLength(1);
    expect(handle.doc()!.tokens.out[0].state.type).toBe('keeper');
  });
});

// ─── Token reservation (no double-consuming) ──────────────────────────────────

describe('token reservation', () => {
  it('two transitions that share an input place only fire the first', async () => {
    const def: NetDef = {
      places: ['shared', 'dst1', 'dst2'],
      transitions: [
        { id: 't1', from: ['shared'], to: ['dst1'] },
        { id: 't2', from: ['shared'], to: ['dst2'] },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      shared: [{ id: 'tok', state: tok() }],
      dst1: [],
      dst2: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step!.firings).toHaveLength(1);
    expect(step!.firings[0].transitionId).toBe('t1');

    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    expect(handle.doc()!.tokens.dst1).toHaveLength(1);
    expect(handle.doc()!.tokens.dst2 ?? []).toHaveLength(0);
  });

  it('two independent transitions both fire in one step', async () => {
    const def: NetDef = {
      places: ['a', 'b', 'outA', 'outB'],
      transitions: [
        { id: 't1', from: ['a'], to: ['outA'] },
        { id: 't2', from: ['b'], to: ['outB'] },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      a: [{ id: 'tokA', state: tok({ label: 'A' }) }],
      b: [{ id: 'tokB', state: tok({ label: 'B' }) }],
      outA: [],
      outB: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    expect(step!.firings).toHaveLength(2);

    step!.removeInputs();
    for (const f of step!.firings) {
      for (const out of f.outputs) step!.addOutput(out.id);
    }

    expect(handle.doc()!.tokens.outA).toHaveLength(1);
    expect(handle.doc()!.tokens.outB).toHaveLength(1);
  });
});

// ─── reset() ──────────────────────────────────────────────────────────────────

describe('reset()', () => {
  it('removes all tokens from all places', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [],
      tokenTypes: [],
    };
    const handle = makeHandle({
      a: [{ id: 'tok1', state: tok() }],
      b: [{ id: 'tok2', state: tok() }],
    });
    // Manually put something on canvas too
    handle.change((d) => { d.canvas = [{ id: 'c1', state: tok(), x: 0, y: 0 }]; });

    const net = defineNet(def)(handle, makeRepo());
    net.reset();

    expect(handle.doc()!.tokens).toEqual({});
    expect(handle.doc()!.canvas).toEqual([]);
  });
});

// ─── join transition (multiple from-places) ───────────────────────────────────

describe('join transitions (multiple inputs)', () => {
  it('fires only when all input places have tokens', async () => {
    const def: NetDef = {
      places: ['p1', 'p2', 'joined'],
      transitions: [{ id: 'join', from: ['p1', 'p2'], to: ['joined'] }],
      tokenTypes: [],
    };

    // Only p1 has a token
    const handle = makeHandle({ p1: [{ id: 'a', state: tok() }], p2: [], joined: [] });
    const net = defineNet(def)(handle, makeRepo());
    expect(await net.prepareStep()).toBeNull();

    // Add token to p2
    handle.doc()!.tokens.p2 = [{ id: 'b', state: tok() }];
    const step = await net.prepareStep();
    expect(step).not.toBeNull();

    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);

    // Both inputs consumed; both are forwarded (not merged) to 'joined'
    expect(handle.doc()!.tokens.p1).toHaveLength(0);
    expect(handle.doc()!.tokens.p2).toHaveLength(0);
    expect(handle.doc()!.tokens.joined).toHaveLength(2);
  });

  it('join with guard: waits for both tokens AND guard to be true', async () => {
    let unlocked = false;

    const def: NetDef = {
      places: ['p1', 'p2', 'out'],
      transitions: [
        {
          id: 'join',
          from: ['p1', 'p2'],
          to: ['out'],
          guard: () => unlocked,
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({
      p1: [{ id: 'a', state: tok() }],
      p2: [{ id: 'b', state: tok() }],
      out: [],
    });
    const net = defineNet(def)(handle, makeRepo());

    // Tokens present but guard is false
    expect(await net.prepareStep()).toBeNull();

    unlocked = true;
    const step = await net.prepareStep();
    expect(step).not.toBeNull();

    step!.removeInputs();
    for (const out of step!.firings[0].outputs) step!.addOutput(out.id);
    expect(handle.doc()!.tokens.out).toHaveLength(2);
  });
});

// ─── PendingStep mutation isolation ───────────────────────────────────────────

describe('PendingStep doc mutations', () => {
  it('removeInputs() is idempotent when called twice', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't', from: ['a'], to: ['b'] }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.removeInputs();
    step!.removeInputs(); // Second call should be a no-op
    expect(handle.doc()!.tokens.a).toHaveLength(0);
  });

  it('addOutput() for an unknown id is a no-op', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [{ id: 't', from: ['a'], to: ['b'] }],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok() }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    const step = await net.prepareStep();
    step!.addOutput('nonexistent-id'); // Should not throw
    expect(handle.doc()!.tokens.b ?? []).toHaveLength(0);
  });

  it('guard cannot mutate the original doc state', async () => {
    const def: NetDef = {
      places: ['a', 'b'],
      transitions: [
        {
          id: 't',
          from: ['a'],
          to: ['b'],
          guard: ({ a }) => {
            (a.state as Record<string, unknown>).mutated = true; // attempt mutation
            return true;
          },
        },
      ],
      tokenTypes: [],
    };
    const handle = makeHandle({ a: [{ id: 'tok', state: tok({ val: 1 }) }], b: [] });
    const net = defineNet(def)(handle, makeRepo());

    await net.prepareStep();
    // The deep-clone should have prevented the mutation from reaching the doc
    expect(handle.doc()!.tokens.a[0].state).not.toHaveProperty('mutated');
  });
});
