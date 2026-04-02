---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, running queries, or checking for constraint violations.
---

# Datalog Skill

Read and write a Datalog database document. Supports rule evaluation (queries) and constraint checking.

## Import

```javascript
const { createDatalog, getDatalog, mergeDatalog } = await importSkillApi('datalog');
```

## Types

Facts, rules, and constraints all support an optional `comment` field. When present it is serialized as a `//` line immediately before the statement. Constraints have a required `name` field for filtering.

```javascript
// StoredFact
{ pred: string, args: (string|number)[], comment?: string }

// StoredAtom (used in rule heads, bodies, and constraint bodies)
{ pred: string, args: string[] }

// StoredRule
{ head: StoredAtom, body: StoredAtom[], comment?: string }

// StoredConstraint
{ name: string, body: StoredAtom[], comment?: string }
```

## Classes

### `Datalog` (read-only, for evaluation)

Returned by `mergeDatalog`. Only supports evaluation — no mutation methods.

| Property / Method            | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `query(pred?)`               | Evaluate rules, return all derived facts. Optionally filter by predicate. |
| `checkConflicts(constraintName?)` | Evaluate rules + check constraints. Optionally filter by constraint name. Returns violations array (empty if none). |

### `DocDatalog` (read/write, extends Datalog)

Returned by `createDatalog` and `getDatalog`. Full read/write backed by an Automerge document.

| Property / Method                  | Description                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `url`                              | The Automerge URL of the backing document.                                         |
| `await query(pred?)`                     | Inherited from Datalog. Async — refreshes doc before evaluating.             |
| `await checkConflicts(constraintName?)`  | Inherited from Datalog. Async — refreshes doc before evaluating.             |
| `await getFacts(pred?)`                  | Returns base facts as `{ pred, args }[]`, optionally filtered by predicate.  |
| `await assertFact(pred, args, comment?)` | Adds a ground fact if it doesn't exist. Optional comment stored on the fact. |
| `await retractFact(pred, args)`          | Removes all facts matching `pred` and the given args prefix.                 |
| `await getRules(pred?)`                  | Returns stored rules, optionally filtered by head predicate.                 |
| `await assertRule(rule)`                 | Adds a rule if it doesn't already exist. Pass `comment` on the rule object.  |
| `await retractRule(rule)`                | Removes all rules matching the given rule.                                   |
| `await getConstraints()`                 | Returns all stored constraints.                                              |
| `await assertConstraint(name, constraint)` | Adds a named constraint if it doesn't already exist.                       |
| `await retractConstraint(name)`          | Removes the constraint with the given name.                                  |

## API

### `createDatalog(repo, title?)`

Creates a new, properly initialised DatalogDoc. Returns a `DocDatalog` instance.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await importSkillApi('datalog');
const db = createDatalog(repo, "My Spec Database");
console.log(db.url); // Automerge URL
```

### `getDatalog(repo, url)` (async)

Returns a `DocDatalog` for the DatalogDoc at `url`. Must be awaited.

```javascript
const { getDatalog } = await importSkillApi('datalog');
const db = await getDatalog(repo, url);
```

### `mergeDatalog(repo, urls)` (async)

Merges multiple DatalogDocs into a single read-only in-memory `Datalog` instance. No document is created — purely for evaluation.

```javascript
const { mergeDatalog } = await importSkillApi('datalog');
const merged = await mergeDatalog(repo, [specUrl, configUrl]);
const violations = merged.checkConflicts('my_constraint');
```

## Examples

```javascript
const { createDatalog, mergeDatalog } = await importSkillApi('datalog');

// Create a new document
const db = createDatalog(repo, "Spec Database");

// Add facts with optional comments
await db.assertFact("requirement", ["auth_required"], "users must authenticate");
await db.assertFact("requirement", ["rate_limited"], "API calls are rate-limited");

// Add a rule
await db.assertRule({
  head: { pred: "secure", args: ["X"] },
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "implemented", args: ["X"] },
  ],
  comment: "a requirement is secure when implemented",
});

// Add a named constraint
await db.assertConstraint("all_requirements_named", {
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "neq", args: ["X", "_"] },
  ],
});

// Query derived facts
const allFacts = await db.query();
const secureFacts = await db.query("secure");

// Check for constraint violations
const violations = await db.checkConflicts();
const specific = await db.checkConflicts("all_requirements_named");

// Merge multiple docs and check
const config = createDatalog(repo, "Config");
await config.assertFact("implemented", ["auth_required"]);

const merged = await mergeDatalog(repo, [db.url, config.url]);
const result = merged.checkConflicts("all_requirements_named");
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
- `assertConstraint` requires a name as the first argument. Use `checkConflicts(name)` to check a specific constraint.
- `mergeDatalog` returns a read-only `Datalog` — it has no mutation methods, only `query()` and `checkConflicts()`.
