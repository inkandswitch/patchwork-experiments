import * as ohm from 'ohm-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Constant = string | number;

// Term in a rule atom (stored as plain string):
//   starts with uppercase letter → variable  e.g. "X", "Cap"
//   "_"                          → wildcard
//   otherwise                    → constant   e.g. "north", "500" or a number
export type Term = string;

export type StoredFact = { pred: string; args: Constant[] };
export type StoredAtom = { pred: string; args: Term[] };
export type StoredRule = { head: StoredAtom; body: StoredAtom[] };

export type StoredConstraint = { body: StoredAtom[] };

export type ProvenanceEntry = { rule: StoredRule; groundBody: StoredFact[] };
export type ProvenanceMap = Map<string, ProvenanceEntry>;

export type GroundBodyStep =
  | { kind: 'fact'; fact: StoredFact; isBase: boolean; derivedBy?: ProvenanceEntry }
  | { kind: 'builtin'; atom: StoredAtom; resolvedArgs: Constant[] };

export type WitnessTrace = {
  bindings: Record<string, Constant>;
  steps: GroundBodyStep[];
};

export type ConstraintViolation = {
  constraint: StoredConstraint;
  witnesses: WitnessTrace[];
};

export type ParseResult = {
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  errors: { line: number; text: string; message: string }[];
};

// ─── Key derivation ───────────────────────────────────────────────────────────

function serializeConstant(c: Constant): string {
  return String(c);
}

