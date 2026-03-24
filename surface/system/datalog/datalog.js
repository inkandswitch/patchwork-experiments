import * as ohm from 'https://esm.sh/ohm-js@17';

// ─── Key derivation ───────────────────────────────────────────────────────────

function serializeConstant(c) {
  return String(c);
}

function serializeAtom(a) {
  if (a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}

function serializeFactAtom(f) {
  if (f.args.length === 0) return f.pred;
  return `${f.pred}(${f.args.map(serializeConstant).join(', ')})`;
}

export function factKey(f) {
  return serializeFactAtom(f);
}

export function ruleKey(r) {
  return `${serializeAtom(r.head)} :- ${r.body.map(serializeAtom).join(', ')}`;
}

// ─── Serialization (structure → text) ─────────────────────────────────────────

export function serializeFact(f) {
  const line = serializeFactAtom(f) + '.';
  return f.comment !== undefined ? `// ${f.comment}\n${line}` : line;
}

export function serializeFacts(facts) {
  return facts.map(serializeFact).join('\n');
}

export function serializeRule(r) {
  const head = serializeAtom(r.head);
  let body;
  if (r.body.length <= 1) {
    body = `${head} :- ${r.body.map(serializeAtom).join(', ')}.`;
  } else {
    const bodyLines = r.body.map((a, i) => {
      const isLast = i === r.body.length - 1;
      return `    ${serializeAtom(a)}${isLast ? '.' : ','}`;
    });
    body = `${head} :-\n${bodyLines.join('\n')}`;
  }
  return r.comment !== undefined ? `// ${r.comment}\n${body}` : body;
}

export function serializeRules(rules) {
  return rules.map(serializeRule).join('\n');
}

export function serializeConstraint(c) {
  const line = ':- ' + c.body.map(serializeAtom).join(', ') + '.';
  return c.comment !== undefined ? `// ${c.comment}\n${line}` : line;
}

export function serializeConstraints(constraints) {
  return constraints.map(serializeConstraint).join('\n');
}

// ─── Comment extraction ───────────────────────────────────────────────────────

function extractPrecedingComment(src, pos) {
  let p = pos - 1;

  while (p >= 0 && (src[p] === ' ' || src[p] === '\t')) p--;

  if (p < 0 || src[p] !== '\n') return undefined;
  p--;
  if (p >= 0 && src[p] === '\r') p--;

  const lineEnd = p;
  while (p >= 0 && src[p] !== '\n') p--;
  const lineStart = p + 1;

  const line = src.slice(lineStart, lineEnd + 1).trim();
  if (line === '') return undefined;

  if (line.startsWith('//')) return line.slice(2).trim();
  if (line.startsWith('%')) return line.slice(1).trim();
  return undefined;
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

const semantics = grammar.createSemantics();

semantics.addOperation('toAST', {
  Program(stmts) {
    const output = { facts: [], rules: [], constraints: [], errors: [] };
    for (const s of stmts.children) {
      const r = s.toAST();
      if (r.kind === 'fact') output.facts.push(r.fact);
      else if (r.kind === 'rule') output.rules.push(r.rule);
      else if (r.kind === 'constraint') output.constraints.push(r.constraint);
    }
    return output;
  },

  Statement_rule(rule, _dot) {
    const result = rule.toAST();
    const comment = extractPrecedingComment(this.source.sourceString, this.source.startIdx);
    if (comment !== undefined) result.rule.comment = comment;
    return result;
  },

  Statement_constraint(constraint, _dot) {
    const result = constraint.toAST();
    const comment = extractPrecedingComment(this.source.sourceString, this.source.startIdx);
    if (comment !== undefined) result.constraint.comment = comment;
    return result;
  },

  Constraint(_arrow, bodyList) {
    const body = bodyList.asIteration().children.map((b) => b.toAST());
    return { kind: 'constraint', constraint: { body } };
  },

  Rule(atom, _arrow, bodyList) {
    const head = atom.toAST();
    const body = bodyList.asIteration().children.map((b) => b.toAST());
    return { kind: 'rule', rule: { head, body } };
  },

  Statement_fact(fact, _dot) {
    const a = fact.toAST();
    const args = [];
    for (const t of a.args) {
      if (isVariable(t) || isWildcard(t)) {
        return { kind: 'error', message: `Fact contains variable: ${t}` };
      }
      args.push(parseConstant(t));
    }
    const comment = extractPrecedingComment(this.source.sourceString, this.source.startIdx);
    const storedFact = { pred: a.pred, args };
    if (comment !== undefined) storedFact.comment = comment;
    return { kind: 'fact', fact: storedFact };
  },

  Fact(atom) {
    return atom.toAST();
  },

  BodyLit(child) {
    return child.toAST();
  },

  SumLit(_, _lp, aggVar, _c1, pattern, _c2, outVar, _rp) {
    const patAtom = pattern.toAST();
    const patStr = serializeAtom(patAtom);
    return { pred: 'sum', args: [aggVar.toAST(), patStr, outVar.toAST()] };
  },

  Atom_args(pred, _lp, argList, _rp) {
    const args = argList.asIteration().children.map((t) => t.toAST());
    return { pred: pred.sourceString, args };
  },

  Atom_bare(pred) {
    return { pred: pred.sourceString, args: [] };
  },

  Term_wildcard(_) {
    return '_';
  },

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
    return children.map((c) => c.toAST());
  },

  _terminal() {
    return this.sourceString;
  },
});

// ─── Public parse function ────────────────────────────────────────────────────

function isVariable(t) {
  return t.length > 0 && t[0] >= 'A' && t[0] <= 'Z';
}

function isWildcard(t) {
  return t === '_';
}

export function parseConstant(s) {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

export function parseProgram(text) {
  const errors = [];

  const matchResult = grammar.match(text);

  if (matchResult.failed()) {
    const msg = matchResult.message ?? 'Parse error';
    const offset = matchResult.getRightmostFailurePosition?.() ?? 0;
    const line = text.slice(0, offset).split('\n').length;
    errors.push({ line, text: '', message: msg });
    return { facts: [], rules: [], constraints: [], errors };
  }

  const output = semantics(matchResult).toAST();

  return {
    facts: output.facts,
    rules: output.rules,
    constraints: output.constraints,
    errors: [...errors, ...output.errors],
  };
}

export function parseAtom(s) {
  const m = grammar.match(s.trim(), 'Fact');
  if (m.failed()) return null;
  return semantics(m).toAST();
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

  const CMP = {
    lt: (a, b) => a < b,
    lte: (a, b) => a <= b,
    gt: (a, b) => a > b,
    gte: (a, b) => a >= b,
  };
  if (pred in CMP && args.length === 2) {
    const a = resolve(args[0]);
    const b = resolve(args[1]);
    if (a === undefined || b === undefined) return null;
    return CMP[pred](Number(a), Number(b)) ? bindings : null;
  }

  const ARITH = {
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
    for (const [k, v] of groupBindings) {
      merged.set(k, v);
    }
    const extended = bindOut(merged, outTerm, total);
    if (extended) results.push(extended);
  }
  return results;
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

const SIMPLE_BUILTINS = new Set([
  'lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'add', 'sub', 'mul', 'div',
]);

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
    if (b !== null) {
      results.push(...matchBody(rest, db, b));
    }
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

export function evaluate(facts, rules) {
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

// ─── Tracked matching (builds GroundBodyStep[] alongside bindings) ────────────

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

export function evaluateWithProvenance(facts, rules) {
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

export function checkConstraints(db, constraints, provenance, baseFacts) {
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
