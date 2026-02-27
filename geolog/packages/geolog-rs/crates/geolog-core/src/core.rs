//! Core internal representation for the type system.
//!
//! This module contains the typed, elaborated representation that surface syntax
//! elaborates into. It adopts the type system from geolog-zeta with UUID-based IDs.
//!
//! Key types:
//! - `SortId`, `FuncId`, `RelId`: UUID-based identifiers for sorts, functions, relations
//! - `DerivedSort`: Base sorts or products of derived sorts
//! - `Signature`: Sorts + functions + relations + instance fields
//! - `Term`: Well-typed terms (Var, App, Record, Project)
//! - `Formula`: Well-typed geometric formulas
//! - `Sequent`: Context, premise, and conclusion
//! - `Theory`: A signature plus axioms (sequents)
//! - `ElaboratedTheory`: A theory with its parameters

use std::collections::HashMap;
use std::fmt;
use uuid::Uuid;

// ============ ID Types ============

/// A unique identifier for sorts within a signature.
/// Uses UUID for global uniqueness and stable serialization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SortId(pub Uuid);

impl SortId {
    /// Create a new random SortId
    pub fn new() -> Self {
        SortId(Uuid::new_v4())
    }

    /// Create a SortId from an existing UUID
    pub fn from_uuid(uuid: Uuid) -> Self {
        SortId(uuid)
    }

    /// Get the underlying UUID
    pub fn uuid(&self) -> Uuid {
        self.0
    }
}

impl Default for SortId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for SortId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "sort:{}", &self.0.to_string()[..8])
    }
}

/// A unique identifier for function symbols within a signature.
/// Uses UUID for global uniqueness and stable serialization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FuncId(pub Uuid);

impl FuncId {
    /// Create a new random FuncId
    pub fn new() -> Self {
        FuncId(Uuid::new_v4())
    }

    /// Create a FuncId from an existing UUID
    pub fn from_uuid(uuid: Uuid) -> Self {
        FuncId(uuid)
    }

    /// Get the underlying UUID
    pub fn uuid(&self) -> Uuid {
        self.0
    }
}

impl Default for FuncId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for FuncId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "func:{}", &self.0.to_string()[..8])
    }
}

/// A unique identifier for relation symbols within a signature.
/// Uses UUID for global uniqueness and stable serialization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RelId(pub Uuid);

impl RelId {
    /// Create a new random RelId
    pub fn new() -> Self {
        RelId(Uuid::new_v4())
    }

    /// Create a RelId from an existing UUID
    pub fn from_uuid(uuid: Uuid) -> Self {
        RelId(uuid)
    }

    /// Get the underlying UUID
    pub fn uuid(&self) -> Uuid {
        self.0
    }
}

impl Default for RelId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for RelId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "rel:{}", &self.0.to_string()[..8])
    }
}

/// A unique identifier for instance fields within a signature.
/// Uses UUID for global uniqueness and stable serialization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct InstanceFieldId(pub Uuid);

impl InstanceFieldId {
    /// Create a new random InstanceFieldId
    pub fn new() -> Self {
        InstanceFieldId(Uuid::new_v4())
    }

    /// Create an InstanceFieldId from an existing UUID
    pub fn from_uuid(uuid: Uuid) -> Self {
        InstanceFieldId(uuid)
    }

    /// Get the underlying UUID
    pub fn uuid(&self) -> Uuid {
        self.0
    }
}

impl Default for InstanceFieldId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for InstanceFieldId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "field:{}", &self.0.to_string()[..8])
    }
}

// ============ Derived Sorts ============

/// Derived sorts: base sorts, primitives, or products of derived sorts.
///
/// This allows expressing record/tuple types in the domain and codomain of
/// functions and relations. For example:
/// - `Base(sort_id)` represents a simple sort like `V`
/// - `Product([("src", Base(v_id)), ("tgt", Base(v_id))])` represents `[src: V, tgt: V]`
/// - `Int` and `Str` are built-in primitive types
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DerivedSort {
    /// A base sort, identified by its SortId
    Base(SortId),
    /// A product of derived sorts (record/tuple type)
    /// Fields are ordered and named.
    Product(Vec<(String, DerivedSort)>),
    /// Built-in integer type
    Int,
    /// Built-in string type
    Str,
}

