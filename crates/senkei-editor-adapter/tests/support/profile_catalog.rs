use senkei_model::{DomainType, DomainValue};
use senritsu::{
    next_engine_compatibility, next_package, validate, validate_with_catalog_extension,
    canonical_digest, BehaviorFieldDefinition,
    BehaviorOverridePolicy, BehaviorProfileMetadata, BehaviorScope, CatalogMetadataExtension,
    DomainCatalog, NamedBehaviorPreset, ProfileLayer, DOMAIN_CATALOG_SCHEMA_VERSION,
};
use std::collections::{BTreeMap, BTreeSet};
use senritsu::catalog::catalog_semantics_digest;

/// Build a real producer Catalog with an authored test profile. The profile
/// exists only in this fixture helper; the bundled RulePackage remains unchanged.
pub fn authored_profile_catalog_json() -> String {
    let mut package = next_package();
    let plan = validate(package.clone(), &next_engine_compatibility())
        .expect("bundled next package validates");
    let field_id = "navigation.mode".to_owned();
    let field_type = DomainType::String { max_bytes: 64 };
    let value = DomainValue::String("safest".to_owned());
    let mut extension = CatalogMetadataExtension {
        schema_version: DOMAIN_CATALOG_SCHEMA_VERSION,
        ruleset_id: plan.ruleset().id.clone(),
        ruleset_version: plan.ruleset().version,
        ruleset_digest: plan.package_digest().clone(),
        entity_scopes: BTreeMap::new(),
        capabilities: BTreeMap::new(),
        behavior_profiles: BehaviorProfileMetadata {
            inheritance_order: vec![
                ProfileLayer::SenritsuDefault,
                ProfileLayer::HeroCatalogDefault,
                ProfileLayer::ArmyPreference,
                ProfileLayer::SquadAggregate,
                ProfileLayer::JinreiConditionalPreference,
            ],
            fields: BTreeMap::from([(
                field_id.clone(),
                BehaviorFieldDefinition {
                    value_type: field_type,
                    scopes: BTreeSet::from([BehaviorScope::Hero]),
                    aggregation: None,
                    override_policy: BehaviorOverridePolicy {
                        conditional_tick_override: true,
                        persistent_capability: None,
                    },
                    description: "Fixture navigation preference".into(),
                    unit: None,
                },
            )]),
            senritsu_default: BTreeMap::from([(field_id.clone(), value.clone())]),
            hero_defaults: BTreeMap::new(),
            presets: BTreeMap::from([(
                "navigation.safest".into(),
                NamedBehaviorPreset {
                    name: "Safest path".into(),
                    scope: BehaviorScope::Hero,
                    values: BTreeMap::from([(field_id, value)]),
                    description: "Fixture named preference for profile editor tests".into(),
                },
            )]),
        },
    };
    package.catalog_semantics_digest = Some(catalog_semantics_digest(&extension)
        .expect("fixture Behavior semantics have a canonical digest"));
    package.ruleset.digest = canonical_digest(&package).expect("bound fixture package has a digest");
    extension.ruleset_digest = package.ruleset.digest.clone();
    let plan = validate_with_catalog_extension(package, &next_engine_compatibility(), extension.clone())
        .expect("fixture RulePackage binds its authored Behavior semantics before validation");
    let catalog = DomainCatalog::from_verified_plan_with_extension(&plan, extension)
        .expect("authored profile fixture validates");
    String::from_utf8(catalog.canonical_json().expect("canonical catalog JSON"))
        .expect("Catalog JSON is UTF-8")
}
