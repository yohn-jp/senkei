use enbu::{new_match_context, simulate};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const IDLE_TACTICS: &str = "senkei internal_secret_marker { state inert { false, }, }";

fn rules() -> VerifiedRulePlan {
    senritsu::validate(
        senritsu::next_package(),
        &senritsu::next_engine_compatibility(),
    )
    .unwrap_or_else(|issues| panic!("published Next package must validate: {issues:?}"))
}

fn fragile_rules() -> VerifiedRulePlan {
    let mut package = senritsu::next_package();
    let next = package.next.as_mut().expect("published Next package contains finite mechanics");
    let fragile = next.heroes.iter_mut().find(|hero| hero.id == "F01")
        .expect("the test fixture selects the first frontline catalog entry");
    fragile.stats.hp = 1;
    package.ruleset.version = Version::new(1, 0, 1);
    package.ruleset.digest = senritsu::canonical_digest(&package)
        .expect("fragile test package has canonical content");
    senritsu::validate(package, &senritsu::next_engine_compatibility())
        .unwrap_or_else(|issues| panic!("derived test-only package validates: {issues:?}"))
}

fn reveal_rules() -> VerifiedRulePlan {
    let mut package = senritsu::next_package();
    let next = package.next.as_mut().expect("published Next package contains finite mechanics");
    // The canonical recon active unlocks at level four. Start the test roster
    // at that level so the fixture can isolate reveal timing without adding a
    // second progression or combat implementation.
    next.parameters.insert("hero_start_level".into(), 4);
    // Keep R03's base vision while leveling; the target node below is 340
    // units away, just beyond that sight radius and within the active's 420
    // range.
    next.heroes.iter_mut().find(|hero| hero.id == "R03")
        .expect("the published catalog contains R03")
        .growth.vision = 0;
    package.ruleset.version = Version::new(1, 0, 1);
    package.ruleset.digest = senritsu::canonical_digest(&package)
        .expect("reveal test package has canonical content");
    senritsu::validate(package, &senritsu::next_engine_compatibility())
        .unwrap_or_else(|issues| panic!("derived reveal test package validates: {issues:?}"))
}

fn configured_snapshot(
    rules: &VerifiedRulePlan,
    side: CombatantSide,
    partition: &[usize],
    tactic_program: TacticalProgram,
    hero_nodes: Option<&[String]>,
) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().expect("validated plan contains NextRules");
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        let default = schema.default.clone().or_else(|| default_value(&schema.value_type));
        if let Some(value) = default {
            configuration.insert(field.clone(), value);
        } else if schema.required {
            panic!("required Senkei field {field} has no fixture value");
        }
    }

    let base_node = match side {
        CombatantSide::Attacker => next.map.attacker_base.as_str(),
        CombatantSide::Defender => next.map.defender_base.as_str(),
    };
    let mut heroes = Vec::with_capacity(5);
    let mut squad_index = 0;
    for (squad_number, squad_size) in partition.iter().copied().enumerate() {
        for _ in 0..squad_size {
            let hero = &next.heroes[heroes.len() % next.heroes.len()];
            let skill_path = hero.skill_paths.keys().next().expect("each catalog Hero has a prepared path");
            let hero_node = hero_nodes
                .and_then(|nodes| nodes.get(heroes.len()))
                .map_or(base_node, String::as_str);
            heroes.push(DomainValue::Record(BTreeMap::from([
                (FieldId::new("slot_id"), DomainValue::String(format!("slot-{}", heroes.len() + 1))),
                (FieldId::new("catalog_id"), DomainValue::String(hero.id.clone())),
                (FieldId::new("squad"), DomainValue::String(format!("squad-{squad_number}"))),
                (FieldId::new("node"), DomainValue::String(hero_node.to_owned())),
                (FieldId::new("skill_path"), DomainValue::String(skill_path.clone())),
            ])));
            squad_index += 1;
        }
    }
    assert_eq!(squad_index, 5, "every prepared army has five Heroes");
    configuration.insert(FieldId::new("heroes"), DomainValue::List(heroes));

    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(match side { CombatantSide::Attacker => "w9-attacker", CombatantSide::Defender => "w9-defender" }),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration,
        program: tactic_program,
        initial_memory: TacticalMemory::new(),
    }
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
        DomainType::List { .. } | DomainType::Vector { .. } | DomainType::Matrix { .. } => {
            Some(DomainValue::List(Vec::new()))
        }
        DomainType::Record { fields } => fields
            .iter()
            .map(|(field, value_type)| Some((field.clone(), default_value(value_type)?)))
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn run_partition(
    rules: &VerifiedRulePlan,
    partition: &[usize],
    match_id: &str,
) -> Result<SimulationArtifact, ApiError> {
    let (attacker, defender, context) = build_match(rules, partition, match_id, 1, None, None);
    let mut vm = Vm::new(rules);
    simulate(&attacker, &defender, rules, &context, &mut vm)
}

fn build_match(
    rules: &VerifiedRulePlan,
    partition: &[usize],
    match_id: &str,
    max_ticks: u32,
    attacker_nodes: Option<&[String]>,
    defender_nodes: Option<&[String]>,
) -> (SenkeiSnapshot, SenkeiSnapshot, MatchContext) {
    let compiled = compile(IDLE_TACTICS, rules)
        .unwrap_or_else(|error| panic!("fixture tactics must compile against Next: {error:?}"));
    let attacker = configured_snapshot(
        rules,
        CombatantSide::Attacker,
        partition,
        compiled.program.clone(),
        attacker_nodes,
    );
    let defender = configured_snapshot(
        rules,
        CombatantSide::Defender,
        partition,
        compiled.program,
        defender_nodes,
    );
    let mut context = new_match_context(rules, MatchId::new(match_id));
    context.max_ticks = max_ticks;
    (attacker, defender, context)
}

fn movement_tactics(assignments: &[(String, String)]) -> String {
    let actions = assignments
        .iter()
        .enumerate()
        .map(|(index, (slot, destination))| {
            let selector = format!(
                "argmin hero in filter hero in allies.heroes {{ hero.slot_id == \"{slot}\", }} by hero.hp then hero.id"
            );
            format!(
                "action move_slot_{} {{ when match.tick == 1, do move({selector}, \"{destination}\"), }}",
                index + 1
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("senkei w9_movement {{ {actions} }}")
}

fn hero_selector(slot: &str) -> String {
    format!(
        "argmin hero in filter hero in allies.heroes {{ hero.slot_id == \"{slot}\", }} by hero.hp then hero.id"
    )
}

fn squad_reform_tactics() -> String {
    let first = hero_selector("slot-1");
    let second = hero_selector("slot-2");
    let fifth = hero_selector("slot-5");
    format!(
        "senkei w9_reform {{ action merge_groups {{ when match.tick == 1, do merge({first}, {fifth}), }}, action split_leader {{ when match.tick == 2, do split({first}), }}, action regroup_survivor {{ when match.tick == 3, do regroup({first}, {second}), }} }}"
    )
}

fn test_minion(rules: &VerifiedRulePlan, side: CombatantSide, node: &str) -> EntityState {
    let next = rules.plan().next.as_ref().unwrap();
    let definition = &next.minions[0];
    let position = &next.map.nodes[node];
    EntityState {
        entity_type: TypeId::new("minion"),
        owner: Some(side),
        fields: BTreeMap::from([
            (FieldId::new("hp"), DomainValue::Integer(definition.stats.hp)),
            (FieldId::new("max_hp"), DomainValue::Integer(definition.stats.hp)),
            (FieldId::new("attack"), DomainValue::Integer(definition.stats.attack)),
            (FieldId::new("defense"), DomainValue::Integer(definition.stats.defense)),
            (FieldId::new("speed"), DomainValue::Integer(definition.stats.speed)),
            (FieldId::new("range"), DomainValue::Integer(definition.stats.range)),
            (FieldId::new("attack_interval"), DomainValue::Integer(definition.stats.attack_interval)),
            (FieldId::new("vision"), DomainValue::Integer(definition.stats.vision)),
            (FieldId::new("attack_ready"), DomainValue::Integer(0)),
            (FieldId::new("x"), DomainValue::Integer(position.x)),
            (FieldId::new("y"), DomainValue::Integer(position.y)),
            (FieldId::new("edge_progress"), DomainValue::Integer(0)),
            (FieldId::new("node"), DomainValue::String(node.to_owned())),
            (FieldId::new("edge_to"), DomainValue::String(String::new())),
            (FieldId::new("goal"), DomainValue::String(node.to_owned())),
            (FieldId::new("lane"), DomainValue::String(String::new())),
            (FieldId::new("catalog_id"), DomainValue::String(definition.id.clone())),
        ]),
    }
}

fn test_monster(rules: &VerifiedRulePlan, camp_id: &str) -> EntityState {
    let next = rules.plan().next.as_ref().unwrap();
    let camp = next.camps.iter().find(|camp| camp.id == camp_id).expect("selected camp exists");
    let definition = next.monsters.iter().find(|monster| monster.id == camp.monster).expect("camp monster exists");
    let position = &next.map.nodes[&camp.node];
    EntityState {
        entity_type: TypeId::new("monster"),
        owner: None,
        fields: BTreeMap::from([
            (FieldId::new("hp"), DomainValue::Integer(1)),
            (FieldId::new("max_hp"), DomainValue::Integer(definition.stats.hp)),
            (FieldId::new("attack"), DomainValue::Integer(0)),
            (FieldId::new("defense"), DomainValue::Integer(0)),
            (FieldId::new("speed"), DomainValue::Integer(0)),
            (FieldId::new("range"), DomainValue::Integer(0)),
            (FieldId::new("attack_interval"), DomainValue::Integer(definition.stats.attack_interval)),
            (FieldId::new("vision"), DomainValue::Integer(definition.stats.vision)),
            (FieldId::new("attack_ready"), DomainValue::Integer(0)),
            (FieldId::new("x"), DomainValue::Integer(position.x)),
            (FieldId::new("y"), DomainValue::Integer(position.y)),
            (FieldId::new("edge_progress"), DomainValue::Integer(0)),
            (FieldId::new("node"), DomainValue::String(camp.node.clone())),
            (FieldId::new("edge_to"), DomainValue::String(String::new())),
            (FieldId::new("goal"), DomainValue::String(camp.node.clone())),
            (FieldId::new("lane"), DomainValue::String(String::new())),
            (FieldId::new("catalog_id"), DomainValue::String(definition.id.clone())),
            (FieldId::new("camp"), DomainValue::String(camp.id.clone())),
            (FieldId::new("respawn_at"), DomainValue::Integer(0)),
            (FieldId::new("xp_reward"), DomainValue::Integer(definition.xp)),
        ]),
    }
}

fn run_movement_case(
    rules: &VerifiedRulePlan,
    partition: &[usize],
    start_node: &str,
    destination: &str,
    friendly_minions: usize,
    enemy_minions: usize,
    slots: &[&str],
    match_id: &str,
) -> (SimulationArtifact, Vec<EntityId>) {
    let assignments = slots
        .iter()
        .map(|slot| ((*slot).to_owned(), destination.to_owned()))
        .collect::<Vec<_>>();
    let compiled = compile(&movement_tactics(&assignments), rules)
        .unwrap_or_else(|error| panic!("move fixture compiles against Next: {error:?}"));
    let hero_nodes = vec![start_node.to_owned(); 5];
    let (mut attacker, defender, mut context) = build_match(
        rules,
        partition,
        match_id,
        1,
        Some(&hero_nodes),
        None,
    );
    attacker.program = compiled.program;
    // Keep base speed constant so this factorial isolates squad, terrain, and
    // vision modifiers rather than the catalog's per-Hero speed differences.
    for slot in 0..5 {
        set_catalog(&mut attacker, slot, "F01", rules);
    }
    for index in 0..friendly_minions {
        context.initial_world.entities.insert(
            EntityId::new(format!("w9-friendly-minion-{match_id}-{index}")),
            test_minion(rules, CombatantSide::Attacker, start_node),
        );
    }
    for index in 0..enemy_minions {
        context.initial_world.entities.insert(
            EntityId::new(format!("w9-enemy-minion-{match_id}-{index}")),
            test_minion(rules, CombatantSide::Defender, start_node),
        );
    }
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("movement scenario {match_id} executes through Enbu: {error:?}"));
    let actors = accepted_actors(&artifact, CombatantSide::Attacker, "move");
    assert_eq!(actors.len(), slots.len(), "all scheduled move actions are accepted in {match_id}");
    (artifact, actors)
}

fn accepted_actors(artifact: &SimulationArtifact, side: CombatantSide, capability: &str) -> Vec<EntityId> {
    let mut actors = artifact
        .diagnostics
        .events
        .iter()
        .filter(|event| event.tick == 1 && event.side == side)
        .filter_map(|event| match &event.record {
            DiagnosticRecord::IntentAccepted { intent }
                if intent.capability.as_str() == capability => intent.actor.clone(),
            _ => None,
        })
        .collect::<Vec<_>>();
    actors.sort();
    actors.dedup();
    actors
}

fn entity_integer(entity: &EntityStateView, field: &str) -> i64 {
    match entity.fields.get(&FieldId::new(field)) {
        Some(DomainValue::Integer(value)) => *value,
        _ => panic!("owner replay includes integer field {field}"),
    }
}

fn entity_string(entity: &EntityStateView, field: &str) -> String {
    match entity.fields.get(&FieldId::new(field)) {
        Some(DomainValue::String(value)) => value.clone(),
        _ => panic!("owner replay includes string field {field}"),
    }
}

fn owner_hero_by_slot<'a>(state: &'a WorldStateView, slot: &str) -> &'a EntityStateView {
    state
        .entities
        .values()
        .find(|entity| {
            entity.entity_type.as_str() == "hero"
                && entity.owner == Some(CombatantSide::Attacker)
                && entity.fields.get(&FieldId::new("slot_id"))
                    == Some(&DomainValue::String(slot.to_owned()))
        })
        .unwrap_or_else(|| panic!("owner replay includes attacker Hero {slot}"))
}

