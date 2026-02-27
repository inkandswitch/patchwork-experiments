# Database Evaluation

This document describes the design for maintaining and evaluating an operation log against a theory.

## Overview

A `Database` combines a `Theory` with an `OpLog` to provide:
- Storage of entities and relations
- Type checking of operations against the theory's signature
- Eager axiom enforcement
- Eventual consistency for distributed operation logs

## Data Structures

### OpLog

The operation log is an ordered sequence of operations:

```rust
pub struct OpLog {
    ops: Vec<Op>,
}

pub enum Op {
    AddEntity { sort: SortId, id: EntityId },
    AddRelation { rel: RelId, args: Vec<Value> },
}

pub enum Value {
    Entity(EntityId),
    Int(i64),
    Str(String),
}

pub struct EntityId(pub Uuid);
```

Each `AddEntity` operation records:
- The sort (entity type) being instantiated
- A globally unique UUID for the entity

Each `AddRelation` operation records:
- The relation being asserted
- Concrete argument values matching the relation's type signature

Entity IDs are UUIDs to ensure global uniqueness across distributed nodes generating operations concurrently.

### Database

The database owns both the theory and the operation log:

```rust
pub struct Database {
    theory: Theory,
    oplog: OpLog,
    state: DerivedState,  // cached state for efficient querying
}
```

The `DerivedState` maintains indexes for efficient axiom checking.

## API

```rust
impl Database {
    /// Create from theory and oplog, replaying ops (skipping violations)
    pub fn new(theory: Theory, oplog: OpLog) -> Database;

    /// Convenience: create with empty oplog
    pub fn from_theory(theory: Theory) -> Database;

    /// Add a new entity. Returns error if sort doesn't exist.
    /// On success, generates a new UUID, appends to oplog, and returns the ID.
    pub fn add_entity(&mut self, sort: SortId) -> Result<EntityId, DbError>;

    /// Add a relation tuple. Returns error if:
    /// - Relation doesn't exist in theory
    /// - Argument count doesn't match
    /// - Argument types don't match (e.g., entity of wrong sort, Int where entity expected)
    /// - Referenced entity doesn't exist
    /// - Operation would violate an axiom
    /// On success, appends to oplog.
    pub fn add_relation(&mut self, rel: RelId, args: Vec<Value>) -> Result<(), DbError>;

    /// Access the theory
    pub fn theory(&self) -> &Theory;

    /// Access the oplog for serialization/sync
    pub fn oplog(&self) -> &OpLog;

    /// Serialize database state to JSON
    pub fn to_json(&self) -> String;
}
```

## Type Checking

When adding a relation, the database validates argument types:

- **Entity arguments**: Must exist and have the correct sort
- **Int arguments**: Must be `Value::Int` where the relation expects `Int`
- **Str arguments**: Must be `Value::Str` where the relation expects `Str`

```rust
// Given: E : [src: V, tgt: V, weight: Int] -> Prop
let v = theory.signature.lookup_sort("V").unwrap();
let e = theory.signature.lookup_rel("E").unwrap();

let a = db.add_entity(v).unwrap();
let b = db.add_entity(v).unwrap();

// Valid: two entities and an Int
db.add_relation(e, vec![a.into(), b.into(), Value::Int(5)]).unwrap();

// Error: Int where entity expected
db.add_relation(e, vec![Value::Int(1), b.into(), Value::Int(5)]).unwrap_err();

// Error: entity where Int expected
db.add_relation(e, vec![a.into(), b.into(), a.into()]).unwrap_err();
```

## Axiom Enforcement

Axioms are enforced eagerly: every mutation is checked before being accepted.

### Local Mutations

When calling `add_entity` or `add_relation` directly:
- The operation is validated against the theory (type checking)
- All axioms are checked
- If any axiom would be violated, an error is returned
- The operation is **not** added to the oplog

This gives immediate feedback to the caller.

### OpLog Replay

When constructing a `Database` from a `Theory` and `OpLog`:
- Operations are replayed in order
- Each operation is validated against the theory and axioms
- Operations that would violate axioms are **silently skipped**
- The skipped operation is not included in the resulting database's oplog

