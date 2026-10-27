use crate::canonical_digest;
use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

const RULESET_ID: &str = "senkei.initial";
const PRIMITIVE_SET_ID: &str = "senkei.finite-transitions";
const COST_SCHEDULE_ID: &str = "senkei.initial.cu";
const VERSION: Version = Version::new(1, 0, 0);

const LANES: [&str; 3] = ["top", "mid", "bot"];
const UNIT_CLASSES: [&str; 4] = ["infantry", "archer", "cavalry", "medic"];

/// Returns the first finite, generic ruleset package. Its game numbers are
/// initial values for this package version, not shared Engine/Jinrei rules.
pub fn initial_package() -> RulePackage {
    let mut package = build_package();
    package.ruleset.digest = canonical_digest(&package)
        .expect("RulePackage must have canonical JSON serialization");
    package
}

/// Engine compatibility declaration used by the local initial Senritsu.
/// Enbu builds may provide a stricter declaration when they support fewer
/// transition primitives or component versions.
pub fn initial_engine_compatibility() -> EngineCompatibility {
    EngineCompatibility {
        engine: VERSION,
        model: VERSION,
        primitive_set_id: id(PRIMITIVE_SET_ID),
        primitive_set: VERSION,
        jinrei_language: VERSION,
        structured_ast: VERSION,
        typed_ir: VERSION,
        bytecode: VERSION,
        available_primitives: [
            TransitionPrimitiveKind::SetField,
            TransitionPrimitiveKind::AddInteger,
            TransitionPrimitiveKind::AddFixed,
            TransitionPrimitiveKind::CreateEntity,
            TransitionPrimitiveKind::RemoveEntity,
            TransitionPrimitiveKind::AppendCollection,
            TransitionPrimitiveKind::RemoveCollectionValue,
            TransitionPrimitiveKind::EmitEvent,
            TransitionPrimitiveKind::SetOutcome,
        ]
        .into_iter()
        .collect(),
    }
}

fn build_package() -> RulePackage {
    let lane_values = values(&LANES);
    let class_values = values(&UNIT_CLASSES);
    let lane_type = enum_type("lane", &lane_values);
    let class_type = enum_type("unit_class", &class_values);

    let domain = DomainSchema {
        schema_version: VERSION,
        senkei_configuration: configuration_schema(&lane_type, &class_type),
        observation_fields: observation_fields(),
        collections: observation_collections(&lane_type, &class_type),
        capabilities: capabilities(&lane_type, &class_type),
        tactical_memory: BTreeMap::new(),
        symbol_domains: BTreeMap::from([
            (id("lane"), lane_values),
            (id("unit_class"), class_values),
            (id("outcome"), values(&["attacker_victory", "defender_victory", "draw", "aborted"])),
        ]),
        max_expression_depth: 64,
        max_collection_items: 64,
    };

    let phases = vec![
        phase("snapshot", 0, PhaseKind::Snapshot),
        phase("tactical_evaluation", 1, PhaseKind::TacticalEvaluation),
        phase("intent_validation", 2, PhaseKind::IntentValidation),
        phase("arbitration", 3, PhaseKind::Arbitration),
        phase("transition", 4, PhaseKind::Transition),
        phase("termination", 5, PhaseKind::Termination),
    ];

    RulePackage {
        next: None,
        ruleset: RulesetRef {
            id: id(RULESET_ID),
            version: VERSION,
            digest: ContentDigest::new("0".repeat(64)),
        },
        catalog_semantics_digest: None,
        minimum_engine_version: VERSION,
        model_version: VERSION,
        primitive_set_id: id(PRIMITIVE_SET_ID),
        primitive_set_version: VERSION,
        jinrei_language_version: VERSION,
        structured_ast_version: VERSION,
        typed_ir_version: VERSION,
        bytecode_version: VERSION,
        domain,
        world_initialization: world_initialization(),
        world: world_schema(),
        phases,
        required_primitives: [
            TransitionPrimitiveKind::SetField,
            TransitionPrimitiveKind::AddInteger,
            TransitionPrimitiveKind::EmitEvent,
        ]
        .into_iter()
        .collect(),
        transitions: transitions(),
        arbitration: arbitration(),
        termination: termination_policy(),
        cost_schedule: cost_schedule(),
        presentation: presentation_policy(),
        limits: RuleLimits {
            max_input_bytes: 4_000_000,
            max_entities: 256,
            max_events: 100_000,
            max_diagnostic_events: 250_000,
            max_output_bytes: 8_000_000,
            max_intents_per_side_per_tick: 32,
            max_value_depth: 32,
        },
    }
}

