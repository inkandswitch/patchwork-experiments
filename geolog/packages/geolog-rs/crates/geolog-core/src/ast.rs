//! Abstract Syntax Tree for Geolog
//!
//! Based on the geolog-zeta syntax with `{ }` blocks, record types,
//! postfix function application, and geometric logic formulas.

use std::fmt;

use crate::span::Span;

/// A node with source location information
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spanned<T> {
    pub node: T,
    pub span: Span,
}

impl<T> Spanned<T> {
    pub fn new(node: T, span: Span) -> Self {
        Self { node, span }
    }

    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Spanned<U> {
        Spanned {
            node: f(self.node),
            span: self.span,
        }
    }

    pub fn dummy(node: T) -> Self {
        Self {
            node,
            span: Span { start: 0, end: 0 },
        }
    }
}

// ============================================================================
// Path
// ============================================================================

/// A path identifier, possibly qualified with `/` (e.g., `N/P`, `W/src/arc`)
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Path {
    pub segments: Vec<String>,
}

impl Path {
    /// Create a path with a single segment
    pub fn single(name: impl Into<String>) -> Self {
        Self {
            segments: vec![name.into()],
        }
    }

    /// Create a path from multiple segments
    pub fn from_segments(segments: Vec<String>) -> Self {
        Self { segments }
    }

    /// Check if this is a single-segment path
    pub fn is_single(&self) -> bool {
        self.segments.len() == 1
    }

    /// Get the single segment if this is a single-segment path
    pub fn as_single(&self) -> Option<&str> {
        if self.segments.len() == 1 {
            Some(&self.segments[0])
        } else {
            None
        }
    }

    /// Get the first segment
    pub fn first(&self) -> Option<&str> {
        self.segments.first().map(|s| s.as_str())
    }

    /// Get the last segment
    pub fn last(&self) -> Option<&str> {
        self.segments.last().map(|s| s.as_str())
    }
}

impl fmt::Display for Path {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.segments.join("/"))
    }
}

// ============================================================================
// Source File and Declarations
// ============================================================================

/// A complete source file
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub declarations: Vec<Spanned<Declaration>>,
}

/// Top-level declarations
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Declaration {
    /// `namespace Foo;`
    Namespace(String),

    /// `theory (params) Name { body }`
    Theory(TheoryDecl),

    /// `instance Name : TypeExpr = { body }`
    Instance(InstanceDecl),

    /// `query Name { ? : Type; }`
    Query(QueryDecl),
}

// ============================================================================
// Theory Declarations
// ============================================================================

/// A theory declaration
/// e.g., `theory (N : PetriNet instance) Marking { ... }`
/// or `theory Foo extends Bar { ... }`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TheoryDecl {
    pub params: Vec<Param>,
    pub name: String,
    /// Optional parent theory to extend
    pub extends: Option<Path>,
    pub body: Vec<Spanned<TheoryItem>>,
}

/// A parameter to a theory
/// e.g., `N : PetriNet instance`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Param {
    pub name: String,
    pub ty: TypeExpr,
}

/// Items that can appear in a theory body
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TheoryItem {
    /// `P : Sort;`
    Sort(String),

    /// `in/src : In -> P;`
    Function(FunctionDecl),

    /// `ax1 : forall w : W. hyps |- concl;`
    Axiom(AxiomDecl),

    /// Inline instance field declaration
    /// `initial_marking : N Marking instance;`
    Field(String, TypeExpr),
}

/// A function/morphism declaration
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FunctionDecl {
    pub name: Path, // Can be dotted like `in/src`
    pub domain: TypeExpr,
    pub codomain: TypeExpr,
}

/// An axiom declaration
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AxiomDecl {
    pub name: Path, // Can be hierarchical like `ax/anc/base`
    pub quantified: Vec<QuantifiedVar>,
    pub hypotheses: Vec<Formula>,
    pub conclusion: Formula,
}

/// A quantified variable in an axiom
/// e.g., `w : W` or `w1, w2 : W`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuantifiedVar {
    pub names: Vec<String>,
    pub ty: TypeExpr,
}

// ============================================================================
// Type Expressions (Concatenative Style)
// ============================================================================

/// A single token in a type expression stack program (concatenative parsing)
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypeToken {
    /// Push a path onto the stack (might be sort, instance ref, or theory name)
    Path(Path),

    /// The `Sort` keyword - pushes the Sort kind
    Sort,

    /// The `Prop` keyword - pushes the Prop kind
    Prop,

    /// The `Int` keyword - pushes the Int primitive type
    Int,

    /// The `Str` keyword - pushes the Str primitive type
    Str,

    /// The `instance` keyword - pops top, wraps as instance type, pushes
    Instance,

    /// Arrow - pops two types (domain, codomain), pushes function type
    Arrow,

    /// Record type literal: `[field : Type, ...]`
    Record(Vec<(String, TypeExpr)>),
}

