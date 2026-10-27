use enbu::{new_match_context, preflight, simulate, simulate_next_minion_behavior, NextMinionPreferenceSource, NextMinionWaypoint};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};
use sha2::{Digest, Sha256};

fn rules() -> VerifiedRulePlan {
    senritsu::validate(senritsu::next_package(), &senritsu::next_engine_compatibility()).unwrap()
}

fn policy(rules: &VerifiedRulePlan) -> NextMinionBehaviorPolicy {
    NextMinionBehaviorPolicy {
        schema_version: 1,
        policy_id: "test-lane-waypoint".into(),
        version: Version::new(1, 0, 0),
        ruleset_digest: rules.package_digest().clone(),
        test_only: true,
        candidate: MinionBehaviorCandidate::LaneWaypoint,
    }
}

fn snapshot(rules: &VerifiedRulePlan, side: CombatantSide) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().unwrap();
    let base = match side { CombatantSide::Attacker => &next.map.attacker_base, CombatantSide::Defender => &next.map.defender_base };
    let heroes = next.heroes.iter().take(5).enumerate().map(|(index, hero)| {
        DomainValue::Record(BTreeMap::from([
            ("slot_id".into(), DomainValue::String(format!("slot-{}", index + 1))),
            ("catalog_id".into(), DomainValue::String(hero.id.clone())),
            ("squad".into(), DomainValue::String("squad-0".into())),
            ("node".into(), DomainValue::String(base.clone())),
            ("skill_path".into(), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
        ]))
    }).collect();
    SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(match side { CombatantSide::Attacker => "minion-a", CombatantSide::Defender => "minion-b" }),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration: BTreeMap::from([("heroes".into(), DomainValue::List(heroes))]),
        program: compile("senkei idle { state inert { false, }, }", rules).unwrap().program,
        initial_memory: TacticalMemory::new(),
    }
}

fn inputs() -> NextMinionBehaviorExecutionInputs {
    let candidate = MinionBehaviorCandidate::LaneWaypoint;
    NextMinionBehaviorExecutionInputs {
        schema_version: 1,
        army: BTreeMap::from([(CombatantSide::Attacker, candidate)]),
        lanes: BTreeMap::from([
            (CombatantSide::Attacker, BTreeMap::from([(MinionLane::Mid, candidate)])),
            (CombatantSide::Defender, BTreeMap::from([(MinionLane::Bot, candidate)])),
        ]),
    }
}