fn configuration_schema(
    lane_type: &DomainType,
    class_type: &DomainType,
) -> BTreeMap<FieldId, ConfigurationFieldSchema> {
    let deployment_record = record_type([
        ("slot_id", DomainType::String { max_bytes: 48 }),
        ("unit_class", class_type.clone()),
        ("lane", lane_type.clone()),
        ("position", int_type(0, 20)),
    ]);
    let reinforcement_record = record_type([
        ("slot_id", DomainType::String { max_bytes: 48 }),
        ("unit_class", class_type.clone()),
        ("lane", lane_type.clone()),
        ("available_tick", int_type(0, 500)),
    ]);
    BTreeMap::from([
        (
            id("starting_credits"),
            configuration_field(int_type(0, 500), false, Some(DomainValue::Integer(24))),
        ),
        (
            id("initial_deployments"),
            configuration_field(
                DomainType::List { element: Box::new(deployment_record.clone()), max_items: 16 },
                false,
                Some(DomainValue::List(vec![
                    roster_entry("unit-infantry-top", "infantry", "top", Some(4), None),
                    roster_entry("unit-archer-mid", "archer", "mid", Some(4), None),
                    roster_entry("unit-cavalry-bot", "cavalry", "bot", Some(4), None),
                ])),
            ),
        ),
        (
            id("reinforcements"),
            configuration_field(
                DomainType::List { element: Box::new(reinforcement_record), max_items: 16 },
                false,
                Some(DomainValue::List(vec![
                    roster_entry("reserve-medic-mid", "medic", "mid", None, Some(4)),
                    roster_entry("reserve-infantry-bot", "infantry", "bot", None, Some(8)),
                ])),
            ),
        ),
    ])
}

fn roster_entry(
    slot_id: &str,
    class: &str,
    lane: &str,
    position: Option<i64>,
    available_tick: Option<i64>,
) -> DomainValue {
    let mut fields = BTreeMap::from([
        (id("slot_id"), DomainValue::String(slot_id.to_owned())),
        (id("unit_class"), enum_value(class)),
        (id("lane"), enum_value(lane)),
    ]);
    if let Some(position) = position {
        fields.insert(id("position"), DomainValue::Integer(position));
    }
    if let Some(available_tick) = available_tick {
        fields.insert(id("available_tick"), DomainValue::Integer(available_tick));
    }
    DomainValue::Record(fields)
}

fn world_initialization() -> WorldInitialization {
    let mut entities = Vec::new();
    entities.push(projection(
        "core",
        ProjectionSides::Both,
        EntityProjectionSource::Singleton,
        "core",
        EntityIdProjection::ConstantKey("core".to_owned()),
        EntityOwnerProjection::SnapshotSide,
        BTreeMap::from([
            (id("hp"), constant_int(300)),
            (id("max_hp"), constant_int(300)),
            (id("position"), constant_int(0)),
        ]),
    ));
    entities.push(projection(
        "barracks",
        ProjectionSides::Both,
        EntityProjectionSource::Singleton,
        "barracks",
        EntityIdProjection::ConstantKey("barracks".to_owned()),
        EntityOwnerProjection::SnapshotSide,
        BTreeMap::from([(
            id("resources"),
            ProjectionValue::ConfigurationPath { root: id("starting_credits"), path: Vec::new() },
        )]),
    ));
    for lane in LANES {
        entities.push(projection(
            "tower",
            ProjectionSides::Both,
            EntityProjectionSource::Singleton,
            "tower",
            EntityIdProjection::ConstantKey(format!("tower:{lane}")),
            EntityOwnerProjection::SnapshotSide,
            BTreeMap::from([
                (id("lane"), constant_enum(lane)),
                (id("position"), constant_int(5)),
                (id("hp"), constant_int(150)),
                (id("max_hp"), constant_int(150)),
            ]),
        ));
    }
    entities.push(projection(
        "unit_roster",
        ProjectionSides::Both,
        EntityProjectionSource::EachConfigurationItem { field: id("initial_deployments") },
        "unit",
        EntityIdProjection::ConfigurationItemKey { path: vec![id("slot_id")] },
        EntityOwnerProjection::SnapshotSide,
        unit_projection_fields(true, false),
    ));
    entities.push(projection(
        "unit_roster",
        ProjectionSides::Both,
        EntityProjectionSource::EachConfigurationItem { field: id("reinforcements") },
        "unit",
        EntityIdProjection::ConfigurationItemKey { path: vec![id("slot_id")] },
        EntityOwnerProjection::SnapshotSide,
        unit_projection_fields(false, true),
    ));

    WorldInitialization {
        entities,
        global_fields: BTreeMap::new(),
        collections: ["units", "towers", "cores", "barracks"]
            .into_iter()
            .map(|collection| (id(collection), Vec::new()))
            .collect(),
    }
}

fn unit_projection_fields(deployed: bool, reinforcement: bool) -> BTreeMap<FieldId, ProjectionValue> {
    let mut fields = BTreeMap::from([
        (id("slot_id"), configuration_item_path("slot_id")),
        (id("unit_class"), configuration_item_path("unit_class")),
        (id("lane"), configuration_item_path("lane")),
        (id("position"), if reinforcement { constant_int(0) } else { configuration_item_path("position") }),
        (id("hp"), constant_int(100)),
        (id("max_hp"), constant_int(100)),
        (id("attack_range"), constant_int(2)),
        (id("deployed"), ProjectionValue::Constant(DomainValue::Bool(deployed))),
    ]);
    fields.insert(
        id("available_tick"),
        if reinforcement { configuration_item_path("available_tick") } else { constant_int(0) },
    );
    fields
}

