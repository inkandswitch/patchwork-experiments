# WebAssembly Interface

**Status: Implemented** (see `crates/geolog-wasm/`)

Geolog is currently built as a pretty runtime agnostic core crate. This RFC proposes a WebAssembly interface for Geolog, allowing it to be used in web applications.

The primary integration point is with automerge-repo, which handles network sync and storage. The architecture is:

1. **Automerge** stores the theory source code and a map of operations (keyed by OpId)
2. **Geolog-wasm** parses the theory, validates operations, and derives state
3. When the user makes changes, Geolog produces new operations to add to automerge

This means Geolog-wasm focuses on validation and state derivation, while automerge handles the DAG structure and sync.

## JS API

### Theory Parsing

```typescript
// Parse a theory from source code. Throws ParseError on failure.
function parseTheory(source: string): Theory;

// Theory provides schema information
interface Theory {
  readonly name: string;
  
  // Check if a sort/relation exists by name
  hasSort(name: string): boolean;
  hasRelation(name: string): boolean;
}
```

### Database

The Database derives state from a set of operations. It does not own the operations - automerge does.

```typescript
// Create an empty database from a theory
function createDatabase(theory: Theory): Database;

// Create a database from a theory and existing operations (loaded from automerge).
// Throws if any operation is invalid.
function createDatabaseFromOps(theory: Theory, ops: Op[]): Database;

interface Database {
  readonly theoryName: string;
  
  // Add an entity by sort NAME. Returns the new Op to store in automerge.
  // Throws DbError if the sort doesn't exist.
  addEntity(sortName: string): AddEntityOp;
  
  // Add a relation by NAME. Returns the new Op to store in automerge.
  // Throws DbError on validation failure or axiom violation.
  addRelation(relName: string, args: Value[]): AddRelationOp;
  
  // Apply an operation from automerge (e.g., from a remote peer).
  // Invalid operations are silently skipped (consistent with collaboration semantics).
  applyOp(op: Op): void;
  
  // Query derived state
  toJson(): string;
  
  // Check if an entity exists
  hasEntity(entityId: string): boolean;
}
```

### Operations and Values

Operations are simple JSON-serializable objects that automerge stores directly.
Sorts and relations are identified by UUID (for stability), with names included for readability.

```typescript
// ID types (UUIDs as strings)
type EntityId = string; // UUID
type OpId = string;     // UUID

// Values in relation arguments
type Value = 
  | { entity: EntityId }
  | { int: number }
  | { str: string };

// Operations - use UUIDs as primary identifiers, names for readability
type Op = AddEntityOp | AddRelationOp;

interface AddEntityOp {
  type: "addEntity";
  id: OpId;           // Operation UUID
  sort: string;       // Sort UUID (primary identifier)
  sortName: string;   // Sort name (for readability)
  entityId: EntityId;
}

interface AddRelationOp {
  type: "addRelation";
  id: OpId;           // Operation UUID
  rel: string;        // Relation UUID (primary identifier)
  relName: string;    // Relation name (for readability)
  args: Value[];
}

interface AddRelationOp {
  type: "addRelation";
  id: OpId;        // Unique ID for this operation
  rel: string;     // Relation NAME (e.g., "E")
  args: Value[];
}
```

### Error Handling

```typescript
class DbError extends Error {
  readonly message: string;
}

class ParseError extends Error {
  readonly diagnostics: Diagnostic[];
}

interface Diagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly span: { start: number, end: number };
}
```

### Example Usage

```typescript
import { parseTheory, createDatabase } from 'geolog-wasm';

// Define a weighted graph theory
const theory = parseTheory(`
  theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    
    ax/unique_weight : forall v1 : V, v2 : V.
      [src: v1, tgt: v2, weight: n1] E /\\ [src: v1, tgt: v2, weight: n2] E
      |- n1 = n2;
  }
`);

// Create a database
const db = createDatabase(theory);

// Add entities by sort NAME - returns ops to store in automerge
// Op includes both UUID (sort) and name (sortName) for convenience
const addA = db.addEntity("V");  // { type: "addEntity", id: "...", sort: "<uuid>", sortName: "V", entityId: "..." }
const addB = db.addEntity("V");

// Add relation by NAME
const addEdge = db.addRelation("E", [
  { entity: addA.entityId },
  { entity: addB.entityId },
  { int: 5 }
]);

// This would throw - violates unique_weight axiom
try {
  db.addRelation("E", [
    { entity: addA.entityId },
    { entity: addB.entityId },
    { int: 10 }
  ]);
} catch (e) {
  console.log("Axiom violation:", e.message);
}

// Get current state as JSON
console.log(db.toJson());
```

