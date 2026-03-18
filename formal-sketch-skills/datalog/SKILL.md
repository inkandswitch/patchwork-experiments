---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, editing the program text, running queries, or checking for constraint violations/conflicts.
---

# Datalog Skill

Read and write a Datalog database document using `repo`. Also supports rule evaluation (queries) and constraint checking (conflict detection).

## Import

```javascript
const { createDatalog, getDatalog, queryDatalog, checkConflicts } = await importSkillApi("datalog");
```

## API

### `createDatalog(repo, title?)`

Creates a new, properly initialised DatalogDoc. Returns `{ handle, url }`.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await importSkillApi("datalog");
const { handle, url } = createDatalog(repo, "My Power Grid");
// url is the Automerge URL — share it or use getDatalog(repo, url) to edit
```

### `getDatalog(repo, url)` (async)

Returns a read/write interface for the DatalogDoc at `url`. Must be awaited.

| Method                          | Description                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `getFacts(pred?)`               | Async. Returns base facts as `{ pred, args }[]`, optionally filtered by predicate.   |
| `assertFact(pred, args)`        | Adds a ground fact if it doesn't exist.                                              |
| `retractFact(pred, args)`       | Removes all facts matching `pred` and the given args prefix.                         |
| `getRules(pred?)`               | Async. Returns stored rules as `{ head, body }[]`, optionally filtered by head pred. |
| `assertRule(rule)`              | Adds a rule if it doesn't already exist (compared by key).                           |
| `retractRule(rule)`             | Removes all rules matching the given rule (by key equality).                         |
| `getConstraints()`              | Async. Returns all stored constraints as `{ body }[]`.                               |
| `assertConstraint(constraint)`  | Adds a constraint if it doesn't already exist (compared by key).                     |
| `retractConstraint(constraint)` | Removes all constraints matching the given constraint (by key equality).             |

### `queryDatalog(repo, url, pred?)` (async)

Evaluates all stored rules against the stored facts (bottom-up fixpoint) and returns the full derived database. Optionally filter results to a single predicate.

Returns `StoredFact[]` — each entry is `{ pred: string, args: (string|number)[] }`.

```javascript
const derived = await queryDatalog(repo, url);
// All facts including those derived by rules

const totals = await queryDatalog(repo, url, "total_flow");
// Only facts with pred === "total_flow"
```

### `checkConflicts(repo, url)` (async)

Runs rule evaluation then checks all stored constraints. Returns an array of violations — empty if the database is consistent.

Each violation has:

- `constraint` — the `StoredConstraint` that fired (`{ body: StoredAtom[] }`)
- `witnesses` — array of `{ bindings, steps }` traces explaining why it fired
  - `bindings` — `Record<string, string|number>` variable assignments
  - `steps` — array of either:
    - `{ kind: 'fact', fact, isBase, derivedBy? }` — a ground fact used in the match
    - `{ kind: 'builtin', atom, resolvedArgs }` — a built-in comparison/arithmetic

```javascript
const violations = await checkConflicts(repo, url);
if (violations.length === 0) {
  console.log("No conflicts.");
} else {
  for (const v of violations) {
    console.log("Constraint violated:", v.constraint.body.map((a) => `${a.pred}(${a.args.join(", ")})`).join(", "));
    for (const w of v.witnesses) {
      console.log("  Bindings:", w.bindings);
    }
  }
}
```

## Examples

```javascript
const { createDatalog, getDatalog, queryDatalog, checkConflicts } = await importSkillApi("datalog");

// Create a new document
const { url } = createDatalog(repo, "Power Grid");
const db = await getDatalog(repo, url);

// Or open an existing one
const db = await getDatalog(repo, "automerge:abc123");

// Read base facts filtered by predicate
const flows = await db.getFacts("flow");
console.log(flows); // [{ pred: 'flow', args: ['north', 'central', 500] }, ...]

// Add a fact
db.assertFact("node", ["east"]);
db.assertFact("flow", ["north", "east", 300]);

// Remove a fact (exact match)
db.retractFact("flow", ["north", "east", 300]);

// Remove all flows from a node (prefix match)
db.retractFact("flow", ["north"]);

// Add a rule: connected(X, Y) :- flow(X, Y, _).
db.assertRule({
  head: { pred: "connected", args: ["X", "Y"] },
  body: [{ pred: "flow", args: ["X", "Y", "_"] }],
});

// Add a rule with multiple body atoms:
// reachable(X, Z) :- reachable(X, Y), connected(Y, Z).
db.assertRule({
  head: { pred: "reachable", args: ["X", "Z"] },
  body: [
    { pred: "reachable", args: ["X", "Y"] },
    { pred: "connected", args: ["Y", "Z"] },
  ],
});

// Remove a rule
db.retractRule({
  head: { pred: "connected", args: ["X", "Y"] },
  body: [{ pred: "flow", args: ["X", "Y", "_"] }],
});

// Add a constraint: no self-loops — :- flow(X, X, _).
db.assertConstraint({ body: [{ pred: "flow", args: ["X", "X", "_"] }] });

// Remove a constraint
db.retractConstraint({ body: [{ pred: "flow", args: ["X", "X", "_"] }] });

// Query derived facts (rules are evaluated automatically)
const allFacts = await queryDatalog(repo, url);
const capacities = await queryDatalog(repo, url, "capacity");

// Check for constraint violations
const violations = await checkConflicts(repo, url);
```

## Built-in predicates (available in rules and constraints)

| Predicate            | Description                              |
| -------------------- | ---------------------------------------- |
| `eq(A, B)`           | A equals B                               |
| `neq(A, B)`          | A does not equal B                       |
| `lt(A, B)`           | A < B (numeric)                          |
| `lte(A, B)`          | A ≤ B (numeric)                          |
| `gt(A, B)`           | A > B (numeric)                          |
| `gte(A, B)`          | A ≥ B (numeric)                          |
| `add(A, B, C)`       | C = A + B                                |
| `sub(A, B, C)`       | C = A − B                                |
| `mul(A, B, C)`       | C = A × B                                |
| `div(A, B, C)`       | C = A / B                                |
| `sum(V, pattern, C)` | C = sum of V over all matches of pattern |

## Notes

- `assertFact` / `retractFact` update the stored `facts` array directly.
- `retractFact` matches by prefix: `retractFact('flow', ['north'])` removes all `flow(north, ...)` facts regardless of remaining args.
