/**
 * Datalog skill — read/write a Datalog database document, run queries, and check constraints.
 *
 * DatalogDoc shape:
 *   { facts: StoredFact[], rules: StoredRule[], constraints: StoredConstraint[], draftText?: string }
 *
 * StoredTextRangeRef: {
 *   docUrl: string,
 *   path: (string|number)[],
 *   from: Cursor,
 *   to: Cursor,
 * }
 * StoredAttribution:{ refs: StoredTextRangeRef[] }
 * StoredFact:      { pred: string, args: (string|number)[], comment?: string, attribution?: StoredAttribution }
 * StoredAtom:      { pred: string, args: string[] }
 * StoredRule:      { head: StoredAtom, body: StoredAtom[], comment?: string, attribution?: StoredAttribution }
 * StoredConstraint:{ name: string, body: StoredAtom[], comment?: string, attribution?: StoredAttribution }
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
  if (a.pred === 'not' && a.args.length === 1 && typeof a.args[0] === 'object' && a.args[0] !== null) {
    return `not(${serializeAtom(a.args[0])})`;
  }
  if (!a.args || a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}

function ruleKey(r) {
  return `${serializeAtom(r.head)} :- ${r.body.map(serializeAtom).join(', ')}`;
}

function constraintKey(c) {
  return `:- ${c.body.map(serializeAtom).join(', ')}`;
}

function copyAtom(a) {
  if (a.pred === 'not' && a.args.length === 1 && typeof a.args[0] === 'object' && a.args[0] !== null) {
    return { pred: 'not', args: [copyAtom(a.args[0])] };
  }
  return { pred: a.pred, args: [...a.args] };
}

function extractFactOptions(commentOrOptions, maybeOptions) {
  if (typeof commentOrOptions === 'string' || commentOrOptions === undefined) {
    return {
      comment: commentOrOptions,
      options: maybeOptions ?? {},
    };
  }

  return {
    comment: commentOrOptions.comment,
    options: commentOrOptions,
  };
}

function mergeAttribution(existing, incoming) {
  if (!existing && !incoming) return undefined;
  return normalizeAttribution({
    refs: [
      ...(existing?.refs ?? []),
      ...(incoming?.refs ?? []),
    ],
  });
}

function normalizeAttribution(attribution) {
  if (!attribution?.refs) return undefined;

  const refs = [];
  const seen = new Set();
  for (const rangeRef of attribution.refs) {
    const normalizedRef = normalizeStoredRangeRef(rangeRef);
    const key = JSON.stringify([
      normalizedRef.docUrl,
      normalizedRef.path,
      normalizedRef.from,
      normalizedRef.to,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(normalizedRef);
  }

  return refs.length > 0 ? { refs } : undefined;
}

function normalizeStoredRangeRef(rangeRef) {
  if (typeof rangeRef?.docUrl !== 'string') {
    throw new Error('Attribution refs require a docUrl');
  }
  if (!Array.isArray(rangeRef.path)) {
    throw new Error('Attribution refs require path to be an array');
  }
  if (rangeRef.from == null || rangeRef.to == null) {
    throw new Error('Attribution refs require from/to cursors');
  }

  return {
    docUrl: rangeRef.docUrl,
    path: [...rangeRef.path],
    from: rangeRef.from,
    to: rangeRef.to,
  };
}

function normalizeRangeInput(range) {
  if (typeof range?.docUrl !== 'string') {
    throw new Error('Attribution ranges require a docUrl');
  }
  if (!Array.isArray(range.path)) {
    throw new Error('Attribution ranges require path to be an array');
  }

  const quote = typeof range.quote === 'string' ? range.quote : range.snippet;
  if (typeof quote === 'string') {
    const prefix = range.prefix ?? range.before;
    const suffix = range.suffix ?? range.after;
    if (quote.length === 0) {
      throw new Error('Attribution quotes must not be empty');
    }
    if (prefix !== undefined && typeof prefix !== 'string') {
      throw new Error('Attribution prefix must be a string when provided');
    }
    if (suffix !== undefined && typeof suffix !== 'string') {
      throw new Error('Attribution suffix must be a string when provided');
    }

    return {
      docUrl: range.docUrl,
      path: [...range.path],
      quote,
      prefix,
      suffix,
    };
  }

  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error('Attribution ranges require either quote text or integer start/end offsets');
  }
  if (start < 0 || end < 0) {
    throw new Error('Attribution ranges cannot be negative');
  }
  if (end <= start) {
    throw new Error('Attribution ranges must have end > start');
  }

  return {
    docUrl: range.docUrl,
    path: [...range.path],
    start,
    end,
  };
}

function resolveOffsetsFromQuote(text, normalizedRange) {
  const candidates = [];
  let searchFrom = 0;
  while (searchFrom <= text.length) {
    const start = text.indexOf(normalizedRange.quote, searchFrom);
    if (start === -1) break;
    const end = start + normalizedRange.quote.length;
    if (matchesContext(text, start, end, normalizedRange.prefix, normalizedRange.suffix)) {
      candidates.push({ start, end });
    }
    searchFrom = start + 1;
  }

  if (candidates.length === 0) {
    throw new Error(
      `Could not find quoted attribution text in ${normalizedRange.docUrl}: ${JSON.stringify(normalizedRange.quote)}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Quoted attribution text is ambiguous in ${normalizedRange.docUrl}; provide a longer quote or add prefix/suffix context`,
    );
  }

  return candidates[0];
}

function matchesContext(text, start, end, prefix, suffix) {
  if (prefix !== undefined) {
    const prefixIndex = text.lastIndexOf(prefix, start);
    if (prefixIndex === -1 || prefixIndex + prefix.length > start) {
      return false;
    }
  }
  if (suffix !== undefined) {
    const suffixIndex = text.indexOf(suffix, end);
    if (suffixIndex === -1) {
      return false;
    }
  }
  return true;
}

function getAutomerge() {
  const automerge = globalThis.Automerge;
  if (!automerge?.getCursor) {
    throw new Error('Automerge global is not available in the skill runtime');
  }
  return automerge;
}

function resolveValueAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (current == null) return undefined;
    if (typeof segment !== 'string' && typeof segment !== 'number') {
      throw new Error(`Unsupported attribution path segment: ${String(segment)}`);
    }
    current = current[segment];
  }
  return current;
}

async function createRangeRef(range) {
  const normalizedRange = normalizeRangeInput(range);
  const handle = await repo.find(normalizedRange.docUrl);
  const doc = handle.doc();
  if (!doc) {
    throw new Error(`Could not load document for attribution: ${normalizedRange.docUrl}`);
  }

  const textValue = resolveValueAtPath(doc, normalizedRange.path);
  if (typeof textValue !== 'string' && !(textValue instanceof String)) {
    throw new Error(
      `Attribution path ${JSON.stringify(normalizedRange.path)} does not resolve to text in ${normalizedRange.docUrl}`,
    );
  }

  const textLength = String(textValue).length;
  const offsets =
    'quote' in normalizedRange
      ? resolveOffsetsFromQuote(String(textValue), normalizedRange)
      : normalizedRange;
  if (offsets.end > textLength) {
    throw new Error(
      `Attribution range ${offsets.start}-${offsets.end} is out of bounds for text length ${textLength}`,
    );
  }

  const Automerge = getAutomerge();
  const start = Math.min(offsets.start, offsets.end);
  const end = Math.max(offsets.start, offsets.end);

  return {
    docUrl: normalizedRange.docUrl,
    path: normalizedRange.path,
    from: Automerge.getCursor(doc, normalizedRange.path, start, 'before'),
    to: Automerge.getCursor(doc, normalizedRange.path, end, 'after'),
  };
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

  if (first.pred === 'not') {
    const innerAtom = first.args[0];
    if (typeof innerAtom !== 'object' || !innerAtom.pred) return [];
    const hasMatch = db.some((fact) => matchAtom(innerAtom, fact, bindings) !== null);
    if (hasMatch) return [];
    return matchBody(rest, db, bindings);
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

  if (first.pred === 'not') {
    const innerAtom = first.args[0];
    if (typeof innerAtom !== 'object' || !innerAtom.pred) return [];
    const hasMatch = db.some((fact) => matchAtom(innerAtom, fact, bindings) !== null);
    if (hasMatch) return [];
    const step = { kind: 'not', atom: innerAtom };
    return matchBodyTracked(rest, db, bindings, [...steps, step]);
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

  assertFact(pred, args, commentOrOptions, maybeOptions) {
    const { comment, options } = extractFactOptions(commentOrOptions, maybeOptions);
    const key = factKey({ pred, args });
    const normalizedAttribution = normalizeAttribution(options?.attribution);
    this._handle.change((d) => {
      const existing = (d.facts ?? []).find((f) => factKey(f) === key);
      if (!existing) {
        const fact = { pred, args };
        if (comment !== undefined) fact.comment = comment;
        if (normalizedAttribution) fact.attribution = normalizedAttribution;
        d.facts.push(fact);
        return;
      }

      if (comment !== undefined) existing.comment = comment;
      const mergedAttribution = mergeAttribution(existing.attribution, normalizedAttribution);
      if (mergedAttribution) existing.attribution = mergedAttribution;
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

  assertRule(rule, options) {
    const key = ruleKey(rule);
    const normalizedAttribution = normalizeAttribution(options?.attribution ?? rule.attribution);
    this._handle.change((d) => {
      const existing = (d.rules ?? []).find((r) => ruleKey(r) === key);
      if (!existing) {
        const nextRule = {
          head: { pred: rule.head.pred, args: [...rule.head.args] },
          body: rule.body.map(copyAtom),
        };
        if (rule.comment !== undefined) nextRule.comment = rule.comment;
        if (normalizedAttribution) nextRule.attribution = normalizedAttribution;
        d.rules.push(nextRule);
        return;
      }

      if (rule.comment !== undefined) existing.comment = rule.comment;
      const mergedAttribution = mergeAttribution(existing.attribution, normalizedAttribution);
      if (mergedAttribution) existing.attribution = mergedAttribution;
    });
  }

  retractRule(rule) {
    const key = ruleKey(rule);
    this._handle.change((d) => {
      const keep = (d.rules ?? []).filter((r) => ruleKey(r) !== key);
      d.rules.splice(0, d.rules.length, ...keep);
    });
  }

  assertConstraint(name, constraint, options) {
    const key = constraintKey(constraint);
    const normalizedAttribution = normalizeAttribution(options?.attribution ?? constraint.attribution);
    this._handle.change((d) => {
      const existing = (d.constraints ?? []).find((c) => constraintKey(c) === key);
      if (!existing) {
        const nextConstraint = {
          name,
          body: constraint.body.map(copyAtom),
        };
        if (constraint.comment !== undefined) nextConstraint.comment = constraint.comment;
        if (normalizedAttribution) nextConstraint.attribution = normalizedAttribution;
        d.constraints.push(nextConstraint);
        return;
      }

      existing.name = name;
      if (constraint.comment !== undefined) existing.comment = constraint.comment;
      const mergedAttribution = mergeAttribution(existing.attribution, normalizedAttribution);
      if (mergedAttribution) existing.attribution = mergedAttribution;
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
 * repo.create() is SYNCHRONOUS — do NOT await it.
 *
 * @param {string} [title] - Optional title stored in the document
 * @returns {DocDatalog} A document-backed Datalog instance
 */
