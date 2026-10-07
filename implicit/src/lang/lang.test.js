import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compile, tryCompile, tokenize, parse, makeEvaluator, toGLSL, glslFloat, BUILTINS } from "./index.js";

const f = (src) => makeEvaluator(compile(src).ir);
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const err = (src) => {
  const r = tryCompile(src);
  expect(r.ok).toBe(false);
  return r.error;
};

describe("tokenize", () => {
  it("reads numbers with units into metres and radians", () => {
    const t = tokenize("5mm 2.5cm 1in .5 1e-3 30deg 2m");
    expect(t.slice(0, -1).map((x) => x.value)).toEqual([0.005, 0.025, 0.0254, 0.5, 0.001, Math.PI / 6, 2]);
  });
  it("tracks line breaks before tokens and skips comments", () => {
    const t = tokenize("a // hi\n/* x\n y */ b");
    expect(t.map((x) => [x.type, x.value, x.nl])).toEqual([
      ["ident", "a", true],
      ["ident", "b", true],
      ["eof", null, true],
    ]);
  });
  it("emits comment tokens on request and never throws when lenient", () => {
    const t = tokenize("a # b // c", { comments: true, lenient: true });
    expect(t.map((x) => x.type)).toEqual(["ident", "error", "ident", "comment", "eof"]);
  });
  it("rejects unknown units and stray characters with positions", () => {
    expect(() => tokenize("3 + 5foo")).toThrow(/"foo" is not a unit/);
    const e = err("sphere(1) {");
    expect(e.message).toMatch(/Unexpected character "\{"/);
    expect([e.line, e.col]).toEqual([1, 11]);
  });
});

describe("parse", () => {
  it("respects precedence and right-associative power", () => {
    close(f("1 + 2 * 3 - 4 / 2").at(0, 0, 0), 5);
    close(f("2 ^ 3 ^ 2").at(0, 0, 0), 512);
    close(f("-2 ^ 2").at(0, 0, 0), -4);
    close(f("(1 + 2) * 3").at(0, 0, 0), 9);
  });
  it("ends a let at a newline or semicolon, and continues lines that start with an operator", () => {
    close(f("let a = 1\nlet b = 2; a + b").at(0, 0, 0), 3);
    close(f("let a = 1\n  + 2\na").at(0, 0, 0), 3);
    expect(err("let a = 1 2").message).toMatch(/End a let with ";" or a new line/);
  });
  it("records spans", () => {
    const p = parse("let r = 0.1\nsphere(r)");
    expect(p.bindings[0]).toMatchObject({ name: "r", nameStart: 4, nameEnd: 5 });
    expect(p.result).toMatchObject({ kind: "call", name: "sphere", start: 12, end: 21 });
  });
  it("gives friendly errors", () => {
    expect(err("sphere(1").message).toMatch(/never closed/);
    expect(err("sphere(1) box(1,1,1)").message).toMatch(/Only one final shape/);
    expect(err("sphere(1)\nlet a = 2").message).toMatch(/"let" must come before the final shape/);
    expect(err("").message).toMatch(/Nothing to draw yet/);
    expect(err("let = 3").message).toMatch(/After "let" comes a name/);
    expect(err("((((".repeat(80) + "1").message).toMatch(/nested too deeply|never closed/);
  });
});

