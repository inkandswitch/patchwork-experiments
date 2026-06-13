import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';

describe('wrapForCompletionValue', () => {
  it('wraps a single expression', () => {
    expect(wrapForCompletionValue('1 + 2')).toBe('return 1 + 2');
  });

  it('wraps the last expression in a statement list', () => {
    expect(wrapForCompletionValue('const x = 1; x + 2')).toBe('const x = 1; return x + 2');
  });

  it('wraps assignment expressions', () => {
    expect(wrapForCompletionValue('x = 5')).toBe('return x = 5');
  });

  it('leaves an existing return statement alone', () => {
    expect(wrapForCompletionValue('return 42')).toBe('return 42');
  });

  it('wraps the last expression inside a block', () => {
    expect(wrapForCompletionValue('{ let x = 1; x + 1 }')).toBe('{ let x = 1; return x + 1 }');
  });

  it('does not wrap declarations', () => {
    expect(wrapForCompletionValue('const x = 1')).toBe('const x = 1');
  });

  it('does not wrap a block that already returns', () => {
    expect(wrapForCompletionValue('{ return 1 }')).toBe('{ return 1 }');
  });

  it('leaves empty input unchanged', () => {
    expect(wrapForCompletionValue('')).toBe('');
  });

  it('produces a value when evaluated via new Function', () => {
    const wrapped = wrapForCompletionValue('const x = 3; x + 4');
    const result = new Function(wrapped)();
    expect(result).toBe(7);
  });
});
