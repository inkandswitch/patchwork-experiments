/**
 * Formulas and checks: arithmetic only.
 *
 *   formula   pack_V_max / pack_R_min_mOhm
 *             + − × ÷ (also * /), ^, min, max, sqrt, abs, pow, numbers, entry ids
 *   check     vent_H2_frac_peak <= 0.25 * h2_LFL_frac
 *             one comparison (< <= > >= == !=), or comparisons joined by
 *             and / or / not
 *
 * Anything more is a model in a notebook and comes back as a model result.
 *
 * Each expression is evaluated two ways: on nominals (a number, or undefined
 * when an input has none), and on intervals. Interval arithmetic is sound:
 * the computed interval contains every value the expression takes over the
 * box of its inputs' intervals. It is also conservative, since an input that
 * appears twice is treated as two independent inputs. So a check decided on
 * intervals can say "depends" where the truth is "holds", but it never says
 * "holds" where the truth is "fails" (tested over every operator × interval
 * shape).
 */

// ---------------------------------------------------------------- parsing

const FUNCTIONS = { min: [1, Infinity], max: [1, Infinity], sqrt: [1, 1], abs: [1, 1], pow: [2, 2] }

function tokenize(text) {
  const tokens = []
  const source = String(text ?? "")
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const space = rest.match(/^\s+/)
    if (space) {
      i += space[0].length
      continue
    }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/)
    if (number) {
      tokens.push({ t: "num", v: Number(number[0]), at: i })
      i += number[0].length
      continue
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (word) {
      const lower = word[0].toLowerCase()
      tokens.push(lower === "and" || lower === "or" || lower === "not" ? { t: lower, at: i } : { t: "word", v: word[0], at: i })
      i += word[0].length
      continue
    }
    const op = rest.match(/^(<=|>=|==|!=|&&|\|\||[-+*/^(),<>!×÷−≤≥≠])/)
    if (op) {
      const canonical = { "×": "*", "÷": "/", "−": "-", "≤": "<=", "≥": ">=", "≠": "!=", "&&": "and", "||": "or", "!": "not" }[op[0]] ?? op[0]
      tokens.push(canonical === "and" || canonical === "or" || canonical === "not" ? { t: canonical, at: i } : { t: "op", v: canonical, at: i })
      i += op[0].length
      continue
    }
    throw new SyntaxError(`can't read '${source[i]}' at position ${i + 1}`)
  }
  return tokens
}

/**
 * Parse an expression. Returns { ast, ids, kind: "number" | "boolean" } or
 * throws a SyntaxError with a message a person can act on.
 */
