---
name: projection
description: Create and manage ProjectionSpecDocs that define how a DatalogDoc artifact is displayed as an editable spreadsheet. Use when generating or modifying the table view of artifact data.
---

# Projection Skill

Create and manage ProjectionSpecDocs. A projection defines how a flat DatalogDoc (facts) is rendered as a spreadsheet with typed, editable columns.

## Import

```javascript
const { createProjection, getProjection, setArtifactProjection } = await useSkill("projection");
```

## Types

### ProjectionSpecDoc

```javascript
{
  '@patchwork': { type: 'artifact-projection' },
  schemaVersion: 2,
  artifactDocUrl: AutomergeUrl,   // the DatalogDoc this projects
  sourceType: 'datalog',
  title: string,
  rows: ProjectionRowsSpec,
  columns: ProjectionSpecColumn[],
}
```

### ProjectionRowsSpec

Defines which facts create rows and how rows are identified.

```javascript
{
  entityPredicate: string,   // predicate whose facts define rows (e.g. "shift")
  keyArg: number,            // which arg is the row key (usually 0)
  entityIdPrefix: string,    // prefix for auto-generated row IDs
  order: 'entity-fact-order',
  create: { insertEntityFact: true },
  delete: { mode: 'managed-predicates-only' },
}
```

### ProjectionSpecColumn

Each column has an `id`, `header`, `cellType`, `read` binding, optional `write` binding, and `cardinality`.

```javascript
{
  id: string,               // unique column identifier
  header: string,           // display name
  cellType: 'text' | 'number' | 'boolean' | 'entity',
  read: ReadBinding,
  write?: WriteBinding,     // omit for read-only columns
  cardinality: 'zero-or-one' | 'exactly-one' | 'many',
  blankPolicy?: 'delete' | 'reject',
  readOnlyReason?: string,  // shown when column has no write binding
}
```

### Read Bindings

**`derived-row-key`** — displays the row key itself (always read-only):
```javascript
{ kind: 'derived-row-key' }
```

**`fact-arg`** — reads a specific argument from a matching fact:
```javascript
{ kind: 'fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 }
// For row "amu_day", reads ward(amu_day, X) → X
```

**`fact-presence`** — boolean: does a matching fact exist?
```javascript
{ kind: 'fact-presence', pred: 'night_shift', rowKeyArg: 0 }
// For row "amu_day", checks if night_shift(amu_day) exists → yes/no
```

**`slot-value`** — reads from a multi-slot predicate (e.g. assignment_slot):
```javascript
{ kind: 'slot-value', pred: 'assignment_slot', rowKeyArg: 0, slotArg: 1, slot: 1, valueArg: 2 }
// For row "amu_day", reads assignment_slot(amu_day, 1, X) → X
```

### Write Bindings

**`upsert-fact-arg`** — insert or update a fact argument:
```javascript
{ kind: 'upsert-fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 }
```

**`set-fact-presence`** — add or remove a fact:
```javascript
{ kind: 'set-fact-presence', pred: 'night_shift', rowKeyArg: 0 }
```

**`upsert-slot-value`** — insert or update a slot in a multi-slot predicate:
```javascript
{ kind: 'upsert-slot-value', pred: 'assignment_slot', rowKeyArg: 0, slotArg: 1, slot: 1, valueArg: 2 }
```

### Matching read and write bindings

When a column is editable, the write binding must mirror its read binding:
- `fact-arg` read → `upsert-fact-arg` write (same pred, rowKeyArg, valueArg)
- `fact-presence` read → `set-fact-presence` write (same pred, rowKeyArg)
- `slot-value` read → `upsert-slot-value` write (same pred, rowKeyArg, slotArg, slot, valueArg)

## API

### `createProjection(artifactDocUrl, title, rowsSpec, columns)` (sync)

Creates a new ProjectionSpecDoc. **Do NOT await** — `repo.create()` is synchronous.

