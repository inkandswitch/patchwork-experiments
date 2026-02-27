# RFC 0001: Incremental Axiom Evaluation

> **Status**: Implemented. The core incremental checking algorithm described here
> is now part of the database evaluation system.

## Summary

Replace the current brute-force axiom checking algorithm with an incremental approach that only evaluates substitutions involving newly added tuples. This reduces complexity from O(|D|^n) to O(|D|^(n-1)) per operation, where |D| is the database size and n is the number of quantified variables.

## Motivation

The current implementation in `Database::add_relation` checks axioms by:
1. Enumerating all possible substitutions for universally quantified variables
2. For each substitution, evaluating the antecedent
3. If the antecedent holds, checking the consequent

This is correct but inefficient. For an axiom with 4 quantified variables over a database with 100 entities, we check 100^4 = 100 million substitutions on every insert.

However, the logic fragment we support has a key property: **the newly added tuple must participate in any newly-satisfiable antecedent**. Substitutions that don't involve the new tuple were already validated when their constituent tuples were added.

## Background: The Logic Fragment

Our axioms have restricted form:
```
∀(x₁:T₁)...(xₙ:Tₙ). A₁ ∧ A₂ ∧ ... ∧ Aₖ → C
```

Where each Aᵢ is a positive relational atom like `R(x, y, z)` and C is either:
- A relational atom: `S(x, y)`
- An equality: `x = y`

Critical restrictions:
- **No negation**: Can't express `¬R(x, y)`
- **No disjunction**: Antecedent is purely conjunctive
- **Positive atoms only**: All atoms assert existence, not absence

These restrictions mean adding tuples can only *satisfy* more antecedents, never *falsify* previously-satisfied ones.

## Detailed Design

### Core Insight

When adding a tuple `t` to relation `R`, we only need to check substitutions where `t` appears as one of the antecedent atoms. For each axiom:

1. Find antecedent atoms that mention relation `R`
2. For each such atom, unify it with `t` to get a partial substitution
3. Complete the substitution by joining with other antecedent atoms
4. Check the consequent for each complete substitution

#### What is "Joining"?

The term "join" comes from relational databases. When we have a partial substitution (some variables bound to values) and need to find values for the remaining variables, we search for tuples that are *compatible* with what we already know.

Consider the antecedent `w(v1, v2, n1) ∧ w(v1, v2, n2)`. If we've already bound `{v1 → a, v2 → b, n1 → 10}` from the first atom, we need to find all tuples in `w` that:
- Have `a` in the first position (matching our bound `v1`)
- Have `b` in the second position (matching our bound `v2`)
- Have anything in the third position (this becomes the binding for `n2`)

This "find tuples matching these constraints" operation is a join. We're joining our partial knowledge with the contents of a relation to extend our substitution.

The key efficiency gain: instead of trying all possible values for `n2`, we only consider values that actually appear in matching tuples. If there's only one edge from `a` to `b`, we check one substitution instead of potentially thousands.

### Example: unique_weight

```
// In current Geolog syntax:
ax/unique_weight : forall v1 : V, v2 : V.
    [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W
    |- n1 = n2;

// Note: n1 and n2 are implicitly bound as Int from the pattern
```

When adding `W(a, b, 10)` (meaning `[src: a, tgt: b, weight: 10] W`):

**Case 1**: New tuple matches first atom `[src: v1, tgt: v2, weight: n1] W`
- Partial substitution: `{v1 → a, v2 → b, n1 → 10}`
- Join with second atom using v1=a, v2=b: find all `W(a, b, ?)`
- For each match `W(a, b, m)`, complete substitution: `{..., n2 → m}`
- Check consequent: `10 = m`

**Case 2**: New tuple matches second atom `[src: v1, tgt: v2, weight: n2] W`
- Symmetric to Case 1

This reduces from O(|V|² × |Int|²) to O(|edges from (a,b)|).

### Data Structures

#### Relation Indexes

Add indexes to `DerivedState` for efficient joining:

```rust
struct RelationIndex {
    /// All tuples in the relation
    tuples: Vec<Vec<Value>>,

    /// Index by prefix: maps first k arguments to matching tuple indices
    /// prefix_index[k] maps (arg0, ..., argk-1) -> [tuple_indices]
    prefix_indexes: Vec<HashMap<Vec<Value>, Vec<usize>>>,
}
```

For `w(V, V, Int)`, we'd have:
- `prefix_indexes[1]`: `{[a] -> [0, 2, 5], [b] -> [1, 3], ...}`
- `prefix_indexes[2]`: `{[a, b] -> [0, 2], [a, c] -> [5], ...}`

#### Compiled Axioms

Pre-process axioms into a form optimized for incremental checking. The key idea is to create a **trigger** for each antecedent atom. When a tuple is added to relation R, we fire all triggers watching R, and each trigger knows exactly how to find the remaining substitutions.

