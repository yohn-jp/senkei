use enbu::{new_match_context, preflight, reproduction_snapshot_digest, simulate};
use jinrei::{compile, Vm};
use senkei_model::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

fn digest(value: &impl serde::Serialize) -> ContentDigest {
    ContentDigest::new(format!("{:x}", Sha256::digest(serde_json::to_vec(value).unwrap())))
}

// This coefficient and aggregation are local to this test, not a published rule.
fn test_package() -> RulePackage {
    let mut package = senritsu::next_package();
    let mut projection = senritsu::next_local_trial_package().next.unwrap().projection_policy.unwrap();
    projection.relation = None;
    projection.maturity = Some(RelationMaturityPolicy {
        version: Version::new(7, 0, 0),
        target: RelationMaturityTarget::SquadMaturityIncrement,
        aggregation: RelationMaturityAggregation::CompletePairMean,
        add_per_level: 1,
        max_level: 10,
        max_bonus: 2,
        rounding: RelationRounding::Floor,
    });
    package.next.as_mut().unwrap().projection_policy = Some(projection);
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    package
}

fn default_value(value_type: &DomainType) -> Option<DomainValue> {
    match value_type {
        DomainType::Bool => Some(DomainValue::Bool(false)),
        DomainType::Integer { min, max } => {
            let value = min.unwrap_or(0).max(0);
            Some(DomainValue::Integer(max.map_or(value, |maximum| value.min(maximum))))
        }
        DomainType::Fixed { scale, min, max } => {
            let value = min.unwrap_or(0).max(0);
            Some(DomainValue::Fixed { coefficient: max.map_or(value, |maximum| value.min(maximum)), scale: *scale })
        }
        DomainType::String { .. } => Some(DomainValue::String(String::new())),
        DomainType::Enum { values, .. } => values.iter().next().cloned().map(DomainValue::Enum),
        DomainType::Entity { .. } => None,
        DomainType::Optional(_) => Some(DomainValue::Null),
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => Some(DomainValue::List(Vec::new())),
        DomainType::Record { fields } => fields.iter()
            .map(|(field, value_type)| Some((field.clone(), default_value(value_type)?)))
            .collect::<Option<BTreeMap<_, _>>>().map(DomainValue::Record),
    }
}

fn snapshot(rules: &VerifiedRulePlan, side: CombatantSide, program: TacticalProgram) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().unwrap();
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| default_value(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else {
            assert!(!schema.required, "fixture must fill required configuration");
        }
    }
    let base = match side { CombatantSide::Attacker => &next.map.attacker_base, CombatantSide::Defender => &next.map.defender_base };
    let heroes = (0..5).map(|i| {
        let hero = &next.heroes[i];
        DomainValue::Record(BTreeMap::from([
            (FieldId::new("slot_id"), DomainValue::String(format!("slot-{}", i + 1))),
            (FieldId::new("catalog_id"), DomainValue::String(hero.id.clone())),
            (FieldId::new("squad"), DomainValue::String(if i < 2 { "pair".into() } else { format!("solo-{i}") })),
            (FieldId::new("node"), DomainValue::String(base.clone())),
            (FieldId::new("skill_path"), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
        ]))
    }).collect();
    configuration.insert(FieldId::new("heroes"), DomainValue::List(heroes));
    SenkeiSnapshot { schema_version: rules.plan().model_version, id: ArtifactId::new(format!("{side:?}")), revision: RevisionId::new("1"), ruleset: rules.ruleset().clone(), configuration, program, initial_memory: TacticalMemory::new() }
}

