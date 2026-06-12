import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';

describe('transpile', () => {
  describe('literal wrapping', () => {
    it('wraps a flat array literal', () => {
      expect(transpile(`function f(x) {
  return [x, 5].join(',');
}`)).toBe(`const f = $func(function(x) {
  return $arr([x, 5]).join(',');
});`);
    });

    it('wraps nested array literals inside-out', () => {
      expect(transpile(`function f(x) {
  return [x, [5, 6]].join(',');
}`)).toBe(`const f = $func(function(x) {
  return $arr([x, $arr([5, 6])]).join(',');
});`);
    });

    it('wraps nested object and array literals', () => {
      expect(transpile(`const foo = { x: 1, bar: { a: 3, b: [4, 5] } };`)).toBe(
        `const foo = $obj({ x: 1, bar: $obj({ a: 3, b: $arr([4, 5]) }) });`,
      );
    });
  });

  describe('$func wrapping', () => {
    it('wraps an arrow function with no block scopes in the free-var list', () => {
      expect(transpile(`const f = (x) => x + y;`)).toBe(`const f = $func((x) => x + y);`);
    });

    it('wraps nested function literals separately', () => {
      expect(transpile(`const f = (x) => (y) => x + y;`)).toBe(
        `const f = $func((x) => $func((y) => x + y));`,
      );
    });

    it('wraps a function expression and leaves non-block free vars bare', () => {
      expect(transpile(`const f = function(a) { var b = c; return a + d; };`)).toBe(
        `const f = $func(function(a) { var b = c; return a + d; });`,
      );
    });

    it('handles destructured parameters', () => {
      expect(transpile(`const f = ({x, y}) => x + z;`)).toBe(`const f = $func(({x, y}) => x + z);`);
    });

    it('does not list block-local bindings as free variables', () => {
      expect(transpile(`const f = (x) => { let z = w; return x + z; };`)).toBe(
        `const f = $func((x) => { let z = w; return x + z; });`,
      );
    });

    it('combines $func wrapping with literal wrapping inside the function body', () => {
      expect(transpile(`const f = (x) => [x, y];`)).toBe(`const f = $func((x) => $arr([x, y]));`);
    });

    it('wraps function declarations and leaves non-block default-param refs bare', () => {
      expect(transpile(`function f(x = g(5)) {
  return x + 1;
}`)).toBe(`const f = $func(function(x = g(5)) {
  return x + 1;
});`);
    });
  });

  describe('scope objects', () => {
    it('objectifies a block scope and passes it to $func', () => {
      expect(transpile(`{
  let x = 0;
  let y = 1;
  return (a) => x * y;
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  $scope2.y = 1;
  return $func((a) => $scope2.x * $scope2.y, [$scope2]);
}`);
    });

    it('only hoists bindings that are used as free variables', () => {
      expect(transpile(`{
  let x = 0;
  let y = 1;
  return (a) => x * x;
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  let y = 1;
  return $func((a) => $scope2.x * $scope2.x, [$scope2]);
}`);
    });

    it('adds more bindings to the scope object when more functions need them', () => {
      expect(transpile(`{
  let x = 0;
  let y = 1;
  return [
    () => x * x,
    () => y * y
  ];
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  $scope2.y = 1;
  return $arr([
    $func(() => $scope2.x * $scope2.x, [$scope2]),
    $func(() => $scope2.y * $scope2.y, [$scope2])
  ]);
}`);
    });

    it('passes multiple scope objects when free vars come from different scopes', () => {
      expect(transpile(`{
  let x = 0;
  {
    let y = 1;
    return (a) => x * y;
  }
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  {
  const $scope3 = $obj({});
    $scope3.y = 1;
    return $func((a) => $scope2.x * $scope3.y, [$scope2, $scope3]);
  }
}`);
    });

    it('does not objectify scopes whose bindings are not used as free variables', () => {
      expect(transpile(`{
  let x = 0;
  {
    let y = 1;
    return (a) => x * x;
  }
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  {
    let y = 1;
    return $func((a) => $scope2.x * $scope2.x, [$scope2]);
  }
}`);
    });
  });
});
