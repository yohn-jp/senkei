use crate::{
    CapabilityId, CollectionId, CostOperationId, DomainSchema, DomainType,
    DomainValue, EntityId, EventId, FieldId, RulesetRef, RuleId, SymbolId, TypeId, Version,
    Visibility,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RulePackage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<crate::NextRules>,
    pub ruleset: RulesetRef,
    /// Digest of match-affecting catalog/Behavior extension semantics. The
    /// extension carries the final package identity separately, so this value
    /// is computed without that back-reference and avoids a digest cycle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_semantics_digest: Option<crate::ContentDigest>,
    pub minimum_engine_version: Version,
    pub model_version: Version,
    pub primitive_set_id: crate::PrimitiveSetId,
    pub primitive_set_version: Version,
    pub jinrei_language_version: Version,
    pub structured_ast_version: Version,
    pub typed_ir_version: Version,
    pub bytecode_version: Version,
    pub domain: DomainSchema,
    pub world_initialization: WorldInitialization,
    pub world: WorldSchema,
    pub phases: Vec<ExecutionPhase>,
    pub required_primitives: BTreeSet<TransitionPrimitiveKind>,
    pub transitions: Vec<TransitionRule>,
    pub arbitration: BTreeMap<CapabilityId, ArbitrationRule>,
    pub termination: TerminationPolicy,
    pub cost_schedule: CostSchedule,
    pub presentation: PresentationPolicy,
    pub limits: RuleLimits,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedRulePlan {
    ruleset: RulesetRef,
    package_digest: crate::ContentDigest,
    plan: RulePlan,
}

impl VerifiedRulePlan {
    /// Used by Senritsu after all package checks and canonical digest checks pass.
    #[doc(hidden)]
    pub fn from_validation(
        ruleset: RulesetRef,
        package_digest: crate::ContentDigest,
        plan: RulePlan,
    ) -> Self {
        Self { ruleset, package_digest, plan }
    }

    pub fn ruleset(&self) -> &RulesetRef {
        &self.ruleset
    }

    /// Exact paired World identity declared by this package, when present.
    pub fn world_identity(&self) -> Option<&crate::WorldIdentityRef> {
        self.plan.next.as_ref()?.world_identity.as_ref()
    }

    pub fn package_digest(&self) -> &crate::ContentDigest {
        &self.package_digest
    }

    /// Identity of the match-affecting catalog/Behavior semantics bound into
    /// the RulePackage digest, if the package declares an authored extension.
    pub fn catalog_semantics_digest(&self) -> Option<&crate::ContentDigest> {
        self.plan.catalog_semantics_digest.as_ref()
    }

    pub fn plan(&self) -> &RulePlan {
        &self.plan
    }

    pub fn domain_schema(&self) -> &DomainSchema {
        &self.plan.domain
    }

    pub fn world_initialization(&self) -> &WorldInitialization {
        &self.plan.world_initialization
    }

    pub fn cost_schedule(&self) -> &CostSchedule {
        &self.plan.cost_schedule
    }

    pub fn limits(&self) -> &RuleLimits {
        &self.plan.limits
    }

    pub fn termination(&self) -> &TerminationPolicy {
        &self.plan.termination
    }

    pub fn world_schema(&self) -> &WorldSchema {
        &self.plan.world
    }
}

/// The validated, normalized plan that Enbu executes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RulePlan {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_semantics_digest: Option<crate::ContentDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<crate::NextRules>,
    pub minimum_engine_version: Version,
    pub model_version: Version,
    pub primitive_set_id: crate::PrimitiveSetId,
    pub primitive_set_version: Version,
    pub jinrei_language_version: Version,
    pub structured_ast_version: Version,
    pub typed_ir_version: Version,
    pub bytecode_version: Version,
    pub domain: DomainSchema,
    pub world_initialization: WorldInitialization,
    pub world: WorldSchema,
    pub phases: Vec<ExecutionPhase>,
    pub required_primitives: BTreeSet<TransitionPrimitiveKind>,
    pub transitions: Vec<TransitionRule>,
    pub arbitration: BTreeMap<CapabilityId, ArbitrationRule>,
    /// Senritsu-validated actor-local cross-capability order declarations.
    /// They are compiled from the separately bound catalog extension and are
    /// consumed only after Enbu validates and performs per-capability arbitration.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actor_intent_orders: Vec<ActorIntentOrder>,
    pub termination: TerminationPolicy,
    pub cost_schedule: CostSchedule,
    pub presentation: PresentationPolicy,
    pub limits: RuleLimits,
}

