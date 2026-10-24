use crate::{CapabilityId, CollectionId, FieldId, ObservationPath, StateId, SymbolDomainId, SymbolId, TypeId};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// No floating-point value is part of the shared deterministic data model.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DomainValue {
    Null,
    Bool(bool),
    Integer(i64),
    Fixed { coefficient: i64, scale: u8 },
    String(String),
    Enum(SymbolId),
    Entity(crate::EntityId),
    List(Vec<DomainValue>),
    Record(BTreeMap<FieldId, DomainValue>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", content = "value", rename_all = "snake_case")]
pub enum Observed<T> {
    Known(T),
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Truth {
    True,
    False,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DomainType {
    Bool,
    Integer { min: Option<i64>, max: Option<i64> },
    Fixed { scale: u8, min: Option<i64>, max: Option<i64> },
    String { max_bytes: u32 },
    Enum { domain: SymbolDomainId, values: BTreeSet<SymbolId> },
    Entity { entity_type: Option<TypeId> },
    Optional(Box<DomainType>),
    List { element: Box<DomainType>, max_items: u32 },
    Vector { element: Box<DomainType>, max_items: u32 },
    Matrix { element: Box<DomainType>, max_rows: u32, max_columns: u32 },
    Record { fields: BTreeMap<FieldId, DomainType> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Public,
    OwningSide,
    EnemyVisible,
    Internal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservationFieldSchema {
    pub value_type: DomainType,
    pub visibility: Visibility,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionSchema {
    pub element_type: TypeId,
    pub max_items: u32,
    pub visibility: Visibility,
    /// Every observable collection has a package-defined stable order.
    pub order_by: Vec<crate::FieldPath>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FieldPath(pub String);

impl FieldPath {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParameterSchema {
    pub id: crate::ParameterId,
    pub value_type: DomainType,
    pub optional: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilitySchema {
    pub arguments: Vec<ParameterSchema>,
    pub target_type: Option<TypeId>,
    pub phases: BTreeSet<crate::PhaseId>,
    pub preconditions: Vec<crate::RuleExpression>,
    pub issue_cost: crate::CostOperationId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainSchema {
    pub schema_version: crate::Version,
    /// Fields required to construct a SenkeiSnapshot's preparation/configuration data.
    pub senkei_configuration: BTreeMap<FieldId, ConfigurationFieldSchema>,
    pub observation_fields: BTreeMap<ObservationPath, ObservationFieldSchema>,
    pub collections: BTreeMap<CollectionId, CollectionSchema>,
    pub capabilities: BTreeMap<CapabilityId, CapabilitySchema>,
    pub tactical_memory: BTreeMap<StateId, DomainType>,
    pub symbol_domains: BTreeMap<SymbolDomainId, BTreeSet<SymbolId>>,
    pub max_expression_depth: u32,
    pub max_collection_items: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigurationFieldSchema {
    pub value_type: DomainType,
    pub required: bool,
    pub default: Option<DomainValue>,
}
