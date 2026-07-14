import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';
import { evalTranspiled } from './evalHarness';
import { transpile } from './transpiler';

describe('class print-it eval', () => {
  it('evaluates class declaration and new in one print-it', () => {
    const code = `class A {
  m() { return 5; }
}
new A().m()`;
    const transpiled = transpile(wrapForCompletionValue(code));
    const instance = evalTranspiled(transpiled.replace('return new ($global.A)().m()', 'return new ($global.A)()'));
    expect(typeof (instance as { m: unknown }).m).toBe('function');
    expect(evalTranspiled(transpiled)).toBe(5);
  });

  it('still works if .prototype is read before explicit assignment', () => {
    const setup = transpile(wrapForCompletionValue(`class A {
  m() { return 5; }
}`));
    const result = evalTranspiled(`${setup}\n$global.A.prototype;\nreturn new ($global.A)().m()`);
    expect(result).toBe(5);
  });

  it('works without extra constructor parentheses after transpile', () => {
    const transpiled = transpile(wrapForCompletionValue(`class A {
  m() { return 5; }
}
new A().m()`)).replace('new ($global.A)', 'new $global.A');
    expect(evalTranspiled(transpiled)).toBe(5);
  });

  it('threads `this` into a closure so the captured receiver is the instance', () => {
    const code = `class A {
  constructor() { this.x = 42; }
  m() {
    let f = () => this.x;
    return f();
  }
}
new A().m()`;
    expect(evalTranspiled(transpile(wrapForCompletionValue(code)))).toBe(42);
  });

  it('threads `this` through nested closures', () => {
    const code = `class A {
  constructor() { this.x = 7; }
  m() {
    let outer = () => {
      let inner = () => this.x;
      return inner();
    };
    return outer();
  }
}
new A().m()`;
    expect(evalTranspiled(transpile(wrapForCompletionValue(code)))).toBe(7);
  });
});
