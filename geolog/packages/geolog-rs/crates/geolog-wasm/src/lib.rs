//! WebAssembly bindings for Geolog
//!
//! This crate provides JavaScript bindings for the Geolog core library,
//! designed for integration with automerge-repo for collaborative editing.

use geolog_core::{self as core, parse};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ============================================================================
// Error Helpers
// ============================================================================

/// Create a proper JS Error object from a message
fn js_error(message: &str) -> JsValue {
    js_sys::Error::new(message).into()
}

#[wasm_bindgen(inline_js = "
export class ParseError extends Error {
  constructor(message, line, column, offset, endOffset) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
    this.offset = offset;
    this.endOffset = endOffset;
  }
}
")]
extern "C" {
    #[wasm_bindgen(js_name = ParseError)]
    type JsParseError;

    #[wasm_bindgen(constructor, js_class = "ParseError")]
    fn new(message: &str, line: u32, column: u32, offset: u32, end_offset: u32) -> JsParseError;
}

/// Create a ParseError (extends Error) with source location attributes.
fn parse_error(message: &str, line: u32, column: u32, offset: u32, end_offset: u32) -> JsValue {
    JsParseError::new(message, line, column, offset, end_offset).into()
}

// ============================================================================
// Value and Operation Types (for serde serialization)
// ============================================================================

/// A value in a relation tuple - serialized to/from JS objects
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OpValue {
    Entity { entity: String },
    Int { int: i64 },
    Str { str: String },
}

impl From<&core::Value> for OpValue {
    fn from(v: &core::Value) -> Self {
        match v {
            core::Value::Entity(id) => OpValue::Entity {
                entity: id.0.to_string(),
            },
            core::Value::Int(n) => OpValue::Int { int: *n },
            core::Value::Str(s) => OpValue::Str { str: s.clone() },
        }
    }
}

impl TryFrom<OpValue> for core::Value {
    type Error = String;

    fn try_from(v: OpValue) -> Result<Self, Self::Error> {
        match v {
            OpValue::Entity { entity } => {
                let uuid = uuid::Uuid::parse_str(&entity)
                    .map_err(|e| format!("invalid entity UUID: {}", e))?;
                Ok(core::Value::Entity(core::EntityId(uuid)))
            }
            OpValue::Int { int } => Ok(core::Value::Int(int)),
            OpValue::Str { str } => Ok(core::Value::Str(str)),
        }
    }
}

/// An AddEntity operation result
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEntityOp {
    #[serde(rename = "type")]
    pub op_type: String,
    pub id: String,        // Operation UUID
    pub sort: String,      // Sort UUID (primary identifier)
    pub sort_name: String, // Sort name (for readability)
    pub entity_id: String,
    pub parents: Vec<String>, // Causal parent operation IDs
}

/// An AddRelation operation result
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRelationOp {
    #[serde(rename = "type")]
    pub op_type: String,
    pub id: String,       // Operation UUID
    pub rel: String,      // Relation UUID (primary identifier)
    pub rel_name: String, // Relation name (for readability)
    pub args: Vec<OpValue>,
    pub parents: Vec<String>, // Causal parent operation IDs
}

/// An operation (for passing to/from JS) - uses UUIDs as primary identifiers
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum JsOp {
    #[serde(rename = "addEntity")]
    AddEntity {
        id: String,   // Operation UUID
        sort: String, // Sort UUID
        #[serde(rename = "sortName")]
        sort_name: Option<String>, // Sort name (optional, for readability)
        #[serde(rename = "entityId")]
        entity_id: String,
    },
    #[serde(rename = "addRelation")]
    AddRelation {
        id: String,  // Operation UUID
        rel: String, // Relation UUID
        #[serde(rename = "relName")]
        rel_name: Option<String>, // Relation name (optional, for readability)
        args: Vec<OpValue>,
    },
}

/// A DagOp for JS - includes causal metadata
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsDagOp {
    /// Parent operation IDs (causal dependencies)
    pub parents: Vec<String>,
    /// The operation itself (contains its own id)
    #[serde(flatten)]
    pub op: JsOp,
}

/// A patch containing operations for sync
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsPatch {
    /// Operations in causal order
    pub ops: Vec<JsDagOp>,
    /// Heads after applying these operations
    pub heads: Vec<String>,
}

// ============================================================================
// Theory Serialization Types
// ============================================================================

