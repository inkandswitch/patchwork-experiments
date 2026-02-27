# Simple Weighted Graph

This document shows how to model a weighted graph in Geolog, demonstrating the key features of the schema language.

## The Schema

```
theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V] -> Prop;
    W : [src: V, tgt: V, weight: Int] -> Prop;
    dead : [src: V, tgt: V] -> Prop;
    
    // Each vertex pair has at most one weight
    // Note: n1 and n2 are implicitly bound as Int from the pattern
    ax/unique_weight : forall v1 : V, v2 : V.
        [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
        |- n1 = n2;
}
```

## Schema Explanation

- `V : Sort` — vertices are a sort (entities with identity)
- `E : [src: V, tgt: V] -> Prop` — edges are a binary relation (not entities themselves)
- `W : [src: V, tgt: V, weight: Int] -> Prop` — weight relation: `W(v1, v2, n)` means "the weight from v1 to v2 is n"
- `dead : [src: V, tgt: V] -> Prop` — marks vertex pairs as "dead" (soft deletion)
- `ax/unique_weight` — axiom enforcing functional dependency: each vertex pair has at most one weight

## Key Design Decisions

### 1. Edges as Relations, Not Sorts

Edges are modeled as `E : [src: V, tgt: V] -> Prop` rather than `E : Sort`. This means:
- Edges don't have identity; you either have an edge between two vertices or you don't
- No need to track edge entities separately
- Simpler axioms since we don't need to quantify over edges

### 2. Weight as a Separate Relation

Weight is modeled as `W : [src: V, tgt: V, weight: Int] -> Prop` rather than a function on edges. This allows:
- Edges without weights (just assert `E`, not `W`)
- The uniqueness constraint to be expressed cleanly

### 3. Implicit Int Binding

The axiom `ax/unique_weight` demonstrates **implicit Int binding**:

```
ax/unique_weight : forall v1 : V, v2 : V.
    [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
    |- n1 = n2;
```

Variables `n1` and `n2` are **not** declared in the `forall` quantifier. They are implicitly bound with type `Int` because they appear in the `weight` field, which has type `Int` in the relation's domain.

This is a consequence of geometric logic: we can only explicitly quantify over finite domains (sorts), not over infinite domains like `Int`. The implicit binding allows us to express constraints over primitive values naturally.

### 4. Soft Deletion with `dead`

The `dead` relation marks vertex pairs as deleted without removing data:
- `[src: a, tgt: b] dead` means the edge from a to b is soft-deleted
- The actual `E` or `W` tuples remain in the database
- Application logic can filter out dead edges

## Extracted Signature

The type checker extracts:

- **Sorts**: `[V]`
- **Relations**: 
  - `E: [src: V, tgt: V]`
  - `W: [src: V, tgt: V, weight: Int]`
  - `dead: [src: V, tgt: V]`
- **Axioms**: 
  - `unique_weight: ∀(v1:V)(v2:V). W(v1,v2,n1) ∧ W(v1,v2,n2) → n1=n2`
    - With implicit bindings: `n1: Int`, `n2: Int`

## Usage Example

```rust
let theory = make_theory(r#"
    theory WeightedGraph {
        V : Sort;
        W : [src: V, tgt: V, weight: Int] -> Prop;
        ax/unique_weight : forall v1 : V, v2 : V.
            [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
            |- n1 = n2;
    }
"#);

let v = theory.signature.lookup_sort("V").unwrap();
let w = theory.signature.lookup_rel("W").unwrap();

let mut db = Database::from_theory(theory);

let a = db.add_entity(v).unwrap();
let b = db.add_entity(v).unwrap();

// Add weight 5 from a to b
db.add_relation(w, vec![a.into(), b.into(), Value::Int(5)]).unwrap();

// This fails: can't have two different weights for the same edge
let err = db.add_relation(w, vec![a.into(), b.into(), Value::Int(10)]);
assert!(err.is_err());

// This succeeds: different edge (b to a)
db.add_relation(w, vec![b.into(), a.into(), Value::Int(10)]).unwrap();
```
