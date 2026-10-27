//! Initial, finite Senkei battle rules and the validator that turns an
//! untrusted [`RulePackage`](senkei_model::RulePackage) into a verified plan.

mod initial;
mod validate;
mod next_validate;
mod production_behavior;
mod minion_behavior;
mod next_route;
mod production_preferences;
pub use production_preferences::add_trial_behavior_preferences;
pub use production_behavior::{validate_next_behavior_policy, VerifiedNextBehaviorPolicy};
pub use minion_behavior::{validate_next_minion_behavior_policy, VerifiedNextMinionBehaviorPolicy};
pub use next_route::{validate_next_route_policy, VerifiedNextRoutePolicy};
pub mod catalog;

pub use initial::{initial_engine_compatibility, initial_package};
pub use catalog::{
    AggregationPolicy, BehaviorDomain, BehaviorFieldId, BehaviorFieldIdError,
    BehaviorFieldDefinition, BehaviorOrderContract, BehaviorOrderDeclaration, BehaviorOverridePolicy, BehaviorProfileFieldSchema,
    BehaviorProfileMetadata, BehaviorProfileSchemas, BehaviorScope, CapabilityContractMetadata,
    CapabilityDefinition, CapabilityLifetime, EngagementBehaviorSchema,
    CatalogCompatibilityKey, CatalogIdentity, CatalogMetadataExtension, CatalogSymbol,
    CollectionAggregates, CollectionDefinition, CollectionOperations, CostScheduleDefinition,
    DomainCatalog, DomainCatalogError, DomainCatalogIssue, DomainOperator, EntityControlScope,
    EntityTypeDefinition, KnownnessContract, MetadataStatus, NamedBehaviorPreset,
    ObservationDefinition, ObservationScope, OrderingContract, ProfileLayer, ReadPermission,
    NavigationBehaviorSchema, ObjectiveBehaviorSchema, PursuitBehaviorSchema,
    RejectionMetadata, Scope, SurvivalBehaviorSchema, SymbolCategory, SymbolKey,
    TargetingBehaviorSchema, DOMAIN_CATALOG_SCHEMA_VERSION,
};
pub use validate::{
    canonical_digest, validate, validate_with_catalog_extension,
    validate_with_world_resolver, validate_with_world_resolver_and_catalog_extension,
};

mod next_content;
pub mod next_world;
mod next_domain;
mod next_package;
pub use next_package::{next_package,next_local_trial_package,next_engine_compatibility};