fn owner_hero_at<'a>(artifact: &'a SimulationArtifact, tick: u32, slot: &str) -> &'a EntityStateView {
    owner_hero_by_slot(owner_state_at(artifact, tick), slot)
}

fn owner_monster_at<'a>(artifact: &'a SimulationArtifact, tick: u32, camp: &str) -> &'a EntityStateView {
    owner_state_at(artifact, tick).entities.values().find(|entity| {
        entity.entity_type.as_str() == "monster"
            && entity.fields.get(&FieldId::new("camp")) == Some(&DomainValue::String(camp.to_owned()))
    }).unwrap_or_else(|| panic!("owner replay observes monster at camp {camp} at tick {tick}"))
}

fn squad_reform_case(rules: &VerifiedRulePlan) -> serde_json::Value {
    let next = rules.plan().next.as_ref().unwrap();
    let (prepared_attacker, prepared_defender, prepared_context) =
        build_match(rules, &[5], "prepared-quintet-maturation", 45, None, None);
    let mut prepared_vm = Vm::new(rules);
    let prepared = simulate(&prepared_attacker, &prepared_defender, rules, &prepared_context, &mut prepared_vm)
        .unwrap_or_else(|error| panic!("prepared Quintet maturation scenario executes: {error:?}"));
    let prepared_at_start = entity_integer(owner_hero_at(&prepared, 0, "slot-1"), "maturity");
    let prepared_at_tick_40 = entity_integer(owner_hero_at(&prepared, 40, "slot-1"), "maturity");

    let compiled = compile(&squad_reform_tactics(), rules)
        .unwrap_or_else(|error| panic!("squad reformation tactics compile: {error:?}"));
    let (mut attacker, defender, context) =
        build_match(rules, &[3, 2], "squad-reform", 45, None, None);
    attacker.program = compiled.program;
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("squad reformation scenario executes: {error:?}"));

    let initial_sizes = squad_sizes(owner_state_at(&artifact, 0), CombatantSide::Attacker);
    let merged_sizes = squad_sizes(owner_state_at(&artifact, 1), CombatantSide::Attacker);
    let split_sizes = squad_sizes(owner_state_at(&artifact, 2), CombatantSide::Attacker);
    let regrouped_sizes = squad_sizes(owner_state_at(&artifact, 3), CombatantSide::Attacker);
    let cap = next.parameters["squad_maturation_ticks"];
    let fresh_merge_maturity = entity_integer(owner_hero_by_slot(owner_state_at(&artifact, 1), "slot-1"), "maturity");
    let fresh_regroup_maturity = entity_integer(owner_hero_by_slot(owner_state_at(&artifact, 3), "slot-1"), "maturity");
    let matured_again = entity_integer(owner_hero_by_slot(owner_state_at(&artifact, 45), "slot-1"), "maturity");

    assert_eq!(prepared_at_start, 0, "an initially assembled Quintet starts without earned maturity");
    assert_eq!(prepared_at_tick_40, cap, "an initially assembled Quintet matures with elapsed ticks");
    assert_eq!(initial_sizes, vec![3, 2]);
    assert_eq!(merged_sizes, vec![5], "accepted merge joins both initial squads");
    assert_eq!(split_sizes, vec![4, 1], "accepted split creates one Solo and leaves four members");
    assert_eq!(regrouped_sizes, vec![5], "accepted regroup rejoins the split Hero");
    assert!(fresh_merge_maturity < cap, "a freshly merged Quintet is not instantly mature");
    assert!(fresh_regroup_maturity < cap, "a freshly regrouped Quintet must mature again");
    assert_eq!(matured_again, cap, "the reformed Quintet matures after the configured number of ticks");

    serde_json::json!({
        "case_id": "squad-merge-split-regroup-maturation",
        "prepared_quintet_maturity_at_start": prepared_at_start,
        "prepared_quintet_maturity_at_tick_40": prepared_at_tick_40,
        "partition_by_tick": { "0": initial_sizes, "1": merged_sizes, "2": split_sizes, "3": regrouped_sizes },
        "maturity_cap": cap,
        "fresh_merge_maturity": fresh_merge_maturity,
        "fresh_regroup_maturity": fresh_regroup_maturity,
        "maturity_at_tick_45": matured_again,
        "termination_tick": artifact.result.final_tick
    })
}

fn xp_share_cases(rules: &VerifiedRulePlan) -> Vec<serde_json::Value> {
    let next = rules.plan().next.as_ref().unwrap();
    let camp = &next.camps[0];
    let monster = next.monsters.iter().find(|monster| monster.id == camp.monster).unwrap();
    let mut cases = Vec::new();
    for eligible_count in [1_usize, 2, 5] {
        let mut nodes = vec![next.map.attacker_base.clone(); 5];
        nodes[..eligible_count].fill(camp.node.clone());
        let (attacker, defender, mut context) = build_match(
            rules,
            &[1, 1, 1, 1, 1],
            &format!("xp-eligible-{eligible_count}"),
            1,
            Some(&nodes),
            None,
        );
        let monster_id = EntityId::new(format!("monster.{}", camp.id));
        context.initial_world.entities.insert(monster_id.clone(), test_monster(rules, &camp.id));
        let mut vm = Vm::new(rules);
        let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
            .unwrap_or_else(|error| panic!("XP share case with {eligible_count} eligible Hero executes: {error:?}"));
        let before = owner_state_at(&artifact, 0);
        let after = owner_state_at(&artifact, 1);
        let xp_scale = next.parameters["xp_scale"];
        let expected_share = i128::from(monster.xp) * i128::from(xp_scale) / eligible_count as i128;
        let mut shares = Vec::new();
        for slot in 1..=5 {
            let hero = format!("slot-{slot}");
            let delta = entity_integer(owner_hero_by_slot(after, &hero), "xp")
                - entity_integer(owner_hero_by_slot(before, &hero), "xp");
            if slot <= eligible_count {
                assert_eq!(delta, expected_share as i64, "eligible Hero {hero} receives the same fixed-point share");
            } else {
                assert_eq!(delta, 0, "out-of-range Hero {hero} receives no share");
            }
            shares.push(delta);
        }
        assert_eq!(entity_integer(owner_monster_at(&artifact, 1, &camp.id), "hp"), 0,
            "the controlled low-HP camp monster is killed in the combat phase");
        cases.push(serde_json::json!({
            "case_id": format!("xp-equal-share-{eligible_count}"),
            "camp": camp.id,
            "monster_catalog_id": monster.id,
            "reward_xp": monster.xp,
            "eligible_heroes": eligible_count,
            "xp_scale": xp_scale,
            "hero_xp_delta_scaled": shares,
            "termination_tick": artifact.result.final_tick
        }));
    }
    cases
}