impl DerivedSort {
    /// Create a base sort from a SortId
    pub fn base(id: SortId) -> Self {
        DerivedSort::Base(id)
    }

    /// Create a product sort from named fields
    pub fn product(fields: Vec<(String, DerivedSort)>) -> Self {
        DerivedSort::Product(fields)
    }

    /// Create the unit type (empty product)
    pub fn unit() -> Self {
        DerivedSort::Product(vec![])
    }

    /// Returns the arity (number of base sorts/primitives) of this derived sort.
    ///
    /// - `Base(_)` has arity 1
    /// - `Int` and `Str` have arity 1
    /// - `Product(fields)` has arity = sum of field arities (or 0 if empty for unit)
    pub fn arity(&self) -> usize {
        match self {
            DerivedSort::Base(_) => 1,
            DerivedSort::Int => 1,
            DerivedSort::Str => 1,
            DerivedSort::Product(fields) => {
                if fields.is_empty() {
                    0 // Unit type has no components
                } else {
                    fields.iter().map(|(_, s)| s.arity()).sum()
                }
            }
        }
    }

    /// Check if this is a base sort
    pub fn is_base(&self) -> bool {
        matches!(self, DerivedSort::Base(_))
    }

    /// Check if this is a product sort
    pub fn is_product(&self) -> bool {
        matches!(self, DerivedSort::Product(_))
    }

    /// Check if this is the Int primitive type
    pub fn is_int(&self) -> bool {
        matches!(self, DerivedSort::Int)
    }

    /// Check if this is the Str primitive type
    pub fn is_str(&self) -> bool {
        matches!(self, DerivedSort::Str)
    }

    /// Check if this is a primitive type (Int or Str)
    pub fn is_primitive(&self) -> bool {
        matches!(self, DerivedSort::Int | DerivedSort::Str)
    }

    /// Get the base SortId if this is a base sort
    pub fn as_base(&self) -> Option<SortId> {
        match self {
            DerivedSort::Base(id) => Some(*id),
            _ => None,
        }
    }

    /// Get the fields if this is a product sort
    pub fn as_product(&self) -> Option<&[(String, DerivedSort)]> {
        match self {
            DerivedSort::Product(fields) => Some(fields),
            _ => None,
        }
    }

    /// Look up a field by name in a product sort
    pub fn get_field(&self, name: &str) -> Option<&DerivedSort> {
        match self {
            DerivedSort::Product(fields) => fields.iter().find(|(n, _)| n == name).map(|(_, s)| s),
            _ => None,
        }
    }
}

// ============ Signature Components ============

/// A function symbol with its domain and codomain.
///
/// Functions are total: for every element in the domain, there must be
/// exactly one element in the codomain.
#[derive(Clone, Debug)]
pub struct FunctionSymbol {
    /// Unique identifier for this function
    pub id: FuncId,
    /// Name of the function (e.g., "src", "mul")
    pub name: String,
    /// Domain type (can be a product for multi-argument functions)
    pub domain: DerivedSort,
    /// Codomain type (can be a product for record-valued functions)
    pub codomain: DerivedSort,
}

/// A relation symbol with its domain.
///
/// Relations are predicates: they hold or don't hold for elements of their domain.
/// Unlike functions, relations have no codomain - they return `Prop`.
#[derive(Clone, Debug)]
pub struct RelationSymbol {
    /// Unique identifier for this relation
    pub id: RelId,
    /// Name of the relation (e.g., "E", "child")
    pub name: String,
    /// Domain type (can be a product for multi-argument relations)
    pub domain: DerivedSort,
}

/// An instance field declaration.
///
/// Instance fields hold sub-instances of other theories. For example:
/// ```text
/// theory (N : PetriNet instance) ReachabilityProblem {
///   initial_marking : N Marking instance;
///   target_marking : N Marking instance;
/// }
/// ```
#[derive(Clone, Debug)]
pub struct InstanceFieldSymbol {
    /// Unique identifier for this instance field
    pub id: InstanceFieldId,
    /// Name of the field (e.g., "initial_marking")
    pub name: String,
    /// The theory type expression as a string (e.g., "N Marking")
    /// This needs to be resolved during instance elaboration.
    pub theory_type: String,
}

