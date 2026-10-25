//! Public, self-describing view of a validated RulePackage.
//!
//! The catalog contains schema and policy metadata only. It never contains
//! observations or other per-match values. Behavior metadata is an optional,
//! separately authored extension because the current RulePackage model has no
//! Behavior Profile section.

use senkei_model::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const DOMAIN_CATALOG_SCHEMA_VERSION: Version = Version::new(1, 0, 0);
const MAX_PROFILE_TYPE_DEPTH: u32 = 64;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIdentity {
    pub schema_version: Version,
    pub ruleset_id: RulesetId,
    pub ruleset_version: Version,
    /// Digest of the validated RulePackage, as computed by Senritsu.
    pub ruleset_digest: ContentDigest,
    pub minimum_engine_version: Version,
    pub model_version: Version,
    pub primitive_set_id: PrimitiveSetId,
    pub primitive_set_version: Version,
    pub jinrei_language_version: Version,
    pub structured_ast_version: Version,
    pub typed_ir_version: Version,
    pub bytecode_version: Version,
}

impl CatalogIdentity {
    fn from_plan(plan: &VerifiedRulePlan) -> Self {
        let rules = plan.plan();
        Self {
            schema_version: DOMAIN_CATALOG_SCHEMA_VERSION,
            ruleset_id: plan.ruleset().id.clone(),
            ruleset_version: plan.ruleset().version,
            ruleset_digest: plan.package_digest().clone(),
            minimum_engine_version: rules.minimum_engine_version,
            model_version: rules.model_version,
            primitive_set_id: rules.primitive_set_id.clone(),
            primitive_set_version: rules.primitive_set_version,
            jinrei_language_version: rules.jinrei_language_version,
            structured_ast_version: rules.structured_ast_version,
            typed_ir_version: rules.typed_ir_version,
            bytecode_version: rules.bytecode_version,
        }
    }

    pub fn is_same_ruleset(&self, other: &Self) -> bool {
        self.ruleset_id == other.ruleset_id
            && self.ruleset_version == other.ruleset_version
            && self.ruleset_digest == other.ruleset_digest
    }
}