### Integration with Automerge-Repo

```typescript
import { Repo } from '@automerge/automerge-repo';
import { parseTheory, createDatabaseFromOps } from 'geolog-wasm';

// Automerge document schema
interface GeologDoc {
  theorySource: string;
  ops: Record<OpId, Op>;  // Map from op ID to operation
}

class GeologHandle {
  private repo: Repo;
  private handle: DocHandle<GeologDoc>;
  private db: Database | null = null;
  
  async load(): Promise<Database> {
    const doc = await this.handle.doc();
    const theory = parseTheory(doc.theorySource);
    const ops = Object.values(doc.ops);
    this.db = createDatabaseFromOps(theory, ops);
    return this.db;
  }
  
  // Add an entity and persist to automerge
  addEntity(sortName: string): string {
    const op = this.db!.addEntity(sortName);
    this.handle.change(doc => {
      doc.ops[op.id] = op;
    });
    return op.entityId;
  }
  
  // Add a relation and persist to automerge
  addRelation(relName: string, args: Value[]): void {
    const op = this.db!.addRelation(relName, args);
    this.handle.change(doc => {
      doc.ops[op.id] = op;
    });
  }
  
  // Handle remote changes from automerge
  onRemoteChange(newOps: Op[]): void {
    for (const op of newOps) {
      this.db!.applyOp(op);  // Invalid ops silently skipped
    }
  }
}
```

## Code Structure

Geolog is currently a single rust crate. To expose a WebAssembly interface we will need a new crate called geolog-wasm. There are some mechanical changes we should make to achieve this:

* Make the current crate a workspace root with a Cargo.toml that lists geolog-core and geolog-wasm as members
* Move the current src/*, Cargo.* etc into a new folder called crates/geolog-core
* Create a new crate in crates/geolog-wasm that depends on geolog-core and exposes the WebAssembly interface using wasm-bindgen.

## Implementation Notes

### wasm-bindgen Considerations

The WASM interface will use `wasm-bindgen` for JS interop. Key considerations:

1. **ID types as strings**: `SortId`, `RelId`, `EntityId`, `OpId` are exposed as plain strings (UUIDs) for easy serialization and storage in automerge. No wrapper classes needed.

2. **Operations as plain objects**: `Op`, `Value`, and related types are plain JS objects that serialize directly to JSON. We use `serde-wasm-bindgen` to convert between Rust and JS representations.

3. **Error handling**: Rust `Result` types map to JS exceptions. Functions that can fail (like `addRelation`) throw `DbError`.

4. **Memory management**: wasm-bindgen handles memory management automatically. `Database` and `Theory` are the main WASM objects that JS holds references to.

### Crate Structure

```
geolog/
├── Cargo.toml              # Workspace root
├── crates/
│   ├── geolog-core/        # Current crate, renamed
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── opdag.rs
│   │       ├── database.rs
│   │       └── ...
│   └── geolog-wasm/        # New WASM bindings crate
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs      # wasm-bindgen exports
├── rfcs/
└── docs/
```

### Dependencies for geolog-wasm

```toml
[package]
name = "geolog-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
geolog-core = { path = "../geolog-core" }
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde-wasm-bindgen = "0.6"
js-sys = "0.3"

[dev-dependencies]
wasm-bindgen-test = "0.3"
```

## Open Questions

### 1. Value Representation

Should `Value` be:
- A JS object with key discriminator like `{ entity: id }` (current design)
- An object with `type` field like `{ type: "entity", value: id }`
- Separate classes `EntityValue`, `IntValue`, `StrValue`

**Decision**: Use the key discriminator approach (`{ entity: id }`, `{ int: n }`, `{ str: s }`). This is idiomatic TypeScript, works well with pattern matching, and serializes cleanly to JSON for automerge storage.

### 2. Parse Error Handling

Should `parseTheory` throw on first error or collect all diagnostics?

**Decision**: Collect all diagnostics and throw `ParseError` with the full list. This gives better UX for theory editing - users see all issues at once rather than fixing one at a time.

### 3. Observable State Changes

Should the JS API support callbacks/events when state changes? This would be useful for reactive UI frameworks.

**Decision**: Defer for now. The current design is pull-based - the UI calls `toJson()` when needed. Automerge-repo already provides change notifications, so the integration layer can trigger re-renders. If needed later, we can add an `onChange` callback to `Database`.

### 4. Theory Updates

What happens if the theory source changes? Can we migrate operations to a new theory version?

**Decision**: Defer. For now, changing the theory means creating a new document. Theory migration is complex and not needed for initial use cases.
