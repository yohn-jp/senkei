use jinrei::compile;
use senkei_model::{CombatantSide, DomainType, DomainValue, FieldId, MatchOutcome, SymbolId};
use senkei_runner::{run, CombatantInput, LocalMatchInput, INPUT_SCHEMA_VERSION};
use std::collections::BTreeMap;

const CORE_ATTACK: &str = r#"senkei core_pressure {
    action strike_core {
        when true,
        do attack_core(
            argmin unit in allies.units by unit.position then unit.slot_id,
            argmin core in enemies.visible_cores by core.position then core.id,
        ),
    },
}"#;

const UNIT_ATTACK: &str = r#"senkei intercept {
    action attack_weakest {
        when true,
        do attack_unit(
            argmin unit in allies.units by unit.position then unit.slot_id,
            argmin target in enemies.visible_units by target.hp then target.slot_id,
        ),
    },
}"#;

const TOWER_ATTACK: &str = r#"senkei tower_pressure {
    action attack_tower {
        when true,
        do attack_tower(
            argmin unit in allies.units by unit.position then unit.slot_id,
            argmin tower in enemies.visible_towers by tower.hp then tower.id,
        ),
    },
}"#;

const MOVE_FORWARD: &str = r#"senkei marching_line {
    action advance_one {
        when true,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
    },
}"#;

const WAIT: &str = r#"senkei wait {
    action hold {
        when false,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
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
    let package = senritsu::initial_package();
    let rules = senritsu::validate(package, &senritsu::initial_engine_compatibility())
        .expect("bundled initial package validates before recipe compilation");
    let sources = load_npc_sources();
    assert_eq!(
        sources.len(),
        7,
        "campaign source fixture should contain all seven NPC recipes"
    );

    for (recipe_id, source) in &sources {
        compile(source, &rules).unwrap_or_else(|error| {
            panic!("NPC recipe {recipe_id} failed real Jinrei compilation: {error:?}\n{source}")
        });
    }
}

#[test]
fn authored_next_campaign_recipes_compile_against_real_next_senritsu() {
    let package = senritsu::next_package();
    let rules = senritsu::validate(package, &senritsu::next_engine_compatibility())
        .expect("bundled Next package validates before campaign recipe compilation");
    let sources = load_next_npc_sources();
    assert_eq!(sources.len(), 6, "Next progression has six authored NPC recipes");

    for (recipe_id, source) in &sources {
        compile(source, &rules).unwrap_or_else(|error| {
            panic!("Next NPC recipe {recipe_id} failed real Jinrei compilation: {error:?}\\n{source}")
        });
    }
}

