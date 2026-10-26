use enbu::{new_match_context, simulate};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::BTreeMap;

const IDLE_TACTICS: &str = "senkei observation_idle { state inert { false, }, }";

fn rules() -> VerifiedRulePlan {
    senritsu::validate(
        senritsu::next_package(),
        &senritsu::next_engine_compatibility(),
    )
    .unwrap_or_else(|issues| panic!("canonical Battlefield package validates: {issues:?}"))
}

fn hero_selector(slot: &str) -> String {
    format!(
        "argmin hero in filter hero in allies.heroes {{ hero.slot_id == \"{slot}\", }} by hero.hp then hero.id"
    )
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
            Some(DomainValue::Fixed {
                coefficient: max.map_or(value, |maximum| value.min(maximum)),
                scale: *scale,
            })
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

fn snapshot(
    rules: &VerifiedRulePlan,
    side: CombatantSide,
    program: TacticalProgram,
) -> SenkeiSnapshot {
    let next = rules
        .plan()
        .next
        .as_ref()
        .expect("canonical package includes Next mechanics");
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        let value = schema
            .default
            .clone()
            .or_else(|| default_value(&schema.value_type));
        if let Some(value) = value {
            configuration.insert(field.clone(), value);
        } else if schema.required {
            panic!("required Senkei field {field} has no fixture value");
        }
    }

    let base = match side {
        CombatantSide::Attacker => &next.map.attacker_base,
        CombatantSide::Defender => &next.map.defender_base,
    };
    let heroes = next
        .heroes
        .iter()
        .take(5)
        .enumerate()
        .map(|(index, hero)| {
            let skill_path = hero
                .skill_paths
                .keys()
                .next()
                .expect("catalog hero has a prepared skill path");
            DomainValue::Record(BTreeMap::from([
                (
                    FieldId::new("slot_id"),
                    DomainValue::String(format!("slot-{}", index + 1)),
                ),
                (
                    FieldId::new("catalog_id"),
                    DomainValue::String(hero.id.clone()),
                ),
                (
                    FieldId::new("squad"),
                    DomainValue::String(format!("squad-{index}")),
                ),
                (
                    FieldId::new("node"),
                    DomainValue::String(base.clone()),
                ),
                (
                    FieldId::new("skill_path"),
                    DomainValue::String(skill_path.clone()),
                ),
            ]))
        })
        .collect::<Vec<_>>();
    assert_eq!(heroes.len(), 5, "each side fields the canonical five Hero roster");
    configuration.insert(FieldId::new("heroes"), DomainValue::List(heroes));

    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(match side {
            CombatantSide::Attacker => "battlefield-observation-attacker",
            CombatantSide::Defender => "battlefield-observation-defender",
        }),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration,
        program,
        initial_memory: TacticalMemory::new(),
    }
}

struct ObservationVm {
    vm: Vm,
    attacker_observations: Vec<ObservationSnapshot>,
}

impl ObservationVm {
    fn new(rules: &VerifiedRulePlan) -> Self {
        Self {
            vm: Vm::new(rules),
            attacker_observations: Vec::new(),
        }
    }
}

impl TacticalExecutionPort for ObservationVm {
    fn execute(
        &mut self,
        request: TacticalExecutionRequest<'_>,
    ) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
        if request.side == CombatantSide::Attacker {
            self.attacker_observations.push(request.observation.clone());
        }
        self.vm.execute(request)
    }
}

fn simulate_hidden_bridge_probe(
    rules: &VerifiedRulePlan,
    attacker_program: &TacticalProgram,
    defender_program: &TacticalProgram,
) -> (SimulationArtifact, Vec<ObservationSnapshot>) {
    let attacker = snapshot(rules, CombatantSide::Attacker, attacker_program.clone());
    let defender = snapshot(rules, CombatantSide::Defender, defender_program.clone());
    let mut context = new_match_context(rules, MatchId::new("battlefield-hidden-bridge-probe"));
    context.max_ticks = 1;
    let mut executor = ObservationVm::new(rules);
    let artifact = simulate(&attacker, &defender, rules, &context, &mut executor)
        .unwrap_or_else(|error| panic!("real one-tick Enbu match executes: {error:?}"));
    (artifact, executor.attacker_observations)
}