// ============ Signature ============

/// A signature: the vocabulary of a theory.
///
/// Contains sorts, function symbols, relation symbols, and instance fields.
/// Each component can be looked up by name or by ID.
#[derive(Clone, Debug, Default)]
pub struct Signature {
    /// Sort names, keyed by SortId
    pub sorts: HashMap<SortId, String>,
    /// Map from sort name to SortId
    pub sort_names: HashMap<String, SortId>,

    /// Function symbols, keyed by FuncId
    pub functions: HashMap<FuncId, FunctionSymbol>,
    /// Map from function name to FuncId
    pub func_names: HashMap<String, FuncId>,

    /// Relation symbols, keyed by RelId
    pub relations: HashMap<RelId, RelationSymbol>,
    /// Map from relation name to RelId
    pub rel_names: HashMap<String, RelId>,

    /// Instance field declarations, keyed by InstanceFieldId
    pub instance_fields: HashMap<InstanceFieldId, InstanceFieldSymbol>,
    /// Map from instance field name to InstanceFieldId
    pub instance_field_names: HashMap<String, InstanceFieldId>,
}

impl Signature {
    /// Create a new empty signature
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a sort to the signature, returning its SortId
    pub fn add_sort(&mut self, name: String) -> SortId {
        let id = SortId::new();
        self.sort_names.insert(name.clone(), id);
        self.sorts.insert(id, name);
        id
    }

    /// Add a sort with a specific ID (for deserialization)
    pub fn add_sort_with_id(&mut self, id: SortId, name: String) {
        self.sort_names.insert(name.clone(), id);
        self.sorts.insert(id, name);
    }

    /// Add a function symbol to the signature, returning its FuncId
    pub fn add_function(
        &mut self,
        name: String,
        domain: DerivedSort,
        codomain: DerivedSort,
    ) -> FuncId {
        let id = FuncId::new();
        self.func_names.insert(name.clone(), id);
        self.functions.insert(
            id,
            FunctionSymbol {
                id,
                name,
                domain,
                codomain,
            },
        );
        id
    }

    /// Add a function with a specific ID (for deserialization)
    pub fn add_function_with_id(
        &mut self,
        id: FuncId,
        name: String,
        domain: DerivedSort,
        codomain: DerivedSort,
    ) {
        self.func_names.insert(name.clone(), id);
        self.functions.insert(
            id,
            FunctionSymbol {
                id,
                name,
                domain,
                codomain,
            },
        );
    }

    /// Add a relation symbol to the signature, returning its RelId
    pub fn add_relation(&mut self, name: String, domain: DerivedSort) -> RelId {
        let id = RelId::new();
        self.rel_names.insert(name.clone(), id);
        self.relations
            .insert(id, RelationSymbol { id, name, domain });
        id
    }

    /// Add a relation with a specific ID (for deserialization)
    pub fn add_relation_with_id(&mut self, id: RelId, name: String, domain: DerivedSort) {
        self.rel_names.insert(name.clone(), id);
        self.relations
            .insert(id, RelationSymbol { id, name, domain });
    }

    /// Add an instance field declaration, returning its InstanceFieldId
    pub fn add_instance_field(&mut self, name: String, theory_type: String) -> InstanceFieldId {
        let id = InstanceFieldId::new();
        self.instance_field_names.insert(name.clone(), id);
        self.instance_fields.insert(
            id,
            InstanceFieldSymbol {
                id,
                name,
                theory_type,
            },
        );
        id
    }

    /// Look up a sort by name
    pub fn lookup_sort(&self, name: &str) -> Option<SortId> {
        self.sort_names.get(name).copied()
    }

    /// Look up a function by name
    pub fn lookup_func(&self, name: &str) -> Option<FuncId> {
        self.func_names.get(name).copied()
    }

