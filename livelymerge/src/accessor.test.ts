/**
 * Class getter/setter (accessor) support.
 *
 * Accessors are stored as `{ $type: 'accessor', $get?: Ref, $set?: Ref }` property
 * values (usually on class prototypes); the obj proxy's get/set traps invoke the
 * referenced $fun with the receiver as `this`. The main motivating pattern is a
 * prototype getter that prefers per-replica ephemeral state ($-prop) and falls back
 * to a persistent field, e.g. Morph's `transform` → `$transform ?? _transform`.
 */
import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';
import { typeTag } from './docStrings';
import { evalTranspiled } from './evalHarness';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle, roundTripDocHandle } from './testDocHandle';
import { transpile } from './transpiler';

function run(code: string): unknown {
  return evalTranspiled(transpile(wrapForCompletionValue(code)));
}

describe('class accessors (eval harness)', () => {
  it('supports a prototype getter that reads instance state', () => {
    expect(
      run(`class A {
  constructor() { this._x = 1; }
  get x() { return this.$x != null ? this.$x : this._x; }
  m() { return this.x; }
}
new A().m()`),
    ).toBe(1);
  });

  it('prefers the ephemeral $-prop when the getter consults it', () => {
    expect(
      run(`class A {
  constructor() { this._x = 1; }
  get x() { return this.$x != null ? this.$x : this._x; }
}
let a = new A();
a.$x = 99;
a.x`),
    ).toBe(99);
  });

  it('routes assignment through the setter instead of shadowing', () => {
    expect(
      run(`class A {
  constructor() { this._x = 1; }
  get x() { return this._x; }
  set x(v) { this._x = v; }
}
let a = new A();
a.x = 42;
a._x + a.x`),
    ).toBe(84);
  });

  it('an assignment with a getter but no setter is silently ignored', () => {
    expect(
      run(`class A {
  constructor() { this._x = 1; }
  get x() { return this._x; }
}
let a = new A();
a.x = 42;
a.x`),
    ).toBe(1);
  });

  it('accessors are inherited through subclasses', () => {
    expect(
      run(`class A {
  constructor() { this._x = 1; }
  get x() { return this.$x != null ? this.$x : this._x; }
  set x(v) { this._x = v; }
}
class B extends A {
  m() { this.x = 7; return this.x; }
}
new B().m()`),
    ).toBe(7);
  });

  it('an own data property shadows an inherited accessor', () => {
    // Legacy documents may carry own data props with the same name as a newly
    // introduced prototype accessor; reads and writes must keep using the own slot.
    expect(
      run(`class A {
  get x() { return 'from getter'; }
}
let a = new A();
let legacy = $obj({ x: 5 }, A.prototype);
legacy.x = 6;
'' + legacy.x + '/' + a.x`),
    ).toBe('6/from getter');
  });
});

describe('class accessors (real runtime + Automerge doc)', () => {
  it('accessor state survives promotion into the document and reload', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval(`
class Box {
  constructor(w) { this._width = w; }
  get width() { return this.$width != null ? this.$width : this._width; }
  set width(w) { this._width = w; }
}
b = new Box(10);
`);
    expect(rt.eval('b.width')).toBe(10);

    // Ephemeral override is per-replica and never stored.
    rt.eval('b.$width = 25');
    expect(rt.eval('b.width')).toBe(25);
    rt.eval('b.$width = null');
    expect(rt.eval('b.width')).toBe(10);

    // Setter writes land on the persistent field.
    rt.eval('b.width = 11');
    expect(rt.eval('b._width')).toBe(11);

    // The prototype's doc entry stores an accessor record, not a flattened value.
    // (Raw stored strings use the immutable-string encoding — read via typeTag.)
    const protoId = rt.eval('Box.prototype.$id') as string;
    const protoEntry = handle.doc().objectTable[protoId] as Record<string, any>;
    expect(typeTag(protoEntry['@width'])).toBe('accessor');
    expect(typeTag(protoEntry['@width'].$get)).toBe('ref');
    expect(typeTag(protoEntry['@width'].$set)).toBe('ref');

    // Reload into a fresh runtime: the accessor still works, and the ephemeral
    // override starts out clear (it was never in the document).
    const rt2 = createLivelymergeRuntime(roundTripDocHandle(handle));
    expect(rt2.eval('b.width')).toBe(11);
    expect(rt2.eval('b.$width')).toBe(undefined);
    rt2.eval('b.width = 12');
    expect(rt2.eval('b._width')).toBe(12);
  });

  it('a session bakes no dangling refs when a class with accessors is defined', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval(`
class P {
  constructor() { this._v = 1; }
  get v() { return this._v; }
}
p = new P();
`);
    expect(rt.eval('p.v')).toBe(1);
    expect(rt.findDanglingRefs()).toEqual([]);
  });
});
