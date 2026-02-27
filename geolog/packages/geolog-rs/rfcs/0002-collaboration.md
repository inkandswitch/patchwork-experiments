# Collaboration

> **Status**: Implemented. The OpDag architecture described here is now the core
> data structure for collaboration in the database system.

The point of this project is to experiment with collaboration on instances of a Theory. This is the purpose of the OpDag architecture. An important aspect of this experiment is that the whole point of using a geometric logic as the basis for our theories is that it means that we can accommodate concurrent changes. Concurrent changes may modify the total order of operations in the DAG, but everyone will agree on the final order through deterministic linearization.


## Design Goals

The core design question is how to structure the operation storage such that:

1. Operations can be efficiently synced between peers
2. Concurrent operations can be merged deterministically
3. The Database can derive state from operations while staying agnostic to sync details

## The OpDag Structure

The `OpDag` is a DAG (directed acyclic graph) of operations where each operation carries metadata about its causal relationships. When multiple nodes generate operations concurrently, we need to know:

1. Which operations happened before which (causality)
2. Which operations are concurrent (no causal relationship)
3. How to merge concurrent operations into a consistent order

### The OpDag Structure

We replace `OpLog` with `OpDag`, where each operation carries metadata about its position in a directed acyclic graph:

```rust
/// A unique identifier for an operation
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct OpId(pub Uuid);

impl OpId {
    pub fn new() -> Self {
        OpId(Uuid::new_v4())
    }
}

/// An operation with DAG metadata
#[derive(Clone, Debug)]
pub struct DagOp {
    /// Unique identifier for this operation
    pub id: OpId,
    /// IDs of operations that causally precede this one
    pub parents: Vec<OpId>,
    /// The actual operation payload
    pub op: Op,
}

/// The operation DAG - a causally-ordered set of operations
pub struct OpDag {
    /// All operations, keyed by their ID
    ops: HashMap<OpId, DagOp>,
    /// Current head(s) of the DAG - operations with no children
    heads: HashSet<OpId>,
}
```

### Causal Structure

The `parents` field captures the "happens-before" relationship. When a node creates a new operation, it sets `parents` to the current heads of its local DAG. This creates a causal chain:

```
     [op1]
       |
     [op2]
      / \
  [op3] [op4]   <- concurrent operations from different nodes
      \ /
     [op5]      <- merge point
```

Operations `op3` and `op4` are concurrent - neither is a parent of the other. When they're merged, `op5` has both as parents.

### Linearization

To derive the database state, we need a deterministic total order over operations. Given the DAG structure, we use a topological sort with a tiebreaker for concurrent operations:

```rust
impl OpDag {
    /// Return operations in a deterministic linear order.
    /// Returns plain `Op`s - the DAG metadata is internal to OpDag.
    pub fn linearize(&self) -> Vec<&Op> {
        // Topological sort respecting parent relationships
        // For concurrent ops (same topological level), sort by OpId
        // This ensures all nodes compute the same order
        todo!()
    }
}
```

The tiebreaker (sorting by `OpId`) is arbitrary but deterministic - all nodes will agree on the same order for concurrent operations. This is where geometric logic becomes important: because our axioms use only positive atoms without negation, the order of concurrent operations doesn't affect the final validity of the derived state.

### API Layering

The `OpDag` provides two levels of API:

1. **Internal operations** (for Database, axiom checking, etc.): Work with plain `Op`s via `linearize()` and `add(Op)`. The DAG metadata is managed automatically.

2. **Sync operations** (for collaboration layer): Work with `DagOp`s via `create_patch()`, `apply_patch()`, and `ops_since()`. These expose the full causal structure needed for sync.