#[test]
fn real_match_scope_trace_and_reproduction_preserve_automatic_march() {
    let rules = rules();
    let attacker = snapshot(&rules, CombatantSide::Attacker);
    let defender = snapshot(&rules, CombatantSide::Defender);
    let mut context = new_match_context(&rules, MatchId::new("minion-scope"));
    context.max_ticks = 31;
    let policy = policy(&rules);
    let verified = senritsu::validate_next_minion_behavior_policy(policy.clone(), &rules).unwrap();
    let inputs = inputs();
    // Independent expected wire bytes: outer and nested object keys are sorted.
    let canonical = format!(
        "{{\"candidate\":\"lane_waypoint\",\"policy_id\":\"test-lane-waypoint\",\"ruleset_digest\":\"{}\",\"schema_version\":1,\"test_only\":true,\"version\":{{\"major\":1,\"minor\":0,\"patch\":0}}}}",
        rules.package_digest(),
    );
    let expected_policy_digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    assert_eq!(verified.digest().to_string(), expected_policy_digest);

    let normal = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let selected = simulate_next_minion_behavior(&attacker, &defender, &rules, &context, &mut Vm::new(&rules), &verified, &inputs).unwrap();
    let mut frozen = context.clone();
    frozen.next_minion_behavior = Some(NextMinionBehaviorMatch { policy: policy.clone(), inputs: inputs.clone() });
    preflight(&attacker, &defender, &rules, &frozen).unwrap();
    let standard = simulate(&attacker, &defender, &rules, &frozen, &mut Vm::new(&rules)).unwrap();
    assert_eq!(selected.public_response(), standard.public_response());
    assert_eq!(selected.run_digest(), &standard.diagnostic_snapshot_digest);
    assert_eq!(normal.result.final_state_digest, standard.result.final_state_digest);
    assert_eq!(normal.replay.frames, standard.replay.frames);
    assert_eq!(normal.owner_replays, standard.owner_replays);
    assert_ne!(normal.diagnostic_snapshot_digest, standard.diagnostic_snapshot_digest);
    assert_eq!(selected.reproduction().0.context.next_minion_behavior, frozen.next_minion_behavior);
    let replayed = selected.reproduce(&rules, &mut Vm::new(&rules)).unwrap();
    assert_eq!(selected.run_digest(), replayed.run_digest());
    assert_eq!(selected.public_response(), replayed.public_response());
    assert_eq!(selected.traces_for_owner(CombatantSide::Attacker), replayed.traces_for_owner(CombatantSide::Attacker));

    let attacker_traces = selected.traces_for_owner(CombatantSide::Attacker);
    let defender_traces = selected.traces_for_owner(CombatantSide::Defender);
    assert!(!attacker_traces.is_empty() && !defender_traces.is_empty());
    assert!(attacker_traces.iter().all(|trace| trace.side == CombatantSide::Attacker && trace.actor.as_str().starts_with("visible-")));
    assert!(defender_traces.iter().all(|trace| trace.side == CombatantSide::Defender && trace.actor.as_str().starts_with("visible-") && trace.lane == MinionLane::Bot && trace.source == NextMinionPreferenceSource::Lane));
    assert!(attacker_traces.iter().any(|trace| trace.lane == MinionLane::Mid && trace.source == NextMinionPreferenceSource::Lane));
    assert!(attacker_traces.iter().any(|trace| trace.lane == MinionLane::Top && trace.source == NextMinionPreferenceSource::Army));
    assert!(attacker_traces.iter().any(|trace| matches!(&trace.waypoint, NextMinionWaypoint::Ready { .. })));
    assert!(attacker_traces.iter().any(|trace| matches!(&trace.waypoint, NextMinionWaypoint::InTransit)));
    let previous: BTreeSet<_> = attacker_traces.iter().filter(|trace| trace.tick == 29).map(|trace| &trace.actor).collect();
    assert!(attacker_traces.iter().any(|trace| trace.tick == 30 && !previous.contains(&trace.actor)), "reinforcement waves keep automatic candidate evaluation");
    assert!(!serde_json::to_string(&selected.public_response()).unwrap().contains("test-lane-waypoint"));
    for (side, traces) in [(CombatantSide::Attacker, &attacker_traces), (CombatantSide::Defender, &defender_traces)] {
        let owner = standard.diagnostic_response(side).diagnostics.unwrap();
        assert_eq!(owner, selected.diagnostics_for_owner(side).diagnostics);
        assert_eq!(owner.identity.side, side);
        assert_eq!(owner.identity.snapshot_digest, standard.diagnostic_snapshot_digest);
        assert!(owner.events.iter().all(|event| event.side == side));
        let notices: Vec<_> = owner.events.iter().filter(|event| matches!(&event.record,
            DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == "enbu.minion_lane_decision"
        )).collect();
        assert_eq!(notices.len(), traces.len());
        for trace in traces {
            let frame = standard.owner_replays[&side].frames.iter().find(|frame| frame.tick == trace.tick).unwrap();
            let entity = frame.visible_state.as_ref().unwrap().entities.get(&trace.actor).expect("trace actor must be in the same owner's replay frame");
            assert_eq!(entity.entity_type.as_str(), "minion");
            assert_eq!(entity.owner, Some(side));
            assert_eq!(entity.fields.get(&"lane".into()), Some(&DomainValue::String(trace.lane.as_str().into())));
            let matches: Vec<_> = notices.iter().filter(|event| event.tick == trace.tick && event.entity_id.as_ref() == Some(&trace.actor)).collect();
            assert_eq!(matches.len(), 1, "each projected trace has exactly one owner notice");
            let DiagnosticRecord::RuntimeNotice { details, .. } = &matches[0].record else { unreachable!() };
            assert_eq!(details.get("identity_space").map(String::as_str), Some("owner_replay"));
            assert_eq!(details.get("next_policy_id").map(String::as_str), Some(policy.policy_id.as_str()));
            assert_eq!(details.get("next_policy_digest"), Some(&expected_policy_digest));
            assert_eq!(details.get("lane").map(String::as_str), Some(trace.lane.as_str()));
            assert_eq!(details.get("candidate").map(String::as_str), Some("lane_waypoint"));
            assert_eq!(details.get("source").map(String::as_str), Some(match trace.source {
                NextMinionPreferenceSource::Army => "army", NextMinionPreferenceSource::Lane => "lane",
            }));
            let (status, waypoint) = match &trace.waypoint {
                NextMinionWaypoint::Ready { node } => ("ready", Some(node.as_str())),
                NextMinionWaypoint::InTransit => ("in_transit", None),
                NextMinionWaypoint::EndOfLane => ("end_of_lane", None),
                NextMinionWaypoint::Unknown => ("unknown", None),
            };
            assert_eq!(details.get("status").map(String::as_str), Some(status));
            assert_eq!(details.get("waypoint").map(String::as_str), waypoint);
        }
    }
    assert!(normal.diagnostics.events.iter().all(|event| !matches!(&event.record,
        DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == "enbu.minion_lane_decision"
    )));
    let mut saw_center = false;
    for frame in &standard.owner_replays[&CombatantSide::Attacker].frames {
        if let Some(view) = &frame.visible_state {
            for entity in view.entities.values().filter(|entity| entity.owner == Some(CombatantSide::Attacker) && entity.entity_type.as_str() == "minion") {
                if let Some(DomainValue::String(track)) = entity.fields.get(&"track".into()) {
                    assert!(track.is_empty() || track == "CENTER", "automatic minion movement must remain CENTER");
                    saw_center |= track == "CENTER";
                }
            }
        }
    }
    assert!(saw_center, "the real match must exercise CENTER movement");
}

