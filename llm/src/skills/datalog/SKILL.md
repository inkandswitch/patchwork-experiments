---
name: datalog
description: Read and write a Datalog database document (DatalogDoc) by Automerge URL. Use when working with Datalog facts, rules, or constraints — asserting or retracting facts, reading the current database state, or editing the program text.
---

# Datalog Skill

Read and write a Datalog database document using `repo`.

## Import

```javascript
const { createDatalog, getDatalog } = await loadSkill("datalog");
```

## API

### `createDatalog(repo, title?)`

Creates a new, properly initialised DatalogDoc. Returns `{ handle, url }`.

**`repo.create()` is synchronous — this function must NOT be awaited.**

```javascript
const { createDatalog } = await loadSkill("datalog");
const { handle, url } = createDatalog(repo, "My Power Grid");
// url is the Automerge URL — share it or use getDatalog(repo, url) to edit
```

### `getDatalog(repo, url)` (async)

Returns a read/write interface for the DatalogDoc at `url`. Must be awaited.

| Method                    | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `getFacts(pred?)`         | Async. Returns base facts as `{ pred, args }[]`, optionally filtered by predicate. |
| `assertFact(pred, args)`  | Adds a ground fact if it doesn't exist.                                            |
| `retractFact(pred, args)` | Removes all facts matching `pred` and the given args prefix.                       |

## Examples

```javascript
const { createDatalog, getDatalog } = await loadSkill("datalog");

// Create a new document
const { url } = createDatalog(repo, "Power Grid");
const db = await getDatalog(repo, url);

// Or open an existing one
const db = await getDatalog(repo, "automerge:abc123");

// Read facts filtered by predicate
const flows = await db.getFacts("flow");
console.log(flows); // [{ pred: 'flow', args: ['north', 'central', 500] }, ...]

// Add a fact
db.assertFact("node", ["east"]);
db.assertFact("flow", ["north", "east", 300]);

// Remove a fact (exact match)
db.retractFact("flow", ["north", "east", 300]);

// Remove all flows from a node (prefix match)
db.retractFact("flow", ["north"]);
```

## Notes

- `assertFact` / `retractFact` update the stored `facts` array directly.
- `retractFact` matches by prefix: `retractFact('flow', ['north'])` removes all `flow(north, ...)` facts regardless of remaining args.