/// Full cache/reference key. Both package and catalog identity participate so
/// changing an authored metadata extension invalidates consumers too.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCompatibilityKey {
    pub identity: CatalogIdentity,
    pub catalog_digest: ContentDigest,
    pub metadata_extension_digest: Option<ContentDigest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct SymbolKey {
    pub domain: SymbolDomainId,
    pub symbol: SymbolId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSymbol {
    pub id: SymbolKey,
    pub display_name: String,
    pub namespace: SymbolDomainId,
    pub category: SymbolCategory,
    pub value_type: DomainType,
    pub finite_domain: BTreeSet<SymbolId>,
    pub allowed_operators: BTreeSet<DomainOperator>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolCategory {
    Constant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainOperator {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
    Known,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationDefinition {
    pub id: ObservationPath,
    pub scope: ObservationScope,
    pub entity_type: Option<TypeId>,
    pub value_type: DomainType,
    pub visibility: Visibility,
    /// A collection's audience is a second required access check for nested fields.
    pub container_visibility: Option<Visibility>,
    pub read_permission: ReadPermission,
    pub knownness: KnownnessContract,
    pub allowed_operators: BTreeSet<DomainOperator>,
    pub unit: Option<String>,
    pub source: ObservationSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "entityType", rename_all = "snake_case")]
pub enum ObservationScope {
    Match,
    PackageEntity(TypeId),
    PackageDomain,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadPermission {
    Public,
    OwningSide,
    EnemyVisibleOnly,
    InternalDenied,
    ParentCollection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KnownnessContract {
    KnownWhenSourceResolves,
    KnownWhenCurrentEntityVisible,
    NeverReadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDefinition {
    pub id: CollectionId,
    pub element_type: TypeId,
    pub max_items: u32,
    pub visibility: Visibility,
    pub source: CollectionSource,
    pub visible_fields: BTreeMap<FieldId, ObservationDefinition>,
    pub deterministic_order_by: Vec<FieldId>,
    pub unique_keys: BTreeSet<CollectionUniqueKey>,
    pub operations: CollectionOperations,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionOperations {
    pub filter: bool,
    pub any: bool,
    pub all: bool,
    pub count: bool,
    pub numeric_aggregates: CollectionAggregates,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionAggregates {
    pub sum: bool,
    pub min: bool,
    pub max: bool,
    pub argmin: bool,
    pub argmax: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDefinition {
    pub id: CapabilityId,
    pub description: Option<String>,
    pub actor_scope: Scope,
    pub version: Option<Version>,
    pub actor_argument: Option<u16>,
    pub arguments: Vec<ParameterSchema>,
    pub target_argument: Option<u16>,
    pub target_argument_type: Option<DomainType>,
    pub target_scope: Option<Scope>,
    pub target_types: BTreeSet<TypeId>,
    pub target_owner: TargetOwnerConstraint,
    pub preconditions: Vec<RuleExpression>,
    pub effect_primitives: BTreeSet<TransitionPrimitiveKind>,
    pub effect_lifetime: CapabilityLifetime,
    pub active_phases: BTreeSet<PhaseId>,
    pub rejection_codes: RejectionMetadata,
    pub logical_cost_reference: CostOperationId,
    pub arbitration: Option<ArbitrationRule>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum CapabilityLifetime {
    IntentOnly,
    UntilNextTick,
    FixedTicks { ticks: u32 },
    UntilRule { rule_id: RuleId },
    Persistent,
    NotDeclaredByRulePackage,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractMetadata {
    pub version: Version,
    pub effect_lifetime: CapabilityLifetime,
    pub rejection_codes: BTreeSet<DiagnosticCode>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RejectionMetadata {
    Declared(BTreeSet<DiagnosticCode>),
    NotDeclaredByRulePackage,
}

/// Entity/application scope inferred only from the entity type in a typed
/// capability argument. Unknown package types keep their original identifier.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "entityType", rename_all = "snake_case")]
pub enum Scope {
    Army,
    Squad,
    Hero,
    MinionLaneLimited,
    PackageEntity(TypeId),
    PackageDomain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityControlScope {
    Army,
    Squad,
    Hero,
    LaneLimitedMinion,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostScheduleDefinition {
    pub id: CostScheduleId,
    pub version: Version,
    pub operations: BTreeMap<CostOperationId, LogicalCuCost>,
    pub per_tick_budget: LogicalCu,
    pub per_match_budget: LogicalCu,
    pub overrun_policy: BudgetOverrunPolicy,
    pub memory_commit_policy: MemoryCommitPolicy,
    pub budget_overrun_reason: SymbolId,
}

/// The RulePackage's exact evaluation phases and per-capability arbitration.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderingContract {
    pub phases: Vec<ExecutionPhase>,
    pub arbitration: BTreeMap<CapabilityId, ArbitrationRule>,
    pub transition_order: Vec<TransitionOrder>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionOrder {
    pub phase: PhaseId,
    pub order: u32,
    pub rule_id: RuleId,
    pub capability: Option<CapabilityId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityTypeDefinition {
    pub id: TypeId,
    pub fields: BTreeMap<FieldId, FieldSchema>,
    pub default_owner: Option<CombatantSide>,
}

/// Describes whether behavior profiles exist in this catalog. The first
/// release of RulePackage has no Profile field, so the normal adapter returns
/// `NotDeclaredByRulePackage` without inventing preset support.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", content = "value", rename_all = "snake_case")]
pub enum MetadataStatus<T> {
    NotDeclaredByRulePackage,
    AuthoredExtension { digest: ContentDigest, metadata: T },
}

/// A separately authored, finite metadata document bound to one exact package
/// identity. It does not alter or become part of that package's digest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMetadataExtension {
    pub schema_version: Version,
    pub ruleset_id: RulesetId,
    pub ruleset_version: Version,
    pub ruleset_digest: ContentDigest,
    /// Optional semantics for package-defined entity types. Missing types
    /// retain the exact package entity type instead of guessing by name.
    pub entity_scopes: BTreeMap<TypeId, EntityControlScope>,
    /// Optional capability version, duration, and rejection vocabulary.
    pub capabilities: BTreeMap<CapabilityId, CapabilityContractMetadata>,
    pub behavior_profiles: BehaviorProfileMetadata,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorProfileMetadata {
    /// Applied from least-specific to most-specific. A source may be omitted
    /// only when the authored RulePackage intentionally does not support it.
    pub inheritance_order: Vec<ProfileLayer>,
    pub fields: BTreeMap<String, BehaviorFieldDefinition>,
    /// Incomplete maps inherit the unspecified fields from the prior layer.
    pub senritsu_default: BTreeMap<String, DomainValue>,
    /// Keys are stable Hero Catalog IDs, never runtime entity IDs.
    pub hero_defaults: BTreeMap<String, BTreeMap<String, DomainValue>>,
    pub presets: BTreeMap<String, NamedBehaviorPreset>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileLayer {
    SenritsuDefault,
    HeroCatalogDefault,
    ArmyPreference,
    SquadAggregate,
    JinreiConditionalPreference,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorFieldDefinition {
    pub value_type: DomainType,
    pub scopes: BTreeSet<BehaviorScope>,
    pub aggregation: Option<AggregationPolicy>,
    pub override_policy: BehaviorOverridePolicy,
    pub description: String,
    pub unit: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorScope {
    Army,
    Squad,
    Hero,
    LaneLimitedMinion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregationPolicy {
    RequireAgreement,
    Minimum,
    Maximum,
    CheckedSum,
    FirstByStableSubjectId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorOverridePolicy {
    /// Jinrei's conditional preference expires with the current Tick.
    pub conditional_tick_override: bool,
    /// Long-lived mutation is permitted only through this declared capability.
    pub persistent_capability: Option<CapabilityId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedBehaviorPreset {
    pub name: String,
    pub scope: BehaviorScope,
    pub values: BTreeMap<String, DomainValue>,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainCatalog {
    identity: CatalogIdentity,
    catalog_digest: ContentDigest,
    metadata_extension_digest: Option<ContentDigest>,
    symbols: Vec<CatalogSymbol>,
    observations: BTreeMap<ObservationPath, ObservationDefinition>,
    collections: BTreeMap<CollectionId, CollectionDefinition>,
    capabilities: BTreeMap<CapabilityId, CapabilityDefinition>,
    entity_types: BTreeMap<TypeId, EntityTypeDefinition>,
    cost_schedule: CostScheduleDefinition,
    ordering: OrderingContract,
    entity_scopes: MetadataStatus<BTreeMap<TypeId, EntityControlScope>>,
    capability_metadata: MetadataStatus<BTreeMap<CapabilityId, CapabilityContractMetadata>>,
    behavior_profiles: MetadataStatus<BehaviorProfileMetadata>,
}

impl DomainCatalog {
    /// Projects a Senritsu-validated plan into a deterministic static catalog.
    pub fn from_verified_plan(plan: &VerifiedRulePlan) -> Result<Self, DomainCatalogError> {
        Self::build(plan, None)
    }

    /// Projects a validated plan and attaches package-bound authored profile
    /// metadata. The extension digest is separate from the RulePackage digest.
    pub fn from_verified_plan_with_extension(
        plan: &VerifiedRulePlan,
        extension: CatalogMetadataExtension,
    ) -> Result<Self, DomainCatalogError> {
        Self::build(plan, Some(extension))
    }

    fn build(
        plan: &VerifiedRulePlan,
        extension: Option<CatalogMetadataExtension>,
    ) -> Result<Self, DomainCatalogError> {
        let rules = plan.plan();
        let identity = CatalogIdentity::from_plan(plan);
        if !plan.package_digest().has_sha256_shape()
            || plan.package_digest() != &plan.ruleset().digest
        {
            return Err(DomainCatalogError::single(
                "invalid_package_identity",
                "RulePlan package digest must match its SHA-256 RulePackage identity",
            ));
        }
        let symbols = build_symbols(&rules.domain.symbol_domains);
        let observations: BTreeMap<_, _> = rules
            .domain
            .observation_fields
            .iter()
            .map(|(path, field)| {
                (
                    path.clone(),
                    observation_definition(
                        path.clone(),
                        None,
                        None,
                        field.value_type.clone(),
                        field.visibility,
                        field.source.clone(),
                    ),
                )
            })
            .collect();
        let collections: BTreeMap<_, _> = rules
            .domain
            .collections
            .iter()
            .map(|(id, schema)| {
                let visible_fields = schema
                    .visible_fields
                    .iter()
                    .map(|(field_id, field)| {
                        (
                            field_id.clone(),
                            observation_definition(
                                ObservationPath::new(field_id.as_str()),
                                Some(schema.element_type.clone()),
                                Some(schema.visibility),
                                field.value_type.clone(),
                                field.visibility,
                                field.source.clone(),
                            ),
                        )
                    })
                    .collect();
                (
                    id.clone(),
                    CollectionDefinition {
                        id: id.clone(),
                        element_type: schema.element_type.clone(),
                        max_items: schema.max_items,
                        visibility: schema.visibility,
                        source: schema.source.clone(),
                        visible_fields,
                        deterministic_order_by: schema.order_by.clone(),
                        unique_keys: schema.unique_keys.clone(),
                        operations: collection_operations(schema),
                    },
                )
            })
            .collect();
        let effects = transition_effects(rules);
        let extension_scopes = extension.as_ref().map(|extension| &extension.entity_scopes);
        let extension_capabilities = extension.as_ref().map(|extension| &extension.capabilities);
        let capabilities = rules
            .domain
            .capabilities
            .iter()
            .map(|(id, schema)| {
                let arbitration = rules.arbitration.get(id).cloned();
                let target_types = schema.target_type.iter().cloned().collect();
                let target_argument_type = schema
                    .target_argument
                    .and_then(|index| schema.arguments.get(index as usize))
                    .map(|parameter| parameter.value_type.clone());
                let target_scope = target_argument_type
                    .as_ref()
                    .and_then(|ty| entity_scope(ty, extension_scopes));
                let actor_scope = schema
                    .actor_argument
                    .and_then(|index| schema.arguments.get(index as usize))
                    .and_then(|parameter| entity_scope(&parameter.value_type, extension_scopes))
                    .unwrap_or(Scope::PackageDomain);
                let capability_metadata =
                    extension_capabilities.and_then(|metadata| metadata.get(id));
                (
                    id.clone(),
                    CapabilityDefinition {
                        id: id.clone(),
                        description: capability_metadata
                            .and_then(|metadata| metadata.description.clone()),
                        actor_scope,
                        version: capability_metadata.map(|metadata| metadata.version),
                        actor_argument: schema.actor_argument,
                        arguments: schema.arguments.clone(),
                        target_argument: schema.target_argument,
                        target_argument_type,
                        target_scope,
                        target_types,
                        target_owner: schema.target_owner,
                        preconditions: schema.preconditions.clone(),
                        effect_primitives: effects.get(id).cloned().unwrap_or_default(),
                        effect_lifetime: capability_metadata
                            .map(|metadata| metadata.effect_lifetime.clone())
                            .unwrap_or(CapabilityLifetime::NotDeclaredByRulePackage),
                        active_phases: schema.phases.clone(),
                        // The package has no rejection-code member; don't infer reasons from diagnostics.
                        rejection_codes: capability_metadata
                            .map(|metadata| {
                                RejectionMetadata::Declared(metadata.rejection_codes.clone())
                            })
                            .unwrap_or(RejectionMetadata::NotDeclaredByRulePackage),
                        logical_cost_reference: schema.issue_cost.clone(),
                        arbitration,
                    },
                )
            })
            .collect();
        let entity_types = rules
            .world
            .entity_types
            .iter()
            .map(|(id, schema)| {
                (
                    id.clone(),
                    EntityTypeDefinition {
                        id: id.clone(),
                        fields: schema.fields.clone(),
                        default_owner: schema.default_owner,
                    },
                )
            })
            .collect();
        let cost_schedule = CostScheduleDefinition {
            id: rules.cost_schedule.id.clone(),
            version: rules.cost_schedule.version,
            operations: rules.cost_schedule.operations.clone(),
            per_tick_budget: rules.cost_schedule.per_tick_budget,
            per_match_budget: rules.cost_schedule.per_match_budget,
            overrun_policy: rules.cost_schedule.overrun_policy,
            memory_commit_policy: rules.cost_schedule.memory_commit_policy,
            budget_overrun_reason: rules.cost_schedule.budget_overrun_reason.clone(),
        };
        let ordering = OrderingContract {
            phases: rules.phases.clone(),
            arbitration: rules.arbitration.clone(),
            transition_order: rules
                .transitions
                .iter()
                .map(|transition| TransitionOrder {
                    phase: transition.phase.clone(),
                    order: transition.order,
                    rule_id: transition.id.clone(),
                    capability: transition.capability.clone(),
                })
                .collect(),
        };
        let (metadata_extension_digest, entity_scopes, capability_metadata, behavior_profiles) =
            match extension {
                Some(extension) => {
                    validate_extension(
                        &identity,
                        &extension,
                        &rules.domain,
                        &rules.world,
                        &rules.transitions,
                        rules.next.as_ref(),
                    )?;
                    let digest = extension_digest(&extension)?;
                    (
                        Some(digest.clone()),
                        MetadataStatus::AuthoredExtension {
                            digest: digest.clone(),
                            metadata: extension.entity_scopes,
                        },
                        MetadataStatus::AuthoredExtension {
                            digest: digest.clone(),
                            metadata: extension.capabilities,
                        },
                        MetadataStatus::AuthoredExtension {
                            digest,
                            metadata: extension.behavior_profiles,
                        },
                    )
                }
                None => (
                    None,
                    MetadataStatus::NotDeclaredByRulePackage,
                    MetadataStatus::NotDeclaredByRulePackage,
                    MetadataStatus::NotDeclaredByRulePackage,
                ),
            };
        let mut catalog = Self {
            identity,
            catalog_digest: ContentDigest::new(String::new()),
            metadata_extension_digest,
            symbols,
            observations,
            collections,
            capabilities,
            entity_types,
            cost_schedule,
            ordering,
            entity_scopes,
            capability_metadata,
            behavior_profiles,
        };
        catalog.catalog_digest = catalog_digest(&catalog)?;
        Ok(catalog)
    }

    pub fn identity(&self) -> &CatalogIdentity {
        &self.identity
    }
    pub fn catalog_digest(&self) -> &ContentDigest {
        &self.catalog_digest
    }
    pub fn metadata_extension_digest(&self) -> Option<&ContentDigest> {
        self.metadata_extension_digest.as_ref()
    }
    pub fn symbols(&self) -> &[CatalogSymbol] {
        &self.symbols
    }
    pub fn observations(&self) -> &BTreeMap<ObservationPath, ObservationDefinition> {
        &self.observations
    }
    pub fn collections(&self) -> &BTreeMap<CollectionId, CollectionDefinition> {
        &self.collections
    }
    pub fn capabilities(&self) -> &BTreeMap<CapabilityId, CapabilityDefinition> {
        &self.capabilities
    }
    pub fn entity_types(&self) -> &BTreeMap<TypeId, EntityTypeDefinition> {
        &self.entity_types
    }
    pub fn cost_schedule(&self) -> &CostScheduleDefinition {
        &self.cost_schedule
    }
    pub fn ordering(&self) -> &OrderingContract {
        &self.ordering
    }
    pub fn entity_scopes(&self) -> &MetadataStatus<BTreeMap<TypeId, EntityControlScope>> {
        &self.entity_scopes
    }
    pub fn capability_metadata(
        &self,
    ) -> &MetadataStatus<BTreeMap<CapabilityId, CapabilityContractMetadata>> {
        &self.capability_metadata
    }
    pub fn behavior_profiles(&self) -> &MetadataStatus<BehaviorProfileMetadata> {
        &self.behavior_profiles
    }

    pub fn compatibility_key(&self) -> CatalogCompatibilityKey {
        CatalogCompatibilityKey {
            identity: self.identity.clone(),
            catalog_digest: self.catalog_digest.clone(),
            metadata_extension_digest: self.metadata_extension_digest.clone(),
        }
    }

    pub fn is_compatible_with(&self, key: &CatalogCompatibilityKey) -> bool {
        self.compatibility_key() == *key
    }

    pub fn canonical_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomainCatalogIssue {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomainCatalogError {
    pub issues: Vec<DomainCatalogIssue>,
}

impl DomainCatalogError {
    fn single(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            issues: vec![DomainCatalogIssue {
                code,
                path: "catalog".into(),
                message: message.into(),
            }],
        }
    }
}

impl fmt::Display for DomainCatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, issue) in self.issues.iter().enumerate() {
            if index > 0 {
                f.write_str("; ")?;
            }
            write!(f, "{} at {}: {}", issue.code, issue.path, issue.message)?;
        }
        Ok(())
    }
}
impl std::error::Error for DomainCatalogError {}

#[derive(Serialize)]
struct ExtensionDigestMaterial<'a> {
    schema_version: Version,
    ruleset_id: &'a RulesetId,
    ruleset_version: Version,
    ruleset_digest: &'a ContentDigest,
    entity_scopes: &'a BTreeMap<TypeId, EntityControlScope>,
    capabilities: &'a BTreeMap<CapabilityId, CapabilityContractMetadata>,
    behavior_profiles: &'a BehaviorProfileMetadata,
}

fn extension_digest(
    extension: &CatalogMetadataExtension,
) -> Result<ContentDigest, DomainCatalogError> {
    let material = ExtensionDigestMaterial {
        schema_version: extension.schema_version,
        ruleset_id: &extension.ruleset_id,
        ruleset_version: extension.ruleset_version,
        ruleset_digest: &extension.ruleset_digest,
        entity_scopes: &extension.entity_scopes,
        capabilities: &extension.capabilities,
        behavior_profiles: &extension.behavior_profiles,
    };
    let bytes = serde_json::to_vec(&material).map_err(|error| {
        DomainCatalogError::single(
            "canonical_serialization_failed",
            format!("behavior extension serialization failed: {error}"),
        )
    })?;
    Ok(sha256(&bytes))
}

#[derive(Serialize)]
struct CatalogDigestMaterial<'a> {
    identity: &'a CatalogIdentity,
    metadata_extension_digest: &'a Option<ContentDigest>,
    symbols: &'a [CatalogSymbol],
    observations: &'a BTreeMap<ObservationPath, ObservationDefinition>,
    collections: &'a BTreeMap<CollectionId, CollectionDefinition>,
    capabilities: &'a BTreeMap<CapabilityId, CapabilityDefinition>,
    entity_types: &'a BTreeMap<TypeId, EntityTypeDefinition>,
    cost_schedule: &'a CostScheduleDefinition,
    ordering: &'a OrderingContract,
    entity_scopes: &'a MetadataStatus<BTreeMap<TypeId, EntityControlScope>>,
    capability_metadata: &'a MetadataStatus<BTreeMap<CapabilityId, CapabilityContractMetadata>>,
    behavior_profiles: &'a MetadataStatus<BehaviorProfileMetadata>,
}

fn catalog_digest(catalog: &DomainCatalog) -> Result<ContentDigest, DomainCatalogError> {
    let material = CatalogDigestMaterial {
        identity: &catalog.identity,
        metadata_extension_digest: &catalog.metadata_extension_digest,
        symbols: &catalog.symbols,
        observations: &catalog.observations,
        collections: &catalog.collections,
        capabilities: &catalog.capabilities,
        entity_types: &catalog.entity_types,
        cost_schedule: &catalog.cost_schedule,
        ordering: &catalog.ordering,
        entity_scopes: &catalog.entity_scopes,
        capability_metadata: &catalog.capability_metadata,
        behavior_profiles: &catalog.behavior_profiles,
    };
    let bytes = serde_json::to_vec(&material).map_err(|error| {
        DomainCatalogError::single(
            "canonical_serialization_failed",
            format!("catalog serialization failed: {error}"),
        )
    })?;
    Ok(sha256(&bytes))
}

fn sha256(bytes: &[u8]) -> ContentDigest {
    ContentDigest::new(format!("{:x}", Sha256::digest(bytes)))
}

fn build_symbols(domains: &BTreeMap<SymbolDomainId, BTreeSet<SymbolId>>) -> Vec<CatalogSymbol> {
    let mut symbols = Vec::new();
    for (domain, values) in domains {
        let value_type = DomainType::Enum {
            domain: domain.clone(),
            values: values.clone(),
        };
        for value in values {
            let key = SymbolKey {
                domain: domain.clone(),
                symbol: value.clone(),
            };
            symbols.push(CatalogSymbol {
                display_name: value.as_str().to_owned(),
                namespace: domain.clone(),
                id: key,
                category: SymbolCategory::Constant,
                value_type: value_type.clone(),
                finite_domain: values.clone(),
                allowed_operators: operators_for_type(&value_type),
                description: None,
            });
        }
    }
    symbols
}

fn observation_definition(
    id: ObservationPath,
    entity_type: Option<TypeId>,
    container_visibility: Option<Visibility>,
    value_type: DomainType,
    visibility: Visibility,
    source: ObservationSource,
) -> ObservationDefinition {
    let read_permission = match visibility {
        Visibility::Internal => ReadPermission::InternalDenied,
        Visibility::OwningSide => ReadPermission::OwningSide,
        Visibility::EnemyVisible => ReadPermission::EnemyVisibleOnly,
        Visibility::Public => match container_visibility {
            None | Some(Visibility::Public) => ReadPermission::Public,
            Some(Visibility::Internal) => ReadPermission::InternalDenied,
            Some(Visibility::OwningSide | Visibility::EnemyVisible) => {
                ReadPermission::ParentCollection
            }
        },
    };
    let knownness = match (visibility, container_visibility) {
        (Visibility::Internal, _) | (_, Some(Visibility::Internal)) => {
            KnownnessContract::NeverReadable
        }
        (Visibility::EnemyVisible, _) | (_, Some(Visibility::EnemyVisible)) => {
            KnownnessContract::KnownWhenCurrentEntityVisible
        }
        _ => KnownnessContract::KnownWhenSourceResolves,
    };
    let scope = entity_type
        .clone()
        .map(ObservationScope::PackageEntity)
        .unwrap_or_else(|| match &source {
            ObservationSource::Tick | ObservationSource::WorldGlobalField { .. } => {
                ObservationScope::Match
            }
            ObservationSource::WorldEntityField {
                entity: WorldEntitySelector::ByProjectionKey { entity_type, .. },
                ..
            } => ObservationScope::PackageEntity(entity_type.clone()),
            ObservationSource::WorldEntityField { .. }
            | ObservationSource::CurrentEntityField { .. }
            | ObservationSource::Derived(_) => ObservationScope::PackageDomain,
        });
    ObservationDefinition {
        id,
        scope,
        entity_type,
        allowed_operators: operators_for_type(&value_type),
        value_type,
        visibility,
        container_visibility,
        read_permission,
        knownness,
        unit: None,
        source,
    }
}

fn collection_operations(schema: &CollectionSchema) -> CollectionOperations {
    let has_numeric_field = schema.visible_fields.values().any(|field| {
        field.visibility != Visibility::Internal
            && matches!(
                field.value_type,
                DomainType::Integer { .. } | DomainType::Fixed { .. }
            )
    });
    let has_unique_key = !schema.unique_keys.is_empty();
    let numeric_aggregates = CollectionAggregates {
        sum: has_numeric_field,
        min: has_numeric_field,
        max: has_numeric_field,
        argmin: has_numeric_field && has_unique_key,
        argmax: has_numeric_field && has_unique_key,
    };
    CollectionOperations {
        filter: true,
        any: true,
        all: true,
        count: true,
        numeric_aggregates,
    }
}

fn operators_for_type(value_type: &DomainType) -> BTreeSet<DomainOperator> {
    use DomainOperator::*;
    let mut operators = [Equal, NotEqual, Known, Unknown]
        .into_iter()
        .collect::<BTreeSet<_>>();
    match value_type {
        DomainType::Integer { .. } | DomainType::Fixed { .. } => {
            operators.extend([LessThan, LessThanOrEqual, GreaterThan, GreaterThanOrEqual])
        }
        DomainType::String { .. } => {
            operators.extend([LessThan, LessThanOrEqual, GreaterThan, GreaterThanOrEqual]);
        }
        DomainType::Enum { .. } | DomainType::Bool | DomainType::Entity { .. } => {}
        DomainType::Optional(_)
        | DomainType::List { .. }
        | DomainType::Vector { .. }
        | DomainType::Matrix { .. }
        | DomainType::Record { .. } => {}
    }
    operators
}

fn entity_scope(
    value_type: &DomainType,
    authored_scopes: Option<&BTreeMap<TypeId, EntityControlScope>>,
) -> Option<Scope> {
    match value_type {
        DomainType::Entity {
            entity_type: Some(entity),
        } => Some(
            match authored_scopes.and_then(|scopes| scopes.get(entity)) {
                Some(EntityControlScope::Army) => Scope::Army,
                Some(EntityControlScope::Squad) => Scope::Squad,
                Some(EntityControlScope::Hero) => Scope::Hero,
                Some(EntityControlScope::LaneLimitedMinion) => Scope::MinionLaneLimited,
                None => Scope::PackageEntity(entity.clone()),
            },
        ),
        DomainType::Entity { entity_type: None } => Some(Scope::PackageDomain),
        _ => Some(Scope::PackageDomain),
    }
}

fn transition_effects(
    rules: &RulePlan,
) -> BTreeMap<CapabilityId, BTreeSet<TransitionPrimitiveKind>> {
    let mut effects = BTreeMap::<CapabilityId, BTreeSet<TransitionPrimitiveKind>>::new();
    for transition in &rules.transitions {
        if let Some(capability) = &transition.capability {
            let kinds = effects.entry(capability.clone()).or_default();
            kinds.extend(transition.operations.iter().map(TransitionPrimitive::kind));
        }
    }
    effects
}

fn validate_extension(
    identity: &CatalogIdentity,
    extension: &CatalogMetadataExtension,
    domain: &DomainSchema,
    world: &WorldSchema,
    transitions: &[TransitionRule],
    next_rules: Option<&NextRules>,
) -> Result<(), DomainCatalogError> {
    let mut issues = Vec::new();
    let mut issue = |code, path: String, message: String| {
        issues.push(DomainCatalogIssue {
            code,
            path,
            message,
        })
    };
    if extension.schema_version != DOMAIN_CATALOG_SCHEMA_VERSION {
        issue(
            "unsupported_extension_schema",
            "extension.schemaVersion".into(),
            "extension schema version is unsupported".into(),
        );
    }
    if extension.ruleset_id != identity.ruleset_id
        || extension.ruleset_version != identity.ruleset_version
        || extension.ruleset_digest != identity.ruleset_digest
    {
        issue(
            "package_identity_mismatch",
            "extension.ruleset".into(),
            "metadata extension must match the full RulePackage ID, version, and digest".into(),
        );
    }
    validate_extension_entity_scopes(extension, world, &mut issues);
    validate_capability_contract_metadata(extension, domain, transitions, &mut issues);
    validate_behavior_profiles(
        &extension.behavior_profiles,
        domain,
        world,
        &extension.capabilities,
        next_rules,
        &mut issues,
    );
    if issues.is_empty() {
        Ok(())
    } else {
        issues.sort_by(|a, b| (&a.path, a.code, &a.message).cmp(&(&b.path, b.code, &b.message)));
        Err(DomainCatalogError { issues })
    }
}

fn validate_extension_entity_scopes(
    extension: &CatalogMetadataExtension,
    world: &WorldSchema,
    issues: &mut Vec<DomainCatalogIssue>,
) {
    for (entity_type, scope) in &extension.entity_scopes {
        let path = format!("extension.entityScopes.{entity_type}");
        let Some(schema) = world.entity_types.get(entity_type) else {
            issues.push(DomainCatalogIssue {
                code: "unknown_entity_scope_type",
                path,
                message: "scope metadata must reference a package-declared entity type".into(),
            });
            continue;
        };
        if *scope == EntityControlScope::LaneLimitedMinion
            && !schema.fields.contains_key(&FieldId::new("lane"))
        {
            issues.push(DomainCatalogIssue {
                code: "lane_scope_missing_lane_field",
                path,
                message: "lane-limited Minion scope requires a typed lane field".into(),
            });
        }
    }
}

fn validate_capability_contract_metadata(
    extension: &CatalogMetadataExtension,
    domain: &DomainSchema,
    transitions: &[TransitionRule],
    issues: &mut Vec<DomainCatalogIssue>,
) {
    for (capability_id, metadata) in &extension.capabilities {
        let path = format!("extension.capabilities.{capability_id}");
        if !domain.capabilities.contains_key(capability_id) {
            issues.push(DomainCatalogIssue {
                code: "unknown_capability_metadata",
                path: path.clone(),
                message: "metadata must reference a package-declared capability".into(),
            });
        }
        if metadata.version == Version::default() {
            issues.push(DomainCatalogIssue {
                code: "invalid_capability_version",
                path: format!("{path}.version"),
                message: "capability metadata version cannot be zero".into(),
            });
        }
        if metadata
            .description
            .as_ref()
            .is_some_and(|description| description.trim().is_empty())
        {
            issues.push(DomainCatalogIssue {
                code: "empty_capability_description",
                path: format!("{path}.description"),
                message: "capability descriptions, when supplied, must not be empty".into(),
            });
        }
        for rejection_code in &metadata.rejection_codes {
            if rejection_code.as_str().trim().is_empty() {
                issues.push(DomainCatalogIssue {
                    code: "empty_rejection_code",
                    path: format!("{path}.rejectionCodes"),
                    message: "rejection code identifiers cannot be empty".into(),
                });
            }
        }
        match &metadata.effect_lifetime {
            CapabilityLifetime::NotDeclaredByRulePackage => issues.push(DomainCatalogIssue {
                code: "undeclared_capability_lifetime",
                path: format!("{path}.effectLifetime"),
                message: "an authored capability contract must specify its effect lifetime".into(),
            }),
            CapabilityLifetime::FixedTicks { ticks: 0 } => issues.push(DomainCatalogIssue {
                code: "invalid_capability_lifetime",
                path: format!("{path}.effectLifetime"),
                message: "fixed duration must be positive".into(),
            }),
            CapabilityLifetime::UntilRule { rule_id }
                if !transitions.iter().any(|rule| &rule.id == rule_id) =>
            {
                issues.push(DomainCatalogIssue {
                    code: "unknown_capability_lifetime_rule",
                    path: format!("{path}.effectLifetime"),
                    message: "lifetime rule must be declared by this RulePackage".into(),
                })
            }
            _ => {}
        }
    }
}

fn validate_behavior_profiles(
    metadata: &BehaviorProfileMetadata,
    domain: &DomainSchema,
    world: &WorldSchema,
    capability_metadata: &BTreeMap<CapabilityId, CapabilityContractMetadata>,
    next_rules: Option<&NextRules>,
    issues: &mut Vec<DomainCatalogIssue>,
) {
    macro_rules! issue {
        ($code:expr, $path:expr, $message:expr) => {
            issues.push(DomainCatalogIssue {
                code: $code,
                path: $path,
                message: $message,
            })
        };
    }
    if metadata.fields.is_empty() {
        issue!(
            "empty_profile_schema",
            "extension.behaviorProfiles.fields".into(),
            "behavior profile schema must declare at least one typed field".into()
        );
    }
    let mut seen_layers = BTreeSet::new();
    for (index, layer) in metadata.inheritance_order.iter().enumerate() {
        if !seen_layers.insert(*layer) {
            issue!(
                "duplicate_inheritance_layer",
                format!("extension.behaviorProfiles.inheritanceOrder[{index}]"),
                "inheritance layer may appear only once".into()
            );
        }
    }
    if metadata.inheritance_order.first() != Some(&ProfileLayer::SenritsuDefault) {
        issue!(
            "invalid_inheritance_root",
            "extension.behaviorProfiles.inheritanceOrder".into(),
            "Senritsu default must be the least-specific inheritance layer".into()
        );
    }
    if metadata
        .senritsu_default
        .keys()
        .any(|id| !metadata.fields.contains_key(id))
    {
        issue!(
            "unknown_profile_field",
            "extension.behaviorProfiles.senritsuDefault".into(),
            "default values may reference only declared profile fields".into()
        );
    }
    for field_id in metadata.fields.keys() {
        if !metadata.senritsu_default.contains_key(field_id) {
            issue!("missing_profile_default", format!("extension.behaviorProfiles.senritsuDefault.{field_id}"), "every profile field needs an explicit Senritsu default; unspecified values may inherit only above this base layer".into());
        }
    }
    for (id, value) in &metadata.senritsu_default {
        if let Some(field) = metadata.fields.get(id) {
            validate_domain_value(
                value,
                &field.value_type,
                domain,
                issues,
                format!("extension.behaviorProfiles.senritsuDefault.{id}"),
            );
        }
    }
    for (hero_id, values) in &metadata.hero_defaults {
        if hero_id.trim().is_empty() {
            issue!(
                "empty_hero_catalog_id",
                format!("extension.behaviorProfiles.heroDefaults.{hero_id}"),
                "Hero Catalog IDs cannot be empty".into()
            );
        }
        if !hero_catalog_contains(next_rules, hero_id) {
            issue!(
                "unknown_hero_catalog_id",
                format!("extension.behaviorProfiles.heroDefaults.{hero_id}"),
                "Hero default must reference a Hero ID declared by this RulePackage".into()
            );
        }
        for (field_id, value) in values {
            match metadata.fields.get(field_id) {
                None => issue!(
                    "unknown_profile_field",
                    format!("extension.behaviorProfiles.heroDefaults.{hero_id}.{field_id}"),
                    "Hero default references an undeclared profile field".into()
                ),
                Some(field) => {
                    if !field.scopes.contains(&BehaviorScope::Hero) {
                        issue!(
                            "profile_scope_mismatch",
                            format!("extension.behaviorProfiles.heroDefaults.{hero_id}.{field_id}"),
                            "Hero default uses a field outside the Hero scope".into()
                        );
                    }
                    validate_domain_value(
                        value,
                        &field.value_type,
                        domain,
                        issues,
                        format!("extension.behaviorProfiles.heroDefaults.{hero_id}.{field_id}"),
                    );
                }
            }
        }
    }
    for (field_id, field) in &metadata.fields {
        let path = format!("extension.behaviorProfiles.fields.{field_id}");
        if field_id.trim().is_empty() || field.description.trim().is_empty() {
            issue!(
                "incomplete_profile_field",
                path.clone(),
                "field ID and description must be non-empty".into()
            );
        }
        if field.scopes.is_empty() {
            issue!(
                "empty_profile_scope",
                format!("{path}.scopes"),
                "profile field must declare at least one legal scope".into()
            );
        }
        validate_type_references(
            &field.value_type,
            domain,
            world,
            issues,
            format!("{path}.valueType"),
            0,
        );
        if let Some(policy) = field.aggregation {
            let numeric = matches!(
                field.value_type,
                DomainType::Integer { .. } | DomainType::Fixed { .. }
            );
            if matches!(
                policy,
                AggregationPolicy::Minimum
                    | AggregationPolicy::Maximum
                    | AggregationPolicy::CheckedSum
            ) && !numeric
            {
                issue!(
                    "invalid_aggregation_type",
                    format!("{path}.aggregation"),
                    "min, max, and sum aggregation require an integer or fixed-point field".into()
                );
            }
        }
        if field.scopes.contains(&BehaviorScope::Squad) && field.aggregation.is_none() {
            issue!(
                "missing_squad_aggregation",
                format!("{path}.aggregation"),
                "Squad-scoped fields require an explicit deterministic aggregation policy".into()
            );
        }
        if let Some(capability) = &field.override_policy.persistent_capability {
            if !domain.capabilities.contains_key(capability) {
                issue!(
                    "unknown_persistent_override_capability",
                    format!("{path}.overridePolicy.persistentCapability"),
                    "persistent profile mutation must reference a package-declared capability"
                        .into()
                );
            } else if !capability_metadata.get(capability).is_some_and(|metadata| {
                matches!(&metadata.effect_lifetime, CapabilityLifetime::Persistent)
            }) {
                issue!("unverified_persistent_override_capability", format!("{path}.overridePolicy.persistentCapability"), "persistent profile mutation must reference a capability with authored Persistent lifetime metadata".into());
            }
        }
        if !field.override_policy.conditional_tick_override
            && field.override_policy.persistent_capability.is_none()
        {
            issue!(
                "unmodifiable_profile_field",
                format!("{path}.overridePolicy"),
                "a field must allow a Tick override or declare a persistent mutation capability"
                    .into()
            );
        }
    }
    for (preset_id, preset) in &metadata.presets {
        let path = format!("extension.behaviorProfiles.presets.{preset_id}");
        if preset_id.trim().is_empty()
            || preset.name.trim().is_empty()
            || preset.description.trim().is_empty()
        {
            issue!(
                "incomplete_behavior_preset",
                path.clone(),
                "preset ID, name, and description must be non-empty".into()
            );
        }
        if preset.values.is_empty() {
            issue!(
                "empty_behavior_preset",
                format!("{path}.values"),
                "named presets must specify at least one field".into()
            );
        }
        for (field_id, value) in &preset.values {
            match metadata.fields.get(field_id) {
                None => issue!(
                    "unknown_profile_field",
                    format!("{path}.values.{field_id}"),
                    "preset references an undeclared profile field".into()
                ),
                Some(field) => {
                    if !field.scopes.contains(&preset.scope) {
                        issue!(
                            "profile_scope_mismatch",
                            format!("{path}.values.{field_id}"),
                            "preset uses a field outside its declared scope".into()
                        );
                    }
                    validate_domain_value(
                        value,
                        &field.value_type,
                        domain,
                        issues,
                        format!("{path}.values.{field_id}"),
                    );
                }
            }
        }
    }
    for (field_id, field) in &metadata.fields {
        let requires = [
            (BehaviorScope::Army, ProfileLayer::ArmyPreference),
            (BehaviorScope::Squad, ProfileLayer::SquadAggregate),
            (BehaviorScope::Hero, ProfileLayer::HeroCatalogDefault),
        ];
        for (scope, layer) in requires {
            if field.scopes.contains(&scope) && !seen_layers.contains(&layer) {
                issue!(
                    "missing_inheritance_layer",
                    format!("extension.behaviorProfiles.inheritanceOrder"),
                    format!(
                        "profile field {field_id} supports {scope:?} but omits layer {layer:?}"
                    )
                );
            }
        }
        if field.override_policy.conditional_tick_override
            && !seen_layers.contains(&ProfileLayer::JinreiConditionalPreference)
        {
            issue!("missing_inheritance_layer", "extension.behaviorProfiles.inheritanceOrder".into(), format!("profile field {field_id} allows conditional overrides but omits the Jinrei layer"));
        }
    }
}

fn hero_catalog_contains(next_rules: Option<&NextRules>, hero_id: &str) -> bool {
    next_rules.is_some_and(|rules| rules.heroes.iter().any(|hero| hero.id == hero_id))
}

fn validate_type_references(
    value_type: &DomainType,
    domain: &DomainSchema,
    world: &WorldSchema,
    issues: &mut Vec<DomainCatalogIssue>,
    path: String,
    depth: u32,
) {
    macro_rules! issue {
        ($code:expr, $path:expr, $message:expr) => {
            issues.push(DomainCatalogIssue {
                code: $code,
                path: $path,
                message: $message,
            })
        };
    }
    if depth > MAX_PROFILE_TYPE_DEPTH {
        issue!(
            "profile_type_depth_limit",
            path,
            "profile type exceeds the catalog nesting limit".into()
        );
        return;
    }
    match value_type {
        DomainType::Enum {
            domain: enum_id,
            values,
        } => match domain.symbol_domains.get(enum_id) {
            None => issue!(
                "unknown_symbol_domain",
                path,
                format!("enum references undeclared symbol domain {enum_id}")
            ),
            Some(_) if values.is_empty() => issue!(
                "empty_profile_enum",
                path,
                "profile enums must declare at least one value".into()
            ),
            Some(available) if available != values => issue!(
                "profile_symbol_domain_mismatch",
                path,
                "profile enum values must match the RulePackage's finite symbol domain exactly"
                    .into()
            ),
            _ => {}
        },
        DomainType::Optional(inner) => validate_type_references(
            inner,
            domain,
            world,
            issues,
            format!("{path}.element"),
            depth + 1,
        ),
        DomainType::List { element, max_items } | DomainType::Vector { element, max_items } => {
            if *max_items == 0 || *max_items > domain.max_collection_items {
                issue!("invalid_profile_collection_limit", path.clone(), "profile list limit must be positive and within the RulePackage collection limit".into());
            }
            validate_type_references(
                element,
                domain,
                world,
                issues,
                format!("{path}.element"),
                depth + 1,
            );
        }
        DomainType::Matrix {
            element,
            max_rows,
            max_columns,
        } => {
            if *max_rows == 0
                || *max_columns == 0
                || *max_rows > domain.max_collection_items
                || *max_columns > domain.max_collection_items
            {
                issue!("invalid_profile_matrix_limit", path.clone(), "profile matrix dimensions must be positive and within the RulePackage collection limit".into());
            }
            validate_type_references(
                element,
                domain,
                world,
                issues,
                format!("{path}.element"),
                depth + 1,
            );
        }
        DomainType::Record { fields } => {
            for (field, ty) in fields {
                if field.as_str().is_empty() {
                    issue!(
                        "invalid_profile_record_field",
                        format!("{path}.{field}"),
                        "profile record field IDs cannot be empty".into()
                    );
                }
                validate_type_references(
                    ty,
                    domain,
                    world,
                    issues,
                    format!("{path}.{field}"),
                    depth + 1,
                );
            }
        }
        DomainType::Integer { min, max } | DomainType::Fixed { min, max, .. } => {
            if (*min).zip(*max).is_none() || (*min).zip(*max).is_some_and(|(min, max)| min > max) {
                issue!(
                    "unbounded_or_invalid_profile_domain",
                    path.clone(),
                    "profile numeric types need a finite valid minimum and maximum".into()
                );
            }
            if let (Some(min), Some(max)) = (min, max) {
                if min.unsigned_abs() > LogicalCu::MAX_SAFE_JSON_INTEGER
                    || max.unsigned_abs() > LogicalCu::MAX_SAFE_JSON_INTEGER
                {
                    issue!(
                        "unsafe_profile_numeric_bound",
                        path.clone(),
                        "profile numeric bounds must fit the safe JSON integer range".into()
                    );
                }
            }
            if let DomainType::Fixed { scale, .. } = value_type {
                if *scale > 18 {
                    issue!(
                        "invalid_profile_scale",
                        path,
                        "fixed-point profile scale cannot exceed 18".into()
                    );
                }
            }
        }
        DomainType::Entity {
            entity_type: Some(entity_type),
        } if !world.entity_types.contains_key(entity_type) => {
            issue!(
                "unknown_profile_entity_type",
                path,
                format!("profile value type references undeclared entity type {entity_type}")
            );
        }
        DomainType::String { max_bytes } => {
            if *max_bytes == 0 || *max_bytes > 1_000_000 {
                issue!(
                    "invalid_profile_string_limit",
                    path,
                    "profile string limit must be between 1 and 1,000,000 bytes".into()
                );
            }
        }
        DomainType::Bool | DomainType::Entity { .. } => {}
    }
}

fn validate_domain_value(
    value: &DomainValue,
    expected: &DomainType,
    domain: &DomainSchema,
    issues: &mut Vec<DomainCatalogIssue>,
    path: String,
) {
    if !validate_value_shape(value, expected, domain, 0) {
        issues.push(DomainCatalogIssue {
            code: "profile_value_type_mismatch",
            path,
            message: "authored profile value does not match its declared finite domain type".into(),
        });
    }
}

fn validate_value_shape(
    value: &DomainValue,
    expected: &DomainType,
    domain: &DomainSchema,
    depth: u32,
) -> bool {
    if depth > MAX_PROFILE_TYPE_DEPTH {
        return false;
    }
    match (value, expected) {
        (DomainValue::Bool(_), DomainType::Bool) => true,
        (DomainValue::Integer(n), DomainType::Integer { min, max }) => in_range(*n, *min, *max),
        (
            DomainValue::Fixed { coefficient, scale },
            DomainType::Fixed {
                scale: expected,
                min,
                max,
            },
        ) => scale == expected && in_range(*coefficient, *min, *max),
        (DomainValue::String(value), DomainType::String { max_bytes }) => {
            value.len() <= *max_bytes as usize
        }
        (
            DomainValue::Enum(symbol),
            DomainType::Enum {
                domain: enum_id,
                values,
            },
        ) => {
            values.contains(symbol)
                && domain
                    .symbol_domains
                    .get(enum_id)
                    .is_some_and(|all| all.contains(symbol))
        }
        (DomainValue::Entity(_), DomainType::Entity { .. }) => true,
        (DomainValue::Null, DomainType::Optional(_)) => true,
        (value, DomainType::Optional(inner)) => {
            validate_value_shape(value, inner, domain, depth + 1)
        }
        (DomainValue::List(values), DomainType::List { element, max_items })
        | (DomainValue::List(values), DomainType::Vector { element, max_items }) => {
            values.len() <= *max_items as usize
                && values
                    .iter()
                    .all(|value| validate_value_shape(value, element, domain, depth + 1))
        }
        (
            DomainValue::List(rows),
            DomainType::Matrix {
                element,
                max_rows,
                max_columns,
            },
        ) => {
            rows.len() <= *max_rows as usize
                && rows.iter().all(|row| match row {
                    DomainValue::List(cells) => {
                        cells.len() <= *max_columns as usize
                            && cells.iter().all(|value| {
                                validate_value_shape(value, element, domain, depth + 2)
                            })
                    }
                    _ => false,
                })
        }
        (DomainValue::Record(values), DomainType::Record { fields }) => {
            values.len() == fields.len()
                && fields.iter().all(|(field, ty)| {
                    values
                        .get(field)
                        .is_some_and(|value| validate_value_shape(value, ty, domain, depth + 1))
                })
        }
        _ => false,
    }
}

fn in_range(value: i64, min: Option<i64>, max: Option<i64>) -> bool {
    min.map_or(true, |min| value >= min) && max.map_or(true, |max| value <= max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        initial_engine_compatibility, initial_package, next_engine_compatibility, next_package,
        validate,
    };

    fn verified_initial() -> VerifiedRulePlan {
        validate(initial_package(), &initial_engine_compatibility())
            .expect("initial package validates")
    }

    fn verified_next() -> VerifiedRulePlan {
        validate(next_package(), &next_engine_compatibility()).expect("next package validates")
    }

    fn test_extension(plan: &VerifiedRulePlan, mode: &str) -> CatalogMetadataExtension {
        let hero_id = plan.plan().next.as_ref().unwrap().heroes[0].id.clone();
        let persistent_capability = CapabilityId::new("move");
        let string_type = DomainType::String { max_bytes: 24 };
        let behavior_profiles = BehaviorProfileMetadata {
            inheritance_order: vec![
                ProfileLayer::SenritsuDefault,
                ProfileLayer::HeroCatalogDefault,
                ProfileLayer::ArmyPreference,
                ProfileLayer::SquadAggregate,
                ProfileLayer::JinreiConditionalPreference,
            ],
            fields: BTreeMap::from([
                (
                    "navigation.mode".into(),
                    BehaviorFieldDefinition {
                        value_type: string_type.clone(),
                        scopes: [BehaviorScope::Hero, BehaviorScope::Squad]
                            .into_iter()
                            .collect(),
                        aggregation: Some(AggregationPolicy::RequireAgreement),
                        override_policy: BehaviorOverridePolicy {
                            conditional_tick_override: true,
                            persistent_capability: None,
                        },
                        description: "Test fixture navigation preference".into(),
                        unit: None,
                    },
                ),
                (
                    "survival.threshold".into(),
                    BehaviorFieldDefinition {
                        value_type: DomainType::Integer {
                            min: Some(0),
                            max: Some(100),
                        },
                        scopes: [BehaviorScope::Hero].into_iter().collect(),
                        aggregation: None,
                        override_policy: BehaviorOverridePolicy {
                            conditional_tick_override: false,
                            persistent_capability: Some(persistent_capability.clone()),
                        },
                        description: "Test fixture survival threshold".into(),
                        unit: Some("percent".into()),
                    },
                ),
            ]),
            senritsu_default: BTreeMap::from([
                ("navigation.mode".into(), DomainValue::String(mode.into())),
                ("survival.threshold".into(), DomainValue::Integer(30)),
            ]),
            hero_defaults: BTreeMap::from([(
                hero_id,
                BTreeMap::from([("survival.threshold".into(), DomainValue::Integer(40))]),
            )]),
            presets: BTreeMap::from([(
                "fixture.safe".into(),
                NamedBehaviorPreset {
                    name: "Fixture safe".into(),
                    scope: BehaviorScope::Hero,
                    values: BTreeMap::from([(
                        "survival.threshold".into(),
                        DomainValue::Integer(55),
                    )]),
                    description: "Test-only preset for catalog validation".into(),
                },
            )]),
        };
        CatalogMetadataExtension {
            schema_version: DOMAIN_CATALOG_SCHEMA_VERSION,
            ruleset_id: plan.ruleset().id.clone(),
            ruleset_version: plan.ruleset().version,
            ruleset_digest: plan.package_digest().clone(),
            entity_scopes: BTreeMap::from([
                (TypeId::new("hero"), EntityControlScope::Hero),
                (TypeId::new("minion"), EntityControlScope::LaneLimitedMinion),
            ]),
            capabilities: BTreeMap::from([(
                persistent_capability,
                CapabilityContractMetadata {
                    version: Version::new(1, 0, 0),
                    effect_lifetime: CapabilityLifetime::Persistent,
                    rejection_codes: [DiagnosticCode::new("profile_override_denied")]
                        .into_iter()
                        .collect(),
                    description: Some("Authored persistent-profile test capability".into()),
                },
            )]),
            behavior_profiles,
        }
    }

    #[test]
    fn catalog_projects_verified_package_and_hides_runtime_values() {
        let plan = verified_next();
        let catalog = DomainCatalog::from_verified_plan(&plan).unwrap();

        assert_eq!(catalog.identity().ruleset_id, plan.ruleset().id);
        assert_eq!(catalog.identity().ruleset_digest, *plan.package_digest());
        assert!(catalog
            .symbols()
            .iter()
            .any(|symbol| symbol.id.symbol.as_str() == "draw"));
        assert_eq!(
            catalog.observations().len(),
            plan.domain_schema().observation_fields.len()
        );
        assert_eq!(
            catalog.collections().len(),
            plan.domain_schema().collections.len()
        );
        assert_eq!(
            catalog.capabilities().len(),
            plan.domain_schema().capabilities.len()
        );
        assert_eq!(catalog.cost_schedule().id, plan.cost_schedule().id);
        assert_eq!(catalog.ordering().phases, plan.plan().phases);
        assert_eq!(
            catalog.behavior_profiles(),
            &MetadataStatus::NotDeclaredByRulePackage
        );
        assert_eq!(
            catalog.capabilities().values().next().unwrap().actor_scope,
            Scope::PackageEntity(TypeId::new("hero"))
        );

        let enemy_hp = &catalog
            .collections()
            .get(&CollectionId::new("enemies.visible_heroes"))
            .unwrap()
            .visible_fields[&FieldId::new("hp")];
        assert_eq!(enemy_hp.read_permission, ReadPermission::ParentCollection);
        assert_eq!(
            enemy_hp.container_visibility,
            Some(Visibility::EnemyVisible)
        );
        assert_eq!(
            enemy_hp.knownness,
            KnownnessContract::KnownWhenCurrentEntityVisible
        );
        assert!(enemy_hp
            .allowed_operators
            .contains(&DomainOperator::LessThan));
        assert!(catalog
            .collections()
            .values()
            .any(|collection| collection.operations.numeric_aggregates.sum));

        let json = String::from_utf8(catalog.canonical_json().unwrap()).unwrap();
        assert!(!json.contains("world_initialization"));
        assert!(!json.contains(&plan.plan().next.as_ref().unwrap().heroes[0].id));
        assert!(!json.contains("runtime_enemy_position"));
    }

    #[test]
    fn catalog_json_and_digest_are_stable_and_package_bound() {
        let plan = verified_initial();
        let first = DomainCatalog::from_verified_plan(&plan).unwrap();
        let second = DomainCatalog::from_verified_plan(&plan).unwrap();
        assert!(first
            .symbols()
            .iter()
            .any(|symbol| symbol.id.symbol.as_str() == "top"));
        assert_eq!(
            first.canonical_json().unwrap(),
            second.canonical_json().unwrap()
        );
        assert_eq!(first.catalog_digest(), second.catalog_digest());
        assert!(first.is_compatible_with(&second.compatibility_key()));

        let next_plan = verified_next();
        let mut extension = test_extension(&next_plan, "steady");
        extension.ruleset_digest = ContentDigest::new("0".repeat(64));
        let error =
            DomainCatalog::from_verified_plan_with_extension(&next_plan, extension).unwrap_err();
        assert!(error
            .issues
            .iter()
            .any(|issue| issue.code == "package_identity_mismatch"));

        let mut extension = test_extension(&next_plan, "steady");
        extension.ruleset_version = Version::new(9, 0, 0);
        let error =
            DomainCatalog::from_verified_plan_with_extension(&next_plan, extension).unwrap_err();
        assert!(error
            .issues
            .iter()
            .any(|issue| issue.code == "package_identity_mismatch"));

        let mut extension = test_extension(&next_plan, "steady");
        extension.ruleset_id = RulesetId::new("other.ruleset");
        let error =
            DomainCatalog::from_verified_plan_with_extension(&next_plan, extension).unwrap_err();
        assert!(error
            .issues
            .iter()
            .any(|issue| issue.code == "package_identity_mismatch"));
    }

    #[test]
    fn catalog_operators_match_jinrei_v01_typechecker_and_collection_ir() {
        let plan = verified_initial();
        let catalog = DomainCatalog::from_verified_plan(&plan).unwrap();
        let tick = catalog
            .observations()
            .get(&ObservationPath::new("match.tick"))
            .unwrap();
        assert!(tick
            .allowed_operators
            .contains(&DomainOperator::GreaterThan));
        let draw = catalog
            .symbols()
            .iter()
            .find(|symbol| symbol.id.symbol.as_str() == "draw")
            .unwrap();
        assert!(!draw.allowed_operators.contains(&DomainOperator::LessThan));

        assert!(jinrei::compile(
            "senkei catalog_ops { state later { match.tick > 0, }, state visible { any unit in allies.units { unit.hp > 0, }, }, }",
            &plan,
        )
        .is_ok());
        assert!(jinrei::compile(
            "senkei catalog_bad_order { state invalid { draw < attacker_victory, }, }",
            &plan,
        )
        .is_err());

        let units = catalog
            .collections()
            .get(&CollectionId::new("allies.units"))
            .unwrap();
        assert!(units.operations.any);
        assert!(units.operations.numeric_aggregates.argmin);
        assert!(units.unique_keys.contains(&CollectionUniqueKey::EntityId));
    }

    #[test]
    fn authored_behavior_metadata_is_typed_and_changes_catalog_identity() {
        let plan = verified_next();
        let first = DomainCatalog::from_verified_plan_with_extension(
            &plan,
            test_extension(&plan, "steady"),
        )
        .unwrap();
        let same = DomainCatalog::from_verified_plan_with_extension(
            &plan,
            test_extension(&plan, "steady"),
        )
        .unwrap();
        let second = DomainCatalog::from_verified_plan_with_extension(
            &plan,
            test_extension(&plan, "cautious"),
        )
        .unwrap();
        assert_eq!(first.catalog_digest(), same.catalog_digest());
        assert_eq!(
            first.metadata_extension_digest(),
            same.metadata_extension_digest()
        );

        let (first_extension_digest, profile) = match first.behavior_profiles() {
            MetadataStatus::AuthoredExtension { digest, metadata } => (digest, metadata),
            MetadataStatus::NotDeclaredByRulePackage => panic!("extension metadata missing"),
        };
        assert_eq!(
            Some(first_extension_digest),
            first.metadata_extension_digest()
        );
        assert!(profile.fields.contains_key("navigation.mode"));
        assert!(profile.fields.contains_key("survival.threshold"));
        assert!(profile.presets.contains_key("fixture.safe"));
        assert_ne!(first.catalog_digest(), second.catalog_digest());
        assert_ne!(
            first.metadata_extension_digest(),
            second.metadata_extension_digest()
        );
        assert!(!first.is_compatible_with(&second.compatibility_key()));
        assert_eq!(
            first.identity(),
            second.identity(),
            "RulePackage digest is not rewritten by an extension"
        );
        assert_eq!(
            first
                .capabilities()
                .get(&CapabilityId::new("move"))
                .unwrap()
                .actor_scope,
            Scope::Hero
        );
        assert_eq!(
            first
                .capabilities()
                .get(&CapabilityId::new("move"))
                .unwrap()
                .effect_lifetime,
            CapabilityLifetime::Persistent
        );
        assert_eq!(
            first
                .capabilities()
                .get(&CapabilityId::new("move"))
                .unwrap()
                .version,
            Some(Version::new(1, 0, 0))
        );
        assert!(matches!(
            first
                .capabilities()
                .get(&CapabilityId::new("move"))
                .unwrap()
                .rejection_codes,
            RejectionMetadata::Declared(_)
        ));
        assert_eq!(
            first.entity_scopes(),
            &MetadataStatus::AuthoredExtension {
                digest: first.metadata_extension_digest().unwrap().clone(),
                metadata: BTreeMap::from([
                    (TypeId::new("hero"), EntityControlScope::Hero),
                    (TypeId::new("minion"), EntityControlScope::LaneLimitedMinion),
                ]),
            }
        );
    }

    #[test]
    fn behavior_metadata_rejects_bad_types_scopes_aggregation_and_capabilities() {
        let plan = verified_next();
        let mut invalid = test_extension(&plan, "steady");
        let field = invalid
            .behavior_profiles
            .fields
            .get_mut("navigation.mode")
            .unwrap();
        field.scopes.insert(BehaviorScope::Army);
        field.aggregation = None;
        field.override_policy.persistent_capability = Some(CapabilityId::new("unregistered"));
        invalid
            .behavior_profiles
            .inheritance_order
            .retain(|layer| *layer != ProfileLayer::JinreiConditionalPreference);
        invalid
            .behavior_profiles
            .senritsu_default
            .insert("navigation.mode".into(), DomainValue::Integer(3));
        invalid
            .behavior_profiles
            .presets
            .get_mut("fixture.safe")
            .unwrap()
            .values
            .insert("unknown.field".into(), DomainValue::Bool(true));

        let error = DomainCatalog::from_verified_plan_with_extension(&plan, invalid).unwrap_err();
        let codes = error
            .issues
            .iter()
            .map(|issue| issue.code)
            .collect::<BTreeSet<_>>();
        assert!(codes.contains("profile_value_type_mismatch"));
        assert!(codes.contains("unknown_profile_field"));
        assert!(codes.contains("unknown_persistent_override_capability"));
        assert!(codes.contains("missing_inheritance_layer"));
    }

    #[test]
    fn profile_extensions_require_a_unique_explicit_inheritance_order() {
        let plan = verified_next();
        let mut invalid = test_extension(&plan, "steady");
        invalid.behavior_profiles.inheritance_order = vec![
            ProfileLayer::HeroCatalogDefault,
            ProfileLayer::HeroCatalogDefault,
        ];
        let error = DomainCatalog::from_verified_plan_with_extension(&plan, invalid).unwrap_err();
        let codes = error
            .issues
            .iter()
            .map(|issue| issue.code)
            .collect::<BTreeSet<_>>();
        assert!(codes.contains("invalid_inheritance_root"));
        assert!(codes.contains("duplicate_inheritance_layer"));
        assert!(codes.contains("missing_inheritance_layer"));
    }

    #[test]
    fn profile_aggregation_must_match_the_declared_field_type() {
        let plan = verified_next();
        let mut invalid = test_extension(&plan, "steady");
        invalid
            .behavior_profiles
            .fields
            .get_mut("navigation.mode")
            .unwrap()
            .aggregation = Some(AggregationPolicy::Minimum);
        let error = DomainCatalog::from_verified_plan_with_extension(&plan, invalid).unwrap_err();
        assert!(error
            .issues
            .iter()
            .any(|issue| issue.code == "invalid_aggregation_type"));
    }
}
