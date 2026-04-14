---
name: execution
description: Manage a TaskListExecutionDoc — update task statuses, create artifact documents, and add them to the execution's artifacts folder.
---

# Execution Skill

Manage a TaskListExecutionDoc during plan execution. Provides helpers to update task statuses, create DatalogDoc artifacts, wrap them in `workflow-artifact` docs, and register those wrapper docs in the execution's artifacts folder.

## Import

```javascript
const { getExecution, createArtifact, createWorkflowArtifact, addToArtifactsFolder, updateTaskStatus } = await useSkill("execution");
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

// ArtifactFolderEntry
{
  type: string,       // e.g. 'workflow-artifact'
  name: string,       // display name
  url: AutomergeUrl,  // workflow-artifact doc URL
}

// WorkflowArtifactDoc
{
  '@patchwork': { type: 'workflow-artifact' },
  name: string,
  artifactType: string,      // underlying artifact datatype, e.g. 'datalog'
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

### `createArtifact(title, facts)` (sync)

Creates a new DatalogDoc with the given title and facts array. **Do NOT await** — `repo.create()` is synchronous.

Returns `{ url }`.

```javascript
const { createArtifact } = await useSkill("execution");
const { url } = createArtifact("My Artifact", [
  { pred: "shift", args: ["mon_day"] },
  { pred: "ward", args: ["mon_day", "amu"] },
]);
```

### `createWorkflowArtifact(name, artifactDocUrl, specDocUrl, artifactType?)` (sync)

Creates a `workflow-artifact` wrapper doc that links the generated artifact to its owning spec.

Returns `{ url }`.

```javascript
const { createWorkflowArtifact } = await useSkill("execution");
const { url: workflowArtifactUrl } = createWorkflowArtifact(
  "My Artifact",
  artifactUrl,
  leafSpecUrl,
  "datalog",
);
```

### `addToArtifactsFolder(folderUrl, entry)` (async)

Adds a `workflow-artifact` entry to the artifacts folder document.

```javascript
const { addToArtifactsFolder } = await useSkill("execution");
await addToArtifactsFolder(folderUrl, {
  type: 'workflow-artifact',
  name: 'AMU Rota',
  url: workflowArtifactUrl,
});
```

### `updateTaskStatus(taskUrl, status)` (async)

Updates a TaskDoc's status field.

```javascript
const { updateTaskStatus } = await useSkill("execution");
await updateTaskStatus(taskUrl, 'in-progress');
// ... do work ...
await updateTaskStatus(taskUrl, 'completed');
```

## Example

```javascript
const { getExecution, createArtifact, createWorkflowArtifact, addToArtifactsFolder, updateTaskStatus } = await useSkill("execution");
const { getPlan } = await useSkill("plan");
const { getSpec, getLeafSpecs } = await useSkill("spec");

const exec = await getExecution(executionUrl);
const plan = await getPlan(planUrl);

for (const taskUrl of exec.getTaskUrls()) {
  await updateTaskStatus(taskUrl, 'in-progress');

  const task = await plan.getTask(taskUrl);
  const specUrl = task.getSpecDocUrl();
  const spec = await getSpec(specUrl);

  // Create artifact with solution facts
  const { url: artifactUrl } = createArtifact(spec.getGoal(), [
    { pred: "shift", args: ["day_1"] },
    // ... more facts
  ]);

  const { url: workflowArtifactUrl } = createWorkflowArtifact(
    spec.getGoal(),
    artifactUrl,
    specUrl,
    'datalog',
  );

  // Register in artifacts folder
  await addToArtifactsFolder(exec.getArtifactsFolderUrl(), {
    type: 'workflow-artifact',
    name: spec.getGoal(),
    url: workflowArtifactUrl,
  });

  await updateTaskStatus(taskUrl, 'completed');
}

exec.setStatus('completed');
```
