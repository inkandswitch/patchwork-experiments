import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';
import { evalTranspiled } from './evalHarness';
import { transpile } from './transpiler';

describe('class toString runtime', () => {
  it('calls @toString on class instances', () => {
    const result = evalTranspiled(
      transpile(
        wrapForCompletionValue(`
class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
new Point(1, 2).toString()
`),
      ),
    );
    expect(result).toBe('(1, 2)');
  });

  it('returns the @toString method, not native Object.prototype.toString', () => {
    const code = transpile(
      wrapForCompletionValue(`
class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p = new Point(1, 2);
({ fn: p.toString, same: p.toString === Object.prototype.toString, value: p.toString() })
`),
    );
    const info = evalTranspiled(code) as {
      fn: unknown;
      same: boolean;
      value: string;
    };
    expect(info.same).toBe(false);
    expect(typeof info.fn).toBe('function');
    expect(info.value).toBe('(1, 2)');
  });

  it('does not fall back to native Object.prototype.toString when @toString is missing', () => {
    const result = evalTranspiled(
      transpile(
        wrapForCompletionValue(`
const o = $obj({}, null);
o.toString === Object.prototype.toString
`),
      ),
    );
    expect(result).toBe(false);
  });
});