    /// Look up a relation by name
    pub fn lookup_rel(&self, name: &str) -> Option<RelId> {
        self.rel_names.get(name).copied()
    }

    /// Look up an instance field by name
    pub fn lookup_instance_field(&self, name: &str) -> Option<InstanceFieldId> {
        self.instance_field_names.get(name).copied()
    }

    /// Get the name of a sort by SortId
    pub fn sort_name(&self, id: SortId) -> Option<&str> {
        self.sorts.get(&id).map(|s| s.as_str())
    }

    /// Get a function symbol by FuncId
    pub fn function(&self, id: FuncId) -> Option<&FunctionSymbol> {
        self.functions.get(&id)
    }

    /// Get a relation symbol by RelId
    pub fn relation(&self, id: RelId) -> Option<&RelationSymbol> {
        self.relations.get(&id)
    }

    /// Get an instance field by InstanceFieldId
    pub fn instance_field(&self, id: InstanceFieldId) -> Option<&InstanceFieldSymbol> {
        self.instance_fields.get(&id)
    }

    /// Number of sorts in this signature
    pub fn num_sorts(&self) -> usize {
        self.sorts.len()
    }

    /// Number of functions in this signature
    pub fn num_functions(&self) -> usize {
        self.functions.len()
    }

    /// Number of relations in this signature
    pub fn num_relations(&self) -> usize {
        self.relations.len()
    }

    /// Iterate over all sort IDs
    pub fn sort_ids(&self) -> impl Iterator<Item = SortId> + '_ {
        self.sorts.keys().copied()
    }

    /// Iterate over all relation IDs
    pub fn rel_ids(&self) -> impl Iterator<Item = RelId> + '_ {
        self.relations.keys().copied()
    }

    /// Iterate over all function IDs
    pub fn func_ids(&self) -> impl Iterator<Item = FuncId> + '_ {
        self.functions.keys().copied()
    }
}

// ============ Terms ============

/// A well-typed term in the core language.
///
/// Terms represent values that can be passed to functions and relations.
/// Every term carries its sort for type checking.
#[derive(Clone, Debug)]
pub enum Term {
    /// Variable reference with its sort.
    /// The string is the variable name.
    Var(String, DerivedSort),

    /// Function application: `f(t)` where f is a function symbol.
    App(FuncId, Box<Term>),

    /// Record construction: `[field1: t1, field2: t2, ...]`
    Record(Vec<(String, Term)>),

    /// Field projection: `t.field`
    Project(Box<Term>, String),
}

impl Term {
    /// Get the sort of this term, given a signature for function lookups.
    pub fn sort(&self, sig: &Signature) -> DerivedSort {
        match self {
            Term::Var(_, sort) => sort.clone(),
            Term::App(func_id, _) => sig.functions[func_id].codomain.clone(),
            Term::Record(fields) => DerivedSort::Product(
                fields
                    .iter()
                    .map(|(name, term)| (name.clone(), term.sort(sig)))
                    .collect(),
            ),
            Term::Project(term, field) => {
                let term_sort = term.sort(sig);
                match term_sort {
                    DerivedSort::Product(fields) => fields
                        .into_iter()
                        .find(|(n, _)| n == field)
                        .map(|(_, s)| s)
                        .expect("field not found in product"),
                    _ => panic!("projection on non-product type"),
                }
            }
        }
    }

    /// Create a variable term
    pub fn var(name: impl Into<String>, sort: DerivedSort) -> Self {
        Term::Var(name.into(), sort)
    }

    /// Create a function application term
    pub fn app(func_id: FuncId, arg: Term) -> Self {
        Term::App(func_id, Box::new(arg))
    }

    /// Create a record term
    pub fn record(fields: Vec<(String, Term)>) -> Self {
        Term::Record(fields)
    }

    /// Create a projection term
    pub fn project(term: Term, field: impl Into<String>) -> Self {
        Term::Project(Box::new(term), field.into())
    }
}

// ============ Formulas ============

