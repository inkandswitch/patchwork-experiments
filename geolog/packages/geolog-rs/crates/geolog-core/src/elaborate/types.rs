//! Type expression evaluation (concatenative stack-based)
//!
//! Evaluates flat TypeExpr token sequences into resolved types,
//! using the symbol table to determine theory arities.

use crate::ast::{Path, TypeExpr, TypeToken};
use crate::core::DerivedSort;
use crate::elaborate::error::{ElabError, ElabResult};
use crate::elaborate::Env;

/// A value on the type evaluation stack
#[derive(Clone, Debug)]
pub enum TypeValue {
    /// The Sort kind (for parameter declarations like `X : Sort`)
    SortKind,

    /// The Prop kind (for relation codomains)
    PropKind,

    /// The Int primitive type
    IntType,

    /// The Str primitive type
    StrType,

    /// A resolved base sort (index into signature)
    Sort(DerivedSort),

    /// An unresolved path (instance ref, sort path, or theory name)
    /// Will be resolved based on context
    Path(Path),

    /// A theory applied to arguments
    AppliedTheory {
        theory_name: String,
        args: Vec<TypeValue>,
    },

    /// Instance type: wraps another type value
    Instance(Box<TypeValue>),

    /// Function/arrow type
    Arrow {
        domain: Box<TypeValue>,
        codomain: Box<TypeValue>,
    },

    /// Record/product type
    Record(Vec<(String, TypeValue)>),
}

impl TypeValue {
    /// Try to convert this type value to a DerivedSort
    pub fn as_derived_sort(&self, env: &Env) -> ElabResult<DerivedSort> {
        match self {
            TypeValue::Sort(s) => Ok(s.clone()),

            TypeValue::IntType => Ok(DerivedSort::Int),

            TypeValue::StrType => Ok(DerivedSort::Str),

            TypeValue::Path(path) => {
                // Try to resolve as a sort path
                env.resolve_sort_path(path)
            }

            TypeValue::Record(fields) => {
                let resolved: Result<Vec<_>, _> = fields
                    .iter()
                    .map(|(name, val)| val.as_derived_sort(env).map(|s| (name.clone(), s)))
                    .collect();
                Ok(DerivedSort::Product(resolved?))
            }

            TypeValue::SortKind => Err(ElabError::NotASort(
                "Sort is a kind, not a type".to_string(),
            )),

            TypeValue::PropKind => Err(ElabError::NotASort(
                "Prop is a kind, not a type".to_string(),
            )),

            TypeValue::AppliedTheory { theory_name, .. } => Err(ElabError::NotASort(format!(
                "applied theory '{}' is not a sort",
                theory_name
            ))),

            TypeValue::Instance(_) => Err(ElabError::NotASort(
                "instance type is not a sort".to_string(),
            )),

            TypeValue::Arrow { .. } => {
                Err(ElabError::NotASort("arrow type is not a sort".to_string()))
            }
        }
    }

    /// Check if this is the Sort kind
    pub fn is_sort_kind(&self) -> bool {
        matches!(self, TypeValue::SortKind)
    }

    /// Check if this is the Prop kind
    pub fn is_prop_kind(&self) -> bool {
        matches!(self, TypeValue::PropKind)
    }

    /// Check if this is an instance type
    pub fn is_instance(&self) -> bool {
        matches!(self, TypeValue::Instance(_))
    }

    /// Get the inner type if this is an instance type
    pub fn instance_inner(&self) -> Option<&TypeValue> {
        match self {
            TypeValue::Instance(inner) => Some(inner),
            _ => None,
        }
    }

    /// Get the theory name and args if this is an applied theory
    pub fn as_applied_theory(&self) -> Option<(&str, &[TypeValue])> {
        match self {
            TypeValue::AppliedTheory { theory_name, args } => Some((theory_name, args)),
            _ => None,
        }
    }
}

