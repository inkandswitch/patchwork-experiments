---
name: spec
description: Manage a Spec document — set its goal, link a Datalog database, and add/remove/run JavaScript verification snippets that must return true to pass.
---

# Spec Skill

Manage a Spec document (SpecDoc) that pairs a goal with a Datalog database and a set of JavaScript verification scripts.

## Import

```javascript
const { getSpec } = await importSkillApi("spec");
```

## Types

```javascript
// Verification
{ name: string, script: string }

// SpecDoc shape (for reference — use the API, don't write fields directly)
{
  title: string,
  goal: string,
  datalogUrl?: AutomergeUrl,   // points to a DatalogDoc
  verifications: Verification[]
}
```

## API

### `getSpec(repo, url)` (async)

Returns a read/write interface for the SpecDoc at `url`. Must be awaited.

| Method                          | Description                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `getGoal()`                     | Returns the current goal string.                                             |
| `setGoal(goal)`                 | Sets the spec's goal.                                                        |
| `getTitle()`                    | Returns the current title.                                                   |
| `setTitle(title)`               | Sets the spec's title.                                                       |
| `getDatalogUrl()`               | Returns the linked DatalogDoc URL, or undefined.                             |
| `setDatalogUrl(url)`            | Links a DatalogDoc to this spec.                                             |
| `getVerifications()`            | Returns all verifications as `{ name, script }[]`.                           |
| `addVerification(name, script)` | Adds a verification. The script should `return true` to pass.                |
| `removeVerification(name)`      | Removes the first verification matching `name`.                              |
| `runVerifications(repo)`        | Async. Evals each script, returns `{ name, passed, error? }[]`.             |

## Verification Scripts

Each verification is a JavaScript snippet that has access to:

- `repo` — the Automerge repo (use `await repo.find(url)` to read documents)
- `specUrl` — the URL of this spec document
- `datalogUrl` — the URL of the linked Datalog document (may be undefined)

The script must **return `true`** to pass. Any other return value or thrown error counts as a failure.

```javascript
// Example verification script:
const handle = await repo.find(datalogUrl);
const doc = await handle.doc();
const hasAuth = doc.facts.some(f => f.pred === "requirement" && f.args[0] === "auth_required");
return hasAuth;
```

## Examples

```javascript
const { getSpec } = await importSkillApi("spec");
const spec = await getSpec(repo, specUrl);

// Set the goal
spec.setGoal("Define requirements for the authentication system");
spec.setTitle("Auth Spec");

// Link a datalog document
spec.setDatalogUrl(datalogUrl);

// Add verifications
spec.addVerification("has auth requirement", `
  const handle = await repo.find(datalogUrl);
  const doc = await handle.doc();
  return doc.facts.some(f => f.pred === "requirement" && f.args[0] === "auth_required");
`);

spec.addVerification("no constraint violations", `
  const { checkConflicts } = await importSkillApi("datalog");
  const violations = await checkConflicts(repo, datalogUrl);
  return violations.length === 0;
`);

// Run all verifications
const results = await spec.runVerifications(repo);
for (const r of results) {
  console.log(r.name, r.passed ? "PASSED" : "FAILED", r.error ?? "");
}
```
