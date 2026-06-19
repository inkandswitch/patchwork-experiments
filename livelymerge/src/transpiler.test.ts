import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';

describe('transpile', () => {
  describe('literal wrapping', () => {
    it('wraps a flat array literal', () => {
      expect(transpile(`function f(x) {
  return [x, 5].join(',');
}`)).toBe(`$global.f = $fun("function f(x) {\\n  return [x, 5].join(',');\\n}", "() => function(x) {\\n  return $arr([x, 5]).join(',');\\n}");`);
    });

    it('wraps nested array literals inside-out', () => {
      expect(transpile(`function f(x) {
  return [x, [5, 6]].join(',');
}`)).toBe(`$global.f = $fun("function f(x) {\\n  return [x, [5, 6]].join(',');\\n}", "() => function(x) {\\n  return $arr([x, $arr([5, 6])]).join(',');\\n}");`);
    });

    it('wraps nested object and array literals', () => {
      expect(transpile(`const foo = { x: 1, bar: { a: 3, b: [4, 5] } };`)).toBe(
        `$global.foo = $obj({ x: 1, bar: $obj({ a: 3, b: $arr([4, 5]) }) });`,
      );
    });
  });

  describe('$fun wrapping', () => {
    it('wraps an arrow function with no block scopes in the free-var list', () => {
      expect(transpile(`const f = (x) => x + y;`)).toBe(
        `$global.f = $fun("(x) => x + y", "() => (x) => x + $global.y");`,
      );
    });

    it('wraps nested function literals separately', () => {
      expect(transpile(`const f = (x) => (y) => x + y;`)).toBe(
        `$global.f = $fun("(x) => (y) => x + y", "() => (x) => $fun(\\"(y) => x + y\\", \\"() => (y) => x + y\\")");`,
      );
    });

    it('throws on var declarations', () => {
      expect(() => transpile(`const f = function(a) { var b = c; return a + d; };`)).toThrow(
        "'var' is not allowed",
      );
    });

    it('handles destructured parameters', () => {
      expect(transpile(`const f = ({x, y}) => x + z;`)).toBe(
        `$global.f = $fun("({x, y}) => x + z", "() => ({x, y}) => x + $global.z");`,
      );
    });

    it('treats unbound w like any other world property', () => {
      expect(transpile(`const f = (x) => { let z = w; return x + z; };`)).toBe(
        `$global.f = $fun("(x) => { let z = w; return x + z; }", "() => (x) => { let z = $global.w; return x + z; }");`,
      );
    });

    it('combines $fun wrapping with literal wrapping inside the function body', () => {
      expect(transpile(`const f = (x) => [x, y];`)).toBe(
        `$global.f = $fun("(x) => [x, y]", "() => (x) => $arr([x, $global.y])");`,
      );
    });

    it('wraps function declarations and leaves non-block default-param refs bare', () => {
      expect(transpile(`function f(x = g(5)) {
  return x + 1;
}`)).toBe(`$global.f = $fun("function f(x = g(5)) {\\n  return x + 1;\\n}", "() => function(x = $global.g(5)) {\\n  return x + 1;\\n}");`);
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

    it('keeps block lets without free variables as plain declarations', () => {
      expect(transpile(`{ let x = 1; x + 1 }`)).toBe(`{ let x = 1; x + 1 }`);
    });

    it('stores top-level bindings on $global and captures them via $global in closures', () => {
      expect(transpile(`let count = 0;
inc = () => ++count;`)).toBe(`$global.count = 0;
$global.inc = $fun("() => ++count", "() => () => ++$global.count");`);
    });

    it('stores top-level bindings without a trailing semicolon', () => {
      expect(transpile(`let c = 0
inc = () => ++c`)).toBe(`$global.c = 0
$global.inc = $fun("() => ++c", "() => () => ++$global.c")`);
    });

    it('puts every top-level binding on $global', () => {
      expect(transpile(`let x = 'aaa', y = 'bbb';
f = () => x;`)).toBe(`$global.x = 'aaa';
$global.y = 'bbb';
$global.f = $fun("() => x", "() => () => $global.x");`);
    });

    it('captures multiple top-level bindings via $global', () => {
      expect(transpile(`let x = 'aaa', y = 'bbb';
f = () => x + y;`)).toBe(`$global.x = 'aaa';
$global.y = 'bbb';
$global.f = $fun("() => x + y", "() => () => $global.x + $global.y");`);
    });

    it('preserves declaration order when splitting mixed multi-declarator lets', () => {
      expect(transpile(`{
  let x = 1, y = 2, z = 3;
  return [() => y, () => z];
}`)).toBe(`{
  const $scope2 = $obj({});
  let x=1;
  $scope2.y = 2;
  $scope2.z = 3;
  return $arr([$fun("() => y", "($scope2) => () => $scope2.y", [$scope2]), $fun("() => z", "($scope2) => () => $scope2.z", [$scope2])]);
}`);
    });
  });

  describe('implicit world bindings', () => {
    it('rewrites unbound top-level references to $global', () => {
      expect(transpile(`foo = 1;`)).toBe(`$global.foo = 1;`);
    });

    it('rewrites top-level references to declared bindings via $global', () => {
      expect(transpile(`let x = 1;
x + 2`)).toBe(`$global.x = 1;
$global.x + 2`);
    });

    it('allows w as a normal top-level variable name', () => {
      expect(transpile(`let w = foo;
return w;`)).toBe(`$global.w = $global.foo;
return $global.w;`);
    });

    it('does not rewrite w when shadowed by a parameter', () => {
      expect(transpile(`const f = (w) => w + 1;`)).toBe(
        `$global.f = $fun("(w) => w + 1", "() => (w) => w + 1");`,
      );
    });

    it('does not rewrite w when shadowed in a nested block', () => {
      expect(transpile(`{
  let w = 1;
  return w;
}`)).toBe(`{
  let w = 1;
  return w;
}`);
    });

    it('rewrites top-level destructuring without evaluating the rhs twice', () => {
      expect(transpile(`let {x, y} = obj;`)).toBe(
        `const { $tmp1, $tmp2 } = $global.obj;
$global.x = $tmp1;
$global.y = $tmp2;`,
      );
    });

    it('throws when assigning to a top-level const binding', () => {
      expect(() => transpile(`const x = 1;
x = 2;`)).toThrow("cannot assign to const-declared variable 'x'");
    });
  });
});
