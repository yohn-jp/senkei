use enbu::{new_match_context, simulate, simulate_next_minion_behavior, NextMinionPreferenceSource};
use jinrei::{compile, Vm};
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

fn package() -> RulePackage {
    let mut package = senritsu::next_local_trial_package();
    // This fixture tests Minion declarations independently of the optional
    // Hero behavior-preference vocabulary bundled by the local trial package.
    for name in ["behavior_preference", "select_target"] {
        package.domain.capabilities.remove(&CapabilityId::from(name));
        package.arbitration.remove(&CapabilityId::from(name));
    }
    package.domain.symbol_domains.remove(&SymbolDomainId::from("behavior_domain"));
    let values = BTreeMap::from([
        (SymbolId::new("alpha"), MinionLane::Top),
        (SymbolId::new("beta"), MinionLane::Mid),
        (SymbolId::new("gamma"), MinionLane::Bot),
    ]);
    let variants: BTreeSet<_> = values.keys().cloned().collect();
    let scope = MinionControlScope::Lane { values };
    package.next.as_mut().unwrap().minion_control = Some(NextMinionControlDeclaration {
        schema_version: 1, version: Version::new(1, 0, 0), test_only: true,
        scope_resolution: MinionControlScopeResolution::LaneOverridesArmy,
        capabilities: BTreeMap::from([
            ("trial_army".into(), MinionControlCapability { scope: MinionControlScope::Army, candidate: MinionBehaviorCandidate::LaneWaypoint }),
            ("trial_lane".into(), MinionControlCapability { scope, candidate: MinionBehaviorCandidate::LaneWaypoint }),
        ]),
    });
    package.domain.symbol_domains.insert("fixture_lane".into(), variants.clone());
    let move_cap = package.domain.capabilities[&CapabilityId::from("move")].clone();
    for name in ["trial_army", "trial_lane"] {
        let arguments = if name == "trial_army" { Vec::new() } else {
            vec![ParameterSchema { id: "lane".into(), value_type: DomainType::Enum { domain: "fixture_lane".into(), values: variants.clone() }, optional: false }]
        };
        package.domain.capabilities.insert(name.into(), CapabilitySchema {
            arguments, actor_argument: None, target_argument: None, target_type: None,
            target_owner: TargetOwnerConstraint::Any, phases: move_cap.phases.clone(),
            preconditions: Vec::new(), issue_cost: move_cap.issue_cost.clone(),
        });
        package.arbitration.insert(name.into(), ArbitrationRule {
            conflict_keys: if name == "trial_army" { vec![IntentKey::Side] } else { vec![IntentKey::Side, IntentKey::Argument(0)] },
            resolution: ArbitrationResolution::RejectConflicts,
        });
    }
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    package
}
fn verified(package: RulePackage) -> VerifiedRulePlan {
    senritsu::validate(package, &senritsu::next_engine_compatibility()).unwrap_or_else(|issues| panic!("trial package should validate: {issues:?}"))
}
fn policy(rules: &VerifiedRulePlan) -> NextMinionBehaviorPolicy {
    NextMinionBehaviorPolicy { schema_version: 1, policy_id: "fixture".into(), version: Version::new(1, 0, 0),
        ruleset_digest: rules.package_digest().clone(), test_only: true, candidate: MinionBehaviorCandidate::LaneWaypoint }
}
fn inputs() -> NextMinionBehaviorExecutionInputs {
    NextMinionBehaviorExecutionInputs { schema_version: 1,
        army: BTreeMap::from([(CombatantSide::Attacker, MinionBehaviorCandidate::LaneWaypoint), (CombatantSide::Defender, MinionBehaviorCandidate::LaneWaypoint)]),
        lanes: BTreeMap::new() }
}
fn snapshot(rules: &VerifiedRulePlan, side: CombatantSide, source: &str) -> SenkeiSnapshot {
    let next = rules.plan().next.as_ref().unwrap();
    let base = match side { CombatantSide::Attacker => &next.map.attacker_base, CombatantSide::Defender => &next.map.defender_base };
    let heroes = next.heroes.iter().take(5).enumerate().map(|(index, hero)| DomainValue::Record(BTreeMap::from([
        ("slot_id".into(), DomainValue::String(format!("slot-{}", index + 1))),
        ("catalog_id".into(), DomainValue::String(hero.id.clone())),
        ("squad".into(), DomainValue::String("squad-0".into())),
        ("node".into(), DomainValue::String(base.clone())),
        ("skill_path".into(), DomainValue::String(hero.skill_paths.keys().next().unwrap().clone())),
    ]))).collect();
    SenkeiSnapshot { schema_version: rules.plan().model_version,
        id: ArtifactId::new(match side { CombatantSide::Attacker => "control-a", CombatantSide::Defender => "control-b" }),
        revision: "1".into(), ruleset: rules.ruleset().clone(),
        configuration: BTreeMap::from([("heroes".into(), DomainValue::List(heroes))]),
        program: compile(source, rules).unwrap().program, initial_memory: TacticalMemory::new() }
}
fn context(rules: &VerifiedRulePlan, bound: bool) -> MatchContext {
    let mut context = new_match_context(rules, "minion-control".into());
    context.max_ticks = 2;
    if bound { context.next_minion_control = Some(NextMinionControlMatch { schema_version: 1, ruleset_digest: rules.package_digest().clone() }); }
    context
}
fn has_notice(event: &DiagnosticEvent, code_name: &str, action: &str) -> bool {
    event.action_id.as_ref().is_some_and(|id| id.as_str() == action)
        && matches!(&event.record, DiagnosticRecord::RuntimeNotice { code, .. } if code.as_str() == code_name)
}