/// A well-typed geometric formula.
///
/// Formulas are propositions that can appear in sequent premises and conclusions.
/// Geometric logic restricts formulas to a specific shape suitable for
/// database-like reasoning.
#[derive(Clone, Debug)]
pub enum Formula {
    /// Relation application: `R(t)` where R is a relation and t is a term.
    /// The term can be a record for multi-argument relations.
    Rel(RelId, Term),

    /// Truth: the trivially true proposition.
    True,

    /// Falsity: the trivially false proposition.
    False,

    /// Conjunction: `phi_1 /\ phi_2 /\ ... /\ phi_n`
    /// N-ary for convenience; empty conjunction is True.
    Conj(Vec<Formula>),

    /// Disjunction: `phi_1 \/ phi_2 \/ ... \/ phi_n`
    /// N-ary for convenience; empty disjunction is False.
    Disj(Vec<Formula>),

    /// Equality: `t1 = t2`
    /// Both terms must have the same sort.
    Eq(Term, Term),

    /// Less than: `t1 < t2` (for Int comparison)
    Lt(Term, Term),

    /// Less than or equal: `t1 <= t2` (for Int comparison)
    Le(Term, Term),

    /// Greater than: `t1 > t2` (for Int comparison)
    Gt(Term, Term),

    /// Greater than or equal: `t1 >= t2` (for Int comparison)
    Ge(Term, Term),

    /// Existential quantification: `exists (x : S). phi`
    Exists(String, DerivedSort, Box<Formula>),
}

impl Formula {
    /// Create a conjunction, flattening nested conjunctions.
    pub fn conj(formulas: Vec<Formula>) -> Self {
        let mut flat = Vec::new();
        for f in formulas {
            match f {
                Formula::True => {} // Skip True in conjunctions
                Formula::Conj(inner) => flat.extend(inner),
                other => flat.push(other),
            }
        }
        match flat.len() {
            0 => Formula::True,
            1 => flat.pop().unwrap(),
            _ => Formula::Conj(flat),
        }
    }

    /// Create a disjunction, flattening nested disjunctions.
    pub fn disj(formulas: Vec<Formula>) -> Self {
        let mut flat = Vec::new();
        for f in formulas {
            match f {
                Formula::False => {} // Skip False in disjunctions
                Formula::Disj(inner) => flat.extend(inner),
                other => flat.push(other),
            }
        }
        match flat.len() {
            0 => Formula::False,
            1 => flat.pop().unwrap(),
            _ => Formula::Disj(flat),
        }
    }

    /// Create a relation application
    pub fn rel(rel_id: RelId, arg: Term) -> Self {
        Formula::Rel(rel_id, arg)
    }

    /// Create an equality formula
    pub fn eq(lhs: Term, rhs: Term) -> Self {
        Formula::Eq(lhs, rhs)
    }

    /// Create an existential formula
    pub fn exists(var: impl Into<String>, sort: DerivedSort, body: Formula) -> Self {
        Formula::Exists(var.into(), sort, Box::new(body))
    }

    /// Binary conjunction helper
    pub fn and(self, other: Formula) -> Formula {
        Formula::conj(vec![self, other])
    }

    /// Binary disjunction helper
    pub fn or(self, other: Formula) -> Formula {
        Formula::disj(vec![self, other])
    }
}

// ============ Context ============

/// How a variable was bound in the context
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BindingKind {
    /// Explicitly quantified (from `forall x : T`)
    Explicit,
    /// Implicitly bound from a pattern position (Int/Str only)
    Implicit,
}

/// A typing context: a list of (variable_name, sort, binding_kind) tuples.
///
/// Variables are looked up by name, with later bindings shadowing earlier ones.
#[derive(Clone, Debug, Default)]
pub struct Context {
    /// Variables in scope, with their sorts and how they were bound
    pub vars: Vec<(String, DerivedSort, BindingKind)>,
}

impl Context {
    /// Create an empty context
    pub fn new() -> Self {
        Self::default()
    }

    /// Extend the context with a new explicit variable binding (from forall)
    pub fn extend(&self, name: impl Into<String>, sort: DerivedSort) -> Self {
        let mut new_ctx = self.clone();
        new_ctx
            .vars
            .push((name.into(), sort, BindingKind::Explicit));
        new_ctx
    }