fn all_roster_heroes_start_at(snapshot: &SenkeiSnapshot, node: &str) -> bool {
    let Some(DomainValue::List(heroes)) = snapshot.configuration.get(&FieldId::new("heroes")) else {
        return false;
    };
    heroes.iter().all(|hero| {
        matches!(hero, DomainValue::Record(fields)
            if fields.get(&FieldId::new("node")) == Some(&DomainValue::String(node.to_owned())))
    })
}

fn attacker_hero_at_tick<'a>(
    artifact: &'a SimulationArtifact,
    tick: u32,
    slot: &str,
) -> &'a EntityStateView {
    artifact
        .owner_replay
        .as_ref()
        .expect("canonical match emits an owner replay")
        .frames
        .iter()
        .find(|frame| frame.tick == tick)
        .and_then(|frame| frame.visible_state.as_ref())
        .and_then(|state| {
            state.entities.values().find(|entity| {
                entity.entity_type == TypeId::new("hero")
                    && entity.owner == Some(CombatantSide::Attacker)
                    && entity.fields.get(&FieldId::new("slot_id"))
                        == Some(&DomainValue::String(slot.to_owned()))
            })
        })
        .unwrap_or_else(|| panic!("attacker owner replay contains {slot} at tick {tick}"))
}

fn integer_field(entity: &EntityStateView, field: &str) -> i64 {
    match entity.fields.get(&FieldId::new(field)) {
        Some(DomainValue::Integer(value)) => *value,
        _ => panic!("owner replay includes integer field {field}"),
    }
}

