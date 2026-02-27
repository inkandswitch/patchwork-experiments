//! Integration tests for the database evaluation system.
//!
//! These tests verify the public API using the new geolog-zeta syntax.

use std::rc::Rc;

use geolog_core::ast::Declaration;
use geolog_core::elaborate::{elaborate_theory, Env};
use geolog_core::parser::parse;
use geolog_core::{DagOp, Database, EntityId, Op, OpDag, RelId, SortId, Theory, Value};

/// Helper to parse and elaborate a theory from source code
fn make_theory(source: &str) -> Theory {
    let file = parse(source).expect("parse failed");
    let mut env = Env::new();

    for decl in &file.declarations {
        if let Declaration::Theory(theory_decl) = &decl.node {
            let elaborated = elaborate_theory(&mut env, theory_decl).expect("elaboration failed");
            env.add_theory(&elaborated.theory.name, Rc::new(elaborated.clone()));
            return elaborated.theory;
        }
    }
    panic!("no theory found in source");
}

// ============================================================
// Phase 1: Core Data Structures
// ============================================================

#[test]
fn test_add_entities_to_json() {
    let theory = make_theory("theory T { V : Sort; }");
    let v_sort = theory.signature.lookup_sort("V").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();

    let json = db.to_json();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    // Verify JSON contains both entity IDs under "V"
    let entities = parsed["entities"]["V"].as_array().unwrap();
    assert_eq!(entities.len(), 2);
    assert!(entities.contains(&serde_json::json!(v0.0.to_string())));
    assert!(entities.contains(&serde_json::json!(v1.0.to_string())));
}

// ============================================================
// Phase 2: Schema Validation
// ============================================================

#[test]
fn test_add_entity_invalid_sort() {
    let theory = make_theory("theory T { V : Sort; }");
    let mut db = Database::from_theory(theory);

    // Invalid: use a random SortId that doesn't exist
    let fake_sort = SortId::new();
    let err = db.add_entity(fake_sort).unwrap_err();
    assert!(err.message.contains("does not exist"));
}

#[test]
fn test_add_relation_type_checking() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();

    // Valid relation
    db.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();

    // Invalid: wrong argument count
    assert!(db.add_relation(e_rel, vec![v0.clone().into()]).is_err());

    // Invalid: relation doesn't exist
    let fake_rel = RelId::new();
    assert!(db.add_relation(fake_rel, vec![v0.into()]).is_err());
}

#[test]
fn test_add_relation_entity_not_found() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();
    let fake_id = EntityId::new(); // Not in database

    // Invalid: entity doesn't exist
    let err = db
        .add_relation(e_rel, vec![v0.into(), fake_id.into()])
        .unwrap_err();
    assert!(err.message.contains("does not exist"));
}

#[test]
fn test_add_relation_wrong_sort() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            W : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let w_sort = theory.signature.lookup_sort("W").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let v = db.add_entity(v_sort).unwrap();
    let w = db.add_entity(w_sort).unwrap();

    // Invalid: w has sort W, but E expects V
    let err = db
        .add_relation(e_rel, vec![v.into(), w.into()])
        .unwrap_err();
    assert!(err.message.contains("sort"));
}

#[test]
fn test_relations_in_json() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();

    db.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();

    let json = db.to_json();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    // Verify JSON contains the relation
    let relations = parsed["relations"]["E"].as_array().unwrap();
    assert_eq!(relations.len(), 1);

    let edge = &relations[0];
    assert_eq!(edge[0]["entity"], v0.0.to_string());
    assert_eq!(edge[1]["entity"], v1.0.to_string());
}

// ============================================================
// Phase 3: Axiom Checking
// ============================================================

#[test]
fn test_axiom_violation_error() {
    // Axiom: forall v1, v2 : V, n1, n2 : ??? - we can't do Int yet
    // Let's test with a simpler axiom using entities only
    let theory = make_theory(
        r#"
        theory FuncGraph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
            // Functional: each vertex has at most one outgoing edge
            // Note: postfix notation - [src: x, tgt: y1] E means E(x, y1)
            ax/functional : forall x : V, y1 : V, y2 : V.
                [src: x, tgt: y1] E /\ [src: x, tgt: y2] E |- y1 = y2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);
    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();
    let v2 = db.add_entity(v_sort).unwrap();

    // Add first edge: v0 -> v1
    db.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();

    // This should fail due to functional axiom: v0 -> v2 when v0 -> v1 already exists
    let err = db
        .add_relation(e_rel, vec![v0.into(), v2.into()])
        .unwrap_err();
    assert!(err.to_string().contains("functional"));
}

