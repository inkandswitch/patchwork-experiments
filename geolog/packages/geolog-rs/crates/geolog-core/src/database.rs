use std::collections::{HashMap, HashSet};

use serde_json::{json, Value as JsonValue};

use crate::core::{DerivedSort, Formula, RelId, Sequent, Signature, SortId, Term, Theory};
use crate::opdag::{EntityId, Op, OpDag, OpId, OpPatch, Value};

/// The database combines a theory with an operation DAG
pub struct Database {
    theory: Theory,
    opdag: OpDag,
    /// Compiled axioms for incremental checking
    compiled_axioms: Vec<CompiledAxiom>,
    /// Cached derived state (updated incrementally)
    state: DerivedState,
}

impl Database {
    /// Create from theory and opdag, deriving state (skipping violations)
    /// The OpDag is kept as-is. Invalid operations are skipped during state derivation.
    pub fn from_opdag(theory: Theory, opdag: OpDag) -> Database {
        let compiled_axioms: Vec<CompiledAxiom> = theory
            .axioms
            .iter()
            .map(|ax| CompiledAxiom::compile(ax, &theory.signature))
            .collect();
        let state = DerivedState::new();

        let mut db = Database {
            theory,
            opdag,
            compiled_axioms,
            state,
        };

        // Derive state from linearized ops, skipping violations
        db.rederive_state();

        db
    }

    /// Convenience: create with empty opdag
    pub fn from_theory(theory: Theory) -> Database {
        let compiled_axioms = theory
            .axioms
            .iter()
            .map(|ax| CompiledAxiom::compile(ax, &theory.signature))
            .collect();
        let state = DerivedState::new();
        Database {
            theory,
            opdag: OpDag::new(),
            compiled_axioms,
            state,
        }
    }

    /// Try to apply an operation to state only (used during replay/rederive).
    /// Does NOT add to opdag - just updates DerivedState.
    /// Returns true if the op was valid and applied.
    fn try_apply_op_to_state(&mut self, op: &Op) -> bool {
        match op {
            Op::AddEntity { sort, id } => {
                // Validate: sort must exist in signature
                if self.theory.signature.sort_name(*sort).is_none() {
                    return false;
                }
                // Update cached state only
                self.state.add_entity(*sort, id);
                true
            }
            Op::AddRelation { rel, args } => {
                // Validate and check axioms, but don't add to opdag
                if self.validate_and_check_relation(*rel, args).is_err() {
                    return false;
                }
                // Update cached state only
                self.state.add_relation(*rel, args.clone());
                true
            }
        }
    }

    /// Validate a relation and check axioms, but don't modify state or opdag.
    fn validate_and_check_relation(&self, rel: RelId, args: &[Value]) -> Result<(), DbError> {
        // Find the relation in signature
        let relation = self.theory.signature.relation(rel).ok_or_else(|| {
            DbError::new(format!("relation '{}' does not exist in signature", rel))
        })?;

        // Get the expected argument types from domain
        let expected_types = flatten_derived_sort(&relation.domain);

        // Check argument count
        if args.len() != expected_types.len() {
            return Err(DbError::new(format!(
                "relation '{}' expects {} arguments, got {}",
                relation.name,
                expected_types.len(),
                args.len()
            )));
        }

        // Check each argument against cached state
        for (i, (arg, expected_type)) in args.iter().zip(expected_types.iter()).enumerate() {
            match (arg, expected_type) {
                (Value::Entity(id), ExpectedType::Sort(expected_sort)) => {
                    if !self.state.entity_exists(id) {
                        return Err(DbError::new(format!(
                            "entity '{}' does not exist (argument {})",
                            id.0, i
                        )));
                    }
                    let actual_sort = self.state.get_entity_sort(id).unwrap();
                    if actual_sort != expected_sort {
                        let actual_name =
                            self.theory.signature.sort_name(*actual_sort).unwrap_or("?");
                        let expected_name = self
                            .theory
                            .signature
                            .sort_name(*expected_sort)
                            .unwrap_or("?");
                        return Err(DbError::new(format!(
                            "argument {} has sort '{}', expected '{}'",
                            i, actual_name, expected_name
                        )));
                    }
                }
                (Value::Int(_), ExpectedType::Int) => {}
                (Value::Str(_), ExpectedType::Str) => {}
                (Value::Entity(_), ExpectedType::Int) => {
                    return Err(DbError::new(format!(
                        "argument {} is an entity, expected Int",
                        i
                    )));
                }
                (Value::Entity(_), ExpectedType::Str) => {
                    return Err(DbError::new(format!(
                        "argument {} is an entity, expected Str",
                        i
                    )));
                }
                (Value::Int(_), ExpectedType::Sort(sort_id)) => {
                    let expected_name = self.theory.signature.sort_name(*sort_id).unwrap_or("?");
                    return Err(DbError::new(format!(
                        "argument {} is an Int, expected sort '{}'",
                        i, expected_name
                    )));
                }
                (Value::Int(_), ExpectedType::Str) => {
                    return Err(DbError::new(format!(
                        "argument {} is an Int, expected Str",
                        i
                    )));
                }
                (Value::Str(_), ExpectedType::Sort(sort_id)) => {
                    let expected_name = self.theory.signature.sort_name(*sort_id).unwrap_or("?");
                    return Err(DbError::new(format!(
                        "argument {} is a Str, expected sort '{}'",
                        i, expected_name
                    )));
                }
                (Value::Str(_), ExpectedType::Int) => {
                    return Err(DbError::new(format!(
                        "argument {} is a Str, expected Int",
                        i
                    )));
                }
            }
        }

        // Check axioms
        self.check_axioms_with_new_relation(rel, args)
    }

