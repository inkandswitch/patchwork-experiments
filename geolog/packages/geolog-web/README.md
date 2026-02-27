# geolog-web

A browser-based collaborative editor for [geolog](../geolog-rs) databases, demonstrating real-time sync and conflict resolution via [Automerge](https://automerge.org/).

The application lets you write a geolog theory in a CodeMirror editor, then creates two independent database instances side-by-side in a single browser tab, connected through an in-memory network that can be toggled on and off. This lets you disconnect, make conflicting edits on both sides, reconnect, and watch the databases converge to a consistent state -- with schema constraints (axioms) enforced throughout.

## Context: What is Geolog?

Geolog is a schema-validated collaborative database engine, implemented in Rust and compiled to WebAssembly. It sits in the sibling `geolog-rs` repository.

A geolog database is governed by a **theory** -- a schema written in a custom DSL based on geometric logic. A theory declares:

- **Sorts**: entity types with unique identity
- **Relations**: typed tuples over sorts and primitives (`Int`, `Str`)
- **Axioms**: logical constraints that the database enforces on every write

The default theory pre-filled in the editor defines a weighted graph:

```
theory WeightedGraph {
  Vertex : Sort;
  Edge : [src: Vertex, tgt: Vertex, weight: Int] -> Prop;

  ax/unique_weight : forall v1 : Vertex, v2 : Vertex.
    [src: v1, tgt: v2, weight: n1] Edge /\ [src: v1, tgt: v2, weight: n2] Edge
    |- n1 = n2;
}
```

This declares a vertex sort `Vertex`, an edge relation `Edge` carrying source, target, and weight fields, and an axiom stating that for any pair of vertices there can be at most one weight (a functional dependency). The WASM database engine checks this axiom eagerly on every operation; invalid operations are rejected locally and silently skipped when replayed from a remote peer.

You can edit this theory or write your own before creating the database. The UI adapts dynamically to whatever theory you provide.

## How the Pieces Fit Together

```
                          Browser Tab
 ┌──────────────────────────────────────────────────────┐
 │                                                      │
 │  ┌─────────────────────────────────────────────────┐ │
 │  │              SchemaEditor (CodeMirror)          │ │
 │  │         write/edit theory, then "Create DB"     │ │
 │  └──────────────────────┬──────────────────────────┘ │
 │                         │ schema string              │
 │                         ▼                            │
 │  ┌─────────────────DatabaseView────────────────────┐ │
 │  │                                                 │ │
 │  │  ┌─────────────┐ LocalNetworkAdapter ┌────────┐ │ │
 │  │  │  Automerge  │◄══════════════════►│Automerge│ │ │
 │  │  │   Repo A    │  (toggle on/off)    │ Repo B │ │ │
 │  │  └──────┬──────┘                     └───┬────┘ │ │
 │  │         │ DocHandle<GeologDoc>            │     │ │
 │  │  ┌──────▼──────┐                   ┌─────▼───┐ │ │
 │  │  │   Geolog    │                   │  Geolog  │ │ │
 │  │  │  Automerge  │                   │Automerge │ │ │
 │  │  │  (bridge)   │                   │ (bridge) │ │ │
 │  │  │ ┌─────────┐ │                   │┌───────┐ │ │ │
 │  │  │ │  WASM   │ │                   ││ WASM  │ │ │ │
 │  │  │ │Database │ │                   ││Database│ │ │ │
 │  │  │ └─────────┘ │                   │└───────┘ │ │ │
 │  │  └──────┬──────┘                   └────┬────┘ │ │
 │  │         │                               │      │ │
 │  │  ┌──────▼───────┐                ┌──────▼────┐ │ │
 │  │  │GenericEditor │                │GenericEditor│ │ │
 │  │  │  (React)     │                │  (React)  │ │ │
 │  │  └──────────────┘                └───────────┘ │ │
 │  └─────────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────────┘
```

There are four layers:

1. **SchemaEditor** lets you write or edit a geolog theory with syntax highlighting and real-time error checking. Once the theory is valid, clicking "Create Database" passes the schema string to `DatabaseView`.
2. **Automerge** handles persistence (IndexedDB), CRDT merge semantics, and network sync between the two repos. It knows nothing about geolog.
3. **GeologAutomerge** is the bridge. It maps geolog operations into an Automerge document and applies incoming Automerge patches back into the WASM database.
4. **React UI** (`GenericEditor`) reads the theory signature to dynamically generate entity lists and relation forms for whatever sorts and relations the theory declares. It calls into the bridge when the user adds entities or relation tuples.

No external server is involved. Both repos live in the same browser tab, connected by a `LocalNetworkAdapter` that delivers messages via `setTimeout(0)`. Persistence uses two separate IndexedDB databases (`geolog-repo-a`, `geolog-repo-b`).

## The Automerge Document

The Automerge document has this shape:

```typescript
interface GeologDoc {
  theory: ImmutableString;                    // exported theory JSON (with UUIDs)
  ops: { [opId: string]: ImmutableString };   // op ID -> JSON-serialized operation
}
```

Two design choices matter here:

**Theory export/import.** When the document is created, the theory is parsed (which generates fresh UUIDs for each sort and relation), then exported as JSON and stored in the document. When a second peer loads the document, it calls `importTheory()` with this stored export rather than re-parsing the source. This ensures all peers share identical UUIDs -- without this, operations from one peer would reference sort/relation IDs unknown to the other.

**Ops as opaque strings.** Each geolog operation is stored as a `JSON.stringify`'d `ImmutableString` keyed by its UUID. Automerge treats each entry as an atomic value (no field-level merging within an op). This means an Automerge `put` patch on path `["ops", someOpId]` corresponds exactly to one geolog operation, making the change listener straightforward.

## Data Flow

### Local edits

When a user clicks an "Add" button in the `GenericEditor`:

1. `GenericEditor` calls `geolog.addEntity(sortName)` or `geolog.addRelation(relName, args)` on the bridge.
2. The bridge captures the current DAG heads (`db.getHeads()`), then calls the WASM database method. The WASM layer validates the operation against the theory and returns the op.
3. The bridge attaches the captured heads as `parents` on the op (preserving causal ordering), marks the op ID as already-applied locally, and writes it into the Automerge document via `handle.change()`.
4. Automerge propagates the change to the other repo through the `LocalNetworkAdapter`.

### Remote sync

When Automerge delivers patches from the other repo:

1. The bridge's change listener (`setupChangeListener`) fires.
2. For each patch that adds a key under `ops`, it checks if the op has already been applied (via the `appliedOps` set to prevent double-application of local ops).
3. If the op is new, it parses the JSON and calls `db.applyOp(op)` on the WASM database. The parents field on the op lets the WASM layer reconstruct the same causal DAG, regardless of the order operations arrive.
4. The `GenericEditor` also listens to Automerge change events and re-reads state from the WASM database via `geolog.getState()`.

### Conflict handling

When both peers are disconnected and add conflicting edges (e.g., edges between the same vertices with different weights), the `unique_weight` axiom is violated on reconnect. The WASM `applyOp()` silently skips operations that violate axioms rather than throwing, so both peers converge to the same valid subset of operations. Which operation "wins" is deterministic (based on the causal DAG linearization order).

## Source Files

| File | Role |
|------|------|
| `src/main.tsx` | Entry point. Renders `<App>`. |
| `src/App.tsx` | Root component. Manages the two-mode state machine: "authoring" (shows `SchemaEditor`) and "editing" (shows `DatabaseView`). Defines the default `WeightedGraph` schema. |
| `src/SchemaEditor.tsx` | CodeMirror-based theory editor with geolog syntax highlighting, real-time linting via `parseTheory()`, inline error display, and a "Create Database" button that is enabled only when the theory is valid. |
| `src/DatabaseView.tsx` | The dual-pane database sync demo. Creates two Automerge repos with paired `LocalNetworkAdapter`s, initializes `GeologAutomerge` bridges (one via `create`, one via `load`), renders two side-by-side `GenericEditor` panels. Owns the connection toggle and "Edit Schema" buttons. |
| `src/GenericEditor.tsx` | Schema-driven database editor. Reads the theory signature via `getExportedTheory()` and dynamically renders a section per sort (entity list + add button) and a section per relation (tuple list + typed add form). Works with any valid theory. |
| `src/geolog-automerge.ts` | The core bridge class. `GeologAutomerge.create()` parses the theory and initializes a fresh doc. `GeologAutomerge.load()` imports the theory from an existing doc and replays stored ops. Exports `getExportedTheory()` for UI introspection and TypeScript types (`DerivedSort`, `SignatureInfo`, `ExportedTheory`, etc.) used by `GenericEditor`. |
| `src/geolog-language.ts` | CodeMirror `StreamLanguage` definition for the geolog theory DSL. Provides syntax highlighting for keywords, type names, operators, string/number literals, and comments. |
| `src/entity-names.ts` | Generates deterministic memorable "adjective-noun" names (e.g. "brave-falcon") from entity UUIDs, so entities are human-readable without showing raw UUIDs. |
| `src/LocalNetworkAdapter.ts` | In-memory Automerge `NetworkAdapter` implementation. `createPair()` returns two linked adapters. `setConnected(bool)` toggles message delivery, simulating network partition and reconnection. |

## Tech Stack

- **React 18** -- UI rendering
- **Vite 5** with `vite-plugin-wasm` -- build toolchain with WASM support
- **TypeScript** -- strict mode, ES2020 target
- **Automerge** (`@automerge/automerge-repo`, `@automerge/react`) -- CRDT sync and persistence
- **CodeMirror 6** -- theory editor with syntax highlighting and linting
- **geolog** (Rust/WASM) -- schema-validated database engine, linked from `../geolog-rs/crates/geolog-wasm` via pnpm workspace
- **pnpm** -- package manager (workspace config links the local geolog WASM package)

## Getting Started

```bash
# Install dependencies (requires geolog-rs to be built at ../geolog-rs)
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build
```

The `geolog` dependency is linked from `../geolog-rs/crates/geolog-wasm` via the pnpm workspace config. You need to build the WASM package there first (see the geolog-rs README for instructions).

## What This Demo Shows

The point of this application is to demonstrate that Automerge's CRDT merge semantics compose correctly with geolog's axiom-based schema enforcement. Specifically:

1. Two peers can independently edit a shared database while disconnected.
2. On reconnection, Automerge merges the operation sets from both peers.
3. The geolog WASM engine replays the merged operations, enforcing axioms and silently dropping any that violate constraints.
4. Both peers converge to an identical, schema-valid database state.

The `GenericEditor` UI dynamically adapts to whatever theory you write, so you can experiment with different schemas and see how the sync and conflict resolution behavior works across them.