#[test]
fn hidden_bridge_is_unknown_and_cannot_be_worked_or_charged() {
    let rules = rules();
    let actor = hero_selector("slot-1");

    let center = format!(
        "senkei invalid_center {{ action invalid_track {{ when match.tick == 1, do select_track({actor}, CENTER), }} }}"
    );
    assert!(
        compile(&center, &rules).is_err(),
        "CENTER is not a permitted select_track enum value"
    );
    let invalid_operation = format!(
        "senkei invalid_bridge_operation {{ action invalid_work {{ when match.tick == 1, do bridge_work({actor}, argmin bridge in filter bridge in battlefield.bridges {{ bridge.site == \"TOP\", }} by bridge.hp then bridge.id, repair), }} }}"
    );
    assert!(
        compile(&invalid_operation, &rules).is_err(),
        "repair is not a permitted bridge_work enum value"
    );

    let tactics = format!(
        "senkei hidden_bridge_probe {{ action try_hidden_bridge {{ when match.tick == 1, do bridge_work({actor}, argmin bridge in filter bridge in battlefield.bridges {{ bridge.site == \"TOP\", }} by bridge.hp then bridge.id, expand), }} }}"
    );
    let attacker_program = compile(&tactics, &rules)
        .unwrap_or_else(|error| panic!("typed bridge_work probe compiles: {error:?}"))
        .program;
    let defender_program = compile(IDLE_TACTICS, &rules)
        .unwrap_or_else(|error| panic!("defender idle tactics compile: {error:?}"))
        .program;

    let (first, observations) =
        simulate_hidden_bridge_probe(&rules, &attacker_program, &defender_program);
    let (repeat, repeat_observations) =
        simulate_hidden_bridge_probe(&rules, &attacker_program, &defender_program);

    assert_eq!(observations.len(), 1, "attacker receives one real tick snapshot");
    assert_eq!(observations, repeat_observations, "identical inputs produce identical Jinrei observations");
    let next = rules.plan().next.as_ref().unwrap();
    assert!(all_roster_heroes_start_at(
        &first.reproduction.attacker,
        &next.map.attacker_base,
    ));
    assert!(all_roster_heroes_start_at(
        &first.reproduction.defender,
        &next.map.defender_base,
    ));
    let bridges = &observations[0].collections[&CollectionId::new("battlefield.bridges")];
    assert_eq!(
        bridges,
        &Observed::Known(Vec::new()),
        "hidden fixed bridge entities are omitted from the current-visible collection"
    );
    assert!(first.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker
            && event.tick == 1
            && matches!(&event.record, DiagnosticRecord::RuntimeNotice { code, .. }
                if code.as_str() == "unknown_capability_argument")
    }), "the hidden bridge argmin produces an Unknown required capability argument");
    assert!(!first.diagnostics.events.iter().any(|event| {
        event.side == CombatantSide::Attacker
            && event.tick == 1
            && matches!(&event.record, DiagnosticRecord::IntentAccepted { intent }
                if intent.capability == CapabilityId::new("bridge_work"))
    }), "Enbu accepts no work against a hidden bridge");

    let owner = first.owner_replay.as_ref().expect("attacker owner replay exists");
    assert_eq!(first.owner_replays.len(), 2, "both teams receive separately authorized replay projections");
    assert_eq!(first.replay.world_identity, rules.world_identity().cloned());
    assert_eq!(first.replay.ruleset.as_ref(), Some(rules.ruleset()));
    assert_eq!(
        first.owner_replays[&CombatantSide::Attacker].perspective,
        Some(CombatantSide::Attacker),
    );
    assert_eq!(
        first.owner_replays[&CombatantSide::Defender].perspective,
        Some(CombatantSide::Defender),
    );
    for (side, replay) in &first.owner_replays {
        assert_eq!(replay.world_identity, rules.world_identity().cloned());
        assert_eq!(replay.ruleset.as_ref(), Some(rules.ruleset()));
        let state = replay.frames[0].visible_state.as_ref().unwrap();
        assert!(state.entities.values().any(|entity| {
            entity.entity_type == TypeId::new("hero") && entity.owner == Some(*side)
        }), "owner projection contains its side's heroes");
        assert!(state.entities.values().all(|entity| {
            entity.entity_type != TypeId::new("hero") || entity.owner != Some(match side {
                CombatantSide::Attacker => CombatantSide::Defender,
                CombatantSide::Defender => CombatantSide::Attacker,
            })
        }), "hidden enemy heroes are omitted from each owner projection");
        let fog = match state.global_fields.get(&FieldId::new("fog")) {
            Some(DomainValue::Record(fog)) => fog,
            _ => panic!("owner projection carries fog state"),
        };
        assert_eq!(fog[&FieldId::new("side")], DomainValue::String(match side {
            CombatantSide::Attacker => "attacker",
            CombatantSide::Defender => "defender",
        }.into()));
    }
    let authorized = first.diagnostic_response(CombatantSide::Attacker);
    assert_eq!(authorized.authorized_side, Some(CombatantSide::Attacker));
    assert!(authorized.owner_replay.is_none(), "the ambiguous legacy alias is omitted from the authorized wire response");
    assert_eq!(authorized.owner_replays.keys().copied().collect::<Vec<_>>(), vec![CombatantSide::Attacker]);
    assert!(authorized.diagnostics.as_ref().unwrap().events.iter().all(|event| event.side == CombatantSide::Attacker));
    assert!(authorized.diagnostics.as_ref().unwrap().cu_by_side.keys().all(|side| *side == CombatantSide::Attacker));
    let attacker_identity = &authorized.diagnostics.as_ref().unwrap().identity;
    assert_eq!(attacker_identity.schema_version, 1);
    assert_eq!(attacker_identity.side, CombatantSide::Attacker);
    assert_eq!(attacker_identity.match_id, first.result.match_id);
    assert_eq!(attacker_identity.result_digest, first.replay.result_digest);
    assert_eq!(attacker_identity.program_digest, first.reproduction.attacker.program.content_digest);
    assert!(attacker_identity.snapshot_digest.has_sha256_shape());
    let wire_identity = serde_json::to_value(attacker_identity).unwrap();
    assert_eq!(
        wire_identity.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),
        vec!["match_id", "program_digest", "result_digest", "schema_version", "side", "snapshot_digest"],
        "an owner trace has one program digest, never a map of both sides' programs",
    );
    let defender_authorized = first.diagnostic_response(CombatantSide::Defender);
    assert_eq!(defender_authorized.authorized_side, Some(CombatantSide::Defender));
    assert_eq!(defender_authorized.owner_replays.keys().copied().collect::<Vec<_>>(), vec![CombatantSide::Defender]);
    assert!(defender_authorized.diagnostics.as_ref().unwrap().events.iter().all(|event| event.side == CombatantSide::Defender));
    let defender_identity = &defender_authorized.diagnostics.as_ref().unwrap().identity;
    assert_eq!(defender_identity.schema_version, 1);
    assert_eq!(defender_identity.side, CombatantSide::Defender);
    assert_eq!(defender_identity.match_id, first.result.match_id);
    assert_eq!(defender_identity.result_digest, first.replay.result_digest);
    assert_eq!(defender_identity.snapshot_digest, attacker_identity.snapshot_digest);
    assert_eq!(defender_identity.program_digest, first.reproduction.defender.program.content_digest);
    assert!(owner.frames.iter().all(|frame| {
        frame.visible_state.as_ref().is_some_and(|state| {
            state.entities.values().all(|entity| entity.entity_type != TypeId::new("bridge"))
        })
    }), "private bridge states stay absent from the owner replay while out of vision");
    assert_eq!(
        integer_field(attacker_hero_at_tick(&first, 1, "slot-1"), "energy"),
        rules.plan().next.as_ref().unwrap().parameters["hero_max_energy"],
        "a hidden work target does not spend the actor's energy"
    );

    let spent = first.diagnostics.cu_by_side[&CombatantSide::Attacker].0;
    let budget = rules.plan().cost_schedule.per_tick_budget.0;
    assert!(spent > 0, "the real hidden-query evaluation charges logical CU");
    assert!(spent <= budget, "the query stays within the per-tick CU budget");
    assert!(spent <= rules.plan().cost_schedule.per_match_budget.0);
    assert_eq!(
        first.diagnostics.cu_by_side,
        repeat.diagnostics.cu_by_side,
        "the same Jinrei input charges exactly the same CU"
    );
    assert_eq!(first.result.final_state_digest, repeat.result.final_state_digest);
    assert!(first.replay.frames.iter().all(|frame| {
        frame.visible_state.as_ref().is_none_or(|view| !view.global_fields.contains_key(&FieldId::new("fog")))
    }), "the public replay has no side-authorized fog history");
}

#[test]
fn next_match_rejects_missing_or_mismatched_paired_world_identity() {
    let rules = rules();
    let program = compile(IDLE_TACTICS, &rules).unwrap().program;
    let attacker = snapshot(&rules, CombatantSide::Attacker, program.clone());
    let defender = snapshot(&rules, CombatantSide::Defender, program);

    let mut missing = new_match_context(&rules, MatchId::new("missing-world-identity"));
    missing.world_identity = None;
    let error = simulate(&attacker, &defender, &rules, &missing, &mut Vm::new(&rules)).unwrap_err();
    assert!(error.message.contains("World identity"));

    let mut mismatched = new_match_context(&rules, MatchId::new("mismatched-world-identity"));
    mismatched.world_identity.as_mut().unwrap().presentation_digest = ContentDigest::new("f".repeat(64));
    let error = simulate(&attacker, &defender, &rules, &mismatched, &mut Vm::new(&rules)).unwrap_err();
    assert!(error.message.contains("World identity"));
}
