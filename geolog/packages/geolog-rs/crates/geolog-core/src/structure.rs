//! Structure: Storage for theory instances
//!
//! A Structure is a model/instance of a theory — a functor from the signature to FinSet:
//! - Each sort maps to a finite set of elements
//! - Each function symbol maps to a function between those sets
//! - Each relation symbol maps to a set of tuples
//!
//! This module uses a simplified identity system with UUIDs instead of the complex
//! Slid/Luid/Universe machinery from geolog-zeta. This trades some performance
//! for significantly simpler code.

use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::core::{FuncId, RelId, SortId};

// ============ Element Identity ============

/// A unique identifier for an element in a structure.
///
/// This is a newtype wrapper around UUID for type safety.
/// Unlike geolog-zeta's Slid/Luid system, we use UUIDs everywhere
/// for simplicity. This means:
/// - No Universe interning needed
/// - HashMap lookups instead of array indexing
/// - 128-bit IDs instead of 32-bit
///
/// Performance can be optimized later if profiling shows issues.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ElementId(pub Uuid);

impl ElementId {
    /// Create a new random element ID
    pub fn new() -> Self {
        ElementId(Uuid::new_v4())
    }

    /// Create an element ID from an existing UUID
    pub fn from_uuid(uuid: Uuid) -> Self {
        ElementId(uuid)
    }

    /// Get the underlying UUID
    pub fn uuid(&self) -> Uuid {
        self.0
    }
}

impl Default for ElementId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for ElementId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Use a short representation for readability
        write!(f, "{}", &self.0.to_string()[..8])
    }
}

// ============ Function Storage ============

/// Storage for function values.
///
/// Functions are total: every element in the domain must have exactly one
/// value in the codomain. This enum handles different domain/codomain shapes.
#[derive(Clone, Debug)]
pub enum FunctionData {
    /// Base domain -> Base codomain: single ElementId maps to single ElementId
    /// Example: `src : E -> V`
    BaseToBase(HashMap<ElementId, ElementId>),

    /// Product domain -> Base codomain: tuple of ElementIds maps to single ElementId
    /// Example: `mul : [x: M, y: M] -> M`
    ProductToBase(HashMap<Vec<ElementId>, ElementId>),

    /// Base domain -> Product codomain: single ElementId maps to record of ElementIds
    /// Example: `endpoints : E -> [src: V, tgt: V]`
    BaseToProduct {
        field_names: Vec<String>,
        data: HashMap<ElementId, Vec<ElementId>>,
    },
}

impl FunctionData {
    /// Create empty base-to-base function storage
    pub fn new_base_to_base() -> Self {
        FunctionData::BaseToBase(HashMap::new())
    }

    /// Create empty product-to-base function storage
    pub fn new_product_to_base() -> Self {
        FunctionData::ProductToBase(HashMap::new())
    }

    /// Create empty base-to-product function storage
    pub fn new_base_to_product(field_names: Vec<String>) -> Self {
        FunctionData::BaseToProduct {
            field_names,
            data: HashMap::new(),
        }
    }

    /// Define a base-to-base function value
    pub fn define_base(&mut self, domain: ElementId, codomain: ElementId) -> Result<(), String> {
        match self {
            FunctionData::BaseToBase(map) => {
                if let Some(existing) = map.get(&domain) {
                    if *existing != codomain {
                        return Err(format!(
                            "conflicting definition: {} already maps to {}, cannot redefine to {}",
                            domain, existing, codomain
                        ));
                    }
                }
                map.insert(domain, codomain);
                Ok(())
            }
            _ => Err("define_base called on non-BaseToBase function".to_string()),
        }
    }

    /// Define a product-to-base function value
    pub fn define_product(
        &mut self,
        domain: Vec<ElementId>,
        codomain: ElementId,
    ) -> Result<(), String> {
        match self {
            FunctionData::ProductToBase(map) => {
                if let Some(existing) = map.get(&domain) {
                    if *existing != codomain {
                        return Err(format!(
                            "conflicting definition: {:?} already maps to {}, cannot redefine to {}",
                            domain, existing, codomain
                        ));
                    }
                }
                map.insert(domain, codomain);
                Ok(())
            }
            _ => Err("define_product called on non-ProductToBase function".to_string()),
        }
    }

