---
name: plan
description: Manage a Plan — a document referencing separate task documents, each with a goal, dependencies, artifacts, and a linked spec.
---

# Plan Skill

Manage a PlanDoc that references separate TaskDoc documents. Each task has a goal, dependencies on other tasks, named artifact documents, and a link to the spec it fulfills.

## Import

```javascript
const { createPlan, getPlan } = await workspace.import("skills/plan/index.js");
```

## Types

```javascript
// PlanDoc shape
{
  tasks: AutomergeUrl[]  // references to separate TaskDoc documents
}

// TaskDoc shape (separate document)
{
  goal: string,
  dependsOn: AutomergeUrl[],              // URLs of prerequisite task documents
  artifacts: Record<string, AutomergeUrl>, // named output documents this task produces
  specDocUrl: AutomergeUrl                 // the spec this task fulfills
}
```

## API

### `createPlan(workspace)` (sync)

Creates a new, empty PlanDoc. **Do NOT await** — `workspace.createDoc()` is synchronous.

Returns `{ handle, url }`.

```javascript
const { createPlan } = await workspace.import("skills/plan/index.js");
const { url } = createPlan(workspace);
```

### `getPlan(workspace, url)` (async)

Returns a read/write interface for the PlanDoc at `url`. Must be awaited.

#### Plan methods

| Method                  | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `getTasks()`            | Returns a copy of the task URL array.                                            |
| `addTask(goal, specDocUrl)` | Creates a new TaskDoc document, appends its URL to the plan. Returns a **task handle** with `.url`. |
| `getTask(url)` (async)  | Finds the task document at `url` and returns a task handle.                      |
| `removeTask(url)`       | Removes the task URL from the plan's tasks array.                                |

#### Task handle

A task handle wraps a separate Automerge document. It is returned by `addTask()` or `getTask()`.

| Property / Method                      | Description                                                       |
| -------------------------------------- | ----------------------------------------------------------------- |
| `.url`                                 | The task document's AutomergeUrl.                                 |
| `getGoal()`                            | Returns the task's goal string.                                   |
| `setGoal(goal)`                        | Sets the task's goal.                                             |
| `getSpecDocUrl()`                      | Returns the URL of the linked spec.                               |
| `setSpecDocUrl(url)`                   | Sets the linked spec URL.                                         |
| `getDependsOn()`                       | Returns a copy of the `dependsOn` URL array.                      |
| `addDependency(taskUrl)`               | Adds a dependency on another task (no-op if already present).     |
| `removeDependency(taskUrl)`            | Removes a dependency.                                             |
| `getArtifacts()`                       | Returns a copy of the `artifacts` record.                         |
| `setArtifact(name, url)`               | Sets a named artifact document URL.                               |
| `removeArtifact(name)`                 | Removes a named artifact.                                         |

## Artifacts and Required Docs

A task's `artifacts` correspond to the `requiredDocs` of its linked spec. The artifact keys should match the required doc names declared in the spec. For example, if a spec declares `addRequiredDoc("schedule")`, the task should have `setArtifact("schedule", scheduleUrl)`.

## Example

```javascript
const { createPlan, getPlan } = await workspace.import("skills/plan/index.js");
const { createDatalog } = await workspace.import("skills/datalog/index.js");

// Create the plan
const { url: planUrl } = createPlan(workspace);
const plan = await getPlan(workspace, planUrl);

// Create an empty schedule document as an artifact placeholder
const erSchedule = createDatalog(workspace, "ER Schedule");

// Add a task linked to a spec, with an artifact
const erTask = plan.addTask("Generate ER department schedule", erSpecUrl);
erTask.setArtifact("schedule", erSchedule.url);

// Add another task that depends on the first
const globalTask = plan.addTask("Validate cross-department constraints", globalSpecUrl);
globalTask.addDependency(erTask.url);
```