    /// Extend the context with a new implicit variable binding (from pattern)
    pub fn extend_implicit(&mut self, name: impl Into<String>, sort: DerivedSort) {
        self.vars.push((name.into(), sort, BindingKind::Implicit));
    }

    /// Look up a variable by name, returning its index and sort.
    /// Returns the most recent binding (for shadowing).
    pub fn lookup(&self, name: &str) -> Option<(usize, &DerivedSort)> {
        self.vars
            .iter()
            .enumerate()
            .rev()
            .find(|(_, (n, _, _))| n == name)
            .map(|(i, (_, s, _))| (i, s))
    }

    /// Look up a variable by name, returning its index, sort, and binding kind.
    pub fn lookup_full(&self, name: &str) -> Option<(usize, &DerivedSort, BindingKind)> {
        self.vars
            .iter()
            .enumerate()
            .rev()
            .find(|(_, (n, _, _))| n == name)
            .map(|(i, (_, s, k))| (i, s, *k))
    }

    /// Check if a variable is in scope
    pub fn contains(&self, name: &str) -> bool {
        self.vars.iter().any(|(n, _, _)| n == name)
    }

    /// Get the number of variables in the context
    pub fn len(&self) -> usize {
        self.vars.len()
    }

    /// Check if the context is empty
    pub fn is_empty(&self) -> bool {
        self.vars.is_empty()
    }

    /// Get all implicitly bound variables
    pub fn implicit_vars(&self) -> impl Iterator<Item = (&String, &DerivedSort)> {
        self.vars
            .iter()
            .filter(|(_, _, k)| *k == BindingKind::Implicit)
            .map(|(n, s, _)| (n, s))
    }

    /// Get all explicitly bound variables
    pub fn explicit_vars(&self) -> impl Iterator<Item = (&String, &DerivedSort)> {
        self.vars
            .iter()
            .filter(|(_, _, k)| *k == BindingKind::Explicit)
            .map(|(n, s, _)| (n, s))
    }
}

// ============ Sequent ============

/// A sequent: `context |- premise => conclusion`
///
/// Represents an axiom in the theory. When the premise holds in some
/// substitution of the context variables, the conclusion must also hold.
#[derive(Clone, Debug)]
pub struct Sequent {
    /// Name of this axiom (for error messages)
    pub name: String,
    /// The context: universally quantified variables
    pub context: Context,
    /// The premise (antecedent): when this holds...
    pub premise: Formula,
    /// The conclusion (consequent): ...this must also hold
    pub conclusion: Formula,
}

impl Sequent {
    /// Create a new sequent
    pub fn new(
        name: impl Into<String>,
        context: Context,
        premise: Formula,
        conclusion: Formula,
    ) -> Self {
        Self {
            name: name.into(),
            context,
            premise,
            conclusion,
        }
    }

    /// Create a sequent with an empty context
    pub fn simple(name: impl Into<String>, premise: Formula, conclusion: Formula) -> Self {
        Self::new(name, Context::new(), premise, conclusion)
    }
}

// ============ Theory ============

/// A theory: a signature plus a set of axioms (sequents).
///
/// A theory defines a vocabulary (sorts, functions, relations) and
/// constraints (axioms) that any model must satisfy.
#[derive(Clone, Debug)]
pub struct Theory {
    /// Name of the theory (e.g., "PetriNet", "Graph")
    pub name: String,
    /// The signature: sorts, functions, relations, instance fields
    pub signature: Signature,
    /// The axioms as sequents
    pub axioms: Vec<Sequent>,
}

impl Theory {
    /// Create a new theory with the given name
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            signature: Signature::new(),
            axioms: Vec::new(),
        }
    }

    /// Add an axiom to the theory
    pub fn add_axiom(&mut self, sequent: Sequent) {
        self.axioms.push(sequent);
    }

    /// Get the number of axioms
    pub fn num_axioms(&self) -> usize {
        self.axioms.len()
    }
}

// ============ Theory Parameters ============

