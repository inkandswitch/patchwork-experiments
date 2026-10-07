// Parser: tokens -> AST.
//
//   program  := binding* expr EOF
//   binding  := "let" IDENT ( "(" IDENT ("," IDENT)* ")" )? "=" expr ( ";" | <newline> | EOF )
//   expr     := term (("+" | "-") term)*
//   term     := unary (("*" | "/") unary)*
//   unary    := "-" unary | "+" unary | power
//   power    := primary ("^" unary)?              // right-associative, binds tighter than unary minus on the left
//   primary  := NUMBER | IDENT | IDENT "(" args? ")" | "(" expr ")"
//
// Nodes carry { start, end } character offsets. Nothing here evaluates
// anything: the AST is data, and only the lowering in lower.js gives it
// meaning, through a fixed whitelist of builtins.

import { ImplicitError } from "./errors.js";
import { tokenize } from "./tokenize.js";

/**
 * @typedef {{ kind: "num", value: number, start: number, end: number }
 *   | { kind: "ident", name: string, start: number, end: number }
 *   | { kind: "unary", op: "-", arg: Node, start: number, end: number }
 *   | { kind: "binary", op: "+"|"-"|"*"|"/"|"^", left: Node, right: Node, start: number, end: number }
 *   | { kind: "call", name: string, nameStart: number, nameEnd: number, args: Node[], start: number, end: number }} Node
 * @typedef {{ name: string, params: {name: string, start: number, end: number}[] | null,
 *             value: Node, start: number, end: number, nameStart: number, nameEnd: number }} Binding
 * @typedef {{ kind: "program", bindings: Binding[], result: Node | null }} Program
 */

const describe = (t) =>
  t.type === "eof"
    ? "the end of the source"
    : t.type === "num"
      ? `the number ${t.value}`
      : t.type === "ident"
        ? `"${t.value}"`
        : t.type === "kw"
          ? `the keyword "${t.value}"`
          : `"${t.value}"`;

