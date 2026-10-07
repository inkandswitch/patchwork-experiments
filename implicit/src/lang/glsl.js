// GLSL backend: IR -> a GLSL ES 3.00 function `float <name>(vec3 p)`.
//
// The output is assembled only from fixed op templates, register numbers and
// float literals formatted here, so no text from the source document can reach
// the shader. (Names, comments and anything else the user typed stop at the
// parser.)

import { OP_NAMES } from "./ir.js";

/** A finite, always-valid GLSL float literal. (compile() rejects live NaN/infinite constants, so the fallbacks here are only a backstop.) */
export function glslFloat(v) {
  if (Number.isNaN(v)) return "0.0";
  if (!Number.isFinite(v)) return v > 0 ? "1e30" : "(-1e30)";
  // clamp to what a 32-bit float can hold so the literal never overflows
  if (Math.abs(v) > 1e30) v = Math.sign(v) * 1e30;
  if (v !== 0 && Math.abs(v) < 1e-30) v = 0;
  let s = String(v);
  if (!/[.e]/.test(s)) s += ".0";
  s = s.replace(/^(-?\d+)e/, "$1.0e");
  return v < 0 ? `(${s})` : s;
}

/** Helper functions the generated code may call. */
export const GLSL_HELPERS = `
float isf_pow(float a, float b) {
  if (a >= 0.0) return pow(a, b);
  // negative base: defined only for whole exponents, like JS Math.pow
  if (fract(b) != 0.0) return intBitsToFloat(0x7fc00000);
  float m = pow(-a, b);
  return mod(b, 2.0) == 0.0 ? m : -m;
}
float isf_sign(float a) { return a > 0.0 ? 1.0 : (a < 0.0 ? -1.0 : 0.0); }
// min/max that ignore a NaN operand, like the JS evaluator (GLSL leaves it undefined)
float isf_min(float a, float b) { return isnan(a) ? b : (isnan(b) ? a : min(a, b)); }
float isf_max(float a, float b) { return isnan(a) ? b : (isnan(b) ? a : max(a, b)); }
`;

const TEMPLATES = {
  add: (a, b) => `${a} + ${b}`,
  sub: (a, b) => `${a} - ${b}`,
  mul: (a, b) => `${a} * ${b}`,
  div: (a, b) => `${a} / ${b}`,
  neg: (a) => `-${a}`,
  abs: (a) => `abs(${a})`,
  min: (a, b) => `isf_min(${a}, ${b})`,
  max: (a, b) => `isf_max(${a}, ${b})`,
  sqrt: (a) => `sqrt(${a})`,
  sin: (a) => `sin(${a})`,
  cos: (a) => `cos(${a})`,
  tan: (a) => `tan(${a})`,
  asin: (a) => `asin(${a})`,
  acos: (a) => `acos(${a})`,
  atan: (a) => `atan(${a})`,
  atan2: (a, b) => `atan(${a}, ${b})`,
  pow: (a, b) => `isf_pow(${a}, ${b})`,
  exp: (a) => `exp(${a})`,
  log: (a) => `log(${a})`,
  floor: (a) => `floor(${a})`,
  ceil: (a) => `ceil(${a})`,
  fract: (a) => `fract(${a})`,
  mod: (a, b) => `mod(${a}, ${b})`,
  sign: (a) => `isf_sign(${a})`,
  step: (a, b) => `step(${a}, ${b})`,
};

/**
 * @param {{ count: number, op: Uint8Array, a: Int32Array, b: Int32Array, k: Float64Array, result: number }} ir
 * @param {string} [fnName]  must be a plain identifier chosen by the caller (not the user)
 * @returns {string}
 */
export function toGLSL(ir, fnName = "isf_user") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fnName)) throw new Error("glsl: bad function name");
  const ref = (r) => {
    const name = OP_NAMES[ir.op[r]];
    if (name === "x") return "p.x";
    if (name === "y") return "p.y";
    if (name === "z") return "p.z";
    if (name === "const") return glslFloat(ir.k[r]);
    return `r${r}`;
  };
  const lines = [`float ${fnName}(vec3 p) {`];
  for (let i = 3; i < ir.count; i++) {
    const name = OP_NAMES[ir.op[i]];
    if (name === "const") continue;
    const t = TEMPLATES[name];
    if (!t) throw new Error(`glsl: no template for ${name}`);
    lines.push(`  float r${i} = ${t(ref(ir.a[i]), ir.b[i] >= 0 ? ref(ir.b[i]) : "")};`);
  }
  lines.push(`  return ${ref(ir.result)};`, "}");
  return lines.join("\n");
}