fn jungle_respawn_case(rules: &VerifiedRulePlan) -> serde_json::Value {
    let next = rules.plan().next.as_ref().unwrap();
    let camp = &next.camps[0];
    let monster = next.monsters.iter().find(|monster| monster.id == camp.monster).unwrap();
    let respawn_tick = 1_u32 + camp.respawn_ticks as u32;
    let nodes = vec![camp.node.clone(); 5];
    let (mut attacker, defender, mut context) = build_match(
        rules,
        &[1, 1, 1, 1, 1],
        "jungle-objective-respawn",
        respawn_tick,
        Some(&nodes),
        None,
    );
    // Heroes stop at top_1: still close enough to observe the camp, but outside
    // their configured basic-attack range once the full-HP monster returns.
    let departures = (1..=5).map(|slot| (format!("slot-{slot}"), "A.TOP.T1".to_owned())).collect::<Vec<_>>();
    let leave_camp = movement_tactics(&departures)
        .replace("match.tick == 1", "match.tick == 2");
    attacker.program = compile(&leave_camp, rules)
        .unwrap_or_else(|error| panic!("camp departure tactic compiles: {error:?}"))
        .program;
    let monster_id = EntityId::new(format!("monster.{}", camp.id));
    context.initial_world.entities.insert(monster_id.clone(), test_monster(rules, &camp.id));
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("jungle objective lifecycle executes: {error:?}"));

    let dead_hp = entity_integer(owner_monster_at(&artifact, 1, &camp.id), "hp");
    let before_respawn_hp = entity_integer(owner_monster_at(&artifact, respawn_tick - 1, &camp.id), "hp");
    let restored_hp = entity_integer(owner_monster_at(&artifact, respawn_tick, &camp.id), "hp");
    assert_eq!(dead_hp, 0);
    assert_eq!(before_respawn_hp, 0, "the camp remains defeated through the tick before respawn");
    assert_eq!(restored_hp, monster.stats.hp, "camp monster returns at its catalog HP on the configured tick");
    serde_json::json!({
        "case_id": "jungle-camp-respawn",
        "camp": camp.id,
        "monster_catalog_id": monster.id,
        "camp_respawn_ticks": camp.respawn_ticks,
        "kill_tick": 1,
        "scheduled_respawn_tick": respawn_tick,
        "restored_hp": restored_hp,
        "termination_tick": artifact.result.final_tick
    })
}

fn set_catalog(snapshot: &mut SenkeiSnapshot, slot_index: usize, hero_id: &str, rules: &VerifiedRulePlan) {
    let next = rules.plan().next.as_ref().unwrap();
    let definition = next.heroes.iter().find(|hero| hero.id == hero_id).expect("selected catalog Hero exists");
    let Some(DomainValue::List(heroes)) = snapshot.configuration.get_mut(&FieldId::new("heroes")) else {
        panic!("snapshot fixture contains a hero list");
    };
    let Some(DomainValue::Record(fields)) = heroes.get_mut(slot_index) else {
        panic!("snapshot contains configured Hero slot {slot_index}");
    };
    fields.insert(FieldId::new("catalog_id"), DomainValue::String(hero_id.to_owned()));
    fields.insert(FieldId::new("skill_path"), DomainValue::String(
        definition.skill_paths.keys().next().expect("Hero has a prepared skill path").clone(),
    ));
}

fn death_respawn_case() -> serde_json::Value {
    let rules = fragile_rules();
    let next = rules.plan().next.as_ref().unwrap();
    let at_lane = vec!["A.TOP.T1".to_owned(); 5];
    let compiled = compile(IDLE_TACTICS, &rules).unwrap();
    let (mut attacker, mut defender, context) = build_match(
        &rules,
        &[2, 1, 1, 1],
        "fragile-hero-death-respawn",
        21,
        Some(&at_lane),
        Some(&at_lane),
    );
    attacker.program = compiled.program.clone();
    defender.program = compiled.program;
    for (slot, hero) in ["F02", "F03", "F04", "F05", "F06"].into_iter().enumerate() {
        set_catalog(&mut defender, slot, hero, &rules);
    }
    let mut vm = Vm::new(&rules);
    let artifact = simulate(&attacker, &defender, &rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("death and Solo respawn scenario executes: {error:?}"));

    let death_state = owner_state_at(&artifact, 1);
    let victim = owner_hero_by_slot(death_state, "slot-1");
    let prior_squad = entity_string(owner_hero_by_slot(owner_state_at(&artifact, 0), "slot-1"), "squad");
    assert_eq!(entity_integer(victim, "hp"), 0, "concentrated reciprocal combat kills the fragile Hero");
    assert_eq!(entity_string(victim, "squad"), "", "death immediately removes the Hero from its prior squad");
    assert_eq!(entity_integer(victim, "respawn_at"), 21);
    assert_eq!(entity_string(owner_hero_by_slot(owner_state_at(&artifact, 1), "slot-2"), "squad"), prior_squad);

    let respawn_state = owner_state_at(&artifact, 21);
    let respawned = owner_hero_by_slot(respawn_state, "slot-1");
    assert_eq!(entity_integer(respawned, "hp"), entity_integer(respawned, "max_hp"));
    assert_eq!(entity_integer(respawned, "respawn_at"), 0);
    assert_eq!(entity_string(respawned, "node"), next.map.attacker_base);
    let respawn_squad = entity_string(respawned, "squad");
    assert!(!respawn_squad.is_empty() && respawn_squad != prior_squad);
    assert_ne!(respawn_squad, entity_string(owner_hero_by_slot(respawn_state, "slot-2"), "squad"),
        "respawn creates a Solo and does not auto-rejoin the prior group");

    serde_json::json!({
        "case_id": "death-departure-solo-respawn",
        "ruleset_version": rules.ruleset().version,
        "package_digest": rules.package_digest().as_str(),
        "death_tick": 1,
        "respawn_tick": 21,
        "respawn_node": next.map.attacker_base,
        "respawn_squad": respawn_squad,
        "termination_tick": artifact.result.final_tick
    })
}

fn strategic_match_case(
    rules: &VerifiedRulePlan,
    case_id: &str,
    attacker_partition: &[usize],
    defender_partition: &[usize],
    attacker_catalog: &[&str; 5],
    defender_catalog: &[&str; 5],
    attacker_destinations: &[&str; 5],
    defender_destinations: &[&str; 5],
) -> serde_json::Value {
    let attacker_assignments = (1..=5)
        .zip(attacker_destinations.iter())
        .map(|(slot, destination)| (format!("slot-{slot}"), (*destination).to_owned()))
        .collect::<Vec<_>>();
    let defender_assignments = (1..=5)
        .zip(defender_destinations.iter())
        .map(|(slot, destination)| (format!("slot-{slot}"), (*destination).to_owned()))
        .collect::<Vec<_>>();
    let attacker_program = compile(&movement_tactics(&attacker_assignments), rules)
        .unwrap_or_else(|error| panic!("{case_id} attacker policy compiles: {error:?}"));
    let defender_program = compile(&movement_tactics(&defender_assignments), rules)
        .unwrap_or_else(|error| panic!("{case_id} defender policy compiles: {error:?}"));
    let mut attacker = configured_snapshot(rules, CombatantSide::Attacker, attacker_partition, attacker_program.program, None);
    let mut defender = configured_snapshot(rules, CombatantSide::Defender, defender_partition, defender_program.program, None);
    for (slot, hero) in attacker_catalog.iter().enumerate() {
        set_catalog(&mut attacker, slot, hero, rules);
    }
    for (slot, hero) in defender_catalog.iter().enumerate() {
        set_catalog(&mut defender, slot, hero, rules);
    }
    let mut context = new_match_context(rules, MatchId::new(format!("w9-{case_id}")));
    context.max_ticks = rules.plan().termination.max_ticks;
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("full-length scenario {case_id} executes through Enbu: {error:?}"));

    for side in [CombatantSide::Attacker, CombatantSide::Defender] {
        let accepted = accepted_actors(&artifact, side, "move");
        assert_eq!(accepted.len(), 5, "{case_id} has five distinct non-idle opening moves for {side:?}");
    }
    let event_counts = artifact.replay.frames.iter().flat_map(|frame| frame.events.iter())
        .fold(BTreeMap::<String, usize>::new(), |mut counts, event| {
            *counts.entry(event.event.to_string()).or_default() += 1;
            counts
        });
    let attacker_final = owner_state_at(&artifact, artifact.result.final_tick);
    let attacker_heroes = (1..=5).map(|slot| {
        let hero = owner_hero_by_slot(attacker_final, &format!("slot-{slot}"));
        serde_json::json!({
            "slot": slot,
            "catalog_id": entity_string(hero, "catalog_id"),
            "hp": entity_integer(hero, "hp"),
            "node": entity_string(hero, "node"),
            "edge_to": entity_string(hero, "edge_to"),
            "edge_progress": entity_integer(hero, "edge_progress"),
            "xp_scaled": entity_integer(hero, "xp"),
            "level": entity_integer(hero, "level"),
            "squad": entity_string(hero, "squad"),
            "maturity": entity_integer(hero, "maturity"),
            "respawn_at": entity_integer(hero, "respawn_at")
        })
    }).collect::<Vec<_>>();
    let public = artifact.public_response();
    let public_final = public.replay.frames.last().and_then(|frame| frame.visible_state.as_ref());
    let visible_structures = public_final.into_iter().flat_map(|view| view.entities.iter())
        .filter(|(_, entity)| matches!(entity.entity_type.as_str(), "tower" | "base"))
        .map(|(id, entity)| serde_json::json!({
            "id": id.as_str(),
            "kind": entity.entity_type.as_str(),
            "catalog_id": entity.fields.get(&FieldId::new("catalog_id")),
            "hp": entity.fields.get(&FieldId::new("hp"))
        }))
        .collect::<Vec<_>>();

    serde_json::json!({
        "case_id": case_id,
        "max_ticks": context.max_ticks,
        "attacker_partition": attacker_partition,
        "defender_partition": defender_partition,
        "attacker_catalog": attacker_catalog,
        "defender_catalog": defender_catalog,
        "attacker_opening_destinations": attacker_destinations,
        "defender_opening_destinations": defender_destinations,
        "outcome": format!("{:?}", artifact.result.outcome),
        "termination_reason": artifact.result.termination_reason.as_str(),
        "final_tick": artifact.result.final_tick,
        "time_limited": artifact.result.termination_reason == rules.plan().termination.on_timeout_reason,
        "termination_class": if artifact.result.termination_reason == rules.plan().termination.on_timeout_reason { "timeout" } else if artifact.result.outcome == MatchOutcome::Draw { "draw" } else { "victory" },
        "final_state_digest": artifact.result.final_state_digest.as_str(),
        "hero_actions_by_side": { "attacker": 5, "defender": 5 },
        "attacker_final_heroes": attacker_heroes,
        "visible_structure_state": visible_structures,
        "visible_event_counts": event_counts,
        "cu_by_side": {
            "attacker": artifact.result.cu_spent[&CombatantSide::Attacker].0,
            "defender": artifact.result.cu_spent[&CombatantSide::Defender].0
        }
    })
}

