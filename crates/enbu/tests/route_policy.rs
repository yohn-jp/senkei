use enbu::{new_match_context, preflight, simulate};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

fn rules() -> VerifiedRulePlan {
    senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap()
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
        DomainType::Record { fields } => fields.iter().map(|(key, ty)| Some((key.clone(), default_value(ty)?))).collect::<Option<BTreeMap<_, _>>>().map(DomainValue::Record),
    }
}

fn snapshot(rules: &VerifiedRulePlan, side: CombatantSide, program: TacticalProgram) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().unwrap();
    let mut configuration = BTreeMap::new();
    for (field, schema) in &rules.plan().domain.senkei_configuration {
        if let Some(value) = schema.default.clone().or_else(|| default_value(&schema.value_type)) {
            configuration.insert(field.clone(), value);
        } else {
            assert!(!schema.required, "missing test value for {field}");
        }
    }
    let node = match side { CombatantSide::Attacker => &next.map.attacker_base, CombatantSide::Defender => &next.map.defender_base };
    let heroes = (0..5).map(|index| {
        let hero = &next.heroes[index];
        DomainValue::Record(BTreeMap::from([
            ("slot_id".into(), DomainValue::String(format!("slot-{}", index + 1))),
            ("catalog_id".into(), DomainValue::String(hero.id.clone())),
            ("squad".into(), DomainValue::String(format!("squad-{index}"))),
            ("node".into(), DomainValue::String(node.clone())),
            ("skill_path".into(), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
        ]))
    }).collect();
    configuration.insert("heroes".into(), DomainValue::List(heroes));
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: format!("route-{side:?}").into(), revision: "1".into(),
        ruleset: rules.ruleset().clone(), configuration, program, initial_memory: BTreeMap::new(),
    }
}

fn policy(rules: &VerifiedRulePlan) -> NextRoutePolicy {
    NextRoutePolicy {
        schema_version: 1, policy_id: "route-trial".into(), version: Version::new(1, 0, 0),
        ruleset_digest: rules.package_digest().clone(), world_identity: rules.world_identity().unwrap().clone(),
        test_only: true, preferences: BTreeSet::from([NextRoutePreference::Fastest]),
    }
}

fn scenario() -> (VerifiedRulePlan, SenkeiSnapshot, SenkeiSnapshot, MatchContext, EntityId) {
    let rules = rules();
    let actor = "argmin hero in filter hero in allies.heroes { hero.slot_id == \"slot-1\", } by hero.hp then hero.id";
    let attacker_program = compile(&format!("senkei route_trial {{ action march {{ when true, do move({actor}, \"A.TOP.T2\"), }} }}"), &rules).unwrap().program;
    let defender_program = compile("senkei idle { state inert { false, }, }", &rules).unwrap().program;
    let attacker = snapshot(&rules, CombatantSide::Attacker, attacker_program);
    let defender = snapshot(&rules, CombatantSide::Defender, defender_program);
    let mut context = new_match_context(&rules, "route-test".into());
    context.max_ticks = 30;
    let initial = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let actor = initial.diagnostics.events.iter().find_map(|event| match &event.record {
        DiagnosticRecord::IntentAccepted { intent } if event.side == CombatantSide::Attacker && intent.action_id.as_str() == "march" => intent.actor.clone(),
        _ => None,
    }).expect("the real Jinrei move is accepted");
    (rules, attacker, defender, context, actor)
}

fn command(actor: EntityId) -> NextRouteCommand {
    NextRouteCommand { side: CombatantSide::Attacker, action_id: "march".into(), actor,
        destination: NextRouteNodeId("A.TOP.T2".into()), preference: NextRoutePreference::Fastest,
        waypoints: vec![NextRouteNodeId("A.BOT.T1".into())] }
}

fn visited(artifact: &SimulationArtifact) -> Vec<String> {
    artifact.owner_replays[&CombatantSide::Attacker].frames.iter().filter_map(|frame| {
        let entity = frame.visible_state.as_ref()?.entities.values().find(|entity| {
            entity.entity_type.as_str() == "hero" && entity.owner == Some(CombatantSide::Attacker)
                && entity.fields.get(&"slot_id".into()) == Some(&DomainValue::String("slot-1".into()))
        })?;
        match (entity.fields.get(&"node".into()), entity.fields.get(&"edge_to".into())) {
            (Some(DomainValue::String(node)), Some(DomainValue::String(edge))) if edge.is_empty() => Some(node.clone()),
            _ => None,
        }
    }).collect()
}