    /// Define a base-to-product function value
    pub fn define_record(
        &mut self,
        domain: ElementId,
        codomain: Vec<ElementId>,
    ) -> Result<(), String> {
        match self {
            FunctionData::BaseToProduct { data, field_names } => {
                if codomain.len() != field_names.len() {
                    return Err(format!(
                        "wrong number of fields: expected {}, got {}",
                        field_names.len(),
                        codomain.len()
                    ));
                }
                if let Some(existing) = data.get(&domain) {
                    if *existing != codomain {
                        return Err(format!(
                            "conflicting definition: {} already maps to {:?}, cannot redefine to {:?}",
                            domain, existing, codomain
                        ));
                    }
                }
                data.insert(domain, codomain);
                Ok(())
            }
            _ => Err("define_record called on non-BaseToProduct function".to_string()),
        }
    }

    /// Get a base-to-base function value
    pub fn get_base(&self, domain: ElementId) -> Option<ElementId> {
        match self {
            FunctionData::BaseToBase(map) => map.get(&domain).copied(),
            _ => None,
        }
    }

    /// Get a product-to-base function value
    pub fn get_product(&self, domain: &[ElementId]) -> Option<ElementId> {
        match self {
            FunctionData::ProductToBase(map) => map.get(domain).copied(),
            _ => None,
        }
    }

    /// Get a base-to-product function value
    pub fn get_record(&self, domain: ElementId) -> Option<&Vec<ElementId>> {
        match self {
            FunctionData::BaseToProduct { data, .. } => data.get(&domain),
            _ => None,
        }
    }

    /// Get the number of defined entries
    pub fn len(&self) -> usize {
        match self {
            FunctionData::BaseToBase(map) => map.len(),
            FunctionData::ProductToBase(map) => map.len(),
            FunctionData::BaseToProduct { data, .. } => data.len(),
        }
    }

    /// Check if the function has no defined entries
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ============ Relation Storage ============

/// Storage for relation tuples.
///
/// A relation is a set of tuples from the product of its domain sorts.
#[derive(Clone, Debug)]
pub struct RelationData {
    /// Arity of the relation (number of elements per tuple)
    pub arity: usize,
    /// Set of tuples currently in the relation
    pub tuples: HashSet<Vec<ElementId>>,
}

impl RelationData {
    /// Create empty relation storage with given arity
    pub fn new(arity: usize) -> Self {
        RelationData {
            arity,
            tuples: HashSet::new(),
        }
    }

    /// Insert a tuple into the relation
    /// Returns true if the tuple was newly inserted
    pub fn insert(&mut self, tuple: Vec<ElementId>) -> bool {
        debug_assert_eq!(tuple.len(), self.arity, "tuple arity mismatch");
        self.tuples.insert(tuple)
    }

    /// Remove a tuple from the relation
    /// Returns true if the tuple was present
    pub fn remove(&mut self, tuple: &[ElementId]) -> bool {
        self.tuples.remove(tuple)
    }

    /// Check if a tuple is in the relation
    pub fn contains(&self, tuple: &[ElementId]) -> bool {
        self.tuples.contains(tuple)
    }

    /// Get the number of tuples in the relation
    pub fn len(&self) -> usize {
        self.tuples.len()
    }

    /// Check if the relation is empty
    pub fn is_empty(&self) -> bool {
        self.tuples.is_empty()
    }

    /// Iterate over all tuples
    pub fn iter(&self) -> impl Iterator<Item = &Vec<ElementId>> {
        self.tuples.iter()
    }
}

// ============ Structure ============

/// A structure: interpretation of a signature in FinSet.
///
/// This is a model/instance of a theory — a functor from the signature to FinSet:
/// - Each sort maps to a finite set of elements (carriers)
/// - Each function symbol maps to a function between those sets
/// - Each relation symbol maps to a set of tuples
///
/// Elements are identified by UUIDs (via ElementId) for simplicity.
/// Human-readable names can be stored separately in a naming index.
#[derive(Clone, Debug, Default)]
pub struct Structure {
    /// Name of the theory this is an instance of (if known)
    pub theory_name: Option<String>,

    /// All elements with their sorts: ElementId -> SortId
    pub elements: HashMap<ElementId, SortId>,

    /// Carriers: SortId -> Set of ElementIds in that sort
    pub carriers: HashMap<SortId, HashSet<ElementId>>,

    /// Functions: FuncId -> FunctionData
    pub functions: HashMap<FuncId, FunctionData>,

    /// Relations: RelId -> RelationData
    pub relations: HashMap<RelId, RelationData>,

    /// Element names (optional, for debugging/display)
    pub names: HashMap<ElementId, String>,

    /// Reverse name lookup
    pub name_to_id: HashMap<String, ElementId>,

    /// Parent instances for parameterized theories
    /// Maps param name -> UUID of parent instance
    pub parents: HashMap<String, Uuid>,

    /// Nested structures (for instance-valued fields)
    pub nested: HashMap<String, Structure>,
}

impl Structure {
    /// Create a new empty structure
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a structure that is an instance of the given theory
    pub fn for_theory(theory_name: impl Into<String>) -> Self {
        let mut s = Self::new();
        s.theory_name = Some(theory_name.into());
        s
    }