/// A derived sort for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JsDerivedSort {
    /// A base sort reference
    #[serde(rename = "base")]
    Base { id: String },
    /// A product/record type
    #[serde(rename = "product")]
    Product {
        fields: Vec<(String, JsDerivedSort)>,
    },
    /// Built-in integer
    #[serde(rename = "int")]
    Int,
    /// Built-in string
    #[serde(rename = "str")]
    Str,
}

impl JsDerivedSort {
    fn from_core(ds: &core::DerivedSort) -> Self {
        match ds {
            core::DerivedSort::Base(id) => JsDerivedSort::Base {
                id: id.0.to_string(),
            },
            core::DerivedSort::Product(fields) => JsDerivedSort::Product {
                fields: fields
                    .iter()
                    .map(|(name, sort)| (name.clone(), JsDerivedSort::from_core(sort)))
                    .collect(),
            },
            core::DerivedSort::Int => JsDerivedSort::Int,
            core::DerivedSort::Str => JsDerivedSort::Str,
        }
    }

    fn to_core(&self) -> Result<core::DerivedSort, String> {
        match self {
            JsDerivedSort::Base { id } => {
                let uuid = uuid::Uuid::parse_str(id)
                    .map_err(|e| format!("invalid sort id '{}': {}", id, e))?;
                Ok(core::DerivedSort::Base(core::SortId(uuid)))
            }
            JsDerivedSort::Product { fields } => {
                let core_fields: Result<Vec<(String, core::DerivedSort)>, String> = fields
                    .iter()
                    .map(|(name, sort)| Ok((name.clone(), sort.to_core()?)))
                    .collect();
                Ok(core::DerivedSort::Product(core_fields?))
            }
            JsDerivedSort::Int => Ok(core::DerivedSort::Int),
            JsDerivedSort::Str => Ok(core::DerivedSort::Str),
        }
    }
}

/// A term for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JsTerm {
    #[serde(rename = "var")]
    Var { name: String, sort: JsDerivedSort },
    #[serde(rename = "app")]
    App { func: String, arg: Box<JsTerm> },
    #[serde(rename = "record")]
    Record { fields: Vec<(String, JsTerm)> },
    #[serde(rename = "project")]
    Project { term: Box<JsTerm>, field: String },
}

impl JsTerm {
    fn from_core(term: &core::Term) -> Self {
        match term {
            core::Term::Var(name, sort) => JsTerm::Var {
                name: name.clone(),
                sort: JsDerivedSort::from_core(sort),
            },
            core::Term::App(func_id, arg) => JsTerm::App {
                func: func_id.0.to_string(),
                arg: Box::new(JsTerm::from_core(arg)),
            },
            core::Term::Record(fields) => JsTerm::Record {
                fields: fields
                    .iter()
                    .map(|(name, term)| (name.clone(), JsTerm::from_core(term)))
                    .collect(),
            },
            core::Term::Project(term, field) => JsTerm::Project {
                term: Box::new(JsTerm::from_core(term)),
                field: field.clone(),
            },
        }
    }

    fn to_core(&self) -> Result<core::Term, String> {
        match self {
            JsTerm::Var { name, sort } => Ok(core::Term::Var(name.clone(), sort.to_core()?)),
            JsTerm::App { func, arg } => {
                let func_id = uuid::Uuid::parse_str(func)
                    .map_err(|e| format!("invalid func id '{}': {}", func, e))?;
                Ok(core::Term::App(
                    core::FuncId(func_id),
                    Box::new(arg.to_core()?),
                ))
            }
            JsTerm::Record { fields } => {
                let core_fields: Result<Vec<(String, core::Term)>, String> = fields
                    .iter()
                    .map(|(name, term)| Ok((name.clone(), term.to_core()?)))
                    .collect();
                Ok(core::Term::Record(core_fields?))
            }
            JsTerm::Project { term, field } => Ok(core::Term::Project(
                Box::new(term.to_core()?),
                field.clone(),
            )),
        }
    }
}