export function parse(text) {
  const tokens = tokenize(text)
  if (!tokens.length) throw new SyntaxError("the expression is empty")
  let at = 0
  const peek = () => tokens[at]
  const isOp = (v) => peek()?.t === "op" && peek().v === v
  const take = () => tokens[at++]
  const expect = (v) => {
    if (!isOp(v)) throw new SyntaxError(`expected '${v}'${peek() ? ` at position ${peek().at + 1}` : " at the end"}`)
    take()
  }

  const or = () => {
    let a = and()
    while (peek()?.t === "or") {
      take()
      a = { t: "or", a, b: and() }
    }
    return a
  }
  const and = () => {
    let a = not()
    while (peek()?.t === "and") {
      take()
      a = { t: "and", a, b: not() }
    }
    return a
  }
  const not = () => {
    if (peek()?.t === "not") {
      take()
      return { t: "not", a: not() }
    }
    return comparison()
  }
  const comparison = () => {
    const a = sum()
    if (peek()?.t === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(peek().v)) {
      const op = take().v
      const b = sum()
      if (peek()?.t === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(peek().v)) throw new SyntaxError("write a chain of comparisons with 'and'")
      return { t: "cmp", op, a, b }
    }
    return a
  }
  const sum = () => {
    let a = product()
    while (isOp("+") || isOp("-")) {
      const op = take().v
      a = { t: "bin", op, a, b: product() }
    }
    return a
  }
  const product = () => {
    let a = unary()
    while (isOp("*") || isOp("/")) {
      const op = take().v
      a = { t: "bin", op, a, b: unary() }
    }
    return a
  }
  const unary = () => {
    if (isOp("-")) {
      take()
      return { t: "neg", a: unary() }
    }
    if (isOp("+")) {
      take()
      return unary()
    }
    return power()
  }
  const power = () => {
    const a = atom()
    if (isOp("^")) {
      take()
      return { t: "call", fn: "pow", args: [a, unary()] }
    }
    return a
  }
  const atom = () => {
    const token = take()
    if (!token) throw new SyntaxError("the expression ends too soon")
    if (token.t === "num") return { t: "num", v: token.v }
    if (token.t === "word") {
      if (isOp("(")) {
        const fn = token.v.toLowerCase()
        if (!FUNCTIONS[fn]) throw new SyntaxError(`'${token.v}' is not a function here; formulas have min, max, sqrt, abs and pow`)
        take()
        const args = [or()]
        while (isOp(",")) {
          take()
          args.push(or())
        }
        expect(")")
        const [least, most] = FUNCTIONS[fn]
        if (args.length < least || args.length > most) throw new SyntaxError(`${fn} takes ${least === most ? least : `at least ${least}`} argument${least === 1 && most === 1 ? "" : "s"}`)
        return { t: "call", fn, args }
      }
      return { t: "id", id: token.v }
    }
    if (token.t === "op" && token.v === "(") {
      const inner = or()
      expect(")")
      return inner
    }
    throw new SyntaxError(`unexpected '${token.v ?? token.t}' at position ${token.at + 1}`)
  }

  const ast = or()
  if (at < tokens.length) throw new SyntaxError(`unexpected '${tokens[at].v ?? tokens[at].t}' at position ${tokens[at].at + 1}`)
  const kind = typeOf(ast)
  return { ast, ids: [...idsOf(ast)], kind }
}

function typeOf(node) {
  switch (node.t) {
    case "num":
    case "id":
      return "number"
    case "neg":
      need(node.a, "number")
      return "number"
    case "bin":
      need(node.a, "number")
      need(node.b, "number")
      return "number"
    case "call":
      for (const arg of node.args) need(arg, "number")
      return "number"
    case "cmp":
      need(node.a, "number")
      need(node.b, "number")
      return "boolean"
    case "and":
    case "or":
      need(node.a, "boolean")
      need(node.b, "boolean")
      return "boolean"
    case "not":
      need(node.a, "boolean")
      return "boolean"
  }
  throw new Error(`unknown node ${node.t}`)
}

function need(node, kind) {
  const actual = typeOf(node)
  if (actual !== kind) throw new SyntaxError(kind === "number" ? "a comparison can't be used as a number" : "a number can't be used as a condition: compare it with something")
}

function idsOf(node, into = new Set()) {
  if (node.t === "id") into.add(node.id)
  for (const child of [node.a, node.b, ...(node.args ?? [])]) if (child) idsOf(child, into)
  return into
}

/** The ids an expression names, or [] if it doesn't parse. */
export function idsIn(text) {
  try {
    return parse(text).ids
  } catch {
    return []
  }
}

/** An expression written back out, with values substituted where `show(id)` gives text. */
export function render(node, show = (id) => id, parent = 0) {
  const prec = { or: 1, and: 2, not: 3, cmp: 4, "+": 5, "-": 5, "*": 6, "/": 6, neg: 7, call: 8 }
  const wrap = (text, mine) => (mine < parent ? `(${text})` : text)
  switch (node.t) {
    case "num":
      return String(node.v)
    case "id":
      return show(node.id)
    case "neg":
      return wrap(`−${render(node.a, show, prec.neg)}`, prec.neg)
    case "bin": {
      const p = prec[node.op]
      const sign = { "+": "+", "-": "−", "*": "×", "/": "/" }[node.op]
      return wrap(`${render(node.a, show, p)} ${sign} ${render(node.b, show, p + 1)}`, p)
    }
    case "call":
      return `${node.fn}(${node.args.map((a) => render(a, show, 0)).join(", ")})`
    case "cmp": {
      const sign = { "<=": "≤", ">=": "≥", "!=": "≠", "==": "=" }[node.op] ?? node.op
      return wrap(`${render(node.a, show, prec.cmp + 1)} ${sign} ${render(node.b, show, prec.cmp + 1)}`, prec.cmp)
    }
    case "and":
    case "or":
      return wrap(`${render(node.a, show, prec[node.t])} ${node.t} ${render(node.b, show, prec[node.t] + 1)}`, prec[node.t])
    case "not":
      return wrap(`not ${render(node.a, show, prec.not)}`, prec.not)
  }
  return "?"
}