#[test]
fn malformed_or_unapproved_policy_and_scopes_are_rejected() {
    let rules = rules();
    let original = policy(&rules);
    let mut bad = original.clone();
    bad.test_only = false;
    assert!(senritsu::validate_next_minion_behavior_policy(bad, &rules).is_err());
    let mut bad = original.clone();
    bad.ruleset_digest = ContentDigest::new("wrong");
    assert!(senritsu::validate_next_minion_behavior_policy(bad, &rules).is_err());
    let mut bad = original.clone();
    bad.schema_version = 2;
    assert!(senritsu::validate_next_minion_behavior_policy(bad, &rules).is_err());
    let mut bad = original.clone();
    bad.version = Version::new(0, 0, 0);
    assert!(senritsu::validate_next_minion_behavior_policy(bad, &rules).is_err());
    let mut json = serde_json::to_value(&original).unwrap();
    json["candidate"] = "move".into();
    assert!(serde_json::from_value::<NextMinionBehaviorPolicy>(json).is_err());
    for json in [
        serde_json::json!({"schema_version":1,"army":{},"lanes":{"attacker":{"jungle":"lane_waypoint"}}}),
        serde_json::json!({"schema_version":1,"army":{"spectator":"lane_waypoint"},"lanes":{}}),
        serde_json::json!({"schema_version":1,"army":{},"lanes":{},"actor":"minion:attacker:mid:0:0"}),
        serde_json::json!({"schema_version":1,"army":{},"lanes":{},"heroes":{"attacker":"lane_waypoint"}}),
    ] {
        assert!(serde_json::from_value::<NextMinionBehaviorExecutionInputs>(json).is_err());
    }

    let attacker = snapshot(&rules, CombatantSide::Attacker);
    let defender = snapshot(&rules, CombatantSide::Defender);
    let context = new_match_context(&rules, MatchId::new("bad-minion-input"));
    let verified = senritsu::validate_next_minion_behavior_policy(original.clone(), &rules).unwrap();
    let mut invalid = inputs();
    invalid.schema_version = 2;
    assert!(simulate_next_minion_behavior(&attacker, &defender, &rules, &context, &mut Vm::new(&rules), &verified, &invalid).is_err());
    let mut frozen = context.clone();
    frozen.next_minion_behavior = Some(NextMinionBehaviorMatch { policy: original.clone(), inputs: invalid });
    assert!(preflight(&attacker, &defender, &rules, &frozen).is_err());
    assert!(simulate(&attacker, &defender, &rules, &frozen, &mut Vm::new(&rules)).is_err());
    frozen.next_minion_behavior = Some(NextMinionBehaviorMatch { policy: original, inputs: inputs() });
    assert!(simulate_next_minion_behavior(&attacker, &defender, &rules, &frozen, &mut Vm::new(&rules), &verified, &NextMinionBehaviorExecutionInputs { schema_version: 1, ..Default::default() }).is_err());
}

