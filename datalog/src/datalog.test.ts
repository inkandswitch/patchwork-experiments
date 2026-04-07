import { describe, it, expect } from 'vitest';
import {
  parseProgram,
  parseAtom,
  parseConstant,
  evaluate,
  evaluateWithProvenance,
  checkConstraints,
  serializeFacts,
  serializeRules,
  serializeConstraints,
  factKey,
  ruleKey,
  type StoredFact,
  type StoredRule,
  type StoredConstraint,
} from './datalog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fact(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

function factsOf(db: StoredFact[], pred: string): StoredFact[] {
  return db.filter(f => f.pred === pred);
}

function sortedKeys(facts: StoredFact[]): string[] {
  return facts.map(factKey).sort();
}

// ─── parseConstant ────────────────────────────────────────────────────────────

describe('parseConstant', () => {
  it('parses integers', () => {
    expect(parseConstant('42')).toBe(42);
    expect(parseConstant('-10')).toBe(-10);
  });

  it('parses floats', () => {
    expect(parseConstant('3.14')).toBeCloseTo(3.14);
  });

  it('returns string for non-numeric tokens', () => {
    expect(parseConstant('north')).toBe('north');
    expect(parseConstant('hello_world')).toBe('hello_world');
  });
});

// ─── factKey / ruleKey ────────────────────────────────────────────────────────

describe('factKey', () => {
  it('serializes a bare predicate', () => {
    expect(factKey({ pred: 'ok', args: [] })).toBe('ok');
  });

  it('serializes a predicate with args', () => {
    expect(factKey(fact('edge', 'north', 'south', 500))).toBe('edge(north, south, 500)');
  });
});

describe('ruleKey', () => {
  it('serializes head :- body', () => {
    const { rules } = parseProgram('reachable(X, Y) :- edge(X, Y, _).');
    expect(ruleKey(rules[0])).toBe('reachable(X, Y) :- edge(X, Y, _)');
  });
});

// ─── parseProgram ─────────────────────────────────────────────────────────────

describe('parseProgram', () => {
  it('parses facts', () => {
    const { facts, errors } = parseProgram('node(north, generator).');
    expect(errors).toHaveLength(0);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({ pred: 'node', args: ['north', 'generator'] });
  });

  it('parses numeric fact args as numbers', () => {
    const { facts } = parseProgram('edge(north, central, 500).');
    expect(facts[0].args[2]).toBe(500);
  });

  it('parses a bare (0-arity) fact', () => {
    const { facts } = parseProgram('online.');
    expect(facts[0]).toEqual({ pred: 'online', args: [] });
  });

  it('parses a rule', () => {
    const { rules, errors } = parseProgram('reachable(X, Y) :- edge(X, Y, _).');
    expect(errors).toHaveLength(0);
    expect(rules).toHaveLength(1);
    expect(rules[0].head).toEqual({ pred: 'reachable', args: ['X', 'Y'] });
    expect(rules[0].body).toHaveLength(1);
    expect(rules[0].body[0]).toEqual({ pred: 'edge', args: ['X', 'Y', '_'] });
  });

  it('parses a multi-body rule', () => {
    const { rules } = parseProgram('overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).');
    expect(rules[0].body).toHaveLength(3);
  });

  it('parses a constraint', () => {
    const { constraints, errors } = parseProgram(':- overloaded(X, Y).');
    expect(errors).toHaveLength(0);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].body[0]).toEqual({ pred: 'overloaded', args: ['X', 'Y'] });
  });

  it('parses a sum body literal', () => {
    const { rules } = parseProgram('inflow(N, Total) :- sum(F, flow(_, N, F), Total).');
    const sumAtom = rules[0].body[0];
    expect(sumAtom.pred).toBe('sum');
    expect(sumAtom.args[0]).toBe('F');   // aggVar
    expect(sumAtom.args[2]).toBe('Total'); // outVar
  });

  it('ignores % comments', () => {
    const { facts } = parseProgram('% comment\nnode(x, y).');
    expect(facts).toHaveLength(1);
  });

  it('ignores // comments', () => {
    const { facts } = parseProgram('// comment\nnode(x, y).');
    expect(facts).toHaveLength(1);
  });

  it('returns errors for invalid syntax', () => {
    const { errors } = parseProgram('this is not valid!!!');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('parses multiple statements in one pass', () => {
    const src = `
      node(a, generator).
      node(b, load).
      connected(X, Y) :- edge(X, Y, _).
      :- overloaded(X, Y).
    `;
    const { facts, rules, constraints, errors } = parseProgram(src);
    expect(errors).toHaveLength(0);
    expect(facts).toHaveLength(2);
    expect(rules).toHaveLength(1);
    expect(constraints).toHaveLength(1);
  });

  it('parses negative numbers', () => {
    const { facts } = parseProgram('temp(sensor, -10).');
    expect(facts[0].args[1]).toBe(-10);
  });

  it('parses decimal numbers', () => {
    const { facts } = parseProgram('geopos(node, 52.55, 13.37).');
    expect(facts[0].args[1]).toBeCloseTo(52.55);
    expect(facts[0].args[2]).toBeCloseTo(13.37);
  });
});