```rust
struct CompiledAxiom {
    name: String,
    /// For each antecedent atom, how to check when a tuple is added to that relation
    triggers: Vec<AxiomTrigger>,
}

struct AxiomTrigger {
    /// Which relation this trigger watches
    relation: RelId,

    /// Which antecedent atom index this corresponds to
    atom_index: usize,

    /// Mapping from tuple positions to variable bindings
    /// e.g., for w(v1, v2, n1), this is [(0, v1), (1, v2), (2, n1)]
    bindings: Vec<(usize, VarId)>,

    /// Other atoms to join with, in order
    join_plan: Vec<JoinStep>,

    /// The consequent to check
    consequent: Formula,
}
```

#### The Join Plan

A `JoinStep` represents one join operation: "look up tuples in this relation that match our current bindings, and extend our substitution with any new variable bindings."

```rust
struct JoinStep {
    /// Relation to join with
    relation: RelId,

    /// For each position in the relation, either:
    /// - Bind: extract value into a new variable
    /// - Match: require equality with already-bound variable
    positions: Vec<JoinPosition>,
}

enum JoinPosition {
    Bind(VarId),
    Match(VarId),
}
```

**Example**: For `w_unique` with antecedent `w(v1, v2, n1) ∧ w(v1, v2, n2)`:

When the trigger fires on the first atom `w(v1, v2, n1)`, the join plan has one step for the second atom `w(v1, v2, n2)`:

```rust
JoinStep {
    relation: "w",
    positions: vec![
        Match(v1),  // position 0: must equal our bound v1
        Match(v2),  // position 1: must equal our bound v2
        Bind(n2),   // position 2: bind to n2
    ],
}
```

This says: "Find all `w` tuples where positions 0 and 1 match our already-bound `v1` and `v2`, and bind position 2 to `n2`."

**Multi-step example**: For a transitivity axiom `E(x,y) ∧ E(y,z) → E(x,z)`:

When triggered by adding `E(a, b)` matching the first atom:
- Initial bindings: `{x → a, y → b}`
- Join plan step 1: Look up `E(?, ?)` where position 0 matches `y` (which is `b`), bind position 1 to `z`
  ```rust
  JoinStep {
      relation: "E",
      positions: vec![Match(y), Bind(z)],
  }
  ```

This finds all edges starting from `b`, giving us complete substitutions like `{x → a, y → b, z → c}` for each edge `E(b, c)`.

### Algorithm

```rust
fn check_axioms_incremental(
    &self,
    rel: &RelId,
    new_tuple: &[Value],
    state: &DerivedState,
) -> Result<(), DbError> {
    for axiom in &self.compiled_axioms {
        for trigger in &axiom.triggers {
            if &trigger.relation != rel {
                continue;
            }

            // Create initial substitution from new tuple
            let mut initial_subst = Substitution::new();
            for (pos, var) in &trigger.bindings {
                initial_subst.bind(var.clone(), new_tuple[*pos].clone());
            }

            // Execute join plan to find all completing substitutions
            let substitutions = execute_join_plan(
                &initial_subst,
                &trigger.join_plan,
                state,
            );

            // Check consequent for each substitution
            for subst in substitutions {
                if !state.eval_formula(&trigger.consequent, &subst) {
                    return Err(DbError::new(format!(
                        "adding relation violates axiom '{}'",
                        axiom.name
                    )));
                }
            }
        }
    }
    Ok(())
}

fn execute_join_plan(
    initial: &Substitution,
    plan: &[JoinStep],
    state: &DerivedState,
) -> Vec<Substitution> {
    let mut current = vec![initial.clone()];

    for step in plan {
        let mut next = Vec::new();

        for subst in &current {
            // Build prefix from bound variables for index lookup
            let prefix = build_prefix(&step.positions, &subst);

            // Look up matching tuples
            let matches = state.lookup_by_prefix(&step.relation, &prefix);

            for tuple in matches {
                if let Some(extended) = try_extend_subst(&subst, &step.positions, tuple) {
                    next.push(extended);
                }
            }
        }

        current = next;
    }

    current
}
```

### Computing the Join Plan

When we compile an axiom, we create one trigger per antecedent atom. For each trigger, we need to compute a join plan that covers all the *other* antecedent atoms.

**Algorithm for computing a join plan:**

```
function compute_join_plan(trigger_atom, other_atoms):
    bound_vars = variables_in(trigger_atom)  # Initially bound by the new tuple
    plan = []

    remaining = other_atoms
    while remaining is not empty:
        # Pick the next atom to join (see ordering heuristics below)
        next_atom = pick_next(remaining, bound_vars)
        remaining = remaining - {next_atom}

        # Build the JoinStep for this atom
        step = JoinStep { relation: next_atom.relation, positions: [] }
        for (i, term) in enumerate(next_atom.arguments):
            if term is a variable v:
                if v in bound_vars:
                    step.positions.push(Match(v))
                else:
                    step.positions.push(Bind(v))
                    bound_vars = bound_vars ∪ {v}
            else:
                # Literal value - must match exactly
                step.positions.push(MatchLiteral(term))

        plan.push(step)

    return plan
```