fn strategic_case_set(rules: &VerifiedRulePlan) -> Vec<serde_json::Value> {
    let cases = vec![
        strategic_match_case(
            rules,
            "balanced-solos-vs-quintet",
            &[1, 1, 1, 1, 1],
            &[5],
            &["F01", "R01", "F02", "R02", "F03"],
            &["F04", "F05", "F06", "R03", "R04"],
            &["B.TOP.T1", "B.MID.T1", "B.BOT.T1", "N.MID.OBS", "B.TOP.T1"],
            &["A.TOP.T2", "A.MID.T1", "A.BOT.T1", "N.MID.OBS", "A.MID.T2"],
        ),
        strategic_match_case(
            rules,
            "split-2-2-1-vs-3-2-role-mix",
            &[2, 2, 1],
            &[3, 2],
            &["R01", "R02", "R03", "R04", "R05"],
            &["F01", "F03", "R02", "F05", "R06"],
            &["A.TOP.T2", "A.TOP.T2", "A.MID.T2", "A.MID.T2", "A.BOT.T2"],
            &["A.TOP.T1", "A.TOP.T1", "A.TOP.T1", "A.MID.T1", "A.MID.T1"],
        ),
        strategic_match_case(
            rules,
            "jungle-push-vs-lane-defense",
            &[4, 1],
            &[2, 2, 1],
            &["F01", "F02", "F03", "F04", "R01"],
            &["F05", "R02", "F06", "R03", "R04"],
            &["N.A.UJ", "N.MID.OBS", "N.B.LJ", "A.MID.T2", "N.MID.OBS"],
            &["B.TOP.T1", "A.TOP.T2", "B.MID.T1", "B.BOT.T1", "A.BOT.T2"],
        ),
        strategic_match_case(
            rules,
            "mirrored-lane-defense-vs-jungle-push",
            &[2, 2, 1],
            &[4, 1],
            &["F05", "R02", "F06", "R03", "R04"],
            &["F01", "F02", "F03", "F04", "R01"],
            &["B.TOP.T1", "A.TOP.T2", "B.MID.T1", "B.BOT.T1", "A.BOT.T2"],
            &["N.A.UJ", "N.MID.OBS", "N.B.LJ", "A.MID.T2", "N.MID.OBS"],
        ),
        strategic_match_case(rules, "base-assault-solos-vs-quintet", &[1,1,1,1,1], &[5],
            &["F01","F03","F06","R02","R04"], &["F02","F04","R01","R03","R05"],
            &["B.BASE";5], &["A.BASE";5]),
        strategic_match_case(rules, "base-assault-quintet-vs-solos-mirrored", &[5], &[1,1,1,1,1],
            &["F02","F04","R01","R03","R05"], &["F01","F03","F06","R02","R04"],
            &["B.BASE";5], &["A.BASE";5]),
        strategic_match_case(rules, "base-assault-duos-vs-trio-duo", &[2,2,1], &[3,2],
            &["F03","F04","R01","R02","R05"], &["F01","F02","F05","R04","R06"],
            &["B.BASE";5], &["A.BASE";5]),
        strategic_match_case(rules, "base-assault-trio-duo-vs-duos-mirrored", &[3,2], &[2,2,1],
            &["F01","F02","F05","R04","R06"], &["F03","F04","R01","R02","R05"],
            &["B.BASE";5], &["A.BASE";5]),
    ];

    let case = |id: &str| cases.iter().find(|case| case["case_id"] == id)
        .unwrap_or_else(|| panic!("strategic case {id} is included"));
    let structure_hp = |case: &serde_json::Value, catalog_id: &str| {
        case["visible_structure_state"].as_array()
            .and_then(|structures| structures.iter().find(|structure| {
                structure["catalog_id"]["value"] == catalog_id
            }))
            .and_then(|structure| structure["hp"]["value"].as_i64())
            .unwrap_or_else(|| panic!("{catalog_id} is visible in the terminal base-destruction frame for {}", case["case_id"]))
    };

    // A paired setup swaps both roster and squad partition. Both orientations
    // must be capable of destroying the opposing base, with the same result
    // fields that the replay exposes to a spectator.
    let attacker_win = case("base-assault-duos-vs-trio-duo");
    assert_eq!(attacker_win["outcome"], "AttackerVictory");
    assert_eq!(attacker_win["termination_class"], "victory");
    assert_eq!(attacker_win["termination_reason"], "base_destroyed");
    assert!(attacker_win["final_tick"].as_u64().unwrap() < attacker_win["max_ticks"].as_u64().unwrap());
    assert_eq!(structure_hp(attacker_win, "base.defender"), 0);
    assert!(structure_hp(attacker_win, "base.attacker") > 0);

    let defender_win = case("base-assault-trio-duo-vs-duos-mirrored");
    assert_eq!(defender_win["outcome"], "DefenderVictory");
    assert_eq!(defender_win["termination_class"], "victory");
    assert_eq!(defender_win["termination_reason"], "base_destroyed");
    assert!(defender_win["final_tick"].as_u64().unwrap() < defender_win["max_ticks"].as_u64().unwrap());
    assert_eq!(structure_hp(defender_win, "base.attacker"), 0);
    assert!(structure_hp(defender_win, "base.defender") > 0);

    let timeouts = cases.iter().filter(|case| case["termination_class"] == "timeout").collect::<Vec<_>>();
    assert_eq!(timeouts.len(), 6, "the report retains capped draws as timeout observations");
    assert!(timeouts.iter().all(|case| {
        case["outcome"] == "Draw"
            && case["termination_reason"] == "time_limit"
            && case["final_tick"] == case["max_ticks"]
    }));
    cases
}

fn reveal_expiry_case() {
    let rules = reveal_rules();
    let actor = hero_selector("slot-1");
    let enemy = "argmin hero in filter hero in enemies.visible_heroes { hero.catalog_id == \"F01\", } by hero.hp then hero.id";
    let tactics = format!(
        "senkei w9_reveal_expiry {{ action reveal_target {{ when match.tick == 1, do activate({actor}, \"r03_a_active\", {enemy}), }} }}"
    );
    let compiled = compile(&tactics, &rules)
        .unwrap_or_else(|error| panic!("catalog reveal policy compiles: {error:?}"));
    let attacker_nodes = [
        "N.A.UJ", "A.BASE", "A.BASE", "A.BASE", "A.BASE",
    ].map(str::to_owned);
    let defender_nodes = [
        "N.A.UJ", "B.BASE", "B.BASE", "B.BASE", "B.BASE",
    ].map(str::to_owned);
    let (mut attacker, defender, mut context) = build_match(
        &rules,
        &[1, 1, 1, 1, 1],
        "w9-reveal-expiry",
        6,
        Some(&attacker_nodes),
        Some(&defender_nodes),
    );
    set_catalog(&mut attacker, 0, "R03", &rules);
    attacker.program = compiled.program;
    // Put R03, F01, and a fragile allied vision Minion on the same canonical
    // 620-WU ford edge. Logical range is 340 WU: beyond R03's 330 sight but
    // within the 420 Reveal active. F01 kills the Minion during tick one, so
    // Reveal must preserve visibility after its only normal vision source dies.
    let ford_start = &rules.plan().next.as_ref().unwrap().map.nodes["N.A.UJ"];
    let ford_end = &rules.plan().next.as_ref().unwrap().map.nodes["N.B.UJ"];
    let edge_progress = |entity: &mut EntityState, progress: i64| {
        entity.fields.insert(FieldId::from("node"), DomainValue::String("N.A.UJ".into()));
        entity.fields.insert(FieldId::from("edge_to"), DomainValue::String("N.B.UJ".into()));
        entity.fields.insert(FieldId::from("edge_progress"), DomainValue::Integer(progress));
        entity.fields.insert(FieldId::from("x"), DomainValue::Integer(
            ford_start.x + (ford_end.x - ford_start.x) * progress / 620,
        ));
        entity.fields.insert(FieldId::from("y"), DomainValue::Integer(
            ford_start.y + (ford_end.y - ford_start.y) * progress / 620,
        ));
    };
    for (side, slot, progress) in [
        (CombatantSide::Attacker, "slot-1", 0_i64),
        (CombatantSide::Defender, "slot-1", 340_i64),
    ] {
        let hero = context.initial_world.entities.values_mut().find(|entity| {
            entity.entity_type.as_str() == "hero" && entity.owner == Some(side)
                && entity.fields.get(&FieldId::from("slot_id")) == Some(&DomainValue::String(slot.into()))
        }).expect("configured Hero exists in initial World");
        edge_progress(hero, progress);
    }
    let mut vision_source = test_minion(&rules, CombatantSide::Attacker, "N.A.UJ");
    edge_progress(&mut vision_source, 340);
    vision_source.fields.insert(FieldId::from("hp"), DomainValue::Integer(1));
    vision_source.fields.insert(FieldId::from("attack"), DomainValue::Integer(0));
    vision_source.fields.insert(FieldId::from("speed"), DomainValue::Integer(0));
    context.initial_world.entities.insert("w9-reveal-vision-source".into(), vision_source);
    let mut vm = Vm::new(&rules);
    let artifact = simulate(&attacker, &defender, &rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("reveal lifecycle executes through Enbu: {error:?}"));

    let accepted = accepted_actors(&artifact, CombatantSide::Attacker, "activate");
    assert_eq!(accepted.len(), 1, "the real R03 reveal active is accepted at tick one");
    assert_eq!(artifact.result.final_tick, 6, "match continues beyond the reveal boundary");
    assert_eq!(artifact.result.termination_reason.as_str(), "time_limit");

    let owner = artifact.owner_replay.as_ref().expect("Next match contains attacker owner replay");
    let visible_target = |replay: &PresentationReplay, tick: u32| {
        let frame = replay.frames.iter().find(|frame| frame.tick == tick)
            .unwrap_or_else(|| panic!("replay has tick {tick}"));
        frame.visible_state.as_ref().is_some_and(|state| {
            state.entities.values().any(|entity| {
                entity.entity_type.as_str() == "hero"
                    && entity.owner == Some(CombatantSide::Defender)
                    && entity.fields.get(&FieldId::from("catalog_id"))
                        == Some(&DomainValue::String("F01".into()))
            })
        })
    };

    // R03 and F01 share one ford Combat Domain at 340 WU: Reveal reaches the
    // target beyond its 330 vision radius, and the co-located Minion alone
    // provides initial sight. Reveal lasts through tick four and expires at five.
    assert!(visible_target(owner, 0), "attacker initially sees the target through its minion source");
    assert!(visible_target(owner, 1), "owner replay sees the target while reveal is active");
    let tick_one_events = &owner.frames.iter().find(|frame| frame.tick == 1).unwrap().events;
    assert!(tick_one_events.iter().any(|event| event.event.as_str() == "next.skill"
        && event.payload.get(&FieldId::from("skill")) == Some(&DomainValue::String("r03_a_active".into()))),
        "the owner replay records the catalog Reveal skill execution");
    assert!(visible_target(owner, 4), "reveal remains active through expiry minus one");
    assert!(!visible_target(owner, 5), "owner replay hides the enemy at the expiry boundary");
    assert!(!visible_target(owner, 6), "owner replay keeps the enemy hidden after expiry");
    assert!(visible_target(&artifact.replay, 4), "public replay includes the mutually visible target before expiry");
    assert!(!visible_target(&artifact.replay, 5), "public replay hides the target at the expiry boundary");
    assert!(!visible_target(&artifact.replay, 6), "public replay keeps the target hidden after expiry");

    let tick_one = owner.frames.iter().find(|frame| frame.tick == 1).unwrap().visible_state.as_ref().unwrap();
    let source = tick_one.entities.values().find(|entity| entity.entity_type.as_str() == "minion"
        && entity.owner == Some(CombatantSide::Attacker)
        && entity_integer(entity, "hp") == 0)
        .expect("tick-one owner view includes the vision minion");
    assert_eq!(entity_integer(source, "hp"), 0, "the sole nearby vision source dies in the reveal tick");
    let tick_two = owner.frames.iter().find(|frame| frame.tick == 2).unwrap().visible_state.as_ref().unwrap();
    assert!(!tick_two.entities.values().any(|entity| entity.entity_type.as_str() == "minion"
        && entity.owner == Some(CombatantSide::Attacker)
        && entity_integer(entity, "hp") == 0),
        "the dead vision source is removed before the next observation");
    let tick_four = owner.frames.iter().find(|frame| frame.tick == 4).unwrap().visible_state.as_ref().unwrap();
    let scout = tick_four.entities.values().find(|entity| entity.entity_type.as_str() == "hero"
        && entity.owner == Some(CombatantSide::Attacker)
        && entity.fields.get(&FieldId::from("catalog_id")) == Some(&DomainValue::String("R03".into())))
        .expect("attacker owner view includes the recon Hero");
    let target = tick_four.entities.values().find(|entity| entity.entity_type.as_str() == "hero"
        && entity.owner == Some(CombatantSide::Defender)
        && entity.fields.get(&FieldId::from("catalog_id")) == Some(&DomainValue::String("F01".into())))
        .expect("target remains visible through reveal");
    assert_eq!(entity_string(scout, "edge_to"), "N.B.UJ");
    assert_eq!(entity_string(target, "edge_to"), "N.B.UJ");
    assert_eq!(entity_integer(scout, "edge_progress"), 0);
    assert_eq!(entity_integer(target, "edge_progress"), 340);
    let vision = entity_integer(scout, "vision");
    assert!(340 > vision,
        "the target remains visible at tick four while outside every living scout's radius");

    let private_fields = [
        "slot_id", "xp", "cooldowns", "squad", "skill_path", "attack_ready",
        "respawn_at", "reveal_attacker_until", "reveal_defender_until", "reveal_until",
    ].map(FieldId::from);
    for replay in [owner, &artifact.replay] {
        for frame in &replay.frames {
            for entity in frame.visible_state.iter().flat_map(|state| state.entities.values())
                .filter(|entity| entity.owner == Some(CombatantSide::Defender))
            {
                assert!(private_fields.iter().all(|field| !entity.fields.contains_key(field)),
                    "private enemy fields remain unknown in owner/public projections at tick {}", frame.tick);
            }
        }
    }

    // The owner-only slot identity is absent from the enemy observation type,
    // so a tactical program cannot turn it into a queryable private field.
    let private_probe = compile(
        "senkei w9_private_enemy_probe { state private_slot { any hero in enemies.visible_heroes { hero.slot_id is unknown, } } }",
        &rules,
    );
    let private_probe_error = private_probe.expect_err("Jinrei rejects reads of owner-only enemy slot IDs");
    assert!(private_probe_error.message.contains("unknown or unobservable field 'slot_id'"),
        "the rejection is specifically the enemy slot visibility boundary");
}

