---
name: execution
description: Manage a TaskListExecutionDoc — update task statuses, create artifact documents, and add them to the execution's artifacts folder.
---

# Execution Skill

Manage a TaskListExecutionDoc during plan execution. Provides helpers to update task statuses, create DatalogDoc artifacts, wrap them in `workflow-artifact` docs, and register those wrapper docs in the execution's artifacts folder.

## Import

```javascript
const { getExecution, createArtifact, updateTaskStatus } = await useSkill("execution");
```

## Types

```javascript
// TaskListExecutionDoc shape
{
  '@patchwork': { type: 'task-list-execution' },
  specDocUrl: AutomergeUrl,
  planDocUrl: AutomergeUrl,
  taskUrls: AutomergeUrl[],
  artifactsFolderUrl: AutomergeUrl,
  status: 'in-progress' | 'failed' | 'completed',
}

// WorkflowArtifactDoc (created automatically by createArtifact)
{
  '@patchwork': { type: 'workflow-artifact' },
  name: string,
  artifactDocUrl: AutomergeUrl,
  specDocUrl: AutomergeUrl,  // owning spec
}
```

## API

### `getExecution(url)` (async)

Returns a read/write interface for the TaskListExecutionDoc at `url`.

| Method | Description |
|--------|-------------|
| `getTaskUrls()` | Returns a copy of the task URL array |
| `getArtifactsFolderUrl()` | Returns the artifacts folder URL |
| `getStatus()` | Returns the current execution status |
| `setStatus(status)` | Sets the execution status ('in-progress', 'completed', 'failed') |

```javascript
const { getExecution } = await useSkill("execution");
const exec = await getExecution(executionUrl);
const taskUrls = exec.getTaskUrls();
exec.setStatus('completed');
```

### `await createArtifact(artifactsFolderUrl, name, specDocUrl, facts)` (async)

Creates a DatalogDoc artifact, wraps it in a `workflow-artifact` doc, and adds the wrapper to the artifacts folder. **Must be awaited.**

Returns `{ artifactUrl, workflowArtifactUrl }`.

```javascript
const { createArtifact } = await useSkill("execution");
const { artifactUrl, workflowArtifactUrl } = await createArtifact(
  artifactsFolderUrl,
  "AMU Rota",
  leafSpecUrl,
  [
    { pred: "shift", args: ["mon_day"] },
    { pred: "ward", args: ["mon_day", "amu"] },
  ],
);
```

### `await updateTaskStatus(taskUrl, status)` (async)

Updates a TaskDoc's status field.

```javascript
const { updateTaskStatus } = await useSkill("execution");
await updateTaskStatus(taskUrl, 'in-progress');
// ... do work ...
await updateTaskStatus(taskUrl, 'completed');
```

## Example

```javascript
const { getExecution, createArtifact, updateTaskStatus } = await useSkill("execution");
const { getPlan } = await useSkill("plan");
const { getSpec } = await useSkill("spec");

const exec = await getExecution(executionUrl);
const plan = await getPlan(planUrl);
const artifactsFolderUrl = exec.getArtifactsFolderUrl();

for (const taskUrl of exec.getTaskUrls()) {
  await updateTaskStatus(taskUrl, 'in-progress');

  const task = await plan.getTask(taskUrl);
  const specUrl = task.getSpecDocUrl();
  const spec = await getSpec(specUrl);

  // Create artifact with solution facts — automatically wrapped and added to folder
  await createArtifact(artifactsFolderUrl, spec.getGoal(), specUrl, [
    { pred: "shift", args: ["day_1"] },
    // ... more facts that satisfy the spec constraints
  ]);

  await updateTaskStatus(taskUrl, 'completed');
}

exec.setStatus('completed');
```