#[test]
fn real_jinrei_controls_declared_side_and_lane_with_tick_local_provenance() {
    let rules = verified(package());
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei control { action army_all { when match.tick == 1, do trial_army(), }, action lane_mid { when match.tick == 1, do trial_lane(beta), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei control { action lane_top { when match.tick == 1, do trial_lane(alpha), }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let inputs = inputs();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut Vm::new(&rules), &policy, &inputs).unwrap();
    let fallback = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, false), &mut Vm::new(&rules), &policy, &inputs).unwrap();
    assert_eq!(result.public_response().result.final_state_digest, fallback.public_response().result.final_state_digest);
    assert_eq!(result.public_response().replay.frames, fallback.public_response().replay.frames);
    assert_ne!(result.run_digest(), fallback.run_digest());
    let a = result.traces_for_owner(CombatantSide::Attacker);
    let b = result.traces_for_owner(CombatantSide::Defender);
    assert!(a.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.source == NextMinionPreferenceSource::Jinrei && trace.action_ids == [ActionId::from("lane_mid")]));
    assert!(a.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Top && trace.source == NextMinionPreferenceSource::Jinrei && trace.action_ids == [ActionId::from("army_all")]));
    assert!(b.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Top && trace.source == NextMinionPreferenceSource::Jinrei && trace.action_ids == [ActionId::from("lane_top")]));
    assert!(b.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.source == NextMinionPreferenceSource::Army && trace.action_ids.is_empty()));
    assert!(a.iter().chain(&b).filter(|trace| trace.tick == 2).all(|trace| trace.source == NextMinionPreferenceSource::Army && trace.action_ids.is_empty()));
    assert!(fallback.traces_for_owner(CombatantSide::Attacker).iter().all(|trace| trace.source == NextMinionPreferenceSource::Army));
    let diag = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    assert!(diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "army_all")));
    let committed = diag.events.iter().find(|event| has_notice(event, "enbu.minion_control_committed", "lane_mid")).unwrap();
    let DiagnosticRecord::RuntimeNotice { details, .. } = &committed.record else { unreachable!() };
    assert_eq!(committed.side, CombatantSide::Attacker);
    assert_eq!(committed.tick, 1);
    assert_eq!(details.get("capability").map(String::as_str), Some("trial_lane"));
    assert_eq!(details.get("scope").map(String::as_str), Some("lane"));
    assert_eq!(details.get("lane").map(String::as_str), Some("mid"));
    assert_eq!(details.get("candidate").map(String::as_str), Some("lane_waypoint"));
    assert!(!diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "lane_top")));
    assert!(diag.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentAccepted { intent } if intent.action_id.as_str() == "lane_mid" && intent.actor.is_none() && intent.target.is_none())));
    assert!(fallback.diagnostics_for_owner(CombatantSide::Attacker).diagnostics.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentRejected { intent, reason } if intent.action_id.as_str() == "lane_mid" && reason.as_str() == "enbu.minion_control_not_bound")));
    let replayed = result.reproduce(&rules, &mut Vm::new(&rules)).unwrap();
    assert_eq!(result.run_digest(), replayed.run_digest());
    assert_eq!(result.traces_for_owner(CombatantSide::Attacker), replayed.traces_for_owner(CombatantSide::Attacker));
    if let Some(path) = std::env::var_os("MINION_CONTROL_CONFORMANCE_FILE") {
        let reproduction = result.reproduction().0;
        let snapshot_digest = enbu::reproduction_snapshot_digest(
            &reproduction.attacker, &reproduction.defender, &reproduction.context,
        ).unwrap();
        assert_eq!(&snapshot_digest, result.run_digest());
        let rule_package = package();
        assert_eq!(&rule_package.ruleset.digest, rules.package_digest());
        let payload = ReproducePayload {
            assets: ReproductionAssets {
                format_version: REPRODUCTION_ASSETS_FORMAT_VERSION,
                rule_package,
                world_definition: serde_json::to_value(senritsu::next_world::builtin_world_definition()).unwrap(),
                catalog_metadata_extension: None,
            },
            snapshot: ReproductionSnapshot {
                attacker: reproduction.attacker.clone(),
                defender: reproduction.defender.clone(),
                context: reproduction.context.clone(),
            },
            snapshot_digest,
            include_diagnostics: true,
            diagnostics_side: Some(CombatantSide::Attacker),
        };
        let request = ApiRequestEnvelope {
            api_version: WASM_API_VERSION,
            request_id: "minion-control-conformance".into(),
            operation: OP_REPRODUCE.into(),
            payload,
        };
        std::fs::write(path, serde_json::to_vec(&request).unwrap())
            .expect("write the explicitly requested Minion control conformance fixture");
    }
}