/// A theory parameter: either a sort or an instance of another theory.
///
/// Parameters allow theories to be generic. For example:
/// ```text
/// theory (N : PetriNet instance) Marking { ... }
/// ```
/// Here `N` is an instance parameter of type `PetriNet`.
#[derive(Clone, Debug)]
pub struct TheoryParam {
    /// Name of the parameter (e.g., "N")
    pub name: String,
    /// The theory this parameter must be an instance of.
    /// "Sort" is a special value meaning the parameter is a sort, not an instance.
    pub theory_name: String,
}

impl TheoryParam {
    /// Create a sort parameter
    pub fn sort(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            theory_name: "Sort".to_string(),
        }
    }

    /// Create an instance parameter
    pub fn instance(name: impl Into<String>, theory_name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            theory_name: theory_name.into(),
        }
    }

    /// Check if this is a sort parameter
    pub fn is_sort(&self) -> bool {
        self.theory_name == "Sort"
    }

    /// Check if this is an instance parameter
    pub fn is_instance(&self) -> bool {
        !self.is_sort()
    }
}

/// An elaborated theory: a theory with its parameters.
///
/// This is the result of elaborating a theory declaration.
/// It includes both the parameters and the fully-elaborated theory.
#[derive(Clone, Debug)]
pub struct ElaboratedTheory {
    /// Parameters of the theory
    pub params: Vec<TheoryParam>,
    /// The elaborated theory
    pub theory: Theory,
}

impl ElaboratedTheory {
    /// Create a non-parameterized elaborated theory
    pub fn simple(theory: Theory) -> Self {
        Self {
            params: Vec::new(),
            theory,
        }
    }

    /// Create a parameterized elaborated theory
    pub fn with_params(params: Vec<TheoryParam>, theory: Theory) -> Self {
        Self { params, theory }
    }

    /// Check if this theory has parameters
    pub fn is_parameterized(&self) -> bool {
        !self.params.is_empty()
    }

