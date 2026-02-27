use std::collections::{HashMap, HashSet, VecDeque};

use uuid::Uuid;

use crate::core::{RelId, SortId};

/// A globally unique entity identifier
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EntityId(pub Uuid);

impl EntityId {
    /// Create a new random entity ID
    pub fn new() -> Self {
        EntityId(Uuid::new_v4())
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

/// Values that can appear in operations
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Value {
    /// A reference to an entity
    Entity(EntityId),
    /// An integer value
    Int(i64),
    /// A string value
    Str(String),
}

impl From<EntityId> for Value {
    fn from(id: EntityId) -> Self {
        Value::Entity(id)
    }
}

/// An operation in the DAG
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    /// Add a new entity of the given sort
    AddEntity { sort: SortId, id: EntityId },
    /// Add a relation tuple
    AddRelation { rel: RelId, args: Vec<Value> },
}

/// A unique identifier for an operation in the DAG
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OpId(pub Uuid);

impl OpId {
    /// Create a new random operation ID
    pub fn new() -> Self {
        OpId(Uuid::new_v4())
    }
}

impl Default for OpId {
    fn default() -> Self {
        Self::new()
    }
}

/// An operation with DAG metadata for causal ordering
#[derive(Clone, Debug)]
pub struct DagOp {
    /// Unique identifier for this operation
    pub id: OpId,
    /// IDs of operations that causally precede this one
    pub parents: Vec<OpId>,
    /// The actual operation payload
    pub op: Op,
}

/// A patch containing operations to sync between peers
#[derive(Clone, Debug)]
pub struct OpPatch {
    /// Operations in causal order (parents before children)
    pub ops: Vec<DagOp>,
    /// The heads after applying these operations
    pub heads: Vec<OpId>,
}

/// The operation DAG - a causally-ordered set of operations
///
/// This replaces OpLog for collaborative scenarios. It tracks causal
/// relationships between operations, enabling efficient sync between peers.
#[derive(Clone, Debug, Default)]
pub struct OpDag {
    /// All operations, keyed by their ID
    ops: HashMap<OpId, DagOp>,
    /// Current head(s) of the DAG - operations with no children
    heads: HashSet<OpId>,
}

impl OpDag {
    /// Create a new empty operation DAG
    pub fn new() -> Self {
        OpDag {
            ops: HashMap::new(),
            heads: HashSet::new(),
        }
    }

    /// Add a new operation. Automatically assigns an OpId and sets
    /// parents to the current heads. Returns the assigned OpId.
    pub fn add(&mut self, op: Op) -> OpId {
        let dag_op = DagOp {
            id: OpId::new(),
            parents: self.heads.iter().cloned().collect(),
            op,
        };
        let id = dag_op.id.clone();
        self.insert(dag_op);
        id
    }

    /// Insert a DagOp directly (used when applying patches from peers).
    /// The DagOp must have valid parent references (or empty parents for root ops).
    pub fn insert(&mut self, dag_op: DagOp) {
        // Skip if we already have this operation
        if self.ops.contains_key(&dag_op.id) {
            return;
        }

        // Remove parents from heads (they now have a child)
        for parent in &dag_op.parents {
            self.heads.remove(parent);
        }

        // This op becomes a head (until something references it as parent)
        self.heads.insert(dag_op.id.clone());
        self.ops.insert(dag_op.id.clone(), dag_op);
    }

    /// Get the current head operation IDs
    pub fn heads(&self) -> &HashSet<OpId> {
        &self.heads
    }

    /// Check if the DAG is empty
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    /// Get the number of operations in the DAG
    pub fn len(&self) -> usize {
        self.ops.len()
    }

    /// Return operations in a deterministic linear order.
    /// Returns plain `Op`s - the DAG metadata is internal to OpDag.
    ///
    /// Uses topological sort with OpId as tiebreaker for concurrent operations.
    pub fn linearize(&self) -> Vec<&Op> {
        self.linearize_full().into_iter().map(|d| &d.op).collect()
    }