#[test]
fn conflicting_same_lane_orders_do_not_cross_sides() {
    let rules = verified(package());
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei conflict { action p1 { when match.tick == 1, do trial_lane(beta), }, action p2 { when match.tick == 1, do trial_lane(beta), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei control { action enemy { when match.tick == 1, do trial_lane(beta), }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut Vm::new(&rules), &policy, &inputs()).unwrap();
    let ad = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    assert_eq!(ad.events.iter().filter(|event| matches!(&event.record, DiagnosticRecord::IntentRejected { intent, reason } if intent.capability.as_str() == "trial_lane" && reason.as_str() == "enbu.arbitration_rejected")).count(), 2);
    assert!(result.traces_for_owner(CombatantSide::Attacker).iter().all(|trace| trace.source == NextMinionPreferenceSource::Army));
    assert!(result.traces_for_owner(CombatantSide::Defender).iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.source == NextMinionPreferenceSource::Jinrei && trace.action_ids == [ActionId::from("enemy")]));
}

#[test]
fn invalid_declarations_and_binding_fail_closed() {
    let original = package();
    let declaration = original.next.as_ref().unwrap().minion_control.as_ref().unwrap();
    let mut missing_order = serde_json::to_value(declaration).unwrap();
    missing_order.as_object_mut().unwrap().remove("scope_resolution");
    assert!(serde_json::from_value::<NextMinionControlDeclaration>(missing_order).is_err());
    let mut unsupported_order = serde_json::to_value(declaration).unwrap();
    unsupported_order["scope_resolution"] = "army_overrides_lane".into();
    assert!(serde_json::from_value::<NextMinionControlDeclaration>(unsupported_order).is_err());
    let mut bad = original.clone(); bad.next.as_mut().unwrap().minion_control.as_mut().unwrap().test_only = false;
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err());
    let mut without_asset_projection = original.clone(); without_asset_projection.next.as_mut().unwrap().projection_policy = None;
    without_asset_projection.ruleset.digest = senritsu::canonical_digest(&without_asset_projection).unwrap();
    verified(without_asset_projection);
    let mut bad = original.clone(); bad.arbitration.get_mut(&CapabilityId::from("trial_lane")).unwrap().conflict_keys = vec![IntentKey::Argument(0)];
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err());
    let mut bad = original.clone(); bad.domain.capabilities.get_mut(&CapabilityId::from("trial_lane")).unwrap().actor_argument = Some(0);
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err());
    let mut bad = original.clone();
    let MinionControlScope::Lane { values } = &mut bad.next.as_mut().unwrap().minion_control.as_mut().unwrap().capabilities.get_mut(&CapabilityId::from("trial_lane")).unwrap().scope else { unreachable!() };
    values.insert("alpha".into(), MinionLane::Mid);
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err());
    let mut bad = original.clone();
    let alias_binding = bad.next.as_ref().unwrap().minion_control.as_ref().unwrap().capabilities[&CapabilityId::from("trial_lane")].clone();
    bad.next.as_mut().unwrap().minion_control.as_mut().unwrap().capabilities.insert("select_target".into(), alias_binding);
    bad.domain.capabilities.insert("select_target".into(), bad.domain.capabilities[&CapabilityId::from("trial_lane")].clone());
    bad.arbitration.insert("select_target".into(), bad.arbitration[&CapabilityId::from("trial_lane")].clone());
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err(), "provider cannot impersonate an optional runtime capability");
    let mut bad = original.clone();
    bad.arbitration.get_mut(&CapabilityId::from("trial_lane")).unwrap().resolution = ArbitrationResolution::AllowAll { max_accepted: 6 };
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err());
    let mut bad = original.clone();
    bad.arbitration.get_mut(&CapabilityId::from("trial_lane")).unwrap().resolution = ArbitrationResolution::SelectOrdered {
        sort_by: vec![IntentSortTerm { key: IntentKey::Priority, direction: SortDirection::Descending }], max_accepted: 6,
    };
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err(), "ordered conflicts require an action ID tie-break");
    let mut bad = original.clone();
    bad.arbitration.get_mut(&CapabilityId::from("trial_lane")).unwrap().resolution = ArbitrationResolution::SelectOrdered {
        sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending }], max_accepted: 1,
    };
    bad.ruleset.digest = senritsu::canonical_digest(&bad).unwrap();
    assert!(senritsu::validate(bad, &senritsu::next_engine_compatibility()).is_err(), "global cap must accommodate independent side and lane groups");
    let rules = verified(original);
    assert!(compile("senkei x { action x { when true, do trial_lane(unknown_lane), }, }", &rules).is_err());
    assert!(compile("senkei x { action x { when true, do trial_army(\"defender\"), }, }", &rules).is_err());
    let mut context = context(&rules, true);
    context.next_minion_control.as_mut().unwrap().ruleset_digest = ContentDigest::new("incorrect");
    let a = snapshot(&rules, CombatantSide::Attacker, "senkei idle { state inert { false, }, }");
    let b = snapshot(&rules, CombatantSide::Defender, "senkei idle { state inert { false, }, }");
    assert!(simulate(&a, &b, &rules, &context, &mut Vm::new(&rules)).is_err());
}

