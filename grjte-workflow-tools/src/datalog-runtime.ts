import type {
  Constant,
  Term,
  StoredFact,
  StoredAtom,
  StoredRule,
  StoredConstraint,
} from "./spec/types";

export type ConstraintViolation = {
  constraint: StoredConstraint;
  witnesses: WitnessTrace[];
};

type WitnessTrace = {
  bindings: Record<string, Constant>;
  steps: GroundBodyStep[];
};

type GroundBodyStep =
  | {
      kind: "fact";
      fact: StoredFact;
      isBase: boolean;
      derivedBy?: ProvenanceEntry;
    }
  | { kind: "builtin"; atom: StoredAtom; resolvedArgs: Constant[] };

type ProvenanceEntry = { rule: StoredRule; groundBody: StoredFact[] };
type Bindings = Map<string, Constant>;

function isVariable(t: Term): boolean {
  return t.length > 0 && t[0] >= "A" && t[0] <= "Z";
}

function isWildcard(t: Term): boolean {
  return t === "_";
}

function parseConstant(value: string): Constant {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function serializeConstant(value: Constant): string {
  return String(value);
}

function serializeAtom(atom: StoredAtom): string {
  if (atom.pred === "not" && atom.args.length === 1) {
    return `not(${atom.args[0]})`;
  }
  if (!atom.args || atom.args.length === 0) return atom.pred;
  return `${atom.pred}(${atom.args.join(", ")})`;
}

function serializeFactAtom(fact: StoredFact): string {
  if (!fact.args || fact.args.length === 0) return fact.pred;
  return `${fact.pred}(${fact.args.map(serializeConstant).join(", ")})`;
}

export function factKey(fact: StoredFact): string {
  return serializeFactAtom(fact);
}

export function ruleKey(rule: StoredRule): string {
  return `${serializeAtom(rule.head)} :- ${rule.body.map(serializeAtom).join(", ")}`;
}

export function constraintKey(constraint: StoredConstraint): string {
  return `:- ${constraint.body.map(serializeAtom).join(", ")}`;
}

export function serializeFact(fact: StoredFact): string {
  const line = `${serializeFactAtom(fact)}.`;
  return fact.comment !== undefined ? `// ${fact.comment}\n${line}` : line;
}

export function serializeFacts(facts: StoredFact[]): string {
  return facts.map(serializeFact).join("\n");
}

export function serializeRule(rule: StoredRule): string {
  const head = serializeAtom(rule.head);
  let body: string;
  if (rule.body.length <= 1) {
    body = `${head} :- ${rule.body.map(serializeAtom).join(", ")}.`;
  } else {
    const bodyLines = rule.body.map((atom, index) => {
      const isLast = index === rule.body.length - 1;
      return `    ${serializeAtom(atom)}${isLast ? "." : ","}`;
    });
    body = `${head} :-\n${bodyLines.join("\n")}`;
  }
  return rule.comment !== undefined ? `// ${rule.comment}\n${body}` : body;
}

export function serializeRules(rules: StoredRule[]): string {
  return rules.map(serializeRule).join("\n");
}

export function serializeConstraint(constraint: StoredConstraint): string {
  const line = `:- ${constraint.body.map(serializeAtom).join(", ")}.`;
  return constraint.comment !== undefined
    ? `// ${constraint.comment}\n${line}`
    : line;
}

export function serializeConstraints(constraints: StoredConstraint[]): string {
  return constraints.map(serializeConstraint).join("\n");
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFactConstant(value: string): Constant {
  const unquoted = unquote(value.trim());
  const parsed = Number(unquoted);
  return Number.isNaN(parsed) ? unquoted : parsed;
}

function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && source.startsWith(delimiter, index)) {
      parts.push(source.slice(start, index));
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function findTopLevelOperator(source: string, operator: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && source.startsWith(operator, index)) {
      return index;
    }
  }

  return -1;
}

function consumeStatements(buffer: string): {
  statements: string[];
  remainder: string;
} {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && char === ".") {
      statements.push(buffer.slice(start, index));
      start = index + 1;
    }
  }

  return {
    statements,
    remainder: buffer.slice(start),
  };
}

function parseAtom(source: string): StoredAtom {
  const trimmed = source.trim();
  const parenIdx = trimmed.indexOf("(");
  if (parenIdx === -1) return { pred: trimmed, args: [] };
  const pred = trimmed.slice(0, parenIdx).trim();
  const inner = trimmed.slice(parenIdx + 1, trimmed.lastIndexOf(")")).trim();
  const args = inner
    ? splitTopLevel(inner, ",").map((entry) => entry.trim())
    : [];
  return { pred, args };
}