    /// Return DagOps in linearized order (for sync protocol).
    ///
    /// Uses Kahn's algorithm for topological sort, with OpId comparison
    /// as a deterministic tiebreaker for concurrent operations.
    pub fn linearize_full(&self) -> Vec<&DagOp> {
        if self.ops.is_empty() {
            return vec![];
        }

        // Build in-degree map (count of unprocessed parents)
        let mut in_degree: HashMap<&OpId, usize> = HashMap::new();
        for (id, dag_op) in &self.ops {
            in_degree.entry(id).or_insert(0);
            for parent in &dag_op.parents {
                // Only count parents that exist in our DAG
                if self.ops.contains_key(parent) {
                    *in_degree.entry(id).or_insert(0) += 1;
                }
            }
        }

        // Find initial roots (ops with no parents in the DAG)
        let mut ready: Vec<&OpId> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        // Sort for determinism - smallest OpId first
        ready.sort();

        let mut result = Vec::with_capacity(self.ops.len());

        while let Some(id) = ready.pop() {
            let dag_op = &self.ops[id];
            result.push(dag_op);

            // Find children (ops that have this as a parent)
            for (child_id, child_op) in &self.ops {
                if child_op.parents.contains(id) {
                    let deg = in_degree.get_mut(child_id).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        // Insert in sorted position for determinism
                        let pos = ready.binary_search(&child_id).unwrap_or_else(|p| p);
                        ready.insert(pos, child_id);
                    }
                }
            }
        }

        result
    }

    /// Get all operations that are descendants of `known_heads` but not
    /// in `known_heads` itself. Returns DagOps that the caller hasn't seen.
    ///
    /// If `known_heads` is empty, returns all operations.
    pub fn ops_since(&self, known_heads: &[OpId]) -> Vec<&DagOp> {
        if known_heads.is_empty() {
            return self.linearize_full();
        }

        // Find all ancestors of known_heads (including known_heads themselves)
        let mut known_ancestors: HashSet<&OpId> = HashSet::new();
        let mut queue: VecDeque<&OpId> = known_heads.iter().collect();

        while let Some(id) = queue.pop_front() {
            if known_ancestors.contains(id) {
                continue;
            }
            if let Some(dag_op) = self.ops.get(id) {
                known_ancestors.insert(id);
                for parent in &dag_op.parents {
                    queue.push_back(parent);
                }
            }
        }

        // Return ops not in known_ancestors, in linearized order
        self.linearize_full()
            .into_iter()
            .filter(|dag_op| !known_ancestors.contains(&dag_op.id))
            .collect()
    }

    /// Create a patch for syncing to a peer who knows `known_heads`
    pub fn create_patch(&self, known_heads: &[OpId]) -> OpPatch {
        OpPatch {
            ops: self.ops_since(known_heads).into_iter().cloned().collect(),
            heads: self.heads.iter().cloned().collect(),
        }
    }

    /// Apply a patch received from a peer
    pub fn apply_patch(&mut self, patch: OpPatch) {
        for op in patch.ops {
            self.insert(op);
        }
        // Heads are automatically recomputed by insert()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_opdag_empty() {
        let dag = OpDag::new();
        assert!(dag.is_empty());
        assert_eq!(dag.len(), 0);
        assert!(dag.heads().is_empty());
        assert!(dag.linearize().is_empty());
    }

    #[test]
    fn test_opdag_add_single() {
        let mut dag = OpDag::new();
        let sort = SortId::new();
        let entity_id = EntityId::new();

        let op_id = dag.add(Op::AddEntity {
            sort,
            id: entity_id.clone(),
        });

        assert_eq!(dag.len(), 1);
        assert_eq!(dag.heads().len(), 1);
        assert!(dag.heads().contains(&op_id));

        let ops = dag.linearize();
        assert_eq!(ops.len(), 1);
        match &ops[0] {
            Op::AddEntity { id, .. } => assert_eq!(id, &entity_id),
            _ => panic!("expected AddEntity"),
        }
    }

