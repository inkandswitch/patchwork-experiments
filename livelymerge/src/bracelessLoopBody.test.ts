/**
 * Regression: free variables in a brace-less `for` body were never walked, so they
 * missed the $global rewrite and threw ReferenceError at run time (if/while bodies
 * were fine — only ForStatement's walker skipped non-Block bodies). Found when the
 * ephemeral-streaming receiver's `for (...) ephApplyOverlayEntry(...)` silently
 * aborted every frame transaction.
 */
import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';

const rewrites = (src: string, needle: string) => transpile(src).includes(needle);

describe('free vars in brace-less loop bodies', () => {
  it('braced for body: callee rewritten', () => {
    expect(
      rewrites(`function f(xs) { for (let i = 0; i < 3; i++) { g(xs); } }`, '$global.g('),
    ).toBe(true);
  });
  it('brace-less for body: callee rewritten?', () => {
    expect(
      rewrites(`function f(xs) { for (let i = 0; i < 3; i++) g(xs); }`, '$global.g('),
    ).toBe(true);
  });
  it('brace-less if body: callee rewritten?', () => {
    expect(rewrites(`function f(x) { if (x) g(x); }`, '$global.g(')).toBe(true);
  });
  it('brace-less while body: callee rewritten?', () => {
    expect(rewrites(`function f(x) { while (x) g(x); }`, '$global.g(')).toBe(true);
  });
});