#[test]
fn beginner_next_campaign_opponent_has_a_natural_base_destroyed_matchup() {
    let sources = load_next_npc_sources();
    let npc_tactics = &sources
        .iter()
        .find(|(id, _)| id == "first-march")
        .expect("the first authored challenge source exists")
        .1;
    let mut player_moves = Vec::new();
    for slot in 1..=5 {
        let slot_id = format!("slot-{slot}");
        player_moves.push(format!(
            "action advance_slot_{slot} {{ when any hero in allies.heroes {{ hero.slot_id == \"{slot_id}\", hero.goal == \"\", hero.hp > 0, }}, do move(argmin hero in filter hero in allies.heroes {{ hero.slot_id == \"{slot_id}\", }} by hero.hp then hero.id, \"B.BASE\"), }}"
        ));
    }
    let player_tactics = format!("senkei w9_persistent_movement {{ {} }}", player_moves.join(", "));
    let npc_roster = ["F01", "F03", "F06", "R02", "R04"];
    // A verified five-Solo challenger (same authored NPC/World/rules) reaches
    // base_destroyed within the canonical limit. The former quintet timed out.
    let attacker = next_combatant(
        "campaign-player",
        &player_tactics,
        &["F03", "F04", "R01", "R02", "R05"],
        &["squad-1", "squad-2", "squad-3", "squad-4", "squad-5"],
        "A.BASE",
    );
    let defender = next_combatant(
        "npc-first-march",
        npc_tactics,
        &npc_roster,
        &["npc-squad-1", "npc-squad-2", "npc-squad-3", "npc-squad-4", "npc-squad-5"],
        "B.BASE",
    );
    let result = run(LocalMatchInput {
        schema_version: INPUT_SCHEMA_VERSION,
        match_id: "campaign-first-march-clear".into(),
        ruleset_ref: senritsu::next_package().ruleset,
        attacker,
        defender,
    })
    .expect("authored beginner opponent and player tactics compile and simulate through Enbu");
    let npc_accepted_moves = result.diagnostics.events.iter().filter(|event| {
        event.side == CombatantSide::Defender
            && matches!(&event.record, senkei_model::DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "move")
    }).count();
    eprintln!(
        "first-march measured result: outcome={:?}, tick={}, termination={:?}, npc_accepted_moves={}, attacker_cu={}, defender_cu={}",
        result.public.result.outcome,
        result.public.result.final_tick,
        result.public.result.termination_reason,
        npc_accepted_moves,
        result.public.result.cu_spent[&CombatantSide::Attacker].0,
        result.public.result.cu_spent[&CombatantSide::Defender].0,
    );
    assert_eq!(result.public.result.outcome, MatchOutcome::AttackerVictory);
    assert_eq!(result.public.result.termination_reason.as_str(), "base_destroyed");
    assert!(result.public.result.final_tick < 600, "the authored challenge can be cleared within the canonical max tick");
    assert!(npc_accepted_moves >= 5, "the five-Hero NPC issues its opening march orders");
}

fn next_combatant(
    id: &str,
    tactics: &str,
    roster: &[&str; 5],
    squads: &[&str; 5],
    node: &str,
) -> CombatantInput {
    let heroes = roster.iter().enumerate().map(|(index, catalog_id)| {
        DomainValue::Record(BTreeMap::from([
            (FieldId::new("slot_id"), DomainValue::String(format!("slot-{}", index + 1))),
            (FieldId::new("catalog_id"), DomainValue::String((*catalog_id).into())),
            (FieldId::new("squad"), DomainValue::String(squads[index].into())),
            (FieldId::new("node"), DomainValue::String(node.into())),
            (FieldId::new("skill_path"), DomainValue::String("path_a".into())),
        ]))
    }).collect();
    CombatantInput {
        id: id.into(),
        revision: "1".into(),
        configuration: BTreeMap::from([(
            FieldId::new("heroes"),
            DomainValue::List(heroes),
        )]),
        initial_memory: BTreeMap::new(),
        tactics: tactics.to_owned(),
    }
}

fn load_npc_sources() -> Vec<(String, String)> {
    use std::path::Path;

    #[derive(serde::Deserialize)]
    struct RecipeSource {
        id: String,
        source: String,
    }

    let fixture_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios/campaign/source-fixtures.json");
    assert!(
        fixture_path.is_file(),
        "evaluated campaign source fixture is required at {}",
        fixture_path.display()
    );
    let json = std::fs::read(&fixture_path).expect("campaign source fixture is readable");
    let records: Vec<RecipeSource> =
        serde_json::from_slice(&json).expect("campaign source fixture is valid JSON");
    records
        .into_iter()
        .map(|record| (record.id, record.source))
        .collect()
}

fn load_next_npc_sources() -> Vec<(String, String)> {
    use std::path::Path;

    #[derive(serde::Deserialize)]
    struct RecipeSource {
        id: String,
        source: String,
    }

    let fixture_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios/next/source-fixtures.json");
    assert!(
        fixture_path.is_file(),
        "evaluated Next campaign source fixture is required at {}",
        fixture_path.display()
    );
    let json = std::fs::read(&fixture_path).expect("Next campaign source fixture is readable");
    let records: Vec<RecipeSource> =
        serde_json::from_slice(&json).expect("Next campaign source fixture is valid JSON");
    records
        .into_iter()
        .map(|record| (record.id, record.source))
        .collect()
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