    #[test]
    fn test_opdag_linear_chain() {
        let mut dag = OpDag::new();
        let sort = SortId::new();

        // Add three ops in sequence
        let id1 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        let id2 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        let id3 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });

        assert_eq!(dag.len(), 3);
        // Only the last op should be a head
        assert_eq!(dag.heads().len(), 1);
        assert!(dag.heads().contains(&id3));

        // Check parent relationships
        let dag_op1 = &dag.ops[&id1];
        let dag_op2 = &dag.ops[&id2];
        let dag_op3 = &dag.ops[&id3];

        assert!(dag_op1.parents.is_empty());
        assert_eq!(dag_op2.parents, vec![id1.clone()]);
        assert_eq!(dag_op3.parents, vec![id2.clone()]);

        // Linearization should be in order
        let ops = dag.linearize_full();
        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].id, id1);
        assert_eq!(ops[1].id, id2);
        assert_eq!(ops[2].id, id3);
    }

    #[test]
    fn test_opdag_concurrent_ops() {
        let mut dag = OpDag::new();
        let sort = SortId::new();

        // Create a root op
        let root_id = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });

        // Simulate concurrent ops by inserting DagOps directly
        // Both have root as parent (as if created on different nodes seeing same state)
        let concurrent1 = DagOp {
            id: OpId::new(),
            parents: vec![root_id.clone()],
            op: Op::AddEntity {
                sort,
                id: EntityId::new(),
            },
        };
        let concurrent2 = DagOp {
            id: OpId::new(),
            parents: vec![root_id.clone()],
            op: Op::AddEntity {
                sort,
                id: EntityId::new(),
            },
        };

        let c1_id = concurrent1.id.clone();
        let c2_id = concurrent2.id.clone();

        dag.insert(concurrent1);
        dag.insert(concurrent2);

        assert_eq!(dag.len(), 3);
        // Both concurrent ops should be heads
        assert_eq!(dag.heads().len(), 2);
        assert!(dag.heads().contains(&c1_id));
        assert!(dag.heads().contains(&c2_id));

        // Linearization should be deterministic
        let ops = dag.linearize_full();
        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].id, root_id);
        // Concurrent ops ordered by OpId
        let concurrent_order: Vec<_> = ops[1..].iter().map(|o| &o.id).collect();
        let mut expected = vec![&c1_id, &c2_id];
        expected.sort();
        let mut actual = concurrent_order.clone();
        actual.sort();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_opdag_ops_since_empty() {
        let mut dag = OpDag::new();
        let sort = SortId::new();

        dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });

        // Empty known_heads means return all
        let ops = dag.ops_since(&[]);
        assert_eq!(ops.len(), 2);
    }

    #[test]
    fn test_opdag_ops_since_partial() {
        let mut dag = OpDag::new();
        let sort = SortId::new();

        let id1 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        let id2 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        let _id3 = dag.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });

        // Peer knows up to id1 - should get id2 and id3
        let ops = dag.ops_since(&[id1.clone()]);
        assert_eq!(ops.len(), 2);

        // Peer knows up to id2 - should get only id3
        let ops = dag.ops_since(&[id2]);
        assert_eq!(ops.len(), 1);
    }

    #[test]
    fn test_opdag_patch_roundtrip() {
        let mut dag1 = OpDag::new();
        let sort = SortId::new();

        let id1 = dag1.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });
        dag1.add(Op::AddEntity {
            sort,
            id: EntityId::new(),
        });

        // Create a second DAG that only knows id1
        let mut dag2 = OpDag::new();
        let patch_to_dag2 = dag1.create_patch(&[]);
        // Take only the first op
        let first_op = patch_to_dag2.ops[0].clone();
        dag2.insert(first_op);

        assert_eq!(dag2.len(), 1);

        // Now sync: dag1 creates patch for what dag2 is missing
        let patch = dag1.create_patch(&[id1]);
        assert_eq!(patch.ops.len(), 1); // just the second op

        dag2.apply_patch(patch);
        assert_eq!(dag2.len(), 2);

        // Both DAGs should linearize the same
        let lin1: Vec<_> = dag1.linearize_full().iter().map(|o| &o.id).collect();
        let lin2: Vec<_> = dag2.linearize_full().iter().map(|o| &o.id).collect();
        assert_eq!(lin1, lin2);
    }

    #[test]
    fn test_opdag_insert_idempotent() {
        let mut dag = OpDag::new();
        let sort = SortId::new();

        let dag_op = DagOp {
            id: OpId::new(),
            parents: vec![],
            op: Op::AddEntity {
                sort,
                id: EntityId::new(),
            },
        };

        dag.insert(dag_op.clone());
        dag.insert(dag_op.clone());
        dag.insert(dag_op);

        assert_eq!(dag.len(), 1);
    }
}
