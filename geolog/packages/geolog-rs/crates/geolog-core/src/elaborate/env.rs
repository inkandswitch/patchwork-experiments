//! Elaboration environment and basic elaboration functions.

use std::collections::HashMap;
use std::rc::Rc;

use crate::ast::{Formula as AstFormula, Path, Term as AstTerm, TypeExpr};
use crate::core::*;

use super::error::{ElabError, ElabResult};

/// Environment for elaboration — tracks what's in scope
#[derive(Clone, Debug, Default)]
pub struct Env {
    /// Known theories, by name
    pub theories: HashMap<String, Rc<ElaboratedTheory>>,
    /// Current theory being elaborated (if any)
    pub current_theory: Option<String>,
    /// Local signature being built
    pub signature: Signature,
    /// Parameters in scope (for parameterized theories)
    pub params: Vec<(String, Rc<ElaboratedTheory>)>,
}

impl Env {
    /// Create a new empty environment
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a theory to the environment
    pub fn add_theory(&mut self, name: impl Into<String>, theory: Rc<ElaboratedTheory>) {
        self.theories.insert(name.into(), theory);
    }

    /// Get a theory by name
    pub fn get_theory(&self, name: &str) -> Option<&Rc<ElaboratedTheory>> {
        self.theories.get(name)
    }

    /// Resolve a path like "N/P" where N is a parameter and P is a sort in N's theory.
    ///
    /// All param sorts are copied into the local signature with qualified names (e.g., "N/P"),
    /// so we just need to look up the joined path in the current signature.
    pub fn resolve_sort_path(&self, path: &Path) -> ElabResult<DerivedSort> {
        // Join all segments with "/" — this handles both simple names like "F"
        // and qualified names like "N/P"
        let full_name = path.segments.join("/");
        if let Some(id) = self.signature.lookup_sort(&full_name) {
            return Ok(DerivedSort::Base(id));
        }
        Err(ElabError::UnknownSort(full_name))
    }

    /// Resolve a function path like "N/in/src" or "F/of".
    ///
    /// All param functions are copied into the local signature with qualified names,
    /// so we just need to look up the joined path.
    pub fn resolve_func_path(&self, path: &Path) -> ElabResult<FuncId> {
        let full_name = path.segments.join("/");
        if let Some(id) = self.signature.lookup_func(&full_name) {
            return Ok(id);
        }
        Err(ElabError::UnknownFunction(full_name))
    }

    /// Resolve a relation path
    pub fn resolve_rel_path(&self, path: &Path) -> ElabResult<RelId> {
        let full_name = path.segments.join("/");
        if let Some(id) = self.signature.lookup_rel(&full_name) {
            return Ok(id);
        }
        Err(ElabError::UnknownRel(full_name))
    }
}

/// Elaborate a type expression into a DerivedSort
///
/// Uses the concatenative stack-based type evaluator.
pub fn elaborate_type(env: &Env, ty: &TypeExpr) -> ElabResult<DerivedSort> {
    use super::types::eval_type_expr;

    let val = eval_type_expr(ty, env)?;
    val.as_derived_sort(env)
}

// ============================================================================
// Bidirectional Type Checking
// ============================================================================

/// Infer the type of a term (synthesis mode).
///
/// Returns both the elaborated term and its inferred sort.
/// This is used when we don't have an expected type to check against.
pub fn infer_term(env: &Env, ctx: &Context, term: &AstTerm) -> ElabResult<(Term, DerivedSort)> {
    match term {
        AstTerm::Path(path) => {
            if path.segments.len() == 1 {
                // Simple variable - must be in context
                let name = &path.segments[0];
                if let Some((_, sort)) = ctx.lookup(name) {
                    return Ok((Term::Var(name.clone(), sort.clone()), sort.clone()));
                }
                return Err(ElabError::UnknownVariable(name.clone()));
            }
            // Qualified path — could be a variable or a function reference
            // For now, treat as variable lookup failure
            Err(ElabError::UnknownVariable(path.to_string()))
        }
        AstTerm::App(base, func) => {
            // In surface syntax, application is postfix: `x f` means apply f to x
            // So App(base, func) where base is the argument and func is the function
            // First, infer the type of the base (the argument)
            let (elab_arg, arg_sort) = infer_term(env, ctx, base)?;

            // Then figure out what the function is
            match func.as_ref() {
                AstTerm::Path(path) => {
                    let func_id = env.resolve_func_path(path)?;
                    let func_sym = env
                        .signature
                        .function(func_id)
                        .ok_or_else(|| ElabError::UnknownFunction(path.to_string()))?;

                    // Type check: argument sort must match function domain
                    if arg_sort != func_sym.domain {
                        return Err(ElabError::TypeMismatch {
                            expected: func_sym.domain.clone(),
                            got: arg_sort,
                        });
                    }

                    let result_sort = func_sym.codomain.clone();
                    Ok((Term::App(func_id, Box::new(elab_arg)), result_sort))
                }
                _ => {
                    // Higher-order application — not supported yet
                    Err(ElabError::UnsupportedFeature(
                        "higher-order application".to_string(),
                    ))
                }
            }
        }
        AstTerm::Project(base, field) => {
            let (elab_base, base_sort) = infer_term(env, ctx, base)?;
            // Get the field's sort from the product type
            let field_sort = base_sort
                .get_field(field)
                .ok_or_else(|| ElabError::UnknownField {
                    field: field.clone(),
                    sort: base_sort.clone(),
                })?;
            Ok((
                Term::Project(Box::new(elab_base), field.clone()),
                field_sort.clone(),
            ))
        }
        AstTerm::Record(fields) => {
            let mut elab_fields = Vec::new();
            let mut sort_fields = Vec::new();
            for (name, field_term) in fields {
                let (elab_field, field_sort) = infer_term(env, ctx, field_term)?;
                elab_fields.push((name.clone(), elab_field));
                sort_fields.push((name.clone(), field_sort));
            }
            let sort = DerivedSort::Product(sort_fields);
            Ok((Term::Record(elab_fields), sort))
        }
    }
}

