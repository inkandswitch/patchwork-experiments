/**
 * replaceMethod(className, classFragment) — the runtime entry point behind the
 * system browser's method pane. Compiles a single class fragment (method, getter,
 * setter, static, or constructor), rewriting super-sends against the class's actual
 * superclass (recovered from the prototype chain), and installs it on the live class.
 */
import { describe, expect, it } from 'vitest';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';

function makeRuntime() {
  return createLivelymergeRuntime(createAutomergeTestDocHandle());
}

describe('replaceMethod', () => {
  it('replaces a plain method and stores the fragment as its show source', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 1; }
}`);
    rt.eval(`replaceMethod('A', 'm() { return 2; }')`);
    expect(rt.eval('new A().m()')).toBe(2);
    expect(rt.eval('A.prototype.m.toString()')).toBe('m() { return 2; }');
  });

  it('adds a brand-new method to an existing class', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 1; }
}`);
    rt.eval(`replaceMethod('A', 'twice() { return this.m() * 2; }')`);
    expect(rt.eval('new A().twice()')).toBe(2);
  });

  it('existing instances see the replacement (prototype identity is kept)', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 1; }
}
$global.a = new A();`);
    rt.eval(`replaceMethod('A', 'm() { return 2; }')`);
    expect(rt.eval('a.m()')).toBe(2);
  });

  it('rewrites super-sends against the actual superclass, keeping super in the show', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 10; }
}
class B extends A {
  m() { return 0; }
}`);
    rt.eval(`replaceMethod('B', 'm() { return super.m() + 1; }')`);
    expect(rt.eval('new B().m()')).toBe(11);
    const show = rt.eval('B.prototype.m.toString()') as string;
    expect(show).toContain('super.m()');
    expect(show).not.toContain('$global');
  });

  it('subclass super-sends see a replaced superclass method (class-Fun mirror kept in sync)', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 10; }
}
class B extends A {
}`);
    rt.eval(`replaceMethod('B', 'm() { return super.m() + 1; }')`);
    rt.eval(`replaceMethod('A', 'm() { return 20; }')`);
    expect(rt.eval('new B().m()')).toBe(21);
    // The mirror equals the prototype slot, so the method is not misread as a static.
    expect(rt.eval('A.m === A.prototype.m')).toBe(true);
  });

  it('replaces a getter without touching the setter, and vice versa', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  constructor() { this._x = 1; }
  get x() { return this._x; }
  set x(v) { this._x = v; }
}`);
    rt.eval(`replaceMethod('A', 'get x() { return this._x * 100; }')`);
    expect(rt.eval('let a = new A(); a.x = 3; a.x')).toBe(300);
    rt.eval(`replaceMethod('A', 'set x(v) { this._x = v + 1; }')`);
    expect(rt.eval('let a = new A(); a.x = 3; a.x')).toBe(400);
    expect(rt.eval(`Object.getOwnPropertyDescriptor(A.prototype, 'x').get.toString()`)).toBe(
      'get x() { return this._x * 100; }',
    );
    expect(rt.eval(`Object.getOwnPropertyDescriptor(A.prototype, 'x').set.toString()`)).toBe(
      'set x(v) { this._x = v + 1; }',
    );
  });

  it('adds a getter where none existed', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  constructor() { this._x = 7; }
}`);
    rt.eval(`replaceMethod('A', 'get x() { return this._x; }')`);
    expect(rt.eval('new A().x')).toBe(7);
  });

  it('a getter fragment can use super-sends', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  size() { return 4; }
}
class B extends A {
}`);
    rt.eval(`replaceMethod('B', 'get doubled() { return super.size() * 2; }')`);
    expect(rt.eval('new B().doubled')).toBe(8);
  });

  it('replaces a static method', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  static k() { return 9; }
}`);
    rt.eval(`replaceMethod('A', 'static k() { return 10; }')`);
    expect(rt.eval('A.k()')).toBe(10);
    expect(rt.eval('A.k.toString()')).toBe('static k() { return 10; }');
  });

  it('replaces the constructor: statics kept, instances stay valid, source updated', () => {
    const rt = makeRuntime();
    rt.eval(`class P {
  constructor(x) { this.x = x; }
  m() { return this.x; }
  static k() { return 9; }
}
$global.p1 = new P(1);`);
    rt.eval(`replaceMethod('P', 'constructor(x) { this.x = x * 2; }')`);
    expect(rt.eval('new P(3).x')).toBe(6);
    expect(rt.eval('new P(3).m()')).toBe(6); // prototype survived the swap
    expect(rt.eval('P.k()')).toBe(9); // statics carried over
    expect(rt.eval('p1.m()')).toBe(1); // old instances still delegate correctly
    expect(rt.eval('p1 instanceof P')).toBe(true);
    const source = rt.eval('P.toString()') as string;
    expect(source).toContain('constructor(x) { this.x = x * 2; }');
    expect(source.trimStart().startsWith('class P')).toBe(true);
    expect(rt.eval('P.prototype.constructor === P')).toBe(true);
  });

  it('replaces a derived-class constructor that calls super(...)', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  constructor(x) { this.x = x; }
}
class B extends A {
  constructor() { super(1); }
}`);
    rt.eval(`replaceMethod('B', 'constructor(x) { super(x + 1); this.y = 5; }')`);
    expect(rt.eval('new B(1).x')).toBe(2);
    expect(rt.eval('new B(1).y')).toBe(5);
    const source = rt.eval('B.toString()') as string;
    expect(source).toContain('super(x + 1)');
  });

  it('adds a constructor to a class that had none', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return this.x; }
}`);
    rt.eval(`replaceMethod('A', 'constructor() { this.x = 3; }')`);
    expect(rt.eval('new A().m()')).toBe(3);
    expect(rt.eval('A.toString()')).toContain('constructor() { this.x = 3; }');
  });

  it('rejects unknown classes and malformed fragments', () => {
    const rt = makeRuntime();
    rt.eval(`class A {
  m() { return 1; }
}`);
    expect(() => rt.eval(`replaceMethod('Nope', 'm() { return 2; }')`)).toThrow(/not a class/);
    expect(() => rt.eval(`replaceMethod('A', 'm() { return 2; } n() {}')`)).toThrow(
      /exactly one/,
    );
    expect(() => rt.eval(`replaceMethod('A', 'x = 5;')`)).toThrow(/exactly one/);
    expect(() => rt.eval(`replaceMethod('A', 'm() { return')`)).toThrow(/does not parse/);
  });
});
