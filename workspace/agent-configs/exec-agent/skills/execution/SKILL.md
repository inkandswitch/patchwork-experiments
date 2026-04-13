---
name: execution
description: Manage a TaskListExecutionDoc — update task statuses, create artifact documents, and add them to the execution's artifacts folder.
---

# Execution Skill

Manage a TaskListExecutionDoc during plan execution. Provides helpers to update task statuses, create DatalogDoc artifacts, and register them in the execution's artifacts folder.

## Import

```javascript
const { getExecution, createArtifact, addToArtifactsFolder, updateTaskStatus } = await useSkill("execution");
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
  type: string,       // e.g. 'datalog'
  name: string,       // display name
  url: AutomergeUrl,  // artifact doc URL
  specDocUrls?: AutomergeUrl[],  // linked specs
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

### `addToArtifactsFolder(folderUrl, entry)` (async)

Adds an ArtifactFolderEntry to the artifacts folder document.

```javascript
const { addToArtifactsFolder } = await useSkill("execution");
await addToArtifactsFolder(folderUrl, {
  type: 'datalog',
  name: 'AMU Rota',
  url: artifactUrl,
  specDocUrls: [leafSpecUrl],
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
const { getExecution, createArtifact, addToArtifactsFolder, updateTaskStatus } = await useSkill("execution");
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

  // Register in artifacts folder
  await addToArtifactsFolder(exec.getArtifactsFolderUrl(), {
    type: 'datalog',
    name: spec.getGoal(),
    url: artifactUrl,
    specDocUrls: [specUrl],
  });

  await updateTaskStatus(taskUrl, 'completed');
}

exec.setStatus('completed');
```