#[test]
fn test_axiom_allows_valid_operations() {
    let theory = make_theory(
        r#"
        theory FuncGraph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
            // Functional: each vertex has at most one outgoing edge
            ax/functional : forall x : V, y1 : V, y2 : V.
                [src: x, tgt: y1] E /\ [src: x, tgt: y2] E |- y1 = y2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);
    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();
    let v2 = db.add_entity(v_sort).unwrap();

    // These are all valid - different source vertices
    db.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();
    db.add_relation(e_rel, vec![v1.clone().into(), v2.clone().into()])
        .unwrap();
    db.add_relation(e_rel, vec![v2.clone().into(), v0.clone().into()])
        .unwrap();

    // Even adding the same edge again is fine (idempotent)
    db.add_relation(e_rel, vec![v0.into(), v1.into()]).unwrap();

    assert_eq!(db.opdag().len(), 7); // 3 entities + 4 relations
}

#[test]
fn test_symmetry_axiom() {
    let theory = make_theory(
        r#"
        theory SymGraph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
            ax/sym : forall x : V, y : V. [src: x, tgt: y] E |- [src: y, tgt: x] E;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);
    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();

    // Adding E(v0, v1) should require E(v1, v0) to exist as well (by sym axiom)
    // The axiom says: E [src: x, tgt: y] |- E [src: y, tgt: x]
    // This means if E(x, y) is true, E(y, x) must also be true
    // Adding E(v0, v1) alone would violate this since E(v1, v0) doesn't exist
    let err = db
        .add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap_err();
    assert!(err.to_string().contains("sym"));
}

// ============================================================
// Phase 4: OpDag Replay with Skip Semantics
// ============================================================
//
// Note: With the OpDag architecture, all operations are preserved in the DAG
// even if they're invalid. Invalid operations are simply skipped during state
// derivation. This enables collaboration where all ops are synced, but only
// valid ones affect the derived state.

/// Helper to create an OpDag from a list of operations
fn make_opdag(ops: Vec<Op>) -> OpDag {
    let mut dag = OpDag::new();
    for op in ops {
        dag.add(op);
    }
    dag
}

#[test]
fn test_opdag_replay_skips_violations() {
    let theory = make_theory(
        r#"
        theory FuncGraph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
            ax/functional : forall x : V, y1 : V, y2 : V.
                [src: x, tgt: y1] E /\ [src: x, tgt: y2] E |- y1 = y2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let id0 = EntityId::new();
    let id1 = EntityId::new();
    let id2 = EntityId::new();

    let opdag = make_opdag(vec![
        Op::AddEntity {
            sort: v_sort,
            id: id0.clone(),
        },
        Op::AddEntity {
            sort: v_sort,
            id: id1.clone(),
        },
        Op::AddEntity {
            sort: v_sort,
            id: id2.clone(),
        },
        Op::AddRelation {
            rel: e_rel,
            args: vec![Value::Entity(id0.clone()), Value::Entity(id1.clone())],
        },
        // This violates functional: id0 already has edge to id1
        Op::AddRelation {
            rel: e_rel,
            args: vec![Value::Entity(id0.clone()), Value::Entity(id2.clone())],
        },
    ]);

    let db = Database::from_opdag(theory, opdag);

    // All 5 ops are preserved in the OpDag (for sync purposes)
    assert_eq!(db.opdag().len(), 5);

    // But the derived state only reflects valid ops:
    // - 3 entities exist
    // - Only 1 edge exists (the violating edge is skipped)
    let json = db.to_json();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    let relations = parsed["relations"]["E"].as_array().unwrap();
    assert_eq!(relations.len(), 1); // Only 1 valid edge
}

#[test]
fn test_opdag_replay_skips_invalid_sort() {
    let theory = make_theory("theory T { V : Sort; }");
    let v_sort = theory.signature.lookup_sort("V").unwrap();

    let id0 = EntityId::new();

    let opdag = make_opdag(vec![
        Op::AddEntity {
            sort: SortId::new(), // Invalid sort (random UUID)
            id: id0.clone(),
        },
        Op::AddEntity {
            sort: v_sort, // Valid sort
            id: EntityId::new(),
        },
    ]);

    let db = Database::from_opdag(theory, opdag);

    // All 2 ops are preserved in the OpDag (for sync purposes)
    assert_eq!(db.opdag().len(), 2);

    // But the derived state only has 1 valid entity
    let json = db.to_json();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    let entities = parsed["entities"]["V"].as_array().unwrap();
    assert_eq!(entities.len(), 1);
}

#[test]
fn test_opdag_replay_preserves_valid_ops() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let id0 = EntityId::new();
    let id1 = EntityId::new();

    let opdag = make_opdag(vec![
        Op::AddEntity {
            sort: v_sort,
            id: id0.clone(),
        },
        Op::AddEntity {
            sort: v_sort,
            id: id1.clone(),
        },
        Op::AddRelation {
            rel: e_rel,
            args: vec![Value::Entity(id0.clone()), Value::Entity(id1.clone())],
        },
    ]);

    let db = Database::from_opdag(theory, opdag);

    // All ops are valid, so all should be preserved
    assert_eq!(db.opdag().len(), 3);
}

