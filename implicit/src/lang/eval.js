// JS backend: an interpreter over the trusted IR (never over user text).
//
//   const f = makeEvaluator(ir)
//   f.at(x, y, z)                   one sample
//   f.batch(xs, ys, zs, out, n)     n samples, a chunk at a time — each IR
//                                   instruction runs as one tight typed-array
//                                   loop, which is several times faster than
//                                   walking the instruction list per point.

import { OPCODE } from "./ir.js";

const {
  const: CONST,
  add: ADD,
  sub: SUB,
  mul: MUL,
  div: DIV,
  neg: NEG,
  abs: ABS,
  min: MIN,
  max: MAX,
  sqrt: SQRT,
  sin: SIN,
  cos: COS,
  tan: TAN,
  asin: ASIN,
  acos: ACOS,
  atan: ATAN,
  atan2: ATAN2,
  pow: POW,
  exp: EXP,
  log: LOG,
  floor: FLOOR,
  ceil: CEIL,
  fract: FRACT,
  mod: MOD,
  sign: SIGN,
  step: STEP,
} = OPCODE;

// one kernel per op: (regs, dst, a, b, n) with dst/a/b as offsets into regs
const K1 = (f) => (R, d, a, _b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = f(R[a + j]);
};
const KERNELS = [];
KERNELS[ADD] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = R[a + j] + R[b + j];
};
KERNELS[SUB] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = R[a + j] - R[b + j];
};
KERNELS[MUL] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = R[a + j] * R[b + j];
};
KERNELS[DIV] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = R[a + j] / R[b + j];
};
KERNELS[NEG] = (R, d, a, _b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = -R[a + j];
};
KERNELS[ABS] = (R, d, a, _b, n) => {
  for (let j = 0; j < n; j++) {
    const v = R[a + j];
    R[d + j] = v < 0 ? -v : v;
  }
};
// min/max ignore a NaN operand (IEEE minNum/maxNum): min(NaN, v) = min(v, NaN) = v.
// The fold in ir.js and isf_min/isf_max in glsl.js follow the same rule.
KERNELS[MIN] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) {
    const u = R[a + j];
    const v = R[b + j];
    R[d + j] = u < v || v !== v ? u : v;
  }
};
KERNELS[MAX] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) {
    const u = R[a + j];
    const v = R[b + j];
    R[d + j] = u > v || v !== v ? u : v;
  }
};
KERNELS[SQRT] = K1(Math.sqrt);
KERNELS[SIN] = K1(Math.sin);
KERNELS[COS] = K1(Math.cos);
KERNELS[TAN] = K1(Math.tan);
KERNELS[ASIN] = K1(Math.asin);
KERNELS[ACOS] = K1(Math.acos);
KERNELS[ATAN] = K1(Math.atan);
KERNELS[ATAN2] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = Math.atan2(R[a + j], R[b + j]);
};
KERNELS[POW] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = Math.pow(R[a + j], R[b + j]);
};
KERNELS[EXP] = K1(Math.exp);
KERNELS[LOG] = K1(Math.log);
KERNELS[FLOOR] = K1(Math.floor);
KERNELS[CEIL] = K1(Math.ceil);
KERNELS[FRACT] = (R, d, a, _b, n) => {
  for (let j = 0; j < n; j++) {
    const v = R[a + j];
    R[d + j] = v - Math.floor(v);
  }
};
KERNELS[MOD] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) {
    const u = R[a + j];
    const v = R[b + j];
    R[d + j] = u - v * Math.floor(u / v);
  }
};
KERNELS[SIGN] = (R, d, a, _b, n) => {
  for (let j = 0; j < n; j++) {
    const v = R[a + j];
    R[d + j] = v > 0 ? 1 : v < 0 ? -1 : 0;
  }
};
KERNELS[STEP] = (R, d, a, b, n) => {
  for (let j = 0; j < n; j++) R[d + j] = R[b + j] < R[a + j] ? 0 : 1;
};

/** @param {{ count: number, op: Uint8Array, a: Int32Array, b: Int32Array, k: Float64Array, result: number }} ir */
export function makeEvaluator(ir) {
  const { count, op, a, b, k, result } = ir;
  const regs = new Float64Array(count);
  for (let i = 0; i < count; i++) if (op[i] === CONST) regs[i] = k[i];

  function at(x, y, z) {
    const R = regs;
    R[0] = x;
    R[1] = y;
    R[2] = z;
    for (let i = 3; i < count; i++) {
      const u = R[a[i]];
      switch (op[i]) {
        case CONST:
          break;
        case ADD:
          R[i] = u + R[b[i]];
          break;
        case SUB:
          R[i] = u - R[b[i]];
          break;
        case MUL:
          R[i] = u * R[b[i]];
          break;
        case DIV:
          R[i] = u / R[b[i]];
          break;
        case NEG:
          R[i] = -u;
          break;
        case ABS:
          R[i] = u < 0 ? -u : u;
          break;
        case MIN: {
          const v = R[b[i]];
          R[i] = u < v || v !== v ? u : v;
          break;
        }
        case MAX: {
          const v = R[b[i]];
          R[i] = u > v || v !== v ? u : v;
          break;
        }
        case SQRT:
          R[i] = Math.sqrt(u);
          break;
        case SIN:
          R[i] = Math.sin(u);
          break;
        case COS:
          R[i] = Math.cos(u);
          break;
        case TAN:
          R[i] = Math.tan(u);
          break;
        case ASIN:
          R[i] = Math.asin(u);
          break;
        case ACOS:
          R[i] = Math.acos(u);
          break;
        case ATAN:
          R[i] = Math.atan(u);
          break;
        case ATAN2:
          R[i] = Math.atan2(u, R[b[i]]);
          break;
        case POW:
          R[i] = Math.pow(u, R[b[i]]);
          break;
        case EXP:
          R[i] = Math.exp(u);
          break;
        case LOG:
          R[i] = Math.log(u);
          break;
        case FLOOR:
          R[i] = Math.floor(u);
          break;
        case CEIL:
          R[i] = Math.ceil(u);
          break;
        case FRACT:
          R[i] = u - Math.floor(u);
          break;
        case MOD: {
          const v = R[b[i]];
          R[i] = u - v * Math.floor(u / v);
          break;
        }
        case SIGN:
          R[i] = u > 0 ? 1 : u < 0 ? -1 : 0;
          break;
        case STEP:
          R[i] = R[b[i]] < u ? 0 : 1;
          break;
      }
    }
    return R[result];
  }

  // batch evaluation: registers laid out as count × CH doubles
  const CH = Math.max(16, Math.min(1024, Math.floor(262144 / Math.max(count, 1))));
  let bregs = null;
  function batch(xs, ys, zs, out, n = out.length) {
    if (!bregs) {
      bregs = new Float64Array(count * CH);
      for (let i = 0; i < count; i++) if (op[i] === CONST) bregs.fill(k[i], i * CH, i * CH + CH);
    }
    const R = bregs;
    const zConst = typeof zs === "number";
    for (let base = 0; base < n; base += CH) {
      const m = Math.min(CH, n - base);
      for (let j = 0; j < m; j++) {
        R[j] = xs[base + j];
        R[CH + j] = ys[base + j];
        R[2 * CH + j] = zConst ? zs : zs[base + j];
      }
      for (let i = 3; i < count; i++) {
        const o = op[i];
        if (o === CONST) continue;
        KERNELS[o](R, i * CH, a[i] * CH, b[i] * CH, m);
      }
      const off = result * CH;
      for (let j = 0; j < m; j++) out[base + j] = R[off + j];
    }
    return out;
  }

  return { at, batch, count };
}
