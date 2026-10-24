use jinrei::compile;
use senkei_model::{CombatantSide, DomainType, DomainValue, FieldId, MatchOutcome, SymbolId};
use senkei_runner::{run, CombatantInput, LocalMatchInput, INPUT_SCHEMA_VERSION};
use std::collections::BTreeMap;

const CORE_ATTACK: &str = r#"senkei core_pressure {
    action strike_core {
        when true,
        do attack_core(
            argmin unit in allies.units by unit.position then unit.id,
            argmin core in enemies.visible_cores by core.position then core.id,
        ),
    },
}"#;

const UNIT_ATTACK: &str = r#"senkei intercept {
    action attack_weakest {
        when true,
        do attack_unit(
            argmin unit in allies.units by unit.position then unit.id,
            argmin target in enemies.visible_units by target.hp then target.id,
        ),
    },
}"#;

const TOWER_ATTACK: &str = r#"senkei tower_pressure {
    action attack_tower {
        when true,
        do attack_tower(
            argmin unit in allies.units by unit.position then unit.id,
            argmin tower in enemies.visible_towers by tower.hp then tower.id,
        ),
    },
}"#;

const MOVE_FORWARD: &str = r#"senkei marching_line {
    action advance_one {
        when true,
        do move_forward(argmin unit in allies.units by unit.position then unit.id),
    },
}"#;

const WAIT: &str = r#"senkei wait {
    action hold {
        when false,
        do move_forward(argmin unit in allies.units by unit.position then unit.id),
    },
}"#;

fn input(
    attacker_source: &str,
    attacker_pos: i64,
    defender_source: &str,
    defender_pos: i64,
) -> LocalMatchInput {
    LocalMatchInput {
        schema_version: INPUT_SCHEMA_VERSION,
        match_id: "integration-match".into(),
        ruleset_ref: senritsu::initial_package().ruleset,
        attacker: combatant("attacker", attacker_source, Some(("cavalry", attacker_pos))),
        defender: combatant(
            "defender",
            defender_source,
            Some(("infantry", defender_pos)),
        ),
    }
}

fn combatant(id: &str, tactics: &str, deployment: Option<(&str, i64)>) -> CombatantInput {
    let mut configuration = BTreeMap::new();
    if let Some((unit_class, position)) = deployment {
        configuration.insert(
            FieldId::new("initial_deployments"),
            DomainValue::List(vec![DomainValue::Record(BTreeMap::from([
                (
                    FieldId::new("slot_id"),
                    DomainValue::String(format!("{id}-slot")),
                ),
                (
                    FieldId::new("unit_class"),
                    DomainValue::Enum(SymbolId::new(unit_class)),
                ),
                (
                    FieldId::new("lane"),
                    DomainValue::Enum(SymbolId::new("top")),
                ),
                (FieldId::new("position"), DomainValue::Integer(position)),
            ]))]),
        );
    }
    CombatantInput {
        id: id.into(),
        revision: "1".into(),
        configuration,
        initial_memory: BTreeMap::new(),
        tactics: tactics.to_owned(),
    }
}

#[test]
fn actual_initial_ruleset_and_jinrei_vm_change_battle_result_deterministically() {
    let core_pressure = input(CORE_ATTACK, 18, WAIT, 2);
    let first = run(core_pressure.clone()).expect("both real Jinrei tactics compile and simulate");
    let repeated = run(core_pressure).expect("same immutable inputs can be replayed");

    assert_eq!(first.public, repeated.public);
    assert_eq!(first.compilation, repeated.compilation);
    assert_eq!(first.diagnostics, repeated.diagnostics);
    assert_eq!(first.public.result.outcome, MatchOutcome::AttackerVictory);
    assert_eq!(first.public.result.final_tick, 15);
    assert!(first.public.result.cu_spent[&CombatantSide::Attacker].0 > 0);
    assert!(first.diagnostics.events.iter().any(|event| {
        matches!(
            event.record,
            senkei_model::DiagnosticRecord::IntentAccepted { .. }
        )
    }));
    assert!(first
        .public
        .replay
        .frames
        .iter()
        .flat_map(|frame| &frame.events)
        .any(|event| { event.event.as_str() == "core_attacked" }));

    let changed_tactic = run(input(MOVE_FORWARD, 18, WAIT, 2))
        .expect("the edited movement tactic compiles through Jinrei and simulates");
    assert_eq!(changed_tactic.public.result.outcome, MatchOutcome::Draw);
    assert_eq!(changed_tactic.public.result.final_tick, 500);
    assert_ne!(
        first.public.result.final_state_digest,
        changed_tactic.public.result.final_state_digest
    );
    let movement_frames = changed_tactic
        .public
        .replay
        .frames
        .iter()
        .filter(|frame| {
            frame
                .events
                .iter()
                .any(|event| event.event.as_str() == "unit_moved")
        })
        .count();
    assert_eq!(movement_frames, 2);

    let public_json = first.to_public_json().unwrap();
    let local_json = first.to_local_json().unwrap();
    assert!(!public_json.contains("diagnostics"));
    assert!(local_json.contains("diagnostics"));
    assert!(local_json.contains("estimated_cu"));
    assert!(local_json.contains("ruleset_ref"));
    assert!(!public_json.contains("core_pressure"));
}

