//! Deterministic consumer for Senritsu-authored Behavior Profile metadata.
//!
//! The crate composes typed preferences and arbitrates supplied Intent
//! candidates. It does not inspect a World, infer combat/pathfinding facts, or
//! commit game effects; legality is an explicit caller-provided fact.

use senkei_model::{
    ActionId, ArbitrationResolution, CombatantSide, ContentDigest, DomainType, DomainValue,
    EntityId, Intent, IntentKey, IntentSortTerm,
    SortDirection, TacticalDiagnostic, TacticalExecutionOutput, Truth,
};
use senritsu::catalog::{
    AggregationPolicy, BehaviorFieldId, BehaviorOrderDeclaration, BehaviorProfileMetadata, BehaviorScope,
    CapabilityDefinition, CatalogCompatibilityKey, DomainCatalog, MetadataStatus, ProfileLayer,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

pub const BEHAVIOR_RUNTIME_VERSION: senkei_model::Version = senkei_model::Version::new(1, 0, 0);
const MAX_TRACE_RECORDS: usize = 10_000;
const MAX_SQUAD_MEMBERS: usize = 256;
const MAX_CANDIDATES_PER_RESOLUTION: usize = MAX_TRACE_RECORDS / 3;
const MAX_PROFILE_FIELDS: usize = 256;
const MAX_HERO_DEFAULTS: usize = 256;
const MAX_PROFILE_PRESETS: usize = 256;
const MAX_CATALOG_CAPABILITIES: usize = 1_024;

/// No-Intent effective action. The caller supplies the current authorization
/// fact; this value never creates an unsupported RulePackage capability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoOpFallbackKind {
    Hold,
    Wait,
}

/// A catalog-backed resolver. Construction requires the complete expected
/// package/catalog identity and an authored, validated Behavior extension.
#[derive(Clone)]
pub struct BehaviorResolver {
    identity: CatalogCompatibilityKey,
    profiles: BehaviorProfileMetadata,
    capabilities: BTreeMap<senkei_model::CapabilityId, CapabilityDefinition>,
    arbitration: BTreeMap<senkei_model::CapabilityId, senkei_model::ArbitrationRule>,
}

impl BehaviorResolver {
    pub fn new(
        catalog: &DomainCatalog,
        expected: &CatalogCompatibilityKey,
    ) -> Result<Self, BehaviorError> {
        if !catalog.is_compatible_with(expected) {
            return Err(BehaviorError::CatalogIdentityMismatch);
        }
        let profiles = match catalog.behavior_profiles() {
            MetadataStatus::AuthoredExtension { metadata, .. } => metadata.clone(),
            MetadataStatus::NotDeclaredByRulePackage => {
                return Err(BehaviorError::ProfilesNotDeclared)
            }
        };
        if profiles.fields.len() > MAX_PROFILE_FIELDS
            || profiles.hero_defaults.len() > MAX_HERO_DEFAULTS
            || profiles.presets.len() > MAX_PROFILE_PRESETS
            || catalog.capabilities().len() > MAX_CATALOG_CAPABILITIES
            || profiles.inheritance_order.len() > 5
        {
            return Err(BehaviorError::CatalogLimitExceeded);
        }
        Ok(Self {
            identity: expected.clone(),
            profiles,
            capabilities: catalog.capabilities().clone(),
            arbitration: catalog.ordering().arbitration.clone(),
        })
    }

    pub fn identity(&self) -> &CatalogCompatibilityKey {
        &self.identity
    }

    fn field_applies(&self, actor_scope: BehaviorScope, field_id: &str) -> bool {
        let Some(field) = self.profiles.fields.get(field_id) else {
            return false;
        };
        match actor_scope {
            BehaviorScope::Army => field.scopes.contains(&BehaviorScope::Army),
            BehaviorScope::Squad => {
                field.scopes.contains(&BehaviorScope::Army)
                    || field.scopes.contains(&BehaviorScope::Squad)
            }
            BehaviorScope::Hero => {
                field.scopes.contains(&BehaviorScope::Army)
                    || field.scopes.contains(&BehaviorScope::Squad)
                    || field.scopes.contains(&BehaviorScope::Hero)
            }
            BehaviorScope::LaneLimitedMinion => {
                field.scopes.contains(&BehaviorScope::LaneLimitedMinion)
            }
        }
    }