function parseBody(source: string): StoredAtom[] {
  return splitTopLevel(source, ",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseAtom);
}

function parseFactStatement(source: string, comment?: string): StoredFact {
  const atom = parseAtom(source);
  return {
    pred: atom.pred,
    args: atom.args.map(parseFactConstant),
    comment,
  };
}

function parseRuleStatement(source: string, comment?: string): StoredRule {
  const divider = findTopLevelOperator(source, ":-");
  if (divider === -1) {
    throw new Error(`Invalid rule: ${source}`);
  }
  return {
    head: parseAtom(source.slice(0, divider)),
    body: parseBody(source.slice(divider + 2)),
    comment,
  };
}

function parseConstraintStatement(
  source: string,
  comment?: string,
): StoredConstraint {
  const bodySource = source.startsWith(":-") ? source.slice(2) : source;
  return {
    body: parseBody(bodySource),
    comment,
  };
}

export function parseProgram(source: string): {
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
} {
  const facts: StoredFact[] = [];
  const rules: StoredRule[] = [];
  const constraints: StoredConstraint[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  let buffer = "";
  let pendingComments: string[] = [];

  const flushStatements = () => {
    const { statements, remainder } = consumeStatements(buffer);
    buffer = remainder;
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const comment =
        pendingComments.length > 0 ? pendingComments.join("\n") : undefined;
      pendingComments = [];
      if (trimmed.startsWith(":-")) {
        constraints.push(parseConstraintStatement(trimmed, comment));
      } else if (findTopLevelOperator(trimmed, ":-") >= 0) {
        rules.push(parseRuleStatement(trimmed, comment));
      } else {
        facts.push(parseFactStatement(trimmed, comment));
      }
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!buffer.trim()) pendingComments = [];
      continue;
    }
    if (
      !buffer.trim() &&
      (trimmed.startsWith("%") || trimmed.startsWith("//"))
    ) {
      pendingComments.push(trimmed.replace(/^(%|\/\/)\s?/, ""));
      continue;
    }
    buffer += (buffer ? "\n" : "") + line;
    flushStatements();
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    const comment =
      pendingComments.length > 0 ? pendingComments.join("\n") : undefined;
    if (trimmed.startsWith(":-")) {
      constraints.push(parseConstraintStatement(trimmed, comment));
    } else if (findTopLevelOperator(trimmed, ":-") >= 0) {
      rules.push(parseRuleStatement(trimmed, comment));
    } else {
      facts.push(parseFactStatement(trimmed, comment));
    }
  }

  return { facts, rules, constraints };
}

function matchAtom(
  atom: StoredAtom,
  fact: StoredFact,
  bindings: Bindings,
): Bindings | null {
  if (atom.pred !== fact.pred || atom.args.length !== fact.args.length)
    return null;
  const nextBindings = new Map(bindings);
  for (let index = 0; index < atom.args.length; index += 1) {
    const term = atom.args[index];
    const value = fact.args[index];
    if (isWildcard(term)) continue;
    if (isVariable(term)) {
      const existing = nextBindings.get(term);
      if (existing !== undefined) {
        if (existing !== value) return null;
      } else {
        nextBindings.set(term, value);
      }
    } else if (parseConstant(term) !== value) {
      return null;
    }
  }
  return nextBindings;
}

const CMP: Record<string, (left: number, right: number) => boolean> = {
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
};

const ARITH: Record<string, (left: number, right: number) => number> = {
  add: (left, right) => left + right,
  sub: (left, right) => left - right,
  mul: (left, right) => left * right,
  div: (left, right) => left / right,
};

const SIMPLE_BUILTINS = new Set([
  "lt",
  "lte",
  "gt",
  "gte",
  "eq",
  "neq",
  "add",
  "sub",
  "mul",
  "div",
]);

function bindOut(
  bindings: Bindings,
  outTerm: Term,
  value: Constant,
): Bindings | null {
  if (isWildcard(outTerm)) return bindings;
  if (isVariable(outTerm)) {
    const existing = bindings.get(outTerm);
    if (existing !== undefined && existing !== value) return null;
    const nextBindings = new Map(bindings);
    nextBindings.set(outTerm, value);
    return nextBindings;
  }
  return parseConstant(outTerm) === value ? bindings : null;
}

