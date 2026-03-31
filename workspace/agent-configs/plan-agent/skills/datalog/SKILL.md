---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, running queries, or checking for constraint violations.
---

# Datalog Skill

Read and write a Datalog database document. Supports rule evaluation (queries) and constraint checking.

## Import

```javascript
const { createDatalog, getDatalog, mergeDatalog } = await workspace.import("skills/datalog/index.js");
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
| `query(pred?)`                     | Inherited from Datalog.                                                            |
| `checkConflicts(constraintName?)`  | Inherited from Datalog.                                                            |
| `getFacts(pred?)`                  | Returns base facts as `{ pred, args }[]`, optionally filtered by predicate.        |
| `assertFact(pred, args, comment?)` | Adds a ground fact if it doesn't exist. Optional comment stored on the fact.       |
| `retractFact(pred, args)`          | Removes all facts matching `pred` and the given args prefix.                       |
| `getRules(pred?)`                  | Returns stored rules, optionally filtered by head predicate.                       |
| `assertRule(rule)`                 | Adds a rule if it doesn't already exist. Pass `comment` on the rule object.        |
| `retractRule(rule)`                | Removes all rules matching the given rule.                                         |
| `getConstraints()`                 | Returns all stored constraints.                                                    |
| `assertConstraint(name, constraint)` | Adds a named constraint if it doesn't already exist.                             |
| `retractConstraint(name)`          | Removes the constraint with the given name.                                        |

## API

### `createDatalog(workspace, title?)`

Creates a new, properly initialised DatalogDoc. Returns a `DocDatalog` instance.

**`workspace.createDoc()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await workspace.import("skills/datalog/index.js");
const db = createDatalog(workspace, "My Spec Database");
console.log(db.url); // Automerge URL
```

### `getDatalog(workspace, url)` (async)

Returns a `DocDatalog` for the DatalogDoc at `url`. Must be awaited.

```javascript
const { getDatalog } = await workspace.import("skills/datalog/index.js");
const db = await getDatalog(workspace, url);
```

### `mergeDatalog(workspace, urls)` (async)

Merges multiple DatalogDocs into a single read-only in-memory `Datalog` instance. No document is created — purely for evaluation.

```javascript
const { mergeDatalog } = await workspace.import("skills/datalog/index.js");
const merged = await mergeDatalog(workspace, [specUrl, configUrl]);
const violations = merged.checkConflicts('my_constraint');
```

## Examples

```javascript
const { createDatalog, mergeDatalog } = await workspace.import("skills/datalog/index.js");

// Create a new document
const db = createDatalog(workspace, "Spec Database");

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

// Add a named constraint
db.assertConstraint("all_requirements_named", {
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "neq", args: ["X", "_"] },
  ],
});

// Query derived facts
const allFacts = db.query();
const secureFacts = db.query("secure");

// Check for constraint violations
const violations = db.checkConflicts();
const specific = db.checkConflicts("all_requirements_named");

// Merge multiple docs and check
const config = createDatalog(workspace, "Config");
config.assertFact("implemented", ["auth_required"]);

const merged = await mergeDatalog(workspace, [db.url, config.url]);
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
