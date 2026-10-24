use senkei_model::{
    derive_invocation_entity_id, derive_projected_entity_id, ApiError, ApiErrorCode,
    CombatantSide, ContentDigest, DomainValue, EntityId, LogicalCu, MatchId, Observed,
    ProjectionId, RuleExpression, RuleId, StructuredTacticsAst, TacticalCapabilityCall,
    TacticalDeclaration, TacticalPredicate, TypeId, Version,
};
use std::collections::BTreeMap;

#[test]
fn domain_value_wire_tags_are_stable() {
    let value = DomainValue::Integer(4);
    assert_eq!(serde_json::to_string(&value).unwrap(), r#"{"kind":"integer","value":4}"#);
    assert_eq!(
        serde_json::to_string(&DomainValue::Fixed { coefficient: 125, scale: 2 }).unwrap(),
        r#"{"kind":"fixed","value":{"coefficient":125,"scale":2}}"#
    );

    let mut fields = BTreeMap::new();
    fields.insert("health".into(), DomainValue::Integer(8));
    let value = DomainValue::Record(fields);
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        r#"{"kind":"record","value":{"health":{"kind":"integer","value":8}}}"#
    );
}

#[test]
fn ast_and_errors_have_stable_transport_shapes() {
    let ast = StructuredTacticsAst {
        schema_version: Version::new(1, 0, 0),
        program_name: "hold_line".into(),
        declarations: vec![TacticalDeclaration::Action {
            name: "hold".into(),
            when: TacticalPredicate::LiteralTruth(true),
            do_call: TacticalCapabilityCall {
                capability: senkei_model::TacticalPath(vec!["guard".into()]),
                arguments: vec![],
            },
        }],
    };
    let ast_json = serde_json::to_string(&ast).unwrap();
    assert!(ast_json.contains(r#""kind":"literal_truth","value":true"#));
    assert!(ast_json.contains(r#""do_call":{"capability":["guard"],"arguments":[]}"#));

    let error = ApiError::new(ApiErrorCode::CompileFailed, "invalid source");
    let error_json = serde_json::to_string(&error).unwrap();
    assert!(error_json.contains(r#""path":null"#));
    assert!(error_json.contains(r#""details":{}"#));
    assert_eq!(serde_json::to_string(&RuleExpression::CurrentTick).unwrap(), r#"{"kind":"current_tick"}"#);
}

#[test]
fn observation_unknown_is_not_a_known_null() {
    let unknown: Observed<DomainValue> = Observed::Unknown;
    let null = Observed::Known(DomainValue::Null);
    assert_eq!(serde_json::to_string(&unknown).unwrap(), r#"{"status":"unknown"}"#);
    assert_eq!(serde_json::to_string(&null).unwrap(), r#"{"status":"known","value":{"kind":"null"}}"#);
}

#[test]
fn logical_cu_serializes_as_an_exact_json_integer() {
    assert_eq!(serde_json::to_string(&LogicalCu(17)).unwrap(), "17");
    assert!(LogicalCu(LogicalCu::MAX_SAFE_JSON_INTEGER).is_json_safe());
    assert!(!LogicalCu(LogicalCu::MAX_SAFE_JSON_INTEGER + 1).is_json_safe());
}

#[test]
fn entity_ids_are_stable_and_side_scoped() {
    let digest = ContentDigest::new("a".repeat(64));
    let projection = ProjectionId::from("core");
    let entity_type = TypeId::from("base");
    let key = DomainValue::String("core".into());
    let attacker = derive_projected_entity_id(
        &digest,
        &projection,
        &entity_type,
        Some(CombatantSide::Attacker),
        &key,
    )
    .unwrap();
    let attacker_again = derive_projected_entity_id(
        &digest,
        &projection,
        &entity_type,
        Some(CombatantSide::Attacker),
        &key,
    )
    .unwrap();
    let defender = derive_projected_entity_id(
        &digest,
        &projection,
        &entity_type,
        Some(CombatantSide::Defender),
        &key,
    )
    .unwrap();
    assert_eq!(attacker, attacker_again);
    assert_ne!(attacker, defender);

    let match_id = MatchId::from("m1");
    let rule = RuleId::from("spawn");
    let created = derive_invocation_entity_id(&match_id, 3, CombatantSide::Attacker, &rule, 1, 0);
    let created_again = derive_invocation_entity_id(&match_id, 3, CombatantSide::Attacker, &rule, 1, 0);
    let other_operation = derive_invocation_entity_id(&match_id, 3, CombatantSide::Attacker, &rule, 1, 1);
    assert_eq!(created, created_again);
    assert_ne!(created, other_operation);
    assert!(EntityId::from("unused").as_str() == "unused");
}