function evalBuiltin(atom: StoredAtom, bindings: Bindings): Bindings | null {
  const resolve = (term: Term): Constant | undefined => {
    if (isWildcard(term)) return undefined;
    if (isVariable(term)) return bindings.get(term);
    return parseConstant(term);
  };

  const { pred, args } = atom;
  if ((pred === "eq" || pred === "neq") && args.length === 2) {
    const left = resolve(args[0]);
    const right = resolve(args[1]);
    if (left === undefined || right === undefined) return null;
    const equal = left === right;
    return (pred === "eq" ? equal : !equal) ? bindings : null;
  }

  if (pred in CMP && args.length === 2) {
    const left = resolve(args[0]);
    const right = resolve(args[1]);
    if (left === undefined || right === undefined) return null;
    return CMP[pred](Number(left), Number(right)) ? bindings : null;
  }

  if (pred in ARITH && args.length === 3) {
    const left = resolve(args[0]);
    const right = resolve(args[1]);
    if (left === undefined || right === undefined) return null;
    const result = ARITH[pred](Number(left), Number(right));
    return bindOut(bindings, args[2], result);
  }

  return null;
}

function evalSum(
  atom: StoredAtom,
  db: StoredFact[],
  bindings: Bindings,
): Bindings[] {
  const [aggVarTerm, patternStr, outTerm] = atom.args;
  const pattern = parseAtom(String(patternStr));
  const substitutedPattern: StoredAtom = {
    pred: pattern.pred,
    args: pattern.args.map((term) => {
      if (isWildcard(term)) return term;
      if (isVariable(term)) {
        const bound = bindings.get(term);
        return bound !== undefined ? String(bound) : term;
      }
      return term;
    }),
  };

  const matches: Array<{
    groupKey: string;
    groupBindings: Bindings;
    aggValue: number;
  }> = [];
  for (const fact of db) {
    const nextBindings = matchAtom(substitutedPattern, fact, new Map());
    if (nextBindings == null) continue;

    let aggValue: number;
    if (isWildcard(aggVarTerm)) {
      aggValue = 1;
    } else if (isVariable(aggVarTerm)) {
      const bound = nextBindings.get(aggVarTerm);
      if (bound === undefined) continue;
      aggValue = Number(bound);
    } else {
      aggValue = Number(parseConstant(aggVarTerm));
    }

    const groupBindings = new Map(nextBindings);
    if (isVariable(aggVarTerm)) groupBindings.delete(aggVarTerm);
    const groupKey = JSON.stringify([...groupBindings.entries()].sort());
    matches.push({ groupKey, groupBindings, aggValue });
  }

  if (matches.length === 0) {
    const hasGroupVars = substitutedPattern.args.some(
      (term) => isVariable(term) && term !== aggVarTerm,
    );
    if (!hasGroupVars) {
      const bound = bindOut(bindings, outTerm, 0);
      return bound ? [bound] : [];
    }
    return [];
  }

  const groups = new Map<string, { groupBindings: Bindings; total: number }>();
  for (const match of matches) {
    if (groups.has(match.groupKey)) {
      groups.get(match.groupKey)!.total += match.aggValue;
    } else {
      groups.set(match.groupKey, {
        groupBindings: match.groupBindings,
        total: match.aggValue,
      });
    }
  }

  const results: Bindings[] = [];
  for (const { groupBindings, total } of groups.values()) {
    const merged = new Map(bindings);
    for (const [key, value] of groupBindings) merged.set(key, value);
    const extended = bindOut(merged, outTerm, total);
    if (extended) results.push(extended);
  }
  return results;
}

function matchBody(
  body: StoredAtom[],
  db: StoredFact[],
  bindings: Bindings,
): Bindings[] {
  if (body.length === 0) return [bindings];
  const [first, ...rest] = body;

  if (first.pred === "sum") {
    const results: Bindings[] = [];
    for (const nextBindings of evalSum(first, db, bindings)) {
      results.push(...matchBody(rest, db, nextBindings));
    }
    return results;
  }

  if (first.pred === "not") {
    const inner = parseAtom(first.args[0]);
    const found = db.some((fact) => matchAtom(inner, fact, bindings) !== null);
    return found ? [] : matchBody(rest, db, bindings);
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const nextBindings = evalBuiltin(first, bindings);
    return nextBindings == null ? [] : matchBody(rest, db, nextBindings);
  }

  const results: Bindings[] = [];
  for (const fact of db) {
    const nextBindings = matchAtom(first, fact, bindings);
    if (nextBindings !== null)
      results.push(...matchBody(rest, db, nextBindings));
  }
  return results;
}