This ensures eventual consistency: multiple replicas replaying the same oplog arrive at identical state, even if the oplog contains conflicting concurrent operations.

### Example: Axiom Violation

Given the weighted graph theory:

```
theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    
    // Each edge has at most one weight (n1, n2 implicitly bound as Int)
    ax/unique_weight : forall v1 : V, v2 : V.
        [src: v1, tgt: v2, weight: n1] E /\ [src: v1, tgt: v2, weight: n2] E
        |- n1 = n2;
}
```

The `unique_weight` axiom enforces that each vertex pair has at most one weight.

**Local mutation:**
```rust
let theory = make_theory(/* source above */);
let v = theory.signature.lookup_sort("V").unwrap();
let e = theory.signature.lookup_rel("E").unwrap();

let mut db = Database::from_theory(theory);
let v0 = db.add_entity(v).unwrap();
let v1 = db.add_entity(v).unwrap();

// OK: first edge with weight 5
db.add_relation(e, vec![v0.into(), v1.into(), Value::Int(5)]).unwrap();

// Error: same edge with different weight violates unique_weight
db.add_relation(e, vec![v0.into(), v1.into(), Value::Int(10)]).unwrap_err();
```

**OpLog replay:**
```rust
let id0 = EntityId::new();
let id1 = EntityId::new();

let oplog = OpLog::from_ops(vec![
    Op::AddEntity { sort: v, id: id0 },
    Op::AddEntity { sort: v, id: id1 },
    Op::AddRelation { 
        rel: e, 
        args: vec![Value::Entity(id0), Value::Entity(id1), Value::Int(5)] 
    },
    Op::AddRelation { 
        rel: e, 
        args: vec![Value::Entity(id0), Value::Entity(id1), Value::Int(10)] 
    }, // skipped
]);

let db = Database::new(theory, oplog);
// db.oplog() contains only the first 3 operations
// The fourth was silently skipped due to unique_weight violation
```

## Implicit Int/Str Binding in Axioms

A key feature of Geolog is **implicit binding** of Int and Str variables in axioms. Variables appearing in primitive-typed positions are automatically bound from the relation pattern, without needing explicit quantification.

This is implemented through **bidirectional type checking**: when elaborating a formula like `[src: v1, tgt: v2, weight: n1] E`, the type checker:
1. Looks up the relation `E` to get its domain type
2. Checks each field against the expected type
3. For `weight: n1` with expected type `Int`, if `n1` is not in scope, it's implicitly bound as `Int`

This allows natural expression of constraints over primitive values:

```
// n1 and n2 don't need to be in the forall - they're implicitly Int
ax/unique_weight : forall v1 : V, v2 : V.
    [src: v1, tgt: v2, weight: n1] E /\ [src: v1, tgt: v2, weight: n2] E
    |- n1 = n2;
```

## Axiom Checking Algorithm

For an axiom of the form:

```
forall (x₁:T₁)...(xₙ:Tₙ). antecedent |- consequent
```

After adding a relation tuple, we check:

1. Find all substitutions where the antecedent holds (using the new tuple)
2. For each substitution, verify the consequent also holds
3. If any substitution satisfies the antecedent but not the consequent, the axiom is violated

The implementation uses **incremental evaluation**: only substitutions involving the newly added tuple are checked, since previous substitutions were validated when their constituent tuples were added.

For `unique_weight`, after adding `E(a, b, 5)`:
- Query for existing tuples matching `E(a, b, n)` where `n ≠ 5`
- If any exist, the axiom is violated

## JSON Serialization

The `to_json` method produces output suitable for integration tests:

```json
{
  "entities": {
    "V": ["550e8400-e29b-41d4-a716-446655440000", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"]
  },
  "relations": {
    "E": [
      [
        {"entity": "550e8400-e29b-41d4-a716-446655440000"}, 
        {"entity": "6ba7b810-9dad-11d1-80b4-00c04fd430c8"},
        {"int": 5}
      ]
    ]
  }
}
```

This allows integration tests to verify database state without depending on internal representations.