// ─── parseAtom ────────────────────────────────────────────────────────────────

describe('parseAtom', () => {
  it('parses a simple atom', () => {
    expect(parseAtom('flow(north, south, 100)')).toEqual({
      pred: 'flow',
      args: ['north', 'south', '100'],
    });
  });

  it('parses a bare atom', () => {
    expect(parseAtom('ok')).toEqual({ pred: 'ok', args: [] });
  });

  it('returns null for invalid input', () => {
    expect(parseAtom('!!!')).toBeNull();
  });
});

// ─── evaluate: basic derivation ───────────────────────────────────────────────

describe('evaluate', () => {
  it('applies a single-step rule', () => {
    const facts = [fact('edge', 'a', 'b', 1)];
    const { rules } = parseProgram('reachable(X, Y) :- edge(X, Y, _).');
    const db = evaluate(facts, rules);
    const reach = factsOf(db, 'reachable');
    expect(reach).toHaveLength(1);
    expect(reach[0]).toEqual(fact('reachable', 'a', 'b'));
  });

  it('derives transitively reachable nodes', () => {
    const { facts } = parseProgram('edge(a,b,1). edge(b,c,1). edge(c,d,1).');
    const { rules } = parseProgram(`
      reachable(X, Y) :- edge(X, Y, _).
      reachable(X, Z) :- reachable(X, Y), edge(Y, Z, _).
    `);
    const db = evaluate(facts, rules);
    const reach = factsOf(db, 'reachable').map(f => f.args.join('→')).sort();
    expect(reach).toEqual(['a→b', 'a→c', 'a→d', 'b→c', 'b→d', 'c→d']);
  });

  it('does not derive duplicates', () => {
    const { facts } = parseProgram('edge(a,b,1). edge(a,b,1).');
    const { rules } = parseProgram('reachable(X, Y) :- edge(X, Y, _).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'reachable')).toHaveLength(1);
  });

  it('returns only base facts when no rules match', () => {
    const facts = [fact('node', 'a', 'b')];
    const db = evaluate(facts, []);
    expect(db).toEqual(facts);
  });

  // ─── built-ins ────────────────────────────────────────────────────────────

  it('filters with gt', () => {
    const { facts } = parseProgram('edge(a,b,600). edge(c,d,400).');
    const { rules } = parseProgram('big_edge(X, Y) :- edge(X, Y, C), gt(C, 500).');
    const db = evaluate(facts, rules);
    const big = factsOf(db, 'big_edge');
    expect(big).toHaveLength(1);
    expect(big[0].args).toEqual(['a', 'b']);
  });

  it('filters with lte', () => {
    const { facts } = parseProgram('val(10). val(20). val(5).');
    const { rules } = parseProgram('small(X) :- val(X), lte(X, 10).');
    const db = evaluate(facts, rules);
    const small = factsOf(db, 'small').map(f => f.args[0] as number).sort((a, b) => a - b);
    expect(small).toEqual([5, 10]);
  });

  it('computes with add', () => {
    const { facts } = parseProgram('pair(3, 4).');
    const { rules } = parseProgram('total(S) :- pair(A, B), add(A, B, S).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'total')[0].args[0]).toBe(7);
  });

  it('computes with sub', () => {
    const { facts } = parseProgram('pair(10, 3).');
    const { rules } = parseProgram('diff(D) :- pair(A, B), sub(A, B, D).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'diff')[0].args[0]).toBe(7);
  });

  it('computes with mul', () => {
    const { facts } = parseProgram('pair(6, 7).');
    const { rules } = parseProgram('product(P) :- pair(A, B), mul(A, B, P).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'product')[0].args[0]).toBe(42);
  });

  it('computes with div', () => {
    const { facts } = parseProgram('pair(10, 4).');
    const { rules } = parseProgram('quotient(Q) :- pair(A, B), div(A, B, Q).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'quotient')[0].args[0]).toBeCloseTo(2.5);
  });

  it('uses eq to filter matching values', () => {
    const { facts } = parseProgram('item(a, hot). item(b, cold).');
    const { rules } = parseProgram('hot_item(X) :- item(X, T), eq(T, hot).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'hot_item').map(f => f.args[0])).toEqual(['a']);
  });

  it('uses neq to exclude matching values', () => {
    const { facts } = parseProgram('item(a, hot). item(b, cold).');
    const { rules } = parseProgram('not_hot(X) :- item(X, T), neq(T, hot).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'not_hot').map(f => f.args[0])).toEqual(['b']);
  });

  // ─── sum aggregation ──────────────────────────────────────────────────────

  it('sums values with sum(aggVar, pattern, outVar)', () => {
    const { facts } = parseProgram('flow(a, b, 100). flow(a, b, 50). flow(b, c, 200).');
    const { rules } = parseProgram('total_flow(T) :- sum(F, flow(_, _, F), T).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'total_flow')[0].args[0]).toBe(350);
  });

  it('groups by remaining variables in sum', () => {
    const { facts } = parseProgram('flow(a, b, 100). flow(a, c, 50). flow(b, c, 200).');
    const { rules } = parseProgram('outflow(N, T) :- sum(F, flow(N, _, F), T).');
    const db = evaluate(facts, rules);
    const out = factsOf(db, 'outflow');
    const map = Object.fromEntries(out.map(f => [f.args[0], f.args[1]]));
    expect(map['a']).toBe(150);
    expect(map['b']).toBe(200);
  });

  it('counts rows with sum(_, pattern, Count)', () => {
    const { facts } = parseProgram('node(a). node(b). node(c).');
    const { rules } = parseProgram('count(N) :- sum(_, node(_), N).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'count')[0].args[0]).toBe(3);
  });

  it('produces 0 for global sum over empty set', () => {
    const { rules } = parseProgram('total(T) :- sum(F, flow(_, _, F), T).');
    const db = evaluate([], rules);
    expect(factsOf(db, 'total')[0].args[0]).toBe(0);
  });

  // ─── wildcard ─────────────────────────────────────────────────────────────

  it('wildcard matches anything without binding', () => {
    const { facts } = parseProgram('triple(1, 2, 3).');
    const { rules } = parseProgram('found(X) :- triple(X, _, _).');
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'found')[0].args[0]).toBe(1);
  });

  // ─── power-grid scenario ──────────────────────────────────────────────────

  it('derives overloaded edges from the power-grid example', () => {
    const src = `
      edge(north, central, 500).
      flow(north, central, 600).
      overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'overloaded')).toHaveLength(1);
    expect(factsOf(db, 'overloaded')[0].args).toEqual(['north', 'central']);
  });

  it('does not mark within-capacity edges as overloaded', () => {
    const src = `
      edge(north, central, 500).
      flow(north, central, 400).
      overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'overloaded')).toHaveLength(0);
  });
});

// ─── evaluateWithProvenance ───────────────────────────────────────────────────

describe('evaluateWithProvenance', () => {
  it('records provenance for derived facts', () => {
    const { facts } = parseProgram('edge(a, b, 1).');
    const { rules } = parseProgram('reachable(X, Y) :- edge(X, Y, _).');
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const key = factKey(fact('reachable', 'a', 'b'));
    expect(provenance.has(key)).toBe(true);
    const entry = provenance.get(key)!;
    expect(entry.rule).toEqual(rules[0]);
    expect(entry.groundBody).toHaveLength(1);
    expect(entry.groundBody[0]).toEqual(fact('edge', 'a', 'b', 1));
  });

  it('does not record provenance for base facts', () => {
    const { facts } = parseProgram('edge(a, b, 1).');
    const { provenance } = evaluateWithProvenance(facts, []);
    expect(provenance.has(factKey(facts[0]))).toBe(false);
  });

  it('handles transitive chains', () => {
    const { facts } = parseProgram('edge(a,b,1). edge(b,c,1).');
    const { rules } = parseProgram(`
      reachable(X, Y) :- edge(X, Y, _).
      reachable(X, Z) :- reachable(X, Y), edge(Y, Z, _).
    `);
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const key = factKey(fact('reachable', 'a', 'c'));
    expect(provenance.has(key)).toBe(true);
  });
});

// ─── checkConstraints ─────────────────────────────────────────────────────────

describe('checkConstraints', () => {
  it('reports no violations when constraint body is unsatisfiable', () => {
    const facts = [fact('edge', 'a', 'b', 100)];
    const { constraints } = parseProgram(':- overloaded(X, Y).');
    const { db, provenance } = evaluateWithProvenance(facts, []);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when constraint body is satisfied', () => {
    const src = `
      edge(a, b, 100).
      overloaded(a, b).
    `;
    const { facts } = parseProgram(src);
    const { constraints } = parseProgram(':- overloaded(X, Y).');
    const { db, provenance } = evaluateWithProvenance(facts, []);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(1);
    expect(violations[0].witnesses).toHaveLength(1);
    expect(violations[0].witnesses[0].bindings['X']).toBe('a');
    expect(violations[0].witnesses[0].bindings['Y']).toBe('b');
  });

  it('distinguishes base facts from derived facts in witness steps', () => {
    const src = `
      edge(a, b, 100).
      flow(a, b, 200).
    `;
    const { facts } = parseProgram(src);
    const { rules } = parseProgram('overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).');
    const { constraints } = parseProgram(':- overloaded(X, Y).');
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(1);
    const step = violations[0].witnesses[0].steps[0];
    expect(step.kind).toBe('fact');
    if (step.kind === 'fact') {
      // overloaded(a,b) is derived, not a base fact
      expect(step.isBase).toBe(false);
      expect(step.derivedBy).toBeDefined();
    }
  });

  it('reports multiple witnesses when multiple bindings satisfy the body', () => {
    const { facts } = parseProgram('overloaded(a, b). overloaded(c, d).');
    const { constraints } = parseProgram(':- overloaded(X, Y).');
    const { db, provenance } = evaluateWithProvenance(facts, []);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations[0].witnesses).toHaveLength(2);
  });
});

// ─── Serialization round-trips ────────────────────────────────────────────────

describe('serialization', () => {
  it('serializeFacts round-trips through parseProgram', () => {
    const original = [
      fact('node', 'north', 'generator'),
      fact('edge', 'north', 'central', 500),
    ];
    const text = serializeFacts(original);
    const { facts, errors } = parseProgram(text);
    expect(errors).toHaveLength(0);
    expect(sortedKeys(facts)).toEqual(sortedKeys(original));
  });

  it('serializeRules round-trips through parseProgram', () => {
    const src = `
      reachable(X, Y) :- edge(X, Y, _).
      reachable(X, Z) :- reachable(X, Y), edge(Y, Z, _).
    `;
    const { rules: original } = parseProgram(src);
    const text = serializeRules(original);
    const { rules, errors } = parseProgram(text);
    expect(errors).toHaveLength(0);
    expect(rules.map(ruleKey).sort()).toEqual(original.map(ruleKey).sort());
  });

  it('serializeConstraints round-trips through parseProgram', () => {
    const { constraints: original } = parseProgram(':- overloaded(X, Y).');
    const text = serializeConstraints(original);
    const { constraints, errors } = parseProgram(text);
    expect(errors).toHaveLength(0);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].body).toEqual(original[0].body);
  });

  it('serializeFacts handles bare (0-arity) predicates', () => {
    const original = [fact('online')];
    const text = serializeFacts(original);
    expect(text).toBe('online.');
    const { facts } = parseProgram(text);
    expect(facts[0]).toEqual(original[0]);
  });

  it('serializeRules uses multi-line format for long bodies', () => {
    const { rules } = parseProgram(
      'node_balanced(N) :- generates(N, G), consumes(N, C), sum(F, flow(_, N, F), In), sum(F, flow(N, _, F), Out), add(In, G, S), add(Out, C, D), gte(S, D).'
    );
    const text = serializeRules(rules);
    expect(text).toContain('\n');
  });
});

// ─── Full pipeline (parse → evaluate → check) ────────────────────────────────

describe('full pipeline', () => {
  it('runs a balanced two-node grid without violations', () => {
    // a generates 50, b consumes 50, flow of 50 on the edge - everything balanced.
    const src = `
      edge(a, b, 100).
      flow(a, b, 50).
      generates(a, 50). generates(b, 0).
      consumes(a, 0).   consumes(b, 50).

      overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
      node_flow_balance(N, Net) :-
        generates(N, G), consumes(N, C),
        sum(F, flow(_, N, F), In), sum(F, flow(N, _, F), Out),
        add(In, G, Supply), add(Out, C, Demand),
        sub(Supply, Demand, Net).

      :- overloaded(X, Y).
      :- node_flow_balance(N, Net), neq(Net, 0).
    `;
    const { facts, rules, constraints, errors } = parseProgram(src);
    expect(errors).toHaveLength(0);

    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(0);
  });

  it('the default power-grid scenario derives expected facts', () => {
    // Verify key derivations rather than constraint satisfaction (the demo data
    // is intentionally "interesting" and can have conservation imbalances).
    const src = `
      edge(north, central, 500).
      edge(central, south, 600).
      flow(north, central, 400).
      flow(central, south, 350).

      reachable(X, Y) :- edge(X, Y, _).
      reachable(X, Z) :- reachable(X, Y), edge(Y, Z, _).
      within_capacity(X, Y) :- edge(X, Y, C), flow(X, Y, F), lte(F, C).
      overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
      inflow(N, Total) :- sum(F, flow(_, N, F), Total).
      outflow(N, Total) :- sum(F, flow(N, _, F), Total).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);

    // Both edges are within capacity
    expect(factsOf(db, 'within_capacity')).toHaveLength(2);
    expect(factsOf(db, 'overloaded')).toHaveLength(0);

    // Transitive reachability: north→central, north→south, central→south
    expect(factsOf(db, 'reachable')).toHaveLength(3);

    // Inflows / outflows
    const inflowMap = Object.fromEntries(factsOf(db, 'inflow').map(f => [f.args[0], f.args[1]]));
    expect(inflowMap['central']).toBe(400);
    expect(inflowMap['south']).toBe(350);

    const outflowMap = Object.fromEntries(factsOf(db, 'outflow').map(f => [f.args[0], f.args[1]]));
    expect(outflowMap['north']).toBe(400);
    expect(outflowMap['central']).toBe(350);
  });

  it('detects a node conservation violation', () => {
    // a generates 50 but flows 80 out — net at a is 50 - 80 = -30, violating conservation.
    const src = `
      edge(a, b, 100).
      flow(a, b, 80).
      generates(a, 50). generates(b, 0).
      consumes(a, 0).   consumes(b, 50).

      node_flow_balance(N, Net) :-
        generates(N, G), consumes(N, C),
        sum(F, flow(_, N, F), In), sum(F, flow(N, _, F), Out),
        add(In, G, Supply), add(Out, C, Demand),
        sub(Supply, Demand, Net).

      :- node_flow_balance(N, Net), neq(Net, 0).
    `;
    const { facts, rules, constraints, errors } = parseProgram(src);
    expect(errors).toHaveLength(0);

    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);

    // Both nodes are unbalanced: a has net -30, b has net +30
    expect(violations).toHaveLength(1);
    const offenders = violations[0].witnesses.map(w => ({
      node: w.bindings['N'],
      net: w.bindings['Net'],
    }));
    expect(offenders).toHaveLength(2);
    expect(offenders.find(o => o.node === 'a')?.net).toBe(-30);
    expect(offenders.find(o => o.node === 'b')?.net).toBe(30);
  });

  it('detects an overloaded edge', () => {
    const src = `
      edge(a, b, 100).
      flow(a, b, 200).
      overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
      :- overloaded(X, Y).
    `;
    const { facts, rules, constraints } = parseProgram(src);
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(1);
  });
});

// ─── String literals ──────────────────────────────────────────────────────────

describe('string literals', () => {
  it('parses a string literal in a fact', () => {
    const { facts, errors } = parseProgram('machine("192.168.1.10").');
    expect(errors).toHaveLength(0);
    expect(facts).toHaveLength(1);
    expect(facts[0].args[0]).toBe('192.168.1.10');
  });

  it('parses CIDR notation as a string literal', () => {
    const { facts } = parseProgram('blocked("10.0.0.0/8").');
    expect(facts[0].args[0]).toBe('10.0.0.0/8');
  });

  it('parses mixed bare-ident and string-literal args', () => {
    const { facts } = parseProgram('rule(machine_a, "input", 1, "accept", "0.0.0.0/0", "tcp", 80).');
    expect(facts[0].args).toEqual(['machine_a', 'input', 1, 'accept', '0.0.0.0/0', 'tcp', 80]);
  });

  it('string literal in rule body matches fact constant', () => {
    const src = `
      rule(a, input, 1, accept).
      allows(M) :- rule(M, "input", _, "accept").
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'allows')).toHaveLength(1);
    expect(factsOf(db, 'allows')[0].args[0]).toBe('a');
  });

  it('parseConstant strips surrounding quotes', () => {
    expect(parseConstant('"hello"')).toBe('hello');
    expect(parseConstant('"192.168.1.0/24"')).toBe('192.168.1.0/24');
  });

  it('parseConstant treats quoted numeric string as string', () => {
    expect(parseConstant('"42"')).toBe('42');
  });

  it('serializeFacts round-trips string constants', () => {
    const original = [
      fact('rule', 'machine_a', 'input', 1, 'accept', '192.168.1.0/24', 'tcp', 22),
    ];
    const text = serializeFacts(original);
    expect(text).toContain('"192.168.1.0/24"');
    const { facts, errors } = parseProgram(text);
    expect(errors).toHaveLength(0);
    expect(sortedKeys(facts)).toEqual(sortedKeys(original));
  });

  it('serializeFacts does not quote valid identifiers', () => {
    const original = [fact('node', 'north', 'generator')];
    const text = serializeFacts(original);
    expect(text).toBe('node(north, generator).');
  });

  it('constraints with string literals detect violations', () => {
    const src = `
      rule(a, "input", 1, "accept", "0.0.0.0/0", "tcp", 22).
      :- rule(_, "input", _, "accept", "0.0.0.0/0", _, 22).
    `;
    const { facts, rules, constraints } = parseProgram(src);
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(1);
  });
});