/// Check a term against an expected type (checking mode).
///
/// This can implicitly bind new variables if they appear in primitive-typed positions
/// (Int or Str). The context is mutable to allow adding these implicit bindings.
///
/// This is the key function for bidirectional type checking: type information flows
/// "down" from the expected type, enabling inference of otherwise ambiguous terms.
pub fn check_term(
    env: &Env,
    ctx: &mut Context,
    term: &AstTerm,
    expected: &DerivedSort,
) -> ElabResult<Term> {
    match term {
        AstTerm::Path(path) if path.segments.len() == 1 => {
            let name = &path.segments[0];

            if let Some((_, sort)) = ctx.lookup(name) {
                // Variable exists in context - verify type matches
                if sort != expected {
                    return Err(ElabError::TypeMismatch {
                        expected: expected.clone(),
                        got: sort.clone(),
                    });
                }
                Ok(Term::Var(name.clone(), sort.clone()))
            } else if expected.is_primitive() {
                // Unbound variable in a primitive (Int/Str) position - bind it implicitly!
                ctx.extend_implicit(name.clone(), expected.clone());
                Ok(Term::Var(name.clone(), expected.clone()))
            } else {
                // Unbound variable in a non-primitive position - error
                // (Entity sorts must be explicitly quantified)
                Err(ElabError::UnknownVariable(name.clone()))
            }
        }
        AstTerm::Record(fields) => {
            // Check record against expected product type
            match expected {
                DerivedSort::Product(expected_fields) => {
                    // Build a map of expected field types for quick lookup
                    let expected_map: std::collections::HashMap<&str, &DerivedSort> =
                        expected_fields
                            .iter()
                            .map(|(n, s)| (n.as_str(), s))
                            .collect();

                    let mut elab_fields = Vec::new();
                    for (name, field_term) in fields {
                        let field_expected = expected_map.get(name.as_str()).ok_or_else(|| {
                            ElabError::UnknownField {
                                field: name.clone(),
                                sort: expected.clone(),
                            }
                        })?;
                        // Recursively check each field against its expected type
                        let elab_field = check_term(env, ctx, field_term, field_expected)?;
                        elab_fields.push((name.clone(), elab_field));
                    }

                    // Verify all expected fields are present
                    for (expected_name, _) in expected_fields {
                        if !fields.iter().any(|(n, _)| n == expected_name) {
                            return Err(ElabError::MissingField {
                                field: expected_name.clone(),
                                sort: expected.clone(),
                            });
                        }
                    }

                    Ok(Term::Record(elab_fields))
                }
                _ => {
                    // Expected a product type but got something else
                    // Fall back to inference and check
                    let (elab, inferred) = infer_term(env, ctx, term)?;
                    if &inferred != expected {
                        return Err(ElabError::TypeMismatch {
                            expected: expected.clone(),
                            got: inferred,
                        });
                    }
                    Ok(elab)
                }
            }
        }
        _ => {
            // For other term forms, fall back to inference and check the result
            let (elab, inferred) = infer_term(env, ctx, term)?;
            if &inferred != expected {
                return Err(ElabError::TypeMismatch {
                    expected: expected.clone(),
                    got: inferred,
                });
            }
            Ok(elab)
        }
    }
}

