---
name: projection
description: Create and manage ProjectionSpecDocs that define how a DatalogDoc artifact is displayed as an editable spreadsheet. Use when generating or modifying the table view of artifact data.
---

# Projection Skill

Create and manage ProjectionSpecDocs. A projection defines how a flat DatalogDoc (facts) is rendered as a spreadsheet with typed, editable columns.

## Import

```javascript
const { createProjection, getProjection, setSpecProjection } = await useSkill("projection");
```

For key-value projections:

```javascript
const { createKeyValueProjection } = await useSkill("projection");
```

## Types

### ProjectionSpecDoc

```javascript
{
  '@patchwork': { type: 'artifact-projection' },
  schemaVersion: 3,
  sourceType: 'datalog',
  viewKind?: 'table' | 'key-value', // defaults to 'table'
  title: string,
  rows?: ProjectionRowsSpec,
  columns?: ProjectionSpecColumn[],
  entries?: ProjectionKeyValueEntrySpec[],
  view?: {
    expandScript?: string, // optional view-level derived fact expansion
  },
}
```

### ProjectionRowsSpec

Defines which facts create rows and how rows are identified.

```javascript
{
  entityPredicate: string,   // predicate whose facts define rows (e.g. "shift")
  keyArg: number,            // which arg is the row key (often 0, but not required)
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

### ProjectionKeyValueEntrySpec

Used by `viewKind: 'key-value'` projections for singleton/key-value artifacts.

```javascript
{
  id: string,
  label: string,
  cellType: 'text' | 'number' | 'boolean' | 'entity',
  read: ReadBinding,
  write?: WriteBinding,
  blankPolicy?: 'delete' | 'reject',
  readOnlyReason?: string,
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

`rowKeyArg` can be any argument position. For example:

```javascript
{ kind: 'fact-arg', pred: 'service', rowKeyArg: 1, valueArg: 0 }
// For row "small", reads service(X, small) → X
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

**`singleton-fact-arg`** — reads an argument from a singleton fact:
```javascript
{ kind: 'singleton-fact-arg', pred: 'max_connections', valueArg: 0 }
// Reads max_connections(X) → X
```

**`singleton-fact-presence`** — boolean: does a singleton fact exist?
```javascript
{ kind: 'singleton-fact-presence', pred: 'log_checkpoints' }
// Checks whether log_checkpoints. exists
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

**`upsert-singleton-fact-arg`** — insert or update a singleton fact argument:
```javascript
{ kind: 'upsert-singleton-fact-arg', pred: 'max_connections', valueArg: 0 }
```

**`set-singleton-fact-presence`** — add or remove a singleton fact:
```javascript
{ kind: 'set-singleton-fact-presence', pred: 'log_checkpoints' }
```

### Matching read and write bindings

When a column is editable, the write binding must mirror its read binding:
- `fact-arg` read → `upsert-fact-arg` write (same pred, rowKeyArg, valueArg)
- `fact-presence` read → `set-fact-presence` write (same pred, rowKeyArg)
- `slot-value` read → `upsert-slot-value` write (same pred, rowKeyArg, slotArg, slot, valueArg)
- `singleton-fact-arg` read → `upsert-singleton-fact-arg` write (same pred, valueArg)
- `singleton-fact-presence` read → `set-singleton-fact-presence` write (same pred)

## API

### `createProjection(title, rowsSpec, columns)` (sync)

Creates a new ProjectionSpecDoc. **Do NOT await** — `repo.create()` is synchronous.

Returns `{ url }`.

```javascript
const { createProjection } = await useSkill("projection");
const { url } = createProjection("My Table", {
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

### `createKeyValueProjection(title, entries, viewSpec?)` (sync)

Creates a `viewKind: 'key-value'` projection for singleton/key-value artifacts.

```javascript
const { createKeyValueProjection } = await useSkill("projection");
const { url } = createKeyValueProjection("Postgres Config", [
  {
    id: 'max-connections',
    label: 'max_connections',
    cellType: 'number',
    read: { kind: 'singleton-fact-arg', pred: 'max_connections', valueArg: 0 },
  },
], {
  expandScript: `return ctx.defaultExpanded;`,
});
```

### `getProjection(url)` (async)

Returns a read/write interface for an existing ProjectionSpecDoc.

| Method | Description |
|--------|-------------|
| `getTitle()` | Returns the projection title |
| `setTitle(title)` | Sets the title |
| `getColumns()` | Returns a copy of the columns array |
| `getEntries()` | Returns a copy of the key-value entries array |
| `addColumn(column)` | Appends a column to the columns array |
| `addEntry(entry)` | Appends a key-value entry |
| `removeColumn(id)` | Removes the column with the given id |
| `removeEntry(id)` | Removes the key-value entry with the given id |
| `updateColumn(id, updates)` | Merges updates into the column with the given id |
| `updateEntry(id, updates)` | Merges updates into the key-value entry |
| `getRows()` | Returns the rows spec |
| `setRows(rowsSpec)` | Sets the rows spec |
| `getViewKind()` | Returns the current `viewKind` |
| `setViewKind(viewKind)` | Sets `viewKind` |
| `getView()` | Returns the `view` config |
| `setView(viewSpec)` | Sets the `view` config |

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

### `setSpecProjection(specUrl, projectionUrl)` (async)

Updates a spec to link the reusable projection doc.

```javascript
const { setSpecProjection } = await useSkill("projection");
await setSpecProjection(specUrl, projectionUrl);
```

## Analyzing Facts to Build a Projection

When generating a projection for a DatalogDoc, analyze the facts to determine:

1. **Entity predicate** — the predicate that defines rows. Look for a predicate that appears once per logical entity (e.g. `shift(amu_day)`, `employee(alice)`). The row key is often the first argument, but can be any argument position supported by `rows.keyArg`.

2. **Columns** — for each other predicate:
   - If it contains the row key and one value you want to show → `fact-arg` read/write, using the correct `rowKeyArg` and `valueArg`
   - If it contains only the row key as the meaningful match → `fact-presence` read/write, cellType `boolean`
   - If it contains `(rowKey, slot, value)` → `slot-value` read/write, create one column per distinct slot value

3. **Cell types** — infer from values: numbers → `'number'`, `true/false/yes/no` → `'boolean'`, otherwise `'text'`

4. **First column** should always be `derived-row-key` (read-only, shows the row identifier)

## Current Limits

Projection bindings are intentionally simple today:

- A normal cell can only read from a **single predicate lookup** keyed by the current row.
- The runtime does **not** support join expressions such as `service(Service, Size)` + `instance(Size, Cpu, Mem, Disk, Cost)` in one column.
- The runtime also does not have a first-class binding for sheet-global singleton facts like `peak_concurrent_db_connections(300)` repeated across every row.

Before deciding a dataset is unsupported, try choosing a different row axis that avoids the join. For the example above, an `instance`-keyed table can read:

- service name from `service` using `rowKeyArg: 1`
- CPU/memory/disk/cost from `instance` using `rowKeyArg: 0`

If a useful table still requires following one fact into another fact, the current answer is to add derived/denormalized facts outside the projection model or extend the lens backend with a richer binding type.

## Key-Value Views

Use `viewKind: 'key-value'` when the artifact is better expressed as a singleton settings view than as rows/columns.

- Good fit: config settings like `postgres.conf`
- Read from singleton facts with `singleton-fact-arg` / `singleton-fact-presence`
- If the display needs derived settings, use `view.expandScript` to add derived facts plus provenance entries for the rendered settings
- In v1, generator support should stay generic: choose `key-value` only when the artifact already looks singleton-shaped or when a hand-authored derived projection is clearly required

## Example: Full Projection Generation

```javascript
const { createProjection, setSpecProjection } = await useSkill("projection");
const { getDatalog } = await useSkill("datalog");

// Read artifact facts
const db = await getDatalog(artifactUrl);
const facts = db.getFacts();

// Analyze facts to determine entity predicate and columns
// (your analysis logic here)

// Create projection
const { url: projUrl } = createProjection("Rota Table", {
  entityPredicate: 'shift',
  keyArg: 0,
  entityIdPrefix: 'shift',
  order: 'entity-fact-order',
  create: { insertEntityFact: true },
  delete: { mode: 'managed-predicates-only' },
}, columns);

// Link to owning spec
await setSpecProjection(specUrl, projUrl);
```
