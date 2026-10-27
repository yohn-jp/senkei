//! Catalog-stamped profile composition for Editor clients.
//!
//! Caller-supplied tactical evidence is explicitly labeled as supplied, not
//! authenticated as an Enbu observation or a proof of decision coverage.
use crate::{AdapterError, CatalogStamp};
use senkei_behavior::{BehaviorError, BehaviorResolver, HeroMember, Legality, MovementAuthority, ProfileActor, ProfileComposition, ProfilePreferences};
use senkei_model::{ActionId, CombatantSide, DomainValue, EntityId, Intent, LogicalCu, RulePackage, TacticalDiagnostic, TacticalExecutionOutput, TacticalExecutionStatus};
use senritsu::{BehaviorScope, CatalogMetadataExtension, DomainCatalog};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BehaviorResolveRequest {
    pub revision: u64,
    pub stamp: CatalogStamp,
    pub rule_package: RulePackage,
    #[serde(default)]
    pub catalog_metadata_extension: Option<CatalogMetadataExtension>,
    pub actor: ActorInput,
    pub preferences: PreferencesInput,
    pub tick: u32,
    pub side: CombatantSide,
    pub evaluation: EvaluationInput,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorInput {
    pub subject_id: EntityId,
    pub scope: BehaviorScope,
    pub hero_catalog_id: Option<String>,
    pub squad_members: Vec<MemberInput>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberInput {
    pub subject_id: EntityId,
    pub hero_catalog_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferencesInput {
    pub army_id: String,
    pub army: BTreeMap<String, DomainValue>,
    pub squad_id: String,
    pub squad: BTreeMap<String, DomainValue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EvaluationInput {
    /// Explicit baseline: no Jinrei evaluation or legality is claimed.
    DefaultsOnly,
    /// The caller supplies all evidence. No runtime identity is inferred here.
    Provided { intents: Vec<Intent>, diagnostics: Vec<TacticalDiagnostic>, legality: BTreeMap<ActionId, LegalityInput> },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum LegalityInput {
    KnownLegal,
    KnownRejected { reason: String },
    Unknown { reason: String },
    PermissionDenied { reason: String },
}

impl From<LegalityInput> for Legality {
    fn from(input: LegalityInput) -> Self {
        match input {
            LegalityInput::KnownLegal => Self::KnownLegal,
            LegalityInput::KnownRejected { reason } => Self::KnownRejected { reason },
            LegalityInput::Unknown { reason } => Self::Unknown { reason },
            LegalityInput::PermissionDenied { reason } => Self::PermissionDenied { reason },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorResolveReply {
    revision: u64,
    stamp: CatalogStamp,
    evaluation_kind: &'static str,
    #[serde(flatten)]
    result: BehaviorResult,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum BehaviorResult {
    Resolved { composition: ProfileComposition },
    NotDeclared,
    Rejected { reason: String },
}

pub fn resolve_behavior(request: BehaviorResolveRequest) -> Result<BehaviorResolveReply, AdapterError> {
    if request.revision > LogicalCu::MAX_SAFE_JSON_INTEGER {
        return Err(AdapterError::Serialization("editor revision exceeds the JSON-safe integer range".into()));
    }
    let engine = senritsu::next_engine_compatibility();
    let plan = match request.catalog_metadata_extension.clone() {
        Some(extension) => senritsu::validate_with_catalog_extension(request.rule_package, &engine, extension),
        None => senritsu::validate(request.rule_package, &engine),
    }.map_err(|issues| AdapterError::PackageInvalid(format!("{} validation issue(s)", issues.len())))?;
    let catalog = match request.catalog_metadata_extension {
        Some(extension) => DomainCatalog::from_verified_plan_with_extension(&plan, extension),
        None => DomainCatalog::from_verified_plan(&plan),
    }.map_err(|error| AdapterError::CatalogInvalid(error.to_string()))?;
    let stamp = CatalogStamp::from_catalog(&catalog);
    if stamp != request.stamp { return Err(AdapterError::CatalogMismatch); }
    let (evaluation_kind, intents, diagnostics, legality) = match request.evaluation {
        EvaluationInput::DefaultsOnly => ("defaults_only", Vec::new(), Vec::new(), BTreeMap::new()),
        EvaluationInput::Provided { intents, diagnostics, legality } => (
            "provided", intents, diagnostics, legality.into_iter().map(|(id, fact)| (id, fact.into())).collect(),
        ),
    };
    let result = match BehaviorResolver::new(&catalog, &catalog.compatibility_key()) {
        Err(BehaviorError::ProfilesNotDeclared) => BehaviorResult::NotDeclared,
        Err(error) => BehaviorResult::Rejected { reason: error.to_string() },
        Ok(resolver) => {
            let movement_authority = match request.actor.scope {
                BehaviorScope::Army => MovementAuthority::Army,
                BehaviorScope::Squad => MovementAuthority::Squad,
                BehaviorScope::Hero if request.actor.squad_members.len() > 1 => MovementAuthority::HeroInSquad,
                BehaviorScope::Hero => MovementAuthority::SoloHero,
                BehaviorScope::LaneLimitedMinion => MovementAuthority::LaneGroup,
            };
            let actor = ProfileActor { subject_id: request.actor.subject_id, scope: request.actor.scope,
                movement_authority, hero_catalog_id: request.actor.hero_catalog_id,
                squad_members: request.actor.squad_members.into_iter().map(|member| HeroMember {
                    subject_id: member.subject_id, hero_catalog_id: member.hero_catalog_id,
                }).collect() };
            let preferences = ProfilePreferences { army_id: request.preferences.army_id, army: request.preferences.army,
                squad_id: request.preferences.squad_id, squad: request.preferences.squad };
            // Only intents and diagnostics are consumed by the resolver. These
            // zero bookkeeping fields are not returned as execution evidence.
            let execution = TacticalExecutionOutput { status: TacticalExecutionStatus::Completed, intents,
                next_memory: BTreeMap::new(), charged_cu: LogicalCu::ZERO, required_cu: LogicalCu::ZERO, diagnostics };
            match resolver.compose(&actor, &preferences, request.tick, request.side, &execution, &legality) {
                Ok(composition) => BehaviorResult::Resolved { composition },
                Err(error) => BehaviorResult::Rejected { reason: error.to_string() },
            }
        }
    };
    Ok(BehaviorResolveReply { revision: request.revision, stamp, evaluation_kind, result })
}