/// Elaborate an AST term in a given context (legacy interface).
///
/// This is equivalent to `infer_term` but returns only the term, not the sort.
/// Kept for backward compatibility with existing code.
pub fn elaborate_term(env: &Env, ctx: &Context, term: &AstTerm) -> ElabResult<Term> {
    let (elab, _) = infer_term(env, ctx, term)?;
    Ok(elab)
}

/// Elaborate an AST formula with bidirectional type checking (mutable context).
///
/// This version can implicitly bind Int/Str variables when they appear in
/// relation argument positions. The context is mutable to track these bindings.
pub fn elaborate_formula_mut(
    env: &Env,
    ctx: &mut Context,
    formula: &AstFormula,
) -> ElabResult<Formula> {
    match formula {
        AstFormula::True => Ok(Formula::True),
        AstFormula::False => Ok(Formula::False),
        AstFormula::Eq(lhs, rhs) => {
            // For equality, infer LHS type, then check RHS against it
            // This allows implicit binding on the RHS if LHS establishes the type
            let (elab_lhs, lhs_sort) = infer_term(env, ctx, lhs)?;
            let elab_rhs = check_term(env, ctx, rhs, &lhs_sort)?;

            Ok(Formula::Eq(elab_lhs, elab_rhs))
        }
        AstFormula::Lt(lhs, rhs) => {
            // For comparisons, check both sides against Int
            let elab_lhs = check_term(env, ctx, lhs, &DerivedSort::Int)?;
            let elab_rhs = check_term(env, ctx, rhs, &DerivedSort::Int)?;
            Ok(Formula::Lt(elab_lhs, elab_rhs))
        }
        AstFormula::Le(lhs, rhs) => {
            let elab_lhs = check_term(env, ctx, lhs, &DerivedSort::Int)?;
            let elab_rhs = check_term(env, ctx, rhs, &DerivedSort::Int)?;
            Ok(Formula::Le(elab_lhs, elab_rhs))
        }
        AstFormula::Gt(lhs, rhs) => {
            let elab_lhs = check_term(env, ctx, lhs, &DerivedSort::Int)?;
            let elab_rhs = check_term(env, ctx, rhs, &DerivedSort::Int)?;
            Ok(Formula::Gt(elab_lhs, elab_rhs))
        }
        AstFormula::Ge(lhs, rhs) => {
            let elab_lhs = check_term(env, ctx, lhs, &DerivedSort::Int)?;
            let elab_rhs = check_term(env, ctx, rhs, &DerivedSort::Int)?;
            Ok(Formula::Ge(elab_lhs, elab_rhs))
        }
        AstFormula::And(conjuncts) => {
            // Elaborate conjuncts left-to-right, accumulating implicit bindings
            let mut elab_conjuncts = Vec::new();
            for f in conjuncts {
                elab_conjuncts.push(elaborate_formula_mut(env, ctx, f)?);
            }
            Ok(Formula::Conj(elab_conjuncts))
        }
        AstFormula::Or(disjuncts) => {
            // For disjunctions, each branch should see the same context
            // (implicit bindings in one branch shouldn't affect others)
            // For now, we'll use the same mutable context - this may need refinement
            let mut elab_disjuncts = Vec::new();
            for f in disjuncts {
                elab_disjuncts.push(elaborate_formula_mut(env, ctx, f)?);
            }
            Ok(Formula::Disj(elab_disjuncts))
        }
        AstFormula::Exists(vars, body) => {
            // Extend context with quantified variables (explicit bindings)
            for qv in vars {
                let sort = elaborate_type(env, &qv.ty)?;
                for name in &qv.names {
                    *ctx = ctx.extend(name.clone(), sort.clone());
                }
            }
            let elab_body = elaborate_formula_mut(env, ctx, body)?;

            // Build nested existentials (one for each variable)
            let mut result = elab_body;
            for qv in vars.iter().rev() {
                let sort = elaborate_type(env, &qv.ty)?;
                for name in qv.names.iter().rev() {
                    result = Formula::Exists(name.clone(), sort.clone(), Box::new(result));
                }
            }
            Ok(result)
        }
        AstFormula::RelApp(rel_name, arg) => {
            // Look up the relation to get its domain type
            let rel_id = env
                .signature
                .lookup_rel(rel_name)
                .ok_or_else(|| ElabError::UnknownRel(rel_name.clone()))?;

            let rel_sym = env
                .signature
                .relation(rel_id)
                .ok_or_else(|| ElabError::UnknownRel(rel_name.clone()))?;

            // CHECK the argument against the relation's domain type
            // This is the key bidirectional step - it enables implicit Int/Str binding
            let elab_arg = check_term(env, ctx, arg, &rel_sym.domain)?;

            Ok(Formula::Rel(rel_id, elab_arg))
        }
    }
}

