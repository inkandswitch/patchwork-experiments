//! Theory elaboration.

use std::collections::HashMap;

use crate::ast;
use crate::core::*;

use super::env::{elaborate_formula_mut, elaborate_type, remap_derived_sort, Env};
use super::error::{ElabError, ElabResult};

/// Elaborate a theory declaration
pub fn elaborate_theory(env: &mut Env, theory: &ast::TheoryDecl) -> ElabResult<ElaboratedTheory> {
    // Set up the environment for this theory
    let mut local_env = env.clone();
    local_env.current_theory = Some(theory.name.clone());
    local_env.signature = Signature::new();

    // Process extends clause (if any)
    if let Some(ref parent_path) = theory.extends {
        let parent_name = parent_path.segments.join("/");
        if let Some(parent_theory) = env.theories.get(&parent_name) {
            // Helper: check if a name is already qualified from a grandparent
            let is_grandparent_qualified = |name: &str| -> bool {
                if let Some((prefix, _)) = name.split_once('/') {
                    parent_theory.theory.signature.lookup_sort(prefix).is_none()
                } else {
                    false
                }
            };

            // Helper: qualify a name
            let qualify = |name: &str| -> String {
                if is_grandparent_qualified(name) {
                    name.to_string()
                } else {
                    format!("{}/{}", parent_name, name)
                }
            };

            // Copy all sorts with requalified names
            for (_, sort_name) in &parent_theory.theory.signature.sorts {
                let qualified_name = qualify(sort_name);
                local_env.signature.add_sort(qualified_name);
            }

            // Copy all functions with requalified names
            for (_, func) in &parent_theory.theory.signature.functions {
                let qualified_name = qualify(&func.name);
                let domain = remap_derived_sort(
                    &func.domain,
                    &parent_theory.theory.signature,
                    &local_env.signature,
                    &parent_name,
                    true,
                );
                let codomain = remap_derived_sort(
                    &func.codomain,
                    &parent_theory.theory.signature,
                    &local_env.signature,
                    &parent_name,
                    true,
                );
                local_env
                    .signature
                    .add_function(qualified_name, domain, codomain);
            }

            // Copy all relations with requalified names
            for (_, rel) in &parent_theory.theory.signature.relations {
                let qualified_name = qualify(&rel.name);
                let domain = remap_derived_sort(
                    &rel.domain,
                    &parent_theory.theory.signature,
                    &local_env.signature,
                    &parent_name,
                    true,
                );
                local_env.signature.add_relation(qualified_name, domain);
            }
        } else {
            return Err(ElabError::UnknownTheory(parent_name));
        }
    }

    // Process parameters
    let mut params = Vec::new();
    for param in &theory.params {
        if param.ty.is_instance() {
            let inner = param.ty.instance_inner().unwrap();
            let theory_name = extract_theory_name(&inner)?;
            if let Some(base_theory) = env.theories.get(&theory_name) {
                let mut type_args = Vec::new();
                collect_type_args(&inner, &mut type_args);

                let mut param_subst: HashMap<String, String> = HashMap::new();
                for (bp, arg) in base_theory.params.iter().zip(type_args.iter()) {
                    if bp.theory_name != "Sort" {
                        param_subst.insert(bp.name.clone(), arg.clone());
                    }
                }

                // Copy all sorts from param theory
                for (_, sort_name) in &base_theory.theory.signature.sorts {
                    let qualified_name = if let Some((prefix, suffix)) = sort_name.split_once('/') {
                        if let Some(subst) = param_subst.get(prefix) {
                            let substituted_name = format!("{}/{}", subst, suffix);
                            if local_env.signature.lookup_sort(&substituted_name).is_some() {
                                continue;
                            }
                            substituted_name
                        } else {
                            format!("{}/{}", param.name, sort_name)
                        }
                    } else {
                        format!("{}/{}", param.name, sort_name)
                    };
                    local_env.signature.add_sort(qualified_name);
                }

                // Copy all functions from param theory
                for (_, func) in &base_theory.theory.signature.functions {
                    let qualified_name = if let Some((prefix, suffix)) = func.name.split_once('/') {
                        if let Some(subst) = param_subst.get(prefix) {
                            let substituted_name = format!("{}/{}", subst, suffix);
                            if local_env.signature.lookup_func(&substituted_name).is_some() {
                                continue;
                            }
                            substituted_name
                        } else {
                            format!("{}/{}", param.name, func.name)
                        }
                    } else {
                        format!("{}/{}", param.name, func.name)
                    };
                    let domain = remap_derived_sort_with_subst(
                        &func.domain,
                        &base_theory.theory.signature,
                        &local_env.signature,
                        &param.name,
                        &param_subst,
                    );
                    let codomain = remap_derived_sort_with_subst(
                        &func.codomain,
                        &base_theory.theory.signature,
                        &local_env.signature,
                        &param.name,
                        &param_subst,
                    );
                    local_env
                        .signature
                        .add_function(qualified_name, domain, codomain);
                }

                // Copy all relations from param theory
                for (_, rel) in &base_theory.theory.signature.relations {
                    let qualified_name = if let Some((prefix, suffix)) = rel.name.split_once('/') {
                        if let Some(subst) = param_subst.get(prefix) {
                            let substituted_name = format!("{}/{}", subst, suffix);
                            if local_env.signature.lookup_rel(&substituted_name).is_some() {
                                continue;
                            }
                            substituted_name
                        } else {
                            format!("{}/{}", param.name, rel.name)
                        }
                    } else {
                        format!("{}/{}", param.name, rel.name)
                    };
                    let domain = remap_derived_sort_with_subst(
                        &rel.domain,
                        &base_theory.theory.signature,
                        &local_env.signature,
                        &param.name,
                        &param_subst,
                    );
                    local_env.signature.add_relation(qualified_name, domain);
                }

                params.push(TheoryParam {
                    name: param.name.clone(),
                    theory_name: theory_name.clone(),
                });
                local_env
                    .params
                    .push((param.name.clone(), base_theory.clone()));
            } else {
                return Err(ElabError::UnknownTheory(theory_name));
            }
        } else if param.ty.is_sort() {
            local_env.signature.add_sort(param.name.clone());
            params.push(TheoryParam {
                name: param.name.clone(),
                theory_name: "Sort".to_string(),
            });
        } else {
            return Err(ElabError::UnsupportedFeature(format!(
                "parameter type {:?}",
                param.ty
            )));
        }
    }

    // First pass: collect all sorts
    for item in &theory.body {
        if let ast::TheoryItem::Sort(name) = &item.node {
            local_env.signature.add_sort(name.clone());
        }
    }

    // Second pass: collect all functions and relations
    for item in &theory.body {
        match &item.node {
            ast::TheoryItem::Function(f) => {
                if f.codomain.is_prop() {
                    let domain = elaborate_type(&local_env, &f.domain)?;
                    local_env.signature.add_relation(f.name.to_string(), domain);
                } else {
                    let domain = elaborate_type(&local_env, &f.domain)?;
                    let codomain = elaborate_type(&local_env, &f.codomain)?;
                    local_env
                        .signature
                        .add_function(f.name.to_string(), domain, codomain);
                }
            }
            ast::TheoryItem::Field(name, ty) if ty.as_record().is_some() => {
                let domain = elaborate_type(&local_env, ty)?;
                local_env.signature.add_relation(name.clone(), domain);
            }
            ast::TheoryItem::Field(name, ty) if ty.is_instance() => {
                let inner = ty.instance_inner().unwrap();
                let theory_type_str = format_type_expr(&inner);
                local_env
                    .signature
                    .add_instance_field(name.clone(), theory_type_str.clone());

                // Add content from field's theory
                if let Ok(field_theory_name) = extract_theory_name(&inner) {
                    if let Some(field_theory) = env.theories.get(&field_theory_name) {
                        let field_prefix = name.clone();
                        let sort_param_map = collect_sort_params(&inner, field_theory);

                        // Add non-param sorts
                        for (_, sort_name) in &field_theory.theory.signature.sorts {
                            if sort_name.contains('/') {
                                continue;
                            }
                            let is_sort_param = field_theory
                                .params
                                .iter()
                                .any(|p| p.theory_name == "Sort" && p.name == *sort_name);
                            if is_sort_param {
                                continue;
                            }
                            let qualified_name = format!("{}/{}", field_prefix, sort_name);
                            local_env.signature.add_sort(qualified_name);
                        }

                        // Add functions
                        for (_, func) in &field_theory.theory.signature.functions {
                            let is_from_param = if let Some(prefix) = func.name.split('/').next() {
                                field_theory.params.iter().any(|p| p.name == prefix)
                            } else {
                                false
                            };
                            if is_from_param {
                                continue;
                            }
                            let qualified_name = format!("{}/{}", field_prefix, func.name);
                            let domain = remap_for_instance_field(
                                &func.domain,
                                &field_theory.theory.signature,
                                &local_env.signature,
                                &sort_param_map,
                                &field_prefix,
                            );
                            let codomain = remap_for_instance_field(
                                &func.codomain,
                                &field_theory.theory.signature,
                                &local_env.signature,
                                &sort_param_map,
                                &field_prefix,
                            );
                            if let (Some(d), Some(c)) = (domain, codomain) {
                                local_env.signature.add_function(qualified_name, d, c);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Third pass: elaborate axioms with bidirectional type checking
    let mut axioms = Vec::new();
    for item in &theory.body {
        if let ast::TheoryItem::Axiom(ax) = &item.node {
            // Start with explicit forall-quantified variables
            let mut ctx = Context::new();
            for qv in &ax.quantified {
                let sort = elaborate_type(&local_env, &qv.ty)?;
                for name in &qv.names {
                    ctx = ctx.extend(name.clone(), sort.clone());
                }
            }

            // Elaborate hypotheses with mutable context
            // This allows implicit Int/Str bindings from relation patterns
            let premise = if ax.hypotheses.is_empty() {
                Formula::True
            } else {
                let mut hyps = Vec::new();
                for h in &ax.hypotheses {
                    hyps.push(elaborate_formula_mut(&local_env, &mut ctx, h)?);
                }
                Formula::Conj(hyps)
            };

            // Elaborate conclusion - can use variables implicitly bound in premise
            let conclusion = elaborate_formula_mut(&local_env, &mut ctx, &ax.conclusion)?;

            // The context now contains both explicit and implicit bindings
            axioms.push(Sequent {
                name: ax.name.to_string(),
                context: ctx,
                premise,
                conclusion,
            });
        }
    }

    Ok(ElaboratedTheory {
        params,
        theory: Theory {
            name: theory.name.clone(),
            signature: local_env.signature,
            axioms,
        },
    })
}

/// Remap a DerivedSort for an instance-typed field in a theory body.
fn remap_for_instance_field(
    sort: &DerivedSort,
    source_sig: &Signature,
    target_sig: &Signature,
    sort_param_map: &HashMap<String, String>,
    field_prefix: &str,
) -> Option<DerivedSort> {
    match sort {
        DerivedSort::Base(source_id) => {
            let sort_name = source_sig.sort_name(*source_id)?;

            // Check Sort parameter substitution
            if let Some(replacement) = sort_param_map.get(sort_name) {
                if let Some(target_id) = target_sig.lookup_sort(replacement) {
                    return Some(DerivedSort::Base(target_id));
                }
            }

            // Check if it's an instance param sort (already qualified)
            if sort_name.contains('/') {
                if let Some(target_id) = target_sig.lookup_sort(sort_name) {
                    return Some(DerivedSort::Base(target_id));
                }
            }

            // Check if it's a local sort (needs prefix)
            let prefixed = format!("{}/{}", field_prefix, sort_name);
            if let Some(target_id) = target_sig.lookup_sort(&prefixed) {
                return Some(DerivedSort::Base(target_id));
            }

            None
        }
        DerivedSort::Product(fields) => {
            let remapped: Option<Vec<_>> = fields
                .iter()
                .map(|(n, s)| {
                    remap_for_instance_field(
                        s,
                        source_sig,
                        target_sig,
                        sort_param_map,
                        field_prefix,
                    )
                    .map(|r| (n.clone(), r))
                })
                .collect();
            remapped.map(DerivedSort::Product)
        }
        // Primitive types don't need remapping
        DerivedSort::Int => Some(DerivedSort::Int),
        DerivedSort::Str => Some(DerivedSort::Str),
    }
}

/// Collect sort parameter mappings from a type expression.
fn collect_sort_params(
    ty: &ast::TypeExpr,
    field_theory: &std::rc::Rc<ElaboratedTheory>,
) -> HashMap<String, String> {
    let mut args = Vec::new();
    collect_type_args(ty, &mut args);

    let mut map = HashMap::new();
    for (param, arg) in field_theory.params.iter().zip(args.iter()) {
        if param.theory_name == "Sort" {
            map.insert(param.name.clone(), arg.clone());
        }
    }
    map
}

/// Collect type arguments from a type expression.
pub fn collect_type_args(ty: &ast::TypeExpr, args: &mut Vec<String>) {
    use crate::ast::TypeToken;

    let paths: Vec<String> = ty
        .tokens
        .iter()
        .filter_map(|t| match t {
            TypeToken::Path(p) => Some(p.to_string()),
            _ => None,
        })
        .collect();

    if paths.len() > 1 {
        args.extend(paths[..paths.len() - 1].iter().cloned());
    }
}

/// Remap a DerivedSort with instance parameter substitution.
fn remap_derived_sort_with_subst(
    sort: &DerivedSort,
    source_sig: &Signature,
    target_sig: &Signature,
    param_name: &str,
    param_subst: &HashMap<String, String>,
) -> DerivedSort {
    match sort {
        DerivedSort::Base(source_id) => {
            let sort_name = source_sig.sort_name(*source_id).expect("sort should exist");

            if let Some((prefix, suffix)) = sort_name.split_once('/') {
                if let Some(subst) = param_subst.get(prefix) {
                    let substituted_name = format!("{}/{}", subst, suffix);
                    if let Some(target_id) = target_sig.lookup_sort(&substituted_name) {
                        return DerivedSort::Base(target_id);
                    }
                }
            }

            let qualified_name = format!("{}/{}", param_name, sort_name);
            if let Some(target_id) = target_sig.lookup_sort(&qualified_name) {
                DerivedSort::Base(target_id)
            } else if let Some(target_id) = target_sig.lookup_sort(sort_name) {
                DerivedSort::Base(target_id)
            } else {
                panic!(
                    "remap_derived_sort_with_subst: could not find sort {} or {}",
                    qualified_name, sort_name
                );
            }
        }
        DerivedSort::Product(fields) => {
            let remapped_fields: Vec<_> = fields
                .iter()
                .map(|(name, s)| {
                    (
                        name.clone(),
                        remap_derived_sort_with_subst(
                            s,
                            source_sig,
                            target_sig,
                            param_name,
                            param_subst,
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

/// Extract the base theory name from a type expression.
fn extract_theory_name(ty: &ast::TypeExpr) -> ElabResult<String> {
    use crate::ast::TypeToken;

    for token in ty.tokens.iter().rev() {
        if let TypeToken::Path(path) = token {
            return Ok(path.to_string());
        }
    }

    Err(ElabError::TypeExprError(format!(
        "cannot extract theory name from {:?}",
        ty
    )))
}

/// Collect type arguments from a theory type string.
pub fn collect_type_args_from_theory_type(theory_type: &str) -> Vec<String> {
    let tokens: Vec<&str> = theory_type.split_whitespace().collect();
    if tokens.len() <= 1 {
        vec![]
    } else {
        tokens[..tokens.len() - 1]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
}

/// Build a parameter substitution map for importing elements from a parameterized instance.
pub fn build_param_subst(
    param_theory: &ElaboratedTheory,
    type_args: &[String],
) -> HashMap<String, String> {
    let mut param_subst = HashMap::new();
    for (bp, arg) in param_theory.params.iter().zip(type_args.iter()) {
        if bp.theory_name != "Sort" {
            param_subst.insert(bp.name.clone(), arg.clone());
        }
    }
    param_subst
}

/// Remap a sort name from a param instance to the local theory's sort namespace.
pub fn remap_sort_for_param_import(
    sort_name: &str,
    param_name: &str,
    param_subst: &HashMap<String, String>,
    local_arguments: &[(String, String)],
) -> String {
    if let Some((prefix, suffix)) = sort_name.split_once('/') {
        if let Some(bound_instance) = param_subst.get(prefix) {
            for (local_param_name, local_instance) in local_arguments {
                if local_instance == bound_instance {
                    return format!("{}/{}", local_param_name, suffix);
                }
            }
            return format!("{}/{}", param_name, sort_name);
        }
    }

    format!("{}/{}", param_name, sort_name)
}

/// Format a type expression as a string
fn format_type_expr(ty: &ast::TypeExpr) -> String {
    use crate::ast::TypeToken;

    let mut parts = Vec::new();

    for token in &ty.tokens {
        match token {
            TypeToken::Path(path) => parts.push(path.to_string()),
            TypeToken::Sort => parts.push("Sort".to_string()),
            TypeToken::Prop => parts.push("Prop".to_string()),
            TypeToken::Instance => parts.push("instance".to_string()),
            TypeToken::Arrow => parts.push("->".to_string()),
            TypeToken::Int => parts.push("Int".to_string()),
            TypeToken::Str => parts.push("Str".to_string()),
            TypeToken::Record(fields) => {
                let field_strs: Vec<String> = fields
                    .iter()
                    .map(|(name, field_ty)| format!("{}: {}", name, format_type_expr(field_ty)))
                    .collect();
                parts.push(format!("[{}]", field_strs.join(", ")));
            }
        }
    }

    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;
    use std::rc::Rc;

    #[test]
    fn test_elaborate_empty_theory() {
        let mut env = Env::new();
        let file = parse("theory Empty {}").unwrap();
        let ast::Declaration::Theory(ref theory) = file.declarations[0].node else {
            panic!("expected theory");
        };

        let result = elaborate_theory(&mut env, theory).unwrap();
        assert_eq!(result.theory.name, "Empty");
        assert_eq!(result.theory.signature.num_sorts(), 0);
        assert!(result.params.is_empty());
    }

    #[test]
    fn test_elaborate_theory_with_sort() {
        let mut env = Env::new();
        let file = parse("theory T { M : Sort; }").unwrap();
        let ast::Declaration::Theory(ref theory) = file.declarations[0].node else {
            panic!("expected theory");
        };

        let result = elaborate_theory(&mut env, theory).unwrap();
        assert_eq!(result.theory.signature.num_sorts(), 1);
        assert!(result.theory.signature.lookup_sort("M").is_some());
    }

    #[test]
    fn test_elaborate_theory_with_function() {
        let mut env = Env::new();
        let file = parse("theory Monoid { M : Sort; mul : [x: M, y: M] -> M; }").unwrap();
        let ast::Declaration::Theory(ref theory) = file.declarations[0].node else {
            panic!("expected theory");
        };

        let result = elaborate_theory(&mut env, theory).unwrap();
        assert_eq!(result.theory.signature.num_sorts(), 1);
        assert_eq!(result.theory.signature.num_functions(), 1);
        assert!(result.theory.signature.lookup_func("mul").is_some());
    }

    #[test]
    fn test_elaborate_theory_with_relation() {
        let mut env = Env::new();
        let file = parse("theory Graph { V : Sort; E : [src: V, tgt: V] -> Prop; }").unwrap();
        let ast::Declaration::Theory(ref theory) = file.declarations[0].node else {
            panic!("expected theory");
        };

        let result = elaborate_theory(&mut env, theory).unwrap();
        assert_eq!(result.theory.signature.num_sorts(), 1);
        assert_eq!(result.theory.signature.num_relations(), 1);
        assert!(result.theory.signature.lookup_rel("E").is_some());
    }

    #[test]
    fn test_elaborate_theory_extends() {
        let mut env = Env::new();

        // First elaborate the base theory
        let base_file = parse("theory Base { A : Sort; }").unwrap();
        let ast::Declaration::Theory(ref base_theory) = base_file.declarations[0].node else {
            panic!("expected theory");
        };
        let base_elab = elaborate_theory(&mut env, base_theory).unwrap();
        env.add_theory("Base", Rc::new(base_elab));

        // Now elaborate a theory that extends it
        let ext_file = parse("theory Ext extends Base { B : Sort; }").unwrap();
        let ast::Declaration::Theory(ref ext_theory) = ext_file.declarations[0].node else {
            panic!("expected theory");
        };
        let ext_elab = elaborate_theory(&mut env, ext_theory).unwrap();

        // Should have both Base/A and B
        assert_eq!(ext_elab.theory.signature.num_sorts(), 2);
        assert!(ext_elab.theory.signature.lookup_sort("Base/A").is_some());
        assert!(ext_elab.theory.signature.lookup_sort("B").is_some());
    }
}