/// A formula for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JsFormula {
    #[serde(rename = "rel")]
    Rel { rel: String, arg: JsTerm },
    #[serde(rename = "true")]
    True,
    #[serde(rename = "false")]
    False,
    #[serde(rename = "conj")]
    Conj { formulas: Vec<JsFormula> },
    #[serde(rename = "disj")]
    Disj { formulas: Vec<JsFormula> },
    #[serde(rename = "eq")]
    Eq { lhs: JsTerm, rhs: JsTerm },
    #[serde(rename = "lt")]
    Lt { lhs: JsTerm, rhs: JsTerm },
    #[serde(rename = "le")]
    Le { lhs: JsTerm, rhs: JsTerm },
    #[serde(rename = "gt")]
    Gt { lhs: JsTerm, rhs: JsTerm },
    #[serde(rename = "ge")]
    Ge { lhs: JsTerm, rhs: JsTerm },
    #[serde(rename = "exists")]
    Exists {
        var: String,
        sort: JsDerivedSort,
        body: Box<JsFormula>,
    },
}

impl JsFormula {
    fn from_core(formula: &core::Formula) -> Self {
        match formula {
            core::Formula::Rel(rel_id, term) => JsFormula::Rel {
                rel: rel_id.0.to_string(),
                arg: JsTerm::from_core(term),
            },
            core::Formula::True => JsFormula::True,
            core::Formula::False => JsFormula::False,
            core::Formula::Conj(formulas) => JsFormula::Conj {
                formulas: formulas.iter().map(JsFormula::from_core).collect(),
            },
            core::Formula::Disj(formulas) => JsFormula::Disj {
                formulas: formulas.iter().map(JsFormula::from_core).collect(),
            },
            core::Formula::Eq(lhs, rhs) => JsFormula::Eq {
                lhs: JsTerm::from_core(lhs),
                rhs: JsTerm::from_core(rhs),
            },
            core::Formula::Lt(lhs, rhs) => JsFormula::Lt {
                lhs: JsTerm::from_core(lhs),
                rhs: JsTerm::from_core(rhs),
            },
            core::Formula::Le(lhs, rhs) => JsFormula::Le {
                lhs: JsTerm::from_core(lhs),
                rhs: JsTerm::from_core(rhs),
            },
            core::Formula::Gt(lhs, rhs) => JsFormula::Gt {
                lhs: JsTerm::from_core(lhs),
                rhs: JsTerm::from_core(rhs),
            },
            core::Formula::Ge(lhs, rhs) => JsFormula::Ge {
                lhs: JsTerm::from_core(lhs),
                rhs: JsTerm::from_core(rhs),
            },
            core::Formula::Exists(var, sort, body) => JsFormula::Exists {
                var: var.clone(),
                sort: JsDerivedSort::from_core(sort),
                body: Box::new(JsFormula::from_core(body)),
            },
        }
    }

    fn to_core(&self) -> Result<core::Formula, String> {
        match self {
            JsFormula::Rel { rel, arg } => {
                let rel_id = uuid::Uuid::parse_str(rel)
                    .map_err(|e| format!("invalid rel id '{}': {}", rel, e))?;
                Ok(core::Formula::Rel(core::RelId(rel_id), arg.to_core()?))
            }
            JsFormula::True => Ok(core::Formula::True),
            JsFormula::False => Ok(core::Formula::False),
            JsFormula::Conj { formulas } => {
                let core_formulas: Result<Vec<_>, _> =
                    formulas.iter().map(|f| f.to_core()).collect();
                Ok(core::Formula::Conj(core_formulas?))
            }
            JsFormula::Disj { formulas } => {
                let core_formulas: Result<Vec<_>, _> =
                    formulas.iter().map(|f| f.to_core()).collect();
                Ok(core::Formula::Disj(core_formulas?))
            }
            JsFormula::Eq { lhs, rhs } => Ok(core::Formula::Eq(lhs.to_core()?, rhs.to_core()?)),
            JsFormula::Lt { lhs, rhs } => Ok(core::Formula::Lt(lhs.to_core()?, rhs.to_core()?)),
            JsFormula::Le { lhs, rhs } => Ok(core::Formula::Le(lhs.to_core()?, rhs.to_core()?)),
            JsFormula::Gt { lhs, rhs } => Ok(core::Formula::Gt(lhs.to_core()?, rhs.to_core()?)),
            JsFormula::Ge { lhs, rhs } => Ok(core::Formula::Ge(lhs.to_core()?, rhs.to_core()?)),
            JsFormula::Exists { var, sort, body } => Ok(core::Formula::Exists(
                var.clone(),
                sort.to_core()?,
                Box::new(body.to_core()?),
            )),
        }
    }
}

/// Binding kind for context variables
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JsBindingKind {
    Explicit,
    Implicit,
}