/// Elaborate an AST formula in a given context (legacy interface).
///
/// This version uses an immutable context and doesn't support implicit binding.
/// Use `elaborate_formula_mut` for bidirectional type checking with implicit binding.
pub fn elaborate_formula(env: &Env, ctx: &Context, formula: &AstFormula) -> ElabResult<Formula> {
    // Clone the context so we can use the mutable version internally
    // but discard any implicit bindings (preserving old behavior)
    let mut ctx_clone = ctx.clone();
    elaborate_formula_mut(env, &mut ctx_clone, formula)
}

/// Remap a DerivedSort from one signature namespace to another.
///
/// When copying sorts/functions from a param theory into the local signature,
/// the sort IDs need to be remapped. For example, if PetriNet has sort P at id=0,
/// and we copy it as "N/P" into local signature at id=2, then any DerivedSort::Base(0)
/// needs to become DerivedSort::Base(2).
///
/// The `preserve_existing_prefix` flag controls requalification behavior:
/// - false (instance params): always prefix with param_name. N/X becomes M/N/X.
/// - true (extends): preserve existing qualifier. N/X stays N/X.
pub fn remap_derived_sort(
    sort: &DerivedSort,
    source_sig: &Signature,
    target_sig: &Signature,
    param_name: &str,
    preserve_existing_prefix: bool,
) -> DerivedSort {
    match sort {
        DerivedSort::Base(source_id) => {
            // Look up the sort name in the source signature
            let sort_name = source_sig.sort_name(*source_id).expect("sort should exist");
            // Find the corresponding qualified name in target signature
            let qualified_name = if preserve_existing_prefix && sort_name.contains('/') {
                // Extends case: already-qualified names keep their original qualifier
                sort_name.to_string()
            } else {
                // Instance param case OR unqualified name: prefix with param_name
                format!("{}/{}", param_name, sort_name)
            };
            let target_id = target_sig
                .lookup_sort(&qualified_name)
                .expect("qualified sort should have been added");
            DerivedSort::Base(target_id)
        }
        DerivedSort::Product(fields) => {
            let remapped_fields = fields
                .iter()
                .map(|(name, s)| {
                    (
                        name.clone(),
                        remap_derived_sort(
                            s,
                            source_sig,
                            target_sig,
                            param_name,
                            preserve_existing_prefix,
                        ),
                    )
                })
                .collect();
            DerivedSort::Product(remapped_fields)
        }
        // Primitive types don't need remapping
        DerivedSort::Int => DerivedSort::Int,
        DerivedSort::Str => DerivedSort::Str,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_new() {
        let env = Env::new();
        assert!(env.theories.is_empty());
        assert!(env.current_theory.is_none());
    }

    #[test]
    fn test_resolve_sort_simple() {
        let mut env = Env::new();
        let v_id = env.signature.add_sort("V".to_string());

        let path = Path::single("V");
        let sort = env.resolve_sort_path(&path).unwrap();
        assert_eq!(sort, DerivedSort::Base(v_id));
    }

    #[test]
    fn test_resolve_sort_qualified() {
        let mut env = Env::new();
        let np_id = env.signature.add_sort("N/P".to_string());

        let path = Path::from_segments(vec!["N".to_string(), "P".to_string()]);
        let sort = env.resolve_sort_path(&path).unwrap();
        assert_eq!(sort, DerivedSort::Base(np_id));
    }

    #[test]
    fn test_resolve_sort_unknown() {
        let env = Env::new();
        let path = Path::single("Unknown");
        let result = env.resolve_sort_path(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_elaborate_term_var() {
        let mut env = Env::new();
        let v_id = env.signature.add_sort("V".to_string());

        let ctx = Context::new().extend("x", DerivedSort::Base(v_id));
        let term = AstTerm::Path(Path::single("x"));

        let elab = elaborate_term(&env, &ctx, &term).unwrap();
        match elab {
            Term::Var(name, sort) => {
                assert_eq!(name, "x");
                assert_eq!(sort, DerivedSort::Base(v_id));
            }
            _ => panic!("expected Var"),
        }
    }

    #[test]
    fn test_elaborate_formula_true() {
        let env = Env::new();
        let ctx = Context::new();
        let formula = AstFormula::True;

        let elab = elaborate_formula(&env, &ctx, &formula).unwrap();
        assert!(matches!(elab, Formula::True));
    }

    #[test]
    fn test_elaborate_formula_and() {
        let env = Env::new();
        let ctx = Context::new();
        let formula = AstFormula::And(vec![AstFormula::True, AstFormula::False]);

        let elab = elaborate_formula(&env, &ctx, &formula).unwrap();
        match elab {
            Formula::Conj(parts) => {
                assert_eq!(parts.len(), 2);
            }
            _ => panic!("expected Conj"),
        }
    }
}
