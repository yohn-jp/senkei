use enbu::{new_match_context, simulate, simulate_with_actor_decisions, AutonomousActorKind, AutonomousCombatAction};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::BTreeMap;

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
            .collect::<Option<BTreeMap<_, _>>>()
            .map(DomainValue::Record),
    }
}

fn snapshot(rules: &VerifiedRulePlan, side: CombatantSide, program: TacticalProgram, node: &str) -> SenkeiSnapshot {
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| default_value(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else {
            assert!(!schema.required, "required fixture field {field}");
        }
    }
    let next = rules.plan().next.as_ref().unwrap();
    let heroes = next.heroes.iter().take(5).enumerate().map(|(index, hero)| {
        DomainValue::Record(BTreeMap::from([
            (FieldId::from("slot_id"), DomainValue::String(format!("slot-{}", index + 1))),
            (FieldId::from("catalog_id"), DomainValue::String(hero.id.clone())),
            (FieldId::from("squad"), DomainValue::String(format!("squad-{index}"))),
            (FieldId::from("node"), DomainValue::String(node.to_owned())),
            (FieldId::from("skill_path"), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
        ]))
    }).collect();
    configuration.insert("heroes".into(), DomainValue::List(heroes));
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: match side { CombatantSide::Attacker => "actor-trace-attacker", CombatantSide::Defender => "actor-trace-defender" }.into(),
        revision: "1".into(),
        ruleset: rules.ruleset().clone(),
        configuration,
        program,
        initial_memory: TacticalMemory::new(),
    }
}

fn fixture() -> (VerifiedRulePlan, SenkeiSnapshot, SenkeiSnapshot, MatchContext) {
    let rules = senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap();
    fixture_with_rules(rules)
}

fn fixture_with_rules(rules: VerifiedRulePlan) -> (VerifiedRulePlan, SenkeiSnapshot, SenkeiSnapshot, MatchContext) {
    let idle = compile("senkei idle { state inert { false, }, }", &rules).unwrap().program;
    let node = &rules.plan().next.as_ref().unwrap().map.defender_base;
    // Both armies meet at the defender's base, exercising real structure and
    // minion selection without changing the published rules.
    let attacker = snapshot(&rules, CombatantSide::Attacker, idle.clone(), node);
    let defender = snapshot(&rules, CombatantSide::Defender, idle, node);
    let mut context = new_match_context(&rules, "autonomous-trace".into());
    context.max_ticks = 2;
    (rules, attacker, defender, context)
}