    /// Compose defaults in the exact authored inheritance order. A VM Intent
    /// contributes a conditional override only when the caller supplies current
    /// KnownLegal evidence. Unknown conditions and unknown legality remain
    /// distinct, visible states and add no profile value.
    pub fn compose(
        &self,
        actor: &ProfileActor,
        preferences: &ProfilePreferences,
        tick: u32,
        side: CombatantSide,
        execution: &TacticalExecutionOutput,
        override_legality: &BTreeMap<ActionId, Legality>,
    ) -> Result<ProfileComposition, BehaviorError> {
        validate_actor(actor, &self.profiles)?;
        if preferences.army.len() > MAX_PROFILE_FIELDS
            || preferences.squad.len() > MAX_PROFILE_FIELDS
        {
            return Err(BehaviorError::CatalogLimitExceeded);
        }
        let members = sorted_members(actor)?;
        if execution.intents.len() > MAX_TRACE_RECORDS
            || execution.diagnostics.len() > MAX_TRACE_RECORDS
            || execution.intents.len()
                > MAX_TRACE_RECORDS.saturating_sub(execution.diagnostics.len())
        {
            return Err(BehaviorError::TraceLimitExceeded);
        }
        let mut values = self
            .profiles
            .senritsu_default
            .iter()
            .filter(|(field, _)| self.field_applies(actor.scope, field))
            .map(|(field, value)| (field.clone(), value.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut provenance = values
            .keys()
            .map(|field| {
                (
                    field.clone(),
                    FieldProvenance {
                        layer: ProfileLayer::SenritsuDefault,
                        source: "senritsu-default".into(),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        let (jinrei_overrides, jinrei_sources, unknown_conditions, unknown_overrides, rejected_overrides) =
            self.intent_overrides(actor, side, execution, override_legality)?;

        for layer in self.profiles.inheritance_order.iter().copied() {
            match layer {
                ProfileLayer::SenritsuDefault => {}
                ProfileLayer::HeroCatalogDefault => {
                    if actor.scope == BehaviorScope::Hero {
                        let hero_id = actor.hero_catalog_id.as_deref()
                            .ok_or(BehaviorError::MissingHeroCatalogId)?;
                        if let Some(overrides) = self.profiles.hero_defaults.get(hero_id) {
                            self.apply_layer(
                                &mut values,
                                &mut provenance,
                                actor,
                                overrides,
                                BehaviorScope::Hero,
                                ProfileLayer::HeroCatalogDefault,
                                format!("hero-catalog:{hero_id}"),
                            )?;
                        }
                    }
                }
                ProfileLayer::ArmyPreference => self.apply_layer(
                    &mut values,
                    &mut provenance,
                    actor,
                    &preferences.army,
                    BehaviorScope::Army,
                    ProfileLayer::ArmyPreference,
                    format!("army:{}", preferences.army_id),
                )?,
                ProfileLayer::SquadAggregate => {
                    let aggregate = self.aggregate_squad(&members)?;
                    self.apply_layer(
                        &mut values,
                        &mut provenance,
                        actor,
                        &aggregate,
                        BehaviorScope::Squad,
                        ProfileLayer::SquadAggregate,
                        format!("squad:{}", actor.subject_id),
                    )?;
                    self.apply_layer(
                        &mut values,
                        &mut provenance,
                        actor,
                        &preferences.squad,
                        BehaviorScope::Squad,
                        ProfileLayer::SquadAggregate,
                        format!("squad-preference:{}", preferences.squad_id),
                    )?;
                }
                ProfileLayer::JinreiConditionalPreference => {
                    for (field, value) in &jinrei_overrides {
                        values.insert(field.clone(), value.clone());
                        provenance.insert(
                            field.clone(),
                            FieldProvenance {
                                layer: ProfileLayer::JinreiConditionalPreference,
                                source: jinrei_sources.get(field).cloned().unwrap_or_default(),
                            },
                        );
                    }
                }
            }
        }
        let digest = profile_digest(&self.identity, actor, &members, &values, tick, side)?;
        Ok(ProfileComposition {
            catalog_identity: self.identity.clone(),
            actor_scope: actor.scope,
            actor_id: actor.subject_id.clone(),
            movement_authority: actor.movement_authority,
            tick,
            side,
            squad_members: members.iter().map(|member| member.subject_id.clone()).collect(),
            values,
            provenance,
            digest,
            unknown_conditions,
            unknown_overrides,
            rejected_overrides,
        })
    }

    /// Resolve candidates supplied by the typed Behavior/Enbu policy layer.
    /// Explicit legal Intent candidates outrank Default candidates. Default
    /// candidates must carry the digest of the exact composed profile.
    ///
    /// This function selects one actor-local candidate. Cross-side arbitration,
    /// world legality, and effect commitment remain with Enbu.
    pub fn resolve_candidates(
        &self,
        composition: &ProfileComposition,
        actor: &ProfileActor,
        tick: u32,
        side: CombatantSide,
        candidates: &[IntentCandidate],
        fallback: Option<&NoOpFallbackCandidate>,
    ) -> Result<Decision, BehaviorError> {
        self.resolve_candidates_inner(composition, actor, tick, side, candidates, fallback, None)
    }

    /// Resolve independently authored profile fields without collapsing unrelated
    /// decisions into one actor-wide selection. Each capability must actually
    /// declare the field it writes in the validated Catalog.
    pub fn resolve_fields(
        &self, composition: &ProfileComposition, actor: &ProfileActor, tick: u32,
        side: CombatantSide, fields: &BTreeMap<BehaviorFieldId, Vec<IntentCandidate>>,
        fallbacks: &BTreeMap<BehaviorFieldId, NoOpFallbackCandidate>,
    ) -> Result<BTreeMap<BehaviorFieldId, Decision>, BehaviorError> {
        if fields.len() > MAX_PROFILE_FIELDS || fallbacks.keys().any(|field| !fields.contains_key(field))
            || fields.values().try_fold(0_usize, |n, candidates| n.checked_add(candidates.len()))
                .map_or(true, |n| n > MAX_CANDIDATES_PER_RESOLUTION) {
            return Err(BehaviorError::TraceLimitExceeded);
        }
        self.validate_composition(composition, actor, tick, side)?;
        // A multi-field writer is represented once per field, but every copy
        // must describe the same candidate and legality evidence.
        let mut by_action = BTreeMap::new();
        for candidate in fields.values().flatten() {
            if let Some(previous) = by_action.insert(&candidate.intent.action_id, candidate) {
                if previous != candidate { return Err(BehaviorError::InvalidCandidateSet); }
            }
        }
        let mut decisions = BTreeMap::new();
        for (field, candidates) in fields {
            let field_key = field.as_key();
            if !self.profiles.fields.contains_key(&field_key) || !self.field_applies(actor.scope, &field_key) {
                return Err(BehaviorError::UnknownProfileField(field_key));
            }
            if candidates.iter().any(|candidate| !self.capabilities.get(&candidate.intent.capability)
                .is_some_and(|capability| capability.behavior_override_arguments.contains_key(&field_key))) {
                return Err(BehaviorError::InvalidCandidateSet);
            }
            decisions.insert(field.clone(), self.resolve_candidates_inner(
                composition, actor, tick, side, candidates, fallbacks.get(field), Some(&field_key),
            )?);
        }
        // An action is a single commitment: every applicable field it writes
        // must select the same action. Missing fields and competing winners are
        // undefined conflicts, not permission to commit a partial action.
        for decision in decisions.values() {
            if let Some(intent) = &decision.selected {
                let capability = self.capabilities.get(&intent.capability)
                    .ok_or(BehaviorError::UnknownCapability)?;
                for field_key in capability.behavior_override_arguments.keys()
                    .filter(|key| self.field_applies(actor.scope, key)) {
                    let field = BehaviorFieldId::parse(field_key)
                        .map_err(|_| BehaviorError::InvalidCandidateSet)?;
                    if !decisions.get(&field).and_then(|d| d.selected.as_ref())
                        .is_some_and(|selected| selected == intent) {
                        return Err(BehaviorError::UnresolvedCandidateConflict);
                    }
                }
            }
        }
        Ok(decisions)
    }

    fn resolve_candidates_inner(
        &self, composition: &ProfileComposition, actor: &ProfileActor, tick: u32,
        side: CombatantSide, candidates: &[IntentCandidate], fallback: Option<&NoOpFallbackCandidate>,
        field: Option<&str>,
    ) -> Result<Decision, BehaviorError> {
        if candidates.len() > MAX_CANDIDATES_PER_RESOLUTION {
            return Err(BehaviorError::TraceLimitExceeded);
        }
        self.validate_composition(composition, actor, tick, side)?;
        let mut trace = Vec::new();
        let explicit = self.collect_candidates(
            actor,
            composition,
            candidates,
            CandidateSource::Explicit,
            &mut trace,
        )?;
        let (selected_explicit, explicit_conflict) = self.select_one(
            actor, side,
            explicit,
            CandidateSource::Explicit,
            &mut trace, field,
        )?;
        if let Some(intent) = selected_explicit {
            return Ok(Decision {
                selected: Some(intent),
                fallback_kind: None,
                trace: bounded_trace(trace)?,
            });
        }
        if explicit_conflict {
            return Err(BehaviorError::UnresolvedCandidateConflict);
        }

        if !explicit_conflict {
            let defaults = self.collect_candidates(
                actor,
                composition,
                candidates,
                CandidateSource::Default,
                &mut trace,
            )?;
            let (selected_default, default_conflict) = self.select_one(
                actor, side,
                defaults,
                CandidateSource::Default,
                &mut trace, field,
            )?;
            if let Some(intent) = selected_default {
                return Ok(Decision {
                    selected: Some(intent),
                    fallback_kind: None,
                    trace: bounded_trace(trace)?,
                });
            }
            if default_conflict {
                return Err(BehaviorError::UnresolvedCandidateConflict);
            }
        }

        if let Some(fallback) = fallback {
            if fallback.tick != tick || fallback.side != side {
                trace.push(DecisionTrace::FallbackRejected {
                    kind: fallback.kind,
                    reason: RejectionReason::StaleCandidateContext,
                });
            } else if !matches!(fallback.legality, Legality::KnownLegal) {
                let reason = match &fallback.legality {
                    Legality::KnownRejected { reason } => RejectionReason::CallerRejected(reason.clone()),
                    Legality::Unknown { reason } => RejectionReason::LegalityUnknown(reason.clone()),
                    Legality::PermissionDenied { reason } => RejectionReason::PermissionDenied(reason.clone()),
                    Legality::KnownLegal => unreachable!("guard matched non-legal fallback"),
                };
                trace.push(DecisionTrace::FallbackRejected { kind: fallback.kind, reason });
            } else {
                trace.push(DecisionTrace::FallbackSelected {
                    kind: fallback.kind,
                    legality: LegalityEvidence::CallerCertified,
                });
                return Ok(Decision {
                    selected: None,
                    fallback_kind: Some(fallback.kind),
                    trace: bounded_trace(trace)?,
                });
            }
        }
        Ok(Decision {
            selected: None,
            fallback_kind: None,
            trace: bounded_trace(trace)?,
        })
    }

    fn validate_composition(
        &self, composition: &ProfileComposition, actor: &ProfileActor, tick: u32,
        side: CombatantSide,
    ) -> Result<(), BehaviorError> {
        let members = sorted_members(actor)?;
        let member_ids = members.iter().map(|member| member.subject_id.clone()).collect::<Vec<_>>();
        let expected_digest = profile_digest(
            &self.identity,
            actor,
            &members,
            &composition.values,
            tick,
            side,
        )?;
        if composition.catalog_identity != self.identity
            || composition.actor_scope != actor.scope
            || composition.actor_id != actor.subject_id
            || composition.movement_authority != actor.movement_authority
            || composition.tick != tick
            || composition.side != side
            || composition.squad_members != member_ids
            || composition.digest != expected_digest
        {
            return Err(BehaviorError::StaleComposition);
        }
        Ok(())
    }

    fn apply_layer(
        &self,
        values: &mut BTreeMap<String, DomainValue>,
        provenance: &mut BTreeMap<String, FieldProvenance>,
        actor: &ProfileActor,
        layer_values: &BTreeMap<String, DomainValue>,
        scope: BehaviorScope,
        layer: ProfileLayer,
        source: String,
    ) -> Result<(), BehaviorError> {
        for (field, value) in layer_values {
            let schema = self.profiles.fields.get(field).ok_or_else(|| {
                BehaviorError::UnknownProfileField(field.clone())
            })?;
            if !schema.scopes.contains(&scope) {
                return Err(BehaviorError::ProfileScopeMismatch(field.clone()));
            }
            if !self.field_applies(actor.scope, field) {
                continue;
            }
            if !value_matches(value, &schema.value_type, 0) {
                return Err(BehaviorError::ProfileTypeMismatch(field.clone()));
            }
            values.insert(field.clone(), value.clone());
            provenance.insert(
                field.clone(),
                FieldProvenance {
                    layer,
                    source: source.clone(),
                },
            );
        }
        Ok(())
    }

    fn aggregate_squad(
        &self,
        members: &[HeroMember],
    ) -> Result<BTreeMap<String, DomainValue>, BehaviorError> {
        if members.is_empty() {
            return Ok(BTreeMap::new());
        }
        let mut result = BTreeMap::new();
        for (field_id, schema) in &self.profiles.fields {
            if !schema.scopes.contains(&BehaviorScope::Squad) {
                continue;
            }
            let mut values = Vec::with_capacity(members.len());
            for member in members {
                let value = self
                    .profiles
                    .hero_defaults
                    .get(&member.hero_catalog_id)
                    .and_then(|profile| profile.get(field_id))
                    .or_else(|| self.profiles.senritsu_default.get(field_id))
                    .ok_or_else(|| BehaviorError::MissingProfileDefault(field_id.clone()))?;
                if !value_matches(value, &schema.value_type, 0) {
                    return Err(BehaviorError::ProfileTypeMismatch(field_id.clone()));
                }
                values.push((member.subject_id.clone(), value.clone()));
            }
            let policy = schema
                .aggregation
                .ok_or_else(|| BehaviorError::MissingAggregation(field_id.clone()))?;
            result.insert(field_id.clone(), aggregate_values(field_id, policy, values)?);
        }
        Ok(result)
    }

    fn intent_overrides(
        &self,
        actor: &ProfileActor,
        side: CombatantSide,
        execution: &TacticalExecutionOutput,
        override_legality: &BTreeMap<ActionId, Legality>,
    ) -> Result<(
        BTreeMap<String, DomainValue>,
        BTreeMap<String, String>,
        Vec<UnknownCondition>,
        Vec<UnknownOverride>,
        Vec<RejectedOverride>,
    ), BehaviorError> {
        let mut writes: BTreeMap<String, Vec<(Intent, DomainValue)>> = BTreeMap::new();
        let mut rejected = Vec::new();
        let mut unknown_overrides = Vec::new();
        let mut eligible_intents = Vec::new();
        for intent in &execution.intents {
            let Some(capability) = self.capabilities.get(&intent.capability) else {
                rejected.push(RejectedOverride {
                    action_id: intent.action_id.clone(),
                    reason: RejectionReason::UnknownCapability,
                });
                continue;
            };
            if capability.behavior_override_arguments.is_empty() || !actor_matches(actor, intent) {
                continue;
            }
            match override_legality.get(&intent.action_id) {
                Some(Legality::KnownLegal) => {}
                Some(Legality::KnownRejected { reason }) => {
                    rejected.push(RejectedOverride {
                        action_id: intent.action_id.clone(),
                        reason: RejectionReason::CallerRejected(reason.clone()),
                    });
                    continue;
                }
                Some(Legality::Unknown { reason }) => {
                    unknown_overrides.push(UnknownOverride {
                        action_id: intent.action_id.clone(),
                        reason: reason.clone(),
                    });
                    continue;
                }
                None => {
                    unknown_overrides.push(UnknownOverride {
                        action_id: intent.action_id.clone(),
                        reason: "caller supplied no legality fact".into(),
                    });
                    continue;
                }
                Some(Legality::PermissionDenied { reason }) => {
                    rejected.push(RejectedOverride {
                        action_id: intent.action_id.clone(),
                        reason: RejectionReason::PermissionDenied(reason.clone()),
                    });
                    continue;
                }
            }
            if !intent_matches_signature(intent, capability)
                || !intent_matches_actor_scope(actor, intent, capability)
            {
                rejected.push(RejectedOverride {
                    action_id: intent.action_id.clone(),
                    reason: RejectionReason::InvalidIntentSignature,
                });
                continue;
            }
            eligible_intents.push(intent.clone());
        }
        if self.profiles.cross_capability_order.is_some() { unique_action_ids(&eligible_intents)?; }
        let arbitration = arbitrate_by_ruleset(&eligible_intents, side, &self.arbitration, self.profiles.cross_capability_order.is_some())?;
        for intent in arbitration.rejected {
            rejected.push(RejectedOverride {
                action_id: intent.action_id,
                reason: RejectionReason::RulePlanArbitration,
            });
        }
        for intent in arbitration.selected {
            let capability = self.capabilities.get(&intent.capability).ok_or(BehaviorError::UnknownCapability)?;
            for (field_id, argument_index) in &capability.behavior_override_arguments {
                let Some(value) = intent.arguments.get(*argument_index as usize).cloned() else {
                    rejected.push(RejectedOverride {
                        action_id: intent.action_id.clone(),
                        reason: RejectionReason::InvalidIntentSignature,
                    });
                    continue;
                };
                let schema = self.profiles.fields.get(field_id)
                    .ok_or_else(|| BehaviorError::UnknownProfileField(field_id.clone()))?;
                if !schema.override_policy.conditional_tick_override {
                    rejected.push(RejectedOverride {
                        action_id: intent.action_id.clone(),
                        reason: RejectionReason::OverrideForbidden,
                    });
                    continue;
                }
                if !value_matches(&value, &schema.value_type, 0) {
                    rejected.push(RejectedOverride {
                        action_id: intent.action_id.clone(),
                        reason: RejectionReason::ProfileTypeMismatch,
                    });
                    continue;
                }
                writes.entry(field_id.clone()).or_default().push((intent.clone(), value));
            }
        }
        let mut overrides = BTreeMap::new();
        let mut sources = BTreeMap::new();
        for (field, mut candidates) in writes {
            candidates.sort_by(|left, right| canonical_intent(&left.0, &right.0));
            let unique_values = candidates
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<BTreeSet<_>>();
            if unique_values.len() > 1 {
                let declarations = self.profiles.cross_capability_order.as_ref()
                    .and_then(|contract| contract.field_writers.get(&field))
                    .ok_or(BehaviorError::UnresolvedCandidateConflict)?;
                let ordered = self.authored_order(actor, side, candidates.iter().map(|(intent, _)| intent.clone()).collect(), declarations)?;
                for intent in ordered.rejected {
                    rejected.push(RejectedOverride { action_id: intent.action_id,
                        reason: RejectionReason::FieldOrderRejected(field.clone()) });
                }
                let winner = &ordered.selected[0];
                candidates.retain(|(intent, _)| intent.action_id == winner.action_id);
            }
            if let Some((_, value)) = candidates.first() {
                overrides.insert(field.clone(), value.clone());
                // Equal writes compose one value; provenance names every contributor,
                // rather than choosing a winner by container or canonical name order.
                sources.insert(field, candidates.iter().map(|(intent, _)| format!("jinrei:{}", intent.action_id)).collect::<Vec<_>>().join(" + "));
            }
        }
        let unknown_conditions = execution
            .diagnostics
            .iter()
            .filter_map(|diagnostic| match diagnostic {
                TacticalDiagnostic::RuntimeNotice { code, details }
                    if code.as_str() == "when_unknown" =>
                {
                    details.get("action").map(|action| UnknownCondition {
                        action_id: action.clone(),
                        truth: Truth::Unknown,
                    })
                }
                _ => None,
            })
            .collect();
        Ok((overrides, sources, unknown_conditions, unknown_overrides, rejected))
    }

    fn collect_candidates(
        &self,
        actor: &ProfileActor,
        composition: &ProfileComposition,
        candidates: &[IntentCandidate],
        source: CandidateSource,
        trace: &mut Vec<DecisionTrace>,
    ) -> Result<Vec<Intent>, BehaviorError> {
        let mut result = Vec::new();
        for candidate in candidates.iter().filter(|candidate| candidate.source == source) {
            if candidate.tick != composition.tick || candidate.side != composition.side {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: candidate.intent.action_id.clone(),
                    reason: RejectionReason::StaleCandidateContext,
                });
                continue;
            }
            if !actor_matches(actor, &candidate.intent) {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: candidate.intent.action_id.clone(),
                    reason: RejectionReason::ActorMismatch,
                });
                continue;
            }
            let Some(definition) = self.capabilities.get(&candidate.intent.capability) else {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: candidate.intent.action_id.clone(),
                    reason: RejectionReason::UnknownCapability,
                });
                continue;
            };
            if !intent_matches_signature(&candidate.intent, definition)
                || !intent_matches_actor_scope(actor, &candidate.intent, definition)
            {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: candidate.intent.action_id.clone(),
                    reason: RejectionReason::InvalidIntentSignature,
                });
                continue;
            }
            match &candidate.legality {
                Legality::Unknown { reason } => {
                    trace.push(DecisionTrace::CandidateUnknown {
                        action_id: candidate.intent.action_id.clone(),
                        reason: reason.clone(),
                    });
                    continue;
                }
                Legality::KnownRejected { reason } => {
                    trace.push(DecisionTrace::CandidateRejected {
                        action_id: candidate.intent.action_id.clone(),
                        reason: RejectionReason::CallerRejected(reason.clone()),
                    });
                    continue;
                }
                Legality::PermissionDenied { reason } => {
                    trace.push(DecisionTrace::CandidateRejected {
                        action_id: candidate.intent.action_id.clone(),
                        reason: RejectionReason::PermissionDenied(reason.clone()),
                    });
                    continue;
                }
                Legality::KnownLegal => {}
            }
            if source == CandidateSource::Default
                && candidate.profile_digest.as_ref() != Some(&composition.digest)
            {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: candidate.intent.action_id.clone(),
                    reason: RejectionReason::StaleProfile,
                });
                continue;
            }
            result.push(candidate.intent.clone());
            trace.push(DecisionTrace::CandidateEligible {
                action_id: candidate.intent.action_id.clone(),
                source,
                legality: LegalityEvidence::CallerCertified,
            });
        }
        Ok(result)
    }

    fn authored_order(
        &self, actor: &ProfileActor, side: CombatantSide, mut candidates: Vec<Intent>,
        declarations: &[BehaviorOrderDeclaration],
    ) -> Result<ArbitrationResult, BehaviorError> {
        unique_action_ids(&candidates)?;
        let applicable = declarations.iter().filter(|declaration| declaration.scope == actor.scope
            && candidates.iter().all(|intent| declaration.capabilities.contains(&intent.capability)
                && self.capabilities.get(&intent.capability).is_some_and(|definition|
                    definition.actor_argument.and_then(|index| definition.arguments.get(index as usize))
                        .is_some_and(|argument| argument.value_type == (DomainType::Entity { entity_type: Some(declaration.actor_type.clone()) }))))).collect::<Vec<_>>();
        if applicable.len() != 1 { return Err(BehaviorError::UnresolvedCandidateConflict); }
        let ArbitrationResolution::SelectOrdered { sort_by, max_accepted: 1 } = &applicable[0].arbitration.resolution else {
            return Err(BehaviorError::UnresolvedCandidateConflict);
        };
        // Every nullable key must have an actual value. Missing never ranks first/last.
        if candidates.iter().any(|intent| sort_by.iter().any(|term| key_value(intent, side, &term.key).is_none())) {
            return Err(BehaviorError::UnresolvedCandidateConflict);
        }
        candidates.sort_by(|left, right| compare_declared(left, side, right, side, sort_by));
        if candidates.windows(2).any(|pair| compare_declared(&pair[0], side, &pair[1], side, sort_by) == Ordering::Equal) {
            return Err(BehaviorError::UnresolvedCandidateConflict);
        }
        let rejected = candidates.split_off(1);
        Ok(ArbitrationResult { selected: candidates, rejected })
    }

    fn select_one(
        &self,
        actor: &ProfileActor,
        side: CombatantSide,
        candidates: Vec<Intent>,
        source: CandidateSource,
        trace: &mut Vec<DecisionTrace>,
        field: Option<&str>,
    ) -> Result<(Option<Intent>, bool), BehaviorError> {
        if candidates.is_empty() {
            return Ok((None, false));
        }
        if self.profiles.cross_capability_order.is_some() { unique_action_ids(&candidates)?; }
        let mut accepted = arbitrate_by_ruleset(&candidates, side, &self.arbitration, self.profiles.cross_capability_order.is_some())?;
        if accepted.selected.len() > 1 {
            if let Some(contract) = &self.profiles.cross_capability_order {
                let declarations = match field {
                    Some(field) => contract.field_writers.get(field).ok_or(BehaviorError::UnresolvedCandidateConflict)?,
                    None => &contract.intent_selection,
                };
                let ordered = self.authored_order(actor, side, accepted.selected, declarations)?;
                accepted.selected = ordered.selected;
                accepted.rejected.extend(ordered.rejected);
            }
        }
        for intent in accepted.rejected {
            trace.push(DecisionTrace::CandidateRejected {
                action_id: intent.action_id,
                reason: RejectionReason::RulePlanArbitration,
            });
        }
        if accepted.selected.len() != 1 {
            let conflict = accepted.selected.len() > 1;
            for intent in accepted.selected {
                trace.push(DecisionTrace::CandidateRejected {
                    action_id: intent.action_id,
                    reason: RejectionReason::UnresolvedCrossCapabilityConflict,
                });
            }
            return Ok((None, conflict));
        }
        let selected = accepted.selected.into_iter().next().expect("length checked");
        trace.push(DecisionTrace::CandidateSelected {
            action_id: selected.action_id.clone(),
            source,
        });
        Ok((Some(selected), false))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HeroMember {
    pub subject_id: EntityId,
    pub hero_catalog_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileActor {
    pub subject_id: EntityId,
    pub scope: BehaviorScope,
    pub movement_authority: MovementAuthority,
    /// Required for Hero actors; a Squad supplies the full current roster below.
    pub hero_catalog_id: Option<String>,
    pub squad_members: Vec<HeroMember>,
}

/// Control context passed to the caller's legality policy. The resolver does
/// not infer a capability's movement semantics from its identifier; Enbu must
/// certify a Squad movement candidate and reject individual Hero movement.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum MovementAuthority {
    Army,
    Squad,
    SoloHero,
    HeroInSquad,
    LaneGroup,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProfilePreferences {
    pub army_id: String,
    pub army: BTreeMap<String, DomainValue>,
    pub squad_id: String,
    pub squad: BTreeMap<String, DomainValue>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProfileComposition {
    pub catalog_identity: CatalogCompatibilityKey,
    pub actor_scope: BehaviorScope,
    pub actor_id: EntityId,
    pub movement_authority: MovementAuthority,
    pub tick: u32,
    pub side: CombatantSide,
    pub squad_members: Vec<EntityId>,
    pub values: BTreeMap<String, DomainValue>,
    pub provenance: BTreeMap<String, FieldProvenance>,
    pub digest: ContentDigest,
    pub unknown_conditions: Vec<UnknownCondition>,
    pub unknown_overrides: Vec<UnknownOverride>,
    pub rejected_overrides: Vec<RejectedOverride>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FieldProvenance {
    pub layer: ProfileLayer,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnknownCondition {
    pub action_id: String,
    pub truth: Truth,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnknownOverride {
    pub action_id: ActionId,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RejectedOverride {
    pub action_id: ActionId,
    pub reason: RejectionReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum CandidateSource {
    Explicit,
    Default,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Legality {
    KnownLegal,
    KnownRejected { reason: String },
    Unknown { reason: String },
    PermissionDenied { reason: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentCandidate {
    pub intent: Intent,
    pub source: CandidateSource,
    pub tick: u32,
    pub side: CombatantSide,
    /// Required on Default candidates. Explicit candidates derive from Jinrei's
    /// typed execution output.
    pub profile_digest: Option<ContentDigest>,
    pub legality: Legality,
}

/// Caller-certified effective no-action result. It carries no Intent and does
/// not enter Enbu as a capability or mutate the World.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoOpFallbackCandidate {
    pub kind: NoOpFallbackKind,
    pub tick: u32,
    pub side: CombatantSide,
    pub legality: Legality,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum LegalityEvidence {
    CallerCertified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum DecisionTrace {
    CandidateEligible {
        action_id: ActionId,
        source: CandidateSource,
        legality: LegalityEvidence,
    },
    CandidateSelected {
        action_id: ActionId,
        source: CandidateSource,
    },
    CandidateUnknown {
        action_id: ActionId,
        reason: String,
    },
    CandidateRejected {
        action_id: ActionId,
        reason: RejectionReason,
    },
    FallbackSelected {
        kind: NoOpFallbackKind,
        legality: LegalityEvidence,
    },
    FallbackRejected {
        kind: NoOpFallbackKind,
        reason: RejectionReason,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum RejectionReason {
    ActorMismatch,
    InvalidIntentSignature,
    UnknownCapability,
    ProfileTypeMismatch,
    OverrideForbidden,
    ConflictingProfileOverrides,
    FieldOrderRejected(String),
    CallerRejected(String),
    PermissionDenied(String),
    RulePlanArbitration,
    UnresolvedCrossCapabilityConflict,
    StaleProfile,
    LegalityUnknown(String),
    StaleCandidateContext,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Decision {
    /// None means no Intent was selected. A certified no-op is represented by
    /// `fallback_kind: Some(..)` and does not carry a World-changing Intent.
    pub selected: Option<Intent>,
    pub fallback_kind: Option<NoOpFallbackKind>,
    pub trace: Vec<DecisionTrace>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BehaviorError {
    CatalogIdentityMismatch,
    ProfilesNotDeclared,
    MissingProfileDefault(String),
    MissingHeroCatalogId,
    EmptySquad,
    HeroNotInRoster,
    DuplicateSquadMember(EntityId),
    UnknownProfileField(String),
    ProfileScopeMismatch(String),
    ProfileTypeMismatch(String),
    MissingAggregation(String),
    SquadAggregationConflict(String),
    ArithmeticOverflow(String),
    StaleComposition,
    UnknownCapability,
    CatalogLimitExceeded,
    InvalidCandidateSet,
    InvalidMovementAuthority,
    UnresolvedCandidateConflict,
    DigestSerialization(String),
    TraceLimitExceeded,
}

impl std::fmt::Display for BehaviorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for BehaviorError {}

fn validate_actor(actor: &ProfileActor, profiles: &BehaviorProfileMetadata) -> Result<(), BehaviorError> {
    if actor.scope == BehaviorScope::Hero && actor.hero_catalog_id.is_none() {
        return Err(BehaviorError::MissingHeroCatalogId);
    }
    if actor.scope == BehaviorScope::Squad && actor.squad_members.is_empty() {
        return Err(BehaviorError::EmptySquad);
    }
    if actor.squad_members.len() > MAX_SQUAD_MEMBERS {
        return Err(BehaviorError::TraceLimitExceeded);
    }
    let expected_authority = match actor.scope {
        BehaviorScope::Army => MovementAuthority::Army,
        BehaviorScope::Squad => MovementAuthority::Squad,
        BehaviorScope::Hero if actor.squad_members.len() > 1 => MovementAuthority::HeroInSquad,
        BehaviorScope::Hero => MovementAuthority::SoloHero,
        BehaviorScope::LaneLimitedMinion => MovementAuthority::LaneGroup,
    };
    if actor.movement_authority != expected_authority {
        return Err(BehaviorError::InvalidMovementAuthority);
    }
    for member in &actor.squad_members {
        if member.hero_catalog_id.is_empty() {
            return Err(BehaviorError::MissingHeroCatalogId);
        }
    }
    for field in profiles.fields.keys() {
        if !profiles.senritsu_default.contains_key(field) {
            return Err(BehaviorError::MissingProfileDefault(field.clone()));
        }
    }
    Ok(())
}

fn sorted_members(actor: &ProfileActor) -> Result<Vec<HeroMember>, BehaviorError> {
    if actor.squad_members.len() > MAX_SQUAD_MEMBERS {
        return Err(BehaviorError::TraceLimitExceeded);
    }
    let mut members = actor.squad_members.clone();
    if actor.scope == BehaviorScope::Hero && members.is_empty() {
        members.push(HeroMember {
            subject_id: actor.subject_id.clone(),
            hero_catalog_id: actor.hero_catalog_id.clone().ok_or(BehaviorError::MissingHeroCatalogId)?,
        });
    }
    members.sort_by(|left, right| left.subject_id.cmp(&right.subject_id));
    let mut seen = BTreeSet::new();
    for member in &members {
        if !seen.insert(member.subject_id.clone()) {
            return Err(BehaviorError::DuplicateSquadMember(member.subject_id.clone()));
        }
    }
    if actor.scope == BehaviorScope::Hero {
        let hero_id = actor.hero_catalog_id.as_deref().ok_or(BehaviorError::MissingHeroCatalogId)?;
        if !members.iter().any(|member| {
            member.subject_id == actor.subject_id && member.hero_catalog_id == hero_id
        }) {
            return Err(BehaviorError::HeroNotInRoster);
        }
    }
    Ok(members)
}

fn aggregate_values(
    field: &str,
    policy: AggregationPolicy,
    mut values: Vec<(EntityId, DomainValue)>,
) -> Result<DomainValue, BehaviorError> {
    values.sort_by(|left, right| left.0.cmp(&right.0));
    match policy {
        AggregationPolicy::RequireAgreement => {
            let first = values.first().ok_or(BehaviorError::EmptySquad)?.1.clone();
            if values.iter().all(|(_, value)| *value == first) {
                Ok(first)
            } else {
                Err(BehaviorError::SquadAggregationConflict(field.into()))
            }
        }
        AggregationPolicy::FirstByStableSubjectId => values
            .first()
            .map(|(_, value)| value.clone())
            .ok_or(BehaviorError::EmptySquad),
        AggregationPolicy::Minimum | AggregationPolicy::Maximum => {
            let mut chosen = values.first().ok_or(BehaviorError::EmptySquad)?.1.clone();
            for (_, value) in values.iter().skip(1) {
                let order = numeric_cmp(&chosen, value)
                    .ok_or_else(|| BehaviorError::ProfileTypeMismatch(field.into()))?;
                if (policy == AggregationPolicy::Minimum && order == Ordering::Greater)
                    || (policy == AggregationPolicy::Maximum && order == Ordering::Less)
                {
                    chosen = value.clone();
                }
            }
            Ok(chosen)
        }
        AggregationPolicy::CheckedSum => {
            let first = values.first().ok_or(BehaviorError::EmptySquad)?.1.clone();
            match first {
                DomainValue::Integer(start) => values.iter().skip(1).try_fold(
                    DomainValue::Integer(start),
                    |acc, (_, value)| match (acc, value) {
                        (DomainValue::Integer(total), DomainValue::Integer(next)) => total
                            .checked_add(*next)
                            .map(DomainValue::Integer)
                            .ok_or_else(|| BehaviorError::ArithmeticOverflow(field.into())),
                        _ => Err(BehaviorError::ProfileTypeMismatch(field.into())),
                    },
                ),
                DomainValue::Fixed { coefficient, scale } => values.iter().skip(1).try_fold(
                    DomainValue::Fixed { coefficient, scale },
                    |acc, (_, value)| match (acc, value) {
                        (
                            DomainValue::Fixed { coefficient: total, scale: left_scale },
                            DomainValue::Fixed { coefficient: next, scale: right_scale },
                        ) if left_scale == *right_scale => total
                            .checked_add(*next)
                            .map(|coefficient| DomainValue::Fixed { coefficient, scale: left_scale })
                            .ok_or_else(|| BehaviorError::ArithmeticOverflow(field.into())),
                        _ => Err(BehaviorError::ProfileTypeMismatch(field.into())),
                    },
                ),
                _ => Err(BehaviorError::ProfileTypeMismatch(field.into())),
            }
        }
    }
}

fn numeric_cmp(left: &DomainValue, right: &DomainValue) -> Option<Ordering> {
    match (left, right) {
        (DomainValue::Integer(left), DomainValue::Integer(right)) => Some(left.cmp(right)),
        (
            DomainValue::Fixed { coefficient: left, scale: left_scale },
            DomainValue::Fixed { coefficient: right, scale: right_scale },
        ) if left_scale == right_scale => Some(left.cmp(right)),
        _ => None,
    }
}

fn actor_matches(actor: &ProfileActor, intent: &Intent) -> bool {
    match actor.scope {
        BehaviorScope::Army => intent.actor.as_ref().map_or(true, |id| id == &actor.subject_id),
        BehaviorScope::Squad | BehaviorScope::Hero => intent.actor.as_ref() == Some(&actor.subject_id),
        BehaviorScope::LaneLimitedMinion => intent.actor.as_ref() == Some(&actor.subject_id),
    }
}

fn intent_matches_actor_scope(
    actor: &ProfileActor,
    intent: &Intent,
    definition: &CapabilityDefinition,
) -> bool {
    let scope_matches = match (&definition.actor_scope, actor.scope) {
        (senritsu::catalog::Scope::Army, BehaviorScope::Army) => true,
        (senritsu::catalog::Scope::Squad, BehaviorScope::Squad) => true,
        (senritsu::catalog::Scope::Hero, BehaviorScope::Hero) => true,
        (senritsu::catalog::Scope::MinionLaneLimited, BehaviorScope::LaneLimitedMinion) => true,
        _ => false,
    };
    if !scope_matches {
        return false;
    }
    match definition.actor_argument {
        Some(index) => matches!(
            (intent.arguments.get(index as usize), intent.actor.as_ref()),
            (Some(DomainValue::Entity(argument_actor)), Some(intent_actor))
                if argument_actor == intent_actor
        ),
        None => intent.actor.is_none(),
    }
}

fn intent_matches_signature(intent: &Intent, definition: &CapabilityDefinition) -> bool {
    if intent.arguments.len() != definition.arguments.len() {
        return false;
    }
    let arguments_match = definition
        .arguments
        .iter()
        .zip(&intent.arguments)
        .all(|(parameter, value)| value_matches(value, &parameter.value_type, 0));
    if !arguments_match {
        return false;
    }
    let target_matches = match definition.target_argument {
        Some(index) => matches!(
            (intent.arguments.get(index as usize), intent.target.as_ref()),
            (Some(DomainValue::Entity(argument_target)), Some(intent_target))
                if argument_target == intent_target
        ),
        None => intent.target.is_none(),
    };
    target_matches
}

fn value_matches(value: &DomainValue, ty: &DomainType, depth: u32) -> bool {
    if depth > 64 {
        return false;
    }
    match (value, ty) {
        (DomainValue::Bool(_), DomainType::Bool) => true,
        (DomainValue::Integer(value), DomainType::Integer { min, max }) => {
            min.map_or(true, |min| value >= &min) && max.map_or(true, |max| value <= &max)
        }
        (
            DomainValue::Fixed { coefficient, scale },
            DomainType::Fixed { scale: expected, min, max },
        ) => {
            scale == expected
                && min.map_or(true, |min| coefficient >= &min)
                && max.map_or(true, |max| coefficient <= &max)
        }
        (DomainValue::String(value), DomainType::String { max_bytes }) => value.len() <= *max_bytes as usize,
        (
            DomainValue::Enum(value),
            DomainType::Enum { values, .. },
        ) => values.contains(value),
        (DomainValue::Entity(_), DomainType::Entity { .. }) => true,
        (DomainValue::Null, DomainType::Optional(_)) => true,
        (value, DomainType::Optional(inner)) => value_matches(value, inner, depth + 1),
        (DomainValue::List(items), DomainType::List { element, max_items })
        | (DomainValue::List(items), DomainType::Vector { element, max_items }) => {
            items.len() <= *max_items as usize && items.iter().all(|item| value_matches(item, element, depth + 1))
        }
        (DomainValue::List(rows), DomainType::Matrix { element, max_rows, max_columns }) => {
            rows.len() <= *max_rows as usize && rows.iter().all(|row| match row {
                DomainValue::List(cells) => cells.len() <= *max_columns as usize && cells.iter().all(|cell| value_matches(cell, element, depth + 2)),
                _ => false,
            })
        }
        (DomainValue::Record(values), DomainType::Record { fields }) => {
            values.len() == fields.len() && fields.iter().all(|(id, ty)| values.get(id).is_some_and(|value| value_matches(value, ty, depth + 1)))
        }
        _ => false,
    }
}

fn profile_digest(
    identity: &CatalogCompatibilityKey,
    actor: &ProfileActor,
    members: &[HeroMember],
    values: &BTreeMap<String, DomainValue>,
    tick: u32,
    side: CombatantSide,
) -> Result<ContentDigest, BehaviorError> {
    #[derive(Serialize)]
    struct StableProfile<'a> {
        identity: &'a CatalogCompatibilityKey,
        scope: BehaviorScope,
        subject: &'a EntityId,
        movement_authority: MovementAuthority,
        tick: u32,
        side: CombatantSide,
        members: &'a [HeroMember],
        values: &'a BTreeMap<String, DomainValue>,
    }
    let bytes = serde_json::to_vec(&StableProfile {
        identity,
        scope: actor.scope,
        subject: &actor.subject_id,
        movement_authority: actor.movement_authority,
        tick,
        side,
        members,
        values,
    })
    .map_err(|error| BehaviorError::DigestSerialization(error.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(b"senkei.behavior.effective-profile.v1\0");
    hasher.update(bytes);
    Ok(ContentDigest::new(format!("{:x}", hasher.finalize())))
}

fn bounded_trace(trace: Vec<DecisionTrace>) -> Result<Vec<DecisionTrace>, BehaviorError> {
    if trace.len() > MAX_TRACE_RECORDS {
        return Err(BehaviorError::TraceLimitExceeded);
    }
    Ok(trace)
}

struct ArbitrationResult {
    selected: Vec<Intent>,
    rejected: Vec<Intent>,
}

fn arbitrate_by_ruleset(
    intents: &[Intent],
    side: CombatantSide,
    rules: &BTreeMap<senkei_model::CapabilityId, senkei_model::ArbitrationRule>,
    strict: bool,
) -> Result<ArbitrationResult, BehaviorError> {
    let mut groups = BTreeMap::<senkei_model::CapabilityId, Vec<Intent>>::new();
    for intent in intents {
        groups.entry(intent.capability.clone()).or_default().push(intent.clone());
    }
    let mut result = ArbitrationResult { selected: Vec::new(), rejected: Vec::new() };
    for (capability, mut group) in groups {
        let rule = rules.get(&capability).ok_or(BehaviorError::UnknownCapability)?;
        group.sort_by(canonical_intent);
        let mut rejected = BTreeSet::new();
        match &rule.resolution {
            ArbitrationResolution::AllowAll { max_accepted } => {
                if strict && group.len() > *max_accepted as usize { return Err(BehaviorError::UnresolvedCandidateConflict); }
                for index in *max_accepted as usize..group.len() { rejected.insert(index); }
            }
            ArbitrationResolution::RejectConflicts => {
                for left in 0..group.len() {
                    for right in left + 1..group.len() {
                        if keys_conflict(&group[left], side, &group[right], side, &rule.conflict_keys) {
                            rejected.insert(left);
                            rejected.insert(right);
                        }
                    }
                }
            }
            ArbitrationResolution::SelectOrdered { sort_by, max_accepted } => {
                if strict {
                    // Check before local reduction: a global order cannot recover a
                    // candidate silently discarded by a missing local ordering key.
                    for (index, intent) in group.iter().enumerate() {
                        let competes = group.len() > *max_accepted as usize || group.iter().enumerate().any(|(other, right)|
                            index != other && keys_conflict(intent, side, right, side, &rule.conflict_keys));
                        if competes && sort_by.iter().any(|term| key_value(intent, side, &term.key).is_none()) {
                            return Err(BehaviorError::UnresolvedCandidateConflict);
                        }
                    }
                    group.sort_by(|left, right| compare_declared(left, side, right, side, sort_by));
                } else {
                    group.sort_by(|left, right| compare_intents(left, side, right, side, sort_by));
                }
                let mut selected = Vec::new();
                let mut checked_tie_end = 0;
                for index in 0..group.len() {
                    if selected.len() >= *max_accepted as usize || selected.iter().any(|prior| {
                        keys_conflict(&group[*prior], side, &group[index], side, &rule.conflict_keys)
                    }) {
                        rejected.insert(index);
                    } else {
                        if strict && index >= checked_tie_end {
                            // Equal-ranked candidates blocked by an earlier strictly
                            // better selection are irrelevant. Remaining ties must all
                            // fit and be disjoint; otherwise no local winner is declared.
                            checked_tie_end = (index + 1..group.len()).find(|other|
                                compare_declared(&group[index], side, &group[*other], side, sort_by) != Ordering::Equal).unwrap_or(group.len());
                            let tied = (index..checked_tie_end).filter(|other|
                                !selected.iter().any(|prior| keys_conflict(&group[*prior], side, &group[*other], side, &rule.conflict_keys)))
                                .collect::<Vec<_>>();
                            if tied.len() > (*max_accepted as usize).saturating_sub(selected.len())
                                || tied.iter().enumerate().any(|(position, left)| tied[position + 1..].iter()
                                    .any(|right| keys_conflict(&group[*left], side, &group[*right], side, &rule.conflict_keys))) {
                                return Err(BehaviorError::UnresolvedCandidateConflict);
                            }
                        }
                        selected.push(index);
                    }
                }
            }
        }
        for (index, intent) in group.into_iter().enumerate() {
            if rejected.contains(&index) { result.rejected.push(intent); } else { result.selected.push(intent); }
        }
    }
    result.selected.sort_by(canonical_intent);
    result.rejected.sort_by(canonical_intent);
    Ok(result)
}

fn canonical_intent(left: &Intent, right: &Intent) -> Ordering {
    (left.action_id.as_str(), &left.actor, &left.target, &left.capability, &left.arguments)
        .cmp(&(right.action_id.as_str(), &right.actor, &right.target, &right.capability, &right.arguments))
}

fn keys_conflict(left: &Intent, left_side: CombatantSide, right: &Intent, right_side: CombatantSide, keys: &[IntentKey]) -> bool {
    !keys.is_empty() && keys.iter().all(|key| key_value(left, left_side, key) == key_value(right, right_side, key))
}

fn key_value(intent: &Intent, side: CombatantSide, key: &IntentKey) -> Option<DomainValue> {
    match key {
        IntentKey::Priority => intent.priority.map(DomainValue::Integer),
        IntentKey::Side => Some(DomainValue::Enum(senkei_model::SymbolId::from(match side {
            CombatantSide::Attacker => "attacker",
            CombatantSide::Defender => "defender",
        }))),
        IntentKey::Actor => intent.actor.clone().map(DomainValue::Entity),
        IntentKey::Target => intent.target.clone().map(DomainValue::Entity),
        IntentKey::ActionId => Some(DomainValue::String(intent.action_id.to_string())),
        IntentKey::Capability => Some(DomainValue::String(intent.capability.to_string())),
        IntentKey::Argument(index) => intent.arguments.get(*index as usize).cloned(),
    }
}

fn unique_action_ids(intents: &[Intent]) -> Result<(), BehaviorError> {
    let mut ids = BTreeSet::new();
    if intents.iter().any(|intent| intent.action_id.as_str().is_empty() || !ids.insert(&intent.action_id)) {
        return Err(BehaviorError::UnresolvedCandidateConflict);
    }
    Ok(())
}

fn compare_intents(left: &Intent, left_side: CombatantSide, right: &Intent, right_side: CombatantSide, terms: &[IntentSortTerm]) -> Ordering {
    compare_declared(left, left_side, right, right_side, terms).then_with(|| canonical_intent(left, right))
}

fn compare_declared(left: &Intent, left_side: CombatantSide, right: &Intent, right_side: CombatantSide, terms: &[IntentSortTerm]) -> Ordering {
    for term in terms {
        let mut order = compare_optional(&key_value(left, left_side, &term.key), &key_value(right, right_side, &term.key));
        if term.direction == SortDirection::Descending { order = order.reverse(); }
        if order != Ordering::Equal { return order; }
    }
    Ordering::Equal
}

fn compare_optional(left: &Option<DomainValue>, right: &Option<DomainValue>) -> Ordering {
    match (left, right) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (Some(left), Some(right)) => left.cmp(right),
    }
}