describe("check", () => {
  it("suggests close names", () => {
    const e = err("sphre(1)");
    expect(e.message).toBe('Unknown function "sphre". Did you mean sphere(…)?');
    expect([e.start, e.end]).toEqual([0, 5]);
    expect(err("let radius = 1\nsphere(radis)").message).toMatch(/Did you mean "radius"/);
  });
  it("checks argument counts", () => {
    expect(err("box(1, 2)").message).toBe("box(sx, sy, sz) takes 3 arguments but got 2.");
    expect(err("union()").message).toMatch(/at least 1 argument/);
    expect(err("scale(1, 2, sphere(1))").message).toMatch(/2 arguments \(f, shape\) or 4/);
    expect(err("let f(a, b) = a + b\nf(1)").message).toMatch(/f\(a, b\) takes 2 arguments but got 1/);
  });
  it("catches misuse of names", () => {
    expect(err("let x = 1\nx").message).toMatch(/sample point's x coordinate/);
    expect(err("let sphere = 1\nsphere").message).toMatch(/built-in function/);
    expect(err("let a = 1\nlet a = 2\na").message).toMatch(/already defined/);
    expect(err("let r = 1\nr(2)").message).toMatch(/is a number, not a function/);
    expect(err("sphere").message).toMatch(/call it like sphere\(r\)/);
    expect(err("x(2)").message).toMatch(/coordinate, not a function/);
  });
  it("checks definitions even when they are unused", () => {
    expect(err("let a = nope(1)\nsphere(1)").message).toMatch(/Unknown function "nope"/);
  });
  it("warns about unused definitions", () => {
    const { warnings } = compile("let a = 1\nsphere(1)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ message: '"a" is defined but never used.', line: 1, col: 5 });
  });
  it("reports line and column", () => {
    const e = err("let a = 1\n\nsphere(a) + boks(1)");
    expect([e.line, e.col]).toEqual([3, 13]);
  });
});

describe("evaluation", () => {
  it("computes primitive distances", () => {
    close(f("sphere(0.5)").at(1, 0, 0), 0.5);
    close(f("sphere(0.5)").at(0, 0, 0), -0.5);
    close(f("box(2, 2, 2)").at(3, 0, 0), 2);
    close(f("box(2, 2, 2)").at(2, 2, 1), Math.SQRT2);
    close(f("box(2, 2, 2)").at(0.5, 0, 0), -0.5);
    close(f("roundBox(2, 2, 2, 0.5)").at(2, 0, 0), 1);
    close(f("torus(1, 0.25)").at(1, 0, 0), -0.25);
    close(f("torus(1, 0.25)").at(0, 1, 0), Math.SQRT2 - 0.25);
    close(f("cylinder(1, 2)").at(0, 3, 0), 2);
    close(f("cylinder(1, 2)").at(3, 0, 0), 2);
    close(f("capsule(0.5, 2)").at(0, 3, 0), 1.5);
    close(f("segment(0,0,0, 1,0,0, 0.1)").at(0.5, 1, 0), 0.9);
    close(f("plane(0, 2, 0, 1)").at(5, 3, 1), 2);
    close(f("ellipsoid(1, 1, 1)").at(2, 0, 0), 1);
    close(f("shell(0.1, sphere(1))").at(1, 0, 0), -0.05);
    close(f("offset(0.2, sphere(1))").at(2, 0, 0), 0.8);
  });
  it("combines shapes", () => {
    const u = f("union(sphere(1), translate(3, 0, 0, sphere(1)))");
    close(u.at(3, 0, 0), -1);
    close(u.at(1.5, 0, 0), 0.5);
    close(f("intersect(sphere(1), box(1,1,1))").at(0, 0, 0), -0.5);
    close(f("subtract(sphere(1), sphere(0.5))").at(0, 0, 0), 0.5);
    // smooth union dips below the plain union between the two shapes
    const s = f("smoothUnion(0.5, translate(-1,0,0, sphere(0.8)), translate(1,0,0, sphere(0.8)))");
    expect(s.at(0, 0, 0)).toBeLessThan(0.2);
    close(f("smoothUnion(0.5, sphere(1))").at(2, 0, 0), 1);
  });
  it("transforms move and rotate the shape, not the point", () => {
    close(f("translate(1, 2, 3, sphere(0.5))").at(1, 2, 3), -0.5);
    // a box long in X, turned 90° about Y, becomes long in Z
    const r = f("rotateY(90deg, box(2, 0.2, 0.2))");
    expect(r.at(0, 0, 0.9)).toBeLessThan(0);
    expect(r.at(0.9, 0, 0)).toBeGreaterThan(0);
    const rz = f("rotateZ(90deg, translate(1, 0, 0, sphere(0.1)))"); // +X rotates to +Y
    close(rz.at(0, 1, 0), -0.1);
    const rx = f("rotateX(90deg, translate(0, 1, 0, sphere(0.1)))"); // +Y rotates to +Z
    close(rx.at(0, 0, 1), -0.1);
    close(f("scale(2, sphere(1))").at(3, 0, 0), 1);
    close(f("mirrorX(translate(1, 0, 0, sphere(0.1)))").at(-1, 0, 0), -0.1);
    close(f("repeat(1, 0, 0, sphere(0.1))").at(7, 0, 0), -0.1);
    close(f("at(x - 1, y, z, sphere(0.5))").at(1, 0, 0), -0.5);
  });
  it("lets are call-by-name, so a transform moves a bound shape", () => {
    close(f("let s = sphere(0.5)\ntranslate(2, 0, 0, s)").at(2, 0, 0), -0.5);
    close(f("let post(h) = cylinder(0.1, h)\ntranslate(0, 1, 0, post(2))").at(0, 1.9, 0), -0.1);
    close(f("let a = 2\nlet dbl(v) = v * a\ndbl(3)").at(0, 0, 0), 6);
    // a parameter shadows an outer name
    close(f("let v = 100\nlet id(v) = v\nid(3)").at(0, 0, 0), 3);
  });
  it("math matches GLSL conventions", () => {
    close(f("mod(-1, 3)").at(0, 0, 0), 2);
    close(f("fract(-0.25)").at(0, 0, 0), 0.75);
    close(f("step(1, 0.5)").at(0, 0, 0), 0);
    close(f("clamp(5, 0, 1) + mix(0, 10, 0.5) + length(3, 4) + round(2.5)").at(0, 0, 0), 1 + 5 + 5 + 3);
    close(f("atan(1, 1) - pi / 4").at(0, 0, 0), 0);
    close(f("smoothstep(0, 1, 0.5)").at(0, 0, 0), 0.5);
  });
  it("batch evaluation agrees with point evaluation", () => {
    const ev = f("smoothUnion(0.05, gyroid(0.2, 0.01), rotateY(0.3, roundBox(0.3, 0.2, 0.1, 0.02)))");
    const n = 3000;
    const xs = Float64Array.from({ length: n }, (_, i) => Math.sin(i) * 0.3);
    const ys = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 1.3) * 0.3);
    const zs = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) * 0.3);
    const out = new Float64Array(n);
    ev.batch(xs, ys, zs, out, n);
    for (let i = 0; i < n; i += 37) close(out[i], ev.at(xs[i], ys[i], zs[i]), 1e-12);
    ev.batch(xs, ys, 0.1, out, n);
    close(out[5], ev.at(xs[5], ys[5], 0.1), 1e-12);
  });
});

