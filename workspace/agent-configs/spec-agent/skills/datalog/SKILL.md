---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, running queries, or checking for constraint violations.
---

# Datalog Skill

Read and write a Datalog database document using `repo`. Supports rule evaluation (queries) and constraint checking.

## Import

```javascript
const { createDatalog, getDatalog, queryDatalog, checkConflicts } = await importSkillApi("datalog");
```

## Types

Facts, rules, and constraints all support an optional `comment` field. When present it is serialized as a `//` line immediately before the statement.

```javascript
// StoredFact
{ pred: string, args: (string|number)[], comment?: string }

// StoredAtom (used in rule heads, bodies, and constraint bodies)
{ pred: string, args: string[] }

// StoredRule
{ head: StoredAtom, body: StoredAtom[], comment?: string }

// StoredConstraint
{ body: StoredAtom[], comment?: string }
```

## API

### `createDatalog(repo, title?)`

Creates a new, properly initialised DatalogDoc. Returns `{ handle, url }`.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await importSkillApi("datalog");
const { handle, url } = createDatalog(repo, "My Spec Database");
```

### `getDatalog(repo, url)` (async)

Returns a read/write interface for the DatalogDoc at `url`. Must be awaited.

| Method                             | Description                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `getFacts(pred?)`                  | Async. Returns base facts as `{ pred, args }[]`, optionally filtered by predicate. |
| `assertFact(pred, args, comment?)` | Adds a ground fact if it doesn't exist. Optional comment stored on the fact.       |
| `retractFact(pred, args)`          | Removes all facts matching `pred` and the given args prefix.                       |
| `getRules(pred?)`                  | Async. Returns stored rules, optionally filtered by head predicate.                |
| `assertRule(rule)`                 | Adds a rule if it doesn't already exist. Pass `comment` on the rule object.        |
| `retractRule(rule)`                | Removes all rules matching the given rule.                                         |
| `getConstraints()`                 | Async. Returns all stored constraints.                                             |
| `assertConstraint(constraint)`     | Adds a constraint if it doesn't already exist.                                     |
| `retractConstraint(constraint)`    | Removes all constraints matching the given constraint.                             |

### `queryDatalog(repo, url, pred?)` (async)

Evaluates all stored rules against facts (bottom-up fixpoint) and returns the full derived database. Optionally filter to a single predicate.

```javascript
const derived = await queryDatalog(repo, url);
const totals = await queryDatalog(repo, url, "total_flow");
```

### `checkConflicts(repo, url)` (async)

Runs rule evaluation then checks all stored constraints. Returns an array of violations — empty if the database is consistent.

Each violation has:

- `constraint` — the `StoredConstraint` that fired
- `witnesses` — array of `{ bindings, steps }` traces

```javascript
const violations = await checkConflicts(repo, url);
if (violations.length === 0) {
  console.log("No conflicts.");
} else {
  for (const v of violations) {
    console.log("Constraint violated:", v.constraint.body.map((a) => `${a.pred}(${a.args.join(", ")})`).join(", "));
  }
}
```

## Examples

```javascript
const { createDatalog, getDatalog, queryDatalog, checkConflicts } = await importSkillApi("datalog");

// Create a new document
const { url } = createDatalog(repo, "Spec Database");
const db = await getDatalog(repo, url);

// Add facts with optional comments
db.assertFact("requirement", ["auth_required"], "users must authenticate");
db.assertFact("requirement", ["rate_limited"], "API calls are rate-limited");

// Add a rule
db.assertRule({
  head: { pred: "secure", args: ["X"] },
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "implemented", args: ["X"] },
  ],
  comment: "a requirement is secure when implemented",
});

// Add a constraint: every requirement must have a verification
db.assertConstraint({
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "neq", args: ["X", "_"] },
  ],
  comment: "all requirements must be named",
});

// Query derived facts
const allFacts = await queryDatalog(repo, url);

// Check for constraint violations
const violations = await checkConflicts(repo, url);
```

## Built-in predicates (available in rules and constraints)

| Predicate            | Description                              |
| -------------------- | ---------------------------------------- |
| `eq(A, B)`           | A equals B                               |
| `neq(A, B)`          | A does not equal B                       |
| `lt(A, B)`           | A < B (numeric)                          |
| `lte(A, B)`          | A <= B (numeric)                         |
| `gt(A, B)`           | A > B (numeric)                          |
| `gte(A, B)`          | A >= B (numeric)                         |
| `add(A, B, C)`       | C = A + B                                |
| `sub(A, B, C)`       | C = A - B                                |
| `mul(A, B, C)`       | C = A * B                                |
| `div(A, B, C)`       | C = A / B                                |
| `sum(V, pattern, C)` | C = sum of V over all matches of pattern |

## Notes

- `assertFact` / `retractFact` update the stored `facts` array directly.
- `retractFact` matches by prefix: `retractFact('flow', ['north'])` removes all `flow(north, ...)` facts.
