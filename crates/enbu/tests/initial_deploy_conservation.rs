use enbu::{new_match_context, simulate};
use senkei_model::*;
use std::collections::BTreeMap;

struct TwoSameProducerDeploys {
    barracks: EntityId,
    reserves: [EntityId; 2],
}

impl TacticalExecutionPort for TwoSameProducerDeploys {
    fn execute(&mut self, request: TacticalExecutionRequest<'_>) -> Result<TacticalExecutionOutput, TacticalExecutionError> {
        let intents = if request.side == CombatantSide::Attacker && (request.tick == 8 || request.tick == 9) {
            ["mid", "bot"].iter().enumerate()
                // Tick 9 probes that the rejected second reserve cannot spend a nonexistent credit.
                .filter(|(index, _)| request.tick == 8 || *index == 1)
                .map(|(index, lane)| Intent {
                action_id: ActionId::new(format!("deploy-{index}")),
                capability: CapabilityId::new("deploy"),
                actor: Some(self.barracks.clone()),
                target: Some(self.reserves[index].clone()),
                arguments: vec![
                    DomainValue::Entity(self.barracks.clone()),
                    DomainValue::Entity(self.reserves[index].clone()),
                    DomainValue::Enum(SymbolId::new(*lane)),
                ],
                priority: None,
            }).collect()
        } else {
            Vec::new()
        };
        Ok(TacticalExecutionOutput {
            status: TacticalExecutionStatus::Completed,
            intents,
            next_memory: request.memory.clone(),
            charged_cu: LogicalCu::ZERO,
            required_cu: LogicalCu::ZERO,
            diagnostics: Vec::new(),
        })
    }
}

#[test]
fn initial_single_credit_cannot_deploy_two_reserves_from_one_barracks() {
    let rules = senritsu::validate(
        senritsu::initial_package(),
        &senritsu::initial_engine_compatibility(),
    ).expect("canonical initial rules");
    let program = jinrei::compile(
        "senkei idle { state inert { false, }, }",
        &rules,
    ).expect("idle tactical program").program;
    let snapshot = |name: &str, credits: i64| SenkeiSnapshot {
        schema_version: rules.plan().model_version,
        id: ArtifactId::new(name),
        revision: RevisionId::new("1"),
        ruleset: rules.ruleset().clone(),
        configuration: BTreeMap::from([(
            FieldId::new("starting_credits"),
            DomainValue::Integer(credits),
        )]),
        program: program.clone(),
        initial_memory: TacticalMemory::new(),
    };
    let entity_id = |projection: &str, kind: &str, key: &str| {
        derive_projected_entity_id(
            rules.package_digest(),
            &ProjectionId::new(projection),
            &TypeId::new(kind),
            Some(CombatantSide::Attacker),
            &DomainValue::String(key.into()),
        ).expect("projected initial actor")
    };
    let mut port = TwoSameProducerDeploys {
        barracks: entity_id("barracks", "barracks", "barracks"),
        reserves: [
            entity_id("unit_roster", "unit", "reserve-medic-mid"),
            entity_id("unit_roster", "unit", "reserve-infantry-bot"),
        ],
    };
    let mut context = new_match_context(&rules, MatchId::new("initial-deploy-conservation"));
    context.max_ticks = 9;
    let result = simulate(
        &snapshot("attacker", 1),
        &snapshot("defender", 1),
        &rules,
        &context,
        &mut port,
    ).expect("real initial Enbu runner");
    let deployed = result.replay.frames[8].events.iter()
        .filter(|event| event.event.as_str() == "unit_deployed")
        .count();
    assert_eq!(deployed, 1, "one credit must admit only one deploy per barracks and Tick");
    assert_eq!(
        result.replay.frames[9].events.iter().filter(|event| event.event.as_str() == "unit_deployed").count(),
        0,
        "the following Tick must not deploy a second reserve with exhausted credits",
    );
    let diagnostics = &result.diagnostics.events;
    let accepted = diagnostics.iter().filter(|event| {
        event.tick == 8 && matches!(&event.record,
            DiagnosticRecord::IntentAccepted { intent } if intent.capability.as_str() == "deploy")
    }).count();
    assert_eq!(accepted, 1, "the other same-producer deployment must be rejected");
    assert_eq!(
        diagnostics.iter().filter(|event| event.tick == 9 && matches!(&event.record,
            DiagnosticRecord::IntentRejected { intent, .. } if intent.capability.as_str() == "deploy"
        )).count(),
        1,
        "a later deployment must be denied after the only credit is consumed",
    );
}