    /// Initialize a carrier for a sort
    pub fn init_carrier(&mut self, sort_id: SortId) {
        self.carriers.entry(sort_id).or_insert_with(HashSet::new);
    }

    /// Initialize function storage for a function
    pub fn init_function(&mut self, func_id: FuncId, data: FunctionData) {
        self.functions.insert(func_id, data);
    }

    /// Initialize relation storage for a relation
    pub fn init_relation(&mut self, rel_id: RelId, arity: usize) {
        self.relations.insert(rel_id, RelationData::new(arity));
    }

    /// Add a new element to the structure
    pub fn add_element(&mut self, sort_id: SortId) -> ElementId {
        let id = ElementId::new();
        self.add_element_with_id(id, sort_id);
        id
    }

    /// Add a new element with a specific ID
    pub fn add_element_with_id(&mut self, id: ElementId, sort_id: SortId) {
        self.elements.insert(id, sort_id);
        self.carriers
            .entry(sort_id)
            .or_insert_with(HashSet::new)
            .insert(id);
    }

    /// Add a new element with a name
    pub fn add_named_element(&mut self, name: impl Into<String>, sort_id: SortId) -> ElementId {
        let id = self.add_element(sort_id);
        let name = name.into();
        self.names.insert(id, name.clone());
        self.name_to_id.insert(name, id);
        id
    }

    /// Get the sort of an element
    pub fn get_sort(&self, id: ElementId) -> Option<SortId> {
        self.elements.get(&id).copied()
    }

    /// Get the name of an element
    pub fn get_name(&self, id: ElementId) -> Option<&str> {
        self.names.get(&id).map(|s| s.as_str())
    }

    /// Get an element by name
    pub fn get_by_name(&self, name: &str) -> Option<ElementId> {
        self.name_to_id.get(name).copied()
    }

    /// Get the carrier for a sort
    pub fn carrier(&self, sort_id: SortId) -> Option<&HashSet<ElementId>> {
        self.carriers.get(&sort_id)
    }

    /// Get the carrier for a sort, or empty set
    pub fn carrier_or_empty(&self, sort_id: SortId) -> &HashSet<ElementId> {
        use std::sync::LazyLock;
        static EMPTY: LazyLock<HashSet<ElementId>> = LazyLock::new(HashSet::new);
        self.carriers.get(&sort_id).unwrap_or(&EMPTY)
    }

    /// Get the size of a carrier
    pub fn carrier_size(&self, sort_id: SortId) -> usize {
        self.carriers.get(&sort_id).map(|c| c.len()).unwrap_or(0)
    }

    /// Get the total number of elements
    pub fn num_elements(&self) -> usize {
        self.elements.len()
    }

    /// Get the number of sorts with carriers
    pub fn num_sorts(&self) -> usize {
        self.carriers.len()
    }

    /// Define a base-to-base function value
    pub fn define_function(
        &mut self,
        func_id: FuncId,
        domain: ElementId,
        codomain: ElementId,
    ) -> Result<(), String> {
        let func = self
            .functions
            .get_mut(&func_id)
            .ok_or_else(|| format!("function {} not initialized", func_id))?;
        func.define_base(domain, codomain)
    }

    /// Define a product-to-base function value
    pub fn define_function_product(
        &mut self,
        func_id: FuncId,
        domain: Vec<ElementId>,
        codomain: ElementId,
    ) -> Result<(), String> {
        let func = self
            .functions
            .get_mut(&func_id)
            .ok_or_else(|| format!("function {} not initialized", func_id))?;
        func.define_product(domain, codomain)
    }

    /// Get a base-to-base function value
    pub fn get_function(&self, func_id: FuncId, domain: ElementId) -> Option<ElementId> {
        self.functions.get(&func_id)?.get_base(domain)
    }

    /// Get a product-to-base function value
    pub fn get_function_product(&self, func_id: FuncId, domain: &[ElementId]) -> Option<ElementId> {
        self.functions.get(&func_id)?.get_product(domain)
    }

    /// Assert a tuple in a relation
    pub fn assert_relation(&mut self, rel_id: RelId, tuple: Vec<ElementId>) -> bool {
        if let Some(rel) = self.relations.get_mut(&rel_id) {
            rel.insert(tuple)
        } else {
            false
        }
    }

    /// Retract a tuple from a relation
    pub fn retract_relation(&mut self, rel_id: RelId, tuple: &[ElementId]) -> bool {
        if let Some(rel) = self.relations.get_mut(&rel_id) {
            rel.remove(tuple)
        } else {
            false
        }
    }

