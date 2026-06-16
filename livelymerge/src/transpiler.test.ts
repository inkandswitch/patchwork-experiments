import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';

describe('transpile', () => {
  describe('literal wrapping', () => {
    it('wraps a flat array literal', () => {
      expect(transpile(`function f(x) {
  return [x, 5].join(',');
}`)).toBe(`const f = $fun("function f(x) {\\n  return [x, 5].join(',');\\n}", "() => function(x) {\\n  return $arr([x, 5]).join(',');\\n}");`);
    });

    it('wraps nested array literals inside-out', () => {
      expect(transpile(`function f(x) {
  return [x, [5, 6]].join(',');
}`)).toBe(`const f = $fun("function f(x) {\\n  return [x, [5, 6]].join(',');\\n}", "() => function(x) {\\n  return $arr([x, $arr([5, 6])]).join(',');\\n}");`);
    });

    it('wraps nested object and array literals', () => {
      expect(transpile(`const foo = { x: 1, bar: { a: 3, b: [4, 5] } };`)).toBe(
        `const foo = $obj({ x: 1, bar: $obj({ a: 3, b: $arr([4, 5]) }) });`,
      );
    });
  });

  describe('$fun wrapping', () => {
    it('wraps an arrow function with no block scopes in the free-var list', () => {
      expect(transpile(`const f = (x) => x + y;`)).toBe(`const f = $fun("(x) => x + y", "() => (x) => x + y");`);
    });

    it('wraps nested function literals separately', () => {
      expect(transpile(`const f = (x) => (y) => x + y;`)).toBe(
        `const f = $fun("(x) => (y) => x + y", "() => (x) => $fun(\\"(y) => x + y\\", \\"() => (y) => x + y\\")");`,
      );
    });

    it('throws on var declarations', () => {
      expect(() => transpile(`const f = function(a) { var b = c; return a + d; };`)).toThrow(
        "'var' is not allowed",
      );
    });

    it('handles destructured parameters', () => {
      expect(transpile(`const f = ({x, y}) => x + z;`)).toBe(`const f = $fun("({x, y}) => x + z", "() => ({x, y}) => x + z");`);
    });

    it('does not list block-local bindings as free variables', () => {
      expect(transpile(`const f = (x) => { let z = w; return x + z; };`)).toBe(
        `const f = $fun("(x) => { let z = w; return x + z; }", "() => (x) => { let z = w; return x + z; }");`,
      );
    });

    it('combines $fun wrapping with literal wrapping inside the function body', () => {
      expect(transpile(`const f = (x) => [x, y];`)).toBe(`const f = $fun("(x) => [x, y]", "() => (x) => $arr([x, y])");`);
    });

    it('wraps function declarations and leaves non-block default-param refs bare', () => {
      expect(transpile(`function f(x = g(5)) {
  return x + 1;
}`)).toBe(`const f = $fun("function f(x = g(5)) {\\n  return x + 1;\\n}", "() => function(x = g(5)) {\\n  return x + 1;\\n}");`);
    });
  });

  describe('scope objects', () => {
    it('objectifies a block scope and passes it to $fun', () => {
      expect(transpile(`{
  let x = 0;
  let y = 1;
  return (a) => x * y;
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 0;
  $scope2.y = 1;
  return $fun("(a) => x * y", "($scope2) => (a) => $scope2.x * $scope2.y", [$scope2]);
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
  return $fun("(a) => x * x", "($scope2) => (a) => $scope2.x * $scope2.x", [$scope2]);
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
    $fun("() => x * x", "($scope2) => () => $scope2.x * $scope2.x", [$scope2]),
    $fun("() => y * y", "($scope2) => () => $scope2.y * $scope2.y", [$scope2])
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
    return $fun("(a) => x * y", "($scope2, $scope3) => (a) => $scope2.x * $scope3.y", [$scope2, $scope3]);
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
    return $fun("(a) => x * x", "($scope2) => (a) => $scope2.x * $scope2.x", [$scope2]);
  }
}`);
    });

    it('objectifies a top-level block scope for closures assigned to properties', () => {
      expect(transpile(`let count = 0;
w.inc = () => ++count;`)).toBe(`const $scope1 = $obj({});
$scope1.count = 0;
w.inc = $fun("() => ++count", "($scope1) => () => ++$scope1.count", [$scope1]);`);
    });

    it('objectifies bindings without a trailing semicolon before the next statement', () => {
      expect(transpile(`let c = 0
w.inc = () => ++c`)).toBe(`const $scope1 = $obj({});
$scope1.c = 0
w.inc = $fun("() => ++c", "($scope1) => () => ++$scope1.c", [$scope1])`);
    });
  });
});