fn world_schema() -> WorldSchema {
    let unit_fields = BTreeMap::from([
        (id("slot_id"), field_schema(DomainType::String { max_bytes: 48 }, Visibility::Public, false)),
        (id("unit_class"), field_schema(enum_type("unit_class", &values(&UNIT_CLASSES)), Visibility::Public, false)),
        (id("lane"), field_schema(enum_type("lane", &values(&LANES)), Visibility::Public, true)),
        (id("position"), field_schema(int_type(0, 20), Visibility::Public, true)),
        (id("hp"), field_schema(int_type(0, 100), Visibility::Public, true)),
        (id("max_hp"), field_schema(int_type(1, 100), Visibility::Public, false)),
        (id("attack_range"), field_schema(int_type(1, 5), Visibility::Public, false)),
        (id("deployed"), field_schema(DomainType::Bool, Visibility::Public, true)),
        (id("available_tick"), field_schema(int_type(0, 500), Visibility::OwningSide, false)),
    ]);
    let tower_fields = BTreeMap::from([
        (id("lane"), field_schema(enum_type("lane", &values(&LANES)), Visibility::Public, false)),
        (id("position"), field_schema(int_type(0, 20), Visibility::Public, false)),
        (id("hp"), field_schema(int_type(0, 150), Visibility::Public, true)),
        (id("max_hp"), field_schema(int_type(1, 150), Visibility::Public, false)),
    ]);
    let core_fields = BTreeMap::from([
        (id("position"), field_schema(int_type(0, 20), Visibility::Public, false)),
        (id("hp"), field_schema(int_type(0, 300), Visibility::Public, true)),
        (id("max_hp"), field_schema(int_type(1, 300), Visibility::Public, false)),
    ]);
    let barracks_fields = BTreeMap::from([(
        id("resources"),
        field_schema(int_type(0, 500), Visibility::OwningSide, true),
    )]);
    WorldSchema {
        entity_types: BTreeMap::from([
            (id("unit"), EntityTypeSchema { fields: unit_fields, default_owner: None }),
            (id("tower"), EntityTypeSchema { fields: tower_fields, default_owner: None }),
            (id("core"), EntityTypeSchema { fields: core_fields, default_owner: None }),
            (id("barracks"), EntityTypeSchema { fields: barracks_fields, default_owner: None }),
        ]),
        global_fields: BTreeMap::new(),
        collections: BTreeMap::from([
            (id("units"), world_collection("unit", 64)),
            (id("towers"), world_collection("tower", 6)),
            (id("cores"), world_collection("core", 2)),
            (id("barracks"), world_collection("barracks", 2)),
        ]),
        max_entities: 256,
    }
}

fn world_collection(entity: &str, max_items: u32) -> WorldCollectionSchema {
    WorldCollectionSchema {
        element_type: DomainType::Entity { entity_type: Some(id(entity)) },
        max_items,
    }
}

fn observation_fields() -> BTreeMap<ObservationPath, ObservationFieldSchema> {
    BTreeMap::from([
        (
            observation_path("match.tick"),
            observation_field(int_type(0, 500), Visibility::Public, ObservationSource::Tick),
        ),
        (
            observation_path("self.resources"),
            observation_field(
                int_type(0, 500),
                Visibility::OwningSide,
                ObservationSource::WorldEntityField {
                    entity: core_selector("barracks", "barracks", EntityOwnerSelector::OwnSide),
                    field: id("resources"),
                },
            ),
        ),
        (
            observation_path("self.core.hp"),
            observation_field(
                int_type(0, 300),
                Visibility::Public,
                ObservationSource::WorldEntityField {
                    entity: core_selector("core", "core", EntityOwnerSelector::OwnSide),
                    field: id("hp"),
                },
            ),
        ),
        (
            observation_path("enemy.core.hp"),
            observation_field(
                int_type(0, 300),
                Visibility::EnemyVisible,
                ObservationSource::WorldEntityField {
                    entity: core_selector("core", "core", EntityOwnerSelector::OtherSide),
                    field: id("hp"),
                },
            ),
        ),
    ])
}

