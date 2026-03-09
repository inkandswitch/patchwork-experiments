// ─── Types ────────────────────────────────────────────────────────────────────

export type Constant = string | number;

// Term used in rule atoms. Convention (stored as plain string):
//   starts with uppercase letter → variable  e.g. "X", "Cap"
//   "_"                          → wildcard
//   otherwise                    → constant   e.g. "north", "500" or number
export type Term = string;

export type StoredFact = { pred: string; args: Constant[] };
export type StoredAtom = { pred: string; args: Term[] };
export type StoredRule = { head: StoredAtom; body: StoredAtom[] };

export type ParseResult = {
  facts: StoredFact[];
  rules: StoredRule[];
  errors: { line: number; text: string; message: string }[];
};

// ─── Key derivation ───────────────────────────────────────────────────────────

function serializeConstant(c: Constant): string {
  return typeof c === 'number' ? String(c) : c;
}

function serializeTerm(t: Term): string {
  return t;
}

function serializeAtom(a: StoredAtom): string {
  return `${a.pred}(${a.args.map(serializeTerm).join(', ')})`;
}

function serializeFactAtom(f: StoredFact): string {
  return `${f.pred}(${f.args.map(serializeConstant).join(', ')})`;
}

export function factKey(f: StoredFact): string {
  return serializeFactAtom(f);
}

export function ruleKey(r: StoredRule): string {
  return `${serializeAtom(r.head)} :- ${r.body.map(serializeAtom).join(', ')}`;
}

// ─── Serialization (structure → text) ─────────────────────────────────────────

export function serializeFacts(facts: StoredFact[]): string {
  return facts.map(f => serializeFactAtom(f) + '.').join('\n');
}

export function serializeRules(rules: StoredRule[]): string {
  return rules.map(r => ruleKey(r) + '.').join('\n');
}

// ─── Parsing (text → structure) ───────────────────────────────────────────────

function isVariable(t: string): boolean {
  return t.length > 0 && t[0] >= 'A' && t[0] <= 'Z';
}

function isWildcard(t: string): boolean {
  return t === '_';
}

function parseConstant(s: string): Constant {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

// Parse a single atom string like "pred(arg1, arg2)" into a StoredAtom.
// Returns null on failure.
function parseAtomStr(s: string): StoredAtom | null {
  s = s.trim();
  const match = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*$/);
  if (!match) {
    // Also allow 0-arity atoms: "pred"
    const bare = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (bare) return { pred: bare[1], args: [] };
    return null;
  }
  const pred = match[1];
  const argsStr = match[2].trim();
  const args: Term[] = argsStr === '' ? [] : argsStr.split(',').map(a => a.trim());
  return { pred, args };
}

function atomToFact(atom: StoredAtom): StoredFact | null {
  const args: Constant[] = [];
  for (const a of atom.args) {
    if (isVariable(a) || isWildcard(a)) return null; // has unbound terms
    args.push(parseConstant(a));
  }
  return { pred: atom.pred, args };
}

export function parseProgram(text: string): ParseResult {
  const facts: StoredFact[] = [];
  const rules: StoredRule[] = [];
  const errors: ParseResult['errors'] = [];

  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Strip comments and trailing dots/whitespace
    let line = lines[i].replace(/\/\/.*$/, '').replace(/%.*$/, '').trim();
    if (line.endsWith('.')) line = line.slice(0, -1).trim();
    if (!line) continue;

    if (line.includes(':-')) {
      // Rule
      const sepIdx = line.indexOf(':-');
      const headStr = line.slice(0, sepIdx).trim();
      const bodyStr = line.slice(sepIdx + 2).trim();

      const head = parseAtomStr(headStr);
      if (!head) {
        errors.push({ line: i + 1, text: lines[i], message: `Invalid rule head: "${headStr}"` });
        continue;
      }

      const bodyAtoms: StoredAtom[] = [];
      let parseError = false;

      // Split body on commas, but respect parentheses
      const bodyParts = splitOnComma(bodyStr);
      for (const part of bodyParts) {
        const atom = parseAtomStr(part.trim());
        if (!atom) {
          errors.push({ line: i + 1, text: lines[i], message: `Invalid body atom: "${part.trim()}"` });
          parseError = true;
          break;
        }
        bodyAtoms.push(atom);
      }

      if (!parseError) {
        rules.push({ head, body: bodyAtoms });
      }
    } else {
      // Fact
      const atom = parseAtomStr(line);
      if (!atom) {
        errors.push({ line: i + 1, text: lines[i], message: `Invalid fact: "${line}"` });
        continue;
      }
      const fact = atomToFact(atom);
      if (!fact) {
        errors.push({ line: i + 1, text: lines[i], message: `Fact contains variables: "${line}"` });
        continue;
      }
      facts.push(fact);
    }
  }

  return { facts, rules, errors };
}