/// A context (variable bindings) for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsContext {
    pub vars: Vec<(String, JsDerivedSort, JsBindingKind)>,
}

impl JsContext {
    fn from_core(ctx: &core::Context) -> Self {
        JsContext {
            vars: ctx
                .vars
                .iter()
                .map(|(name, sort, kind)| {
                    (
                        name.clone(),
                        JsDerivedSort::from_core(sort),
                        match kind {
                            core::BindingKind::Explicit => JsBindingKind::Explicit,
                            core::BindingKind::Implicit => JsBindingKind::Implicit,
                        },
                    )
                })
                .collect(),
        }
    }

    fn to_core(&self) -> Result<core::Context, String> {
        let vars: Result<Vec<(String, core::DerivedSort, core::BindingKind)>, String> = self
            .vars
            .iter()
            .map(|(name, sort, kind)| {
                Ok((
                    name.clone(),
                    sort.to_core()?,
                    match kind {
                        JsBindingKind::Explicit => core::BindingKind::Explicit,
                        JsBindingKind::Implicit => core::BindingKind::Implicit,
                    },
                ))
            })
            .collect();
        Ok(core::Context { vars: vars? })
    }
}

/// A sequent (axiom) for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSequent {
    pub name: String,
    pub context: JsContext,
    pub premise: JsFormula,
    pub conclusion: JsFormula,
}

impl JsSequent {
    fn from_core(seq: &core::Sequent) -> Self {
        JsSequent {
            name: seq.name.clone(),
            context: JsContext::from_core(&seq.context),
            premise: JsFormula::from_core(&seq.premise),
            conclusion: JsFormula::from_core(&seq.conclusion),
        }
    }

    fn to_core(&self) -> Result<core::Sequent, String> {
        Ok(core::Sequent {
            name: self.name.clone(),
            context: self.context.to_core()?,
            premise: self.premise.to_core()?,
            conclusion: self.conclusion.to_core()?,
        })
    }
}

/// A relation symbol for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsRelationSymbol {
    pub id: String,
    pub name: String,
    pub domain: JsDerivedSort,
}

/// A function symbol for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsFunctionSymbol {
    pub id: String,
    pub name: String,
    pub domain: JsDerivedSort,
    pub codomain: JsDerivedSort,
}

/// A sort for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSort {
    pub id: String,
    pub name: String,
}

/// A signature for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSignature {
    pub sorts: Vec<JsSort>,
    pub relations: Vec<JsRelationSymbol>,
    pub functions: Vec<JsFunctionSymbol>,
}

/// A complete theory for JS serialization
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsTheory {
    pub name: String,
    pub signature: JsSignature,
    pub axioms: Vec<JsSequent>,
}

impl JsTheory {
    fn from_core(theory: &core::Theory) -> Self {
        let sig = &theory.signature;

        let sorts = sig
            .sorts
            .iter()
            .map(|(id, name)| JsSort {
                id: id.0.to_string(),
                name: name.clone(),
            })
            .collect();

        let relations = sig
            .relations
            .iter()
            .map(|(_, rel)| JsRelationSymbol {
                id: rel.id.0.to_string(),
                name: rel.name.clone(),
                domain: JsDerivedSort::from_core(&rel.domain),
            })
            .collect();

        let functions = sig
            .functions
            .iter()
            .map(|(_, func)| JsFunctionSymbol {
                id: func.id.0.to_string(),
                name: func.name.clone(),
                domain: JsDerivedSort::from_core(&func.domain),
                codomain: JsDerivedSort::from_core(&func.codomain),
            })
            .collect();

        let axioms = theory.axioms.iter().map(JsSequent::from_core).collect();

        JsTheory {
            name: theory.name.clone(),
            signature: JsSignature {
                sorts,
                relations,
                functions,
            },
            axioms,
        }
    }

