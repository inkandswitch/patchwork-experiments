/**
 * Regression tests for the incremental PRECISE GC (edge cache): after the first
 * transaction's full traversal, gc re-reads only entries whose ref-structure changed
 * and re-traces reachability over a plain-JS edge cache. The reachable set is exact —
 * unlinks shrink it, so stale reachability can never cause spurious promotion.
 *
 * These tests pin down the cases where incrementality could diverge from a full
 * traversal: promotion deferred to a later transaction, promotion chains,
 * value-only writes, unlink precision, aborted changes, and writes that bypass the
 * local barrier (remote replicas → noteExternalChanges).
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

describe('incremental precise gc', () => {
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

  it('value-only and same-value writes do not disturb reachability', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    const x = runtime.eval('x') as { $id: string };
    runtime.eval('x.a = 2'); // value-only: never edge-dirty
    runtime.eval('x.a = 2'); // elided
    runtime.eval('x = x'); // elided (same ref)
    runtime.eval('y = x'); // new edge
    expect(runtime.doc().objectTable[x.$id]).toBeDefined();
    expect(runtime.eval('y.a')).toBe(2);
  });

  it('unlinked persistent objects stay immortal (unchanged semantics)', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    const x = runtime.eval('x') as { $id: string };
    runtime.eval('x = null');
    runtime.eval('1'); // one more gc cycle
    expect(runtime.doc().objectTable[x.$id]).toBeDefined();
  });

  it('PRECISION: writes onto an unlinked object do not promote fresh objects', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }'); // promoted
    runtime.eval('$keep = x'); // hold the proxy through an ephemeral root
    runtime.eval('x = null'); // unlink: the precise trace drops it
    runtime.eval('$keep.child = { b: 2 }'); // write onto the unreachable immortal object
    const child = runtime.eval('$keep.child') as { $id: string };
    // Not promoted (its parent is not persistently reachable)...
    expect(runtime.doc().objectTable[child.$id]).toBeUndefined();
    // ...but still alive and readable via the ephemeral chain.
    expect(runtime.eval('$keep.child.b')).toBe(2);
  });

  it('PRECISION: relinking promotes the subtree accumulated while unlinked', () => {
    const { runtime } = makeRuntime();
    runtime.eval('x = { a: 1 }');
    runtime.eval('$keep = x');
    runtime.eval('x = null');
    runtime.eval('$keep.child = { b: 2 }');
    runtime.eval('y = $keep'); // relink → child becomes persistently reachable
    const child = runtime.eval('y.child') as { $id: string };
    expect(runtime.doc().objectTable[child.$id]).toBeDefined();
    expect(runtime.eval('y.child.b')).toBe(2);
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
    runtime.eval('1'); // initialize roots; commits the full-scan state
    // Simulate a remote replica linking a brand-new object into the persistent heap:
    // these writes never pass through the runtime's write barrier. (In production
    // the automerge-repo DocHandle 'change' event delivers this via patches; the
    // test handle has no event emitter, so notify the runtime directly.)
    handle.change((d) => {
      d.objectTable['remote-obj'] = { $type: 'obj', $id: 'remote-obj' } as Obj;
      (d.objectTable['global'] as Obj)['@remote'] = { $type: 'ref', $id: 'remote-obj' } as Ref;
    });
    runtime.noteExternalChanges(['global', 'remote-obj']);
    // A local write onto the remotely-linked object must promote its target.
    runtime.eval('remote.child = { z: 9 }');
    const child = runtime.eval('remote.child') as { $id: string };
    expect(runtime.doc().objectTable[child.$id]).toBeDefined();
    expect(runtime.eval('remote.child.z')).toBe(9);
  });

  it('noteExternalChanges() with no ids forces a safe full re-traversal', () => {
    const { handle, runtime } = makeRuntime();
    runtime.eval('1');
    handle.change((d) => {
      d.objectTable['remote-obj2'] = { $type: 'obj', $id: 'remote-obj2' } as Obj;
      (d.objectTable['global'] as Obj)['@remote2'] = { $type: 'ref', $id: 'remote-obj2' } as Ref;
    });
    runtime.noteExternalChanges(); // no patch details available
    runtime.eval('remote2.child = { z: 10 }');
    const child = runtime.eval('remote2.child') as { $id: string };
    expect(runtime.doc().objectTable[child.$id]).toBeDefined();
  });

  it('ephemeral props of persistent objects keep their referents alive without promoting them', () => {
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
