import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';
import { evalTranspiled } from './evalHarness';
import { transpile } from './transpiler';

describe('object toString', () => {
  it('returns [obj id] for plain object literals', () => {
    const result = evalTranspiled(transpile(wrapForCompletionValue('({x: 1, y: 2}).toString()')));
    expect(result).toMatch(/^\[obj /);
    expect(result).not.toBe('[object Object]');
  });
});
