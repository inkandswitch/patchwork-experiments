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

  it('rejects calling a class constructor through $global without new', () => {
    const setup = transpile(wrapForCompletionValue(`class A {
  m() { return 5; }
}`));
    expect(() => evalTranspiled(`${setup}\nreturn $global.A().m()`)).toThrow(
      /cannot be invoked without 'new'/,
    );
  });

  it('works without extra constructor parentheses after transpile', () => {
    const transpiled = transpile(wrapForCompletionValue(`class A {
  m() { return 5; }
}
new A().m()`)).replace('new ($global.A)', 'new $global.A');
    expect(evalTranspiled(transpiled)).toBe(5);
  });
});