// ============================================================
// Additional Tests for New Features
// ============================================================

#[test]
fn test_multiple_sorts() {
    let theory = make_theory(
        r#"
        theory BipartiteGraph {
            A : Sort;
            B : Sort;
            E : [src: A, tgt: B] -> Prop;
        }
        "#,
    );
    let a_sort = theory.signature.lookup_sort("A").unwrap();
    let b_sort = theory.signature.lookup_sort("B").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a0 = db.add_entity(a_sort).unwrap();
    let b0 = db.add_entity(b_sort).unwrap();

    // Valid: A -> B edge
    db.add_relation(e_rel, vec![a0.clone().into(), b0.clone().into()])
        .unwrap();

    // Invalid: B -> A (wrong sorts)
    let err = db
        .add_relation(e_rel, vec![b0.into(), a0.into()])
        .unwrap_err();
    assert!(err.message.contains("sort"));
}

#[test]
fn test_self_loops_allowed() {
    let theory = make_theory(
        r#"
        theory Graph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();

    // Self-loop is valid
    db.add_relation(e_rel, vec![v0.clone().into(), v0.into()])
        .unwrap();

    assert_eq!(db.opdag().len(), 2); // 1 entity + 1 relation
}

#[test]
fn test_theory_with_function() {
    // Test a proper function with domain and codomain
    let theory = make_theory(
        r#"
        theory Graph {
            V : Sort;
            E : Sort;
            src : E -> V;
            tgt : E -> V;
        }
        "#,
    );

    // Verify the theory has the functions
    assert!(theory.signature.lookup_func("src").is_some());
    assert!(theory.signature.lookup_func("tgt").is_some());

    let db = Database::from_theory(theory);
    assert_eq!(db.opdag().len(), 0);
}

#[test]
fn test_reflexive_axiom() {
    let theory = make_theory(
        r#"
        theory ReflGraph {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
            // Every vertex has a self-loop
            ax/refl : forall x : V. |- [src: x, tgt: x] E;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let _e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    // Adding a vertex should require E(v, v) to exist
    // But our current system checks axioms only on add_relation
    // So this test just verifies that the theory parses and the database is usable
    let _v0 = db.add_entity(v_sort).unwrap();

    // The reflexive axiom has empty premise (just "|-") so it requires
    // E[src: x, tgt: x] for all x. This would need to be enforced on entity creation
    // which is not currently implemented. For now, just verify the theory works.
    assert_eq!(db.opdag().len(), 1);
}

// ============================================================
// Phase 5: Primitive Types (Int and Str)
// ============================================================

#[test]
fn test_weighted_graph_with_int() {
    let theory = make_theory(
        r#"
        theory WeightedGraph {
            V : Sort;
            E : [src: V, tgt: V, weight: Int] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a = db.add_entity(v_sort).unwrap();
    let b = db.add_entity(v_sort).unwrap();

    // Add edge with weight 5
    db.add_relation(
        e_rel,
        vec![a.clone().into(), b.clone().into(), Value::Int(5)],
    )
    .unwrap();

    // Add another edge with different weight (same endpoints)
    db.add_relation(
        e_rel,
        vec![a.clone().into(), b.clone().into(), Value::Int(10)],
    )
    .unwrap();

    // Add edge in reverse direction
    db.add_relation(e_rel, vec![b.into(), a.into(), Value::Int(3)])
        .unwrap();

    assert_eq!(db.opdag().len(), 5); // 2 entities + 3 relations
}

#[test]
fn test_weighted_graph_type_errors() {
    let theory = make_theory(
        r#"
        theory WeightedGraph {
            V : Sort;
            E : [src: V, tgt: V, weight: Int] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a = db.add_entity(v_sort).unwrap();
    let b = db.add_entity(v_sort).unwrap();

    // Error: passing entity where Int expected
    let err = db
        .add_relation(
            e_rel,
            vec![a.clone().into(), b.clone().into(), a.clone().into()],
        )
        .unwrap_err();
    assert!(err.message.contains("Int"));

    // Error: passing Int where entity expected
    let err = db
        .add_relation(e_rel, vec![Value::Int(1), b.clone().into(), Value::Int(5)])
        .unwrap_err();
    assert!(err.message.contains("Int"));

    // Error: passing Str where Int expected
    let err = db
        .add_relation(
            e_rel,
            vec![a.into(), b.into(), Value::Str("hello".to_string())],
        )
        .unwrap_err();
    assert!(err.message.contains("Str"));
}

#[test]
fn test_labeled_graph_with_str() {
    let theory = make_theory(
        r#"
        theory LabeledGraph {
            V : Sort;
            E : [src: V, tgt: V, label: Str] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a = db.add_entity(v_sort).unwrap();
    let b = db.add_entity(v_sort).unwrap();

    // Add edge with label "friend"
    db.add_relation(
        e_rel,
        vec![
            a.clone().into(),
            b.clone().into(),
            Value::Str("friend".to_string()),
        ],
    )
    .unwrap();

    // Add edge with label "colleague"
    db.add_relation(
        e_rel,
        vec![a.into(), b.into(), Value::Str("colleague".to_string())],
    )
    .unwrap();

    assert_eq!(db.opdag().len(), 4); // 2 entities + 2 relations
}

// ============================================================
// Phase 6: Implicit Int/Str Binding (Bidirectional Type Checking)
// ============================================================

#[test]
fn test_weighted_graph_unique_weight_axiom() {
    // This is the key use case: weighted graphs where each edge has a unique weight.
    // Int variables (n1, n2) are implicitly bound from the relation pattern,
    // not explicitly quantified (since Int is infinite).
    let theory = make_theory(
        r#"
        theory WeightedGraph {
            V : Sort;
            E : [src: V, tgt: V, weight: Int] -> Prop;
            // Unique weight: each edge (v1, v2) has at most one weight
            ax/unique_weight : forall v1 : V, v2 : V.
                [src: v1, tgt: v2, weight: n1] E /\ [src: v1, tgt: v2, weight: n2] E 
                |- n1 = n2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a = db.add_entity(v_sort).unwrap();
    let b = db.add_entity(v_sort).unwrap();

    // Add edge a->b with weight 5
    db.add_relation(
        e_rel,
        vec![a.clone().into(), b.clone().into(), Value::Int(5)],
    )
    .unwrap();

    // This should FAIL: adding a->b with weight 10 violates unique_weight axiom
    let err = db
        .add_relation(
            e_rel,
            vec![a.clone().into(), b.clone().into(), Value::Int(10)],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("unique_weight"),
        "Expected unique_weight axiom violation, got: {}",
        err
    );

    // This should SUCCEED: different edge (b->a) can have any weight
    db.add_relation(
        e_rel,
        vec![b.clone().into(), a.clone().into(), Value::Int(10)],
    )
    .unwrap();

    // This should SUCCEED: adding the same edge again (idempotent)
    db.add_relation(
        e_rel,
        vec![a.clone().into(), b.clone().into(), Value::Int(5)],
    )
    .unwrap();

    assert_eq!(db.opdag().len(), 5); // 2 entities + 3 relations (one duplicate)
}

#[test]
fn test_int_equality_in_axioms() {
    // Test that Int equality works correctly in axiom checking
    let theory = make_theory(
        r#"
        theory TaggedGraph {
            V : Sort;
            Tag : [vertex: V, value: Int] -> Prop;
            // Each vertex has at most one tag value
            ax/unique_tag : forall v : V.
                [vertex: v, value: n1] Tag /\ [vertex: v, value: n2] Tag
                |- n1 = n2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let tag_rel = theory.signature.lookup_rel("Tag").unwrap();

    let mut db = Database::from_theory(theory);

    let v0 = db.add_entity(v_sort).unwrap();
    let v1 = db.add_entity(v_sort).unwrap();

    // Tag v0 with value 100
    db.add_relation(tag_rel, vec![v0.clone().into(), Value::Int(100)])
        .unwrap();

    // Tag v1 with value 200 (different vertex, OK)
    db.add_relation(tag_rel, vec![v1.clone().into(), Value::Int(200)])
        .unwrap();

    // Try to tag v0 with different value - should fail
    let err = db
        .add_relation(tag_rel, vec![v0.clone().into(), Value::Int(999)])
        .unwrap_err();
    assert!(
        err.to_string().contains("unique_tag"),
        "Expected unique_tag axiom violation, got: {}",
        err
    );

    // Tagging v0 with same value again should succeed (idempotent)
    db.add_relation(tag_rel, vec![v0.into(), Value::Int(100)])
        .unwrap();

    assert_eq!(db.opdag().len(), 5); // 2 entities + 3 relations
}

#[test]
fn test_labeled_edges_unique_label() {
    // Test Str implicit binding with a unique label constraint
    let theory = make_theory(
        r#"
        theory LabeledGraph {
            V : Sort;
            E : [src: V, tgt: V, label: Str] -> Prop;
            // Each edge has at most one label
            ax/unique_label : forall v1 : V, v2 : V.
                [src: v1, tgt: v2, label: s1] E /\ [src: v1, tgt: v2, label: s2] E
                |- s1 = s2;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db = Database::from_theory(theory);

    let a = db.add_entity(v_sort).unwrap();
    let b = db.add_entity(v_sort).unwrap();

    // Add edge a->b with label "friend"
    db.add_relation(
        e_rel,
        vec![
            a.clone().into(),
            b.clone().into(),
            Value::Str("friend".to_string()),
        ],
    )
    .unwrap();

    // This should FAIL: same edge with different label
    let err = db
        .add_relation(
            e_rel,
            vec![
                a.clone().into(),
                b.clone().into(),
                Value::Str("enemy".to_string()),
            ],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("unique_label"),
        "Expected unique_label axiom violation, got: {}",
        err
    );

    // Different edge (b->a) can have any label
    db.add_relation(
        e_rel,
        vec![
            b.clone().into(),
            a.clone().into(),
            Value::Str("colleague".to_string()),
        ],
    )
    .unwrap();

    assert_eq!(db.opdag().len(), 4); // 2 entities + 2 relations
}

// ============================================================
// Phase 7: Collaboration via OpDag
// ============================================================

#[test]
fn test_database_sync_between_peers() {
    // Simulate two databases syncing their operations
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    // Create two databases from the same theory
    let mut db1 = Database::from_theory(theory.clone());
    let mut db2 = Database::from_theory(theory);

    // db1 adds two entities and an edge
    let v0 = db1.add_entity(v_sort).unwrap();
    let v1 = db1.add_entity(v_sort).unwrap();
    db1.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();

    // db2 has nothing yet
    assert_eq!(db2.opdag().len(), 0);

    // Sync: db1 sends all ops to db2
    let patch = db1.create_patch(&[]); // empty known_heads = send everything
    assert_eq!(patch.ops.len(), 3);

    db2.apply_patch(patch);

    // db2 should now have all the same operations
    assert_eq!(db2.opdag().len(), 3);

    // Both should have the same heads
    assert_eq!(db1.heads().len(), db2.heads().len());
}

#[test]
fn test_database_incremental_sync() {
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    let mut db1 = Database::from_theory(theory.clone());
    let mut db2 = Database::from_theory(theory);

    // Initial sync: db1 adds one entity
    let v0 = db1.add_entity(v_sort).unwrap();

    let patch1 = db1.create_patch(&[]);
    db2.apply_patch(patch1);

    // Both have 1 op
    assert_eq!(db1.opdag().len(), 1);
    assert_eq!(db2.opdag().len(), 1);

    // Save db2's heads for incremental sync
    let db2_heads = db2.heads();

    // db1 adds more
    let v1 = db1.add_entity(v_sort).unwrap();
    db1.add_relation(e_rel, vec![v0.clone().into(), v1.clone().into()])
        .unwrap();

    // db1 now has 3 ops, db2 still has 1
    assert_eq!(db1.opdag().len(), 3);
    assert_eq!(db2.opdag().len(), 1);

    // Incremental sync: only send what db2 doesn't have
    let patch2 = db1.create_patch(&db2_heads);
    assert_eq!(patch2.ops.len(), 2); // only the 2 new ops

    db2.apply_patch(patch2);
    assert_eq!(db2.opdag().len(), 3);
}

#[test]
fn test_database_concurrent_operations() {
    // Simulate concurrent operations from two peers
    let theory = make_theory(
        r#"
        theory G {
            V : Sort;
            E : [src: V, tgt: V] -> Prop;
        }
        "#,
    );
    let v_sort = theory.signature.lookup_sort("V").unwrap();
    let e_rel = theory.signature.lookup_rel("E").unwrap();

    // Start with a shared initial state
    let mut db1 = Database::from_theory(theory.clone());
    let v0 = db1.add_entity(v_sort).unwrap();

    // Sync initial state to db2
    let mut db2 = Database::from_theory(theory);
    let initial_patch = db1.create_patch(&[]);
    db2.apply_patch(initial_patch);

    // Now both have the same state
    let shared_heads = db1.heads();

    // Concurrent modifications: db1 and db2 both add entities
    let v1_in_db1 = db1.add_entity(v_sort).unwrap();
    let v1_in_db2 = db2.add_entity(v_sort).unwrap();

    // They also add edges
    db1.add_relation(e_rel, vec![v0.clone().into(), v1_in_db1.clone().into()])
        .unwrap();
    db2.add_relation(e_rel, vec![v0.clone().into(), v1_in_db2.clone().into()])
        .unwrap();

    // db1 has 3 ops (1 shared + 2 new), db2 also has 3 ops
    assert_eq!(db1.opdag().len(), 3);
    assert_eq!(db2.opdag().len(), 3);

    // Sync db2's changes to db1
    let patch_from_db2 = db2.create_patch(&shared_heads);
    assert_eq!(patch_from_db2.ops.len(), 2); // just db2's new ops

    db1.apply_patch(patch_from_db2);

    // Sync db1's changes to db2
    let patch_from_db1 = db1.create_patch(&shared_heads);
    // db1 now has all ops, so patch contains everything db2 doesn't know
    // which is db1's original 2 new ops
    db2.apply_patch(patch_from_db1);

    // Both should now have all 5 ops (1 shared + 2 from db1 + 2 from db2)
    assert_eq!(db1.opdag().len(), 5);
    assert_eq!(db2.opdag().len(), 5);

    // And they should linearize to the same order
    let ops1: Vec<_> = db1.opdag().linearize();
    let ops2: Vec<_> = db2.opdag().linearize();
    assert_eq!(ops1.len(), ops2.len());
}

#[test]
fn test_opdag_direct_api() {
    // Test using OpDag directly
    let sort = SortId::new();
    let e1 = EntityId::new();
    let e2 = EntityId::new();

    let mut dag = OpDag::new();

    // Add operations
    let op1_id = dag.add(Op::AddEntity {
        sort,
        id: e1.clone(),
    });
    let op2_id = dag.add(Op::AddEntity {
        sort,
        id: e2.clone(),
    });

    assert_eq!(dag.len(), 2);
    assert!(dag.heads().contains(&op2_id));
    assert!(!dag.heads().contains(&op1_id)); // op1 is no longer a head

    // Linearize
    let ops = dag.linearize();
    assert_eq!(ops.len(), 2);

    // Create patch
    let patch = dag.create_patch(&[op1_id.clone()]);
    assert_eq!(patch.ops.len(), 1); // just op2

    // Apply patch to new dag
    let mut dag2 = OpDag::new();

    // First insert op1 directly
    dag2.insert(DagOp {
        id: op1_id.clone(),
        parents: vec![],
        op: Op::AddEntity { sort, id: e1 },
    });

    dag2.apply_patch(patch);
    assert_eq!(dag2.len(), 2);
}