    /// Check all axioms against the current state with a new relation being added
    /// Uses incremental checking: only considers substitutions involving the new tuple
    fn check_axioms_with_new_relation(&self, rel: RelId, args: &[Value]) -> Result<(), DbError> {
        // Use cached state directly - no need to include new tuple since:
        // 1. Trigger bindings come from args directly
        // 2. Self-joins (new tuple matching itself) always satisfy equality consequents
        self.check_axioms_incremental(rel, args, &self.state)
    }

    /// Incremental axiom checking: only check substitutions involving the new tuple
    fn check_axioms_incremental(
        &self,
        rel: RelId,
        new_tuple: &[Value],
        state: &DerivedState,
    ) -> Result<(), DbError> {
        for axiom in &self.compiled_axioms {
            for trigger in &axiom.triggers {
                // Only fire triggers watching this relation
                if trigger.relation != rel {
                    continue;
                }

                // Create initial substitution from new tuple
                let mut initial_subst = Substitution::new();
                for (pos, var) in &trigger.bindings {
                    initial_subst.bind(var.clone(), new_tuple[*pos].clone());
                }

                // Execute join plan to find all completing substitutions
                let substitutions =
                    self.execute_join_plan(&initial_subst, &trigger.join_plan, state);

                // Check consequent for each substitution
                for subst in substitutions {
                    if !state.eval_formula(&trigger.consequent, &subst, &self.theory.signature) {
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

    /// Execute a join plan to find all completing substitutions
    fn execute_join_plan(
        &self,
        initial: &Substitution,
        plan: &[JoinStep],
        state: &DerivedState,
    ) -> Vec<Substitution> {
        let mut current = vec![initial.clone()];

        for step in plan {
            let mut next = Vec::new();

            for subst in &current {
                // Determine which positions are constrained
                let constrained: Vec<(usize, Value)> = step
                    .positions
                    .iter()
                    .enumerate()
                    .filter_map(|(i, pos)| match pos {
                        JoinPosition::Match(var) => subst.get(var).map(|v| (i, v.clone())),
                        JoinPosition::MatchLiteral(v) => Some((i, v.clone())),
                        JoinPosition::Bind(_) => None,
                    })
                    .collect();

                // Look up matching tuples
                let matches = state.lookup_matching_tuples(step.relation, &constrained);

                for tuple in matches {
                    if let Some(extended) = try_extend_subst(subst, &step.positions, tuple) {
                        next.push(extended);
                    }
                }
            }

            current = next;

            // Early exit if no substitutions remain
            if current.is_empty() {
                break;
            }
        }

        current
    }

    /// Add a new entity. Returns error if sort doesn't exist.
    /// On success, generates a new UUID, appends to oplog, and returns the ID.
    pub fn add_entity(&mut self, sort: SortId) -> Result<EntityId, DbError> {
        // Validate: sort must exist in signature
        if self.theory.signature.sort_name(sort).is_none() {
            return Err(DbError::new(format!("sort '{}' does not exist", sort)));
        }

        let id = EntityId::new();

        // Update cached state
        self.state.add_entity(sort, &id);

        // Add to DAG - OpDag handles OpId and parents automatically
        self.opdag.add(Op::AddEntity {
            sort,
            id: id.clone(),
        });
        Ok(id)
    }

    /// Add a relation tuple. Returns error if:
    /// - Relation doesn't exist in signature
    /// - Argument count doesn't match
    /// - Argument types don't match (e.g., entity of wrong sort)
    /// - Referenced entity doesn't exist
    /// - Operation would violate an axiom
    /// On success, appends to oplog.
    pub fn add_relation(&mut self, rel: RelId, args: Vec<Value>) -> Result<(), DbError> {
        // Find the relation in signature
        let relation = self.theory.signature.relation(rel).ok_or_else(|| {
            DbError::new(format!("relation '{}' does not exist in signature", rel))
        })?;

        // Get the expected argument types from domain
        let expected_types = flatten_derived_sort(&relation.domain);

        // Check argument count
        if args.len() != expected_types.len() {
            return Err(DbError::new(format!(
                "relation '{}' expects {} arguments, got {}",
                relation.name,
                expected_types.len(),
                args.len()
            )));
        }

        // Check each argument against cached state
        for (i, (arg, expected_type)) in args.iter().zip(expected_types.iter()).enumerate() {
            match (arg, expected_type) {
                (Value::Entity(id), ExpectedType::Sort(expected_sort)) => {
                    // Check entity exists
                    if !self.state.entity_exists(id) {
                        return Err(DbError::new(format!(
                            "entity '{}' does not exist (argument {})",
                            id.0, i
                        )));
                    }
                    // Check entity has correct sort
                    let actual_sort = self.state.get_entity_sort(id).unwrap();
                    if actual_sort != expected_sort {
                        let actual_name =
                            self.theory.signature.sort_name(*actual_sort).unwrap_or("?");
                        let expected_name = self
                            .theory
                            .signature
                            .sort_name(*expected_sort)
                            .unwrap_or("?");
                        return Err(DbError::new(format!(
                            "argument {} has sort '{}', expected '{}'",
                            i, actual_name, expected_name
                        )));
                    }
                }
                (Value::Int(_), ExpectedType::Int) => {
                    // Int value for Int type - valid
                }
                (Value::Str(_), ExpectedType::Str) => {
                    // Str value for Str type - valid
                }
                (Value::Entity(_), ExpectedType::Int) => {
                    return Err(DbError::new(format!(
                        "argument {} is an entity, expected Int",
                        i
                    )));
                }
                (Value::Entity(_), ExpectedType::Str) => {
                    return Err(DbError::new(format!(
                        "argument {} is an entity, expected Str",
                        i
                    )));
                }
                (Value::Int(_), ExpectedType::Sort(sort_id)) => {
                    let expected_name = self.theory.signature.sort_name(*sort_id).unwrap_or("?");
                    return Err(DbError::new(format!(
                        "argument {} is an Int, expected sort '{}'",
                        i, expected_name
                    )));
                }
                (Value::Int(_), ExpectedType::Str) => {
                    return Err(DbError::new(format!(
                        "argument {} is an Int, expected Str",
                        i
                    )));
                }
                (Value::Str(_), ExpectedType::Sort(sort_id)) => {
                    let expected_name = self.theory.signature.sort_name(*sort_id).unwrap_or("?");
                    return Err(DbError::new(format!(
                        "argument {} is a Str, expected sort '{}'",
                        i, expected_name
                    )));
                }
                (Value::Str(_), ExpectedType::Int) => {
                    return Err(DbError::new(format!(
                        "argument {} is a Str, expected Int",
                        i
                    )));
                }
            }
        }

        // Check axioms
        self.check_axioms_with_new_relation(rel, &args)?;

        // All checks passed, update cached state and add to DAG
        self.state.add_relation(rel, args.clone());
        self.opdag.add(Op::AddRelation { rel, args });
        Ok(())
    }

    /// Access the theory
    pub fn theory(&self) -> &Theory {
        &self.theory
    }

    /// Access the opdag for serialization/sync
    pub fn opdag(&self) -> &OpDag {
        &self.opdag
    }

    /// Get current DAG heads (for sync protocol)
    pub fn heads(&self) -> Vec<OpId> {
        self.opdag.heads().iter().cloned().collect()
    }

    /// Create a patch for syncing to a peer who knows `known_heads`
    pub fn create_patch(&self, known_heads: &[OpId]) -> OpPatch {
        self.opdag.create_patch(known_heads)
    }

    /// Apply a patch from a remote peer, rederiving state
    pub fn apply_patch(&mut self, patch: OpPatch) {
        self.opdag.apply_patch(patch);
        self.rederive_state();
    }

    /// Rederive state from scratch by replaying the linearized DAG
    fn rederive_state(&mut self) {
        self.state = DerivedState::new();
        // Clone ops to avoid borrow conflict
        let ops: Vec<Op> = self.opdag.linearize().into_iter().cloned().collect();
        for op in &ops {
            self.try_apply_op_to_state(op);
        }
    }

    /// Serialize database state to JSON
    /// Returns the actual derived state (only valid operations), not all ops in the DAG.
    pub fn to_json(&self) -> String {
        // Use derived state, not raw ops
        let mut entities: HashMap<String, Vec<String>> = HashMap::new();
        let mut relations: HashMap<String, Vec<Vec<JsonValue>>> = HashMap::new();

        // Gather entities from state
        for (sort_id, entity_ids) in &self.state.entities {
            let sort_name = self
                .theory
                .signature
                .sort_name(*sort_id)
                .unwrap_or("unknown")
                .to_string();
            for entity_id in entity_ids {
                entities
                    .entry(sort_name.clone())
                    .or_default()
                    .push(entity_id.0.to_string());
            }
        }

        // Gather relations from state
        for (rel_id, index) in &self.state.relations {
            let rel_name = self
                .theory
                .signature
                .relation(*rel_id)
                .map(|r| r.name.clone())
                .unwrap_or_else(|| "unknown".to_string());
            for tuple in index.all_tuples() {
                let json_args: Vec<JsonValue> = tuple
                    .iter()
                    .map(|v| match v {
                        Value::Entity(id) => json!({ "entity": id.0.to_string() }),
                        Value::Int(n) => json!({ "int": n }),
                        Value::Str(s) => json!({ "str": s }),
                    })
                    .collect();
                relations
                    .entry(rel_name.clone())
                    .or_default()
                    .push(json_args);
            }
        }

        let result = json!({
            "entities": entities,
            "relations": relations,
        });

        serde_json::to_string_pretty(&result).unwrap()
    }
}

/// Expected type for a relation argument position
#[derive(Clone, Debug, PartialEq, Eq)]
enum ExpectedType {
    /// A base sort (entity type)
    Sort(SortId),
    /// The Int primitive type
    Int,
    /// The Str primitive type
    Str,
}

/// Flatten a DerivedSort into a list of expected argument types
fn flatten_derived_sort(sort: &DerivedSort) -> Vec<ExpectedType> {
    match sort {
        DerivedSort::Base(id) => vec![ExpectedType::Sort(*id)],
        DerivedSort::Product(fields) => fields
            .iter()
            .flat_map(|(_, s)| flatten_derived_sort(s))
            .collect(),
        DerivedSort::Int => vec![ExpectedType::Int],
        DerivedSort::Str => vec![ExpectedType::Str],
    }
}

/// Error type for database operations
#[derive(Clone, Debug)]
pub struct DbError {
    pub message: String,
}

impl DbError {
    pub fn new(message: impl Into<String>) -> Self {
        DbError {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for DbError {}

/// A substitution mapping variable names to values
#[derive(Clone, Debug, Default)]
struct Substitution {
    bindings: HashMap<String, Value>,
}

impl Substitution {
    fn new() -> Self {
        Default::default()
    }

    fn bind(&mut self, var: String, val: Value) {
        self.bindings.insert(var, val);
    }

    fn get(&self, var: &str) -> Option<&Value> {
        self.bindings.get(var)
    }

    fn with_binding(&self, var: String, val: Value) -> Self {
        let mut new = self.clone();
        new.bind(var, val);
        new
    }
}

// ============================================================================
// Axiom Compilation
// ============================================================================

/// How to handle a position during a join
#[derive(Clone, Debug)]
enum JoinPosition {
    /// Extract value into a new variable
    Bind(String),
    /// Must equal the already-bound variable
    Match(String),
    /// Must equal this literal value
    MatchLiteral(Value),
}

/// A single join operation in the plan
#[derive(Clone, Debug)]
struct JoinStep {
    /// Relation to look up tuples from
    relation: RelId,
    /// For each position, how to handle it
    positions: Vec<JoinPosition>,
}

/// A trigger that fires when a tuple is added to a specific relation
#[derive(Clone, Debug)]
struct AxiomTrigger {
    /// Which relation this trigger watches
    relation: RelId,
    /// Map from tuple positions to variables
    bindings: Vec<(usize, String)>,
    /// Steps to join with remaining antecedent atoms
    join_plan: Vec<JoinStep>,
    /// The consequent to check after all joins complete
    consequent: Formula,
}

/// A compiled axiom optimized for incremental checking
#[derive(Clone, Debug)]
struct CompiledAxiom {
    /// Original axiom name for error messages
    name: String,
    /// One trigger per antecedent atom
    triggers: Vec<AxiomTrigger>,
}

impl CompiledAxiom {
    /// Compile a sequent into triggers
    fn compile(sequent: &Sequent, sig: &Signature) -> CompiledAxiom {
        let atoms = extract_atoms(&sequent.premise, sig);

        // Create one trigger per atom
        let triggers = atoms
            .iter()
            .enumerate()
            .map(|(i, atom)| compile_trigger(i, atom, &atoms, &sequent.conclusion))
            .collect();

        CompiledAxiom {
            name: sequent.name.clone(),
            triggers,
        }
    }
}

/// An extracted relational atom: (relation_id, variable_names_for_each_position)
type ExtractedAtom = (RelId, Vec<String>);

/// Extract all relational atoms from a formula (flattening Conj)
fn extract_atoms(formula: &Formula, _sig: &Signature) -> Vec<ExtractedAtom> {
    match formula {
        Formula::True => vec![],
        Formula::False => vec![],
        Formula::Rel(rel, arg) => {
            // Extract variable names from the term
            let vars = extract_vars_from_term(arg);
            vec![(*rel, vars)]
        }
        Formula::Conj(formulas) => formulas
            .iter()
            .flat_map(|f| extract_atoms(f, _sig))
            .collect(),
        Formula::Disj(_) => vec![], // Disjunction in antecedent not supported for simple triggers
        Formula::Eq(_, _) => vec![], // Equality in antecedent handled separately
        Formula::Exists(_, _, body) => extract_atoms(body, _sig),
        // Comparison formulas are constraints, not relation atoms
        Formula::Lt(_, _) | Formula::Le(_, _) | Formula::Gt(_, _) | Formula::Ge(_, _) => vec![],
    }
}

/// Extract variable names from a term (flattening records)
fn extract_vars_from_term(term: &Term) -> Vec<String> {
    match term {
        Term::Var(name, _) => vec![name.clone()],
        Term::Record(fields) => fields
            .iter()
            .flat_map(|(_, t)| extract_vars_from_term(t))
            .collect(),
        Term::App(_, _) => vec![], // Function applications not directly supported
        Term::Project(_, _) => vec![], // Projections not directly supported
    }
}

/// Compile a trigger for one antecedent atom
fn compile_trigger(
    atom_index: usize,
    trigger_atom: &ExtractedAtom,
    all_atoms: &[ExtractedAtom],
    consequent: &Formula,
) -> AxiomTrigger {
    let (rel, vars) = trigger_atom;

    // Create bindings from trigger atom: map positions to variables
    let bindings: Vec<(usize, String)> = vars
        .iter()
        .enumerate()
        .map(|(pos, var)| (pos, var.clone()))
        .collect();

    // Variables bound by the trigger atom
    let mut bound_vars: HashSet<String> = bindings.iter().map(|(_, v)| v.clone()).collect();

    // Build join plan for other atoms (excluding the trigger atom)
    let other_atoms: Vec<_> = all_atoms
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != atom_index)
        .map(|(_, atom)| atom.clone())
        .collect();

    let join_plan = compute_join_plan(&mut bound_vars, &other_atoms);

    AxiomTrigger {
        relation: *rel,
        bindings,
        join_plan,
        consequent: consequent.clone(),
    }
}

/// Compute the join plan using most-bound-first heuristic
fn compute_join_plan(bound_vars: &mut HashSet<String>, atoms: &[ExtractedAtom]) -> Vec<JoinStep> {
    let mut remaining: Vec<_> = atoms.to_vec();
    let mut plan = Vec::new();

    while !remaining.is_empty() {
        // Pick atom with most bound variables (most-bound-first heuristic)
        let best_idx = remaining
            .iter()
            .enumerate()
            .max_by_key(|(_, (_, vars))| vars.iter().filter(|v| bound_vars.contains(*v)).count())
            .map(|(i, _)| i)
            .unwrap();

        let (rel, vars) = remaining.remove(best_idx);

        // Build JoinStep: determine Match vs Bind for each position
        let positions: Vec<JoinPosition> = vars
            .iter()
            .map(|var| {
                if bound_vars.contains(var) {
                    JoinPosition::Match(var.clone())
                } else {
                    bound_vars.insert(var.clone());
                    JoinPosition::Bind(var.clone())
                }
            })
            .collect();

        plan.push(JoinStep {
            relation: rel,
            positions,
        });
    }

    plan
}

/// Try to extend a substitution with values from a tuple
fn try_extend_subst(
    subst: &Substitution,
    positions: &[JoinPosition],
    tuple: &[Value],
) -> Option<Substitution> {
    let mut extended = subst.clone();

    for (i, pos) in positions.iter().enumerate() {
        match pos {
            JoinPosition::Bind(var) => {
                extended.bind(var.clone(), tuple[i].clone());
            }
            JoinPosition::Match(var) => {
                // Should already match due to lookup, but verify
                if subst.get(var) != Some(&tuple[i]) {
                    return None;
                }
            }
            JoinPosition::MatchLiteral(val) => {
                if &tuple[i] != val {
                    return None;
                }
            }
        }
    }

    Some(extended)
}

/// Analyze a compiled axiom to determine which prefix indexes are needed
fn required_prefix_indexes(axiom: &CompiledAxiom) -> Vec<(RelId, usize)> {
    let mut required = Vec::new();

    for trigger in &axiom.triggers {
        for step in &trigger.join_plan {
            // Count leading Match/MatchLiteral positions (the prefix we can use)
            let prefix_len = step
                .positions
                .iter()
                .take_while(|p| !matches!(p, JoinPosition::Bind(_)))
                .count();

            if prefix_len > 0 {
                required.push((step.relation, prefix_len));
            }
        }
    }

    required
}

// ============================================================================
// Relation Indexing
// ============================================================================

/// Index for efficient tuple lookup by prefix
#[derive(Default)]
struct RelationIndex {
    /// All tuples in the relation (the source of truth)
    tuples: Vec<Vec<Value>>,

    /// For deduplication: tracks which tuples exist
    tuple_set: HashSet<Vec<Value>>,

    /// prefix_index[k] maps (arg0, ..., arg(k-1)) to matching tuple indices
    /// Built lazily as needed
    prefix_indexes: HashMap<usize, HashMap<Vec<Value>, Vec<usize>>>,
}

impl RelationIndex {
    fn new() -> Self {
        Default::default()
    }

    /// Add a tuple to the index
    fn insert(&mut self, tuple: Vec<Value>) {
        if self.tuple_set.contains(&tuple) {
            return; // Already exists
        }

        let idx = self.tuples.len();
        self.tuples.push(tuple.clone());
        self.tuple_set.insert(tuple.clone());

        // Update all existing prefix indexes
        for (&prefix_len, index) in &mut self.prefix_indexes {
            if tuple.len() >= prefix_len {
                let prefix: Vec<Value> = tuple[..prefix_len].to_vec();
                index.entry(prefix).or_default().push(idx);
            }
        }
    }

    /// Ensure a prefix index of the given length exists
    fn ensure_prefix_index(&mut self, prefix_len: usize) {
        if self.prefix_indexes.contains_key(&prefix_len) {
            return;
        }

        // Build the index from existing tuples
        let mut index: HashMap<Vec<Value>, Vec<usize>> = HashMap::new();
        for (idx, tuple) in self.tuples.iter().enumerate() {
            if tuple.len() >= prefix_len {
                let prefix = tuple[..prefix_len].to_vec();
                index.entry(prefix).or_default().push(idx);
            }
        }
        self.prefix_indexes.insert(prefix_len, index);
    }

    /// Look up tuples by prefix
    fn lookup_by_prefix(&self, prefix: &[Value]) -> impl Iterator<Item = &Vec<Value>> {
        self.prefix_indexes
            .get(&prefix.len())
            .and_then(|idx| idx.get(prefix))
            .into_iter()
            .flatten()
            .map(|&i| &self.tuples[i])
    }

    /// Check if a tuple exists
    fn contains(&self, tuple: &[Value]) -> bool {
        self.tuple_set.contains(tuple)
    }

    /// Get all tuples
    fn all_tuples(&self) -> &[Vec<Value>] {
        &self.tuples
    }
}

/// Derived state from replaying the oplog
#[derive(Default)]
struct DerivedState {
    /// Entities by sort: sort -> set of entity IDs
    entities: HashMap<SortId, HashSet<EntityId>>,
    /// Reverse lookup: entity ID -> sort
    entity_sorts: HashMap<EntityId, SortId>,
    /// Relations: relation id -> indexed tuples
    relations: HashMap<RelId, RelationIndex>,
}

impl DerivedState {
    fn new() -> Self {
        Default::default()
    }

    fn add_entity(&mut self, sort: SortId, id: &EntityId) {
        self.entities.entry(sort).or_default().insert(id.clone());
        self.entity_sorts.insert(id.clone(), sort);
    }

    fn add_relation(&mut self, rel: RelId, args: Vec<Value>) {
        self.relations
            .entry(rel)
            .or_insert_with(RelationIndex::new)
            .insert(args);
    }

    /// Build prefix indexes required by the compiled axioms
    #[allow(dead_code)]
    fn ensure_indexes_for_axioms(&mut self, compiled_axioms: &[CompiledAxiom]) {
        for axiom in compiled_axioms {
            for (rel, prefix_len) in required_prefix_indexes(axiom) {
                if let Some(index) = self.relations.get_mut(&rel) {
                    index.ensure_prefix_index(prefix_len);
                }
            }
        }
    }

    fn entity_exists(&self, id: &EntityId) -> bool {
        self.entity_sorts.contains_key(id)
    }

    fn get_entity_sort(&self, id: &EntityId) -> Option<&SortId> {
        self.entity_sorts.get(id)
    }

    /// Get all entities of a given sort
    fn get_entities_of_sort(&self, sort: SortId) -> Vec<EntityId> {
        self.entities
            .get(&sort)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get all tuples for a relation
    fn get_relation_tuples(&self, rel: RelId) -> &[Vec<Value>] {
        self.relations
            .get(&rel)
            .map(|idx| idx.all_tuples())
            .unwrap_or(&[])
    }

    /// Look up tuples matching the given position constraints
    /// constraints: list of (position, required_value)
    fn lookup_matching_tuples(
        &self,
        rel: RelId,
        constraints: &[(usize, Value)],
    ) -> Vec<&Vec<Value>> {
        let index = match self.relations.get(&rel) {
            Some(idx) => idx,
            None => return vec![],
        };

        if constraints.is_empty() {
            // No constraints - return all tuples
            return index.all_tuples().iter().collect();
        }

        // Sort constraints by position to check for contiguous prefix
        let mut sorted_constraints = constraints.to_vec();
        sorted_constraints.sort_by_key(|(pos, _)| *pos);

        // Check for contiguous prefix starting at 0
        let is_prefix = sorted_constraints
            .iter()
            .enumerate()
            .all(|(i, (pos, _))| *pos == i);

        if is_prefix && index.prefix_indexes.contains_key(&sorted_constraints.len()) {
            // Use prefix index for efficient lookup
            let prefix: Vec<Value> = sorted_constraints.iter().map(|(_, v)| v.clone()).collect();
            index.lookup_by_prefix(&prefix).collect()
        } else {
            // Fall back to scanning all tuples
            index
                .all_tuples()
                .iter()
                .filter(|tuple| {
                    constraints
                        .iter()
                        .all(|(pos, val)| tuple.get(*pos) == Some(val))
                })
                .collect()
        }
    }

    /// Evaluate a term under a substitution
    fn eval_term(&self, term: &Term, subst: &Substitution, sig: &Signature) -> Option<Value> {
        match term {
            Term::Var(name, _) => subst.get(name).cloned(),
            Term::Record(fields) => {
                // For records, we'd need to flatten - but for now just handle single vars
                if fields.len() == 1 {
                    self.eval_term(&fields[0].1, subst, sig)
                } else {
                    None // Multi-field records not supported in eval
                }
            }
            Term::App(_, _) => None, // Function application not supported in eval
            Term::Project(_, _) => None, // Projection not supported in eval
        }
    }

    /// Check if a formula holds under a substitution
    fn eval_formula(&self, formula: &Formula, subst: &Substitution, sig: &Signature) -> bool {
        match formula {
            Formula::True => true,
            Formula::False => false,
            Formula::Rel(rel, arg) => {
                // Evaluate the argument term to get values
                let vals = self.eval_term_to_values(arg, subst, sig);
                match vals {
                    Some(v) => {
                        // Check if this tuple exists in the relation
                        self.get_relation_tuples(*rel).contains(&v)
                    }
                    None => false, // Unbound variable
                }
            }
            Formula::Conj(formulas) => formulas.iter().all(|f| self.eval_formula(f, subst, sig)),
            Formula::Disj(formulas) => formulas.iter().any(|f| self.eval_formula(f, subst, sig)),
            Formula::Eq(t1, t2) => {
                match (
                    self.eval_term(t1, subst, sig),
                    self.eval_term(t2, subst, sig),
                ) {
                    (Some(v1), Some(v2)) => v1 == v2,
                    _ => false, // Unbound variable
                }
            }
            Formula::Exists(var, sort, body) => {
                // Check if there exists a value of the given sort that satisfies the body
                match sort {
                    DerivedSort::Base(sort_id) => {
                        for entity in self.get_entities_of_sort(*sort_id) {
                            let new_subst = subst.with_binding(var.clone(), Value::Entity(entity));
                            if self.eval_formula(body, &new_subst, sig) {
                                return true;
                            }
                        }
                        false
                    }
                    DerivedSort::Product(_) => {
                        // Product sorts in existential not yet supported
                        false
                    }
                    // Int and Str are infinite domains - existential quantification not supported
                    DerivedSort::Int | DerivedSort::Str => false,
                }
            }
            // Comparison formulas for Int values
            Formula::Lt(t1, t2) => {
                match (
                    self.eval_term(t1, subst, sig),
                    self.eval_term(t2, subst, sig),
                ) {
                    (Some(Value::Int(v1)), Some(Value::Int(v2))) => v1 < v2,
                    _ => false,
                }
            }
            Formula::Le(t1, t2) => {
                match (
                    self.eval_term(t1, subst, sig),
                    self.eval_term(t2, subst, sig),
                ) {
                    (Some(Value::Int(v1)), Some(Value::Int(v2))) => v1 <= v2,
                    _ => false,
                }
            }
            Formula::Gt(t1, t2) => {
                match (
                    self.eval_term(t1, subst, sig),
                    self.eval_term(t2, subst, sig),
                ) {
                    (Some(Value::Int(v1)), Some(Value::Int(v2))) => v1 > v2,
                    _ => false,
                }
            }
            Formula::Ge(t1, t2) => {
                match (
                    self.eval_term(t1, subst, sig),
                    self.eval_term(t2, subst, sig),
                ) {
                    (Some(Value::Int(v1)), Some(Value::Int(v2))) => v1 >= v2,
                    _ => false,
                }
            }
        }
    }

    /// Evaluate a term to a vector of values (for relation arguments)
    fn eval_term_to_values(
        &self,
        term: &Term,
        subst: &Substitution,
        sig: &Signature,
    ) -> Option<Vec<Value>> {
        match term {
            Term::Var(name, _) => subst.get(name).map(|v| vec![v.clone()]),
            Term::Record(fields) => {
                let mut vals = Vec::new();
                for (_, t) in fields {
                    match self.eval_term_to_values(t, subst, sig) {
                        Some(v) => vals.extend(v),
                        None => return None,
                    }
                }
                Some(vals)
            }
            Term::App(_, _) => None,
            Term::Project(_, _) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relation_index_basic() {
        let mut idx = RelationIndex::new();
        idx.insert(vec![Value::Int(1), Value::Int(2)]);
        idx.insert(vec![Value::Int(1), Value::Int(3)]);
        idx.insert(vec![Value::Int(2), Value::Int(3)]);

        assert_eq!(idx.all_tuples().len(), 3);
    }

    #[test]
    fn test_relation_index_dedup() {
        let mut idx = RelationIndex::new();
        idx.insert(vec![Value::Int(1), Value::Int(2)]);
        idx.insert(vec![Value::Int(1), Value::Int(2)]); // Duplicate

        assert_eq!(idx.all_tuples().len(), 1);
    }

    #[test]
    fn test_relation_index_prefix_lookup() {
        let mut idx = RelationIndex::new();
        idx.insert(vec![Value::Int(1), Value::Int(2)]);
        idx.insert(vec![Value::Int(1), Value::Int(3)]);
        idx.insert(vec![Value::Int(2), Value::Int(3)]);

        idx.ensure_prefix_index(1);

        let matches: Vec<_> = idx.lookup_by_prefix(&[Value::Int(1)]).collect();
        assert_eq!(matches.len(), 2);

        let matches: Vec<_> = idx.lookup_by_prefix(&[Value::Int(2)]).collect();
        assert_eq!(matches.len(), 1);

        let matches: Vec<_> = idx.lookup_by_prefix(&[Value::Int(99)]).collect();
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn test_relation_index_contains() {
        let mut idx = RelationIndex::new();
        idx.insert(vec![Value::Int(1), Value::Int(2)]);

        assert!(idx.contains(&[Value::Int(1), Value::Int(2)]));
        assert!(!idx.contains(&[Value::Int(1), Value::Int(3)]));
    }

    #[test]
    fn test_relation_index_prefix_two() {
        let mut idx = RelationIndex::new();
        idx.insert(vec![Value::Int(1), Value::Int(2), Value::Int(10)]);
        idx.insert(vec![Value::Int(1), Value::Int(2), Value::Int(20)]);
        idx.insert(vec![Value::Int(1), Value::Int(3), Value::Int(30)]);

        idx.ensure_prefix_index(2);

        let matches: Vec<_> = idx
            .lookup_by_prefix(&[Value::Int(1), Value::Int(2)])
            .collect();
        assert_eq!(matches.len(), 2);

        let matches: Vec<_> = idx
            .lookup_by_prefix(&[Value::Int(1), Value::Int(3)])
            .collect();
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn test_flatten_derived_sort() {
        let id1 = SortId::new();
        let id2 = SortId::new();

        // Base sort
        let base = DerivedSort::Base(id1);
        assert_eq!(flatten_derived_sort(&base), vec![ExpectedType::Sort(id1)]);

        // Product sort
        let product = DerivedSort::Product(vec![
            ("x".to_string(), DerivedSort::Base(id1)),
            ("y".to_string(), DerivedSort::Base(id2)),
        ]);
        assert_eq!(
            flatten_derived_sort(&product),
            vec![ExpectedType::Sort(id1), ExpectedType::Sort(id2)]
        );

        // Nested product
        let nested = DerivedSort::Product(vec![
            (
                "a".to_string(),
                DerivedSort::Product(vec![
                    ("x".to_string(), DerivedSort::Base(id1)),
                    ("y".to_string(), DerivedSort::Base(id2)),
                ]),
            ),
            ("b".to_string(), DerivedSort::Base(id1)),
        ]);
        assert_eq!(
            flatten_derived_sort(&nested),
            vec![
                ExpectedType::Sort(id1),
                ExpectedType::Sort(id2),
                ExpectedType::Sort(id1)
            ]
        );

        // Int type
        assert_eq!(
            flatten_derived_sort(&DerivedSort::Int),
            vec![ExpectedType::Int]
        );

        // Str type
        assert_eq!(
            flatten_derived_sort(&DerivedSort::Str),
            vec![ExpectedType::Str]
        );

        // Product with Int
        let mixed = DerivedSort::Product(vec![
            ("src".to_string(), DerivedSort::Base(id1)),
            ("weight".to_string(), DerivedSort::Int),
        ]);
        assert_eq!(
            flatten_derived_sort(&mixed),
            vec![ExpectedType::Sort(id1), ExpectedType::Int]
        );
    }

    #[test]
    fn test_database_from_theory() {
        let mut theory = Theory::new("TestTheory");
        let v = theory.signature.add_sort("V".to_string());
        let _e = theory.signature.add_relation(
            "E".to_string(),
            DerivedSort::Product(vec![
                ("src".to_string(), DerivedSort::Base(v)),
                ("tgt".to_string(), DerivedSort::Base(v)),
            ]),
        );

        let db = Database::from_theory(theory);
        assert_eq!(db.theory().name, "TestTheory");
    }

    #[test]
    fn test_database_add_entity() {
        let mut theory = Theory::new("TestTheory");
        let v = theory.signature.add_sort("V".to_string());

        let mut db = Database::from_theory(theory);
        let result = db.add_entity(v);
        assert!(result.is_ok());

        // Adding entity with unknown sort should fail
        let unknown_sort = SortId::new();
        let result = db.add_entity(unknown_sort);
        assert!(result.is_err());
    }

    #[test]
    fn test_try_extend_subst_bind() {
        let subst = Substitution::new();
        let positions = vec![
            JoinPosition::Bind("x".to_string()),
            JoinPosition::Bind("y".to_string()),
        ];
        let tuple = vec![Value::Int(1), Value::Int(2)];

        let extended = try_extend_subst(&subst, &positions, &tuple).unwrap();
        assert_eq!(extended.get("x"), Some(&Value::Int(1)));
        assert_eq!(extended.get("y"), Some(&Value::Int(2)));
    }

    #[test]
    fn test_try_extend_subst_match_success() {
        let mut subst = Substitution::new();
        subst.bind("x".to_string(), Value::Int(1));

        let positions = vec![
            JoinPosition::Match("x".to_string()),
            JoinPosition::Bind("y".to_string()),
        ];
        let tuple = vec![Value::Int(1), Value::Int(2)];

        let extended = try_extend_subst(&subst, &positions, &tuple).unwrap();
        assert_eq!(extended.get("y"), Some(&Value::Int(2)));
    }

    #[test]
    fn test_try_extend_subst_match_failure() {
        let mut subst = Substitution::new();
        subst.bind("x".to_string(), Value::Int(99)); // Different value

        let positions = vec![
            JoinPosition::Match("x".to_string()),
            JoinPosition::Bind("y".to_string()),
        ];
        let tuple = vec![Value::Int(1), Value::Int(2)];

        assert!(try_extend_subst(&subst, &positions, &tuple).is_none());
    }

    #[test]
    fn test_try_extend_subst_literal_match() {
        let subst = Substitution::new();
        let positions = vec![
            JoinPosition::MatchLiteral(Value::Int(42)),
            JoinPosition::Bind("x".to_string()),
        ];
        let tuple = vec![Value::Int(42), Value::Int(100)];

        let extended = try_extend_subst(&subst, &positions, &tuple).unwrap();
        assert_eq!(extended.get("x"), Some(&Value::Int(100)));
    }

    #[test]
    fn test_try_extend_subst_literal_mismatch() {
        let subst = Substitution::new();
        let positions = vec![
            JoinPosition::MatchLiteral(Value::Int(42)),
            JoinPosition::Bind("x".to_string()),
        ];
        let tuple = vec![Value::Int(99), Value::Int(100)]; // 99 != 42

        assert!(try_extend_subst(&subst, &positions, &tuple).is_none());
    }
}
