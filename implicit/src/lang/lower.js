// Checking and lowering: AST -> IR.
//
// check() walks every node (including definitions that are never used) and
// reports the first problem with a position: unknown names, wrong argument
// counts, a number called like a function, and so on.
//
// lower() then turns the program into IR by call-by-name expansion: a name
// bound with `let` stands for its expression, evaluated at whatever point it
// is used at. That is what lets `let s = sphere(1)` be moved by
// `translate(…, s)`. Expansion is memoised per (definition, point) and the IR
// builder shares identical instructions, so reuse is cheap; a step budget
// stops pathological programs with a friendly error instead of a hang.

import { ImplicitError, suggest } from "./errors.js";
import { BUILTINS, CONSTANTS, POINT_NAMES, acceptsArity, arityText, signature } from "./builtins.js";
import { Builder } from "./ir.js";

const MAX_STEPS = 400_000;

const isPoint = (n) => n === "x" || n === "y" || n === "z";
const knownNames = (scope) => [...Object.keys(BUILTINS), ...Object.keys(CONSTANTS), ...POINT_NAMES, ...scope.keys()];

function reservedNameError(name, start, end, what) {
  if (isPoint(name))
    return new ImplicitError(`"${name}" is the sample point's ${name} coordinate and can't be used as a ${what} name.`, start, end);
  if (Object.hasOwn(BUILTINS, name))
    return new ImplicitError(`"${name}" is a built-in function (${signature(name)}); pick another ${what} name.`, start, end);
  if (Object.hasOwn(CONSTANTS, name))
    return new ImplicitError(`"${name}" is a built-in constant; pick another ${what} name.`, start, end);
  return null;
}

/**
 * Check a parsed program. Throws the first ImplicitError; returns warnings.
 * @param {import("./parse.js").Program} program
 * @returns {{ message: string, start: number, end: number }[]}
 */
export function check(program) {
  /** name -> { kind: "value"|"fn"|"param", arity?, used, start, end, params? } */
  const scope = new Map();
  const warnings = [];

  const visit = (node, sc) => {
    switch (node.kind) {
      case "num":
        return;
      case "unary":
        return visit(node.arg, sc);
      case "binary":
        visit(node.left, sc);
        return visit(node.right, sc);
      case "ident": {
        const { name } = node;
        if (isPoint(name) || Object.hasOwn(CONSTANTS, name)) return;
        const entry = sc.get(name);
        if (entry) {
          entry.used = true;
          if (entry.kind === "fn")
            throw new ImplicitError(
              `"${name}" is a function of (${entry.params.join(", ")}) — call it like ${name}(…).`,
              node.start,
              node.end,
            );
          return;
        }
        if (Object.hasOwn(BUILTINS, name))
          throw new ImplicitError(`"${name}" is a function — call it like ${signature(name)}.`, node.start, node.end);
        const guess = suggest(name, knownNames(sc));
        throw new ImplicitError(
          `Unknown name "${name}".${guess ? ` Did you mean "${guess}"?` : " Define it first with let."}`,
          node.start,
          node.end,
        );
      }
      case "call": {
        const { name, args } = node;
        const at = [node.nameStart, node.nameEnd];
        const entry = sc.get(name);
        if (entry) {
          entry.used = true;
          if (entry.kind !== "fn")
            throw new ImplicitError(`"${name}" is a number, not a function, so it can't be called.`, ...at);
          if (args.length !== entry.params.length)
            throw new ImplicitError(
              `${name}(${entry.params.join(", ")}) takes ${entry.params.length} argument${entry.params.length === 1 ? "" : "s"} but got ${args.length}.`,
              node.start,
              node.end,
            );
        } else if (isPoint(name)) {
          throw new ImplicitError(
            `"${name}" is a coordinate, not a function. To multiply, write ${name} * (…).`,
            ...at,
          );
        } else if (Object.hasOwn(CONSTANTS, name)) {
          throw new ImplicitError(`"${name}" is a constant, not a function. To multiply, write ${name} * (…).`, ...at);
        } else if (Object.hasOwn(BUILTINS, name)) {
          const b = BUILTINS[name];
          if (!acceptsArity(b, args.length))
            throw new ImplicitError(
              `${signature(name)} takes ${arityText(b)} but got ${args.length}.`,
              node.start,
              node.end,
            );
        } else {
          const guess = suggest(name, [...Object.keys(BUILTINS), ...[...sc].filter(([, e]) => e.kind === "fn").map(([n]) => n)]);
          throw new ImplicitError(
            `Unknown function "${name}".${guess ? ` Did you mean ${guess}(…)?` : ""}`,
            ...at,
          );
        }
        for (const a of args) visit(a, sc);
        return;
      }
      default:
        throw new ImplicitError(`Internal: unknown node ${node.kind}`, node.start ?? 0, node.end ?? 1);
    }
  };

  for (const bnd of program.bindings) {
    const clash = reservedNameError(bnd.name, bnd.nameStart, bnd.nameEnd, "definition");
    if (clash) throw clash;
    if (scope.has(bnd.name)) {
      throw new ImplicitError(`"${bnd.name}" is already defined above. Give this one a different name.`, bnd.nameStart, bnd.nameEnd);
    }
    if (bnd.params) {
      const inner = new Map(scope);
      for (const p of bnd.params) {
        const pc = reservedNameError(p.name, p.start, p.end, "parameter");
        if (pc) throw pc;
        inner.set(p.name, { kind: "param", used: true });
      }
      // inner shares the outer entries, so names the body uses are marked used
      visit(bnd.value, inner);
    } else {
      visit(bnd.value, scope);
    }
    scope.set(bnd.name, {
      kind: bnd.params ? "fn" : "value",
      params: bnd.params?.map((p) => p.name),
      used: false,
      start: bnd.nameStart,
      end: bnd.nameEnd,
    });
  }
  if (program.result) visit(program.result, scope);
  for (const [name, e] of scope) {
    if (!e.used) warnings.push({ message: `"${name}" is defined but never used.`, start: e.start, end: e.end });
  }
  return warnings;
}