    fn to_core(&self) -> Result<core::Theory, String> {
        let mut signature = core::Signature::new();

        // Add sorts
        for sort in &self.signature.sorts {
            let id = uuid::Uuid::parse_str(&sort.id)
                .map_err(|e| format!("invalid sort id '{}': {}", sort.id, e))?;
            signature.add_sort_with_id(core::SortId(id), sort.name.clone());
        }

        // Add relations
        for rel in &self.signature.relations {
            let id = uuid::Uuid::parse_str(&rel.id)
                .map_err(|e| format!("invalid relation id '{}': {}", rel.id, e))?;
            signature.add_relation_with_id(
                core::RelId(id),
                rel.name.clone(),
                rel.domain.to_core()?,
            );
        }

        // Add functions
        for func in &self.signature.functions {
            let id = uuid::Uuid::parse_str(&func.id)
                .map_err(|e| format!("invalid function id '{}': {}", func.id, e))?;
            signature.add_function_with_id(
                core::FuncId(id),
                func.name.clone(),
                func.domain.to_core()?,
                func.codomain.to_core()?,
            );
        }

        // Convert axioms
        let axioms: Result<Vec<_>, _> = self.axioms.iter().map(|a| a.to_core()).collect();

        Ok(core::Theory {
            name: self.name.clone(),
            signature,
            axioms: axioms?,
        })
    }
}

// ============================================================================
// Theory
// ============================================================================

/// A parsed theory that provides the schema for a database
#[wasm_bindgen]
pub struct Theory {
    inner: core::Theory,
}

#[wasm_bindgen]
impl Theory {
    /// Get the theory name
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name.clone()
    }

    /// Check if a sort exists by name
    #[wasm_bindgen(js_name = hasSort)]
    pub fn has_sort(&self, name: &str) -> bool {
        self.inner.signature.lookup_sort(name).is_some()
    }

    /// Check if a relation exists by name
    #[wasm_bindgen(js_name = hasRelation)]
    pub fn has_relation(&self, name: &str) -> bool {
        self.inner.signature.lookup_rel(name).is_some()
    }

    /// Export the theory to a JSON-serializable object.
    ///
    /// This includes the full signature (with UUIDs) and all axioms.
    /// Use this to share a theory between peers so they use the same UUIDs.
    #[wasm_bindgen(js_name = export)]
    pub fn export(&self) -> Result<JsValue, JsValue> {
        let js_theory = JsTheory::from_core(&self.inner);
        serde_wasm_bindgen::to_value(&js_theory).map_err(|e| js_error(&e.to_string()))
    }
}

/// Parse a theory from source code
///
/// Throws ParseError if parsing fails.
#[wasm_bindgen(js_name = parseTheory)]
pub fn parse_theory(source: &str) -> Result<Theory, JsValue> {
    // Parse the source
    let file = core::diagnostic::File::new("input", source);
    let ast = match parse(source) {
        Ok(ast) => ast,
        Err(err) => {
            let (line, col) = file.position(err.span.start);
            return Err(parse_error(
                &err.message,
                line as u32,
                col as u32,
                err.span.start,
                err.span.end,
            ));
        }
    };

    // Find the first theory declaration
    let theory_decl = ast
        .declarations
        .iter()
        .find_map(|d| match &d.node {
            core::Declaration::Theory(t) => Some(t),
            _ => None,
        })
        .ok_or_else(|| js_error("no theory found in source"))?;

    // Create elaboration environment and elaborate the theory
    let mut env = core::elaborate::Env::new();
    let elaborated = core::elaborate::elaborate_theory(&mut env, theory_decl)
        .map_err(|elab_err| js_error(&format!("elaboration error: {:?}", elab_err)))?;

    // Extract the theory from elaborated result
    Ok(Theory {
        inner: elaborated.theory,
    })
}

/// Import a theory from a previously exported JSON object.
///
/// Use this to load a theory that was exported by another peer,
/// ensuring both peers use identical UUIDs for sorts and relations.
///
/// Throws if the JSON is invalid or malformed.
#[wasm_bindgen(js_name = importTheory)]
pub fn import_theory(data: JsValue) -> Result<Theory, JsValue> {
    let js_theory: JsTheory =
        serde_wasm_bindgen::from_value(data).map_err(|e| js_error(&e.to_string()))?;

    let inner = js_theory.to_core().map_err(|e| js_error(&e))?;

    Ok(Theory { inner })
}

// ============================================================================
// Database
// ============================================================================

/// A database that derives state from operations
#[wasm_bindgen]
pub struct Database {
    inner: core::Database,
}

/// Create an empty database from a theory
#[wasm_bindgen(js_name = createDatabase)]
pub fn create_database(theory: &Theory) -> Database {
    Database {
        inner: core::Database::from_theory(theory.inner.clone()),
    }
}