#[test]
fn hero_and_minion_policies_coexist_and_old_context_shape_is_unchanged() {
    let rules = rules();
    let attacker = snapshot(&rules, CombatantSide::Attacker);
    let defender = snapshot(&rules, CombatantSide::Defender);
    let mut context = new_match_context(&rules, MatchId::new("minion-hero-coexist"));
    context.max_ticks = 1;
    let legacy = serde_json::to_value(&context).unwrap();
    assert!(legacy.get("next_minion_behavior").is_none());
    assert_eq!(serde_json::from_value::<MatchContext>(legacy).unwrap(), context);

    let term = BehaviorScoreTerm { signal: BehaviorSignal::Constant, weight: 1 };
    let hero = NextBehaviorPolicy {
        schema_version: 1,
        policy_id: "test-hero".into(),
        version: Version::new(1, 0, 0),
        ruleset_digest: rules.package_digest().clone(),
        test_only: true,
        composition: BehaviorComposition {
            hero_aggregation: BehaviorHeroAggregation::MeanFloor,
            override_order: BehaviorOverrideOrder::ArmyThenSquad,
            action_order: BehaviorActionOrder::ScoreDescThenActionIdAsc,
            targeting_profile: BehaviorTargetingProfile::TargetHealthWeight,
        },
        hero_defaults: rules.plan().next.as_ref().unwrap().heroes.iter()
            .map(|hero| (hero.id.clone(), NextBehaviorProfile::default())).collect(),
        domains: BehaviorDomains {
            navigation: vec![term.clone()], engagement: vec![term.clone()],
            targeting: vec![term.clone()], pursuit: vec![term.clone()],
            survival: vec![term.clone()], objective: vec![term],
        },
        candidates: vec![BehaviorCandidateDefinition {
            kind: BehaviorCandidateKind::Move, capability: "move".into(),
            arguments: vec![BehaviorArgument::Actor, BehaviorArgument::ObjectiveNode],
        }],
    };
    let hero_inputs = NextBehaviorExecutionInputs { schema_version: 1, ..Default::default() };
    let hero_verified = senritsu::validate_next_behavior_policy(hero.clone(), &rules).unwrap();
    let minion = policy(&rules);
    let minion_inputs = inputs();
    let minion_verified = senritsu::validate_next_minion_behavior_policy(minion.clone(), &rules).unwrap();
    context.next_behavior = Some(NextBehaviorMatch { policy: hero, inputs: hero_inputs.clone() });
    context.next_minion_behavior = Some(NextMinionBehaviorMatch { policy: minion, inputs: minion_inputs.clone() });
    let standard = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let hero_run = enbu::simulate_next_behavior(&attacker, &defender, &rules, &context, &mut Vm::new(&rules), &hero_verified, &hero_inputs).unwrap();
    let minion_run = simulate_next_minion_behavior(&attacker, &defender, &rules, &context, &mut Vm::new(&rules), &minion_verified, &minion_inputs).unwrap();
    assert_eq!(hero_run.public_response(), standard.public_response());
    assert_eq!(minion_run.public_response(), standard.public_response());
    assert_eq!(hero_run.run_digest(), &standard.diagnostic_snapshot_digest);
    assert_eq!(minion_run.run_digest(), &standard.diagnostic_snapshot_digest);
    assert!(!hero_run.traces_for_owner(CombatantSide::Attacker).is_empty());
    assert!(!minion_run.traces_for_owner(CombatantSide::Attacker).is_empty());

    let mut capped = context;
    capped.host_limits.max_diagnostic_events = 1;
    assert!(simulate(&attacker, &defender, &rules, &capped, &mut Vm::new(&rules)).is_err());
}