fn observation_collections(
    lane_type: &DomainType,
    class_type: &DomainType,
) -> BTreeMap<CollectionId, CollectionSchema> {
    let unit_visible = BTreeMap::from([
        (id("slot_id"), current_entity_field(DomainType::String { max_bytes: 48 }, Visibility::Public, "slot_id")),
        (id("unit_class"), current_entity_field(class_type.clone(), Visibility::Public, "unit_class")),
        (id("lane"), current_entity_field(lane_type.clone(), Visibility::Public, "lane")),
        (id("position"), current_entity_field(int_type(0, 20), Visibility::Public, "position")),
        (id("hp"), current_entity_field(int_type(0, 100), Visibility::Public, "hp")),
        (id("max_hp"), current_entity_field(int_type(1, 100), Visibility::Public, "max_hp")),
        (id("attack_range"), current_entity_field(int_type(1, 5), Visibility::Public, "attack_range")),
        (id("deployed"), current_entity_field(DomainType::Bool, Visibility::Public, "deployed")),
    ]);
    let reserve_visible = BTreeMap::from([
        (id("slot_id"), current_entity_field(DomainType::String { max_bytes: 48 }, Visibility::Public, "slot_id")),
        (id("unit_class"), current_entity_field(class_type.clone(), Visibility::Public, "unit_class")),
        (id("lane"), current_entity_field(lane_type.clone(), Visibility::Public, "lane")),
        (id("available_tick"), current_entity_field(int_type(0, 500), Visibility::OwningSide, "available_tick")),
        (id("deployed"), current_entity_field(DomainType::Bool, Visibility::Public, "deployed")),
    ]);
    let tower_visible = BTreeMap::from([
        (id("lane"), current_entity_field(lane_type.clone(), Visibility::Public, "lane")),
        (id("position"), current_entity_field(int_type(0, 20), Visibility::Public, "position")),
        (id("hp"), current_entity_field(int_type(0, 150), Visibility::Public, "hp")),
        (id("max_hp"), current_entity_field(int_type(1, 150), Visibility::Public, "max_hp")),
    ]);
    let core_visible = BTreeMap::from([
        (id("position"), current_entity_field(int_type(0, 20), Visibility::Public, "position")),
        (id("hp"), current_entity_field(int_type(0, 300), Visibility::Public, "hp")),
        (id("max_hp"), current_entity_field(int_type(1, 300), Visibility::Public, "max_hp")),
    ]);
    let own_barracks_visible = BTreeMap::from([(
        id("resources"),
        current_entity_field(int_type(0, 500), Visibility::OwningSide, "resources"),
    )]);
    let enemy_barracks_visible = BTreeMap::new();

    BTreeMap::from([
        (id("allies.units"), observed_collection("unit", 32, Visibility::OwningSide, EntityOwnerSelector::OwnSide, Some(deployed_filter(true)), unit_visible.clone(), &["lane", "position"])),
        (id("allies.reserves"), observed_collection("unit", 16, Visibility::OwningSide, EntityOwnerSelector::OwnSide, Some(deployed_filter(false)), reserve_visible, &["lane", "available_tick"])),
        (id("enemies.visible_units"), observed_collection("unit", 32, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide, Some(deployed_filter(true)), unit_visible, &["lane", "position"])),
        (id("allies.towers"), observed_collection("tower", 3, Visibility::OwningSide, EntityOwnerSelector::OwnSide, None, tower_visible.clone(), &["lane"])),
        (id("enemies.visible_towers"), observed_collection("tower", 3, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide, None, tower_visible, &["lane"])),
        (id("allies.cores"), observed_collection("core", 1, Visibility::OwningSide, EntityOwnerSelector::OwnSide, None, core_visible.clone(), &[])),
        (id("enemies.visible_cores"), observed_collection("core", 1, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide, None, core_visible, &[])),
        (id("allies.barracks"), observed_collection("barracks", 1, Visibility::OwningSide, EntityOwnerSelector::OwnSide, None, own_barracks_visible, &[])),
        (id("enemies.visible_barracks"), observed_collection("barracks", 1, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide, None, enemy_barracks_visible, &[])),
    ])
}

fn observed_collection(
    entity_type: &str,
    max_items: u32,
    visibility: Visibility,
    owner: EntityOwnerSelector,
    filter: Option<RuleExpression>,
    visible_fields: BTreeMap<FieldId, ObservationFieldSchema>,
    order_by: &[&str],
) -> CollectionSchema {
    let mut unique_keys = [CollectionUniqueKey::EntityId].into_iter().collect::<BTreeSet<_>>();
    if entity_type == "unit" {
        unique_keys.insert(CollectionUniqueKey::Fields(vec![id("slot_id")]));
    }
    CollectionSchema {
        element_type: id(entity_type),
        max_items,
        visibility,
        source: CollectionSource::WorldEntities {
            entity_types: [id(entity_type)].into_iter().collect(),
            owner,
            filter,
        },
        visible_fields,
        order_by: order_by.iter().map(|field| id(field)).collect(),
        unique_keys,
    }
}

fn deployed_filter(deployed: bool) -> RuleExpression {
    eq(
        RuleExpression::Field { target: EntitySelector::ObservedEntity, field: id("deployed") },
        bool_lit(deployed),
    )
}

fn core_selector(projection_id: &str, entity_type: &str, owner: EntityOwnerSelector) -> WorldEntitySelector {
    WorldEntitySelector::ByProjectionKey {
        projection_id: id(projection_id),
        entity_type: id(entity_type),
        owner,
        key: DomainValue::String(entity_type.to_owned()),
    }
}