/// A type expression as a flat stack program (concatenative style)
///
/// Instead of a tree like `App(App(A, B), C)`, we store a flat sequence
/// `[Path(A), Path(B), Path(C)]` that gets evaluated during elaboration
/// when we have access to the symbol table (to know theory arities).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TypeExpr {
    pub tokens: Vec<TypeToken>,
}

impl TypeExpr {
    /// Create a type expression from a single path
    pub fn single_path(p: Path) -> Self {
        Self {
            tokens: vec![TypeToken::Path(p)],
        }
    }

    /// Create the Sort kind
    pub fn sort() -> Self {
        Self {
            tokens: vec![TypeToken::Sort],
        }
    }

    /// Create the Prop kind
    pub fn prop() -> Self {
        Self {
            tokens: vec![TypeToken::Prop],
        }
    }

    /// Create the Int primitive type
    pub fn int() -> Self {
        Self {
            tokens: vec![TypeToken::Int],
        }
    }

    /// Create the Str primitive type
    pub fn str() -> Self {
        Self {
            tokens: vec![TypeToken::Str],
        }
    }

    /// Create an empty type expression
    pub fn empty() -> Self {
        Self { tokens: vec![] }
    }

    /// Push a token onto the expression
    pub fn push(&mut self, token: TypeToken) {
        self.tokens.push(token);
    }

    /// Check if this is a single path (common case)
    pub fn as_single_path(&self) -> Option<&Path> {
        if self.tokens.len() == 1 {
            if let TypeToken::Path(p) = &self.tokens[0] {
                return Some(p);
            }
        }
        None
    }

    /// Check if this is the Sort kind
    pub fn is_sort(&self) -> bool {
        matches!(self.tokens.as_slice(), [TypeToken::Sort])
    }

    /// Check if this ends with `instance`
    pub fn is_instance(&self) -> bool {
        self.tokens.last() == Some(&TypeToken::Instance)
    }

    /// Get the inner type expression (without the trailing `instance` token)
    pub fn instance_inner(&self) -> Option<Self> {
        if self.is_instance() {
            Some(Self {
                tokens: self.tokens[..self.tokens.len() - 1].to_vec(),
            })
        } else {
            None
        }
    }

    /// Check if this is the Prop kind
    pub fn is_prop(&self) -> bool {
        matches!(self.tokens.as_slice(), [TypeToken::Prop])
    }

    /// Check if this is the Int primitive type
    pub fn is_int(&self) -> bool {
        matches!(self.tokens.as_slice(), [TypeToken::Int])
    }

    /// Check if this is the Str primitive type
    pub fn is_str(&self) -> bool {
        matches!(self.tokens.as_slice(), [TypeToken::Str])
    }

    /// Check if this is a record type
    pub fn as_record(&self) -> Option<&Vec<(String, TypeExpr)>> {
        if self.tokens.len() == 1 {
            if let TypeToken::Record(fields) = &self.tokens[0] {
                return Some(fields);
            }
        }
        None
    }
}

// ============================================================================
// Terms
// ============================================================================

/// Terms (elements of types)
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Term {
    /// A variable or path: `w`, `W/src/arc`
    Path(Path),

    /// Function application (postfix style in surface syntax)
    /// `w W/src` means "apply W/src to w"
    App(Box<Term>, Box<Term>),

    /// Field projection: `expr .field`
    Project(Box<Term>, String),

    /// Record literal: `[firing: f, arc: arc]`
    Record(Vec<(String, Term)>),
}

impl Term {
    /// Create a term from a path
    pub fn path(p: Path) -> Self {
        Term::Path(p)
    }

    /// Create a term from a simple name
    pub fn name(s: impl Into<String>) -> Self {
        Term::Path(Path::single(s))
    }

    /// Create an application term
    pub fn app(base: Term, func: Term) -> Self {
        Term::App(Box::new(base), Box::new(func))
    }

    /// Create a projection term
    pub fn project(term: Term, field: impl Into<String>) -> Self {
        Term::Project(Box::new(term), field.into())
    }

    /// Create a record term
    pub fn record(fields: Vec<(String, Term)>) -> Self {
        Term::Record(fields)
    }
}

// ============================================================================
// Formulas (Geometric Logic)
// ============================================================================

/// Formulas (geometric logic)
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Formula {
    /// False/Bottom (⊥): inconsistency, empty disjunction
    False,

    /// Truth (⊤): always true
    True,

    /// Relation application: `rel(term)` or `term rel`
    RelApp(String, Term),

    /// Equality: `t1 = t2`
    Eq(Term, Term),

    /// Less than: `t1 < t2` (for Int comparison)
    Lt(Term, Term),

    /// Less than or equal: `t1 <= t2` (for Int comparison)
    Le(Term, Term),

    /// Greater than: `t1 > t2` (for Int comparison)
    Gt(Term, Term),

    /// Greater than or equal: `t1 >= t2` (for Int comparison)
    Ge(Term, Term),

    /// Conjunction: `phi /\ psi`
    And(Vec<Formula>),

    /// Disjunction: `phi \/ psi`
    Or(Vec<Formula>),

    /// Existential: `exists w : W. phi`
    Exists(Vec<QuantifiedVar>, Box<Formula>),
}

