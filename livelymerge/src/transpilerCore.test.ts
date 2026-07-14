import { describe, expect, it } from 'vitest';
import { transpileCore } from './transpiler';

describe('transpileCore literal wrapping', () => {
  it('does not double-wrap object literals passed to $obj', () => {
    expect(transpileCore('$global.C.prototype = $obj({ m: 1 });')).toBe(
      '$global.C.prototype = $obj({ m: 1 });',
    );
  });
});