function serializeAtom(a: StoredAtom): string {
  if (a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}

function serializeFactAtom(f: StoredFact): string {
  if (f.args.length === 0) return f.pred;
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

export function serializeConstraints(constraints: StoredConstraint[]): string {
  return constraints.map(c => ':- ' + c.body.map(serializeAtom).join(', ') + '.').join('\n');
}

// ─── ohm.js grammar ───────────────────────────────────────────────────────────

const GRAMMAR_SRC = String.raw`
Datalog {
  Program     = Statement*

  Statement   = Rule "."        -- rule
              | Constraint "."  -- constraint
              | Fact "."        -- fact

  Rule        = Atom ":-" NonemptyListOf<BodyLit, ",">

  Constraint  = ":-" NonemptyListOf<BodyLit, ",">

  Fact        = Atom

  BodyLit     = SumLit
              | Atom

  SumLit      = "sum" "(" Term "," Atom "," Term ")"

  Atom        = ident "(" ListOf<Term, ","> ")"  -- args
              | ident                             -- bare

  Term        = "_"      -- wildcard
              | number   -- num
              | ident    -- name

  ident       = ~reserved letter (alnum | "_")*
  reserved    = "sum" ~(alnum | "_")

  number      = "-"? digit+ ("." digit+)?

  comment     = ("%" | "//") (~"\n" any)* ("\n" | end)
  space      += comment
}
`;

const grammar = ohm.grammar(GRAMMAR_SRC);

// ─── Semantics ────────────────────────────────────────────────────────────────

type ParseOutput = {
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  errors: ParseResult['errors'];
};

const semantics = grammar.createSemantics();

semantics.addOperation<any>('toAST', {
  Program(stmts) {
    const output: ParseOutput = { facts: [], rules: [], constraints: [], errors: [] };
    for (const s of stmts.children) {
      const r = s.toAST();
      if (r.kind === 'fact') output.facts.push(r.fact);
      else if (r.kind === 'rule') output.rules.push(r.rule);
      else if (r.kind === 'constraint') output.constraints.push(r.constraint);
    }
    return output;
  },

  // Statement_rule body is: Rule "."  → arity 2
  Statement_rule(rule, _dot) {
    return rule.toAST();
  },

  // Statement_constraint body is: Constraint "."  → arity 2
  Statement_constraint(constraint, _dot) {
    return constraint.toAST();
  },

  // Constraint = ":-" NonemptyListOf<BodyLit, ",">  → arity 2
  Constraint(_arrow, bodyList) {
    const body: StoredAtom[] = bodyList.asIteration().children.map((b: any) => b.toAST());
    return { kind: 'constraint', constraint: { body } };
  },

  // Rule = Atom ":-" NonemptyListOf<BodyLit, ",">  → arity 3
  Rule(atom, _arrow, bodyList) {
    const head: StoredAtom = atom.toAST();
    const body: StoredAtom[] = bodyList.asIteration().children.map((b: any) => b.toAST());
    return { kind: 'rule', rule: { head, body } };
  },

  // Statement_fact body is: Fact "."  → arity 2
  Statement_fact(fact, _dot) {
    const a: StoredAtom = fact.toAST();
    const args: Constant[] = [];
    for (const t of a.args) {
      if (isVariable(t) || isWildcard(t)) {
        return { kind: 'error', message: `Fact contains variable: ${t}` };
      }
      args.push(parseConstant(t));
    }
    return { kind: 'fact', fact: { pred: a.pred, args } };
  },

  // Fact = Atom  → arity 1
  Fact(atom) {
    return atom.toAST();
  },

  // BodyLit = SumLit | Atom  → arity 1 (non-inline alternation)
  BodyLit(child) {
    return child.toAST();
  },

  SumLit(_, _lp, aggVar, _c1, pattern, _c2, outVar, _rp) {
    const patAtom: StoredAtom = pattern.toAST();
    // Serialize the inner atom back to a string so the evaluator can re-parse it
    const patStr = serializeAtom(patAtom);
    return {
      pred: 'sum',
      args: [aggVar.toAST() as string, patStr, outVar.toAST() as string],
    } as StoredAtom;
  },

  Atom_args(pred, _lp, argList, _rp) {
    const args: Term[] = argList.asIteration().children.map((t: any) => t.toAST() as string);
    return { pred: pred.sourceString, args } as StoredAtom;
  },

  Atom_bare(pred) {
    return { pred: pred.sourceString, args: [] } as StoredAtom;
  },

  Term_wildcard(_) {
    return '_';
  },

  // Term_num body is: number  → arity 1
  Term_num(num) {
    return num.sourceString.trim();
  },

  Term_name(id) {
    return id.sourceString;
  },

  ident(_first, _rest) {
    return this.sourceString;
  },

  _iter(...children) {
    return children.map(c => c.toAST());
  },

  _terminal() {
    return this.sourceString;
  },
});

// ─── Public parse function ────────────────────────────────────────────────────

function isVariable(t: string): boolean {
  return t.length > 0 && t[0] >= 'A' && t[0] <= 'Z';
}

function isWildcard(t: string): boolean {
  return t === '_';
}

export function parseConstant(s: string): Constant {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

export function parseProgram(text: string): ParseResult {
  const errors: ParseResult['errors'] = [];

  // Try parsing the whole program
  const matchResult = grammar.match(text);

  if (matchResult.failed()) {
    // Return a single error for the whole program; include position hint from ohm
    const msg = matchResult.message ?? 'Parse error';
    // Compute approximate line number from offset
    const offset = (matchResult as any).getRightmostFailurePosition?.() ?? 0;
    const line = text.slice(0, offset).split('\n').length;
    errors.push({ line, text: '', message: msg });
    return { facts: [], rules: [], constraints: [], errors };
  }

  const output: ParseOutput = semantics(matchResult).toAST();

  // Collect any fact-level variable errors that came back
  return {
    facts: output.facts,
    rules: output.rules,
    constraints: output.constraints,
    errors: [...errors, ...output.errors],
  };
}

// Parse a single atom string (used by sum evaluator)
export function parseAtom(s: string): StoredAtom | null {
  // Wrap in a dummy fact statement for parsing
  const m = grammar.match(s.trim() + '.', 'Fact');
  if (m.failed()) return null;
  return semantics(m).toAST();
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

type Bindings = Map<string, Constant>;

function matchAtom(atom: StoredAtom, fact: StoredFact, bindings: Bindings): Bindings | null {
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
      if (parseConstant(t) !== v) return null;
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
    if (a === undefined || b === undefined) return null;
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
    if (a === undefined || b === undefined) return null;
    return CMP[pred](Number(a), Number(b)) ? bindings : null;
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
    if (a === undefined || b === undefined) return null;
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
    return parseConstant(outTerm) === result ? bindings : null;
  }

  return null;
}

// Evaluate sum(aggVar, patternStr, outVar) against the current DB.
// Groups matches by all variables in the pattern except aggVar.
// Returns one bindings extension per group.
function evalSum(atom: StoredAtom, db: StoredFact[], bindings: Bindings): Bindings[] {
  const [aggVarTerm, patternStr, outTerm] = atom.args;

  const pattern = parseAtom(String(patternStr));
  if (!pattern) return [];

  // Substitute current bindings into pattern terms
  const substitutedPattern: StoredAtom = {
    pred: pattern.pred,
    args: pattern.args.map(t => {
      if (isWildcard(t)) return t;
      if (isVariable(t)) {
        const v = bindings.get(t);
        return v !== undefined ? String(v) : t;
      }
      return t;
    }),
  };

  // Find all matches of the substituted pattern in DB
  type Match = { groupKey: string; groupBindings: Bindings; aggValue: number };
  const matches: Match[] = [];

  for (const fact of db) {
    const b = matchAtom(substitutedPattern, fact, new Map());
    if (b === null) continue;

    // Determine aggregate value
    let aggValue: number;
    if (isWildcard(aggVarTerm)) {
      aggValue = 1; // count mode
    } else if (isVariable(aggVarTerm)) {
      const v = b.get(aggVarTerm);
      if (v === undefined) continue; // aggVar not bound — skip
      aggValue = Number(v);
    } else {
      aggValue = Number(parseConstant(aggVarTerm));
    }

    // Group key = all bound variables in this match EXCEPT aggVar
    // (these become the "output" keys for grouping)
    const groupBindings = new Map(b);
    if (isVariable(aggVarTerm)) groupBindings.delete(aggVarTerm);

    const groupKey = JSON.stringify([...groupBindings.entries()].sort());
    matches.push({ groupKey, groupBindings, aggValue });
  }

  // Handle the no-matches case: zero groups → no results normally.
  // Special case: if pattern has no free group variables, produce a single
  // group with sum=0 so rules like `sum(G, generates(_, G), Total)` that
  // have an empty DB still fire (Total=0).
  if (matches.length === 0) {
    // Check if there are no group variables at all (global aggregation)
    const hasGroupVars = substitutedPattern.args.some(
      t => isVariable(t) && t !== aggVarTerm
    );
    if (!hasGroupVars) {
      // Yield a single result with sum=0
      return [bindOut(bindings, outTerm, 0)].filter(Boolean) as Bindings[];
    }
    return [];
  }

  // Aggregate: group by groupKey, sum aggValues
  const groups = new Map<string, { groupBindings: Bindings; total: number }>();
  for (const m of matches) {
    if (groups.has(m.groupKey)) {
      groups.get(m.groupKey)!.total += m.aggValue;
    } else {
      groups.set(m.groupKey, { groupBindings: m.groupBindings, total: m.aggValue });
    }
  }

  // Produce result bindings
  const results: Bindings[] = [];
  for (const { groupBindings, total } of groups.values()) {
    // Merge group bindings into current bindings
    const merged = new Map(bindings);
    for (const [k, v] of groupBindings) {
      merged.set(k, v);
    }
    const extended = bindOut(merged, outTerm, total);
    if (extended) results.push(extended);
  }
  return results;
}

function bindOut(bindings: Bindings, outTerm: Term, value: number): Bindings | null {
  if (isWildcard(outTerm)) return bindings;
  if (isVariable(outTerm)) {
    const existing = bindings.get(outTerm);
    if (existing !== undefined && existing !== value) return null;
    const b = new Map(bindings);
    b.set(outTerm, value);
    return b;
  }
  // constant: check equality
  return parseConstant(outTerm) === value ? bindings : null;
}

const SIMPLE_BUILTINS = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'add', 'sub', 'mul', 'div']);

function matchBody(body: StoredAtom[], db: StoredFact[], bindings: Bindings): Bindings[] {
  if (body.length === 0) return [bindings];
  const [first, ...rest] = body;

  // sum aggregation
  if (first.pred === 'sum') {
    const results: Bindings[] = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBody(rest, db, b));
    }
    return results;
  }

  // simple built-ins
  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    return matchBody(rest, db, b);
  }

  // regular DB lookup
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
    if (isWildcard(t)) return null;
    if (isVariable(t)) {
      const v = bindings.get(t);
      if (v === undefined) return null;
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

// ─── Tracked matching (builds GroundBodyStep[] alongside bindings) ────────────

type TrackedResult = { bindings: Bindings; steps: GroundBodyStep[] };

function matchBodyTracked(
  body: StoredAtom[],
  db: StoredFact[],
  bindings: Bindings,
  steps: GroundBodyStep[],
): TrackedResult[] {
  if (body.length === 0) return [{ bindings, steps }];
  const [first, ...rest] = body;

  // sum aggregation: treat like a builtin — contribute bindings but no fact step
  if (first.pred === 'sum') {
    const results: TrackedResult[] = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBodyTracked(rest, db, b, steps));
    }
    return results;
  }

  // simple built-ins
  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    const resolve = (t: Term): Constant => {
      if (isWildcard(t)) return '_';
      if (isVariable(t)) return b.get(t) ?? bindings.get(t) ?? t;
      return parseConstant(t);
    };
    const step: GroundBodyStep = { kind: 'builtin', atom: first, resolvedArgs: first.args.map(resolve) };
    return matchBodyTracked(rest, db, b, [...steps, step]);
  }

  // regular DB lookup
  const results: TrackedResult[] = [];
  for (const fact of db) {
    const b = matchAtom(first, fact, bindings);
    if (b !== null) {
      const step: GroundBodyStep = { kind: 'fact', fact, isBase: false };
      results.push(...matchBodyTracked(rest, db, b, [...steps, step]));
    }
  }
  return results;
}