    /// Check if a tuple is in a relation
    pub fn query_relation(&self, rel_id: RelId, tuple: &[ElementId]) -> bool {
        self.relations
            .get(&rel_id)
            .map(|r| r.contains(tuple))
            .unwrap_or(false)
    }

    /// Get the number of tuples in a relation
    pub fn relation_size(&self, rel_id: RelId) -> usize {
        self.relations.get(&rel_id).map(|r| r.len()).unwrap_or(0)
    }

    /// Iterate over all relation IDs
    pub fn rel_ids(&self) -> impl Iterator<Item = RelId> + '_ {
        self.relations.keys().copied()
    }

    /// Get relation data
    pub fn relation(&self, rel_id: RelId) -> Option<&RelationData> {
        self.relations.get(&rel_id)
    }

    /// Add a nested structure
    pub fn add_nested(&mut self, name: impl Into<String>, structure: Structure) {
        self.nested.insert(name.into(), structure);
    }

    /// Get a nested structure
    pub fn get_nested(&self, name: &str) -> Option<&Structure> {
        self.nested.get(name)
    }

    /// Get a mutable reference to a nested structure
    pub fn get_nested_mut(&mut self, name: &str) -> Option<&mut Structure> {
        self.nested.get_mut(name)
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_element_id() {
        let id1 = ElementId::new();
        let id2 = ElementId::new();
        assert_ne!(id1, id2);

        let id3 = ElementId::from_uuid(id1.uuid());
        assert_eq!(id1, id3);
    }

    #[test]
    fn test_function_data_base_to_base() {
        let mut func = FunctionData::new_base_to_base();
        let a = ElementId::new();
        let b = ElementId::new();

        func.define_base(a, b).unwrap();
        assert_eq!(func.get_base(a), Some(b));
        assert_eq!(func.len(), 1);
    }

    #[test]
    fn test_function_data_conflict() {
        let mut func = FunctionData::new_base_to_base();
        let a = ElementId::new();
        let b = ElementId::new();
        let c = ElementId::new();

        func.define_base(a, b).unwrap();
        let result = func.define_base(a, c);
        assert!(result.is_err());
    }

    #[test]
    fn test_function_data_product() {
        let mut func = FunctionData::new_product_to_base();
        let a = ElementId::new();
        let b = ElementId::new();
        let c = ElementId::new();

        func.define_product(vec![a, b], c).unwrap();
        assert_eq!(func.get_product(&[a, b]), Some(c));
    }

    #[test]
    fn test_relation_data() {
        let mut rel = RelationData::new(2);
        let a = ElementId::new();
        let b = ElementId::new();

        assert!(rel.insert(vec![a, b]));
        assert!(!rel.insert(vec![a, b])); // Duplicate
        assert!(rel.contains(&[a, b]));
        assert!(!rel.contains(&[b, a]));
        assert_eq!(rel.len(), 1);
    }

    #[test]
    fn test_structure_elements() {
        let sort0 = SortId::new();
        let sort1 = SortId::new();
        let mut s = Structure::new();
        let v = s.add_named_element("v1", sort0);
        let e = s.add_named_element("e1", sort1);

        assert_eq!(s.get_sort(v), Some(sort0));
        assert_eq!(s.get_sort(e), Some(sort1));
        assert_eq!(s.get_name(v), Some("v1"));
        assert_eq!(s.get_by_name("v1"), Some(v));
        assert_eq!(s.carrier_size(sort0), 1);
        assert_eq!(s.carrier_size(sort1), 1);
    }

    #[test]
    fn test_structure_functions() {
        let sort0 = SortId::new();
        let sort1 = SortId::new();
        let func_id = FuncId::new();
        let mut s = Structure::new();
        s.init_function(func_id, FunctionData::new_base_to_base());

        let e = s.add_element(sort1);
        let v = s.add_element(sort0);

        s.define_function(func_id, e, v).unwrap();
        assert_eq!(s.get_function(func_id, e), Some(v));
    }

    #[test]
    fn test_structure_relations() {
        let sort0 = SortId::new();
        let rel_id = RelId::new();
        let mut s = Structure::new();
        s.init_relation(rel_id, 2);

        let a = s.add_element(sort0);
        let b = s.add_element(sort0);

        assert!(s.assert_relation(rel_id, vec![a, b]));
        assert!(s.query_relation(rel_id, &[a, b]));
        assert!(!s.query_relation(rel_id, &[b, a]));
    }

    #[test]
    fn test_structure_nested() {
        let mut outer = Structure::new();
        let inner = Structure::new();

        outer.add_nested("child", inner);
        assert!(outer.get_nested("child").is_some());
    }
}