/// Evaluate a type expression using the environment
///
/// This is the core stack-based evaluator. It processes tokens left-to-right,
/// using the symbol table to determine theory arities.
pub fn eval_type_expr(expr: &TypeExpr, env: &Env) -> ElabResult<TypeValue> {
    let mut stack: Vec<TypeValue> = Vec::new();

    for token in &expr.tokens {
        match token {
            TypeToken::Sort => {
                stack.push(TypeValue::SortKind);
            }

            TypeToken::Prop => {
                stack.push(TypeValue::PropKind);
            }

            TypeToken::Int => {
                stack.push(TypeValue::IntType);
            }

            TypeToken::Str => {
                stack.push(TypeValue::StrType);
            }

            TypeToken::Path(path) => {
                // Check if this is a theory name with known arity
                let path_str = path.to_string();

                if let Some(theory) = env.theories.get(&path_str) {
                    let arity = theory.params.len();
                    if arity > 0 {
                        // Theory takes arguments - pop them from stack
                        if stack.len() < arity {
                            return Err(ElabError::NotEnoughArgs {
                                name: path_str,
                                expected: arity,
                                got: stack.len(),
                            });
                        }
                        let args = stack.split_off(stack.len() - arity);
                        stack.push(TypeValue::AppliedTheory {
                            theory_name: path_str,
                            args,
                        });
                    } else {
                        // Zero-arity theory
                        stack.push(TypeValue::AppliedTheory {
                            theory_name: path_str,
                            args: vec![],
                        });
                    }
                } else {
                    // Not a theory - could be a sort path or instance reference
                    // Push as unresolved path
                    stack.push(TypeValue::Path(path.clone()));
                }
            }

            TypeToken::Instance => {
                let top = stack.pop().ok_or_else(|| {
                    ElabError::TypeExprError("'instance' with empty stack".to_string())
                })?;
                stack.push(TypeValue::Instance(Box::new(top)));
            }

            TypeToken::Arrow => {
                // Pop codomain first (right-associative)
                let codomain = stack
                    .pop()
                    .ok_or_else(|| ElabError::TypeExprError("'->' missing codomain".to_string()))?;
                let domain = stack
                    .pop()
                    .ok_or_else(|| ElabError::TypeExprError("'->' missing domain".to_string()))?;
                stack.push(TypeValue::Arrow {
                    domain: Box::new(domain),
                    codomain: Box::new(codomain),
                });
            }

            TypeToken::Record(fields) => {
                // Evaluate each field's type expression recursively
                let mut resolved_fields = Vec::new();
                for (name, field_expr) in fields {
                    let field_val = eval_type_expr(field_expr, env)?;
                    resolved_fields.push((name.clone(), field_val));
                }
                stack.push(TypeValue::Record(resolved_fields));
            }
        }
    }

    // Stack should have exactly one element
    if stack.is_empty() {
        return Err(ElabError::TypeExprError(
            "empty type expression".to_string(),
        ));
    }
    if stack.len() > 1 {
        return Err(ElabError::TypeExprError(format!(
            "type expression left {} values on stack (expected 1)",
            stack.len()
        )));
    }

    Ok(stack.pop().unwrap())
}

/// Convenience: evaluate a type expression and convert to DerivedSort
pub fn eval_as_sort(expr: &TypeExpr, env: &Env) -> ElabResult<DerivedSort> {
    let val = eval_type_expr(expr, env)?;
    val.as_derived_sort(env)
}

/// Extract the theory name from a type expression (for simple cases)
///
/// This is used when we just need the theory name without full evaluation.
/// Returns None if the expression is more complex than a simple path or applied theory.
pub fn extract_theory_name(expr: &TypeExpr) -> Option<String> {
    // Look for the last path token that isn't followed by Instance
    let mut last_theory_candidate: Option<&Path> = None;

    for token in &expr.tokens {
        match token {
            TypeToken::Path(p) => {
                last_theory_candidate = Some(p);
            }
            TypeToken::Instance => {
                // The previous path was the theory name
                if let Some(p) = last_theory_candidate {
                    return Some(p.to_string());
                }
            }
            _ => {}
        }
    }

    // If no Instance token, the last path is the theory name
    last_theory_candidate.map(|p| p.to_string())
}

/// Check if a type expression represents the Sort kind
pub fn is_sort_kind(expr: &TypeExpr) -> bool {
    expr.tokens.len() == 1 && matches!(expr.tokens[0], TypeToken::Sort)
}

/// Check if a type expression ends with `instance`
pub fn is_instance_type(expr: &TypeExpr) -> bool {
    expr.tokens.last() == Some(&TypeToken::Instance)
}

/// Get all path tokens from a type expression (useful for parameter extraction)
pub fn get_paths(expr: &TypeExpr) -> Vec<&Path> {
    expr.tokens
        .iter()
        .filter_map(|t| match t {
            TypeToken::Path(p) => Some(p),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eval_sort_kind() {
        let env = Env::new();
        let expr = TypeExpr::sort();
        let val = eval_type_expr(&expr, &env).unwrap();
        assert!(val.is_sort_kind());
    }

    #[test]
    fn test_eval_prop_kind() {
        let env = Env::new();
        let expr = TypeExpr::prop();
        let val = eval_type_expr(&expr, &env).unwrap();
        assert!(val.is_prop_kind());
    }

    #[test]
    fn test_eval_single_path() {
        let env = Env::new();
        let expr = TypeExpr::single_path(Path::single("V"));
        let val = eval_type_expr(&expr, &env).unwrap();
        match val {
            TypeValue::Path(p) => assert_eq!(p.to_string(), "V"),
            _ => panic!("expected Path"),
        }
    }

    #[test]
    fn test_eval_instance() {
        let env = Env::new();
        let mut expr = TypeExpr::single_path(Path::single("Graph"));
        expr.push(TypeToken::Instance);
        let val = eval_type_expr(&expr, &env).unwrap();
        assert!(val.is_instance());
    }

    #[test]
    fn test_is_sort_kind() {
        let sort_expr = TypeExpr::sort();
        assert!(is_sort_kind(&sort_expr));

        let path_expr = TypeExpr::single_path(Path::single("V"));
        assert!(!is_sort_kind(&path_expr));
    }

    #[test]
    fn test_is_instance_type() {
        let mut expr = TypeExpr::single_path(Path::single("Graph"));
        expr.push(TypeToken::Instance);
        assert!(is_instance_type(&expr));

        let plain_expr = TypeExpr::single_path(Path::single("V"));
        assert!(!is_instance_type(&plain_expr));
    }
}
