import { beforeEach, describe, expect, it } from 'vitest';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { transpile } from './transpiler';

describe('user-facing eval', () => {
  let rt: LivelymergeRuntime;

  beforeEach(() => {
    rt = createLivelymergeRuntime(createAutomergeTestDocHandle());
  });

  it('evaluates expressions', () => {
    expect(rt.eval("eval('1 + 2')")).toBe(3);
  });

  it('returns non-string arguments unchanged', () => {
    expect(rt.eval('eval(42)')).toBe(42);
  });

  it('transpiles the evaluated source, so literals become LM values', () => {
    expect(rt.eval("eval('({a: 1})').a")).toBe(1);
    expect(rt.eval("eval('[1, 2, 3]').length")).toBe(3);
  });

  it('resolves free variables in the evaluated source against $global', () => {
    rt.eval('$global.x = 5');
    expect(rt.eval("eval('$global.x + 1')")).toBe(6);
    expect(rt.eval("eval('x + 1')")).toBe(6);
  });

  it('functions defined via eval are LM functions', () => {
    rt.eval("eval('f = function (n) { return n * 2 }')");
    expect(rt.eval('$global.f(21)')).toBe(42);
  });

  it("binds the caller's this inside methods (evalInMe pattern)", () => {
    rt.eval(`
      class Foo {
        constructor() {
          this.x = 7;
        }
        evalInMe(str) {
          return eval(str);
        }
      }
      $global.foo = new Foo();
    `);
    expect(rt.eval("$global.foo.evalInMe('this.x')")).toBe(7);
  });

  it("binds this passed via .call (wsEval pattern)", () => {
    rt.eval(`
      $global.obj = { wsEval: function (str) { return eval(str) } };
      $global.ws = { v: 41 };
    `);
    expect(rt.eval("$global.obj.wsEval.call($global.ws, 'this.v + 1')")).toBe(42);
  });

  it('threads this through arrow functions', () => {
    rt.eval(`
      $global.run = function (fn) { return fn() };
      $global.obj = {
        v: 10,
        m: function (str) { return $global.run(() => eval(str)) },
      };
    `);
    expect(rt.eval("$global.obj.m('this.v * 2')")).toBe(20);
  });

  it('assignments to this in evaluated source persist (workspace pattern)', () => {
    rt.eval(`
      $global.ws = {};
      $global.obj = { wsEval: function (str) { return eval(str) } };
    `);
    rt.eval("$global.obj.wsEval.call($global.ws, 'this.y = 99')");
    expect(rt.eval('$global.ws.y')).toBe(99);
  });
});

describe('eval transpilation', () => {
  it('rewrites direct eval calls to $eval.call(this, ...)', () => {
    expect(transpile('function f(s) { return eval(s); }')).toContain('$eval.call(this, s)');
  });

  it('does not rewrite eval to a $global reference', () => {
    expect(transpile('function f(s) { return eval(s); }')).not.toContain('$global.eval');
  });

  it('keeps the original eval call in the show source', () => {
    const out = transpile('function f(s) { return eval(s); }');
    expect(out).toContain(JSON.stringify('function f(s) { return eval(s); }'));
  });

  it('rewrites bare eval references to $eval', () => {
    const out = transpile('f = eval;');
    expect(out).toContain('$eval');
    expect(out).not.toContain('$global.eval');
  });

  it('leaves eval alone inside do-not-transpile functions', () => {
    const out = transpile(
      'function f(s) {\n  // $$$ do not transpile $$$\n  return eval(s);\n}',
    );
    expect(out).toContain('eval(s)');
    expect(out).not.toContain('$eval');
  });

  it('does not touch property accesses or strings named eval', () => {
    const out = transpile("f = obj.eval; g = 'eval(x)';");
    expect(out).not.toContain('$eval');
  });
});