impl Formula {
    /// Create a relation application
    pub fn rel(name: impl Into<String>, arg: Term) -> Self {
        Formula::RelApp(name.into(), arg)
    }

    /// Create an equality formula
    pub fn eq(lhs: Term, rhs: Term) -> Self {
        Formula::Eq(lhs, rhs)
    }

    /// Create a conjunction, flattening if needed
    pub fn and(formulas: Vec<Formula>) -> Self {
        match formulas.len() {
            0 => Formula::True,
            1 => formulas.into_iter().next().unwrap(),
            _ => Formula::And(formulas),
        }
    }

    /// Create a disjunction, flattening if needed
    pub fn or(formulas: Vec<Formula>) -> Self {
        match formulas.len() {
            0 => Formula::False,
            1 => formulas.into_iter().next().unwrap(),
            _ => Formula::Or(formulas),
        }
    }

    /// Create an existential
    pub fn exists(vars: Vec<QuantifiedVar>, body: Formula) -> Self {
        Formula::Exists(vars, Box::new(body))
    }
}

// ============================================================================
// Instance Declarations
// ============================================================================

/// An instance declaration
/// e.g., `instance ExampleNet : PetriNet = { ... }`
/// or `instance ExampleNet : PetriNet = chase { ... }` for chase-before-check
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstanceDecl {
    pub theory: TypeExpr,
    pub name: String,
    pub body: Vec<Spanned<InstanceItem>>,
    /// If true, run chase algorithm after elaboration before checking axioms.
    pub needs_chase: bool,
}

/// Items in an instance body
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstanceItem {
    /// Element declaration: `A : P;` or `a, b, c : P;`
    Element(Vec<String>, TypeExpr),

    /// Equation: `ab_in in/src = A;`
    Equation(Term, Term),

    /// Nested instance: `initial_marking = { ... };`
    NestedInstance(String, InstanceDecl),

    /// Relation assertion: `[item: buy_groceries] completed;`
    RelationAssertion(Term, String),
}

// ============================================================================
// Query Declarations
// ============================================================================

/// A query declaration
/// e.g., `query query0 { ? : ExampleNet Problem0 ReachabilityProblemSolution; }`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueryDecl {
    pub name: String,
    pub goal: TypeExpr,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_single() {
        let p = Path::single("V");
        assert!(p.is_single());
        assert_eq!(p.as_single(), Some("V"));
        assert_eq!(p.to_string(), "V");
    }

    #[test]
    fn test_path_qualified() {
        let p = Path::from_segments(vec!["N".to_string(), "P".to_string()]);
        assert!(!p.is_single());
        assert_eq!(p.first(), Some("N"));
        assert_eq!(p.last(), Some("P"));
        assert_eq!(p.to_string(), "N/P");
    }

    #[test]
    fn test_type_expr_single_path() {
        let te = TypeExpr::single_path(Path::single("V"));
        assert!(te.as_single_path().is_some());
        assert!(!te.is_sort());
        assert!(!te.is_prop());
    }

    #[test]
    fn test_type_expr_sort() {
        let te = TypeExpr::sort();
        assert!(te.is_sort());
        assert!(!te.is_prop());
    }

    #[test]
    fn test_type_expr_instance() {
        let mut te = TypeExpr::single_path(Path::single("Graph"));
        te.push(TypeToken::Instance);
        assert!(te.is_instance());

        let inner = te.instance_inner().unwrap();
        assert!(inner.as_single_path().is_some());
    }

    #[test]
    fn test_term_construction() {
        let term = Term::app(Term::name("x"), Term::name("f"));
        match term {
            Term::App(_, _) => {}
            _ => panic!("expected App"),
        }
    }

    #[test]
    fn test_formula_and_simplification() {
        // Empty conjunction -> True
        let f = Formula::and(vec![]);
        assert!(matches!(f, Formula::True));

        // Single element -> unwrapped
        let f = Formula::and(vec![Formula::True]);
        assert!(matches!(f, Formula::True));

        // Multiple elements -> And
        let f = Formula::and(vec![Formula::True, Formula::False]);
        assert!(matches!(f, Formula::And(_)));
    }

    #[test]
    fn test_spanned() {
        let span = Span { start: 0, end: 5 };
        let spanned = Spanned::new("hello", span);
        assert_eq!(spanned.node, "hello");
        assert_eq!(spanned.span, span);

        let mapped = spanned.map(|s| s.len());
        assert_eq!(mapped.node, 5);
        assert_eq!(mapped.span, span);
    }
}