#[test]
fn forged_individual_actor_is_rejected_even_if_owned() {
    struct ForgeActor(Vm);
    impl TacticalExecutionPort for ForgeActor {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            let side = request.side;
            let owned_hero = match request.observation.collections.get(&"allies.heroes".into()) {
                Some(Observed::Known(heroes)) => heroes.first().map(|hero| hero.id.clone()),
                _ => None,
            };
            let mut output = self.0.execute(request)?;
            if side == CombatantSide::Attacker {
                for intent in &mut output.intents {
                    if intent.capability.as_str() == "trial_lane" { intent.actor = owned_hero.clone(); }
                }
            }
            Ok(output)
        }
    }
    let rules = verified(package());
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei control { action forged { when match.tick == 1, do trial_lane(beta), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei idle { state inert { false, }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut ForgeActor(Vm::new(&rules)), &policy, &inputs()).unwrap();
    let diag = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    assert!(diag.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentRejected { intent, reason }
        if intent.action_id.as_str() == "forged" && reason.as_str() == "enbu.minion_control_individual_actor")));
    assert!(!diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "forged")));
    assert!(result.traces_for_owner(CombatantSide::Attacker).iter().all(|trace| trace.source == NextMinionPreferenceSource::Army));
}

#[test]
fn distinct_lanes_and_equal_cross_capability_choices_are_kept_separate() {
    let mut package = package();
    let second_binding = package.next.as_ref().unwrap().minion_control.as_ref().unwrap().capabilities[&CapabilityId::from("trial_lane")].clone();
    package.next.as_mut().unwrap().minion_control.as_mut().unwrap().capabilities.insert("fixture_alias".into(), second_binding);
    let second_capability = package.domain.capabilities[&CapabilityId::from("trial_lane")].clone();
    let second_order = package.arbitration[&CapabilityId::from("trial_lane")].clone();
    package.domain.capabilities.insert("fixture_alias".into(), second_capability);
    package.arbitration.insert("fixture_alias".into(), second_order);
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let rules = verified(package);
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei choices { action mid_a { when match.tick == 1, do trial_lane(beta), }, action mid_b { when match.tick == 1, do fixture_alias(beta), }, action bot { when match.tick == 1, do trial_lane(gamma), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei idle { state inert { false, }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut Vm::new(&rules), &policy, &inputs()).unwrap();
    let traces = result.traces_for_owner(CombatantSide::Attacker);
    assert!(traces.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.action_ids == [ActionId::from("mid_a"), ActionId::from("mid_b")]));
    assert!(traces.iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Bot && trace.action_ids == [ActionId::from("bot")]));
    let diag = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    for action in ["mid_a", "mid_b", "bot"] {
        assert!(diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", action)));
    }
    assert!(diag.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::RuntimeNotice { code, details }
        if code.as_str() == "enbu.minion_lane_decision" && details.get("source").map(String::as_str) == Some("jinrei")
        && details.get("lane").map(String::as_str) == Some("mid")
        && details.get("action_ids").and_then(|ids| serde_json::from_str::<Vec<String>>(ids).ok()) == Some(vec!["mid_a".to_owned(), "mid_b".to_owned()]))));
}