fn catalog_scenario_cases(rules: &VerifiedRulePlan) -> Vec<serde_json::Value> {
    let next = rules.plan().next.as_ref().unwrap();
    let mut cases = Vec::new();
    for (hero_index, selected_hero) in next.heroes.iter().enumerate() {
        let (mut attacker, mut defender, context) = build_match(
            rules,
            &[1, 1, 1, 1, 1],
            &format!("w9-catalog-{}", selected_hero.id),
            1,
            None,
            None,
        );
        for snapshot in [&mut attacker, &mut defender] {
            let Some(DomainValue::List(heroes)) = snapshot.configuration.get_mut(&FieldId::new("heroes")) else {
                panic!("fixture has the catalog Hero list");
            };
            for (slot, record) in heroes.iter_mut().enumerate() {
                let definition = &next.heroes[(hero_index + slot) % next.heroes.len()];
                let DomainValue::Record(fields) = record else { panic!("fixture has Hero records"); };
                fields.insert(FieldId::new("catalog_id"), DomainValue::String(definition.id.clone()));
                let path = definition.skill_paths.keys().next().expect("catalog Hero has a prepared path");
                fields.insert(FieldId::new("skill_path"), DomainValue::String(path.clone()));
            }
        }
        let mut vm = Vm::new(rules);
        let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
            .unwrap_or_else(|error| panic!("catalog Hero {} participates in a valid match: {error:?}", selected_hero.id));
        let lineup = (0..5).map(|slot| next.heroes[(hero_index + slot) % next.heroes.len()].id.clone())
            .collect::<Vec<_>>();
        cases.push(serde_json::json!({
            "case_id": format!("catalog-selection-{}", selected_hero.id),
            "selected_catalog_hero": selected_hero.id,
            "attacker_lineup": lineup,
            "defender_lineup": lineup,
            "partition": [1, 1, 1, 1, 1],
            "outcome": format!("{:?}", artifact.result.outcome),
            "final_tick": artifact.result.final_tick,
            "final_state_digest": artifact.result.final_state_digest.as_str()
        }));
    }
    cases
}

fn write_next_adapter_fixtures(rules: &VerifiedRulePlan) {
    let Some(directory) = std::env::var_os("NEXT_ADAPTER_FIXTURE_DIR").map(PathBuf::from) else {
        return;
    };
    fs::create_dir_all(&directory).unwrap_or_else(|error| panic!("create {}: {error}", directory.display()));
    let attacker_destinations = ["B.TOP.T1", "B.MID.T1", "B.BOT.T1", "N.MID.OBS", "B.TOP.T1"];
    let defender_destinations = ["A.TOP.T2", "A.MID.T1", "A.BOT.T1", "N.MID.OBS", "A.MID.T2"];
    let assignments = |destinations: &[&str; 5]| (1..=5)
        .zip(destinations.iter())
        .map(|(slot, destination)| (format!("slot-{slot}"), (*destination).to_owned()))
        .collect::<Vec<_>>();
    let attacker_program = compile(&movement_tactics(&assignments(&attacker_destinations)), rules).unwrap();
    let defender_program = compile(&movement_tactics(&assignments(&defender_destinations)), rules).unwrap();
    let mut attacker = configured_snapshot(
        rules,
        CombatantSide::Attacker,
        &[1, 1, 1, 1, 1],
        attacker_program.program,
        None,
    );
    let mut defender = configured_snapshot(
        rules,
        CombatantSide::Defender,
        &[5],
        defender_program.program,
        None,
    );
    for (slot, hero) in ["F01", "R01", "F02", "R02", "F03"].iter().enumerate() {
        set_catalog(&mut attacker, slot, hero, rules);
    }
    for (slot, hero) in ["F04", "F05", "F06", "R03", "R04"].iter().enumerate() {
        set_catalog(&mut defender, slot, hero, rules);
    }
    let mut context = new_match_context(rules, MatchId::new("w9-public-native-wasm-parity"));
    context.max_ticks = 120;
    let base_request = serde_json::json!({
        "api_version": Version::new(1, 0, 0),
        "operation": "simulate",
        "payload": {
            "attacker": attacker,
            "defender": defender,
            "context": context,
            "include_diagnostics": false
        }
    });
    let cases = [
        ("next-public-simulation.request.json", "next-public-simulation", base_request.clone()),
        ("next-invalid-engine.request.json", "next-invalid-engine", {
            let mut request = base_request.clone();
            request["payload"]["context"]["versions"]["engine"] = serde_json::to_value(Version::new(1, 0, 0)).unwrap();
            request
        }),
        ("next-invalid-roster.request.json", "next-invalid-roster", {
            let mut request = base_request.clone();
            request["payload"]["attacker"]["configuration"]["heroes"]["value"].as_array_mut().unwrap().pop();
            request
        }),
        ("next-invalid-ruleset.request.json", "next-invalid-ruleset", {
            let mut request = base_request.clone();
            request["payload"]["context"]["ruleset"]["version"] = serde_json::to_value(Version::new(1, 1, 0)).unwrap();
            request
        }),
    ];
    for (file_name, request_id, mut request) in cases {
        request["request_id"] = serde_json::Value::String(request_id.to_owned());
        let bytes = serde_json::to_vec_pretty(&request).unwrap();
        fs::write(directory.join(file_name), bytes)
            .unwrap_or_else(|error| panic!("write adapter fixture {file_name}: {error}"));
    }
}

