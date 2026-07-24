/**
 * Regression tests for the remembered-set (incremental) GC: after the first
 * transaction's full traversal, gc re-scans only entries written since the last
 * committed transaction. These tests exercise the cases where incrementality could
 * diverge from the full traversal: promotion deferred to a later transaction,
 * promotion chains through shadow objects, same-value-elided writes, aborted
 * changes, and writes onto objects linked by a remote replica (whose writes never
 * hit the local write barrier).
 */
import { describe, expect, it } from 'vitest';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';
import type { Obj, Ref } from './types';

function makeRuntime() {
  const handle = createAutomergeTestDocHandle();
  const runtime = createLivelymergeRuntime(handle);
  return { handle, runtime };
}

describe('remembered-set gc', () => {
  it('promotes an ephemeral object linked to the persistent heap in a LATER transaction', () => {
    const { runtime } = makeRuntime();
    runtime.eval('$stash = { a: 42 }'); // txn 1: ephemeral root only — stays shadow
    const stashed = runtime.eval('$stash') as { $id: string };
    expect(runtime.doc().objectTable[stashed.$id]).toBeUndefined();

    runtime.eval('keep = $stash'); // txn 2: persistent link → must promote
    expect(runtime.doc().objectTable[stashed.$id]).toBeDefined();
    expect(runtime.eval('keep.a')).toBe(42);
  });

  it('promotes a whole chain of shadow objects reachable through the new link', () => {
    const { runtime } = makeRuntime();
    runtime.eval('$stash = { inner: { b: 7 } }');
    const inner = runtime.eval('$stash.inner') as { $id: string };
    expect(runtime.doc().objectTable[inner.$id]).toBeUndefined();

    runtime.eval('keep = $stash');
    expect(runtime.doc().objectTable[inner.$id]).toBeDefined();
    expect(runtime.eval('keep.inner.b')).toBe(7);
  });

  it('promotes objects pushed onto a persistent array in a later transaction', () => {
    const { runtime } = makeRuntime();
    runtime.eval('xs = []');
    runtime.eval('xs.push({ v: 1 })');
    const elem = runtime.eval('xs[0]') as { $id: string };
    expect(runtime.doc().objectTable[elem.$id]).toBeDefined();
    expect(runtime.eval('xs[0].v')).toBe(1);
  });

  it('same-value elided writes do not disturb reachability', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    const x = runtime.eval('x') as { $id: string };
    runtime.eval('x.a = 1'); // elided: same value, no dirty
    runtime.eval('x = x'); // elided: same ref
    runtime.eval('y = x'); // new edge, elision-free
    expect(runtime.doc().objectTable[x.$id]).toBeDefined();
    expect(runtime.eval('y.a')).toBe(1);
  });

  it('unlinked persistent objects stay immortal (unchanged semantics)', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    const x = runtime.eval('x') as { $id: string };
    runtime.eval('x = null');
    runtime.eval('1'); // one more gc cycle
    expect(runtime.doc().objectTable[x.$id]).toBeDefined();
  });

  it('purely ephemeral objects survive transactions without being promoted', () => {
    const { runtime } = makeRuntime();
    runtime.eval('$e = { c: 3 }');
    runtime.eval('1');
    runtime.eval('2');
    const e = runtime.eval('$e') as { $id: string };
    expect(runtime.doc().objectTable[e.$id]).toBeUndefined();
    expect(runtime.eval('$e.c')).toBe(3);
  });

  it('recovers after an aborted change (failed promotion) with a full rescan', () => {
    const { runtime } = makeRuntime();
    runtime.eval('ok0 = { a: 0 }'); // committed state before the abort
    // Math.max reads back as a bound host function: storable in shadow, but
    // promotion must reject it, aborting the change.
    expect(() => runtime.eval('bad = { m: Math.max }')).toThrow(/Livelymerge/);
    // The aborted write rolled back...
    expect(runtime.eval('bad')).toBeUndefined();
    // ...and subsequent transactions promote correctly again.
    runtime.eval('$stash = { a: 5 }');
    runtime.eval('ok = $stash');
    const ok = runtime.eval('ok') as { $id: string };
    expect(runtime.doc().objectTable[ok.$id]).toBeDefined();
    expect(runtime.eval('ok.a')).toBe(5);
    expect(runtime.eval('ok0.a')).toBe(0);
  });

  it('promotes local objects linked onto a REMOTELY-added persistent object', () => {
    const { handle, runtime } = makeRuntime();
    runtime.eval('1'); // initialize roots; commits the full-scan reachable set
    // Simulate a remote replica linking a brand-new object into the persistent heap:
    // these writes never pass through the runtime's write barrier.
    handle.change((d) => {
      d.objectTable['remote-obj'] = { $type: 'obj', $id: 'remote-obj' } as Obj;
      (d.objectTable['global'] as Obj)['@remote'] = { $type: 'ref', $id: 'remote-obj' } as Ref;
    });
    // A local write onto the remotely-linked object must still promote its target,
    // even though 'remote-obj' is absent from the local reachability cache.
    runtime.eval('remote.child = { z: 9 }');
    const child = runtime.eval('remote.child') as { $id: string };
    expect(runtime.doc().objectTable[child.$id]).toBeDefined();
    expect(runtime.eval('remote.child.z')).toBe(9);
  });

  it('ephemeral props of promoted-later objects keep their referents alive', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    runtime.eval('x.$side = { s: 8 }'); // ephemeral prop on a persistent object
    runtime.eval('1');
    runtime.eval('2');
    expect(runtime.eval('x.$side.s')).toBe(8);
    const side = runtime.eval('x.$side') as { $id: string };
    expect(runtime.doc().objectTable[side.$id]).toBeUndefined(); // never promoted
  });
});