#[test]
fn declared_order_selects_one_intent_per_side_and_lane() {
    let mut package = package();
    package.arbitration.get_mut(&CapabilityId::from("trial_lane")).unwrap().resolution = ArbitrationResolution::SelectOrdered {
        sort_by: vec![IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Descending }],
        max_accepted: 6,
    };
    package.ruleset.digest = senritsu::canonical_digest(&package).unwrap();
    let rules = verified(package);
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei choices { action p1 { when match.tick == 1, do trial_lane(beta), }, action p2 { when match.tick == 1, do trial_lane(beta), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei choice { action enemy { when match.tick == 1, do trial_lane(beta), }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut Vm::new(&rules), &policy, &inputs()).unwrap();
    assert!(result.traces_for_owner(CombatantSide::Attacker).iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.action_ids == [ActionId::from("p2")]));
    assert!(result.traces_for_owner(CombatantSide::Defender).iter().any(|trace| trace.tick == 1 && trace.lane == MinionLane::Mid && trace.action_ids == [ActionId::from("enemy")]));
    let diag = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    assert!(diag.events.iter().any(|event| matches!(&event.record, DiagnosticRecord::IntentRejected { intent, reason } if intent.action_id.as_str() == "p1" && reason.as_str() == "enbu.arbitration_rejected")));
    assert!(diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "p2")));
    assert!(!diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "p1")));
}

#[test]
fn duplicate_action_identity_cannot_be_committed_across_capabilities() {
    struct DuplicateAction(Vm);
    impl TacticalExecutionPort for DuplicateAction {
        fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
            let side = request.side;
            let mut output = self.0.execute(request)?;
            if side == CombatantSide::Attacker {
                if let Some(original) = output.intents.first().cloned() {
                    let mut forged = original;
                    forged.capability = "trial_army".into();
                    forged.arguments.clear();
                    output.intents.push(forged);
                }
            }
            Ok(output)
        }
    }
    let rules = verified(package());
    let attacker = snapshot(&rules, CombatantSide::Attacker, "senkei control { action choose { when match.tick == 1, do trial_lane(beta), }, }");
    let defender = snapshot(&rules, CombatantSide::Defender, "senkei idle { state inert { false, }, }");
    let policy = senritsu::validate_next_minion_behavior_policy(policy(&rules), &rules).unwrap();
    let result = simulate_next_minion_behavior(&attacker, &defender, &rules, &context(&rules, true), &mut DuplicateAction(Vm::new(&rules)), &policy, &inputs()).unwrap();
    let diag = result.diagnostics_for_owner(CombatantSide::Attacker).diagnostics;
    assert_eq!(diag.events.iter().filter(|event| matches!(&event.record, DiagnosticRecord::IntentRejected { intent, reason }
        if intent.action_id.as_str() == "choose" && reason.as_str() == "enbu.minion_control_duplicate_action")).count(), 2);
    assert!(!diag.events.iter().any(|event| has_notice(event, "enbu.minion_control_committed", "choose")));
    assert!(result.traces_for_owner(CombatantSide::Attacker).iter().all(|trace| trace.source == NextMinionPreferenceSource::Army));
}