fn run_movement_factor_grid(rules: &VerifiedRulePlan) -> Vec<serde_json::Value> {
    let next = rules.plan().next.as_ref().unwrap();
    let mut report = Vec::new();
    let axes = [
        ("lane", "A.TOP.T1", "A.TOP.T2", 1_000_i64),
        ("jungle", "A.TOP.J", "N.A.UJ", 800_i64),
    ];
    for (terrain, start, destination, terrain_factor) in axes {
        for minion_vision in [false, true] {
            for squad_size in 1..=5 {
                let partition = std::iter::once(squad_size)
                    .chain(std::iter::repeat(1).take(5 - squad_size))
                    .collect::<Vec<_>>();
                let friendly_minions = if minion_vision { 1 } else { 0 };
                let moves = if terrain == "lane" && !minion_vision && squad_size == 1 {
                    &["slot-1", "slot-2", "slot-3", "slot-4", "slot-5"][..]
                } else {
                    &["slot-1"][..]
                };
                let case_id = format!("move-{terrain}-vision-{minion_vision}-squad-{squad_size}");
                let (artifact, _) = run_movement_case(
                    rules,
                    &partition,
                    start,
                    destination,
                    friendly_minions,
                    0,
                    moves,
                    &case_id,
                );
                let slot = moves[0];
                assert_eq!(
                    entity_string(owner_hero_at(&artifact, 1, slot), "edge_to"),
                    destination,
                    "the movement intent traverses the expected {terrain} edge",
                );
                let actual = entity_integer(owner_hero_at(&artifact, 1, slot), "edge_progress");
                let hero_speed = entity_integer(owner_hero_at(&artifact, 0, slot), "speed");
                let squad_factor = next.parameters[&format!("squad_{squad_size}_speed_milli")];
                let vision_factor = if minion_vision {
                    next.parameters["minion_vision_speed_milli"]
                } else {
                    1_000
                };
                let expected = i128::from(hero_speed)
                    * i128::from(terrain_factor)
                    * i128::from(vision_factor)
                    * i128::from(squad_factor)
                    / 1_000_000_000;
                assert_eq!(actual, expected as i64, "movement factor case {case_id}");
                report.push(serde_json::json!({
                    "case_id": case_id,
                    "squad_size": squad_size,
                    "catalog_id": "F01",
                    "terrain": terrain,
                    "friendly_minion_vision": minion_vision,
                    "speed_units_after_one_tick": actual
                }));
            }
        }
    }

    let partition = [1, 1, 1, 1, 1];
    for (case_id, friendly_minions, enemy_minions) in [
        ("move-vision-overlap-no-stack", 2, 0),
        ("move-enemy-minion-no-bonus", 0, 1),
    ] {
        let (artifact, _) = run_movement_case(
            rules,
            &partition,
            "A.TOP.J",
            "N.A.UJ",
            friendly_minions,
            enemy_minions,
            &["slot-1"],
            case_id,
        );
        let actual = entity_integer(owner_hero_at(&artifact, 1, "slot-1"), "edge_progress");
        let hero_speed = entity_integer(owner_hero_at(&artifact, 0, "slot-1"), "speed");
        let applicable_vision_factor = if friendly_minions == 2 { 1_200 } else { 1_000 };
        let expected = i128::from(hero_speed) * 800 * applicable_vision_factor * 1_000
            / 1_000_000_000;
        assert_eq!(actual, expected as i64, "movement vision boundary case {case_id}");
        report.push(serde_json::json!({
            "case_id": case_id,
            "squad_size": 1,
            "terrain": "jungle",
            "friendly_minion_count": friendly_minions,
            "enemy_minion_count": enemy_minions,
            "speed_units_after_one_tick": actual
        }));
    }
    report
}

fn five_solo_move_case(rules: &VerifiedRulePlan) -> serde_json::Value {
    let assignments = [
        ("slot-1".to_owned(), "A.TOP.T2".to_owned()),
        ("slot-2".to_owned(), "A.MID.T2".to_owned()),
        ("slot-3".to_owned(), "A.BOT.T2".to_owned()),
        ("slot-4".to_owned(), "A.TOP.T2".to_owned()),
        ("slot-5".to_owned(), "A.BOT.T2".to_owned()),
    ];
    let compiled = compile(&movement_tactics(&assignments), rules)
        .unwrap_or_else(|error| panic!("five-Solo move tactics compile: {error:?}"));
    let (mut attacker, defender, context) = build_match(
        rules,
        &[1, 1, 1, 1, 1],
        "five-solo-moves",
        1,
        Some(&vec!["A.TOP.T1".to_owned(); 5]),
        None,
    );
    attacker.program = compiled.program;
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("five Solo move scenario executes through Enbu: {error:?}"));
    let actors = accepted_actors(&artifact, CombatantSide::Attacker, "move");
    assert_eq!(actors.len(), 5, "five independent Solo move actions are accepted in one frozen tick");
    for slot in 1..=5 {
        let before = owner_hero_at(&artifact, 0, &format!("slot-{slot}"));
        let after = owner_hero_at(&artifact, 1, &format!("slot-{slot}"));
        let moved = entity_integer(before, "x") != entity_integer(after, "x")
            || entity_integer(before, "y") != entity_integer(after, "y")
            || entity_string(before, "node") != entity_string(after, "node")
            || entity_integer(before, "edge_progress") != entity_integer(after, "edge_progress");
        assert!(moved, "each of the five Solo Heroes advances after its accepted move intent: slot-{slot}");
    }
    serde_json::json!({
        "case_id": "five-solo-nonidle-moves",
        "accepted_distinct_actors": actors.len(),
        "attacker_cu": artifact.result.cu_spent[&CombatantSide::Attacker].0
    })
}

fn owner_state_at(artifact: &SimulationArtifact, tick: u32) -> &WorldStateView {
    artifact
        .owner_replay
        .as_ref()
        .expect("Next matches publish a restricted local owner replay")
        .frames
        .iter()
        .find(|frame| frame.tick == tick)
        .and_then(|frame| frame.visible_state.as_ref())
        .unwrap_or_else(|| panic!("owner replay publishes the tick-{tick} state"))
}

fn owner_initial_state(artifact: &SimulationArtifact) -> &WorldStateView {
    owner_state_at(artifact, 0)
}

fn squad_sizes(state: &WorldStateView, side: CombatantSide) -> Vec<usize> {
    let mut counts = BTreeMap::<String, usize>::new();
    for entity in state.entities.values().filter(|entity| {
        entity.entity_type.as_str() == "hero" && entity.owner == Some(side)
    }) {
        let squad = match entity.fields.get(&FieldId::new("squad")) {
            Some(DomainValue::String(squad)) => squad.clone(),
            _ => panic!("public Hero state contains its squad assignment"),
        };
        *counts.entry(squad).or_default() += 1;
    }
    let mut sizes = counts.into_values().collect::<Vec<_>>();
    sizes.sort_unstable_by(|left, right| right.cmp(left));
    sizes
}

fn report_path() -> Option<PathBuf> {
    std::env::var_os("NEXT_BALANCE_REPORT").map(PathBuf::from)
}

fn write_report(path: &Path, report: &serde_json::Value) {
    let mut bytes = serde_json::to_vec_pretty(report).expect("scenario report serializes as JSON");
    bytes.push(b'\n');
    fs::write(path, bytes).unwrap_or_else(|error| panic!("could not write {}: {error}", path.display()));
}

fn report_fixture_path() -> Option<String> {
    std::env::var_os("NEXT_ADAPTER_FIXTURE_DIR").map(|value| {
        let path = PathBuf::from(value);
        let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("Enbu manifest lives two levels below the repository root");
        path.strip_prefix(repository_root)
            .unwrap_or(&path)
            .display()
            .to_string()
    })
}

#[test]
fn headless_next_scenario_suite_runs_real_enbu_partitions_and_reports_exact_inputs() {
    let rules = rules();
    let package_digest = rules.package_digest().as_str();
    let next_version = rules.plan().next.as_ref().unwrap().mechanics_version;
    let cases: [(&str, &[usize]); 7] = [
        ("partition-1-1-1-1-1", &[1, 1, 1, 1, 1]),
        ("partition-2-1-1-1", &[2, 1, 1, 1]),
        ("partition-2-2-1", &[2, 2, 1]),
        ("partition-3-1-1", &[3, 1, 1]),
        ("partition-3-2", &[3, 2]),
        ("partition-4-1", &[4, 1]),
        ("partition-5", &[5]),
    ];
    let mut results = Vec::new();
    let mut baseline_repeat = None;
    for (case_id, partition) in cases {
        let match_id = format!("w9-{case_id}");
        let artifact = run_partition(&rules, partition, &match_id)
            .unwrap_or_else(|error| panic!("{case_id} must execute through Enbu: {error:?}"));
        let state = owner_initial_state(&artifact);
        let attacker_sizes = squad_sizes(state, CombatantSide::Attacker);
        assert_eq!(attacker_sizes, partition, "attacker initial squad partition for {case_id}");
        assert_eq!(
            state.entities.values().filter(|entity| entity.entity_type.as_str() == "hero" && entity.owner == Some(CombatantSide::Attacker)).count(),
            5,
            "all five attacker Heroes participate in {case_id}",
        );

        let public = artifact.public_response();
        if case_id == "partition-1-1-1-1-1" {
            let serialized = serde_json::to_string(&public).expect("public response is serializable");
            assert!(!serialized.contains("internal_secret_marker"), "public output excludes tactic source details");
            assert!(!serialized.contains("restricted_diagnostics"), "public output excludes restricted diagnostics");
            assert!(public.replay.frames[0].visible_state.as_ref().map_or(true, |view| {
                !view.entities.values().any(|entity| entity.owner == Some(CombatantSide::Defender))
            }), "the initial public fog projection does not reveal the distant opposing Heroes");
            assert_eq!(artifact.owner_replay.as_ref().unwrap().perspective, Some(CombatantSide::Attacker));
            baseline_repeat = Some(public.clone());
        }

        results.push(serde_json::json!({
            "case_id": case_id,
            "partition": partition,
            "match_id": match_id,
            "outcome": format!("{:?}", artifact.result.outcome),
            "final_tick": artifact.result.final_tick,
            "final_state_digest": artifact.result.final_state_digest.as_str(),
            "attacker_cu": artifact.result.cu_spent[&CombatantSide::Attacker].0,
            "defender_cu": artifact.result.cu_spent[&CombatantSide::Defender].0
        }));
    }

    // This exact rerun is a determinism assertion, not an additional balance sample.
    let repeated = run_partition(&rules, &[1, 1, 1, 1, 1], "w9-partition-1-1-1-1-1")
        .expect("identical deterministic setup executes");
    assert_eq!(repeated.public_response(), baseline_repeat.expect("baseline was recorded"));

    results.extend(run_movement_factor_grid(&rules));
    results.push(five_solo_move_case(&rules));
    results.extend(catalog_scenario_cases(&rules));
    results.push(squad_reform_case(&rules));
    results.extend(xp_share_cases(&rules));
    results.push(jungle_respawn_case(&rules));
    results.push(death_respawn_case());
    let strategic_cases = strategic_case_set(&rules);
    results.extend(strategic_cases);
    write_next_adapter_fixtures(&rules);

    if let Some(path) = report_path() {
        write_report(&path, &serde_json::json!({
            "schema": "senkei-next-balance-report/v1",
            "ruleset_id": rules.ruleset().id.as_str(),
            "ruleset_version": rules.ruleset().version,
            "mechanics_version": next_version,
            "package_digest": package_digest,
            "case_count": results.len(),
            "cases": results,
            "adapter_fixture_dir": report_fixture_path(),
            "limits": [
                "The seven initial partition cases run for one tick; eight lineup and objective cases run to the 600-tick ruleset cap or base destruction with five opening move intents per side.",
                "The same deterministic setup is repeated only for a reproducibility assertion; it is not an additional balance sample.",
                "The report is a mechanical and scenario observation set, not a win-rate or general balance estimate.",
                "The death test uses a versioned test-only package derivative with one fragile Hero; it does not describe canonical combat tuning.",
                "The eight full-length strategic cases contain six 600-tick timeouts and two mirrored base-destruction victories; timeout draws remain time-limited observations."
            ]
        }));
    }
}