    /// Get the theory name
    pub fn name(&self) -> &str {
        &self.theory.name
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derived_sort_base() {
        let sort_id = SortId::new();
        let sort = DerivedSort::base(sort_id);
        assert!(sort.is_base());
        assert!(!sort.is_product());
        assert_eq!(sort.as_base(), Some(sort_id));
        assert_eq!(sort.arity(), 1);
    }

    #[test]
    fn test_derived_sort_product() {
        let id0 = SortId::new();
        let id1 = SortId::new();
        let sort = DerivedSort::product(vec![
            ("x".to_string(), DerivedSort::base(id0)),
            ("y".to_string(), DerivedSort::base(id1)),
        ]);
        assert!(!sort.is_base());
        assert!(sort.is_product());
        assert_eq!(sort.arity(), 2);
        assert!(sort.get_field("x").is_some());
        assert!(sort.get_field("z").is_none());
    }

    #[test]
    fn test_derived_sort_unit() {
        let sort = DerivedSort::unit();
        assert!(sort.is_product());
        assert_eq!(sort.arity(), 0);
    }

    #[test]
    fn test_signature_sorts() {
        let mut sig = Signature::new();
        let v = sig.add_sort("V".to_string());
        let e = sig.add_sort("E".to_string());

        assert_ne!(v, e);
        assert_eq!(sig.lookup_sort("V"), Some(v));
        assert_eq!(sig.lookup_sort("E"), Some(e));
        assert_eq!(sig.lookup_sort("X"), None);
        assert_eq!(sig.sort_name(v), Some("V"));
    }

    #[test]
    fn test_signature_functions() {
        let mut sig = Signature::new();
        let v = sig.add_sort("V".to_string());
        let e = sig.add_sort("E".to_string());

        let src = sig.add_function(
            "src".to_string(),
            DerivedSort::base(e),
            DerivedSort::base(v),
        );

        assert_eq!(sig.lookup_func("src"), Some(src));
        let func = sig.function(src).unwrap();
        assert_eq!(func.name, "src");
    }

    #[test]
    fn test_signature_relations() {
        let mut sig = Signature::new();
        let v = sig.add_sort("V".to_string());

        let adj = sig.add_relation(
            "adj".to_string(),
            DerivedSort::product(vec![
                ("src".to_string(), DerivedSort::base(v)),
                ("tgt".to_string(), DerivedSort::base(v)),
            ]),
        );

        assert_eq!(sig.lookup_rel("adj"), Some(adj));
    }

    #[test]
    fn test_context() {
        let id0 = SortId::new();
        let id1 = SortId::new();
        let ctx = Context::new();
        let ctx = ctx.extend("x", DerivedSort::base(id0));
        let ctx = ctx.extend("y", DerivedSort::base(id1));

        assert_eq!(ctx.len(), 2);
        assert!(ctx.contains("x"));
        assert!(ctx.contains("y"));
        assert!(!ctx.contains("z"));

        let (idx, sort) = ctx.lookup("x").unwrap();
        assert_eq!(idx, 0);
        assert_eq!(*sort, DerivedSort::base(id0));
    }

    #[test]
    fn test_context_shadowing() {
        let id0 = SortId::new();
        let id1 = SortId::new();
        let ctx = Context::new();
        let ctx = ctx.extend("x", DerivedSort::base(id0));
        let ctx = ctx.extend("x", DerivedSort::base(id1)); // Shadow

        let (idx, sort) = ctx.lookup("x").unwrap();
        assert_eq!(idx, 1); // Most recent
        assert_eq!(*sort, DerivedSort::base(id1));
    }

    #[test]
    fn test_formula_conj_flattening() {
        let rel_id = RelId::new();
        let sort_id = SortId::new();
        let f1 = Formula::True;
        let f2 = Formula::rel(rel_id, Term::var("x", DerivedSort::base(sort_id)));
        let f3 = Formula::rel(rel_id, Term::var("y", DerivedSort::base(sort_id)));

        let conj = Formula::conj(vec![f1, f2.clone(), f3.clone()]);

        // True should be eliminated, result should be Conj([f2, f3])
        match conj {
            Formula::Conj(fs) => assert_eq!(fs.len(), 2),
            _ => panic!("expected Conj"),
        }
    }

    #[test]
    fn test_formula_conj_singleton() {
        let rel_id = RelId::new();
        let sort_id = SortId::new();
        let f = Formula::rel(rel_id, Term::var("x", DerivedSort::base(sort_id)));
        let conj = Formula::conj(vec![f.clone()]);

        // Single element should not wrap in Conj
        match conj {
            Formula::Rel(_, _) => {}
            _ => panic!("expected Rel, not Conj"),
        }
    }

    #[test]
    fn test_formula_conj_empty() {
        let conj = Formula::conj(vec![]);
        assert!(matches!(conj, Formula::True));
    }

    #[test]
    fn test_theory_param() {
        let sort_param = TheoryParam::sort("T");
        assert!(sort_param.is_sort());
        assert!(!sort_param.is_instance());

        let inst_param = TheoryParam::instance("N", "PetriNet");
        assert!(!inst_param.is_sort());
        assert!(inst_param.is_instance());
    }

    #[test]
    fn test_term_sort() {
        let mut sig = Signature::new();
        let v = sig.add_sort("V".to_string());
        let e = sig.add_sort("E".to_string());
        let src = sig.add_function(
            "src".to_string(),
            DerivedSort::base(e),
            DerivedSort::base(v),
        );

        // Variable term
        let var_term = Term::var("edge", DerivedSort::base(e));
        assert_eq!(var_term.sort(&sig), DerivedSort::base(e));

        // Function application
        let app_term = Term::app(src, var_term);
        assert_eq!(app_term.sort(&sig), DerivedSort::base(v));
    }

    #[test]
    fn test_record_and_project() {
        let sig = Signature::new();
        let id0 = SortId::new();
        let id1 = SortId::new();

        let record = Term::record(vec![
            ("x".to_string(), Term::var("a", DerivedSort::base(id0))),
            ("y".to_string(), Term::var("b", DerivedSort::base(id1))),
        ]);

        let sort = record.sort(&sig);
        assert!(sort.is_product());

        let proj = Term::project(record, "x");
        assert_eq!(proj.sort(&sig), DerivedSort::base(id0));
    }
}
