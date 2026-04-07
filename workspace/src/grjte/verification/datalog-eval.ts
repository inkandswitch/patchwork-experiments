/**
 * Minimal datalog evaluator for constraint checking.
 * Ported from workspace/agent-configs/plan-agent/skills/datalog/index.js
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Constant = string | number;
export type Term = string;

export type StoredFact = { pred: string; args: Constant[]; comment?: string };
export type StoredAtom = { pred: string; args: Term[] };
export type StoredRule = { head: StoredAtom; body: StoredAtom[]; comment?: string };
export type StoredConstraint = { body: StoredAtom[]; comment?: string; name?: string };

export type ConstraintViolation = {
  constraint: StoredConstraint;
  witnesses: WitnessTrace[];
};

type WitnessTrace = {
  bindings: Record<string, Constant>;
  steps: GroundBodyStep[];
};

type GroundBodyStep =
  | { kind: 'fact'; fact: StoredFact; isBase: boolean; derivedBy?: ProvenanceEntry }
  | { kind: 'builtin'; atom: StoredAtom; resolvedArgs: Constant[] };

type ProvenanceEntry = { rule: StoredRule; groundBody: StoredFact[] };
type Bindings = Map<string, Constant>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isVariable(t: Term): boolean {
  return t.length > 0 && t[0] >= 'A' && t[0] <= 'Z';
}

function isWildcard(t: Term): boolean {
  return t === '_';
}

function parseConstant(s: string): Constant {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

export function factKey(f: StoredFact): string {
  if (!f.args || f.args.length === 0) return f.pred;
  return `${f.pred}(${f.args.join(', ')})`;
}

function parseAtom(s: string): StoredAtom {
  s = s.trim();
  const parenIdx = s.indexOf('(');
  if (parenIdx === -1) return { pred: s, args: [] };
  const pred = s.slice(0, parenIdx).trim();
  const inner = s.slice(parenIdx + 1, s.lastIndexOf(')')).trim();
  const args = inner ? inner.split(',').map((a) => a.trim()) : [];
  return { pred, args };
}

// ─── Matching ─────────────────────────────────────────────────────────────────

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

// ─── Built-in predicates ──────────────────────────────────────────────────────

const CMP: Record<string, (a: number, b: number) => boolean> = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
};

const ARITH: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
};

const SIMPLE_BUILTINS = new Set([
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'neq',
  'add',
  'sub',
  'mul',
  'div',
]);

function evalBuiltin(atom: StoredAtom, bindings: Bindings): Bindings | null {
  const resolve = (t: Term): Constant | undefined => {
    if (isWildcard(t)) return undefined;
    if (isVariable(t)) return bindings.get(t);
    return parseConstant(t);
  };

  const { pred, args } = atom;

  if ((pred === 'eq' || pred === 'neq') && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null;
    const equal = a === b;
    return (pred === 'eq' ? equal : !equal) ? bindings : null;
  }

  if (pred in CMP && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null;
    return CMP[pred](Number(a), Number(b)) ? bindings : null;
  }

  if (pred in ARITH && args.length === 3) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null;
    const result = ARITH[pred](Number(a), Number(b));
    return bindOut(bindings, args[2], result);
  }

  return null;
}

function bindOut(bindings: Bindings, outTerm: Term, value: Constant): Bindings | null {
  if (isWildcard(outTerm)) return bindings;
  if (isVariable(outTerm)) {
    const existing = bindings.get(outTerm);
    if (existing !== undefined && existing !== value) return null;
    const b = new Map(bindings);
    b.set(outTerm, value);
    return b;
  }
  return parseConstant(outTerm) === value ? bindings : null;
}

// ─── Sum aggregation ──────────────────────────────────────────────────────────

function evalSum(atom: StoredAtom, db: StoredFact[], bindings: Bindings): Bindings[] {
  const [aggVarTerm, patternStr, outTerm] = atom.args;
  const pattern = parseAtom(String(patternStr));

  const substitutedPattern: StoredAtom = {
    pred: pattern.pred,
    args: pattern.args.map((t) => {
      if (isWildcard(t)) return t;
      if (isVariable(t)) {
        const v = bindings.get(t);
        return v !== undefined ? String(v) : t;
      }
      return t;
    }),
  };

  const matches: { groupKey: string; groupBindings: Bindings; aggValue: number }[] = [];
  for (const fact of db) {
    const b = matchAtom(substitutedPattern, fact, new Map());
    if (b === null) continue;

    let aggValue: number;
    if (isWildcard(aggVarTerm)) {
      aggValue = 1;
    } else if (isVariable(aggVarTerm)) {
      const v = b.get(aggVarTerm);
      if (v === undefined) continue;
      aggValue = Number(v);
    } else {
      aggValue = Number(parseConstant(aggVarTerm));
    }

    const groupBindings = new Map(b);
    if (isVariable(aggVarTerm)) groupBindings.delete(aggVarTerm);
    const groupKey = JSON.stringify([...groupBindings.entries()].sort());
    matches.push({ groupKey, groupBindings, aggValue });
  }

  if (matches.length === 0) {
    const hasGroupVars = substitutedPattern.args.some(
      (t) => isVariable(t) && t !== aggVarTerm,
    );
    if (!hasGroupVars) {
      const bound = bindOut(bindings, outTerm, 0);
      return bound ? [bound] : [];
    }
    return [];
  }

  const groups = new Map<string, { groupBindings: Bindings; total: number }>();
  for (const m of matches) {
    if (groups.has(m.groupKey)) {
      groups.get(m.groupKey)!.total += m.aggValue;
    } else {
      groups.set(m.groupKey, { groupBindings: m.groupBindings, total: m.aggValue });
    }
  }

  const results: Bindings[] = [];
  for (const { groupBindings, total } of groups.values()) {
    const merged = new Map(bindings);
    for (const [k, v] of groupBindings) merged.set(k, v);
    const extended = bindOut(merged, outTerm, total);
    if (extended) results.push(extended);
  }
  return results;
}

// ─── Body matching ────────────────────────────────────────────────────────────

function matchBody(body: StoredAtom[], db: StoredFact[], bindings: Bindings): Bindings[] {
  if (body.length === 0) return [bindings];
  const [first, ...rest] = body;

  if (first.pred === 'sum') {
    const results: Bindings[] = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBody(rest, db, b));
    }
    return results;
  }

  if (first.pred === 'not') {
    // Negation: not(pred(args...))
    const inner = parseAtom(first.args[0]);
    const found = db.some((fact) => matchAtom(inner, fact, bindings) !== null);
    return found ? [] : matchBody(rest, db, bindings);
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    return matchBody(rest, db, b);
  }

  const results: Bindings[] = [];
  for (const fact of db) {
    const b = matchAtom(first, fact, bindings);
    if (b !== null) results.push(...matchBody(rest, db, b));
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

// ─── Evaluation ───────────────────────────────────────────────────────────────

function evaluate(facts: StoredFact[], rules: StoredRule[]): StoredFact[] {
  const db = [...facts];
  const seen = new Set(facts.map(factKey));

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

// ─── Tracked matching (for provenance) ────────────────────────────────────────

type TrackedResult = { bindings: Bindings; steps: GroundBodyStep[] };

function matchBodyTracked(
  body: StoredAtom[],
  db: StoredFact[],
  bindings: Bindings,
  steps: GroundBodyStep[],
): TrackedResult[] {
  if (body.length === 0) return [{ bindings, steps }];
  const [first, ...rest] = body;

  if (first.pred === 'sum') {
    const results: TrackedResult[] = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBodyTracked(rest, db, b, steps));
    }
    return results;
  }

  if (first.pred === 'not') {
    const inner = parseAtom(first.args[0]);
    const found = db.some((fact) => matchAtom(inner, fact, bindings) !== null);
    return found ? [] : matchBodyTracked(rest, db, bindings, steps);
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    const resolve = (t: Term): Constant => {
      if (isWildcard(t)) return '_';
      if (isVariable(t)) return b.get(t) ?? bindings.get(t) ?? t;
      return parseConstant(t);
    };
    const step: GroundBodyStep = {
      kind: 'builtin',
      atom: first,
      resolvedArgs: first.args.map(resolve),
    };
    return matchBodyTracked(rest, db, b, [...steps, step]);
  }

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

function evaluateWithProvenance(
  facts: StoredFact[],
  rules: StoredRule[],
): { db: StoredFact[]; provenance: Map<string, ProvenanceEntry> } {
  const db = [...facts];
  const seen = new Set(facts.map(factKey));
  const provenance = new Map<string, ProvenanceEntry>();

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
            .map((s) => s.fact);
          provenance.set(key, { rule, groundBody });
        }
      }
    }
  }

  return { db, provenance };
}

function runCheckConstraints(
  db: StoredFact[],
  constraints: StoredConstraint[],
  provenance: Map<string, ProvenanceEntry>,
  baseFacts: Set<string>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const constraint of constraints) {
    const tracked = matchBodyTracked(constraint.body, db, new Map(), []);
    if (tracked.length === 0) continue;
    const witnesses: WitnessTrace[] = tracked.map(({ bindings, steps }) => ({
      bindings: Object.fromEntries(bindings.entries()) as Record<string, Constant>,
      steps: steps.map((step) => {
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

// ─── Public API ───────────────────────────────────────────────────────────────

export class Datalog {
  private _facts: StoredFact[];
  private _rules: StoredRule[];
  private _constraints: StoredConstraint[];

  constructor(facts: StoredFact[], rules: StoredRule[], constraints: StoredConstraint[]) {
    this._facts = facts;
    this._rules = rules;
    this._constraints = constraints;
  }

  get facts() {
    return this._facts;
  }

  get rules() {
    return this._rules;
  }

  get constraints() {
    return this._constraints;
  }

  query(pred?: string): StoredFact[] {
    const db = evaluate(this.facts, this.rules);
    return pred ? db.filter((f) => f.pred === pred) : db;
  }

  checkConflicts(constraintName?: string): ConstraintViolation[] {
    let constraints = this.constraints;
    if (constraintName) {
      constraints = constraints.filter((c) => c.name === constraintName);
    }
    if (constraints.length === 0) return [];

    const { db, provenance } = evaluateWithProvenance(this.facts, this.rules);
    const baseFacts = new Set(this.facts.map(factKey));
    return runCheckConstraints(db, constraints, provenance, baseFacts);
  }
}