fn capabilities(
    lane_type: &DomainType,
    class_type: &DomainType,
) -> BTreeMap<CapabilityId, CapabilitySchema> {
    let mut result = BTreeMap::new();
    let produce = capability(
        "deploy",
        vec![
            parameter("producer", entity_type("barracks")),
            parameter("reserve", entity_type("unit")),
            parameter("lane", lane_type.clone()),
        ],
        Some("unit"),
        Some(0),
        Some(1),
        TargetOwnerConstraint::OwnSide,
        vec![
            not(less(field_expr(EntitySelector::IntentActor, "resources"), int_lit(1))),
            eq(field_expr(EntitySelector::IntentTarget, "deployed"), bool_lit(false)),
            not(less(RuleExpression::CurrentTick, field_expr(EntitySelector::IntentTarget, "available_tick"))),
        ],
    );
    result.insert(id("deploy"), produce);
    result.insert(
        id("move_forward"),
        unit_capability("move_forward", Vec::new(), None, vec![
            eq(field_expr(EntitySelector::IntentActor, "deployed"), bool_lit(true)),
            less(field_expr(EntitySelector::IntentActor, "position"), int_lit(20)),
        ]),
    );
    result.insert(
        id("move_backward"),
        unit_capability("move_backward", Vec::new(), None, vec![
            eq(field_expr(EntitySelector::IntentActor, "deployed"), bool_lit(true)),
            less(int_lit(0), field_expr(EntitySelector::IntentActor, "position")),
        ]),
    );
    result.insert(
        id("shift_lane"),
        unit_capability("shift_lane", vec![parameter("lane", lane_type.clone())], None, vec![
            eq(field_expr(EntitySelector::IntentActor, "deployed"), bool_lit(true)),
        ]),
    );
    result.insert(
        id("attack_unit"),
        attack_capability("attack_unit", "unit", lane_type, class_type),
    );
    result.insert(
        id("attack_tower"),
        attack_capability("attack_tower", "tower", lane_type, class_type),
    );
    result.insert(
        id("attack_core"),
        attack_capability("attack_core", "core", lane_type, class_type),
    );
    result.insert(
        id("use_ability"),
        capability(
            "use_ability",
            vec![parameter("unit", entity_type("unit")), parameter("ally", entity_type("unit"))],
            Some("unit"),
            Some(0),
            Some(1),
            TargetOwnerConstraint::OwnSide,
            vec![
                eq(field_expr(EntitySelector::IntentActor, "deployed"), bool_lit(true)),
                eq(field_expr(EntitySelector::IntentTarget, "deployed"), bool_lit(true)),
                eq(field_expr(EntitySelector::IntentActor, "unit_class"), enum_lit("medic")),
                eq(field_expr(EntitySelector::IntentActor, "lane"), field_expr(EntitySelector::IntentTarget, "lane")),
                less(field_expr(EntitySelector::IntentTarget, "hp"), field_expr(EntitySelector::IntentTarget, "max_hp")),
                in_same_side_range(EntitySelector::IntentActor, EntitySelector::IntentTarget),
            ],
        ),
    );
    result
}

fn attack_capability(
    name: &str,
    target_type: &str,
    _lane_type: &DomainType,
    _class_type: &DomainType,
) -> CapabilitySchema {
    let mut preconditions = vec![
        eq(field_expr(EntitySelector::IntentActor, "deployed"), bool_lit(true)),
        less(int_lit(0), field_expr(EntitySelector::IntentTarget, "hp")),
        in_attack_range(EntitySelector::IntentActor, EntitySelector::IntentTarget),
    ];
    if target_type != "core" {
        preconditions.push(eq(field_expr(EntitySelector::IntentActor, "lane"), field_expr(EntitySelector::IntentTarget, "lane")));
    }
    capability(
        name,
        vec![parameter("unit", entity_type("unit")), parameter("target", entity_type(target_type))],
        Some(target_type),
        Some(0),
        Some(1),
        TargetOwnerConstraint::OtherSide,
        preconditions,
    )
}

fn in_attack_range(actor: EntitySelector, target: EntitySelector) -> RuleExpression {
    let sum = add(
        field_expr(actor.clone(), "position"),
        field_expr(target.clone(), "position"),
    );
    let minimum = subtract(int_lit(20), field_expr(actor.clone(), "attack_range"));
    let maximum = add(int_lit(20), field_expr(actor, "attack_range"));
    and(vec![not(less(sum.clone(), minimum)), not(less(maximum, sum))])
}

fn in_same_side_range(actor: EntitySelector, target: EntitySelector) -> RuleExpression {
    let actor_position = field_expr(actor.clone(), "position");
    let target_position = field_expr(target.clone(), "position");
    let range = field_expr(actor, "attack_range");
    and(vec![
        not(less(add(actor_position.clone(), range.clone()), target_position.clone())),
        not(less(add(target_position, range), actor_position)),
    ])
}

fn unit_capability(
    name: &str,
    extra_arguments: Vec<ParameterSchema>,
    target_owner: Option<TargetOwnerConstraint>,
    preconditions: Vec<RuleExpression>,
) -> CapabilitySchema {
    let mut arguments = vec![parameter("unit", entity_type("unit"))];
    arguments.extend(extra_arguments);
    capability(
        name,
        arguments,
        None,
        Some(0),
        None,
        target_owner.unwrap_or(TargetOwnerConstraint::Any),
        preconditions,
    )
}

fn capability(
    _name: &str,
    arguments: Vec<ParameterSchema>,
    target_type: Option<&str>,
    actor_argument: Option<u16>,
    target_argument: Option<u16>,
    target_owner: TargetOwnerConstraint,
    preconditions: Vec<RuleExpression>,
) -> CapabilitySchema {
    CapabilitySchema {
        arguments,
        target_type: target_type.map(id),
        actor_argument,
        target_argument,
        target_owner,
        phases: [id("transition")].into_iter().collect(),
        preconditions,
        issue_cost: id("jinrei.capability_issue"),
    }
}

