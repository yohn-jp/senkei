//! Narrow bridge between the verified Senritsu Catalog, the existing Jinrei
//! compiler, and an Editor client. It does not parse Jinrei or invent catalog
//! vocabulary.

use jinrei::compile;
use senkei_model::{ApiError, CompileResult, EngineCompatibility, VerifiedRulePlan};
use senritsu::{
    next_engine_compatibility, next_package, validate, CatalogMetadataExtension, DomainCatalog,
};
use serde::{Deserialize, Serialize};
use std::fmt;

mod behavior;
pub use behavior::{resolve_behavior, BehaviorResolveRequest};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStamp {
    /// CatalogIdentity is a sealed Serialize-only Producer type. Compare the
    /// exact serialized value instead of adding a parallel Deserialize model.
    pub identity: serde_json::Value,
    pub catalog_digest: String,
    pub metadata_extension_digest: Option<String>,
}

impl CatalogStamp {
    fn from_catalog(catalog: &DomainCatalog) -> Self {
        Self {
            identity: serde_json::to_value(catalog.identity())
                .expect("Catalog identity serializes"),
            catalog_digest: catalog.catalog_digest().to_string(),
            metadata_extension_digest: catalog.metadata_extension_digest().map(ToString::to_string),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CompileReply {
    Compiled {
        stamp: CatalogStamp,
        result: CompileResult,
    },
    Rejected {
        stamp: CatalogStamp,
        error: ApiError,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCompileRequest {
    pub source: String,
    pub stamp: CatalogStamp,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCompileEnvelope {
    pub revision: u64,
    pub reply: CompileReply,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AdapterError {
    PackageInvalid(String),
    CatalogInvalid(String),
    CatalogMismatch,
    Serialization(String),
}

impl fmt::Display for AdapterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PackageInvalid(message) => write!(f, "verified package unavailable: {message}"),
            Self::CatalogInvalid(message) => write!(f, "Domain Catalog unavailable: {message}"),
            Self::CatalogMismatch => {
                f.write_str("editor catalog stamp does not match the verified package")
            }
            Self::Serialization(message) => {
                write!(f, "editor response serialization failed: {message}")
            }
        }
    }
}

impl std::error::Error for AdapterError {}

fn verified_next_plan() -> Result<VerifiedRulePlan, AdapterError> {
    let package = next_package();
    let engine = next_engine_compatibility();
    validate(package, &engine).map_err(|issues| {
        AdapterError::PackageInvalid(format!("{} validation issue(s)", issues.len()))
    })
}

/// Return the canonical JSON produced by Senritsu's public Catalog producer
/// for the bundled `senkei.next` RulePackage.
pub fn next_catalog_json() -> Result<String, AdapterError> {
    let plan = verified_next_plan()?;
    let catalog = DomainCatalog::from_verified_plan(&plan)
        .map_err(|error| AdapterError::CatalogInvalid(error.to_string()))?;
    String::from_utf8(
        catalog
            .canonical_json()
            .map_err(|error| AdapterError::Serialization(error.to_string()))?,
    )
    .map_err(|error| AdapterError::Serialization(error.to_string()))
}

/// Compile a draft with the existing Jinrei v0.1 compiler after checking that
/// the Editor still holds the exact verified package and Catalog identities.
pub fn compile_next_source(
    source: &str,
    expected: &CatalogStamp,
) -> Result<CompileReply, AdapterError> {
    let plan = if expected.identity.get("rulesetDigest").and_then(|v| v.as_str()) == Some(senritsu::next_local_trial_package().ruleset.digest.as_str()) {
        validate(senritsu::next_local_trial_package(), &next_engine_compatibility())
            .map_err(|issues| AdapterError::PackageInvalid(format!("{} validation issue(s)", issues.len())))?
    } else { verified_next_plan()? };
    let catalog = DomainCatalog::from_verified_plan(&plan)
        .map_err(|error| AdapterError::CatalogInvalid(error.to_string()))?;
    compile_checked_source(source, expected, &plan, &catalog)
}

/// Build the exact producer Catalog for an already verified retained package.
pub fn catalog_for_verified_plan(
    plan: &VerifiedRulePlan,
    extension: Option<CatalogMetadataExtension>,
) -> Result<DomainCatalog, AdapterError> {
    match extension {
        Some(extension) => DomainCatalog::from_verified_plan_with_extension(plan, extension),
        None => DomainCatalog::from_verified_plan(plan),
    }
    .map_err(|error| AdapterError::CatalogInvalid(error.to_string()))
}

/// Compile against the verified plan and the Catalog made from its retained
/// extension. The complete Catalog stamp must match before Jinrei runs.
pub fn compile_verified_request(
    request: EditorCompileRequest,
    plan: &VerifiedRulePlan,
    extension: Option<CatalogMetadataExtension>,
) -> Result<EditorCompileEnvelope, AdapterError> {
    let catalog = catalog_for_verified_plan(plan, extension)?;
    let reply = compile_checked_source(&request.source, &request.stamp, plan, &catalog)?;
    Ok(EditorCompileEnvelope { revision: request.revision, reply })
}

fn compile_checked_source(
    source: &str,
    expected: &CatalogStamp,
    plan: &VerifiedRulePlan,
    catalog: &DomainCatalog,
) -> Result<CompileReply, AdapterError> {
    let stamp = CatalogStamp::from_catalog(catalog);
    if &stamp != expected {
        return Err(AdapterError::CatalogMismatch);
    }
    let reply = match compile(source, plan) {
        Ok(result) => CompileReply::Compiled { stamp, result },
        Err(error) => CompileReply::Rejected { stamp, error },
    };
    Ok(reply)
}

/// JSON wire adapter used by an Editor transport. The caller's draft revision
/// is echoed so the client can discard responses that finished after edits.
pub fn compile_next_json(request_json: &str) -> Result<String, AdapterError> {
    let request: EditorCompileRequest = serde_json::from_str(request_json).map_err(|error| {
        AdapterError::Serialization(format!("invalid compile request: {error}"))
    })?;
    let reply = compile_next_source(&request.source, &request.stamp)?;
    serde_json::to_string(&EditorCompileEnvelope {
        revision: request.revision,
        reply,
    })
    .map_err(|error| AdapterError::Serialization(error.to_string()))
}

/// Returns the engine contract for consumers that need to label compiler
/// compatibility alongside the package identity.
pub fn next_engine_contract() -> EngineCompatibility {
    next_engine_compatibility()
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{CapabilityId, CollectionId, ContentDigest, ObservationPath, TypeId};
    use senritsu::{
        BehaviorProfileMetadata, CapabilityContractMetadata, CapabilityDefinition, CatalogIdentity,
        CatalogSymbol, CollectionDefinition, CostScheduleDefinition, EntityControlScope,
        EntityTypeDefinition, MetadataStatus, ObservationDefinition, OrderingContract,
    };
    use serde::Serialize;
    use serde_json::Value;
    use sha2::Digest as _;
    use std::collections::BTreeMap;

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

    fn rust_digest_material() -> Vec<u8> {
        let plan = verified_next_plan().unwrap();
        let catalog = DomainCatalog::from_verified_plan(&plan).unwrap();
        let metadata_extension_digest = catalog.metadata_extension_digest().cloned();
        let material = CatalogDigestMaterial {
            identity: catalog.identity(),
            metadata_extension_digest: &metadata_extension_digest,
            symbols: catalog.symbols(),
            observations: catalog.observations(),
            collections: catalog.collections(),
            capabilities: catalog.capabilities(),
            entity_types: catalog.entity_types(),
            cost_schedule: catalog.cost_schedule(),
            ordering: catalog.ordering(),
            entity_scopes: catalog.entity_scopes(),
            capability_metadata: catalog.capability_metadata(),
            behavior_profiles: catalog.behavior_profiles(),
        };
        serde_json::to_vec(&material).unwrap()
    }

    #[test]
    fn producer_digest_material_matches_catalog_digest() {
        let rust = rust_digest_material();
        let value: Value = serde_json::from_str(&next_catalog_json().unwrap()).unwrap();
        let hash = sha2::Sha256::digest(&rust);
        assert_eq!(
            format!("{hash:x}"),
            value["catalogDigest"].as_str().unwrap()
        );
        assert_eq!(
            next_catalog_json().unwrap(),
            include_str!("../../../packages/jinrei-editor/fixtures/next-domain-catalog.json")
        );
    }

    #[test]
    fn emits_real_verified_domain_catalog_json() {
        let json = next_catalog_json().unwrap();
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["identity"]["rulesetId"], "senkei.next");
        assert!(value["identity"]["rulesetDigest"].as_str().unwrap().len() == 64);
        assert_eq!(
            value["behaviorProfiles"]["status"],
            "not_declared_by_rule_package"
        );
        assert!(!value.to_string().contains("currentObservation"));
        let again = next_catalog_json().unwrap();
        assert_eq!(json, again);
    }

    #[test]
    fn uses_real_compiler_and_checks_catalog_identity() {
        let json = next_catalog_json().unwrap();
        let value: Value = serde_json::from_str(&json).unwrap();
        let identity = &value["identity"];
        let stamp: CatalogStamp = serde_json::from_value(serde_json::json!({
            "identity": identity,
            "catalogDigest": value["catalogDigest"],
            "metadataExtensionDigest": value["metadataExtensionDigest"],
        }))
        .unwrap();
        let source = "senkei editor_test { action hold { when true, do move(argmin hero in allies.heroes by hero.level then hero.id, \"attacker_base\"), }, }";
        assert!(matches!(
            compile_next_source(source, &stamp).unwrap(),
            CompileReply::Compiled { .. }
        ));
        assert!(matches!(
            compile_next_source(
                "senkei editor_test { action bad { when true, do missing(), }, }",
                &stamp
            )
            .unwrap(),
            CompileReply::Rejected {
                error: ApiError { .. },
                ..
            }
        ));

        let request = EditorCompileRequest {
            source: source.into(),
            stamp: stamp.clone(),
            revision: 7,
        };
        let wire_reply = compile_next_json(&serde_json::to_string(&request).unwrap()).unwrap();
        let envelope: EditorCompileEnvelope = serde_json::from_str(&wire_reply).unwrap();
        assert_eq!(envelope.revision, 7);
        assert!(matches!(envelope.reply, CompileReply::Compiled { .. }));

        let fixture_source = "senkei editor_test { action hold { when true, do move(argmin hero in allies.heroes by hero.level then hero.id, \"attacker_base\"), }, }";
        let fixture_request = EditorCompileRequest {
            source: fixture_source.into(),
            stamp: stamp_for_test().unwrap(),
            revision: 4,
        };
        assert_eq!(
            compile_next_json(&serde_json::to_string(&fixture_request).unwrap()).unwrap(),
            include_str!("../../../packages/jinrei-editor/fixtures/next-compile-reply.json")
        );

        let invalid_request = EditorCompileRequest {
            source: "senkei editor_test { action bad { when true, do missing(), }, }".into(),
            stamp: stamp_for_test().unwrap(),
            revision: 9,
        };
        assert_eq!(
            compile_next_json(&serde_json::to_string(&invalid_request).unwrap()).unwrap(),
            include_str!("../../../packages/jinrei-editor/fixtures/next-compile-rejected.json")
        );

        let mut stale = stamp;
        stale.catalog_digest = "0".repeat(64);
        assert_eq!(
            compile_next_source(source, &stale),
            Err(AdapterError::CatalogMismatch)
        );
    }

    fn stamp_for_test() -> Result<CatalogStamp, AdapterError> {
        let json = next_catalog_json()?;
        let value: Value = serde_json::from_str(&json)
            .map_err(|error| AdapterError::Serialization(error.to_string()))?;
        serde_json::from_value(serde_json::json!({
            "identity": value["identity"],
            "catalogDigest": value["catalogDigest"],
            "metadataExtensionDigest": value["metadataExtensionDigest"],
        }))
        .map_err(|error| AdapterError::Serialization(error.to_string()))
    }
}
