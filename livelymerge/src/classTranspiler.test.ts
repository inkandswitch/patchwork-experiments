import { describe, expect, it } from 'vitest';
import { transpile } from './transpiler';

function funCodes(result: string): string[] {
  return [...result.matchAll(/\$fun\("(?:\\.|[^"\\])*"\s*,\s*"((?:\\.|[^"\\])*)"/g)].map((m) =>
    JSON.parse(`"${m[1]}"`),
  );
}

describe('class transpilation', () => {
  it('transpiles a basic class with instance fields and methods', () => {
    const result = transpile(`class Point {
  x = 0;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(p) { return this.x + p.x; }
}`);
    expect(result).toMatch(/\$global\.Point = \$fun\(/);
    expect(result).toMatch(/\$global\.Point\['@add'\] = \$fun\(/);
    expect(result).toContain(
      "$global.Point.prototype = $obj({ '@className': 'Point', '@add': $global.Point['@add'] });",
    );
    expect(result).toContain("this['@x'] = 0");
  });

  it('transpiles instance toString with @-prefixed method names', () => {
    const result = transpile(`class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}`);
    expect(result).toMatch(/\$global\.Point\['@toString'\] = \$fun\(/);
    expect(result).toContain(
      "$global.Point.prototype = $obj({ '@className': 'Point', '@toString': $global.Point['@toString'] });",
    );
    expect(result).not.toContain("$global.Point.toString =");
    expect(result).toContain("this['@x'] = x");
    expect(result).toContain("this['@y'] = y");
  });

  it('transpiles extends, super(), and super sends', () => {
    const source = `class C extends D {
  constructor() { super(1); }
  m() { super.m(2); }
  static n() { super.n(3); }
}`;
    const result = transpile(source);
    const funStrings = [...result.matchAll(/\$fun\("((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g)].map((m) => ({
      show: JSON.parse(`"${m[1]}"`),
      code: JSON.parse(`"${m[2]}"`),
    }));
    const ctor = funStrings[0]!;
    expect(ctor.show).toBe(source);
    expect(ctor.code).not.toMatch(/\bsuper\s*\(/);
    expect(ctor.code).toContain('$global.D.call(this, 1)');
    expect(result).toMatch(/\$global\.C = \$fun\(/);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\s*\(/);
    }
    expect(result).toContain('$global.D.call(this, 1)');
    expect(result).toContain('$global.D.m.call(this, 2)');
    expect(result).toContain('$global.D.n(3)');
    expect(result).toContain("$obj({ '@className': 'C', '@m': $global.C['@m'] }, $global.D.prototype)");
  });

  it('rewrites bare super() in constructor', () => {
    const source = `class C extends D {
  constructor() { super(); }
}`;
    const result = transpile(source);
    expect(result).toContain('$global.D.call(this)');
    const funStrings = [...result.matchAll(/\$fun\("((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g)].map((m) => ({
      show: JSON.parse(`"${m[1]}"`),
      code: JSON.parse(`"${m[2]}"`),
    }));
    expect(funStrings[0]!.show).toBe(source);
    expect(funStrings[0]!.code).toContain('$global.D.call(this)');
  });

  it('rewrites super(...args) in constructor', () => {
    const result = transpile(`class C extends D {
  constructor(...args) { super(...args); }
}`);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\s*\(/);
    }
    expect(result).toContain('$global.D.call(this, ...args)');
  });

  it('rewrites super in derived class with only instance fields', () => {
    const result = transpile(`class C extends D {
  x = 1;
}`);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\s*\(/);
    }
    expect(result).toContain('$global.D.call(this, ...args)');
  });

  it('rewrites super when extends is a member expression', () => {
    const result = transpile(`class Child extends globalThis.Parent {
  constructor() { super(); }
}`);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\s*\(/);
    }
    expect(result).toContain('$global.globalThis.Parent.call(this)');
  });

  it('injects instance fields after qualified super call', () => {
    const result = transpile(`class Child extends globalThis.Parent {
  x = 1;
  constructor() { super(); }
}`);
    const code = JSON.parse(`"${result.match(/\$fun\("(?:\\.|[^"\\])*"\s*,\s*"((?:\\.|[^"\\])*)"/)![1]}"`);
    expect(code.indexOf('$global.globalThis.Parent.call(this)')).toBeLessThan(code.indexOf("this['@x'] = 1"));
  });

  it('rewrites super() to Object when class has no explicit extends', () => {
    const result = transpile(`class C {}
class D {
  constructor() {
    super();
  }
}`);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\b/);
    }
    expect(result).toContain('Object.call(this)');
  });

  it('uses $obj({}) for implicit Object prototype without Object.prototype', () => {
    const result = transpile(`class C {}`);
    expect(result).toContain('$global.C = $fun(');
    expect(result).toContain("$global.C.prototype = $obj({ '@className': 'C' });");
    expect(result).not.toContain('Object.prototype');
  });

  it('does not auto-call Object in default constructor for base class with only fields', () => {
    const result = transpile(`class C {
  x = 1;
}`);
    expect(result).not.toContain('Object.call(this');
    expect(result).toContain("this['@x'] = 1");
    expect(result).not.toContain('Object.prototype');
  });

  it('rewrites super in two-class example with extends', () => {
    const result = transpile(`class C {}
class D extends C {
  constructor() {
    super();
  }
}`);
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\b/);
    }
    expect(result).toContain('$global.C.call(this)');
  });

  it('rewrites super to parent class for extends C', () => {
    const result = transpile(`class C {
  constructor() {}
}
class D extends C {
  constructor() {
    super();
  }
}`);
    expect(result).toContain('$global.C.call(this)');
    for (const code of funCodes(result)) {
      expect(code).not.toMatch(/\bsuper\b/);
    }
  });

  it('does not treat super in comments as a bare super call', () => {
    const result = transpile(`class C {
  constructor(str, i1) {
    // Dan's super bracket matching feature
    if (!str) return i1;
  }
}`);
    expect(result).toMatch(/\$global\.C = \$fun\(/);
  });

  it('transpiles static blocks and static fields', () => {
    const result = transpile(`class C {
  static x = 1;
  static { this.x = 2; }
  static y = 3;
}`);
    expect(result).toContain('$global.C.x = 1');
    expect(result).toContain('$global.C.x = 2');
    expect(result).toContain('$global.C.y = 3');
  });

  it('preserves original this.x in $codeForShow for instance methods', () => {
    const result = transpile(`class Pt {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  m() {
    return this.x + this.y;
  }
}`);
    const funStrings = [...result.matchAll(/\$fun\("((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g)].map((m) => ({
      show: JSON.parse(`"${m[1]}"`),
      code: JSON.parse(`"${m[2]}"`),
    }));
    const method = funStrings.find((f) => f.show.includes('function m()'))!;
    expect(method.show).toContain('return this.x + this.y');
    expect(method.show).not.toContain("this['@x']");
    expect(method.code).toContain("this['@x']");
  });

  it('stores full class source in constructor $codeForShow', () => {
    const source = `class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(p) { return this.x + p.x; }
}`;
    const result = transpile(source);
    const funStrings = [...result.matchAll(/\$fun\("((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"/g)].map((m) => ({
      show: JSON.parse(`"${m[1]}"`),
      code: JSON.parse(`"${m[2]}"`),
    }));
    const ctor = funStrings[0]!;
    expect(ctor.show).toBe(source);
    expect(ctor.code).toContain("this['@x'] = x");
  });
});
