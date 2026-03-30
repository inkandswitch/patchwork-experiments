/**
 * Datalog skill — read/write a Datalog database document, run queries, and check constraints.
 *
 * DatalogDoc shape:
 *   { facts: StoredFact[], rules: StoredRule[], constraints: StoredConstraint[], draftText?: string }
 *
 * StoredFact:      { pred: string, args: (string|number)[], comment?: string }
 * StoredAtom:      { pred: string, args: string[] }
 * StoredRule:      { head: StoredAtom, body: StoredAtom[], comment?: string }
 * StoredConstraint:{ name: string, body: StoredAtom[], comment?: string }
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isVariable(t) {
  return t.length > 0 && t[0] >= 'A' && t[0] <= 'Z';
}

function isWildcard(t) {
  return t === '_';
}

function parseConstant(s) {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

function serializeFact(f) {
  if (!f.args || f.args.length === 0) return f.pred + '.';
  return `${f.pred}(${f.args.join(', ')}).`;
}

function factKey(f) {
  if (!f.args || f.args.length === 0) return f.pred;
  return `${f.pred}(${f.args.join(', ')})`;
}

function serializeAtom(a) {
  if (!a.args || a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}

function ruleKey(r) {
  return `${serializeAtom(r.head)} :- ${r.body.map(serializeAtom).join(', ')}`;
}

function constraintKey(c) {
  return `:- ${c.body.map(serializeAtom).join(', ')}`;
}

/**
 * Parse a simple atom string like "pred(arg1, arg2)" or "pred".
 * Used by the sum aggregation evaluator.
 */