// Split a comma-separated list respecting parentheses depth.
function splitOnComma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of s) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

type Bindings = Map<string, Constant>;

function matchAtom(
  atom: StoredAtom,
  fact: StoredFact,
  bindings: Bindings
): Bindings | null {
  if (atom.pred !== fact.pred || atom.args.length !== fact.args.length) return null;
  const b = new Map(bindings);
  for (let i = 0; i < atom.args.length; i++) {
    const t = atom.args[i];
    const v = fact.args[i];
    if (isWildcard(t)) continue;
    if (isVariable(t)) {
      const existing = b.get(t);
      if (existing !== undefined) {
        if (existing !== v) return null;
      } else {
        b.set(t, v);
      }
    } else {
      // constant — must match exactly
      const c = parseConstant(t);
      if (c !== v) return null;
    }
  }
  return b;
}

function evalBuiltin(atom: StoredAtom, bindings: Bindings): Bindings | null {
  const resolve = (t: Term): Constant | undefined => {
    if (isWildcard(t)) return undefined;
    if (isVariable(t)) return bindings.get(t);
    return parseConstant(t);
  };

  const { pred, args } = atom;

  // eq / neq: raw value equality (works for strings and numbers)
  if ((pred === 'eq' || pred === 'neq') && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null; // unbound
    const equal = a === b;
    return (pred === 'eq' ? equal : !equal) ? bindings : null;
  }

  // Numeric comparison built-ins (2 args)
  const CMP: Record<string, (a: number, b: number) => boolean> = {
    lt:  (a, b) => a <  b,
    lte: (a, b) => a <= b,
    gt:  (a, b) => a >  b,
    gte: (a, b) => a >= b,
  };
  if (pred in CMP && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null; // unbound
    if (CMP[pred](Number(a), Number(b))) return bindings;
    return null;
  }

  // Arithmetic built-ins (3 args: input, input, output)
  const ARITH: Record<string, (a: number, b: number) => number> = {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
  };
  if (pred in ARITH && args.length === 3) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null; // unbound inputs
    const result = ARITH[pred](Number(a), Number(b));
    const outTerm = args[2];
    if (isWildcard(outTerm)) return bindings;
    if (isVariable(outTerm)) {
      const existing = bindings.get(outTerm);
      if (existing !== undefined && existing !== result) return null;
      const b2 = new Map(bindings);
      b2.set(outTerm, result);
      return b2;
    }
    // constant: check equality
    return parseConstant(outTerm) === result ? bindings : null;
  }

  return null; // unknown built-in
}

const BUILTIN_PREDS = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'add', 'sub', 'mul', 'div']);

function matchBody(
  body: StoredAtom[],
  db: StoredFact[],
  bindings: Bindings
): Bindings[] {
  if (body.length === 0) return [bindings];
  const [first, ...rest] = body;

  if (BUILTIN_PREDS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    return matchBody(rest, db, b);
  }

  const results: Bindings[] = [];
  for (const fact of db) {
    const b = matchAtom(first, fact, bindings);
    if (b !== null) {
      results.push(...matchBody(rest, db, b));
    }
  }
  return results;
}

function substituteHead(head: StoredAtom, bindings: Bindings): StoredFact | null {
  const args: Constant[] = [];
  for (const t of head.args) {
    if (isWildcard(t)) return null; // wildcards in head are invalid
    if (isVariable(t)) {
      const v = bindings.get(t);
      if (v === undefined) return null; // unbound variable in head
      args.push(v);
    } else {
      args.push(parseConstant(t));
    }
  }
  return { pred: head.pred, args };
}

export function evaluate(facts: StoredFact[], rules: StoredRule[]): StoredFact[] {
  const db: StoredFact[] = [...facts];
  const seen = new Set<string>(facts.map(factKey));

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      const solutions = matchBody(rule.body, db, new Map());
      for (const bindings of solutions) {
        const derived = substituteHead(rule.head, bindings);
        if (!derived) continue;
        const key = factKey(derived);
        if (!seen.has(key)) {
          seen.add(key);
          db.push(derived);
          changed = true;
        }
      }
    }
  }

  return db;
}