Returns `{ url }`.

```javascript
const { createProjection } = await useSkill("projection");
const { url } = createProjection(artifactUrl, "My Table", {
  entityPredicate: 'shift',
  keyArg: 0,
  entityIdPrefix: 'shift',
  order: 'entity-fact-order',
  create: { insertEntityFact: true },
  delete: { mode: 'managed-predicates-only' },
}, [
  {
    id: 'shift-id',
    header: 'Shift',
    cellType: 'text',
    read: { kind: 'derived-row-key' },
    cardinality: 'exactly-one',
    readOnlyReason: 'Row key is derived from the entity fact.',
  },
  {
    id: 'ward',
    header: 'Ward',
    cellType: 'text',
    read: { kind: 'fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 },
    write: { kind: 'upsert-fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 },
    cardinality: 'zero-or-one',
    blankPolicy: 'delete',
  },
]);
```

### `getProjection(url)` (async)

Returns a read/write interface for an existing ProjectionSpecDoc.

| Method | Description |
|--------|-------------|
| `getTitle()` | Returns the projection title |
| `setTitle(title)` | Sets the title |
| `getColumns()` | Returns a copy of the columns array |
| `addColumn(column)` | Appends a column to the columns array |
| `removeColumn(id)` | Removes the column with the given id |
| `updateColumn(id, updates)` | Merges updates into the column with the given id |
| `getRows()` | Returns the rows spec |
| `setRows(rowsSpec)` | Sets the rows spec |

```javascript
const { getProjection } = await useSkill("projection");
const proj = await getProjection(projectionUrl);
proj.addColumn({
  id: 'hours',
  header: 'Hours',
  cellType: 'number',
  read: { kind: 'fact-arg', pred: 'shift_hours', rowKeyArg: 0, valueArg: 1 },
  write: { kind: 'upsert-fact-arg', pred: 'shift_hours', rowKeyArg: 0, valueArg: 1 },
  cardinality: 'zero-or-one',
  blankPolicy: 'delete',
});
```

### `setArtifactProjection(folderUrl, artifactUrl, projectionUrl)` (async)

Updates the artifact folder entry to link the projection doc.

```javascript
const { setArtifactProjection } = await useSkill("projection");
await setArtifactProjection(folderUrl, artifactUrl, projectionUrl);
```

## Analyzing Facts to Build a Projection

When generating a projection for a DatalogDoc, analyze the facts to determine:

1. **Entity predicate** — the predicate that defines rows. Look for a predicate that appears once per logical entity (e.g. `shift(amu_day)`, `employee(alice)`). The first argument is typically the row key.

2. **Columns** — for each other predicate:
   - If it takes `(rowKey, value)` → `fact-arg` read/write, cellType based on value type
   - If it takes `(rowKey)` with no extra args → `fact-presence` read/write, cellType `boolean`
   - If it takes `(rowKey, slot, value)` → `slot-value` read/write, create one column per distinct slot value

3. **Cell types** — infer from values: numbers → `'number'`, `true/false/yes/no` → `'boolean'`, otherwise `'text'`

4. **First column** should always be `derived-row-key` (read-only, shows the row identifier)

## Example: Full Projection Generation

```javascript
const { createProjection, setArtifactProjection } = await useSkill("projection");
const { getDatalog } = await useSkill("datalog");

// Read artifact facts
const db = await getDatalog(artifactUrl);
const facts = db.getFacts();

// Analyze facts to determine entity predicate and columns
// (your analysis logic here)

// Create projection
const { url: projUrl } = createProjection(artifactUrl, "Rota Table", {
  entityPredicate: 'shift',
  keyArg: 0,
  entityIdPrefix: 'shift',
  order: 'entity-fact-order',
  create: { insertEntityFact: true },
  delete: { mode: 'managed-predicates-only' },
}, columns);

// Link to artifact in folder
await setArtifactProjection(folderUrl, artifactUrl, projUrl);
```