fn projection(rules: &VerifiedRulePlan) -> MatchProjection {
    let next = rules.plan().next.as_ref().unwrap();
    let policy = next.projection_policy.as_ref().unwrap();
    let maturity = policy.maturity.as_ref().unwrap();
    let mut sides = BTreeMap::new();
    for side in [CombatantSide::Attacker, CombatantSide::Defender] {
        let owner = format!("owner-{side:?}");
        let heroes = (0..5).map(|i| ProjectedHero {
            slot_id: format!("slot-{}", i + 1), owner_id: owner.clone(), instance_id: format!("{side:?}-{i}"),
            catalog_id: next.heroes[i].id.clone(), definition_catalog_id: policy.hero_catalog_id.clone(),
            definition_version: policy.hero_catalog_version, definition_digest: policy.hero_catalog_digest.clone(), equipment: vec![],
        }).collect();
        let relations = if side == CombatantSide::Attacker {
            [(0, 1, 4), (1, 0, 6)].into_iter().map(|(from, to, level)| ProjectedRelation {
                from_instance_id: format!("{side:?}-{from}"), to_instance_id: format!("{side:?}-{to}"), level: Some(level),
                formula_version: None, formula_digest: None,
                maturity_policy: Some(RelationMaturityPolicyRef { version: maturity.version, digest: digest(maturity) }),
            }).collect()
        } else { vec![] };
        sides.insert(side, ProjectedSide { owner_id: owner, authority: AssetAuthority::Local, heroes, relations });
    }
    MatchProjection { schema_version: 1, sides }
}

fn hero<'a>(artifact: &'a SimulationArtifact, side: CombatantSide, tick: u32, slot: &str) -> &'a EntityStateView {
    let state = artifact.owner_replays[&side].frames.iter().find(|frame| frame.tick == tick).unwrap().visible_state.as_ref().unwrap();
    state.entities.values().find(|hero| hero.owner == Some(side)
        && hero.fields.get(&FieldId::new("slot_id")) == Some(&DomainValue::String(slot.into()))).unwrap()
}

fn maturity(artifact: &SimulationArtifact, side: CombatantSide, tick: u32, slot: &str) -> i64 {
    match hero(artifact, side, tick, slot).fields.get(&FieldId::new("maturity")) { Some(DomainValue::Integer(value)) => *value, _ => panic!("missing maturity") }
}