/// Create a database from a theory and existing operations.
///
/// Operations should be an array of operation objects with sort/relation UUIDs.
/// Throws if any operation is invalid (malformed UUIDs, unknown sorts/relations).
#[wasm_bindgen(js_name = createDatabaseFromOps)]
pub fn create_database_from_ops(theory: &Theory, ops: JsValue) -> Result<Database, JsValue> {
    // Deserialize the ops array from JS
    let js_ops: Vec<JsOp> =
        serde_wasm_bindgen::from_value(ops).map_err(|e| js_error(&e.to_string()))?;

    // Convert to core::Op and build OpDag
    let mut opdag = core::OpDag::new();

    for (i, js_op) in js_ops.iter().enumerate() {
        let (op, op_id) = convert_js_op_to_core(&js_op)
            .map_err(|e| js_error(&format!("invalid operation at index {}: {}", i, e)))?;

        // Create DagOp with empty parents (we're rebuilding from flat list)
        let dag_op = core::DagOp {
            id: op_id,
            parents: vec![], // Flat import - no causal info
            op,
        };
        opdag.insert(dag_op);
    }

    let db = core::Database::from_opdag(theory.inner.clone(), opdag);
    Ok(Database { inner: db })
}

/// Convert a JS operation to core types using UUIDs
fn convert_js_op_to_core(js_op: &JsOp) -> Result<(core::Op, core::OpId), String> {
    match js_op {
        JsOp::AddEntity {
            id,
            sort,
            sort_name: _,
            entity_id,
        } => {
            let op_id =
                core::OpId(uuid::Uuid::parse_str(id).map_err(|e| format!("invalid op id: {}", e))?);

            // Parse sort UUID directly
            let sort_id = core::SortId(
                uuid::Uuid::parse_str(sort).map_err(|e| format!("invalid sort id: {}", e))?,
            );

            let ent_id = core::EntityId(
                uuid::Uuid::parse_str(entity_id)
                    .map_err(|e| format!("invalid entity id: {}", e))?,
            );
            Ok((
                core::Op::AddEntity {
                    sort: sort_id,
                    id: ent_id,
                },
                op_id,
            ))
        }
        JsOp::AddRelation {
            id,
            rel,
            rel_name: _,
            args,
        } => {
            let op_id =
                core::OpId(uuid::Uuid::parse_str(id).map_err(|e| format!("invalid op id: {}", e))?);

            // Parse relation UUID directly
            let rel_id = core::RelId(
                uuid::Uuid::parse_str(rel).map_err(|e| format!("invalid rel id: {}", e))?,
            );

            let core_args: Result<Vec<core::Value>, String> =
                args.iter().cloned().map(|v| v.try_into()).collect();
            Ok((
                core::Op::AddRelation {
                    rel: rel_id,
                    args: core_args?,
                },
                op_id,
            ))
        }
    }
}

#[wasm_bindgen]
impl Database {
    /// Get the theory name
    #[wasm_bindgen(getter, js_name = theoryName)]
    pub fn theory_name(&self) -> String {
        self.inner.theory().name.clone()
    }

    /// Add an entity of the given sort (by NAME).
    ///
    /// Returns the AddEntityOp to store in automerge.
    /// Throws DbError if the sort doesn't exist.
    #[wasm_bindgen(js_name = addEntity)]
    pub fn add_entity(&mut self, sort_name: &str) -> Result<JsValue, JsValue> {
        // Look up sort by name
        let sort = self
            .inner
            .theory()
            .signature
            .lookup_sort(sort_name)
            .ok_or_else(|| js_error(&format!("unknown sort: '{}'", sort_name)))?;

        // Capture heads BEFORE the operation (these become the op's parents)
        let parents_before: Vec<String> = self
            .inner
            .heads()
            .iter()
            .map(|id| id.0.to_string())
            .collect();

        let entity_id = self
            .inner
            .add_entity(sort)
            .map_err(|e| js_error(&e.message))?;

        // Get the OpId of the just-added operation (it's the head)
        let op_id = self.inner.heads().into_iter().next().unwrap();

        let result = AddEntityOp {
            op_type: "addEntity".to_string(),
            id: op_id.0.to_string(),
            sort: sort.0.to_string(),         // Sort UUID
            sort_name: sort_name.to_string(), // Sort name for readability
            entity_id: entity_id.0.to_string(),
            parents: parents_before,
        };

        serde_wasm_bindgen::to_value(&result).map_err(|e| js_error(&e.to_string()))
    }