/** Parse source text (or a token list) into a Program. Throws ImplicitError. */
export function parse(source) {
  const tokens = Array.isArray(source) ? source : tokenize(source);
  let pos = 0;
  const peek = (k = 0) => tokens[Math.min(pos + k, tokens.length - 1)];
  const next = () => tokens[pos++] ?? tokens[tokens.length - 1];
  const is = (type, value) => {
    const t = peek();
    return t.type === type && (value === undefined || t.value === value);
  };
  const expect = (type, message) => {
    const t = peek();
    if (t.type !== type) throw new ImplicitError(message(t), t.start, Math.max(t.end, t.start + 1));
    return next();
  };

  // nesting guard: a pathological "((((((…" must not blow the JS stack
  let depth = 0;
  const enter = (t) => {
    if (++depth > 200) throw new ImplicitError("Expressions are nested too deeply (more than 200 levels).", t.start, t.end);
  };
  const leave = () => depth--;

  function parseExpr() {
    enter(peek());
    let left = parseTerm();
    while (is("op", "+") || is("op", "-")) {
      const op = next().value;
      const right = parseTerm();
      left = { kind: "binary", op, left, right, start: left.start, end: right.end };
    }
    leave();
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (is("op", "*") || is("op", "/")) {
      const op = next().value;
      const right = parseUnary();
      left = { kind: "binary", op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  function parseUnary() {
    if (is("op", "-") || is("op", "+")) {
      const t = next();
      enter(t);
      const arg = parseUnary();
      leave();
      if (t.value === "+") return arg;
      // fold "-3" into a literal so errors and highlighting stay simple
      if (arg.kind === "num") return { kind: "num", value: -arg.value, start: t.start, end: arg.end };
      return { kind: "unary", op: "-", arg, start: t.start, end: arg.end };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (is("op", "^")) {
      next();
      enter(peek());
      const exp = parseUnary();
      leave();
      return { kind: "binary", op: "^", left: base, right: exp, start: base.start, end: exp.end };
    }
    return base;
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === "num") {
      next();
      return { kind: "num", value: t.value, start: t.start, end: t.end };
    }
    if (t.type === "ident") {
      next();
      // a call needs its "(" on the same line, so a new line never glues onto a name
      if (is("(") && !peek().nl) {
        const open = next();
        const args = [];
        if (!is(")")) {
          for (;;) {
            if (is(")")) break; // trailing comma
            args.push(parseExpr());
            if (is(",")) {
              next();
              continue;
            }
            break;
          }
        }
        const close = peek();
        if (close.type !== ")") {
          const msg =
            close.type === "eof"
              ? `The call to ${t.value}( that opens here is never closed — add a ")".`
              : `Expected "," or ")" in the call to ${t.value}(…), but found ${describe(close)}.`;
          const at = close.type === "eof" ? open : close;
          throw new ImplicitError(msg, at.start, Math.max(at.end, at.start + 1));
        }
        next();
        return { kind: "call", name: t.value, nameStart: t.start, nameEnd: t.end, args, start: t.start, end: close.end };
      }
      return { kind: "ident", name: t.value, start: t.start, end: t.end };
    }
    if (t.type === "(") {
      const open = next();
      const inner = parseExpr();
      const close = peek();
      if (close.type !== ")") {
        const at = close.type === "eof" ? open : close;
        throw new ImplicitError(
          close.type === "eof"
            ? `This "(" is never closed — add a ")".`
            : `Expected ")" to close an earlier "(", but found ${describe(close)}.`,
          at.start,
          Math.max(at.end, at.start + 1),
        );
      }
      next();
      return { ...inner, start: open.start, end: close.end, parens: true };
    }
    if (t.type === "kw" && t.value === "let")
      throw new ImplicitError(
        `"let" can only start a line — it defines a name for later use. Did the line above end early?`,
        t.start,
        t.end,
      );
    if (t.type === "eof") throw new ImplicitError("The source ends in the middle of an expression.", t.start, t.start + 1);
    if (t.type === "op")
      throw new ImplicitError(`"${t.value}" needs something on its left — found it with nothing before it.`, t.start, t.end);
    if (t.type === "error") throw new ImplicitError(t.value, t.start, t.end);
    throw new ImplicitError(`Expected a number, a name or "(", but found ${describe(t)}.`, t.start, Math.max(t.end, t.start + 1));
  }

  const bindings = [];
  while (is("kw", "let")) {
    const kw = next();
    const nameTok = expect("ident", (t) =>
      `After "let" comes a name, like "let radius = 0.1" — found ${describe(t)}.`,
    );
    let params = null;
    if (is("(")) {
      next();
      params = [];
      if (!is(")")) {
        for (;;) {
          const p = expect("ident", (t) => `Parameters of ${nameTok.value}(…) must be names — found ${describe(t)}.`);
          if (params.some((q) => q.name === p.value))
            throw new ImplicitError(`The parameter "${p.value}" appears twice in ${nameTok.value}(…).`, p.start, p.end);
          params.push({ name: p.value, start: p.start, end: p.end });
          if (is(",")) {
            next();
            continue;
          }
          break;
        }
      }
      expect(")", (t) => `Expected "," or ")" in the parameters of ${nameTok.value}(…), found ${describe(t)}.`);
    }
    expect("=", (t) =>
      t.type === "op" || t.type === "num" || t.type === "ident"
        ? `Expected "=" after "let ${nameTok.value}${params ? "(…)" : ""}" — found ${describe(t)}.`
        : `Expected "=" after "let ${nameTok.value}", found ${describe(t)}.`,
    );
    const value = parseExpr();
    // a binding ends at ";", at a line break, or at the end
    if (is(";")) next();
    else if (!peek().nl && !is("eof")) {
      const t = peek();
      throw new ImplicitError(
        `The value of "${nameTok.value}" ended, then ${describe(t)} followed on the same line. End a let with ";" or a new line.`,
        t.start,
        Math.max(t.end, t.start + 1),
      );
    }
    bindings.push({
      name: nameTok.value,
      params,
      value,
      start: kw.start,
      end: value.end,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
    });
    while (is(";")) next();
  }

  let result = null;
  if (!is("eof")) {
    result = parseExpr();
    while (is(";")) next();
    if (!is("eof")) {
      const t = peek();
      const msg =
        t.type === "kw"
          ? `"let" must come before the final shape. Move this definition above it.`
          : t.type === ")"
            ? `There is a ")" with no matching "(".`
            : `Only one final shape is allowed, but another expression starts here. Combine shapes with union(a, b, …).`;
      throw new ImplicitError(msg, t.start, Math.max(t.end, t.start + 1));
    }
  }
  return { kind: "program", bindings, result };
}