#[test]
fn removed_minion_has_no_later_owner_trace_or_notice() {
    let rules = rules();
    let attacker = snapshot(&rules, CombatantSide::Attacker);
    let defender = snapshot(&rules, CombatantSide::Defender);
    let mut context = new_match_context(&rules, MatchId::new("minion-disappeared"));
    context.max_ticks = 2;
    let next = rules.plan().next.as_ref().unwrap();
    let base = &next.map.defender_base;
    let position = &next.map.nodes[base];
    // This one-HP attacker starts on the opposing base with a valid lane. The
    // defenders kill it in the first combat phase; lifecycle removes it next tick.
    context.initial_world.entities.insert("fixture-fallen-minion".into(), EntityState {
        entity_type: "minion".into(),
        owner: Some(CombatantSide::Attacker),
        fields: BTreeMap::from([
            ("hp".into(), DomainValue::Integer(1)),
            ("max_hp".into(), DomainValue::Integer(1)),
            ("attack".into(), DomainValue::Integer(0)),
            ("defense".into(), DomainValue::Integer(0)),
            ("speed".into(), DomainValue::Integer(0)),
            ("range".into(), DomainValue::Integer(0)),
            ("attack_interval".into(), DomainValue::Integer(1)),
            ("vision".into(), DomainValue::Integer(0)),
            ("attack_ready".into(), DomainValue::Integer(0)),
            ("x".into(), DomainValue::Integer(position.x)),
            ("y".into(), DomainValue::Integer(position.y)),
            ("edge_progress".into(), DomainValue::Integer(0)),
            ("node".into(), DomainValue::String(base.clone())),
            ("edge_to".into(), DomainValue::String(String::new())),
            ("goal".into(), DomainValue::String(base.clone())),
            ("lane".into(), DomainValue::String("bot".into())),
            ("catalog_id".into(), DomainValue::String("fixture-fallen-minion".into())),
        ]),
    });
    let minion = policy(&rules);
    let minion_inputs = inputs();
    let verified = senritsu::validate_next_minion_behavior_policy(minion.clone(), &rules).unwrap();
    context.next_minion_behavior = Some(NextMinionBehaviorMatch { policy: minion, inputs: minion_inputs.clone() });
    let standard = simulate(&attacker, &defender, &rules, &context, &mut Vm::new(&rules)).unwrap();
    let selected = simulate_next_minion_behavior(&attacker, &defender, &rules, &context, &mut Vm::new(&rules), &verified, &minion_inputs).unwrap();
    let frames = &standard.owner_replays[&CombatantSide::Attacker].frames;
    let initial = frames.iter().find(|frame| frame.tick == 0).unwrap().visible_state.as_ref().unwrap();
    let actor = initial.entities.iter().find_map(|(id, entity)|
        (entity.fields.get(&"catalog_id".into()) == Some(&DomainValue::String("fixture-fallen-minion".into()))).then(|| id.clone())
    ).expect("fixture appears in the owner's initial frame");
    assert!(actor.as_str().starts_with("visible-"));
    let after_combat = frames.iter().find(|frame| frame.tick == 1).unwrap().visible_state.as_ref().unwrap();
    assert_eq!(after_combat.entities[&actor].fields.get(&"hp".into()), Some(&DomainValue::Integer(0)));
    let after_removal = frames.iter().find(|frame| frame.tick == 2).unwrap().visible_state.as_ref().unwrap();
    assert!(!after_removal.entities.contains_key(&actor));
    let traces = selected.traces_for_owner(CombatantSide::Attacker);
    assert!(traces.iter().any(|trace| trace.tick == 1 && trace.actor == actor));
    assert!(!traces.iter().any(|trace| trace.tick >= 2 && trace.actor == actor));
    let events = &standard.diagnostic_response(CombatantSide::Attacker).diagnostics.unwrap().events;
    assert!(events.iter().any(|event| event.tick == 1 && event.entity_id.as_ref() == Some(&actor) && matches!(&event.record,
        DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == "enbu.minion_lane_decision")));
    assert!(!events.iter().any(|event| event.tick >= 2 && event.entity_id.as_ref() == Some(&actor) && matches!(&event.record,
        DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == "enbu.minion_lane_decision")));
}
