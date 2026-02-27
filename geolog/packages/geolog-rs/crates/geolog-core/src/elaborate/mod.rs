//! Elaboration: surface syntax -> typed core representation
//!
//! This module transforms the untyped AST into the typed core representation,
//! performing name resolution and type checking along the way.
//!
//! The main entry points are:
//! - `elaborate_type`: Convert a TypeExpr to a DerivedSort
//! - `elaborate_term`: Convert an AstTerm to a core Term (inference mode)
//! - `elaborate_formula`: Convert an AstFormula to a core Formula
//! - `elaborate_theory`: Elaborate a TheoryDecl to an ElaboratedTheory
//!
//! ## Bidirectional Type Checking
//!
//! This module uses bidirectional type checking to support implicit binding of
//! Int/Str variables in relation patterns. The key functions are:
//! - `infer_term`: Synthesize the type of a term
//! - `check_term`: Check a term against an expected type (can bind new Int/Str vars)
//! - `elaborate_formula_mut`: Elaborate a formula with mutable context for implicit bindings

mod env;
mod error;
mod theory;
pub mod types;

// Re-export main types and functions
pub use env::{
    check_term, elaborate_formula, elaborate_formula_mut, elaborate_term, elaborate_type,
    infer_term, Env,
};
pub use error::{CounterExample, ElabError, ElabResult};
pub use theory::{
    build_param_subst, collect_type_args, collect_type_args_from_theory_type, elaborate_theory,
    remap_sort_for_param_import,
};
pub use types::{eval_type_expr, TypeValue};