#[test]
fn refuses_a_ruleset_reference_that_is_not_bundled_with_the_cli() {
    let mut request = input(CORE_ATTACK, 18, WAIT, 2);
    request.ruleset_ref.digest = senkei_model::ContentDigest::new("0".repeat(64));
    assert!(matches!(
        run(request),
        Err(senkei_runner::RunnerError::InvalidRuleset { .. })
    ));
}

#[test]
fn actual_jinrei_intents_cause_unit_attrition_and_tower_damage() {
    let unit_battle = run(input(UNIT_ATTACK, 18, WAIT, 2)).unwrap();
    let unit_attacks = unit_battle
        .public
        .replay
        .frames
        .iter()
        .flat_map(|frame| &frame.events)
        .filter(|event| event.event.as_str() == "unit_attacked")
        .count();
    assert_eq!(unit_attacks, 5);
    let target_id = unit_battle
        .public
        .replay
        .frames
        .iter()
        .flat_map(|frame| &frame.events)
        .find(|event| event.event.as_str() == "unit_attacked")
        .and_then(|event| event.entity.as_ref())
        .expect("public unit attack should identify its target")
        .clone();
    let enemy_unit = unit_battle
        .public
        .replay
        .frames
        .last()
        .unwrap()
        .visible_state
        .as_ref()
        .unwrap()
        .entities
        .get(&target_id)
        .unwrap();
    assert_eq!(
        enemy_unit.fields[&FieldId::new("hp")],
        DomainValue::Integer(0)
    );

    let mut tower_input = input(TOWER_ATTACK, 13, WAIT, 2);
    set_deployment_lane(&mut tower_input.attacker, &first_tower_lane());
    let tower_battle = run(tower_input).unwrap();
    let tower_attacks = tower_battle
        .public
        .replay
        .frames
        .iter()
        .flat_map(|frame| &frame.events)
        .filter(|event| event.event.as_str() == "tower_attacked")
        .count();
    assert_eq!(tower_attacks, 8);
    let target_id = tower_battle
        .public
        .replay
        .frames
        .iter()
        .flat_map(|frame| &frame.events)
        .find(|event| event.event.as_str() == "tower_attacked")
        .and_then(|event| event.entity.as_ref())
        .expect("public tower attack should identify its target")
        .clone();
    let damaged_tower = tower_battle
        .public
        .replay
        .frames
        .iter()
        .rev()
        .find_map(|frame| frame.visible_state.as_ref())
        .unwrap()
        .entities
        .get(&target_id)
        .unwrap();
    assert_eq!(
        damaged_tower.fields[&FieldId::new("hp")],
        DomainValue::Integer(0)
    );
}

#[test]
fn the_seven_bundled_npc_recipes_compile_against_real_initial_senritsu() {
    const CATALOG: &str = include_str!("../../../scenarios/campaign/catalog.ts");
    let package = senritsu::initial_package();
    let rules = senritsu::validate(package, &senritsu::initial_engine_compatibility())
        .expect("bundled initial package validates before recipe compilation");
    let sources = recipe_sources(CATALOG);
    assert_eq!(
        sources.len(),
        7,
        "catalog should retain all seven source recipes"
    );

    for (index, source) in sources.iter().enumerate() {
        compile(source, &rules).unwrap_or_else(|error| {
            panic!(
                "NPC recipe {} failed real Jinrei compilation: {error:?}\n{source}",
                index + 1
            )
        });
    }
}