function substituteHead(
  head: StoredAtom,
  bindings: Bindings,
): StoredFact | null {
  const args: Constant[] = [];
  for (const term of head.args) {
    if (isWildcard(term)) return null;
    if (isVariable(term)) {
      const bound = bindings.get(term);
      if (bound === undefined) return null;
      args.push(bound);
    } else {
      args.push(parseConstant(term));
    }
  }
  return { pred: head.pred, args };
}

export function evaluate(
  facts: StoredFact[],
  rules: StoredRule[],
): StoredFact[] {
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

type TrackedResult = { bindings: Bindings; steps: GroundBodyStep[] };

function matchBodyTracked(
  body: StoredAtom[],
  db: StoredFact[],
  bindings: Bindings,
  steps: GroundBodyStep[],
): TrackedResult[] {
  if (body.length === 0) return [{ bindings, steps }];
  const [first, ...rest] = body;

  if (first.pred === "sum") {
    const results: TrackedResult[] = [];
    for (const nextBindings of evalSum(first, db, bindings)) {
      results.push(...matchBodyTracked(rest, db, nextBindings, steps));
    }
    return results;
  }

  if (first.pred === "not") {
    const inner = parseAtom(first.args[0]);
    const found = db.some((fact) => matchAtom(inner, fact, bindings) !== null);
    return found ? [] : matchBodyTracked(rest, db, bindings, steps);
  }

  if (SIMPLE_BUILTINS.has(first.pred)) {
    const nextBindings = evalBuiltin(first, bindings);
    if (nextBindings === null) return [];
    const resolve = (term: Term): Constant => {
      if (isWildcard(term)) return "_";
      if (isVariable(term))
        return nextBindings.get(term) ?? bindings.get(term) ?? term;
      return parseConstant(term);
    };
    return matchBodyTracked(rest, db, nextBindings, [
      ...steps,
      {
        kind: "builtin",
        atom: first,
        resolvedArgs: first.args.map(resolve),
      },
    ]);
  }

  const results: TrackedResult[] = [];
  for (const fact of db) {
    const nextBindings = matchAtom(first, fact, bindings);
    if (nextBindings !== null) {
      results.push(
        ...matchBodyTracked(rest, db, nextBindings, [
          ...steps,
          { kind: "fact", fact, isBase: false },
        ]),
      );
    }
  }
  return results;
}

export function evaluateWithProvenance(
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
      for (const { bindings, steps } of matchBodyTracked(
        rule.body,
        db,
        new Map(),
        [],
      )) {
        const derived = substituteHead(rule.head, bindings);
        if (!derived) continue;
        const key = factKey(derived);
        if (!seen.has(key)) {
          seen.add(key);
          db.push(derived);
          changed = true;
          provenance.set(key, {
            rule,
            groundBody: steps
              .filter(
                (step): step is Extract<GroundBodyStep, { kind: "fact" }> =>
                  step.kind === "fact",
              )
              .map((step) => step.fact),
          });
        }
      }
    }
  }

  return { db, provenance };
}

export function checkConstraints(
  db: StoredFact[],
  constraints: StoredConstraint[],
  provenance: Map<string, ProvenanceEntry>,
  baseFacts: Set<string>,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  for (const constraint of constraints) {
    const tracked = matchBodyTracked(constraint.body, db, new Map(), []);
    if (tracked.length === 0) continue;
    violations.push({
      constraint,
      witnesses: tracked.map(({ bindings, steps }) => ({
        bindings: Object.fromEntries(bindings.entries()) as Record<
          string,
          Constant
        >,
        steps: steps.map((step) => {
          if (step.kind === "builtin") return step;
          const key = factKey(step.fact);
          return {
            kind: "fact" as const,
            fact: step.fact,
            isBase: baseFacts.has(key),
            derivedBy: provenance.get(key),
          };
        }),
      })),
    });
  }
  return violations;
}

export class Datalog {
  constructor(
    private readonly _facts: StoredFact[],
    private readonly _rules: StoredRule[],
    private readonly _constraints: StoredConstraint[],
  ) {}

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
    return pred ? db.filter((fact) => fact.pred === pred) : db;
  }

  checkConflicts(constraintName?: string): ConstraintViolation[] {
    let constraints = this.constraints;
    if (constraintName) {
      constraints = constraints.filter(
        (constraint) => constraint.name === constraintName,
      );
    }
    if (constraints.length === 0) return [];

    const { db, provenance } = evaluateWithProvenance(this.facts, this.rules);
    return checkConstraints(
      db,
      constraints,
      provenance,
      new Set(this.facts.map(factKey)),
    );
  }
}