#[test]
fn next_match_setup_rejects_bad_rosters_and_incompatible_context_versions() {
    let rules = rules();
    let (attacker, defender, mut context) =
        build_match(&rules, &[1, 1, 1, 1, 1], "w9-invalid-roster", 1, None, None);
    let mut vm = Vm::new(&rules);

    let mut four_heroes = attacker.clone();
    let DomainValue::List(heroes) = four_heroes
        .configuration
        .get_mut(&FieldId::new("heroes"))
        .expect("fixture has hero configuration")
    else {
        panic!("hero configuration is a list");
    };
    heroes.pop();
    assert!(simulate(&four_heroes, &defender, &rules, &context, &mut vm).is_err(),
        "a roster with fewer than five Heroes is invalid");

    let mut duplicate_slot = attacker.clone();
    let DomainValue::List(heroes) = duplicate_slot
        .configuration
        .get_mut(&FieldId::new("heroes"))
        .expect("fixture has hero configuration")
    else {
        panic!("hero configuration is a list");
    };
    let first_slot = match &heroes[0] {
        DomainValue::Record(fields) => fields[&FieldId::new("slot_id")].clone(),
        _ => panic!("hero record expected"),
    };
    if let DomainValue::Record(fields) = &mut heroes[1] {
        fields.insert(FieldId::new("slot_id"), first_slot);
    }
    assert!(simulate(&duplicate_slot, &defender, &rules, &context, &mut vm).is_err(),
        "duplicate Hero slot IDs are invalid");

    let mut unknown_path = attacker.clone();
    let DomainValue::List(heroes) = unknown_path
        .configuration
        .get_mut(&FieldId::new("heroes"))
        .expect("fixture has hero configuration")
    else {
        panic!("hero configuration is a list");
    };
    if let DomainValue::Record(fields) = &mut heroes[0] {
        fields.insert(FieldId::new("skill_path"), DomainValue::String("w9_unknown_path".into()));
    }
    assert!(simulate(&unknown_path, &defender, &rules, &context, &mut vm).is_err(),
        "a skill path outside the selected catalog Hero is invalid");

    context.versions.engine = Version::new(1, 0, 0);
    assert!(simulate(&attacker, &defender, &rules, &context, &mut vm).is_err(),
        "a context using Enbu 1.0.0 cannot run the Next 1.0.0 ruleset");
}

#[test]
fn every_catalog_hero_can_be_selected_and_simulated() {
    let rules = rules();
    assert_eq!(catalog_scenario_cases(&rules).len(), 12);
}

#[test]
fn next_reveal_expires_at_the_same_tick_in_owner_and_public_replays() {
    reveal_expiry_case();
}

fn normalized_edge(a: &str, b: &str) -> (String, String) {
    if a <= b { (a.to_owned(), b.to_owned()) } else { (b.to_owned(), a.to_owned()) }
}

fn canonical_battlefield_topology_conforms() {
    let rules = rules();
    let map = &rules.plan().next.as_ref().expect("Next rules").map;
    let mut expected_nodes = ["A.BASE", "B.BASE", "N.MID.OBS"]
        .into_iter().map(str::to_owned).collect::<Vec<_>>();
    for lane in ["TOP", "MID", "BOT"] {
        for side in ["A", "B"] {
            let lane_nodes = if side == "A" {
                [format!("{side}.{lane}.T1"), format!("{side}.{lane}.T2"), format!("{side}.{lane}.J"), format!("{side}.{lane}.BANK")]
            } else {
                [format!("{side}.{lane}.BANK"), format!("{side}.{lane}.J"), format!("{side}.{lane}.T2"), format!("{side}.{lane}.T1")]
            };
            expected_nodes.extend(lane_nodes);
        }
    }
    expected_nodes.extend(["N.A.UJ", "N.B.UJ", "N.A.LJ", "N.B.LJ", "N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC"].map(str::to_owned));
    expected_nodes.sort();
    let actual_nodes = map.nodes.keys().cloned().collect::<Vec<_>>();
    assert_eq!(actual_nodes, expected_nodes, "the published world contains exactly the canonical 35 logical nodes");

    let mut expected_edges = BTreeMap::<(String, String), (i64, bool, String)>::new();
    let mut add = |a: &str, b: &str, length: i64, ford: bool, site: &str| {
        assert!(expected_edges.insert(normalized_edge(a, b), (length, ford, site.to_owned())).is_none(), "test topology has unique connection {a}—{b}");
    };
    for lane in ["TOP", "MID", "BOT"] {
        let a = ["A.BASE".to_owned(), format!("A.{lane}.T1"), format!("A.{lane}.T2"), format!("A.{lane}.J"), format!("A.{lane}.BANK")];
        let b = [format!("B.{lane}.BANK"), format!("B.{lane}.J"), format!("B.{lane}.T2"), format!("B.{lane}.T1"), "B.BASE".to_owned()];
        for route in [&a, &b] {
            for pair in route.windows(2) {
                let has_t1 = pair[0].ends_with("T1") || pair[1].ends_with("T1");
                let has_t2 = pair[0].ends_with("T2") || pair[1].ends_with("T2");
                let length = if has_t1 { 150 } else if has_t2 { 100 } else { 50 };
                add(&pair[0], &pair[1], length, false, "");
            }
        }
        match lane {
            "TOP" | "BOT" => add(&format!("A.{lane}.BANK"), &format!("B.{lane}.BANK"), 100, false, lane),
            "MID" => {
                add("A.MID.BANK", "N.MID.OBS", 50, false, lane);
                add("N.MID.OBS", "B.MID.BANK", 50, false, lane);
            }
            _ => unreachable!(),
        }
    }
    for side in ["A", "B"] {
        add(&format!("{side}.TOP.J"), &format!("N.{side}.UJ"), 325, false, "");
        add(&format!("N.{side}.UJ"), &format!("{side}.MID.J"), 325, false, "");
        add(&format!("{side}.MID.J"), &format!("N.{side}.LJ"), 325, false, "");
        add(&format!("N.{side}.LJ"), &format!("{side}.BOT.J"), 325, false, "");
        add(&format!("N.{side}.UJ"), &format!("N.{side}.UC"), 45, false, "");
        add(&format!("N.{side}.LJ"), &format!("N.{side}.LC"), 45, false, "");
    }
    add("N.A.UJ", "N.B.UJ", 620, true, "");
    add("N.A.LJ", "N.B.LJ", 620, true, "");
    let actual_edges = map.edges.iter().map(|edge| {
        assert!(!edge.id.is_empty(), "every canonical logical edge has a stable ID");
        assert!(map.nodes.contains_key(&edge.from) && map.nodes.contains_key(&edge.to), "edge {} has both endpoints", edge.id);
        assert!(edge.length > 0);
        assert!(!edge.region.eq_ignore_ascii_case("jungle") || edge.bridge_site.is_empty(), "jungle routes cannot be bridge sites");
        assert!(!edge.ford || edge.region.eq_ignore_ascii_case("jungle"), "only jungle river crossings are fords");
        (normalized_edge(&edge.from, &edge.to), (edge.length, edge.ford, edge.bridge_site.clone()))
    }).collect::<BTreeMap<_, _>>();
    assert_eq!(map.edges.len(), 42, "all explicit lane, bridge, jungle, camp and ford edges exist");
    assert_eq!(actual_edges, expected_edges, "the edge set has no hidden shortcut or missing crossing");
    let bridge_sites = map.edges.iter().filter(|edge| !edge.bridge_site.is_empty()).map(|edge| edge.bridge_site.as_str()).collect::<Vec<_>>();
    assert_eq!(bridge_sites.iter().filter(|site| **site == "MID").count(), 2, "MID observation plaza has two separately managed connectors");
    assert_eq!(bridge_sites.iter().copied().collect::<std::collections::BTreeSet<_>>(), ["TOP", "MID", "BOT"].into_iter().collect());
    assert_eq!(rules.plan().next.as_ref().unwrap().camps.len(), 4, "four dead-end camps are configured");
    for lane in ["top", "mid", "bot"] {
        let path = &map.lanes[lane];
        let distance = path.windows(2).map(|pair| {
            map.edges.iter().find(|edge| normalized_edge(&edge.from, &edge.to) == normalized_edge(&pair[0], &pair[1]))
                .unwrap_or_else(|| panic!("lane {lane} consecutive nodes are an actual edge: {}—{}", pair[0], pair[1])).length
        }).sum::<i64>();
        assert_eq!(distance, 1_000, "{lane} reaches opposing bases along the canonical river route");
        assert_eq!(path.first().map(String::as_str), Some("A.BASE"));
        assert_eq!(path.last().map(String::as_str), Some("B.BASE"));
    }
}

#[test]
fn published_battlefield_map_matches_the_canonical_graph_without_shortcuts() {
    canonical_battlefield_topology_conforms();
}

