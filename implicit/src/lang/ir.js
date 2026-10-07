// The intermediate representation: a flat list of scalar instructions (SSA).
//
// Register i holds the result of instruction i. Registers 0, 1 and 2 are the
// sample point's x, y and z. Every other instruction is a constant or one of
// the fixed operations below, taking at most two earlier registers. Both
// backends (the JS evaluator and the GLSL generator) are written against this
// table only — nothing from the user's text is ever run or spliced into code;
// user numbers reach GLSL as formatted float literals and user names never
// reach it at all.
//
// The builder hash-conses (identical instructions are shared, so a let-binding
// used twice at the same point is computed once), folds constants, and applies
// a few identities (x+0, x*1, --x, min(x,x)…).

import { ImplicitError } from "./errors.js";

/** name -> { arity, fold(a, b) } — fold is the reference semantics, shared by constant folding and the JS evaluator. */
export const OPS = {
  x: { arity: 0 },
  y: { arity: 0 },
  z: { arity: 0 },
  const: { arity: 0 },
  add: { arity: 2, commutative: true, fold: (a, b) => a + b },
  sub: { arity: 2, fold: (a, b) => a - b },
  mul: { arity: 2, commutative: true, fold: (a, b) => a * b },
  div: { arity: 2, fold: (a, b) => a / b },
  neg: { arity: 1, fold: (a) => -a },
  abs: { arity: 1, fold: Math.abs },
  // min/max ignore a NaN operand (IEEE minNum/maxNum), so they really are
  // commutative; the GLSL backend does the same (isf_min/isf_max)
  min: { arity: 2, commutative: true, fold: (a, b) => (a < b || b !== b ? a : b) },
  max: { arity: 2, commutative: true, fold: (a, b) => (a > b || b !== b ? a : b) },
  sqrt: { arity: 1, fold: Math.sqrt },
  sin: { arity: 1, fold: Math.sin },
  cos: { arity: 1, fold: Math.cos },
  tan: { arity: 1, fold: Math.tan },
  asin: { arity: 1, fold: Math.asin },
  acos: { arity: 1, fold: Math.acos },
  atan: { arity: 1, fold: Math.atan },
  atan2: { arity: 2, fold: Math.atan2 },
  pow: { arity: 2, fold: Math.pow },
  exp: { arity: 1, fold: Math.exp },
  log: { arity: 1, fold: Math.log },
  floor: { arity: 1, fold: Math.floor },
  ceil: { arity: 1, fold: Math.ceil },
  fract: { arity: 1, fold: (a) => a - Math.floor(a) },
  // GLSL's mod: x - y * floor(x / y) (sign follows y), not JS's %
  mod: { arity: 2, fold: (a, b) => a - b * Math.floor(a / b) },
  sign: { arity: 1, fold: (a) => (a > 0 ? 1 : a < 0 ? -1 : 0) },
  // GLSL's step(edge, x): 0 when x < edge, else 1
  step: { arity: 2, fold: (e, x) => (x < e ? 0 : 1) },
};

export const OP_NAMES = Object.keys(OPS);
export const OPCODE = Object.fromEntries(OP_NAMES.map((n, i) => [n, i]));

export const DEFAULT_MAX_INSTRUCTIONS = 8000;

export class Builder {
  constructor({ maxInstructions = DEFAULT_MAX_INSTRUCTIONS } = {}) {
    this.op = []; // op name per register
    this.a = [];
    this.b = [];
    this.k = []; // constant value (for "const")
    this.memo = new Map();
    this.maxInstructions = maxInstructions;
    this.at = null; // AST node being lowered, for "too complex" errors
    this.nonFinite = new Map(); // register -> AST node, for constants that are NaN or ±Infinity
    this.X = this.#push("x", -1, -1, 0);
    this.Y = this.#push("y", -1, -1, 0);
    this.Z = this.#push("z", -1, -1, 0);
  }