describe("IR", () => {
  it("folds constants and shares repeated work", () => {
    expect(compile("1 + 2 * 3").ir.count).toBe(4); // x, y, z, const
    const one = compile("sphere(1)").ir.count;
    expect(compile("union(sphere(1), sphere(1))").ir.count).toBe(one);
    expect(compile("let s = sphere(1)\nmin(s, s)").ir.count).toBe(one);
    expect(compile("translate(0, 0, 0, sphere(1))").ir.count).toBe(one);
  });
  it("stops programs that blow up with a friendly error", () => {
    let src = "let f0(s) = s\n";
    for (let i = 1; i <= 30; i++) src += `let f${i}(s) = union(translate(0.1, 0, 0, f${i - 1}(s)), translate(0, 0.1, 0, f${i - 1}(s)))\n`;
    src += "f30(sphere(0.1))";
    expect(err(src).message).toMatch(/too complex|too much work/);
  });
});

describe("NaN and infinity", () => {
  it("min and max ignore a NaN operand, in either order", () => {
    const a = f("union(sphere(0.1), sqrt(x) - 1)");
    const b = f("union(sqrt(x) - 1, sphere(0.1))");
    close(a.at(-0.05, 0, 0), -0.05);
    close(b.at(-0.05, 0, 0), -0.05);
    const xs = new Float64Array([-0.05, 0.05]);
    const ys = new Float64Array(2);
    for (const e of [a, b]) {
      const out = e.batch(xs, ys, ys, new Float64Array(2));
      close(out[0], -0.05); // the NaN side keeps the sphere
      close(out[1], Math.sqrt(0.05) - 1);
    }
    close(f("intersect(sphere(0.1), sqrt(x) - 1)").at(-0.05, 0, 0), -0.05);
    close(f("intersect(sqrt(x) - 1, sphere(0.1))").at(-0.05, 0, 0), -0.05);
  });
  it("rejects a constant that works out to NaN or infinity, at the expression", () => {
    const e1 = err("max(sphere(0.1), acos(2))");
    expect(e1.message).toMatch(/NaN/);
    expect(e1.col).toBe(18);
    expect(err("sphere(0.1) + 0*log(-1)").message).toMatch(/NaN/);
    expect(err("sphere(0.1 + asin(1.5))").message).toMatch(/NaN/);
    expect(err("sphere(1/0)").message).toMatch(/infinity/);
    // an unused one is only the usual unused warning
    expect(tryCompile("let a = acos(2)\nsphere(0.1)").ok).toBe(true);
  });
});

