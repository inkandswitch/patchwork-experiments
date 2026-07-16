/**
 * Tests for the local/ephemeral state design (see DESIGN.md):
 *  - `$foo` properties: per-replica, never in the Automerge document, lost on reload,
 *    persistent across transactions
 *  - the shadow document: fresh objects generate no Automerge ops until promoted
 *  - promotion: one-way, id-preserving, transitive over non-$ edges (incl. closures)
 *  - proxy identity: stable across transactions and across promotion (WeakRef cache)
 *  - write barrier: strict at the persistence boundary, lenient per-replica, with
 *    provenance-carrying promotion errors
 */
import { describe, expect, it } from 'vitest';
import { createAutomergeTestDocHandle, roundTripDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeRuntime() {
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  return { handle, rt };
}

describe('ephemeral ($-prefixed) properties', () => {
  it('persist across transactions', () => {
    const { rt } = makeRuntime();
    rt.eval(`p = { x: 1 }; p.$note = 'local only';`);
    expect(rt.eval(`p.$note`)).toBe('local only');
  });

  it('never appear in the Automerge document', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`p = { x: 1 }; p.$halo = { size: 10 };`);
    const json = JSON.stringify(handle.doc().objectTable);
    expect(json).not.toContain('$halo');
    expect(json).not.toContain('@$halo');
    expect(json).not.toContain('size');
  });

  it('are lost on reload (save/load into a fresh runtime)', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`p = { x: 1 }; p.$note = 'ephemeral';`);
    expect(rt.eval(`p.$note`)).toBe('ephemeral');
    const rt2 = createLivelymergeRuntime(roundTripDocHandle(handle));
    expect(rt2.eval(`p.x`)).toBe(1); // persistent state survived
    expect(rt2.eval(`p.$note`)).toBe(undefined); // ephemeral state did not
  });

  it('hold references to LM objects and see later mutations (canonical refs, not copies)', () => {
    const { rt } = makeRuntime();
    rt.eval(`shared = { n: 1 }; holder = {}; holder.$ref = shared;`);
    rt.eval(`shared.n = 42;`);
    expect(rt.eval(`holder.$ref.n`)).toBe(42);
  });

  it('work in object literals: { $x: ... } routes to ephemeral state', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`m = { pos: 5, $halo: 'mine' };`);
    expect(rt.eval(`m.$halo`)).toBe('mine');
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('mine');
  });

  it('can be deleted', () => {
    const { rt } = makeRuntime();
    rt.eval(`p = {}; p.$tmp = 7;`);
    expect(rt.eval(`p.$tmp`)).toBe(7);
    rt.eval(`delete p.$tmp;`);
    expect(rt.eval(`p.$tmp`)).toBe(undefined);
  });

  it('are invisible to Object.keys', () => {
    const { rt } = makeRuntime();
    const keys = rt.eval(`o = { a: 1, $b: 2 }; Object.keys(o).join(',')`);
    expect(keys).toBe('a');
  });
});

describe('shadow document / fresh objects', () => {
  it('temporaries never enter the Automerge document', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`null;`); // warm-up: lets ensureHeapRoots upgrade the bootstrap entries
    const before = Object.keys(handle.doc().objectTable).length;
    rt.eval(`
      for (let i = 0; i < 50; i++) {
        let tmp = { i: i }; // fresh garbage, dropped each iteration
      }
      null;
    `);
    const after = Object.keys(handle.doc().objectTable).length;
    expect(after).toBe(before);
  });

  it('ephemeral objects survive across transactions while $-referenced, and are collected when unreferenced', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`hub = {}; hub.$panel = { title: 'mine' };`);
    // survives the transaction boundary:
    expect(rt.eval(`hub.$panel.title`)).toBe('mine');
    // ...but never entered the document:
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('mine');
    // dropping the $-reference lets GC collect it:
    rt.eval(`hub.$panel = null;`);
    expect(rt.eval(`hub.$panel`)).toBe(null);
  });

  it('an ephemeral object can reference other ephemeral objects (transitively retained)', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`root = {}; root.$ui = { child: { grand: 'deep' } };`);
    expect(rt.eval(`root.$ui.child.grand`)).toBe('deep');
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('deep');
  });
});

describe('promotion', () => {
  it('assigning ephemeral state into a persistent property promotes it — same id, now in the doc', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`hub = {}; hub.$staging = { title: 'promote me' };`);
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('promote me');
    const idBefore = rt.eval(`hub.$staging.$id`);
    rt.eval(`hub.published = hub.$staging;`);
    // now in the document, same objectId:
    expect(JSON.stringify(handle.doc().objectTable)).toContain('promote me');
    const idAfter = rt.eval(`hub.published.$id`);
    expect(idAfter).toBe(idBefore);
    expect(handle.doc().objectTable[idBefore as string]).toBeDefined();
  });

  it('is transitive over non-$ edges, including arrays', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`hub = {}; hub.$batch = { items: [{ tag: 'aa' }, { tag: 'bb' }] };`);
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('aa');
    rt.eval(`hub.saved = hub.$batch;`);
    const json = JSON.stringify(handle.doc().objectTable);
    expect(json).toContain('aa');
    expect(json).toContain('bb');
  });

  it('promotes closure environments (captured scopes) along with functions', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`
      hub = {};
      function makeCounter() {
        let count = 100;
        return () => { count = count + 1; return count; };
      }
      hub.$counter = makeCounter();
    `);
    rt.eval(`hub.counter = hub.$counter;`); // promote the closure
    // the captured scope must have been promoted too — a fresh runtime on the same
    // doc (reload) must still be able to run the closure and see its state:
    const rt2 = createLivelymergeRuntime(roundTripDocHandle(handle));
    expect(rt2.eval(`hub.counter()`)).toBe(101);
    expect(rt2.eval(`hub.counter()`)).toBe(102);
  });

  it('does NOT follow $-edges: ephemeral neighbors of promoted objects stay ephemeral', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`
      hub = {};
      hub.$staging = { name: 'stager' };
      hub.$staging.$decoration = { look: 'sparkly' };
    `);
    rt.eval(`hub.thing = hub.$staging;`); // promotes $staging...
    const json = JSON.stringify(handle.doc().objectTable);
    expect(json).toContain('stager');
    expect(json).not.toContain('sparkly'); // ...but not its $-referenced decoration
    // and the promoted object keeps its ephemeral property:
    expect(rt.eval(`hub.thing.$decoration.look`)).toBe('sparkly');
  });
});

