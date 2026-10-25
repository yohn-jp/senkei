//! Initial, finite Senkei battle rules and the validator that turns an
//! untrusted [`RulePackage`](senkei_model::RulePackage) into a verified plan.

mod initial;
mod validate;
mod next_validate;
pub mod catalog;

pub use initial::{initial_engine_compatibility, initial_package};
pub use catalog::{
    AggregationPolicy, BehaviorDomain, BehaviorFieldId, BehaviorFieldIdError,
    BehaviorFieldDefinition, BehaviorOverridePolicy, BehaviorProfileFieldSchema,
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
pub use validate::{canonical_digest, validate};

mod next_content;
pub mod next_world;
mod next_domain;
mod next_package;
pub use next_package::{next_package,next_engine_compatibility};
