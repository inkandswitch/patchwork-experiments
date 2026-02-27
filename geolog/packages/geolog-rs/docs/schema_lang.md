# Schema Language

This document describes the syntax of the Geolog schema language.

## Overview

Geolog uses a type-theoretic schema language based on geometric logic. Schemas are defined as **theories** containing:
- **Sorts**: Entity types with identity
- **Functions**: Total mappings between sorts
- **Relations**: Propositions over sorts (can include primitive types)
- **Axioms**: Logical constraints expressed as sequents

## Comments

Line comments start with `//`:

```
// This is a comment
V : Sort;  // inline comment
```

## Names and Paths

### Identifiers

Identifiers start with a letter and can contain letters, digits, underscores, and hyphens:

```
foo
MySort
vertex_count
my-relation
```

### Qualified Names

Names can be qualified with a path using `/`:

```
ax/symmetry      // axiom named "symmetry" in namespace "ax"
N/P              // sort P from parameter N
Graph/V          // sort V from theory Graph
```

## Theories

Theories define schemas. A theory declares sorts, functions, relations, and axioms:

```
theory Graph {
    V : Sort;
    E : [src: V, tgt: V] -> Prop;
}
```

### Syntax

```
theory <name> {
    <declarations>
}
```

Or with parameters:

```
theory (<param> : <TheoryName> instance) <name> {
    <declarations>
}
```

### Extending Theories

Theories can extend other theories using `extends`:

```
theory WeightedGraph extends Graph {
    weight : [edge: E] -> Int;
}
```

## Sorts

Sorts declare entity types. Entities of a sort have unique identity.

```
V : Sort;
Edge : Sort;
```

## Primitive Types

Geolog has two built-in primitive types:

- `Int` - 64-bit signed integers
- `Str` - Unicode strings

Primitive types can be used in relation and function signatures but cannot be quantified over in axioms (they have infinite domains).

## Functions

Functions map from a domain to a codomain. The domain can be a single sort or a record type:

```
// Simple function: E -> V
src : E -> V;

// Function with record domain: [x: M, y: M] -> M
mul : [x: M, y: M] -> M;
```

Functions are total: every element of the domain must map to exactly one element of the codomain.

## Relations

Relations are propositions over sorts and primitive types. They use the `Prop` keyword:

```
// Binary relation on vertices
E : [src: V, tgt: V] -> Prop;

// Relation with integer component
weight : [src: V, tgt: V, value: Int] -> Prop;

// Ternary relation with string
labeled : [from: V, to: V, label: Str] -> Prop;
```

### Record Syntax

Record types use square brackets with named fields:

```
[field1: Type1, field2: Type2, ...]
```

In formulas, records are written similarly:

```
[src: x, tgt: y] E       // apply relation E to record with src=x, tgt=y
[src: a, tgt: b, value: 5] weight   // relation with integer value
```

## Axioms

Axioms express logical constraints as sequents of the form:

```
ax/<name> : forall <vars>. <antecedent> |- <consequent>;
```

### Quantified Variables

Variables are explicitly quantified over finite sorts:

```
forall x : V, y : V.     // two variables of sort V
forall v1 : V, v2 : V, e : E.  // mixed sorts
```

### Implicit Primitive Binding

Variables appearing in primitive-typed positions (Int, Str) are **implicitly bound** from the pattern. They don't need to be declared in the `forall`:

```
// n1 and n2 are implicitly bound as Int from the weight field
ax/unique : forall v1 : V, v2 : V.
    [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
    |- n1 = n2;
```

### Antecedent (Premise)

The antecedent is a conjunction of relational atoms:

```
[src: x, tgt: y] E                    // single atom
[src: x, tgt: y] E /\ [src: y, tgt: x] E   // conjunction
```

An empty antecedent means the consequent must always hold:

```
ax/refl : forall x : V. |- [src: x, tgt: x] E;   // reflexivity
```

### Consequent (Conclusion)

The consequent can be:

1. **A relational atom**: asserts the relation must hold
   ```
   |- [src: y, tgt: x] E
   ```

2. **An equality**: asserts two terms must be equal
   ```
   |- n1 = n2
   |- x = y
   ```

### Formula Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `/\` | Conjunction (and) | `A /\ B` |
| `\/` | Disjunction (or) | `A \/ B` |
| `|-` | Entailment | `premise |- conclusion` |
| `=` | Equality | `x = y` |
| `<` | Less than (Int) | `n < m` |
| `<=` | Less or equal (Int) | `n <= m` |
| `>` | Greater than (Int) | `n > m` |
| `>=` | Greater or equal (Int) | `n >= m` |

### Example Axioms

**Symmetry**: If there's an edge from x to y, there's an edge from y to x:
```
ax/sym : forall x : V, y : V.
    [src: x, tgt: y] E |- [src: y, tgt: x] E;
```

**Functional dependency**: Each vertex pair has at most one weight:
```
ax/unique_weight : forall v1 : V, v2 : V.
    [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
    |- n1 = n2;
```

**Transitivity**: Edges compose:
```
ax/trans : forall x : V, y : V, z : V.
    [src: x, tgt: y] E /\ [src: y, tgt: z] E |- [src: x, tgt: z] E;
```

## Instances

Instances provide concrete data satisfying a theory:

```
instance Triangle : Graph = {
    A, B, C : V;
    [src: A, tgt: B] E;
    [src: B, tgt: C] E;
    [src: C, tgt: A] E;
}
```

### Instance Syntax

```
instance <name> : <theory> = {
    <elements and relations>
}
```

### Element Declarations

Declare elements of a sort:

```
A, B, C : V;      // three elements of sort V
e1, e2 : E;       // two elements of sort E
```

### Relation Assertions

Assert that relations hold:

```
[src: A, tgt: B] E;                    // edge from A to B
[src: A, tgt: B, weight: 10] W;        // weighted edge
```

### Function Equations

Define function values:

```
e1 src = A;       // src(e1) = A
e1 tgt = B;       // tgt(e1) = B
```

## Complete Example

```
// A weighted graph theory with unique weights per edge
theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    
    // Each edge has at most one weight
    ax/unique_weight : forall v1 : V, v2 : V.
        [src: v1, tgt: v2, weight: n1] E /\ [src: v1, tgt: v2, weight: n2] E
        |- n1 = n2;
}

// A concrete weighted graph instance
instance MyGraph : WeightedGraph = {
    A, B, C : V;
    [src: A, tgt: B, weight: 5] E;
    [src: B, tgt: C, weight: 3] E;
    [src: A, tgt: C, weight: 10] E;
}
```