fn transitions() -> Vec<TransitionRule> {
    let mut result = Vec::new();
    let mut order = 0;

    result.push(transition(
        "deploy_reserve",
        order,
        "deploy",
        None,
        vec![
            set_field(EntitySelector::IntentTarget, "deployed", bool_lit(true)),
            set_field(EntitySelector::IntentTarget, "lane", RuleExpression::IntentArgument(2)),
            set_field(EntitySelector::IntentTarget, "position", int_lit(0)),
            add_integer(EntitySelector::IntentActor, "resources", int_lit(-1)),
            emit_event(
                "unit_deployed",
                [
                    ("unit", RuleExpression::IntentArgument(1)),
                    ("lane", RuleExpression::IntentArgument(2)),
                ],
            ),
        ],
    ));
    order += 1;

    result.push(transition(
        "move_forward",
        order,
        "move_forward",
        None,
        vec![
            add_integer(EntitySelector::IntentActor, "position", int_lit(1)),
            emit_event(
                "unit_moved",
                [
                    ("unit", RuleExpression::IntentArgument(0)),
                    ("position", add(field_expr(EntitySelector::IntentActor, "position"), int_lit(1))),
                ],
            ),
        ],
    ));
    order += 1;
    result.push(transition(
        "move_backward",
        order,
        "move_backward",
        None,
        vec![
            add_integer(EntitySelector::IntentActor, "position", int_lit(-1)),
            emit_event(
                "unit_moved",
                [
                    ("unit", RuleExpression::IntentArgument(0)),
                    ("position", subtract(field_expr(EntitySelector::IntentActor, "position"), int_lit(1))),
                ],
            ),
        ],
    ));
    order += 1;
    result.push(transition(
        "shift_lane",
        order,
        "shift_lane",
        None,
        vec![
            set_field(EntitySelector::IntentActor, "lane", RuleExpression::IntentArgument(1)),
            emit_event(
                "lane_shifted",
                [
                    ("unit", RuleExpression::IntentArgument(0)),
                    ("lane", RuleExpression::IntentArgument(1)),
                ],
            ),
        ],
    ));
    order += 1;

    for (capability, event) in [
        ("attack_unit", "unit_attacked"),
        ("attack_tower", "tower_attacked"),
        ("attack_core", "core_attacked"),
    ] {
        for (class, damage) in [("infantry", 10), ("archer", 10), ("cavalry", 20), ("medic", 10)] {
            result.push(transition(
                &format!("{capability}_{class}"),
                order,
                capability,
                Some(eq(
                    field_expr(EntitySelector::IntentActor, "unit_class"),
                    enum_lit(class),
                )),
                vec![
                    add_integer(EntitySelector::IntentTarget, "hp", int_lit(-damage)),
                    emit_event(
                        event,
                        [
                            ("unit", RuleExpression::IntentArgument(0)),
                            ("target", RuleExpression::IntentArgument(1)),
                            ("damage", int_lit(damage)),
                        ],
                    ),
                ],
            ));
            order += 1;
        }
    }
    result.push(transition(
        "medic_heal",
        order,
        "use_ability",
        Some(eq(
            field_expr(EntitySelector::IntentActor, "unit_class"),
            enum_lit("medic"),
        )),
        vec![
            add_integer(EntitySelector::IntentTarget, "hp", int_lit(10)),
            emit_event(
                "unit_healed",
                [
                    ("unit", RuleExpression::IntentArgument(0)),
                    ("target", RuleExpression::IntentArgument(1)),
                    ("amount", int_lit(10)),
                ],
            ),
        ],
    ));
    result
}

fn arbitration() -> BTreeMap<CapabilityId, ArbitrationRule> {
    let caps = [
        // The credit check observes the phase-start balance. Locking the
        // producer to one deployment per tick prevents simultaneous deploys
        // from spending the same starting credit more than once.
        ("deploy", vec![IntentKey::Actor]),
        ("move_forward", vec![IntentKey::Actor]),
        ("move_backward", vec![IntentKey::Actor]),
        ("shift_lane", vec![IntentKey::Actor]),
        ("attack_unit", vec![IntentKey::Actor]),
        ("attack_tower", vec![IntentKey::Actor]),
        ("attack_core", vec![IntentKey::Actor]),
        ("use_ability", vec![IntentKey::Actor]),
    ];
    caps.into_iter()
        .map(|(capability, conflict_keys)| {
            (
                id(capability),
                ArbitrationRule {
                    conflict_keys,
                    resolution: ArbitrationResolution::SelectOrdered {
                        sort_by: vec![IntentSortTerm {
                            key: IntentKey::Priority,
                            direction: SortDirection::Descending,
                        }],
                        max_accepted: 32,
                    },
                },
            )
        })
        .collect()
}

