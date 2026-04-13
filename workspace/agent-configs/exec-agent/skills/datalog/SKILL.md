---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, running queries, or checking for constraint violations.
---

# Datalog Skill

Read and write a Datalog database document. Supports rule evaluation (queries) and constraint checking.

## Import

```javascript
const { createDatalog, getDatalog, mergeDatalog, makeAttribution } = await useSkill("datalog");
```

## Types

Facts, rules, and constraints all support an optional `comment` field. When present it is serialized as a `//` line immediately before the statement. They also support optional structured `attribution` that links a statement to one or more text ranges in Automerge documents. Constraints have a required `name` field for filtering.

```javascript
// StoredTextRangeRef
{
  docUrl: AutomergeUrl,
  path: (string | number)[],
  from: Cursor,
  to: Cursor,
}

// StoredAttribution
{ refs: StoredTextRangeRef[] }

// StoredFact
{ pred: string, args: (string|number)[], comment?: string, attribution?: StoredAttribution }

// StoredAtom (used in rule heads, bodies, and constraint bodies)
{ pred: string, args: string[] }

// StoredRule
{ head: StoredAtom, body: StoredAtom[], comment?: string, attribution?: StoredAttribution }

// StoredConstraint
{ name: string, body: StoredAtom[], comment?: string, attribution?: StoredAttribution }
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
| `assertFact(pred, args, commentOrOptions?, options?)` | Adds a ground fact if it doesn't exist. You can attach `comment` and `attribution`. |
| `retractFact(pred, args)`          | Removes all facts matching `pred` and the given args prefix.                       |
| `getRules(pred?)`                  | Returns stored rules, optionally filtered by head predicate.                       |
| `assertRule(rule, options?)`       | Adds a rule if it doesn't already exist. Pass `comment` / `attribution` on the rule object or in `options`. |
| `retractRule(rule)`                | Removes all rules matching the given rule.                                         |
| `getConstraints()`                 | Returns all stored constraints.                                                    |
| `assertConstraint(name, constraint, options?)` | Adds a named constraint if it doesn't already exist. Pass `comment` / `attribution` on the constraint object or in `options`. |
| `retractConstraint(name)`          | Removes the constraint with the given name.                                        |
| `makeAttribution(ranges)`          | Converts `{ docUrl, path, start, end }` text ranges into stored `{ from, to }` cursor refs. |

## API

### `createDatalog(title?)`

Creates a new, properly initialised DatalogDoc. Returns a `DocDatalog` instance.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await useSkill("datalog");
const db = createDatalog("My Spec Database");
console.log(db.url); // Automerge URL
```

### `getDatalog(url)` (async)

Returns a `DocDatalog` for the DatalogDoc at `url`. Must be awaited.

```javascript
const { getDatalog } = await useSkill("datalog");
const db = await getDatalog(url);
```

### `mergeDatalog(urls)` (async)

Merges multiple DatalogDocs into a single read-only in-memory `Datalog` instance. No document is created — purely for evaluation.

```javascript
const { mergeDatalog } = await useSkill("datalog");
const merged = await mergeDatalog([specUrl, configUrl]);
const violations = merged.checkConflicts('my_constraint');
```

### `makeAttribution(ranges)` (async)

Convert one or more quoted snippets into stable cursor-based refs you can attach to facts, rules, and constraints.

Each input range must be:

```javascript
{
  docUrl: AutomergeUrl,
  path: (string | number)[], // must resolve to a text field
  quote: string,             // exact snippet to ground
  prefix?: string,           // optional preceding context for disambiguation
  suffix?: string,           // optional following context for disambiguation
}
```

Legacy offset input still works:

```javascript
{ docUrl, path, start, end }
```

The returned value is:

```javascript
{
  refs: [
    { docUrl, path, from, to }
  ]
}
```

Use this when grounding a Datalog statement in reference text. Prefer passing quotes, not offsets. The skill finds the quoted snippet in the target text, resolves it to stable `from` / `to` cursors, and throws if the quote is missing or ambiguous.

## Examples

```javascript
const { createDatalog, mergeDatalog, makeAttribution } = await useSkill("datalog");

// Create a new document (synchronous — do NOT await)
const db = createDatalog("Spec Database");

const authSource = await makeAttribution([
  {
    docUrl,
    path: ["content"],
    quote: "users must authenticate",
    prefix: "The API requires that ",
  },
]);

// Add facts with optional comments and attribution
db.assertFact("requirement", ["auth_required"], {
  comment: "users must authenticate",
  attribution: authSource,
});
db.assertFact("requirement", ["rate_limited"], "API calls are rate-limited");

// Add a rule
db.assertRule({
  head: { pred: "secure", args: ["X"] },
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "implemented", args: ["X"] },
  ],
  comment: "a requirement is secure when implemented",
  attribution: authSource,
});

// Add a named constraint
db.assertConstraint("all_requirements_named", {
  body: [
    { pred: "requirement", args: ["X"] },
    { pred: "neq", args: ["X", "_"] },
  ],
  attribution: authSource,
});

// Query derived facts
const allFacts = db.query();
const secureFacts = db.query("secure");

// Check for constraint violations
const violations = db.checkConflicts();
const specific = db.checkConflicts("all_requirements_named");

// Merge multiple docs and check
const config = createDatalog("Config");
config.assertFact("implemented", ["auth_required"]);

const merged = await mergeDatalog([db.url, config.url]);
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
| `not(Atom)`          | Negation-as-failure: succeeds if no derived fact matches `Atom`. `Atom` must be `{ pred, args }`. All variables in `Atom` must already be bound by earlier positive atoms (safe negation). Wildcards (`"_"`) are allowed. |

## Notes

- `assertFact` / `retractFact` update the stored `facts` array directly.
- `retractFact` matches by prefix: `retractFact('flow', ['north'])` removes all `flow(north, ...)` facts.
- `assertConstraint` requires a name as the first argument. Use `checkConflicts(name)` to check a specific constraint.
- `mergeDatalog` returns a read-only `Datalog` — it has no mutation methods, only `query()` and `checkConflicts()`.
- `makeAttribution` requires `path` to resolve to text. Prefer `quote`-based grounding over raw offsets; do not try to construct cursors yourself.
- If a quote appears multiple times, provide a longer quote or add `prefix` / `suffix` context so the match is unique.
- Attribution paths currently support ordinary key/index traversal to text fields, e.g. `["content"]` or `["sections", 0, "body"]`.
- The skill uses the host-provided global `Automerge` runtime to create stable cursors; it does not depend on the official refs package at runtime.
- Attribution is statement-owned: each fact, rule, or constraint stores its own `attribution`. Reuse the same attribution object on multiple statements when the same source span justifies them.
- Fact-only Datalog docs should still carry attribution on their facts when those facts come from the source text. Do not wait for a rule or constraint doc before grounding the source.
- **`not` syntax:** the inner atom must be a plain object `{ pred, args }` — NOT a string. All variables in the inner atom must already be bound by preceding positive atoms in the same body (safe negation).

```javascript
// Constraint: every required item must be covered
db.assertConstraint("all_required_items_covered", {
  body: [
    { pred: "required", args: ["X"] },              // X is bound here
    { pred: "not", args: [{ pred: "covered", args: ["X"] }] }, // NAF on bound X
  ],
});
```