fn battlefield_interaction_tactics() -> (String, String) {
    let attacker = format!(
        r#"senkei battlefield_integration {{
            action choose_left {{ when match.tick == 1, do select_track({}, LEFT), }},
            action move_left {{ when match.tick == 2, do move({}, "A.TOP.T2"), }},
            action expand_top_bridge {{ when match.tick == 1, do bridge_work({}, argmin bridge in filter bridge in battlefield.bridges {{ bridge.site == "TOP", }} by bridge.hp then bridge.id, expand), }},
            action destroy_top_bridge {{ when match.tick == 15, do bridge_work({}, argmin bridge in filter bridge in battlefield.bridges {{ bridge.site == "TOP", }} by bridge.hp then bridge.id, destroy), }},
            action rebuild_top_bridge {{ when match.tick == 25, do bridge_work({}, argmin bridge in filter bridge in battlefield.bridges {{ bridge.site == "TOP", }} by bridge.hp then bridge.id, rebuild), }},
            action ford_crossing {{ when match.tick == 1, do move({}, "N.B.UJ"), }},
            action blocked_node_exit {{ when match.tick == 1, do move({}, "B.MID.BANK"), }},
            action node_retreat {{ when match.tick == 2, do retreat({}), }},
            action pursue_mid {{ when match.tick == 1, do pursue({}, argmin hero in filter hero in enemies.visible_heroes {{ hero.node == "N.MID.OBS", }} by hero.hp then hero.id), }},
            action cross_rebuilt_bridge {{ when match.tick == 50, do move({}, "B.TOP.BANK"), }}
        }}"#,
        hero_selector("slot-1"), hero_selector("slot-1"),
        hero_selector("slot-2"), hero_selector("slot-2"), hero_selector("slot-2"),
        hero_selector("slot-3"), hero_selector("slot-4"), hero_selector("slot-4"), hero_selector("slot-5"),
        hero_selector("slot-2"),
    );
    let defender = format!(
        r#"senkei battlefield_mid_defense {{
            action blocked_mid_exit {{ when match.tick == 1, do move({}, "A.MID.BANK"), }}
        }}"#,
        hero_selector("slot-1"),
    );
    (attacker, defender)
}

fn battlefield_interaction_match(
    rules: &VerifiedRulePlan,
) -> (SimulationArtifact, SenkeiSnapshot, SenkeiSnapshot, MatchContext) {
    let (attacker_source, defender_source) = battlefield_interaction_tactics();
    let attacker_program = compile(&attacker_source, rules)
        .unwrap_or_else(|error| panic!("canonical track, bridge, ford, movement and retreat Jinrei source compiles: {error:?}"));
    let defender_program = compile(&defender_source, rules)
        .unwrap_or_else(|error| panic!("canonical contested-node exit policy compiles: {error:?}"));
    let attacker_nodes = ["A.TOP.T1", "A.TOP.BANK", "N.A.UJ", "N.MID.OBS", "A.MID.BANK"].map(str::to_owned);
    let defender_nodes = ["N.MID.OBS", "N.MID.OBS", "B.BASE", "B.BASE", "B.BASE"].map(str::to_owned);
    let mut attacker = configured_snapshot(
        rules,
        CombatantSide::Attacker,
        &[1, 1, 1, 1, 1],
        attacker_program.program,
        Some(&attacker_nodes),
    );
    let mut defender = configured_snapshot(
        rules,
        CombatantSide::Defender,
        &[1, 1, 1, 1, 1],
        defender_program.program,
        Some(&defender_nodes),
    );
    for (slot, hero) in ["F01", "R01", "F02", "R02", "F03"].iter().enumerate() {
        set_catalog(&mut attacker, slot, hero, rules);
    }
    for (slot, hero) in ["F04", "F05", "F06", "R03", "R04"].iter().enumerate() {
        set_catalog(&mut defender, slot, hero, rules);
    }
    let mut context = new_match_context(rules, MatchId::new("battlefield-canonical-interactions"));
    context.max_ticks = 70;
    let mut vm = Vm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut vm)
        .unwrap_or_else(|error| panic!("canonical battlefield interaction match runs through real Enbu: {error:?}"));
    (artifact, attacker, defender, context)
}

fn presentation_entity<'a>(state: &'a WorldStateView, kind: &str, field: &str, value: &str) -> &'a EntityStateView {
    state.entities.values().find(|entity| {
        entity.entity_type.as_str() == kind
            && entity.fields.get(&FieldId::new(field)) == Some(&DomainValue::String(value.to_owned()))
    }).unwrap_or_else(|| panic!("authorized presentation replay contains {kind} where {field}={value}"))
}

#[test]
fn canonical_battlefield_real_jinrei_match_covers_tracks_fords_bridges_and_node_combat() {
    let rules = rules();
    let (artifact, attacker, defender, context) = battlefield_interaction_match(&rules);
    for capability in ["select_track", "bridge_work", "move", "pursue"] {
        assert!(!accepted_actors(&artifact, CombatantSide::Attacker, capability).is_empty(),
            "real Jinrei submits an accepted {capability} action to Enbu");
    }
    assert_eq!(accepted_actors(&artifact, CombatantSide::Attacker, "select_track").len(), 1);
    assert!(artifact.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker && event.tick == 1
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "bridge_work")
    }), "the TOP bridge operation is a real accepted typed intent");
    assert!(artifact.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker && event.tick == 25
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "bridge_work")
    }), "a destroyed TOP bridge is a real accepted rebuild intent");
    assert!(artifact.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker && event.tick == 1
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "pursue")
    }), "a visible MID opponent is an explicit real Enbu pursuit target");
    assert!(artifact.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker && event.tick == 2
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "retreat")
    }), "retreat is an explicit real Enbu intent");
    assert!(artifact.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker && event.tick == 50
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "move")
    }), "a Hero takes an explicit move intent across the rebuilt fixed bridge");

    let track_at_tick_1 = owner_hero_at(&artifact, 1, "slot-1");
    assert_eq!(entity_string(track_at_tick_1, "track"), "LEFT", "the lane's selected side persists in logical state");
    let lane_mover = owner_hero_at(&artifact, 2, "slot-1");
    assert_eq!(entity_string(lane_mover, "edge_to"), "A.TOP.T2");
    assert_eq!(entity_string(lane_mover, "track"), "LEFT");
    assert!(entity_integer(lane_mover, "edge_progress") > 0);
    let pursuer = owner_hero_at(&artifact, 1, "slot-5");
    assert_eq!(entity_string(pursuer, "edge_to"), "N.MID.OBS", "the actual pursuit begins along a connected edge to the observed target node");
    assert!(entity_integer(pursuer, "edge_progress") > 0);
    let retreating = owner_hero_at(&artifact, 2, "slot-4");
    assert_eq!(entity_string(retreating, "edge_from"), "N.MID.OBS");
    assert_eq!(entity_string(retreating, "edge_to"), "A.MID.BANK", "retreat uses the legal allied connector out of MID");
    let bridge_crossing = owner_hero_at(&artifact, 50, "slot-2");
    assert_eq!(entity_string(bridge_crossing, "edge_from"), "A.TOP.BANK");
    assert_eq!(entity_string(bridge_crossing, "edge_to"), "B.TOP.BANK", "the rebuilt fixed bridge remains an actual traversable edge");

    let ford_frame = artifact.owner_replay.as_ref().unwrap().frames.iter().find(|frame| {
        frame.visible_state.as_ref().is_some_and(|state| state.entities.values().any(|entity| {
            entity.entity_type.as_str() == "hero"
                && entity.fields.get(&FieldId::new("slot_id")) == Some(&DomainValue::String("slot-3".into()))
                && entity.fields.get(&FieldId::new("ford_remaining")).is_some_and(|value| matches!(value, DomainValue::Integer(ticks) if *ticks > 0))
        }))
    }).expect("the Jungle river traversal spends replay-visible ticks in the ford state");
    assert!(ford_frame.tick > 0);

    let mid_state = owner_state_at(&artifact, 1);
    assert_eq!(entity_string(owner_hero_by_slot(mid_state, "slot-4"), "node"), "N.MID.OBS",
        "an A unit cannot leave the contested observation node directly into B territory");
    let defender_mid = mid_state.entities.values().find(|entity| entity.entity_type.as_str() == "hero"
        && entity.owner == Some(CombatantSide::Defender)
        && entity.fields.get(&FieldId::new("slot_id")) == Some(&DomainValue::String("slot-1".into())))
        .expect("defender observation-node fighter is visible in attacker owner replay");
    assert_eq!(entity_string(defender_mid, "node"), "N.MID.OBS",
        "a B unit cannot leave the contested observation node directly into A territory");
    assert!(artifact.replay.frames.iter().any(|frame| frame.tick == 1 && frame.events.iter().any(|event| event.event.as_str() == "next.attack")),
        "units in the same node combat domain attack in the actual match");

    let bridge_at = |tick| presentation_entity(owner_state_at(&artifact, tick), "bridge", "site", "TOP");
    assert_eq!(entity_string(bridge_at(0), "bridge_state"), "normal");
    assert_eq!(entity_integer(bridge_at(12), "build_remaining"), 1);
    assert_eq!(entity_string(bridge_at(13), "bridge_state"), "expanded");
    assert_eq!(entity_string(bridge_at(22), "bridge_state"), "expanded");
    assert_eq!(entity_string(bridge_at(23), "bridge_state"), "destroyed");
    assert_eq!(entity_integer(bridge_at(23), "hp"), 0);
    assert_eq!(entity_integer(bridge_at(48), "build_remaining"), 1);
    assert_eq!(entity_string(bridge_at(49), "bridge_state"), "normal");

    let observation = presentation_entity(owner_state_at(&artifact, 1), "observation", "node", "N.MID.OBS");
    assert_eq!(entity_integer(observation, "capture_progress"), 0, "contested teams stop MID capture progress");

    if let Some(path) = std::env::var_os("BATTLEFIELD_SCENARIO_SNAPSHOT_PATH") {
        let path = PathBuf::from(path);
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).expect("browser snapshot directory exists"); }
        let snapshot = serde_json::json!({ "attacker": attacker, "defender": defender, "context": context });
        let bytes = serde_json::to_vec_pretty(&snapshot).expect("controlled browser input serializes");
        fs::write(path, bytes).expect("write compiled real-match snapshot for the browser");
    }
    if let Some(directory) = std::env::var_os("NEXT_ADAPTER_FIXTURE_DIR").map(PathBuf::from) {
        fs::create_dir_all(&directory).expect("adapter fixture directory exists");
        let mut request = serde_json::json!({
            "api_version": Version::new(1, 0, 0),
            "request_id": "next-battlefield-canonical",
            "operation": "simulate",
            "payload": { "attacker": attacker, "defender": defender, "context": context, "include_diagnostics": false }
        });
        request["request_id"] = "next-battlefield-canonical".into();
        let bytes = serde_json::to_vec_pretty(&request).expect("native/WASM battle input serializes");
        fs::write(directory.join("next-battlefield-canonical.request.json"), bytes)
            .expect("write canonical Enbu battle for both adapters");
    }
    assert!(artifact.result.final_tick > ford_frame.tick);
}