**Example**: Compile `unique_weight` trigger for first atom

```
Axiom: [src: v1, tgt: v2, weight: n1] W /\ [src: v1, tgt: v2, weight: n2] W |- n1 = n2

Trigger atom: W(v1, v2, n1)
Other atoms: [W(v1, v2, n2)]

Step 1: bound_vars = {v1, v2, n1}
Step 2: Process W(v1, v2, n2)
        - v1: already bound → Match(v1)
        - v2: already bound → Match(v2)
        - n2: not bound → Bind(n2)
        - bound_vars = {v1, v2, n1, n2}

Result: [JoinStep { relation: W, positions: [Match(v1), Match(v2), Bind(n2)] }]
```

### Join Ordering

The order in which we process the "other atoms" matters for performance. Consider a 3-atom antecedent `A(x) ∧ B(x, y) ∧ C(y, z)` triggered by `A(a)`:

- **Order 1**: B then C
  - After A: bound = {x}
  - Join B(x, y): uses bound x, binds y → efficient lookup by first column
  - Join C(y, z): uses bound y, binds z → efficient lookup by first column

- **Order 2**: C then B
  - After A: bound = {x}
  - Join C(y, z): neither y nor z bound → must scan ALL of C!
  - Join B(x, y): uses bound x and y → efficient

Order 1 is clearly better because each join can use bound variables for indexing.

**Heuristics for `pick_next`:**

1. **Most-bound-first**: Prefer atoms where more argument positions are already bound. This maximizes index utilization.

2. **Smallest-relation-first**: Among atoms with equal bound positions, prefer smaller relations to reduce intermediate result size.

3. **Required-binding-first**: If a later atom requires a variable, prioritize atoms that bind it.

For the initial implementation, most-bound-first with left-to-right as a tiebreaker is sufficient.

### Handling Equality Consequents

Equality consequents like `n1 = n2` are checked by evaluating both sides under the substitution and comparing. This is O(1) per substitution.

### Handling Relational Consequents

For consequents like `E(y, x)` (as in symmetry axioms), we check if the tuple exists in the relation. With proper indexing, this is O(1).

## Implementation Plan

### Phase 1: Relation Indexing
- Add `RelationIndex` structure to `DerivedState`
- Build indexes during `add_entity` and `add_relation`
- Add `lookup_by_prefix` method

### Phase 2: Axiom Compilation
- Add `CompiledAxiom` and related structures
- Compile axioms when creating `Database`
- Generate triggers for each antecedent atom

### Phase 3: Incremental Checking
- Replace `enumerate_substitutions` + `check_axiom` with `check_axioms_incremental`
- Implement `execute_join_plan`

### Phase 4: Join Optimization (Optional)
- Implement join reordering heuristics
- Add statistics collection for cost-based optimization

## Complexity Analysis

Let:
- n = number of quantified variables in axiom
- k = number of antecedent atoms
- |R| = size of relation R
- |D| = total database size

**Current approach**: O(|D|^n) per insert

**Incremental approach**: O(|matches|^(k-1)) per insert, where |matches| is typically much smaller than |D| due to the constraint that the new tuple must participate.

For `unique_weight` with |V| vertices and |W| weight tuples:
- Current: O(|V|² × |Int|²) — potentially huge
- Incremental: O(|weight tuples with same endpoints|) — typically O(1) or O(small constant)

## Alternatives Considered

### 1. Rete Algorithm
The Rete algorithm maintains a network of partial matches. It's more complex but offers better performance for scenarios with many rules sharing common subpatterns. Could be considered for future optimization.

### 2. Bottom-Up Datalog Evaluation
Compute all consequences eagerly rather than checking on insert. Better for read-heavy workloads but requires maintaining derived relations.

### 3. SAT/SMT Encoding
Encode axiom checking as a satisfiability problem. Powerful but heavyweight; better suited for complex constraints than our simple fragment.

## Testing Strategy

1. **Correctness**: All existing tests must pass unchanged
2. **Performance**: Add benchmarks comparing old vs new implementation
3. **Edge cases**:
   - Axioms with single antecedent atom
   - Axioms where all atoms mention the same relation
   - Empty database
   - Self-joins (same relation appears multiple times in antecedent)

## Open Questions

1. **Index maintenance cost**: Building indexes has overhead. Should we build lazily?
2. **Memory usage**: Indexes increase memory footprint. Acceptable tradeoff?
3. **Axiom compilation caching**: Should compiled axioms be cached across Database instances with the same schema?