#[test]
fn owner_traces_match_real_events_and_do_not_change_simulation() {
    let (rules, attacker, defender, context) = fixture();
    let standard = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let traced = simulate_with_actor_decisions(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let repeated = simulate_with_actor_decisions(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(traced.public_response(), standard.public_response());
    assert_eq!(repeated.public_response(), standard.public_response());
    assert_eq!(traced.reproduction(), &standard.reproduction);
    let mut attacks = 0;
    let mut kinds = Vec::new();
    for side in [CombatantSide::Attacker, CombatantSide::Defender] {
        assert_eq!(traced.diagnostics_for_owner(side).diagnostics, standard.diagnostic_response(side).diagnostics.unwrap());
        let traces = traced.traces_for_owner(side);
        assert_eq!(traces, repeated.traces_for_owner(side));
        assert!(!traces.is_empty());
        let replay = &standard.owner_replays[&side];
        for trace in traces {
            assert_ne!(trace.kind, AutonomousActorKind::Monster);
            kinds.push(trace.kind);
            let frame = replay.frames.iter().find(|frame| frame.tick == trace.tick).unwrap();
            let view = frame.visible_state.as_ref().unwrap();
            assert_eq!(view.entities.get(&trace.actor).unwrap().owner, Some(side));
            assert!(trace.actor.as_str().starts_with("visible-"));
            assert!(trace.candidates.iter().all(|id| id.as_str().starts_with("visible-") && view.entities.contains_key(id)));
            if let AutonomousCombatAction::Attack { target, .. } = &trace.action {
                attacks += 1;
                assert!(trace.candidates.contains(target));
                let reference = trace.committed_event.as_ref().expect("visible committed attack");
                assert_eq!(reference.tick, trace.tick);
                let event = &frame.events[reference.event_index];
                assert_eq!(event.event.as_str(), "next.attack");
                assert_eq!(event.payload.get(&"source".into()), Some(&DomainValue::Entity(trace.actor.clone())));
                assert_eq!(event.payload.get(&"target".into()), Some(&DomainValue::Entity(target.clone())));
            } else {
                assert!(trace.committed_event.is_none());
            }
        }
    }
    assert!(attacks > 0, "fixture must exercise a committed autonomous attack");
    assert!(kinds.contains(&AutonomousActorKind::Base));
    assert!(kinds.contains(&AutonomousActorKind::Minion));
    let public = serde_json::to_string(&traced.public_response()).unwrap();
    assert!(!public.contains("candidates"));
    assert!(!public.contains("NearestThenEntityId"));
}

#[test]
fn unknown_observation_does_not_reveal_attack_candidates_in_owner_traces() {
    let (rules, attacker, defender, mut context) = fixture();
    // Exercise fail-closed projection on a hostile initial World: a second
    // visible enemy Base makes the registered one-item collection Unknown.
    // The prepared rosters and verified Next schema remain unchanged.
    let next = rules.plan().next.as_ref().unwrap();
    let base = &next.map.defender_base;
    let point = &next.map.nodes[base];
    let unit = |kind: &str, side, attack, catalog: &str| EntityState {
        entity_type: kind.into(), owner: Some(side),
        fields: BTreeMap::from([
            ("hp".into(), DomainValue::Integer(100)),
            ("max_hp".into(), DomainValue::Integer(100)),
            ("attack".into(), DomainValue::Integer(attack)),
            ("defense".into(), DomainValue::Integer(0)),
            ("speed".into(), DomainValue::Integer(0)),
            ("range".into(), DomainValue::Integer(100)),
            ("attack_interval".into(), DomainValue::Integer(1)),
            ("vision".into(), DomainValue::Integer(100)),
            ("x".into(), DomainValue::Integer(point.x)),
            ("y".into(), DomainValue::Integer(point.y)),
            ("node".into(), DomainValue::String(base.clone())),
            ("edge_to".into(), DomainValue::String(String::new())),
            ("lane".into(), DomainValue::String("MID".into())),
            ("catalog_id".into(), DomainValue::String(catalog.into())),
        ]),
    };
    context.initial_world.entities.insert("extra-visible-base".into(), unit("base", CombatantSide::Defender, 0, "extra"));
    context.initial_world.entities.insert("extra-attacker-minion".into(), unit("minion", CombatantSide::Attacker, 10, &next.minions[0].id));
    let baseline = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    struct ObserveUnknown { vm: Vm, seen: bool }
    impl TacticalExecutionPort for ObserveUnknown {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            if request.side == CombatantSide::Attacker && request.tick == 1 {
                self.seen = matches!(request.observation.collections.get(&"enemies.visible_bases".into()), Some(Observed::Unknown));
            }
            self.vm.execute(request)
        }
    }
    let mut vm = ObserveUnknown { vm: Vm::new(&rules), seen: false };
    let traced = simulate_with_actor_decisions(&attacker, &defender, &rules, &context, &mut vm).unwrap();
    assert!(vm.seen, "the frozen enemy Base collection must really be Unknown");
    assert_eq!(traced.public_response(), baseline.public_response());
    let frame = baseline.owner_replays[&CombatantSide::Attacker].frames.iter().find(|frame| frame.tick == 1).unwrap();
    let view = frame.visible_state.as_ref().unwrap();
    assert!(frame.events.iter().any(|event| {
        event.event.as_str() == "next.attack"
            && matches!(event.payload.get(&"source".into()), Some(DomainValue::Entity(id)) if view.entities.get(id).is_some_and(|entity| entity.entity_type.as_str() == "minion" && entity.owner == Some(CombatantSide::Attacker)))
    }), "the minion really attacked despite the unknown tactical collection");
    assert!(!traced.traces_for_owner(CombatantSide::Attacker).iter().any(|trace| {
        trace.tick == 1 && trace.kind == AutonomousActorKind::Minion && matches!(trace.action, AutonomousCombatAction::Attack { .. })
    }));
}

#[test]
fn trace_limit_is_shared_with_existing_diagnostics_and_fails_closed() {
    let (rules, attacker, defender, mut context) = fixture();
    let baseline = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    context.host_limits.max_diagnostic_events = baseline.diagnostics.events.len() as u64;
    simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let error = match simulate_with_actor_decisions(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)) {
        Ok(_) => panic!("diagnostics overflow must not return an incomplete trace"),
        Err(error) => error,
    };
    assert_eq!(error.code, ApiErrorCode::ResourceLimit);
}