describe("GLSL", () => {
  it("formats floats safely", () => {
    expect(glslFloat(1)).toBe("1.0");
    expect(glslFloat(-0.5)).toBe("(-0.5)");
    expect(glslFloat(1e-7)).toBe("1.0e-7");
    expect(glslFloat(Infinity)).toBe("1e30");
    expect(glslFloat(NaN)).toBe("0.0");
  });
  it("uses NaN-ignoring min/max like the JS evaluator", () => {
    const glsl = toGLSL(compile("union(sphere(0.1), box(0.1, 0.1, 0.1))").ir);
    expect(glsl).toMatch(/isf_min\(/);
    expect(glsl).not.toMatch(/[^_]min\(/);
  });
  it("emits a function from the IR only", () => {
    const src = "// evil */ } void main() { discard; }\nlet evil_name = 0.25\nsphere(evil_name)";
    const g = toGLSL(compile(src).ir);
    expect(g).toMatch(/^float isf_user\(vec3 p\) \{/);
    expect(g).not.toMatch(/evil|discard|main/);
    expect(g).toContain("0.25");
    // every line is a float assignment or the return
    for (const line of g.split("\n").slice(1, -1)) expect(line).toMatch(/^ {2}(float r\d+ = [\w.()+\-*/, ]+;|return [\w.()-]+;)$/);
  });
  it("covers every op any builtin can emit", () => {
    const calls = Object.entries(BUILTINS).map(([name, b]) => {
      const n = b === BUILTINS.scale ? 2 : b.arity[0];
      return `${name}(${Array.from({ length: n }, (_, i) => `sphere(${0.1 + i * 0.01}) + x`).join(", ")})`;
    });
    expect(() => toGLSL(compile(`union(${calls.join(",\n")})`).ir)).not.toThrow();
  });
  it("refuses a bad function name from the caller", () => {
    expect(() => toGLSL(compile("x").ir, "a; b")).toThrow();
  });
});

describe("security", () => {
  it("never evaluates text with eval or new Function", () => {
    const dir = join(process.cwd(), "src");
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.js$/.test(e) && !/\.test\.js$/.test(e)) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      // strip comments (which may mention eval) before looking for calls
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/);
    }
  });
  it("treats hostile input as a compile error", () => {
    for (const s of ["alert(1)", "constructor(1)", "__proto__", "globalThis.x", "sphere(1); fetch('x')", "toString(1)"]) {
      expect(tryCompile(s).ok, s).toBe(false);
    }
  });
});