fn recipe_sources(catalog: &str) -> Vec<String> {
    let mut rest = catalog;
    let mut sources = Vec::new();
    while let Some(source_start) = rest.find("source: `") {
        rest = &rest[source_start + "source: `".len()..];
        let source_end = rest
            .find("`,")
            .expect("recipe source template has a terminator");
        let mut source = rest[..source_end].to_owned();
        source = source.replace(
            "${firstUnit(\"position\")}",
            "argmin unit in allies.units by unit.position then unit.id",
        );
        source = source.replace(
            "${weakestUnitText()}",
            "argmin unit in allies.units by unit.hp then unit.id",
        );
        sources.push(source);
        rest = &rest[source_end + 2..];
    }
    sources
}

#[test]
fn data_only_unit_class_extension_is_accepted_but_unavailable_engine_primitive_is_rejected() {
    let mut package = senritsu::initial_package();
    let class_id = senkei_model::SymbolDomainId::new("unit_class");
    let class = SymbolId::new("mage");
    package
        .domain
        .symbol_domains
        .get_mut(&class_id)
        .unwrap()
        .insert(class.clone());

    for schema in package.domain.senkei_configuration.values_mut() {
        add_enum_value(&mut schema.value_type, &class_id, &class);
    }
    for collection in package.domain.collections.values_mut() {
        for field in collection.visible_fields.values_mut() {
            add_enum_value(&mut field.value_type, &class_id, &class);
        }
    }
    for capability in package.domain.capabilities.values_mut() {
        for parameter in &mut capability.arguments {
            add_enum_value(&mut parameter.value_type, &class_id, &class);
        }
    }
    for entity_type in package.world.entity_types.values_mut() {
        for field in entity_type.fields.values_mut() {
            add_enum_value(&mut field.value_type, &class_id, &class);
        }
    }
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let extended_rules =
        senritsu::validate(package.clone(), &senritsu::initial_engine_compatibility())
            .expect("a bounded enum/schema addition does not require a new engine primitive");
    assert_eq!(
        extended_rules.plan().domain.symbol_domains[&class_id],
        *package.domain.symbol_domains.get(&class_id).unwrap()
    );

    let mut unsupported_engine = senritsu::initial_engine_compatibility();
    unsupported_engine
        .available_primitives
        .remove(&senkei_model::TransitionPrimitiveKind::AddInteger);
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let issues = senritsu::validate(package, &unsupported_engine)
        .expect_err("an engine without a required operation primitive must reject the package");
    assert!(issues
        .iter()
        .any(|issue| issue.code == "unsupported_primitive"));
}

fn add_enum_value(
    value_type: &mut DomainType,
    domain: &senkei_model::SymbolDomainId,
    value: &SymbolId,
) {
    match value_type {
        DomainType::Enum {
            domain: found,
            values,
        } if found == domain => {
            values.insert(value.clone());
        }
        DomainType::Optional(inner)
        | DomainType::List { element: inner, .. }
        | DomainType::Vector { element: inner, .. }
        | DomainType::Matrix { element: inner, .. } => add_enum_value(inner, domain, value),
        DomainType::Record { fields } => {
            for value_type in fields.values_mut() {
                add_enum_value(value_type, domain, value);
            }
        }
        _ => {}
    }
}

fn set_deployment_lane(combatant: &mut CombatantInput, lane: &str) {
    let Some(DomainValue::List(deployments)) = combatant
        .configuration
        .get_mut(&FieldId::new("initial_deployments"))
    else {
        panic!("test combatant should have a deployment list");
    };
    let Some(DomainValue::Record(deployment)) = deployments.first_mut() else {
        panic!("test deployment should be a record");
    };
    deployment.insert(FieldId::new("lane"), DomainValue::Enum(SymbolId::new(lane)));
}

fn first_tower_lane() -> String {
    let ruleset_digest = senritsu::initial_package().ruleset.digest;
    ["top", "mid", "bot"]
        .into_iter()
        .min_by_key(|lane| {
            senkei_model::derive_projected_entity_id(
                &ruleset_digest,
                &senkei_model::ProjectionId::new("tower"),
                &senkei_model::TypeId::new("tower"),
                Some(CombatantSide::Defender),
                &DomainValue::String(format!("tower:{lane}")),
            )
            .unwrap()
        })
        .unwrap()
        .to_owned()
}