export function createDatalog(title) {
  const handle = repo.create();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.facts = [];
    d.rules = [];
    d.constraints = [];
    if (title) d.title = title;
  });
  return new DocDatalog(handle);
}

/**
 * Get a read/write interface for an existing Datalog database document.
 *
 * @param {string} url - Automerge URL of the DatalogDoc
 * @returns {Promise<DocDatalog>} A document-backed Datalog instance
 */
export async function getDatalog(url) {
  const handle = await repo.find(url);
  return new DocDatalog(handle);
}

/**
 * Merge multiple Datalog documents into a single read-only in-memory instance.
 * No Automerge document is created — the result is purely for evaluation.
 *
 * @param {string[]} urls - Automerge URLs of DatalogDocs to merge
 * @returns {Promise<Datalog>} A read-only Datalog with only query() and checkConflicts()
 */
export async function mergeDatalog(urls) {
  const facts = [];
  const rules = [];
  const constraints = [];
  for (const srcUrl of urls) {
    const handle = await repo.find(srcUrl);
    const doc = handle.doc();
    for (const f of doc?.facts ?? []) facts.push(f);
    for (const r of doc?.rules ?? []) rules.push(r);
    for (const c of doc?.constraints ?? []) constraints.push(c);
  }
  return new Datalog(facts, rules, constraints);
}

/**
 * Convert offset-based text ranges into stable cursor-based attribution refs.
 *
 * @param {{ docUrl: string, path: (string|number)[], start: number, end: number }[]} ranges
 * @returns {Promise<{ refs: { docUrl: string, path: (string|number)[], from: any, to: any }[] }>}
 */
export async function makeAttribution(ranges) {
  if (!Array.isArray(ranges)) {
    throw new Error('makeAttribution expects an array of text ranges');
  }

  const refs = [];
  for (const range of ranges) {
    refs.push(await createRangeRef(range));
  }
  return normalizeAttribution({ refs }) ?? { refs: [] };
}