// ---------------------------------------------------------------- nominal evaluation

/** The expression on nominals: a number, or undefined when an input has none or the arithmetic is undefined. */
export function evalNominal(node, get) {
  const v = nominal(node, get)
  return Number.isFinite(v) ? v : undefined
}

function nominal(node, get) {
  switch (node.t) {
    case "num":
      return node.v
    case "id":
      return get(node.id)
    case "neg": {
      const a = nominal(node.a, get)
      return a === undefined ? undefined : -a
    }
    case "bin": {
      const a = nominal(node.a, get)
      const b = nominal(node.b, get)
      if (a === undefined || b === undefined) return undefined
      if (node.op === "/" && b === 0) return undefined
      return node.op === "+" ? a + b : node.op === "-" ? a - b : node.op === "*" ? a * b : a / b
    }
    case "call": {
      const args = node.args.map((a) => nominal(a, get))
      if (args.some((a) => a === undefined)) return undefined
      if (node.fn === "min") return Math.min(...args)
      if (node.fn === "max") return Math.max(...args)
      if (node.fn === "sqrt") return args[0] < 0 ? undefined : Math.sqrt(args[0])
      if (node.fn === "abs") return Math.abs(args[0])
      const p = Math.pow(args[0], args[1])
      return Number.isFinite(p) ? p : undefined
    }
  }
  return undefined
}

/** A check on nominals: true, false, or null when a nominal is missing. */
export function checkNominal(node, get) {
  switch (node.t) {
    case "cmp": {
      const a = evalNominal(node.a, get)
      const b = evalNominal(node.b, get)
      if (a === undefined || b === undefined) return null
      return compare(node.op, a, b)
    }
    case "and": {
      const a = checkNominal(node.a, get)
      const b = checkNominal(node.b, get)
      return a === false || b === false ? false : a === null || b === null ? null : true
    }
    case "or": {
      const a = checkNominal(node.a, get)
      const b = checkNominal(node.b, get)
      return a === true || b === true ? true : a === null || b === null ? null : false
    }
    case "not": {
      const a = checkNominal(node.a, get)
      return a === null ? null : !a
    }
  }
  return null
}

function compare(op, a, b) {
  return op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : op === ">=" ? a >= b : op === "==" ? a === b : a !== b
}

// ---------------------------------------------------------------- interval arithmetic

const WHOLE = [-Infinity, Infinity]

// 0 × ∞ is 0 at an interval's end: the end is a limit, and the other factor is exactly 0 there.
const times = (a, b) => (a === 0 || b === 0 ? 0 : a * b)

export function iadd([a, b], [c, d]) {
  return [a + c, b + d].map((n, i) => (Number.isNaN(n) ? (i ? Infinity : -Infinity) : n))
}

export function ineg([a, b]) {
  return [-b, -a]
}

export function isub(x, y) {
  return iadd(x, ineg(y))
}

export function imul([a, b], [c, d]) {
  const ends = [times(a, c), times(a, d), times(b, c), times(b, d)]
  return [Math.min(...ends), Math.max(...ends)]
}

export function idiv(x, [c, d]) {
  if (c > 0 || d < 0) return imul(x, [1 / d, 1 / c])
  if (c === 0 && d === 0) return WHOLE
  if (c === 0) return imul(x, [1 / d, Infinity])
  if (d === 0) return imul(x, [-Infinity, 1 / c])
  return WHOLE
}

export function imin(...xs) {
  return [Math.min(...xs.map((x) => x[0])), Math.min(...xs.map((x) => x[1]))]
}