#[test]
fn verified_policy_changes_real_enbu_maturity_and_reproduces_from_frozen_input() {
    assert!(senritsu::next_package().next.unwrap().projection_policy.is_none());
    assert!(senritsu::next_local_trial_package().next.unwrap().projection_policy.unwrap().maturity.is_none());
    let package = test_package();
    let rules = senritsu::validate(package.clone(), &senritsu::next_engine_compatibility()).unwrap();
    let program = compile("senkei relation_fixture { state inert { false, }, }", &rules).unwrap().program;
    let attacker = snapshot(&rules, CombatantSide::Attacker, program.clone());
    let defender = snapshot(&rules, CombatantSide::Defender, program);
    let mut context = new_match_context(&rules, MatchId::new("relation-maturity"));
    context.max_ticks = 2;
    context.match_projection = Some(projection(&rules));
    assert!(rules.plan().next.as_ref().unwrap().projection_policy.as_ref().unwrap().relation.is_none());
    let encoded = serde_json::to_value(context.match_projection.as_ref().unwrap()).unwrap();
    assert!(encoded["sides"]["attacker"]["relations"][0].get("formula_version").is_none());
    assert!(encoded["sides"]["attacker"]["relations"][0].get("formula_digest").is_none());
    preflight(&attacker, &defender, &rules, &context).unwrap();
    let actual = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(maturity(&actual, CombatantSide::Attacker, 2, "slot-1"), 6);
    assert_eq!(maturity(&actual, CombatantSide::Attacker, 2, "slot-2"), 6);
    assert_eq!(maturity(&actual, CombatantSide::Attacker, 2, "slot-3"), 0);
    assert_eq!(maturity(&actual, CombatantSide::Defender, 2, "slot-1"), 2);

    // Opt-in retained input for the Native/WASM conformance harness. Normal
    // test runs do not write files or introduce a new production rule preset.
    if let Some(path) = std::env::var_os("RELATION_MATURITY_CONFORMANCE_FILE") {
        let request = ApiRequestEnvelope {
            api_version: WASM_API_VERSION,
            request_id: "relation-maturity-conformance".to_owned(),
            operation: OP_REPRODUCE.to_owned(),
            payload: ReproducePayload {
                assets: ReproductionAssets {
                    format_version: REPRODUCTION_ASSETS_FORMAT_VERSION,
                    rule_package: package,
                    world_definition: serde_json::to_value(senritsu::next_world::builtin_world_definition()).unwrap(),
                    catalog_metadata_extension: None,
                },
                snapshot: ReproductionSnapshot { attacker: attacker.clone(), defender: defender.clone(), context: context.clone() },
                snapshot_digest: reproduction_snapshot_digest(&attacker, &defender, &context).unwrap(),
                include_diagnostics: true,
                diagnostics_side: Some(CombatantSide::Attacker),
            },
        };
        std::fs::write(path, serde_json::to_vec(&request).unwrap()).unwrap();
    }

    let retained = &actual.reproduction;
    assert_eq!(retained.context.match_projection, context.match_projection);
    assert_eq!(reproduction_snapshot_digest(&attacker, &defender, &context).unwrap(), reproduction_snapshot_digest(&retained.attacker, &retained.defender, &retained.context).unwrap());
    let repeated = simulate(&retained.attacker, &retained.defender, &rules, &retained.context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(actual.result, repeated.result);
    assert_eq!(actual.owner_replays, repeated.owner_replays);
    assert_eq!(actual.replay, repeated.replay);

    let mut undefined = context.clone();
    let player = undefined.match_projection.as_mut().unwrap().sides.get_mut(&CombatantSide::Attacker).unwrap();
    player.relations[0].maturity_policy = None;
    let plain = simulate(&attacker, &defender, &rules, &undefined, &mut Vm::new(&rules)).unwrap();
    assert_eq!(maturity(&plain, CombatantSide::Attacker, 2, "slot-1"), 2);
    for stat in ["attack", "defense"] {
        assert_eq!(hero(&actual, CombatantSide::Attacker, 2, "slot-1").fields.get(&FieldId::new(stat)), hero(&plain, CombatantSide::Attacker, 2, "slot-1").fields.get(&FieldId::new(stat)), "maturity-only policy does not need a stat formula");
    }
    assert_ne!(reproduction_snapshot_digest(&attacker, &defender, &context).unwrap(), reproduction_snapshot_digest(&attacker, &defender, &undefined).unwrap());

    let mut bad_ref = context.clone();
    bad_ref.match_projection.as_mut().unwrap().sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].maturity_policy.as_mut().unwrap().version.major += 1;
    assert_eq!(preflight(&attacker, &defender, &rules, &bad_ref).unwrap_err().code, ApiErrorCode::ValidationFailed);
    let mut unexpected_stat_ref = context.clone();
    unexpected_stat_ref.match_projection.as_mut().unwrap().sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].formula_version = Some(Version::new(1, 0, 0));
    assert_eq!(preflight(&attacker, &defender, &rules, &unexpected_stat_ref).unwrap_err().code, ApiErrorCode::ValidationFailed);
    let mut cross_owner = context.clone();
    cross_owner.match_projection.as_mut().unwrap().sides.get_mut(&CombatantSide::Attacker).unwrap().relations[0].to_instance_id = "Defender-1".into();
    assert_eq!(preflight(&attacker, &defender, &rules, &cross_owner).unwrap_err().code, ApiErrorCode::ValidationFailed);
}

#[test]
fn senritsu_rejects_freshly_digested_invalid_maturity_policies() {
    for invalid in 0..4 {
        let mut package = test_package();
        let policy = package.next.as_mut().unwrap().projection_policy.as_mut().unwrap().maturity.as_mut().unwrap();
        match invalid { 0 => policy.version.major = 0, 1 => policy.max_level = -1, 2 => policy.add_per_level = -1, 3 => policy.max_bonus = 1_000_001, _ => unreachable!() }
        package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
        let issues = senritsu::validate(package, &senritsu::next_engine_compatibility()).unwrap_err();
        assert!(issues.iter().any(|issue| issue.path == "next.projection_policy.maturity"));
    }
}
