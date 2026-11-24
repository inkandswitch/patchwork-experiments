export type Node =
  | { type: "number"; value: number }
  | { type: "name"; name: string }
  | { type: "unary"; operand: Node }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] };

export type Scope = Record<string, number>;
export type Compiled = (scope: Scope) => number;

/** Reads a name: return a function of the scope, or undefined to read scope[name]. */
export type NameResolver = (name: string) => Compiled | undefined;

export function parse(source: string): Node {
  const tokens = tokenize(source);
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expect = (text: string) => {
    const token = next();
    if (token?.text !== text) throw new Error(`Expected "${text}" in "${source}"`);
  };

  const expression = (): Node => additive();

  const additive = (): Node => {
    let left = multiplicative();
    while (peek()?.text === "+" || peek()?.text === "-") {
      const op = next().text as "+" | "-";
      left = { type: "binary", op, left, right: multiplicative() };
    }
    return left;
  };

  const multiplicative = (): Node => {
    let left = unary();
    while (peek()?.text === "*" || peek()?.text === "/") {
      const op = next().text as "*" | "/";
      left = { type: "binary", op, left, right: unary() };
    }
    return left;
  };

  const unary = (): Node => {
    if (peek()?.text === "-") {
      next();
      return { type: "unary", operand: unary() };
    }
    if (peek()?.text === "+") {
      next();
      return unary();
    }
    return power();
  };

  const power = (): Node => {
    const base = primary();
    if (peek()?.text !== "^") return base;
    next();
    return { type: "binary", op: "^", left: base, right: unary() };
  };

  const primary = (): Node => {
    const token = next();
    if (!token) throw new Error(`Unexpected end of "${source}"`);
    if (token.kind === "number") return { type: "number", value: Number(token.text) };
    if (token.kind === "name") {
      if (peek()?.text !== "(") return { type: "name", name: token.text };
      next();
      const args: Node[] = [];
      if (peek()?.text !== ")") {
        args.push(expression());
        while (peek()?.text === ",") {
          next();
          args.push(expression());
        }
      }
      expect(")");
      if (!(token.text in FUNCTIONS) && token.text !== "inputAt") throw new Error(`Unknown function "${token.text}"`);
      return { type: "call", name: token.text, args };
    }
    if (token.text === "(") {
      const inner = expression();
      expect(")");
      return inner;
    }
    throw new Error(`Unexpected "${token.text}" in "${source}"`);
  };

  const tree = expression();
  if (at < tokens.length) throw new Error(`Unexpected "${tokens[at].text}" in "${source}"`);
  return tree;
}

/** Every name the expression reads, including the inputs named in inputAt(…). */
export function names(node: Node, into = new Set<string>()): Set<string> {
  if (node.type === "name") into.add(node.name);
  else if (node.type === "unary") names(node.operand, into);
  else if (node.type === "binary") {
    names(node.left, into);
    names(node.right, into);
  } else if (node.type === "call") for (const arg of node.args) names(arg, into);
  return into;
}

export function compile(node: Node, resolve: NameResolver = () => undefined, inputAt?: (input: string, year: number) => number): Compiled {
  switch (node.type) {
    case "number": {
      const value = node.value;
      return () => value;
    }
    case "name": {
      const custom = resolve(node.name);
      if (custom) return custom;
      const name = node.name;
      return (scope) => scope[name];
    }
    case "unary": {
      const operand = compile(node.operand, resolve, inputAt);
      return (scope) => -operand(scope);
    }
    case "binary":
      return binary(node.op, compile(node.left, resolve, inputAt), compile(node.right, resolve, inputAt));
    case "call": {
      if (node.name === "inputAt") {
        const [input, year] = node.args;
        if (!inputAt) throw new Error("inputAt(…) only works in initial values and derived parameters");
        if (input?.type !== "name" || !year) throw new Error("Write inputAt(inputName, year)");
        const yearOf = compile(year, resolve, inputAt);
        return (scope) => inputAt(input.name, yearOf(scope));
      }
      const fn = FUNCTIONS[node.name];
      const args = node.args.map((arg) => compile(arg, resolve, inputAt));
      if (args.length === 1) {
        const [a] = args;
        return (scope) => fn(a(scope));
      }
      if (args.length === 2) {
        const [a, b] = args;
        return (scope) => fn(a(scope), b(scope));
      }
      return (scope) => fn(...args.map((arg) => arg(scope)));
    }
  }
}

function binary(op: "+" | "-" | "*" | "/" | "^", left: Compiled, right: Compiled): Compiled {
  switch (op) {
    case "+":
      return (scope) => left(scope) + right(scope);
    case "-":
      return (scope) => left(scope) - right(scope);
    case "*":
      return (scope) => left(scope) * right(scope);
    case "/":
      return (scope) => left(scope) / right(scope);
    case "^":
      return (scope) => left(scope) ** right(scope);
  }
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
};

type Token = { kind: "number" | "name" | "symbol"; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),−×]))/gy;
  let match: RegExpExecArray | null;
  let end = 0;
  while ((match = pattern.exec(source))) {
    end = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: "number", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "name", text: match[2] });
    else tokens.push({ kind: "symbol", text: SYMBOLS[match[3]] ?? match[3] });
  }
  if (source.slice(end).trim()) throw new Error(`Can't read "${source.slice(end).trim()}" in "${source}"`);
  return tokens;
}

const SYMBOLS: Record<string, string> = { "**": "^", "−": "-", "×": "*" };