```rust
impl OpDag {
    /// Add a new operation. Automatically assigns an OpId and sets
    /// parents to the current heads. Returns the assigned OpId.
    pub fn add(&mut self, op: Op) -> OpId {
        let dag_op = DagOp {
            id: OpId::new(),
            parents: self.heads.iter().cloned().collect(),
            op,
        };
        let id = dag_op.id.clone();
        self.insert(dag_op);
        id
    }

    /// Insert a DagOp directly (used when applying patches from peers).
    /// The DagOp must have valid parent references.
    pub fn insert(&mut self, dag_op: DagOp) {
        // Remove parents from heads (they now have a child)
        for parent in &dag_op.parents {
            self.heads.remove(parent);
        }
        // This op becomes a head (until something references it as parent)
        self.heads.insert(dag_op.id.clone());
        self.ops.insert(dag_op.id.clone(), dag_op);
    }

    /// Return operations in a deterministic linear order.
    /// Returns plain `Op`s - the DAG metadata is internal to OpDag.
    pub fn linearize(&self) -> Vec<&Op> {
        self.linearize_full().into_iter().map(|d| &d.op).collect()
    }

    /// Return DagOps in linearized order (for sync protocol).
    pub fn linearize_full(&self) -> Vec<&DagOp> {
        todo!()
    }
}
```

This separation keeps the Database implementation clean - it just calls `opdag.add(op)` and `opdag.linearize()` without worrying about causal metadata.

## Patch Extraction

With the DAG structure, we can efficiently extract "patches" - sets of operations that a consumer hasn't seen yet. The Database remains stateless; consumers track their own sync position by remembering which operation IDs they've seen.

### API Design

The patch/sync API works with `DagOp`s since the causal metadata is needed for merging:

```rust
impl OpDag {
    /// Get all operations that are descendants of `known_heads` but not
    /// in `known_heads` itself. Returns DagOps that the caller hasn't seen.
    ///
    /// If `known_heads` is empty, returns all operations.
    pub fn ops_since(&self, known_heads: &[OpId]) -> Vec<&DagOp> {
        todo!()
    }

    /// Get the current head operation IDs
    pub fn heads(&self) -> &HashSet<OpId> {
        &self.heads
    }
}
```

### Sync Protocol

A typical sync exchange between nodes A and B:

1. **A sends heads**: A sends its current `heads()` to B
2. **B computes diff**: B calls `ops_since(a_heads)` to find ops A is missing
3. **B sends patch**: B sends the missing ops (plus its own heads) to A
4. **A merges**: A integrates the new ops into its DAG
5. **Reverse**: The protocol runs in the other direction for B to get A's ops

```rust
/// A patch containing operations to sync
pub struct OpPatch {
    /// Operations in causal order (parents before children)
    pub ops: Vec<DagOp>,
    /// The heads after applying these operations
    pub heads: Vec<OpId>,
}

impl OpDag {
    /// Create a patch for syncing to a peer who knows `known_heads`
    pub fn create_patch(&self, known_heads: &[OpId]) -> OpPatch {
        OpPatch {
            ops: self.ops_since(known_heads).into_iter().cloned().collect(),
            heads: self.heads.iter().cloned().collect(),
        }
    }

    /// Apply a patch received from a peer
    pub fn apply_patch(&mut self, patch: OpPatch) {
        for op in patch.ops {
            self.insert(op);
        }
        // Heads are recomputed based on the new DAG structure
    }
}
```

## Database Integration

The `Database` needs to be updated to work with `OpDag` instead of `OpLog`. Importantly, most of the Database code continues to work with plain `Op`s - the DAG structure is encapsulated within `OpDag`.

### Replacing the OpLog

```rust
pub struct Database {
    theory: Theory,
    opdag: OpDag,  // was: oplog: OpLog
    compiled_axioms: Vec<CompiledAxiom>,
    state: DerivedState,
}
```

### Updating State

When the DAG changes (either from local operations or merged patches), we rederive state:

