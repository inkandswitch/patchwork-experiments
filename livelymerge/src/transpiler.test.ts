import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

    it('rewrites top-level function references in block initializers to $global', () => {
      const result = transpile(`function aaa() {}

{
  let foo = aaa;
  function f() {
    console.log(foo);
  }
}`);
      expect(result).toMatch(/\$scope\d+\.foo = \$global\.aaa/);
    });

    it('rewrites top-level function references used as arguments to $global', () => {
      expect(transpile(`function f() { return 5; }

function g() {
  console.log(f);
}

g();`)).toBe(`$global.f = $fun("function f() { return 5; }", "() => function() { return 5; }");

$global.g = $fun("function g() {\\n  console.log(f);\\n}", "() => function() {\\n  console.log($global.f);\\n}");

$global.g();`);
    });

    it('rewrites recursive calls in top-level function declarations to $global', () => {
      expect(transpile(`function f(x) {
  if (x === 0) {
    return 1;
  } else {
    return f(x - 1) * x;
  }
}

f(5)`)).toBe(`$global.f = $fun("function f(x) {\\n  if (x === 0) {\\n    return 1;\\n  } else {\\n    return f(x - 1) * x;\\n  }\\n}", "() => function(x) {\\n  if (x === 0) {\\n    return 1;\\n  } else {\\n    return $global.f(x - 1) * x;\\n  }\\n}");

$global.f(5)`);
    });

    it('leaves recursive calls in nested function declarations bare', () => {
      expect(transpile(`function outer() {
  function inner(n) {
    return n <= 1 ? 1 : inner(n - 1) * n;
  }
  return inner(5);
}`)).toBe(`$global.outer = $fun("function outer() {\\n  function inner(n) {\\n    return n <= 1 ? 1 : inner(n - 1) * n;\\n  }\\n  return inner(5);\\n}", "() => function() {\\n  const inner = $fun(\\"function inner(n) {\\\\n    return n <= 1 ? 1 : inner(n - 1) * n;\\\\n  }\\", \\"() => function(n) {\\\\n    return n <= 1 ? 1 : inner(n - 1) * n;\\\\n  }\\");\\n  return inner(5);\\n}");`);
    });

    it('captures sibling function declarations used before their definition', () => {
      expect(transpile(`function initUI() {
  let canvasEvents = [];

  function onFrame() {
    processEvents();
  }

  function processEvents() {
    canvasEvents = [];
  }
}`)).toMatch(/\(\$scope\d+\.processEvents\)\(\)/);
      expect(transpile(`function initUI() {
  let canvasEvents = [];

  function onFrame() {
    processEvents();
  }

  function processEvents() {
    canvasEvents = [];
  }
}`)).toMatch(/\$scope\d+\.processEvents = \$fun/);
    });

    it('scopes function declarations passed as callbacks to scope-assigned siblings', () => {
      const result = transpile(`function initUI() {
  let canvasEvents = [];
  function onFrame() {
    try {
      window.runtime.change(() => {
        processEvents();
        window._uiRafId = window.requestAnimationFrame(onFrame);
      });
    } catch (e) {
      window._uiRafId = window.requestAnimationFrame(onFrame);
    }
  }
  function processEvents() {
    canvasEvents = [];
  }
  window._uiRafId = window.requestAnimationFrame(onFrame);
}`);
      expect(result).toMatch(
        /catch \(e\) \{\\\\n      \$global\.window\._uiRafId = \$global\.window\.requestAnimationFrame\(\$scope\d+\.onFrame\);/,
      );
      expect(result).toMatch(
        /\$global\.window\._uiRafId = \$global\.window\.requestAnimationFrame\(\$scope\d+\.onFrame\);\\n\}"\);$/,
      );
    });

    it('threads scope objects through intermediate nested functions', () => {
      expect(transpile(`function f() {
  let x = 5;
  function g() {
    function h() {
      return x * 2;
    }
    return h();
  }
  return g();
}

f()`)).toBe(`$global.f = $fun("function f() {\\n  let x = 5;\\n  function g() {\\n    function h() {\\n      return x * 2;\\n    }\\n    return h();\\n  }\\n  return g();\\n}", "() => function() {\\n  const $scope6 = $obj({});\\n  $scope6.x = 5;\\n  const g = $fun(\\"function g() {\\\\n    function h() {\\\\n      return x * 2;\\\\n    }\\\\n    return h();\\\\n  }\\", \\"($scope6) => function() {\\\\n    const h = $fun(\\\\\\"function h() {\\\\\\\\n      return x * 2;\\\\\\\\n    }\\\\\\", \\\\\\"($scope6) => function() {\\\\\\\\n      return $scope6.x * 2;\\\\\\\\n    }\\\\\\", [$scope6]);\\\\n    return h();\\\\n  }\\", [$scope6]);\\n  return g();\\n}");

$global.f()`);
    });

    it('does not pass locally-created scope objects into a function $fun wrapper', () => {
      expect(transpile(`function outer() {
  let x = 1;
  window.f = function (a) {
    let pid = a;
    window.setTimeout(function () {
      return pid + x;
    }, 0);
  };
}`)).toBe(`$global.outer = $fun("function outer() {\\n  let x = 1;\\n  window.f = function (a) {\\n    let pid = a;\\n    window.setTimeout(function () {\\n      return pid + x;\\n    }, 0);\\n  };\\n}", "() => function() {\\n  const $scope6 = $obj({});\\n  $scope6.x = 1;\\n  $global.window.f = $fun(\\"function (a) {\\\\n    let pid = a;\\\\n    window.setTimeout(function () {\\\\n      return pid + x;\\\\n    }, 0);\\\\n  }\\", \\"($scope6) => function (a) {\\\\n  const $scope8 = $obj({});\\\\n    $scope8.pid = a;\\\\n    $global.window.setTimeout($fun(\\\\\\"function () {\\\\\\\\n      return pid + x;\\\\\\\\n    }\\\\\\", \\\\\\"($scope6, $scope8) => function () {\\\\\\\\n      return $scope8.pid + $scope6.x;\\\\\\\\n    }\\\\\\", [$scope6, $scope8]), 0);\\\\n  }\\", [$scope6]);\\n}");`);
    });

    it('leaves functions with a do-not-transpile marker untouched', () => {
      expect(transpile(`{
  let x = 5;
  x++;
  function f(a) {
    // $$$ do not transpile $$$
    return a + 1;
  }
  let y = f(x);
  console.log(y);
}`)).toBe(`{
  let x = 5;
  x++;
  function f(a) {
    // $$$ do not transpile $$$
    return a + 1;
  }
  let y = f(x);
  console.log(y);
}`);
    });

    it('leaves arrow functions with a do-not-transpile marker untouched', () => {
      expect(transpile(`const f = (a) => {
  // $$$ do not transpile $$$
  return [a, y];
};`)).toBe(`$global.f = (a) => {
  // $$$ do not transpile $$$
  return [a, y];
};`);
    });

    it('allows var inside do-not-transpile functions', () => {
      expect(transpile(`function f() {
  // $$$ do not transpile $$$
  var x = 1;
  return x;
}`)).toBe(`function f() {
  // $$$ do not transpile $$$
  var x = 1;
  return x;
}`);
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

    it('keeps for-loop let variables local when not captured by closures', () => {
      expect(transpile(`{
  for (let i = 0; i < 5; i++) {
    console.log(i);
  }
}`)).toBe(`{
  for (let i = 0; i < 5; i++) {
    console.log(i);
  }
}`);
    });

    it('promotes for-loop let variables to scope object when captured by closures', () => {
      expect(transpile(`{
  for (let i = 0; i < 5; i++) {
    f = () => i;
  }
}`)).toBe(`{
  const $scope3 = $obj({});
  for ($scope3.i = 0; $scope3.i < 5; $scope3.i++) {
    f = $fun("() => i", "($scope3) => () => $scope3.i", [$scope3]);
  }
}`);
    });

    it('does not scope locals referenced across blocks when no closure captures them', () => {
      const result = transpile(`function compose() {
  let str = this.string;
  let lineStart = 0;
  for (let idx = 0; idx < str.length; idx++) {
    let c = str[idx];
    if (c == '\\n') {
      let line = str.slice(lineStart, idx + 1);
      lineStart = idx + 1;
    }
  }
  return lineStart;
}`);
      expect(result).not.toContain('$scope');
      expect(result).toContain('let str = this.string');
      expect(result).toContain('for (let idx = 0; idx < str.length; idx++)');
      expect(result).toContain('let c = str[idx]');
      expect(result).toContain('str.slice(lineStart, idx + 1)');
    });

    it('rewrites scoped binding references outside closures in the same block', () => {
      expect(transpile(`{
  let x = 1;
  let y = x + 1;
  return () => x + y;
}`)).toBe(`{
  const $scope2 = $obj({});
  $scope2.x = 1;
  $scope2.y = $scope2.x + 1;
  return $fun("() => x + y", "($scope2) => () => $scope2.x + $scope2.y", [$scope2]);
}`);
    });

    it('rewrites a scoped binding in a later non-scoped declaration initializer', () => {
      const result = transpile(`fit() {
  let maxW = 0;
  this.displayItems.forEach((item) => {
    maxW = Math.max(maxW, item.width);
  });
  let targetW = Math.ceil(maxW + 14);
  return targetW;
}`);
      expect(result).toMatch(/let targetW = \$global\.Math\.ceil\(\$scope\d+\.maxW \+ 14\)/);
    });

    it('threads a captured parameter through a scope object', () => {
      const result = transpile(`class M {
  stopSteppingMorph(morph, methodName) {
    if (methodName) {
      this.stepList = this.stepList.filter(
        (spec) => !(spec.stepMorph === morph && spec.methodName === methodName),
      );
      return;
    }
    this.stepList = this.stepList.filter((spec) => spec.stepMorph !== morph);
  }
}`);
      expect(result).toMatch(/const \$scope\d+ = \$obj\(\{\}\);/);
      expect(result).toMatch(/\$scope\d+\.morph = morph;/);
      expect(result).toMatch(/\$scope\d+\.methodName = methodName;/);
      expect(result).toMatch(/if \(\$scope\d+\.methodName\)/);
      expect(result).toMatch(
        /\(\$scope\d+\) => \(spec\) => !\(spec\.stepMorph === \$scope\d+\.morph && spec\.methodName === \$scope\d+\.methodName\)/,
      );
      expect(result).toMatch(/\(\$scope\d+\) => \(spec\) => spec\.stepMorph !== \$scope\d+\.morph/);
    });

    it('rewrites assignments to a captured parameter through the scope object', () => {
      const result = transpile(`function f(morph) {
  morph = morph || {};
  arr.forEach((x) => { morph = x; });
  return morph;
}`);
      expect(result).toMatch(/\$scope\d+\.morph = morph;/);
      expect(result).toMatch(/\$scope\d+\.morph = \$scope\d+\.morph \|\| \$obj\(\{\}\)/);
      expect(result).toMatch(/\(\$scope\d+\) => \(x\) => \{ \$scope\d+\.morph = x; \}/);
      expect(result).toMatch(/return \$scope\d+\.morph;/);
    });

    it('leaves an expression-bodied curry parameter bare (no body to host a scope object)', () => {
      expect(transpile(`const g = (x) => (y) => x + y;`)).toBe(
        `$global.g = $fun("(x) => (y) => x + y", "() => (x) => $fun(\\"(y) => x + y\\", \\"() => (y) => x + y\\")");`,
      );
    });

    it('rewrites earlier scoped bindings used in later declarations and expressions', () => {
      expect(transpile(`setBounds(newBnds) {
  let oldBnds = this.getBounds();
  let oldCtr = oldBnds.center();
  let scale = pt(1, 1);
  return items.map((x) => x + oldCtr + oldBnds.width() + scale.x);
}`)).toMatch(/\$scope\d+\.oldCtr = \$scope\d+\.oldBnds\.center\(\)/);
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
    it('parenthesizes global constructors in new expressions', () => {
      expect(transpile(`new C(5).n()`)).toBe(`new ($global.C)(5).n()`);
    });

    it('parenthesizes zero-arg global constructors before member calls', () => {
      expect(transpile(`new A().m()`)).toBe(`new ($global.A)().m()`);
    });

    it('rewrites unbound top-level references to $global', () => {
      expect(transpile(`foo = 1;`)).toBe(`$global.foo = 1;`);
    });

    it('rewrites top-level member assignment lhs to $global', () => {
      expect(transpile(`class C {}
C.foo = 'bar';`)).toContain("$global.C.foo = 'bar'");
      expect(transpile(`obj = {};
obj.x = 1;`)).toBe(`$global.obj = $obj({});
$global.obj.x = 1;`);
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

    it('leaves injected console references bare', () => {
      expect(transpile(`console.log(x);`)).toBe(`console.log($global.x);`);
      expect(transpile(`f = () => console.info(y);`)).toBe(
        `$global.f = $fun("() => console.info(y)", "() => () => console.info($global.y)");`,
      );
    });

    it('rewrites unbound global member calls in initializer expressions', () => {
      expect(
        transpile(`class LineMorph extends Morph {
  constructor(vertices, opts = {}) {
    let verts = vertices.map((v) => pt(v.x, v.y));
    let worldBounds = PolyLine.boundsForVertices(verts, 2);
    let pl = new PolyLine(verts, 2, Color.black);
    super(null, pl);
  }
}`),
      ).toContain('$global.PolyLine.boundsForVertices');
    });

    it('rewrites class name static member access in constructor initializers', () => {
      expect(
        transpile(`class PolyLine extends Shape {
  constructor(verts, width, color) {
    const bounds = PolyLine.boundsForVertices(verts, width);
    super('PolyLine', bounds, null, width, color);
  }
  static boundsForVertices(vertices, borderWidth) {
    return rect(0, 0, 1, 1);
  }
}`),
      ).toContain(
        'const bounds = $global.PolyLine.boundsForVertices(verts, width)',
      );
    });

    it('rewrites unbound global member calls in return expressions', () => {
      expect(
        transpile(`function f(verts) {
  return PolyLine.boundsForVertices(verts, 2);
}`),
      ).toBe(
        `$global.f = $fun("function f(verts) {\\n  return PolyLine.boundsForVertices(verts, 2);\\n}", "() => function(verts) {\\n  return $global.PolyLine.boundsForVertices(verts, 2);\\n}");`,
      );
    });

    it('rewrites scoped bindings inside function expression callbacks', () => {
      const result = transpile(`function initUI() {
  let canvasEvents = [];
  canvas.addEventListener('pointerdown', function (e) {
    canvasEvents.push(e);
  });
}`);
      expect(result).toMatch(/\(\$scope\d+\) => function \(e\) \{[^"]*\$scope\d+\.canvasEvents\.push\(e\)/);
    });

    it('rewrites canvasEvents in initUI.js arrow callbacks and processEvents', () => {
      const source = readFileSync(join(__dirname, '../initUI.js'), 'utf8');
      const result = transpile(source);
      expect(result).toMatch(/\(\$scope\d+\) => \(e\) => \$scope\d+\.canvasEvents\.push\(e\)/);
      expect(result).toMatch(/for \(const e of \$scope\d+\.canvasEvents\)/);
      expect(result).toMatch(/\$scope\d+\.canvasEvents = \$arr\(\[\]\)/);
    });

    it('rewrites scoped bindings inside arrow callbacks passed to addEventListener', () => {
      const result = transpile(`function initUI() {
  let canvasEvents = [];
  canvas.addEventListener('pointerdown', (e) => canvasEvents.push(e));
}`);
      expect(result).toContain('($scope');
      expect(result).toMatch(/\(\$scope\d+\) => \(e\) => \$scope\d+\.canvasEvents\.push\(e\)/);
    });

    it('rewrites scoped bindings inside sibling function declarations', () => {
      const result = transpile(`function initUI() {
  let canvasEvents = [];
  function processEvents() {
    for (const e of canvasEvents) {
      console.log(e);
    }
    canvasEvents = [];
  }
  processEvents();
}`);
      expect(result).toContain('for (const e of $scope');
      expect(result).toMatch(/\$scope\d+\.canvasEvents = \$arr\(\[\]\)/);
    });

    it('leaves injected console bare inside scoped nested functions', () => {
      expect(
        transpile(`function initUI() {
  let canvasEvents = [];
  function processEvents() {
    for (const e of canvasEvents) {
      switch (e.type) {
        default:
          console.error('unsupported event type', e.type);
      }
    }
    canvasEvents = [];
  }
  console.log('initUI loaded');
}`),
      ).toContain("console.error('unsupported event type', e.type)");
      expect(
        transpile(`function initUI() {
  let canvasEvents = [];
  function processEvents() {
    for (const e of canvasEvents) {
      switch (e.type) {
        default:
          console.error('unsupported event type', e.type);
      }
    }
    canvasEvents = [];
  }
  console.log('initUI loaded');
}`),
      ).toContain("console.log('initUI loaded')");
      expect(
        transpile(`function initUI() {
  let canvasEvents = [];
  function processEvents() {
    for (const e of canvasEvents) {
      switch (e.type) {
        default:
          console.error('unsupported event type', e.type);
      }
    }
    canvasEvents = [];
  }
  console.log('initUI loaded');
}`),
      ).not.toMatch(/\$scope\d+\.console/);
    });

    it('rewrites world refs in for-of iterable expressions', () => {
      expect(
        transpile(`for (const [k, v] of Object.entries(Pt)) {
  console.log(k, v);
}`),
      ).toContain('Object.entries($global.Pt)');
    });
  });
});
