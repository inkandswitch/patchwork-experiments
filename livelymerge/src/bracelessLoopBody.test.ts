/**
 * Regression: free variables in a brace-less `for` body were never walked, so they
 * missed the $global rewrite and threw ReferenceError at run time (if/while bodies
 * were fine — only ForStatement's walker skipped non-Block bodies). Found when the
 * ephemeral-streaming receiver's `for (...) ephApplyOverlayEntry(...)` silently
 * aborted every frame transaction.
 */
import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';

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

/** Closures in brace-less loop bodies capture the loop variable through a hoisted
 * scope object, exactly like braced bodies do (including the shared-scope concession:
 * every closure sees the final value). Executed through the real runtime. */
describe('captured loop variables in brace-less bodies', () => {
  const closureResults = (setup: string): unknown[] => {
    const rt = createLivelymergeRuntime(createAutomergeTestDocHandle());
    rt.eval(setup);
    return [rt.eval('fns[0]()'), rt.eval('fns[1]()'), rt.eval('fns[2]()')];
  };

  it('top-level brace-less for: closures read the live loop scope', () => {
    expect(
      closureResults(`fns = [];
for (let i = 0; i < 3; i++) fns.push(() => i);`),
    ).toEqual([3, 3, 3]); // shared-scope concession — same as the braced behavior below
  });

  it('braced control behaves identically', () => {
    expect(
      closureResults(`fns = [];
{
  for (let i = 0; i < 3; i++) {
    fns.push(() => i);
  }
}`),
    ).toEqual([3, 3, 3]);
  });

  it('in-function brace-less for: closures read the live loop scope', () => {
    expect(
      closureResults(`function g() {
  let fns = [];
  for (let i = 0; i < 3; i++) fns.push(() => i);
  return fns;
}
fns = g();`),
    ).toEqual([3, 3, 3]);
  });

  it('for-of captures work braced and brace-less', () => {
    expect(
      closureResults(`fns = [];
for (const e of [10, 20, 30]) fns.push(() => e);`),
    ).toEqual([30, 30, 30]);
    expect(
      closureResults(`fns = [];
{
  for (const e of [10, 20, 30]) {
    fns.push(() => e);
  }
}`),
    ).toEqual([30, 30, 30]);
  });
});