fn termination_policy() -> TerminationPolicy {
    let attacker_hp = field_expr(
        EntitySelector::ByProjectionKey {
            projection_id: id("core"),
            entity_type: id("core"),
            owner: EntityOwnerSelector::Attacker,
            key: DomainValue::String("core".to_owned()),
        },
        "hp",
    );
    let defender_hp = field_expr(
        EntitySelector::ByProjectionKey {
            projection_id: id("core"),
            entity_type: id("core"),
            owner: EntityOwnerSelector::Defender,
            key: DomainValue::String("core".to_owned()),
        },
        "hp",
    );
    TerminationPolicy {
        max_ticks: 500,
        conditions: vec![
            TerminationCondition {
                order: 0,
                when: and(vec![less(attacker_hp.clone(), int_lit(1)), less(defender_hp.clone(), int_lit(1))]),
                outcome: MatchOutcome::Draw,
                reason: id("both_cores_destroyed"),
            },
            TerminationCondition {
                order: 1,
                when: less(attacker_hp, int_lit(1)),
                outcome: MatchOutcome::DefenderVictory,
                reason: id("attacker_core_destroyed"),
            },
            TerminationCondition {
                order: 2,
                when: less(defender_hp, int_lit(1)),
                outcome: MatchOutcome::AttackerVictory,
                reason: id("defender_core_destroyed"),
            },
        ],
        on_timeout: MatchOutcome::Draw,
        on_timeout_reason: id("time_limit"),
    }
}

fn cost_schedule() -> CostSchedule {
    let costs = [
        ("jinrei.path_read", 1, 0),
        ("jinrei.comparison", 1, 0),
        ("jinrei.arithmetic", 1, 0),
        ("jinrei.logic", 1, 0),
        ("jinrei.state_reference", 1, 0),
        ("jinrei.collection_iteration", 0, 1),
        ("jinrei.aggregate", 1, 1),
        ("jinrei.memory_read", 1, 0),
        ("jinrei.memory_write", 1, 0),
        ("jinrei.capability_issue", 3, 0),
    ];
    CostSchedule {
        id: id(COST_SCHEDULE_ID),
        version: VERSION,
        operations: costs.into_iter().map(|(name, base, per_item)| {
            (id(name), LogicalCuCost { base, per_item })
        }).collect(),
        per_tick_budget: LogicalCu(100_000),
        per_match_budget: LogicalCu(100_000_000),
        overrun_policy: BudgetOverrunPolicy::RejectTickAndKeepMemory,
        memory_commit_policy: MemoryCommitPolicy::OnCompletedEvaluation,
        budget_overrun_reason: id("cu_budget_exceeded"),
    }
}

fn presentation_policy() -> PresentationPolicy {
    let mut visible_entity_fields = BTreeMap::new();
    visible_entity_fields.insert(id("unit"), ["unit_class", "lane", "position", "hp", "max_hp", "deployed"].into_iter().map(id).collect());
    visible_entity_fields.insert(id("tower"), ["lane", "position", "hp", "max_hp"].into_iter().map(id).collect());
    visible_entity_fields.insert(id("core"), ["position", "hp", "max_hp"].into_iter().map(id).collect());
    visible_entity_fields.insert(id("barracks"), BTreeSet::new());
    PresentationPolicy {
        visible_events: event_schemas(),
        visible_entity_fields,
        visible_global_fields: BTreeSet::new(),
    }
}

fn event_schemas() -> BTreeMap<EventId, EventSchema> {
    let unit = DomainType::Entity { entity_type: Some(id("unit")) };
    let tower = DomainType::Entity { entity_type: Some(id("tower")) };
    let core = DomainType::Entity { entity_type: Some(id("core")) };
    let lane = enum_type("lane", &values(&LANES));
    let damage = int_type(0, 20);
    BTreeMap::from([
        (id("unit_deployed"), event([("unit", unit.clone()), ("lane", lane.clone())])),
        (id("unit_moved"), event([("unit", unit.clone()), ("position", int_type(0, 20))])),
        (id("lane_shifted"), event([("unit", unit.clone()), ("lane", lane)])),
        (id("unit_attacked"), event([("unit", unit.clone()), ("target", unit.clone()), ("damage", damage.clone())])),
        (id("tower_attacked"), event([("unit", unit.clone()), ("target", tower), ("damage", damage.clone())])),
        (id("core_attacked"), event([("unit", unit.clone()), ("target", core), ("damage", damage)])),
        (id("unit_healed"), event([("unit", unit), ("target", DomainType::Entity { entity_type: Some(id("unit")) }), ("amount", int_type(0, 10))])),
    ])
}

fn event<const N: usize>(fields: [(&str, DomainType); N]) -> EventSchema {
    EventSchema { payload: fields.into_iter().map(|(name, ty)| (id(name), ty)).collect() }
}

fn transition(
    name: &str,
    order: u32,
    capability: &str,
    when: Option<RuleExpression>,
    operations: Vec<TransitionPrimitive>,
) -> TransitionRule {
    TransitionRule {
        id: id(name),
        phase: id("transition"),
        order,
        capability: Some(id(capability)),
        when,
        operations,
    }
}

fn add_integer(target: EntitySelector, field_name: &str, amount: RuleExpression) -> TransitionPrimitive {
    TransitionPrimitive::AddInteger { target, field: id(field_name), amount }
}