describe('proxy identity (WeakRef cache)', () => {
  it('is stable across transactions', () => {
    const { rt } = makeRuntime();
    const a = rt.eval(`stable = { v: 1 }; stable`);
    const b = rt.eval(`stable`);
    expect(a).toBe(b);
  });

  it('is stable across promotion', () => {
    const { rt } = makeRuntime();
    rt.eval(`hub = {}; hub.$pre = { v: 7 };`);
    const before = rt.eval(`hub.$pre`);
    rt.eval(`hub.post = hub.$pre;`); // promotion happens at end of this transaction
    const after = rt.eval(`hub.post`);
    expect(after).toBe(before);
    expect((after as any).v).toBe(7);
  });

  it('=== works between references obtained in different transactions', () => {
    const { rt } = makeRuntime();
    rt.eval(`x = { v: 1 }; y = {}; y.alias = x;`);
    expect(rt.eval(`y.alias === x`)).toBe(true);
  });
});

describe('write barrier', () => {
  it('throws immediately when storing a host object into a PERSISTENT object', () => {
    const { rt } = makeRuntime();
    rt.eval(`p = { x: 1 };`); // p is promoted (reachable from global)
    expect(() => rt.eval(`p.bad = new Date().constructor;`)).toThrow(/Livelymerge: cannot store/);
  });

  it('names the property and object in the error', () => {
    const { rt } = makeRuntime();
    rt.eval(`p = {};`);
    try {
      rt.eval(`p.oops = Math.max;`); // a bound native function
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(String(e)).toMatch(/'oops'/);
    }
  });

  it('tolerates host values in per-replica state, but promotion throws with provenance', () => {
    const { rt } = makeRuntime();
    // Storing a host value on ephemeral state is fine (per-replica):
    rt.eval(`hub = {}; hub.$raw = { holder: 'x' }; hub.$raw.fn = Math.max;`);
    expect(rt.eval(`typeof hub.$raw.fn`)).toBe('function');
    // ...but making it persistently reachable is an error, at promotion, with provenance:
    expect(() => rt.eval(`hub.leaked = hub.$raw;`)).toThrow(
      /became persistently reachable.*'fn'/s,
    );
  });

  it('a failed promotion does not corrupt the shadow document (ephemeral state intact afterwards)', () => {
    const { rt } = makeRuntime();
    rt.eval(`hub = {}; hub.$raw = { n: 5 }; hub.$raw.fn = Math.max;`);
    expect(() => rt.eval(`hub.leaked = hub.$raw;`)).toThrow();
    // the ephemeral object is still intact and usable:
    expect(rt.eval(`hub.$raw.n`)).toBe(5);
    expect(rt.eval(`typeof hub.$raw.fn`)).toBe('function');
  });

  it('still allows plain JSON leaves (e.g. String.split results) in persistent state', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`p = {}; p.parts = 'a,b,c'.split(',');`);
    expect(rt.eval(`p.parts.length`)).toBe(3);
    expect(JSON.stringify(handle.doc().objectTable)).toContain('"a"');
  });

  it('allows Dates in persistent state (Automerge-native scalar)', () => {
    const { rt } = makeRuntime();
    rt.eval(`p = {}; p.when = new Date(1700000000000);`);
    expect(rt.eval(`p.when.getTime()`)).toBe(1700000000000);
  });

  it('rejects an LM object smuggled inside a plain JS array (aliasing would be lost)', () => {
    const { rt } = makeRuntime();
    rt.eval(`lm = { v: 1 };`);
    expect(() =>
      rt.eval(`
        holder = {};
        // Build the tainted value inside a function so 'raw' stays a true JS local
        // (top-level lets become global — persistent — properties).
        holder.$bad = (function () {
          let raw = 'a,b'.split(','); // native array
          raw[1] = lm;                // LM object hidden inside a plain value
          return raw;
        })();
      `),
    ).toThrow(/aliasing would be lost/);
  });
});

describe('local roots via $-properties of the global object', () => {
  it('$global-level $-state acts as a per-replica root', () => {
    const { handle, rt } = makeRuntime();
    rt.eval(`$session = { user: 'me', prefs: { theme: 'dark' } };`);
    expect(rt.eval(`$session.prefs.theme`)).toBe('dark');
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('dark');
    // gone after reload:
    const rt2 = createLivelymergeRuntime(roundTripDocHandle(handle));
    expect(rt2.eval(`$session`)).toBe(undefined);
  });
});
