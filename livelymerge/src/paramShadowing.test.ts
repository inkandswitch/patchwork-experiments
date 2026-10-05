/**
 * A regular function's parameter must shadow a same-named variable in the
 * enclosing function, whether that variable is declared before or after the
 * inner function. (openSessionLog's `kill(m)` read the later `let m = 8` and
 * so never removed old panels.)
 */
import { describe, expect, it } from 'vitest';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

describe('parameter shadowing in nested functions', () => {
  it('parameters win over enclosing let bindings', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    const g = globalThis as any;
    g.handle = handle;
    g.runtime = rt;
    const result = rt.eval(`
(() => {
  function later() { let k = function (m) { return m; }; let r = k(1); let m = 8; return r; }
  function earlier() { let m = 8; let k = function (m) { return m; }; return k(1); }
  function decl() { function k(m) { return m; } let r = k(1); let m = 8; return r; }
  function nested() { let r; { let k = function (m) { return m; }; r = k(1); } let m = 8; return r; }
  function arrow() { let k = (m) => m; let r = k(1); let m = 8; return r; }
  function captured() { let m = 8; let k = function (m) { return () => m; }; return k(1)(); }
  return [later(), earlier(), decl(), nested(), arrow(), captured()].join(',');
})()`);
    expect(result).toBe('1,1,1,1,1,1');
  });
});
