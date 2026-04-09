---
name: spec
description: Manage a Spec Collection — a single document containing multiple specs, each with a goal, named document references, and JavaScript verification scripts.
---

# Spec Skill

Manage a Spec Collection (SpecCollectionDoc) that groups multiple specs into a single document. Each spec has a goal, named document references, and verification scripts.

## Import

```javascript
const { createSpecCollection, getSpecCollection } = await useSkill("spec");
```

## Types

```javascript
// SpecCollectionDoc shape
{
  specs: SpecDoc[]
}

// SpecDoc (embedded within the collection)
{
  goal: string,
  docs: Record<string, AutomergeUrl>,
  requiredDocs: string[],
  verifications: Verification[]
}

// Verification
{ name: string, script: string, documentUrls: Record<string, AutomergeUrl> }
```

## API

### `createSpecCollection()` (sync)

Creates a new, empty SpecCollectionDoc. **Do NOT await** — `repo.create()` is synchronous.

Returns `{ handle, url }`.

```javascript
const { createSpecCollection } = await useSkill("spec");
const { url } = createSpecCollection();
```

### `getSpecCollection(url)` (async)

Returns a read/write interface for the SpecCollectionDoc at `url`. Must be awaited.

#### Collection methods

| Method                          | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `getSpecs()`                    | Returns a shallow copy of the specs array.                               |
| `addSpec(goal)`                 | Adds a new spec with the given goal. Returns a **spec handle**.          |
| `getSpec(index)`                | Returns a spec handle for the spec at `index`.                           |
| `removeSpec(index)`             | Removes the spec at `index`.                                             |
| `runAllVerifications(providedDocs?)` | Runs verifications for every spec. `providedDocs` is `Record<string, AutomergeUrl>` supplying URLs for required docs. Returns `{ specIndex, name, passed, error? }[]`. |

#### Spec handle methods

A spec handle is returned by `addSpec()` or `getSpec()`. All mutations apply to the collection document.

| Method                                          | Description                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `getGoal()`                                      | Returns the spec's goal string.                                   |
| `setGoal(goal)`                                  | Sets the spec's goal.                                             |
| `getDocs()`                                      | Returns a copy of the spec's `docs` record.                       |
| `setDoc(name, url)`                              | Sets a named document reference.                                  |
| `removeDoc(name)`                                | Removes a named document reference.                               |
| `getRequiredDocs()`                              | Returns the `requiredDocs` array (document names the plan must provide). |
| `addRequiredDoc(name)`                           | Adds a required document name (no-op if already present).         |
| `removeRequiredDoc(name)`                        | Removes a required document name.                                 |
| `getVerifications()`                             | Returns verifications as `{ name, script, documentUrls }[]`.      |
| `addVerification(name, script, documentUrls?)`   | Adds a verification with optional named document URLs.             |
| `removeVerification(name)`                       | Removes the first verification matching `name`.                   |
| `runVerifications(providedDocs?)`     | Async. `providedDocs` is `Record<string, AutomergeUrl>` supplying URLs for required docs. Evals each script, returns `{ specIndex, name, passed, error? }[]`. |

## Required Documents

`requiredDocs` declares document names that the spec needs but that don't exist yet. A plan executor creates these documents and passes their URLs via the `providedDocs` argument when running verifications.

```javascript
// During spec creation — declare what's needed
const handle = coll.addSpec("ER staffing rules are satisfied");
handle.addRequiredDoc("schedule");

// During plan execution — provide the actual document
const results = await handle.runVerifications({ schedule: scheduleUrl });
```

`providedDocs` entries are merged with each verification's `documentUrls`. If both define the same key, `documentUrls` takes precedence.

## Verification Scripts

Each verification is a JavaScript snippet that has access to:

- **Named document URLs** — any keys from `documentUrls` are injected as variables (e.g. `{ spec: url1 }` makes `spec` available)
- **Provided documents** — any keys from `providedDocs` passed to `runVerifications` / `runAllVerifications` (e.g. `{ schedule: url2 }` makes `schedule` available)
- Global `repo`, `useSkill`, `readSkill` are also available

The script must **return `true`** to pass. Any other return value or thrown error counts as a failure.

### Verification script pattern

Verification scripts should be short orchestration — merge relevant Datalog documents and check for constraint violations:

```javascript
const { mergeDatalog } = await useSkill("datalog")
const merged = await mergeDatalog([spec, schedule, staff])
return merged.checkConflicts('my_constraint_name').length === 0
```

## Examples

### Creating a spec collection

```javascript
const { createSpecCollection, getSpecCollection } = await useSkill("spec");
const { createDatalog } = await useSkill("datalog");

// Create the collection
const { url: collUrl } = createSpecCollection();
const coll = await getSpecCollection(collUrl);

// Create shared Datalog docs
const hospitalStaff = createDatalog("Hospital Staff");
hospitalStaff.assertFact("staff", ["dr_chen", "doctor", "attending"]);
hospitalStaff.assertFact("staff", ["nurse_kim", "nurse", "senior"]);

const shiftConfig = createDatalog("Shift Config");
shiftConfig.assertFact("shift", ["morning"]);
shiftConfig.assertFact("shift", ["afternoon"]);

// Create department Datalog docs
const erSpec = createDatalog("ER Spec");
erSpec.assertFact("dept_shift_hours", ["er", "morning", 8]);
erSpec.assertConstraint("er_no_junior_night", {
  body: [
    { pred: "assigned", args: ["P", "er", "night"] },
    { pred: "staff", args: ["P", "_", "junior"] },
  ],
});

// Add a spec to the collection — returns a spec handle
const erHandle = coll.addSpec("ER staffing rules are satisfied");
erHandle.setDoc("spec", erSpec.url);
erHandle.setDoc("staff", hospitalStaff.url);
erHandle.setDoc("shifts", shiftConfig.url);

// Declare that a "schedule" document must be provided by the plan
erHandle.addRequiredDoc("schedule");

erHandle.addVerification("no junior night shifts", `
  const { mergeDatalog } = await useSkill("datalog")
  const merged = await mergeDatalog([spec, schedule, staff])
  return merged.checkConflicts('er_no_junior_night').length === 0
`, { spec: erSpec.url, staff: hospitalStaff.url });

// After the plan creates a schedule document, run verifications with it:
// const results = await coll.runAllVerifications({ schedule: scheduleUrl });
// for (const r of results) {
//   console.log(`[spec ${r.specIndex}] ${r.name}: ${r.passed ? "PASSED" : "FAILED"}`, r.error ?? "");
// }
```