    /// Add a relation tuple (relation specified by NAME).
    ///
    /// Returns the AddRelationOp to store in automerge.
    /// Throws DbError on validation failure or axiom violation.
    #[wasm_bindgen(js_name = addRelation)]
    pub fn add_relation(&mut self, rel_name: &str, args: JsValue) -> Result<JsValue, JsValue> {
        // Look up relation by name
        let rel = self
            .inner
            .theory()
            .signature
            .lookup_rel(rel_name)
            .ok_or_else(|| js_error(&format!("unknown relation: '{}'", rel_name)))?;

        // Deserialize args
        let js_args: Vec<OpValue> =
            serde_wasm_bindgen::from_value(args).map_err(|e| js_error(&e.to_string()))?;

        let core_args: Vec<core::Value> = js_args
            .into_iter()
            .map(|v| v.try_into())
            .collect::<Result<_, _>>()
            .map_err(|e: String| js_error(&e))?;

        // Capture heads BEFORE the operation (these become the op's parents)
        let parents_before: Vec<String> = self
            .inner
            .heads()
            .iter()
            .map(|id| id.0.to_string())
            .collect();

        self.inner
            .add_relation(rel, core_args.clone())
            .map_err(|e| js_error(&e.message))?;

        // Get the OpId of the just-added operation
        let op_id = self.inner.heads().into_iter().next().unwrap();

        let result = AddRelationOp {
            op_type: "addRelation".to_string(),
            id: op_id.0.to_string(),
            rel: rel.0.to_string(),         // Relation UUID
            rel_name: rel_name.to_string(), // Relation name for readability
            args: core_args.iter().map(OpValue::from).collect(),
            parents: parents_before,
        };

        serde_wasm_bindgen::to_value(&result).map_err(|e| js_error(&e.to_string()))
    }

    /// Apply an operation from a remote peer, preserving causal parents.
    ///
    /// The op should be a JsDagOp including parent information.
    /// Invalid operations are silently skipped (consistent with collaboration semantics).
    #[wasm_bindgen(js_name = applyOp)]
    pub fn apply_op(&mut self, op: JsValue) -> Result<(), JsValue> {
        let js_dag_op: JsDagOp =
            serde_wasm_bindgen::from_value(op).map_err(|e| js_error(&e.to_string()))?;

        match convert_js_op_to_core(&js_dag_op.op) {
            Ok((core_op, op_id)) => {
                // Parse parents from the JsDagOp
                let parents: Vec<core::OpId> = js_dag_op
                    .parents
                    .iter()
                    .filter_map(|s| uuid::Uuid::parse_str(s).ok().map(core::OpId))
                    .collect();

                let dag_op = core::DagOp {
                    id: op_id,
                    parents, // Use actual causal parents, not fabricated ones
                    op: core_op,
                };
                let patch = core::OpPatch {
                    ops: vec![dag_op],
                    heads: vec![],
                };
                self.inner.apply_patch(patch);
            }
            Err(_) => {
                // Silently skip invalid ops
            }
        }

        Ok(())
    }

    /// Get the current state as a JSON string
    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> String {
        self.inner.to_json()
    }

    /// Check if an entity exists by checking JSON output
    #[wasm_bindgen(js_name = hasEntity)]
    pub fn has_entity(&self, entity_id: &str) -> bool {
        // A simple but not ideal check - we'd want a direct method on Database
        let json = self.inner.to_json();
        json.contains(entity_id)
    }

    /// Get the current DAG heads (operation IDs with no children).
    ///
    /// Returns an array of operation ID strings.
    #[wasm_bindgen(js_name = getHeads)]
    pub fn get_heads(&self) -> Result<JsValue, JsValue> {
        let heads: Vec<String> = self
            .inner
            .heads()
            .iter()
            .map(|id| id.0.to_string())
            .collect();
        serde_wasm_bindgen::to_value(&heads).map_err(|e| js_error(&e.to_string()))
    }

