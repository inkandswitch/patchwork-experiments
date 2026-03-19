/**
 * Datalog skill — read/write a Datalog database document, run queries, and check constraints.
 *
 * DatalogDoc shape:
 *   { facts: StoredFact[], rules: StoredRule[], constraints: StoredConstraint[], draftText?: string }
 *
 * StoredFact:      { pred: string, args: (string|number)[], comment?: string }
 * StoredAtom:      { pred: string, args: string[] }
 * StoredRule:      { head: StoredAtom, body: StoredAtom[], comment?: string }
 * StoredConstraint:{ body: StoredAtom[], comment?: string }
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

function checkConstraints(db, constraints, provenance, baseFacts) {
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new empty Datalog database document.
 *
 * repo.create() is SYNCHRONOUS — do NOT await it.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} [title] - Optional title stored in the document
 * @returns {{ handle: object, url: string }} The new doc handle and its URL
 */
export function createDatalog(repo, title) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.facts = [];
    d.rules = [];
    d.constraints = [];
    d.draftText = '';
    d.mapStyle = { lines: {}, properties: {} };
    if (title) d.title = title;
  });
  return { handle, url: handle.url };
}

/**
 * Get a read/write interface for a Datalog database document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the DatalogDoc
 */
export async function getDatalog(repo, url) {
  const handle = await repo.find(url);

  return {
    /**
     * Return all base facts as StoredFact[].
     * Optionally filter by predicate name.
     */
    async getFacts(pred) {
      const facts = handle.doc()?.facts ?? [];
      return pred ? facts.filter((f) => f.pred === pred) : [...facts];
    },

    /**
     * Assert a ground fact. No-op if an identical fact already exists.
     * @param {string} pred - Predicate name, e.g. 'node', 'flow'
     * @param {Array<string|number>} args - Arguments, e.g. ['north'] or ['north', 'central', 500]
     * @param {string} [comment] - Optional comment shown above this fact when serialized
     */
    assertFact(pred, args, comment) {
      const key = factKey({ pred, args });
      handle.change((d) => {
        const exists = (d.facts ?? []).some((f) => factKey(f) === key);
        if (!exists) {
          const fact = { pred, args };
          if (comment !== undefined) fact.comment = comment;
          d.facts.push(fact);
        }
      });
    },

    /**
     * Retract all facts matching pred and an args prefix.
     * Pass all args for an exact match; fewer for a partial match.
     * e.g. retractFact('flow', ['north', 'central']) removes flow(north, central, *).
     * e.g. retractFact('node', ['north']) removes node(north).
     */
    retractFact(pred, args) {
      handle.change((d) => {
        const keep = (d.facts ?? []).filter((f) => {
          if (f.pred !== pred) return true;
          return !args.every((a, i) => String(f.args[i]) === String(a));
        });
        d.facts.splice(0, d.facts.length, ...keep);
      });
    },

    /**
     * Return all stored rules. Optionally filter by head predicate.
     */
    async getRules(pred) {
      const rules = handle.doc()?.rules ?? [];
      return pred ? rules.filter((r) => r.head.pred === pred) : [...rules];
    },

    /**
     * Assert a rule. No-op if an identical rule already exists.
     * @param {{ head: StoredAtom, body: StoredAtom[] }} rule
     */
    assertRule(rule) {
      const key = ruleKey(rule);
      handle.change((d) => {
        const exists = (d.rules ?? []).some((r) => ruleKey(r) === key);
        if (!exists) d.rules.push({ head: { pred: rule.head.pred, args: [...rule.head.args] }, body: rule.body.map((a) => ({ pred: a.pred, args: [...a.args] })) });
      });
    },

    /**
     * Retract all rules matching the given rule (by key equality).
     * @param {{ head: StoredAtom, body: StoredAtom[] }} rule
     */
    retractRule(rule) {
      const key = ruleKey(rule);
      handle.change((d) => {
        const keep = (d.rules ?? []).filter((r) => ruleKey(r) !== key);
        d.rules.splice(0, d.rules.length, ...keep);
      });
    },

    /**
     * Return all stored constraints.
     */
    async getConstraints() {
      return [...(handle.doc()?.constraints ?? [])];
    },

    /**
     * Assert a constraint. No-op if an identical constraint already exists.
     * @param {{ body: StoredAtom[] }} constraint
     */
    assertConstraint(constraint) {
      const key = constraintKey(constraint);
      handle.change((d) => {
        const exists = (d.constraints ?? []).some((c) => constraintKey(c) === key);
        if (!exists) d.constraints.push({ body: constraint.body.map((a) => ({ pred: a.pred, args: [...a.args] })) });
      });
    },

    /**
     * Retract all constraints matching the given constraint (by key equality).
     * @param {{ body: StoredAtom[] }} constraint
     */
    retractConstraint(constraint) {
      const key = constraintKey(constraint);
      handle.change((d) => {
        const keep = (d.constraints ?? []).filter((c) => constraintKey(c) !== key);
        d.constraints.splice(0, d.constraints.length, ...keep);
      });
    },
  };
}

/**
 * Evaluate all rules against the stored facts and return all derived facts.
 * Optionally filter by predicate name.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the DatalogDoc
 * @param {string} [pred] - Optional predicate to filter results
 * @returns {Promise<StoredFact[]>} All derived (and base) facts after rule evaluation
 */
export async function queryDatalog(repo, url, pred) {
  const handle = await repo.find(url);
  const doc = handle.doc();
  const facts = doc?.facts ?? [];
  const rules = doc?.rules ?? [];

  const db = evaluate(facts, rules);
  return pred ? db.filter((f) => f.pred === pred) : db;
}

/**
 * Run constraint checking against the stored facts + rules and return any violations.
 *
 * Each violation has:
 *   - `constraint`: the violated StoredConstraint
 *   - `witnesses`: array of { bindings, steps } traces explaining why it fired
 *     Each step is either:
 *       { kind: 'fact', fact, isBase, derivedBy? }  — a ground fact used in the match
 *       { kind: 'builtin', atom, resolvedArgs }      — a built-in comparison/arithmetic
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url - Automerge URL of the DatalogDoc
 * @returns {Promise<ConstraintViolation[]>} Array of violations (empty if none)
 */
export async function checkConflicts(repo, url) {
  const handle = await repo.find(url);
  const doc = handle.doc();
  const facts = doc?.facts ?? [];
  const rules = doc?.rules ?? [];
  const constraints = doc?.constraints ?? [];

  if (constraints.length === 0) return [];

  const { db, provenance } = evaluateWithProvenance(facts, rules);
  const baseFacts = new Set(facts.map(factKey));

  return checkConstraints(db, constraints, provenance, baseFacts);
}