/**
 * Lower a checked program into IR.
 * @param {import("./parse.js").Program} program
 * @param {{ maxInstructions?: number, sourceLength?: number }} [opts]
 */
export function lower(program, opts = {}) {
  if (!program.result) {
    const at = opts.sourceLength ?? 0;
    throw new ImplicitError(
      "Nothing to draw yet. End the source with a shape, for example: sphere(0.5)",
      Math.max(0, at - 1),
      Math.max(1, at),
    );
  }
  const B = new Builder({ maxInstructions: opts.maxInstructions });
  let steps = 0;
  let nextThunk = 0;
  const memo = new Map();

  const thunk = (node, env) => ({ id: nextThunk++, node, env });
  const force = (t, P) => {
    const key = `${t.id}|${P.x},${P.y},${P.z}`;
    let r = memo.get(key);
    if (r === undefined) {
      r = lowerNode(t.node, t.env, P);
      memo.set(key, r);
    }
    return r;
  };

  const lowerNode = (node, env, P) => {
    if (++steps > MAX_STEPS)
      throw new ImplicitError(
        "This shape expands into too much work (definitions nested inside transforms many times over). Simplify it.",
        node.start,
        node.end,
      );
    B.at = node;
    switch (node.kind) {
      case "num":
        return B.const(node.value);
      case "unary":
        return B.neg(lowerNode(node.arg, env, P));
      case "binary": {
        const l = lowerNode(node.left, env, P);
        const r = lowerNode(node.right, env, P);
        B.at = node;
        switch (node.op) {
          case "+":
            return B.add(l, r);
          case "-":
            return B.sub(l, r);
          case "*":
            return B.mul(l, r);
          case "/":
            return B.div(l, r);
          case "^":
            return B.emit("pow", l, r);
        }
        break;
      }
      case "ident": {
        const { name } = node;
        if (name === "x") return P.x;
        if (name === "y") return P.y;
        if (name === "z") return P.z;
        const e = env.get(name);
        if (e && e.kind === "value") return force(e.thunk, P);
        if (Object.hasOwn(CONSTANTS, name)) return B.const(CONSTANTS[name]);
        break;
      }
      case "call": {
        const e = env.get(node.name);
        if (e && e.kind === "fn") {
          const inner = new Map(e.env);
          e.params.forEach((p, i) => inner.set(p, { kind: "value", thunk: thunk(node.args[i], env) }));
          return lowerNode(e.body, inner, P);
        }
        const b = BUILTINS[node.name];
        if (b) {
          const n = node.args.length;
          const thunks = node.args.map((a) => thunk(a, env));
          const arg = (i, at = P) => {
            const r = force(thunks[i], at);
            B.at = node; // so anything the builtin emits is located at the call
            return r;
          };
          const r = b.lower(B, P, arg, n);
          B.at = node;
          if (r != null) return r;
        }
        break;
      }
    }
    // check() rules all of these out; keep a clear message just in case
    throw new ImplicitError(`Can't evaluate this expression.`, node.start, node.end);
  };

  const env = new Map();
  for (const bnd of program.bindings) {
    if (bnd.params) env.set(bnd.name, { kind: "fn", params: bnd.params.map((p) => p.name), body: bnd.value, env: new Map(env) });
    else env.set(bnd.name, { kind: "value", thunk: thunk(bnd.value, new Map(env)) });
  }
  const P0 = { x: B.X, y: B.Y, z: B.Z };
  const result = lowerNode(program.result, env, P0);
  return B.finish(result);
}