```rust
impl Database {
    /// Create a database from theory and operation DAG
    pub fn new(theory: Theory, opdag: OpDag) -> Database {
        let compiled_axioms = compile_axioms(&theory);
        let state = DerivedState::new();

        let mut db = Database {
            theory,
            opdag: OpDag::new(),
            compiled_axioms,
            state,
        };

        // Replay operations in linearized order
        // linearize() returns plain Ops - DAG structure is internal
        for op in opdag.linearize() {
            db.try_apply_op(op);
        }

        db
    }

    /// Apply a patch from a remote peer, rederiving state
    pub fn apply_patch(&mut self, patch: OpPatch) {
        self.opdag.apply_patch(patch);
        self.rederive_state();
    }

    /// Rederive state from scratch by replaying the linearized DAG
    fn rederive_state(&mut self) {
        self.state = DerivedState::new();
        for op in self.opdag.linearize() {
            self.try_apply_op(op);
        }
    }

    /// Create a patch for syncing to a peer
    pub fn create_patch(&self, known_heads: &[OpId]) -> OpPatch {
        self.opdag.create_patch(known_heads)
    }

    /// Get current DAG heads (for sync protocol)
    pub fn heads(&self) -> Vec<OpId> {
        self.opdag.heads().iter().cloned().collect()
    }
}
```

### Local Operations

When adding entities or relations locally, we use `OpDag::add()` which automatically manages the DAG metadata:

```rust
impl Database {
    pub fn add_entity(&mut self, sort: SortId) -> Result<EntityId, DbError> {
        // Validate sort exists
        if self.theory.signature.sort_name(sort).is_none() {
            return Err(DbError::new(format!("sort '{}' does not exist", sort)));
        }

        let entity_id = EntityId::new();
        let op = Op::AddEntity { sort, id: entity_id.clone() };

        // Update state incrementally
        self.state.add_entity(sort, &entity_id);

        // Add to DAG - OpDag handles OpId and parents automatically
        self.opdag.add(op);

        Ok(entity_id)
    }

    pub fn add_relation(&mut self, rel: RelId, args: Vec<Value>) -> Result<(), DbError> {
        // ... validation and axiom checking unchanged ...

        let op = Op::AddRelation { rel, args: args.clone() };

        // Update state
        self.state.add_relation(rel, args);

        // Add to DAG
        self.opdag.add(op);

        Ok(())
    }
}
```

The Database code remains clean and doesn't need to know about `OpId` or `parents` - it just works with `Op`s as before. The sync layer (which calls `create_patch` and `apply_patch`) is the only part that deals with `DagOp`s.

## Implementation Status

All phases have been implemented:

- **OpDag Data Structure**: `OpId`, `DagOp`, `OpDag` types defined in `src/opdag.rs`
- **Patch Operations**: `ops_since()`, `create_patch()`, `apply_patch()` implemented
- **Database Integration**: `Database` uses `OpDag` internally, exposes sync API
- **Tests**: Unit tests for OpDag, integration tests for collaboration scenarios

## Open Questions

### 1. Garbage Collection

As the DAG grows, old operations accumulate. Should we support "snapshotting" where we:
- Create a checkpoint representing current state
- Discard old operations
- New operations reference the checkpoint as a virtual parent

### 2. Conflict Resolution

Currently, operations that violate axioms are silently skipped during replay. With concurrent operations, we might want richer conflict handling:
- Track which operations were skipped and why
- Allow manual resolution
- Notify applications of conflicts

### 3. Incremental Rederivation

Currently we rederive from scratch on any DAG change. For large databases, this is expensive. Future work could:
- Track which ops are "new" vs "reordered"
- Only recheck axioms for affected operations
- Maintain incremental state similar to the current axiom trigger system

### 4. OpId Generation

Using random UUIDs for `OpId` is simple but has implications:
- No inherent ordering (we rely on DAG structure)
- Large (128 bits per operation)
- Alternative: hybrid logical clocks for smaller, sortable IDs

### 5. Network Layer

This RFC focuses on the data structures. The actual network sync protocol (WebSocket, libp2p, etc.) is left as a separate concern. The `create_patch`/`apply_patch` API should work with any transport.