fn set_field(target: EntitySelector, field_name: &str, value: RuleExpression) -> TransitionPrimitive {
    TransitionPrimitive::SetField { target, field: id(field_name), value }
}

fn emit_event<const N: usize>(event_name: &str, payload: [(&str, RuleExpression); N]) -> TransitionPrimitive {
    TransitionPrimitive::EmitEvent {
        event: id(event_name),
        payload: payload.into_iter().map(|(name, expression)| (id(name), expression)).collect(),
    }
}

fn projection(
    projection_id: &str,
    applies_to: ProjectionSides,
    source: EntityProjectionSource,
    entity_type: &str,
    entity_id: EntityIdProjection,
    owner: EntityOwnerProjection,
    fields: BTreeMap<FieldId, ProjectionValue>,
) -> EntityProjection {
    EntityProjection {
        projection_id: id(projection_id),
        applies_to,
        source,
        entity_type: id(entity_type),
        entity_id,
        owner,
        fields,
    }
}

fn observation_field(ty: DomainType, visibility: Visibility, source: ObservationSource) -> ObservationFieldSchema {
    ObservationFieldSchema { value_type: ty, visibility, source }
}

fn configuration_field(ty: DomainType, required: bool, default: Option<DomainValue>) -> ConfigurationFieldSchema {
    ConfigurationFieldSchema { value_type: ty, required, default }
}

fn parameter(name: &str, ty: DomainType) -> ParameterSchema {
    ParameterSchema { id: id(name), value_type: ty, optional: false }
}

fn field_schema(ty: DomainType, visibility: Visibility, writable: bool) -> FieldSchema {
    FieldSchema { value_type: ty, visibility, writable }
}

fn phase(name: &str, order: u32, kind: PhaseKind) -> ExecutionPhase {
    ExecutionPhase { id: id(name), order, kind }
}

fn current_entity_field(ty: DomainType, visibility: Visibility, field: &str) -> ObservationFieldSchema {
    observation_field(ty, visibility, ObservationSource::CurrentEntityField { field: id(field) })
}

fn configuration_item_path(field: &str) -> ProjectionValue {
    ProjectionValue::ConfigurationItemPath { path: vec![id(field)] }
}

fn constant_int(value: i64) -> ProjectionValue {
    ProjectionValue::Constant(DomainValue::Integer(value))
}

fn constant_enum(value: &str) -> ProjectionValue {
    ProjectionValue::Constant(enum_value(value))
}

fn enum_type(domain: &str, symbols: &BTreeSet<SymbolId>) -> DomainType {
    DomainType::Enum { domain: id(domain), values: symbols.clone() }
}

fn entity_type(name: &str) -> DomainType {
    DomainType::Entity { entity_type: Some(id(name)) }
}

fn int_type(min: i64, max: i64) -> DomainType {
    DomainType::Integer { min: Some(min), max: Some(max) }
}

fn record_type<const N: usize>(fields: [(&str, DomainType); N]) -> DomainType {
    DomainType::Record { fields: fields.into_iter().map(|(name, ty)| (id(name), ty)).collect() }
}

fn values(names: &[&str]) -> BTreeSet<SymbolId> {
    names.iter().map(|name| id(name)).collect()
}

fn id<T: From<String>>(value: impl AsRef<str>) -> T {
    T::from(value.as_ref().to_owned())
}

fn observation_path(value: &str) -> ObservationPath {
    id(value)
}

fn enum_value(value: &str) -> DomainValue {
    DomainValue::Enum(id(value))
}

fn constant_int_value(value: i64) -> RuleExpression {
    RuleExpression::Literal(DomainValue::Integer(value))
}

fn constant_bool_value(value: bool) -> RuleExpression {
    RuleExpression::Literal(DomainValue::Bool(value))
}

fn constant_enum_value(value: &str) -> RuleExpression {
    RuleExpression::Literal(enum_value(value))
}

fn int_lit(value: i64) -> RuleExpression { constant_int_value(value) }
fn bool_lit(value: bool) -> RuleExpression { constant_bool_value(value) }
fn enum_lit(value: &str) -> RuleExpression { constant_enum_value(value) }

fn field_expr(target: EntitySelector, field: &str) -> RuleExpression {
    RuleExpression::Field { target, field: id(field) }
}

fn eq(left: RuleExpression, right: RuleExpression) -> RuleExpression {
    RuleExpression::Equal { left: Box::new(left), right: Box::new(right) }
}

fn less(left: RuleExpression, right: RuleExpression) -> RuleExpression {
    RuleExpression::LessThan { left: Box::new(left), right: Box::new(right) }
}

fn add(left: RuleExpression, right: RuleExpression) -> RuleExpression {
    RuleExpression::AddInteger { left: Box::new(left), right: Box::new(right) }
}

fn subtract(left: RuleExpression, right: RuleExpression) -> RuleExpression {
    RuleExpression::SubtractInteger { left: Box::new(left), right: Box::new(right) }
}

fn and(items: Vec<RuleExpression>) -> RuleExpression { RuleExpression::And(items) }
fn not(inner: RuleExpression) -> RuleExpression { RuleExpression::Not(Box::new(inner)) }
