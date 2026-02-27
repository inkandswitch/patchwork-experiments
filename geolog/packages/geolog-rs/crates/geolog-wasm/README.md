# geolog

## Usage

```javascript
import { parseTheory, createDatabase } from "geolog"

// Define a schema
const theory = parseTheory(`
  theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    
    ax/unique_weight : forall v1 : V, v2 : V.
      [src: v1, tgt: v2, weight: n1] E /\\ [src: v1, tgt: v2, weight: n2] E
      |- n1 = n2;
  }
`)

// Create a database
const db = createDatabase(theory)

// Add entities
const v1 = db.addEntity("V")
const v2 = db.addEntity("V")

// Add a relation
const edge = db.addRelation("E", [
  { entity: v1.entityId },
  { entity: v2.entityId },
  { int: 5 }
])

// Get state as JSON
console.log(db.toJson())
```

## API

### `parseTheory(source: string): Theory`

Parse a theory from source code. Throws on syntax or semantic errors.

```javascript
const theory = parseTheory(`
  theory Graph {
    V : Sort;
    E : [src: V, tgt: V] -> Prop;
  }
`)

theory.name          // "Graph"
theory.hasSort("V")  // true
theory.hasRelation("E")  // true
```

### `createDatabase(theory: Theory): Database`

Create an empty database from a theory.

```javascript
const db = createDatabase(theory)
```

### `createDatabaseFromOps(theory: Theory, ops: Op[]): Database`

Recreate a database from stored operations. Throws if any operation is invalid.

```javascript
const ops = loadOpsFromStorage()
const db = createDatabaseFromOps(theory, ops)
```

### `Database.addEntity(sortName: string): AddEntityOp`

Add an entity of the given sort. Returns an operation object to store.

```javascript
const op = db.addEntity("V")
// {
//   type: "addEntity",
//   id: "op-uuid",
//   sort: "sort-uuid",
//   sortName: "V",
//   entityId: "entity-uuid"
// }
```

### `Database.addRelation(relName: string, args: Value[]): AddRelationOp`

Add a relation tuple. Throws if validation fails or an axiom is violated.

```javascript
const op = db.addRelation("E", [
  { entity: "entity-uuid-1" },
  { entity: "entity-uuid-2" },
  { int: 42 }
])
// {
//   type: "addRelation",
//   id: "op-uuid",
//   rel: "rel-uuid",
//   relName: "E",
//   args: [...]
// }
```

Values can be:
- `{ entity: string }` - reference to an entity by UUID
- `{ int: number }` - integer value
- `{ str: string }` - string value

### `Database.applyOp(op: Op): void`

Apply an operation from external source (e.g., synced from another peer). Invalid operations are silently skipped.

```javascript
db.applyOp(opFromRemotePeer)
```

### `Database.toJson(): string`

Get the current database state as a JSON string.

```javascript
const state = JSON.parse(db.toJson())
// {
//   entities: { V: ["uuid1", "uuid2"] },
//   relations: { E: [[{entity: "uuid1"}, {entity: "uuid2"}, {int: 5}]] }
// }
```

### `Database.theoryName: string`

The name of the theory this database uses.

### `Database.hasEntity(entityId: string): boolean`

Check if an entity exists in the database.

### `Database.getHeads(): string[]`

Get the current DAG heads (operation IDs with no children).

```javascript
const heads = db.getHeads()
// ["op-uuid-1", "op-uuid-2"]
```

### `Database.createPatch(knownHeads: string[]): Patch`

Create a patch containing operations that a peer doesn't have. Pass the peer's known heads to get only the missing operations.

```javascript
// Peer B wants to sync from Peer A
const patch = peerA.createPatch(peerB.getHeads())
// { ops: [...], heads: [...] }
```

### `Database.applyPatch(patch: Patch): void`

Apply a patch received from another peer. Invalid operations are silently skipped.

```javascript
peerB.applyPatch(patch)
```

### `Theory.export(): ExportedTheory`

Export a theory to a JSON-serializable object including all UUIDs.

```javascript
const exported = theory.export()
// {
//   name: "Graph",
//   signature: { sorts: [...], relations: [...], functions: [...] },
//   axioms: [...]
// }
```

### `importTheory(data: ExportedTheory): Theory`

Import a theory from a previously exported object. Use this to ensure multiple peers use identical UUIDs for sorts and relations.

```javascript
// Peer A parses and shares the theory
const theory = parseTheory(source)
const exported = theory.export()
sendToPeer(exported)

// Peer B imports the shared theory (same UUIDs!)
const theory = importTheory(receivedExport)
const db = createDatabase(theory)
```

**Important**: When collaborating, all peers must use the same theory (with matching UUIDs). If each peer parses the schema independently, they'll generate different UUIDs and operations won't be compatible. Use `export()` and `importTheory()` to share the theory.

## Theory Language

### Sorts

Entity types in your database:

```
Person : Sort;
Document : Sort;
```

### Relations

Facts about entities:

```
knows : [a: Person, b: Person] -> Prop;
age : [person: Person, years: Int] -> Prop;
title : [doc: Document, text: Str] -> Prop;
```

### Axioms

Constraints enforced on every operation:

```
// Functional dependency - each person has one age
ax/unique_age : forall p : Person.
  [person: p, years: n1] age /\ [person: p, years: n2] age
  |- n1 = n2;

// Symmetry - knows is bidirectional  
ax/symmetric : forall a : Person, b : Person.
  [a: a, b: b] knows |- [a: b, b: a] knows;
```

## Platform Support

Works in all JavaScript environments:

- Node.js (ESM and CommonJS)
- Browsers (via bundlers or `<script>` tag)
- Cloudflare Workers
- Deno

## License

MIT