/// Projects the two immutable Senkei configurations into the shared initial world.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldInitialization {
    pub entities: Vec<EntityProjection>,
    pub global_fields: BTreeMap<FieldId, DomainValue>,
    /// Static seed values only; entity collections are derived from world entities.
    pub collections: BTreeMap<CollectionId, Vec<DomainValue>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityProjection {
    pub projection_id: crate::ProjectionId,
    pub applies_to: ProjectionSides,
    pub source: EntityProjectionSource,
    pub entity_type: TypeId,
    pub entity_id: EntityIdProjection,
    pub owner: EntityOwnerProjection,
    pub fields: BTreeMap<FieldId, ProjectionValue>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionSides {
    Both,
    AttackerOnly,
    DefenderOnly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntityProjectionSource {
    Singleton,
    EachConfigurationItem { field: FieldId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntityIdProjection {
    Fixed(EntityId),
    ConstantKey(String),
    ConfigurationKey { root: FieldId, path: Vec<FieldId> },
    ConfigurationItemKey { path: Vec<FieldId> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntityOwnerProjection {
    Unowned,
    Fixed(crate::CombatantSide),
    SnapshotSide,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProjectionValue {
    Constant(DomainValue),
    ConfigurationPath { root: FieldId, path: Vec<FieldId> },
    ConfigurationItemPath { path: Vec<FieldId> },
    SnapshotSide,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldSchema {
    pub entity_types: BTreeMap<TypeId, EntityTypeSchema>,
    pub global_fields: BTreeMap<FieldId, FieldSchema>,
    pub collections: BTreeMap<CollectionId, WorldCollectionSchema>,
    pub max_entities: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldCollectionSchema {
    pub element_type: DomainType,
    pub max_items: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityTypeSchema {
    pub fields: BTreeMap<FieldId, FieldSchema>,
    pub default_owner: Option<crate::CombatantSide>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldSchema {
    pub value_type: DomainType,
    pub visibility: Visibility,
    pub writable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseKind {
    Snapshot,
    TacticalEvaluation,
    IntentValidation,
    Arbitration,
    Transition,
    Termination,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionPhase {
    pub id: crate::PhaseId,
    pub order: u32,
    pub kind: PhaseKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionPrimitiveKind {
    BattleNavigation,
    BattleVision,
    BattleSquads,
    BattleCombat,
    SetField,
    AddInteger,
    AddFixed,
    CreateEntity,
    RemoveEntity,
    AppendCollection,
    RemoveCollectionValue,
    EmitEvent,
    SetOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntitySelector {
    IntentActor,
    IntentTarget,
    ByIntentArgument(u16),
    ObservedEntity,
    Fixed(EntityId),
    ByProjectionKey {
        projection_id: crate::ProjectionId,
        entity_type: TypeId,
        owner: EntityOwnerSelector,
        key: DomainValue,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorldEntitySelector {
    Fixed(EntityId),
    ByProjectionKey {
        projection_id: crate::ProjectionId,
        entity_type: TypeId,
        owner: EntityOwnerSelector,
        key: DomainValue,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityOwnerSelector {
    Any,
    OwnSide,
    OtherSide,
    Unowned,
    Attacker,
    Defender,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum CollectionSource {
    WorldEntities {
        entity_types: BTreeSet<TypeId>,
        owner: EntityOwnerSelector,
        filter: Option<RuleExpression>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum RuleExpression {
    Literal(DomainValue),
    CurrentTick,
    IntentArgument(u16),
    Field { target: EntitySelector, field: FieldId },
    GlobalField(FieldId),
    AddInteger { left: Box<RuleExpression>, right: Box<RuleExpression> },
    SubtractInteger { left: Box<RuleExpression>, right: Box<RuleExpression> },
    AddFixed { left: Box<RuleExpression>, right: Box<RuleExpression> },
    Equal { left: Box<RuleExpression>, right: Box<RuleExpression> },
    LessThan { left: Box<RuleExpression>, right: Box<RuleExpression> },
    And(Vec<RuleExpression>),
    Or(Vec<RuleExpression>),
    Not(Box<RuleExpression>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TransitionPrimitive {
    SetField { target: EntitySelector, field: FieldId, value: RuleExpression },
    AddInteger { target: EntitySelector, field: FieldId, amount: RuleExpression },
    AddFixed { target: EntitySelector, field: FieldId, amount: RuleExpression },
    SetGlobalField { field: FieldId, value: RuleExpression },
    AddGlobalInteger { field: FieldId, amount: RuleExpression },
    CreateEntity {
        id: EntityIdSource,
        entity_type: TypeId,
        owner: EntityOwnerSource,
        fields: BTreeMap<FieldId, RuleExpression>,
    },
    RemoveEntity { target: EntitySelector },
    AppendCollection { collection: CollectionId, value: RuleExpression },
    RemoveCollectionValue { collection: CollectionId, value: RuleExpression },
    EmitEvent { event: EventId, payload: BTreeMap<FieldId, RuleExpression> },
    SetOutcome { outcome: RuleExpression, reason: SymbolId },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityIdSource {
    DeterministicInvocation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntityOwnerSource {
    Unowned,
    Fixed(crate::CombatantSide),
    IntentSide,
}

impl TransitionPrimitive {
    pub fn kind(&self) -> TransitionPrimitiveKind {
        match self {
            Self::SetField { .. } | Self::SetGlobalField { .. } => TransitionPrimitiveKind::SetField,
            Self::AddInteger { .. } | Self::AddGlobalInteger { .. } => TransitionPrimitiveKind::AddInteger,
            Self::AddFixed { .. } => TransitionPrimitiveKind::AddFixed,
            Self::CreateEntity { .. } => TransitionPrimitiveKind::CreateEntity,
            Self::RemoveEntity { .. } => TransitionPrimitiveKind::RemoveEntity,
            Self::AppendCollection { .. } => TransitionPrimitiveKind::AppendCollection,
            Self::RemoveCollectionValue { .. } => TransitionPrimitiveKind::RemoveCollectionValue,
            Self::EmitEvent { .. } => TransitionPrimitiveKind::EmitEvent,
            Self::SetOutcome { .. } => TransitionPrimitiveKind::SetOutcome,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransitionRule {
    pub id: RuleId,
    pub phase: crate::PhaseId,
    pub order: u32,
    pub capability: Option<CapabilityId>,
    pub when: Option<RuleExpression>,
    /// Operations execute in listed order; this order is semantic and validated.
    pub operations: Vec<TransitionPrimitive>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArbitrationRule {
    pub conflict_keys: Vec<IntentKey>,
    pub resolution: ArbitrationResolution,
}

/// Game-neutral actor control scope carried by compiled actor-local orders.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorControlScope {
    Army,
    Squad,
    Hero,
    LaneLimitedMinion,
}

/// A validated total order over explicit intents for one typed actor domain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActorIntentOrder {
    pub scope: ActorControlScope,
    pub actor_type: TypeId,
    pub capabilities: BTreeSet<CapabilityId>,
    pub arbitration: ArbitrationRule,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum ArbitrationResolution {
    AllowAll { max_accepted: u32 },
    RejectConflicts,
    SelectOrdered { sort_by: Vec<IntentSortTerm>, max_accepted: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case", deny_unknown_fields)]
pub enum IntentKey {
    Priority,
    Side,
    Actor,
    Target,
    ActionId,
    Capability,
    Argument(u16),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntentSortTerm {
    pub key: IntentKey,
    pub direction: SortDirection,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminationPolicy {
    pub max_ticks: u32,
    /// Evaluated in ascending `order`; the first matching condition wins.
    pub conditions: Vec<TerminationCondition>,
    pub on_timeout: MatchOutcome,
    pub on_timeout_reason: SymbolId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminationCondition {
    pub order: u32,
    pub when: RuleExpression,
    pub outcome: MatchOutcome,
    pub reason: SymbolId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchOutcome {
    AttackerVictory,
    DefenderVictory,
    Draw,
    Aborted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostSchedule {
    pub id: crate::CostScheduleId,
    pub version: Version,
    pub operations: BTreeMap<CostOperationId, LogicalCuCost>,
    pub per_tick_budget: crate::LogicalCu,
    pub per_match_budget: crate::LogicalCu,
    pub overrun_policy: BudgetOverrunPolicy,
    pub memory_commit_policy: MemoryCommitPolicy,
    pub budget_overrun_reason: SymbolId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetOverrunPolicy {
    RejectTickAndKeepMemory,
    AbortMatch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCommitPolicy {
    OnCompletedEvaluation,
    OnAnyIntentAccepted,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogicalCuCost {
    pub base: u64,
    pub per_item: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationPolicy {
    pub visible_events: BTreeMap<EventId, EventSchema>,
    pub visible_entity_fields: BTreeMap<TypeId, BTreeSet<FieldId>>,
    pub visible_global_fields: BTreeSet<FieldId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventSchema {
    pub payload: BTreeMap<FieldId, DomainType>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleLimits {
    pub max_input_bytes: u64,
    pub max_entities: u32,
    pub max_events: u64,
    pub max_diagnostic_events: u64,
    pub max_output_bytes: u64,
    pub max_intents_per_side_per_tick: u32,
    pub max_value_depth: u32,
}

/// Conversion is performed only after Senritsu validation succeeds.
impl From<&RulePackage> for RulePlan {
    fn from(package: &RulePackage) -> Self {
        Self {
            next: package.next.clone(),
            catalog_semantics_digest: package.catalog_semantics_digest.clone(),
            minimum_engine_version: package.minimum_engine_version,
            model_version: package.model_version,
            primitive_set_id: package.primitive_set_id.clone(),
            primitive_set_version: package.primitive_set_version,
            jinrei_language_version: package.jinrei_language_version,
            structured_ast_version: package.structured_ast_version,
            typed_ir_version: package.typed_ir_version,
            bytecode_version: package.bytecode_version,
            domain: package.domain.clone(),
            world_initialization: package.world_initialization.clone(),
            world: package.world.clone(),
            phases: package.phases.clone(),
            required_primitives: package.required_primitives.clone(),
            transitions: package.transitions.clone(),
            arbitration: package.arbitration.clone(),
            actor_intent_orders: Vec::new(),
            termination: package.termination.clone(),
            cost_schedule: package.cost_schedule.clone(),
            presentation: package.presentation.clone(),
            limits: package.limits.clone(),
        }
    }
}

/// Checks generic identity and version invariants shared across components.
/// Ruleset-specific field, capability, and primitive validation belongs to Senritsu.
pub fn validate_package_header(
    package: &RulePackage,
    engine: &crate::EngineCompatibility,
) -> Result<(), Vec<crate::ValidationIssue>> {
    let mut issues = Vec::new();
    if package.ruleset.digest.has_sha256_shape() == false {
        issues.push(crate::ValidationIssue::new(
            "invalid_digest",
            "ruleset.digest",
            "ruleset digest must be 64 lowercase hexadecimal characters",
        ));
    }
    if package.termination.max_ticks == 0 {
        issues.push(crate::ValidationIssue::new(
            "invalid_limit",
            "termination.max_ticks",
            "maximum ticks must be greater than zero",
        ));
    }
    if engine.engine < package.minimum_engine_version {
        issues.push(crate::ValidationIssue::new(
            "incompatible_engine_version",
            "minimum_engine_version",
            "the active Enbu version is older than the minimum required by this package",
        ));
    }
    if package.model_version != engine.model {
        issues.push(crate::ValidationIssue::new(
            "incompatible_model_version",
            "model_version",
            "the package requires a different shared model version",
        ));
    }
    if package.primitive_set_id != engine.primitive_set_id
        || package.primitive_set_version != engine.primitive_set
    {
        issues.push(crate::ValidationIssue::new(
            "incompatible_primitive_set",
            "primitive_set_id",
            "the package requires an unsupported transition primitive set",
        ));
    }
    if package.jinrei_language_version != engine.jinrei_language
        || package.structured_ast_version != engine.structured_ast
        || package.typed_ir_version != engine.typed_ir
        || package.bytecode_version != engine.bytecode
    {
        issues.push(crate::ValidationIssue::new(
            "incompatible_jinrei_version",
            "jinrei_language_version",
            "the package requires incompatible Jinrei language, IR, or bytecode versions",
        ));
    }
    if !package
        .required_primitives
        .is_subset(&engine.available_primitives)
    {
        issues.push(crate::ValidationIssue::new(
            "unsupported_primitive",
            "required_primitives",
            "the package requires a transition primitive unavailable in this Enbu build",
        ));
    }
    if issues.is_empty() { Ok(()) } else { Err(issues) }
}