export function evaluateWithProvenance(
  facts: StoredFact[],
  rules: StoredRule[],
): { db: StoredFact[]; provenance: ProvenanceMap } {
  const db: StoredFact[] = [...facts];
  const seen = new Set<string>(facts.map(factKey));
  const provenance: ProvenanceMap = new Map();

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      for (const { bindings, steps } of matchBodyTracked(rule.body, db, new Map(), [])) {
        const derived = substituteHead(rule.head, bindings);
        if (!derived) continue;
        const key = factKey(derived);
        if (!seen.has(key)) {
          seen.add(key);
          db.push(derived);
          changed = true;
          const groundBody = steps
            .filter((s): s is Extract<GroundBodyStep, { kind: 'fact' }> => s.kind === 'fact')
            .map(s => s.fact);
          provenance.set(key, { rule, groundBody });
        }
      }
    }
  }

  return { db, provenance };
}

export function checkConstraints(
  db: StoredFact[],
  constraints: StoredConstraint[],
  provenance: ProvenanceMap,
  baseFacts: Set<string>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const constraint of constraints) {
    const tracked = matchBodyTracked(constraint.body, db, new Map(), []);
    if (tracked.length === 0) continue;
    const witnesses: WitnessTrace[] = tracked.map(({ bindings, steps }) => ({
      bindings: Object.fromEntries(bindings.entries()) as Record<string, Constant>,
      steps: steps.map(step => {
        if (step.kind === 'builtin') return step;
        const key = factKey(step.fact);
        const isBase = baseFacts.has(key);
        const derivedBy = provenance.get(key);
        return { kind: 'fact' as const, fact: step.fact, isBase, derivedBy };
      }),
    }));
    violations.push({ constraint, witnesses });
  }
  return violations;
}