#[test]
fn committed_jinrei_move_visits_waypoint_then_destination_and_reproduces() {
    let (rules, attacker, defender, mut context, actor) = scenario();
    let baseline = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert!(!visited(&baseline).contains(&"A.BOT.T1".to_owned()));
    context.next_route = Some(NextRouteMatch { policy: policy(&rules), commands: vec![command(actor.clone())] });
    preflight(&attacker, &defender, &rules, &context).unwrap();
    let run = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let nodes = visited(&run);
    let waypoint = nodes.iter().position(|node| node == "A.BOT.T1").unwrap_or_else(|| panic!("physically visits waypoint: {nodes:?}"));
    let destination = nodes.iter().position(|node| node == "A.TOP.T2").expect("physically reaches destination");
    assert!(waypoint < destination, "{nodes:?}");
    assert!(nodes.iter().skip(destination).all(|node| node == "A.TOP.T2"), "a repeated identical move does not restart its completed route: {nodes:?}");
    assert_ne!(baseline.owner_replays[&CombatantSide::Attacker].frames, run.owner_replays[&CombatantSide::Attacker].frames);
    let reproduction = &run.reproduction;
    assert_eq!(reproduction.context.next_route, context.next_route);
    let repeated = simulate(&reproduction.attacker, &reproduction.defender, &rules, &reproduction.context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(run.result, repeated.result);
    assert_eq!(run.replay, repeated.replay);
    assert_eq!(run.owner_replays, repeated.owner_replays);
}

#[test]
fn validates_exact_policy_world_actor_nodes_and_unknown_preferences() {
    let (rules, attacker, defender, mut context, actor) = scenario();
    let valid = policy(&rules);
    assert!(senritsu::validate_next_route_policy(valid.clone(), &rules).is_ok());
    let mut bad = valid.clone(); bad.test_only = false;
    assert!(senritsu::validate_next_route_policy(bad, &rules).is_err());
    let mut bad = valid.clone(); bad.ruleset_digest = ContentDigest::new("a".repeat(64));
    assert!(senritsu::validate_next_route_policy(bad, &rules).is_err());
    let mut bad = valid.clone(); bad.world_identity.world_id.push_str("-other");
    assert!(senritsu::validate_next_route_policy(bad, &rules).is_err());
    assert!(serde_json::from_str::<NextRoutePreference>("\"safest\"").is_err());
    assert!(serde_json::from_str::<NextRoutePreference>("\"avoid_combat\"").is_err());

    let binding = NextRouteMatch { policy: valid, commands: vec![command(actor)] };
    context.next_route = Some(binding.clone());
    assert!(preflight(&attacker, &defender, &rules, &context).is_ok());
    let mut invalid = binding.clone(); invalid.commands[0].waypoints[0].0 = "missing".into();
    context.next_route = Some(invalid);
    assert!(preflight(&attacker, &defender, &rules, &context).is_err());
    let mut invalid = binding.clone(); invalid.commands[0].actor = "missing-actor".into();
    context.next_route = Some(invalid);
    assert!(preflight(&attacker, &defender, &rules, &context).is_err());
    let mut invalid = binding.clone(); invalid.commands[0].side = CombatantSide::Defender;
    context.next_route = Some(invalid);
    assert!(preflight(&attacker, &defender, &rules, &context).is_err());
    let mut invalid = binding.clone(); invalid.commands.push(invalid.commands[0].clone());
    context.next_route = Some(invalid);
    assert!(preflight(&attacker, &defender, &rules, &context).is_err());
}

#[test]
fn unmatched_or_uncommitted_action_cannot_activate_route() {
    let (rules, attacker, defender, mut context, actor) = scenario();
    let baseline = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let mut route = command(actor);
    route.action_id = "not_emitted".into();
    context.next_route = Some(NextRouteMatch { policy: policy(&rules), commands: vec![route] });
    let run = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(baseline.result.final_state_digest, run.result.final_state_digest);
    assert_eq!(baseline.replay.frames, run.replay.frames);
    assert_eq!(baseline.owner_replays, run.owner_replays);
}

#[test]
fn accepted_but_superseded_squad_order_cannot_activate_route() {
    let (rules, mut attacker, defender, mut context, actor) = scenario();
    let selector = "argmin hero in filter hero in allies.heroes { hero.slot_id == \"slot-1\", } by hero.hp then hero.id";
    let source = format!("senkei conflicts {{ action a_winner {{ when true, do retreat({selector}), }}, action z_loser {{ when true, do move({selector}, \"A.TOP.T2\"), }} }}");
    attacker.program = compile(&source, &rules).unwrap().program;
    let baseline = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert!(baseline.diagnostics.events.iter().any(|event| matches!(&event.record,
        DiagnosticRecord::IntentAccepted { intent } if intent.action_id.as_str() == "z_loser")));
    let mut route = command(actor);
    route.action_id = "z_loser".into();
    context.next_route = Some(NextRouteMatch { policy: policy(&rules), commands: vec![route] });
    let run = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    assert_eq!(baseline.result.final_state_digest, run.result.final_state_digest);
    assert_eq!(baseline.owner_replays, run.owner_replays);
    assert!(!visited(&run).contains(&"A.BOT.T1".to_owned()));
}