// ─── ip_in built-in ───────────────────────────────────────────────────────────

describe('ip_in', () => {
  it('point-in-range: single IP inside CIDR', () => {
    const src = `
      addr("10.0.0.1").
      range("10.0.0.0/8").
      contained(A) :- addr(A), range(R), ip_in(A, R).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'contained')).toHaveLength(1);
    expect(factsOf(db, 'contained')[0].args[0]).toBe('10.0.0.1');
  });

  it('point-in-range: IP outside CIDR returns no match', () => {
    const src = `
      addr("192.168.1.1").
      range("10.0.0.0/8").
      contained(A) :- addr(A), range(R), ip_in(A, R).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'contained')).toHaveLength(0);
  });

  it('range-subset: narrow CIDR inside broad CIDR', () => {
    const src = `
      narrow("10.0.0.0/24").
      broad("10.0.0.0/8").
      subset(N) :- narrow(N), broad(B), ip_in(N, B).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'subset')).toHaveLength(1);
  });

  it('range-subset: broad CIDR is NOT inside narrow CIDR', () => {
    const src = `
      broad("10.0.0.0/8").
      narrow("10.0.0.0/24").
      subset(B) :- broad(B), narrow(N), ip_in(B, N).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'subset')).toHaveLength(0);
  });

  it('same IP treated as /32 matches itself', () => {
    const src = `
      a("10.0.0.1").
      b("10.0.0.1").
      same(X) :- a(X), b(Y), ip_in(X, Y).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'same')).toHaveLength(1);
  });

  it('0.0.0.0/0 contains everything', () => {
    const src = `
      addr("192.168.1.1").
      contained(A) :- addr(A), ip_in(A, "0.0.0.0/0").
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'contained')).toHaveLength(1);
  });

  it('constraint detects blocked IP allowed by a broad rule', () => {
    const src = `
      blocked_ip("10.0.0.1").
      rule(a, "input", 1, "accept", "10.0.0.0/8", "tcp", 80).
      :- blocked_ip(IP), rule(_, "input", _, "accept", Src, _, _), ip_in(IP, Src).
    `;
    const { facts, rules, constraints } = parseProgram(src);
    const { db, provenance } = evaluateWithProvenance(facts, rules);
    const baseFacts = new Set(facts.map(factKey));
    const violations = checkConstraints(db, constraints, provenance, baseFacts);
    expect(violations).toHaveLength(1);
  });

  it('detects redundant iptables rules via ip_in', () => {
    const src = `
      rule(a, "input", 1, "drop", "10.0.0.0/8", "any", "any").
      rule(a, "input", 2, "drop", "10.0.0.1", "any", "any").
      redundant(M, Idx) :-
          rule(M, Chain, Idx, Action, Src, Proto, Port),
          rule(M, Chain, Earlier, Action, Broader, Proto, Port),
          lt(Earlier, Idx),
          ip_in(Src, Broader).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    const redundant = factsOf(db, 'redundant');
    expect(redundant).toHaveLength(1);
    expect(redundant[0].args).toEqual(['a', 2]);
  });

  it('returns no match for non-IP strings', () => {
    const src = `
      a("hello").
      b("world").
      match(X) :- a(X), b(Y), ip_in(X, Y).
    `;
    const { facts, rules } = parseProgram(src);
    const db = evaluate(facts, rules);
    expect(factsOf(db, 'match')).toHaveLength(0);
  });
});