    /// Create a patch for syncing to a peer who knows the given heads.
    ///
    /// Returns operations that the peer doesn't have yet.
    #[wasm_bindgen(js_name = createPatch)]
    pub fn create_patch(&self, known_heads: JsValue) -> Result<JsValue, JsValue> {
        // Parse known_heads from JS
        let known: Vec<String> =
            serde_wasm_bindgen::from_value(known_heads).map_err(|e| js_error(&e.to_string()))?;

        let known_op_ids: Result<Vec<core::OpId>, _> = known
            .iter()
            .map(|s| {
                uuid::Uuid::parse_str(s)
                    .map(core::OpId)
                    .map_err(|e| format!("invalid op id '{}': {}", s, e))
            })
            .collect();
        let known_op_ids = known_op_ids.map_err(|e| js_error(&e))?;

        // Create the patch
        let patch = self.inner.create_patch(&known_op_ids);

        // Convert to JS-friendly format
        let js_patch = convert_patch_to_js(&patch, &self.inner.theory().signature);

        serde_wasm_bindgen::to_value(&js_patch).map_err(|e| js_error(&e.to_string()))
    }

    /// Apply a patch from a remote peer.
    ///
    /// Invalid operations in the patch are silently skipped.
    #[wasm_bindgen(js_name = applyPatch)]
    pub fn apply_patch(&mut self, patch: JsValue) -> Result<(), JsValue> {
        let js_patch: JsPatch =
            serde_wasm_bindgen::from_value(patch).map_err(|e| js_error(&e.to_string()))?;

        // Convert to core patch
        let mut ops = Vec::new();
        for js_dag_op in js_patch.ops {
            // Convert the op (which also extracts the op_id)
            let (core_op, op_id) = match convert_js_op_to_core(&js_dag_op.op) {
                Ok((op, id)) => (op, id),
                Err(_) => continue, // Skip invalid
            };

            // Parse parents
            let parents: Vec<core::OpId> = js_dag_op
                .parents
                .iter()
                .filter_map(|s| uuid::Uuid::parse_str(s).ok().map(core::OpId))
                .collect();

            ops.push(core::DagOp {
                id: op_id,
                parents,
                op: core_op,
            });
        }

        let heads: Vec<core::OpId> = js_patch
            .heads
            .iter()
            .filter_map(|s| uuid::Uuid::parse_str(s).ok().map(core::OpId))
            .collect();

        let patch = core::OpPatch { ops, heads };
        self.inner.apply_patch(patch);

        Ok(())
    }
}

/// Convert a core OpPatch to JS-friendly JsPatch
fn convert_patch_to_js(patch: &core::OpPatch, sig: &core::Signature) -> JsPatch {
    let ops = patch
        .ops
        .iter()
        .map(|dag_op| {
            let js_op = match &dag_op.op {
                core::Op::AddEntity { sort, id } => JsOp::AddEntity {
                    id: dag_op.id.0.to_string(),
                    sort: sort.0.to_string(),
                    sort_name: sig.sort_name(*sort).map(|s| s.to_string()),
                    entity_id: id.0.to_string(),
                },
                core::Op::AddRelation { rel, args } => JsOp::AddRelation {
                    id: dag_op.id.0.to_string(),
                    rel: rel.0.to_string(),
                    rel_name: sig.relation(*rel).map(|r| r.name.clone()),
                    args: args.iter().map(OpValue::from).collect(),
                },
            };

            JsDagOp {
                parents: dag_op.parents.iter().map(|id| id.0.to_string()).collect(),
                op: js_op,
            }
        })
        .collect();

    let heads = patch.heads.iter().map(|id| id.0.to_string()).collect();

    JsPatch { ops, heads }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_theory_basic() {
        let source = r#"
            theory Graph {
                V : Sort;
                E : [src: V, tgt: V] -> Prop;
            }
        "#;

        let theory = parse_theory(source).expect("should parse");
        assert_eq!(theory.name(), "Graph");
        assert!(theory.has_sort("V"));
        assert!(theory.has_relation("E"));
        assert!(!theory.has_sort("Unknown"));
    }

    #[test]
    fn test_op_value_conversion() {
        let entity = OpValue::Entity {
            entity: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        };
        let core_val: core::Value = entity.try_into().unwrap();
        assert!(matches!(core_val, core::Value::Entity(_)));

        let int_val = OpValue::Int { int: 42 };
        let core_int: core::Value = int_val.try_into().unwrap();
        assert_eq!(core_int, core::Value::Int(42));

        let str_val = OpValue::Str {
            str: "hello".to_string(),
        };
        let core_str: core::Value = str_val.try_into().unwrap();
        assert_eq!(core_str, core::Value::Str("hello".to_string()));
    }
}
