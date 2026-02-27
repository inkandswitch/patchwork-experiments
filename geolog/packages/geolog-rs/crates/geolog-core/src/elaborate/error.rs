//! Elaboration error types.

use crate::core::DerivedSort;
use std::fmt;

/// A concrete counterexample showing which variable bindings violate an axiom.
#[derive(Clone, Debug)]
pub struct CounterExample {
    /// (variable_name, element_name) pairs showing the violating assignment
    pub bindings: Vec<(String, String)>,
}

impl fmt::Display for CounterExample {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let parts: Vec<String> = self
            .bindings
            .iter()
            .map(|(var, elem)| format!("{} = {}", var, elem))
            .collect();
        write!(f, "{{{}}}", parts.join(", "))
    }
}

/// Elaboration errors
#[derive(Clone, Debug)]
pub enum ElabError {
    /// Unknown sort name
    UnknownSort(String),

    /// Unknown theory name
    UnknownTheory(String),

    /// Unknown function name
    UnknownFunction(String),

    /// Unknown relation name
    UnknownRel(String),

    /// Unknown variable name
    UnknownVariable(String),

    /// Unknown field in a record type
    UnknownField { field: String, sort: DerivedSort },

    /// Missing field in a record literal
    MissingField { field: String, sort: DerivedSort },

    /// Type mismatch between expected and actual types
    TypeMismatch {
        expected: DerivedSort,
        got: DerivedSort,
    },

    /// Value is not a sort (e.g., trying to use Prop as a sort)
    NotASort(String),

    /// Value is not a function
    NotAFunction(String),

    /// Value is not a record type
    NotARecord(String),

    /// No such field in record type
    NoSuchField { record: String, field: String },

    /// Invalid path expression
    InvalidPath(String),

    /// Duplicate definition
    DuplicateDefinition(String),

    /// Unsupported language feature
    UnsupportedFeature(String),

    /// Partial function (not all domain elements have values)
    PartialFunction {
        func_name: String,
        missing_elements: Vec<String>,
    },

    /// Domain type mismatch in function application
    DomainMismatch {
        func_name: String,
        element_name: String,
        expected_sort: String,
        actual_sort: String,
    },

    /// Codomain type mismatch in equation
    CodomainMismatch {
        func_name: String,
        element_name: String,
        expected_sort: String,
        actual_sort: String,
    },

    /// Axiom violation during instance checking
    AxiomViolation {
        axiom_index: usize,
        axiom_name: Option<String>,
        num_violations: usize,
        counterexamples: Vec<CounterExample>,
    },

    /// Not enough arguments for a parameterized theory
    NotEnoughArgs {
        name: String,
        expected: usize,
        got: usize,
    },

    /// Type expression evaluation error
    TypeExprError(String),
}

impl fmt::Display for ElabError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ElabError::UnknownSort(s) => write!(f, "unknown sort: {}", s),
            ElabError::UnknownTheory(s) => write!(f, "unknown theory: {}", s),
            ElabError::UnknownFunction(s) => write!(f, "unknown function: {}", s),
            ElabError::UnknownRel(s) => write!(f, "unknown relation: {}", s),
            ElabError::UnknownVariable(s) => write!(f, "unknown variable: {}", s),
            ElabError::UnknownField { field, sort } => {
                write!(f, "unknown field '{}' in type {:?}", field, sort)
            }
            ElabError::MissingField { field, sort } => {
                write!(f, "missing field '{}' for type {:?}", field, sort)
            }
            ElabError::TypeMismatch { expected, got } => {
                write!(f, "type mismatch: expected {:?}, got {:?}", expected, got)
            }
            ElabError::NotASort(s) => write!(f, "not a sort: {}", s),
            ElabError::NotAFunction(s) => write!(f, "not a function: {}", s),
            ElabError::NotARecord(s) => write!(f, "not a record type: {}", s),
            ElabError::NoSuchField { record, field } => {
                write!(f, "no field '{}' in record {}", field, record)
            }
            ElabError::InvalidPath(s) => write!(f, "invalid path: {}", s),
            ElabError::DuplicateDefinition(s) => write!(f, "duplicate definition: {}", s),
            ElabError::UnsupportedFeature(s) => write!(f, "unsupported feature: {}", s),
            ElabError::PartialFunction {
                func_name,
                missing_elements,
            } => {
                write!(
                    f,
                    "partial function '{}': missing definitions for {:?}",
                    func_name, missing_elements
                )
            }
            ElabError::DomainMismatch {
                func_name,
                element_name,
                expected_sort,
                actual_sort,
            } => {
                write!(
                    f,
                    "type error: '{}' has sort '{}', but function '{}' expects domain sort '{}'",
                    element_name, actual_sort, func_name, expected_sort
                )
            }
            ElabError::CodomainMismatch {
                func_name,
                element_name,
                expected_sort,
                actual_sort,
            } => {
                write!(
                    f,
                    "type error: '{}' has sort '{}', but function '{}' has codomain sort '{}'",
                    element_name, actual_sort, func_name, expected_sort
                )
            }
            ElabError::AxiomViolation {
                axiom_index,
                axiom_name,
                num_violations,
                counterexamples,
            } => {
                let axiom_desc = if let Some(name) = axiom_name {
                    format!("axiom '{}' (#{}) violated", name, axiom_index)
                } else {
                    format!("axiom #{} violated", axiom_index)
                };

                if counterexamples.is_empty() {
                    write!(
                        f,
                        "{}: {} counterexample(s) found",
                        axiom_desc, num_violations
                    )
                } else {
                    writeln!(
                        f,
                        "{}: {} counterexample(s) found",
                        axiom_desc, num_violations
                    )?;
                    for (i, ce) in counterexamples.iter().enumerate() {
                        writeln!(f, "  #{}: {}", i + 1, ce)?;
                    }
                    if *num_violations > counterexamples.len() {
                        write!(
                            f,
                            "  ... and {} more",
                            num_violations - counterexamples.len()
                        )?;
                    }
                    Ok(())
                }
            }
            ElabError::NotEnoughArgs {
                name,
                expected,
                got,
            } => {
                write!(
                    f,
                    "'{}' expects {} argument(s), but only {} provided",
                    name, expected, got
                )
            }
            ElabError::TypeExprError(msg) => write!(f, "type expression error: {}", msg),
        }
    }
}

impl std::error::Error for ElabError {}

/// Result type for elaboration
pub type ElabResult<T> = Result<T, ElabError>;