function parseAtom(s) {
  s = s.trim();
  const parenIdx = s.indexOf('(');
  if (parenIdx === -1) return { pred: s, args: [] };
  const pred = s.slice(0, parenIdx).trim();
  const inner = s.slice(parenIdx + 1, s.lastIndexOf(')')).trim();
  const args = inner ? inner.split(',').map((a) => a.trim()) : [];
  return { pred, args };
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function matchAtom(atom, fact, bindings) {
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

function evalBuiltin(atom, bindings) {
  const resolve = (t) => {
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

  const CMP = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b };
  if (pred in CMP && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null;
    return CMP[pred](Number(a), Number(b)) ? bindings : null;
  }

  const ARITH = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b };
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

function bindOut(bindings, outTerm, value) {
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

function evalSum(atom, db, bindings) {
  const [aggVarTerm, patternStr, outTerm] = atom.args;
  const pattern = parseAtom(String(patternStr));
  if (!pattern) return [];

  const substitutedPattern = {
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

  const matches = [];
  for (const fact of db) {
    const b = matchAtom(substitutedPattern, fact, new Map());
    if (b === null) continue;

    let aggValue;
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
      return [bindOut(bindings, outTerm, 0)].filter(Boolean);
    }
    return [];
  }

  const groups = new Map();
  for (const m of matches) {
    if (groups.has(m.groupKey)) {
      groups.get(m.groupKey).total += m.aggValue;
    } else {
      groups.set(m.groupKey, { groupBindings: m.groupBindings, total: m.aggValue });
    }
  }

  const results = [];
  for (const { groupBindings, total } of groups.values()) {
    const merged = new Map(bindings);
    for (const [k, v] of groupBindings) merged.set(k, v);
    const extended = bindOut(merged, outTerm, total);
    if (extended) results.push(extended);
  }
  return results;
}

const SIMPLE_BUILTINS = new Set(['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'add', 'sub', 'mul', 'div']);

function matchBody(body, db, bindings) {
  if (body.length === 0) return [bindings];
  const [first, ...rest] = body;

  if (first.pred === 'sum') {
    const results = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBody(rest, db, b));
    }
    return results;
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    return matchBody(rest, db, b);
  }

  const results = [];
  for (const fact of db) {
    const b = matchAtom(first, fact, bindings);
    if (b !== null) results.push(...matchBody(rest, db, b));
  }
  return results;
}

function substituteHead(head, bindings) {
  const args = [];
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

function evaluate(facts, rules) {
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

// ─── Tracked matching (builds steps alongside bindings for provenance) ────────

function matchBodyTracked(body, db, bindings, steps) {
  if (body.length === 0) return [{ bindings, steps }];
  const [first, ...rest] = body;

  if (first.pred === 'sum') {
    const results = [];
    for (const b of evalSum(first, db, bindings)) {
      results.push(...matchBodyTracked(rest, db, b, steps));
    }
    return results;
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const b = evalBuiltin(first, bindings);
    if (b === null) return [];
    const resolve = (t) => {
      if (isWildcard(t)) return '_';
      if (isVariable(t)) return b.get(t) ?? bindings.get(t) ?? t;
      return parseConstant(t);
    };
    const step = { kind: 'builtin', atom: first, resolvedArgs: first.args.map(resolve) };
    return matchBodyTracked(rest, db, b, [...steps, step]);
  }

  const results = [];
  for (const fact of db) {
    const b = matchAtom(first, fact, bindings);
    if (b !== null) {
      const step = { kind: 'fact', fact, isBase: false };
      results.push(...matchBodyTracked(rest, db, b, [...steps, step]));
    }
  }
  return results;
}

function evaluateWithProvenance(facts, rules) {
  const db = [...facts];
  const seen = new Set(facts.map(factKey));
  const provenance = new Map();

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
            .filter((s) => s.kind === 'fact')
            .map((s) => s.fact);
          provenance.set(key, { rule, groundBody });
        }
      }
    }
  }

  return { db, provenance };
}

function runCheckConstraints(db, constraints, provenance, baseFacts) {
  const violations = [];
  for (const constraint of constraints) {
    const tracked = matchBodyTracked(constraint.body, db, new Map(), []);
    if (tracked.length === 0) continue;
    const witnesses = tracked.map(({ bindings, steps }) => ({
      bindings: Object.fromEntries(bindings.entries()),
      steps: steps.map((step) => {
        if (step.kind === 'builtin') return step;
        const key = factKey(step.fact);
        const isBase = baseFacts.has(key);
        const derivedBy = provenance.get(key);
        return { kind: 'fact', fact: step.fact, isBase, derivedBy };
      }),
    }));
    violations.push({ constraint, witnesses });
  }
  return violations;
}

// ─── Datalog class (read-only, for evaluation) ───────────────────────────────

export class Datalog {
  constructor(facts, rules, constraints) {
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

  query(pred) {
    const db = evaluate(this.facts, this.rules);
    return pred ? db.filter((f) => f.pred === pred) : db;
  }

  checkConflicts(constraintName) {
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

// ─── DocDatalog class (read/write, backed by Automerge doc) ──────────────────

export class DocDatalog extends Datalog {
  constructor(handle) {
    super([], [], []);
    this._handle = handle;
  }

  get url() {
    return this._handle.url;
  }

  get facts() {
    return this._handle.doc()?.facts ?? [];
  }

  get rules() {
    return this._handle.doc()?.rules ?? [];
  }

  get constraints() {
    return this._handle.doc()?.constraints ?? [];
  }

  getFacts(pred) {
    const facts = this.facts;
    return pred ? facts.filter((f) => f.pred === pred) : [...facts];
  }

  getRules(pred) {
    const rules = this.rules;
    return pred ? rules.filter((r) => r.head.pred === pred) : [...rules];
  }

  getConstraints() {
    return [...this.constraints];
  }

  assertFact(pred, args, comment) {
    const key = factKey({ pred, args });
    this._handle.change((d) => {
      const exists = (d.facts ?? []).some((f) => factKey(f) === key);
      if (!exists) {
        const fact = { pred, args };
        if (comment !== undefined) fact.comment = comment;
        d.facts.push(fact);
      }
    });
  }

  retractFact(pred, args) {
    this._handle.change((d) => {
      const keep = (d.facts ?? []).filter((f) => {
        if (f.pred !== pred) return true;
        return !args.every((a, i) => String(f.args[i]) === String(a));
      });
      d.facts.splice(0, d.facts.length, ...keep);
    });
  }

  assertRule(rule) {
    const key = ruleKey(rule);
    this._handle.change((d) => {
      const exists = (d.rules ?? []).some((r) => ruleKey(r) === key);
      if (!exists) {
        d.rules.push({
          head: { pred: rule.head.pred, args: [...rule.head.args] },
          body: rule.body.map((a) => ({ pred: a.pred, args: [...a.args] })),
        });
      }
    });
  }

  retractRule(rule) {
    const key = ruleKey(rule);
    this._handle.change((d) => {
      const keep = (d.rules ?? []).filter((r) => ruleKey(r) !== key);
      d.rules.splice(0, d.rules.length, ...keep);
    });
  }

  assertConstraint(name, constraint) {
    const key = constraintKey(constraint);
    this._handle.change((d) => {
      const exists = (d.constraints ?? []).some((c) => constraintKey(c) === key);
      if (!exists) {
        d.constraints.push({
          name,
          body: constraint.body.map((a) => ({ pred: a.pred, args: [...a.args] })),
        });
      }
    });
  }

  retractConstraint(name) {
    this._handle.change((d) => {
      const keep = (d.constraints ?? []).filter((c) => c.name !== name);
      d.constraints.splice(0, d.constraints.length, ...keep);
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new empty Datalog database document.
 *
 * workspace.createDoc() is SYNCHRONOUS — do NOT await it.
 *
 * @param {object} workspace - The workspace object (global `workspace`)
 * @param {string} [title] - Optional title stored in the document
 * @returns {DocDatalog} A document-backed Datalog instance
 */
export function createDatalog(workspace, title) {
  const handle = workspace.createDoc();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.facts = [];
    d.rules = [];
    d.constraints = [];
    d.draftText = '';
    d.mapStyle = { lines: {}, properties: {} };
    if (title) d.title = title;
  });
  return new DocDatalog(handle);
}

/**
 * Get a read/write interface for an existing Datalog database document.
 *
 * @param {object} workspace - The workspace object (global `workspace`)
 * @param {string} url - Automerge URL of the DatalogDoc
 * @returns {Promise<DocDatalog>} A document-backed Datalog instance
 */
export async function getDatalog(workspace, url) {
  const handle = await workspace.find(url);
  return new DocDatalog(handle);
}

/**
 * Merge multiple Datalog documents into a single read-only in-memory instance.
 * No Automerge document is created — the result is purely for evaluation.
 *
 * @param {object} workspace - The workspace object (global `workspace`)
 * @param {string[]} urls - Automerge URLs of DatalogDocs to merge
 * @returns {Promise<Datalog>} A read-only Datalog with only query() and checkConflicts()
 */
export async function mergeDatalog(workspace, urls) {
  const facts = [];
  const rules = [];
  const constraints = [];
  for (const srcUrl of urls) {
    const handle = await workspace.find(srcUrl);
    const doc = handle.doc();
    for (const f of doc?.facts ?? []) facts.push(f);
    for (const r of doc?.rules ?? []) rules.push(r);
    for (const c of doc?.constraints ?? []) constraints.push(c);
  }
  return new Datalog(facts, rules, constraints);
}