export function imax(...xs) {
  return [Math.max(...xs.map((x) => x[0])), Math.max(...xs.map((x) => x[1]))]
}

export function iabs([a, b]) {
  if (a >= 0) return [a, b]
  if (b <= 0) return [-b, -a]
  return [0, Math.max(-a, b)]
}

export function isqrt([a, b]) {
  if (b < 0) return [NaN, NaN]
  return [Math.sqrt(Math.max(a, 0)), Math.sqrt(b)]
}

export function ipow([a, b], [c, d]) {
  if (c === d && Number.isInteger(c)) {
    const k = c
    if (k === 0) return [1, 1]
    if (k < 0) return idiv([1, 1], ipow([a, b], [-k, -k]))
    const pa = Math.pow(a, k)
    const pb = Math.pow(b, k)
    if (k % 2 === 1) return [pa, pb]
    if (a >= 0) return [pa, pb]
    if (b <= 0) return [pb, pa]
    return [0, Math.max(pa, pb)]
  }
  // x^y = exp(y · ln x) for x ≥ 0; y · ln x is bilinear, so its extremes are at corners.
  if (b < 0) return [NaN, NaN]
  const lnx = [Math.log(Math.max(a, 0)), Math.log(b)]
  const ends = [times(c, lnx[0]), times(c, lnx[1]), times(d, lnx[0]), times(d, lnx[1])].map((n) => (Number.isNaN(n) ? 0 : n))
  return [Math.exp(Math.min(...ends)), Math.exp(Math.max(...ends))]
}

/** The expression on intervals: [lo, hi], sound. `get(id)` gives an input's interval. */
export function evalInterval(node, get) {
  switch (node.t) {
    case "num":
      return [node.v, node.v]
    case "id":
      return get(node.id)
    case "neg":
      return ineg(evalInterval(node.a, get))
    case "bin": {
      const a = evalInterval(node.a, get)
      const b = evalInterval(node.b, get)
      return node.op === "+" ? iadd(a, b) : node.op === "-" ? isub(a, b) : node.op === "*" ? imul(a, b) : idiv(a, b)
    }
    case "call": {
      const args = node.args.map((a) => evalInterval(a, get))
      if (node.fn === "min") return imin(...args)
      if (node.fn === "max") return imax(...args)
      if (node.fn === "sqrt") return isqrt(args[0])
      if (node.fn === "abs") return iabs(args[0])
      return ipow(args[0], args[1])
    }
  }
  return WHOLE
}

/**
 * A check over intervals: "holds" when true over the whole box of inputs,
 * "fails" when false over all of it, else "depends".
 */
export function checkInterval(node, get) {
  switch (node.t) {
    case "cmp": {
      const [a, b] = evalInterval(node.a, get)
      const [c, d] = evalInterval(node.b, get)
      if ([a, b, c, d].some(Number.isNaN)) return "depends"
      switch (node.op) {
        case "<=":
          return b <= c ? "holds" : a > d ? "fails" : "depends"
        case "<":
          return b < c ? "holds" : a >= d ? "fails" : "depends"
        case ">=":
          return a >= d ? "holds" : b < c ? "fails" : "depends"
        case ">":
          return a > d ? "holds" : b <= c ? "fails" : "depends"
        case "==":
          return a === b && c === d && a === c ? "holds" : b < c || d < a ? "fails" : "depends"
        case "!=":
          return b < c || d < a ? "holds" : a === b && c === d && a === c ? "fails" : "depends"
      }
      return "depends"
    }
    case "and": {
      const a = checkInterval(node.a, get)
      const b = checkInterval(node.b, get)
      return a === "fails" || b === "fails" ? "fails" : a === "holds" && b === "holds" ? "holds" : "depends"
    }
    case "or": {
      const a = checkInterval(node.a, get)
      const b = checkInterval(node.b, get)
      return a === "holds" || b === "holds" ? "holds" : a === "fails" && b === "fails" ? "fails" : "depends"
    }
    case "not": {
      const a = checkInterval(node.a, get)
      return a === "holds" ? "fails" : a === "fails" ? "holds" : "depends"
    }
  }
  return "depends"
}
