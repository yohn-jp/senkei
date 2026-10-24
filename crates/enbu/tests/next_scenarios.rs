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

fn configured_snapshot(
    rules: &VerifiedRulePlan,
    side: CombatantSide,
    partition: &[usize],
    tactic_program: TacticalProgram,
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
            heroes.push(DomainValue::Record(BTreeMap::from([
                (FieldId::new("slot_id"), DomainValue::String(format!("slot-{}", heroes.len() + 1))),
                (FieldId::new("catalog_id"), DomainValue::String(hero.id.clone())),
                (FieldId::new("squad"), DomainValue::String(format!("squad-{squad_number}"))),
                (FieldId::new("node"), DomainValue::String(base_node.to_owned())),
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
    let compiled = compile(IDLE_TACTICS, rules)
        .unwrap_or_else(|error| panic!("fixture tactics must compile against Next: {error:?}"));
    let attacker = configured_snapshot(rules, CombatantSide::Attacker, partition, compiled.program.clone());
    let defender = configured_snapshot(rules, CombatantSide::Defender, partition, compiled.program);
    let mut context = new_match_context(rules, MatchId::new(match_id));
    context.max_ticks = 1;
    let mut vm = Vm::new(rules);
    simulate(&attacker, &defender, rules, &context, &mut vm)
}

fn initial_state(artifact: &SimulationArtifact) -> &WorldStateView {
    artifact.replay.frames.first()
        .and_then(|frame| frame.visible_state.as_ref())
        .expect("simulation publishes the tick-zero state")
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
    let bytes = serde_json::to_vec_pretty(report).expect("scenario report serializes as JSON");
    fs::write(path, bytes).unwrap_or_else(|error| panic!("could not write {}: {error}", path.display()));
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
        let state = initial_state(&artifact);
        let attacker_sizes = squad_sizes(state, CombatantSide::Attacker);
        let defender_sizes = squad_sizes(state, CombatantSide::Defender);
        assert_eq!(attacker_sizes, partition, "attacker initial squad partition for {case_id}");
        assert_eq!(defender_sizes, partition, "defender initial squad partition for {case_id}");
        assert_eq!(
            state.entities.values().filter(|entity| entity.entity_type.as_str() == "hero").count(),
            10,
            "all five configured Heroes on each side participate in {case_id}",
        );

        let public = artifact.public_response();
        if case_id == "partition-1-1-1-1-1" {
            let serialized = serde_json::to_string(&public).expect("public response is serializable");
            assert!(!serialized.contains("internal_secret_marker"), "public output excludes tactic source details");
            assert!(!serialized.contains("restricted_diagnostics"), "public output excludes restricted diagnostics");
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

    if let Some(path) = report_path() {
        write_report(&path, &serde_json::json!({
            "schema": "senkei-next-balance-report/v1",
            "ruleset_id": rules.ruleset().id.as_str(),
            "ruleset_version": rules.ruleset().version,
            "mechanics_version": next_version,
            "package_digest": package_digest,
            "case_count": results.len(),
            "cases": results,
            "limits": [
                "This report establishes initial configuration and replay behavior for seven squad partitions only.",
                "It is not a win-rate or general balance estimate.",
                "Movement, maturation, visibility, jungle, XP, combat death/respawn, regroup intents, invalid versions, and WASM parity require separate cases."
            ]
        }));
    }
}