  #push(op, a, b, k) {
    if (this.op.length >= this.maxInstructions) {
      const at = this.at ?? { start: 0, end: 1 };
      throw new ImplicitError(
        `This shape is too complex: it needs more than ${this.maxInstructions} operations. Simplify it, or reuse fewer copies of big definitions.`,
        at.start,
        at.end,
      );
    }
    this.op.push(op);
    this.a.push(a);
    this.b.push(b);
    this.k.push(k);
    return this.op.length - 1;
  }

  isConst(r) {
    return this.op[r] === "const";
  }
  constValue(r) {
    return this.op[r] === "const" ? this.k[r] : undefined;
  }

  const(v) {
    const value = Object.is(v, -0) ? 0 : v;
    const key = `k:${Number.isNaN(value) ? "NaN" : value}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const r = this.#push("const", -1, -1, value);
    this.memo.set(key, r);
    if (!Number.isFinite(value)) this.nonFinite.set(r, this.at);
    return r;
  }

  /** Emit (or reuse, or fold) an instruction. */
  emit(op, a = -1, b = -1) {
    const spec = OPS[op];
    if (!spec || !spec.fold) throw new Error(`ir: unknown op ${op}`);
    if (spec.arity === 1) b = -1;
    // constant folding
    const ka = this.constValue(a);
    const kb = spec.arity === 2 ? this.constValue(b) : 0;
    if (ka !== undefined && kb !== undefined) return this.const(spec.fold(ka, kb));
    // identities
    switch (op) {
      case "add":
        if (ka === 0) return b;
        if (kb === 0) return a;
        break;
      case "sub":
        if (kb === 0) return a;
        if (ka === 0) return this.emit("neg", b);
        if (a === b) return this.const(0);
        break;
      case "mul":
        if (ka === 1) return b;
        if (kb === 1) return a;
        if (ka === -1) return this.emit("neg", b);
        if (kb === -1) return this.emit("neg", a);
        break;
      case "div":
        if (kb === 1) return a;
        break;
      case "neg":
        if (this.op[a] === "neg") return this.a[a];
        break;
      case "abs":
        if (this.op[a] === "abs") return a;
        if (this.op[a] === "neg") return this.emit("abs", this.a[a]);
        break;
      case "min":
      case "max":
        if (a === b) return a;
        break;
    }
    if (spec.commutative && b < a) [a, b] = [b, a];
    const key = `${op}:${a}:${b}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const r = this.#push(op, a, b, 0);
    this.memo.set(key, r);
    return r;
  }

  // convenience
  add(a, b) {
    return this.emit("add", a, b);
  }
  sub(a, b) {
    return this.emit("sub", a, b);
  }
  mul(a, b) {
    return this.emit("mul", a, b);
  }
  div(a, b) {
    return this.emit("div", a, b);
  }
  neg(a) {
    return this.emit("neg", a);
  }
  min(a, b) {
    return this.emit("min", a, b);
  }
  max(a, b) {
    return this.emit("max", a, b);
  }
  abs(a) {
    return this.emit("abs", a);
  }
  sqrt(a) {
    return this.emit("sqrt", a);
  }
  sq(a) {
    return this.emit("mul", a, a);
  }
  len2(a, b) {
    return this.sqrt(this.add(this.sq(a), this.sq(b)));
  }
  len3(a, b, c) {
    return this.sqrt(this.add(this.add(this.sq(a), this.sq(b)), this.sq(c)));
  }
  clamp(v, lo, hi) {
    return this.min(this.max(v, lo), hi);
  }

  /** Freeze into typed arrays, keeping only what `result` needs, renumbered in order. */
  finish(result) {
    const n = this.op.length;
    const live = new Uint8Array(n);
    live[0] = live[1] = live[2] = 1; // x, y, z always stay at 0, 1, 2
    live[result] = 1;
    for (let r = n - 1; r >= 0; r--) {
      if (!live[r]) continue;
      if (this.a[r] >= 0) live[this.a[r]] = 1;
      if (this.b[r] >= 0) live[this.b[r]] = 1;
    }
    // a live constant that is NaN or infinite would mean different things to
    // the two backends (GLSL has no such literals), so it is a compile error
    for (const [r, node] of this.nonFinite) {
      if (!live[r]) continue;
      const at = node ?? { start: 0, end: 1 };
      throw new ImplicitError(
        Number.isNaN(this.k[r])
          ? "This works out to NaN (not a number) everywhere, so the shape can't be drawn. Look for sqrt or log of a negative number, or asin/acos outside -1 to 1."
          : "This works out to infinity everywhere, so the shape can't be drawn. Look for a division by zero or a number that is too big.",
        at.start,
        at.end,
      );
    }
    const remap = new Int32Array(n).fill(-1);
    let m = 0;
    for (let r = 0; r < n; r++) if (live[r]) remap[r] = m++;
    const op = new Uint8Array(m);
    const a = new Int32Array(m);
    const b = new Int32Array(m);
    const k = new Float64Array(m);
    for (let r = 0; r < n; r++) {
      if (!live[r]) continue;
      const i = remap[r];
      op[i] = OPCODE[this.op[r]];
      a[i] = this.a[r] >= 0 ? remap[this.a[r]] : -1;
      b[i] = this.b[r] >= 0 ? remap[this.b[r]] : -1;
      k[i] = this.k[r];
    }
    return { count: m, op, a, b, k, result: remap[result] };
  }
}

/** Human-readable dump, for tests and debugging. */
export function formatIR(ir) {
  const lines = [];
  for (let i = 0; i < ir.count; i++) {
    const name = OP_NAMES[ir.op[i]];
    if (name === "const") lines.push(`r${i} = ${ir.k[i]}`);
    else if (OPS[name].arity === 0) lines.push(`r${i} = ${name}`);
    else if (OPS[name].arity === 1) lines.push(`r${i} = ${name}(r${ir.a[i]})`);
    else lines.push(`r${i} = ${name}(r${ir.a[i]}, r${ir.b[i]})`);
  }
  lines.push(`return r${ir.result}`);
  return lines.join("\n");
}
