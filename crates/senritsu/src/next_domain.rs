//! Domain contract for the versioned finite Senkei ruleset.
//!
//! The package is cloned from `initial_package` by the integration layer. This
//! function replaces every initial-ruleset projection and tactical contract so
//! the legacy lane game cannot leak into a `NextRules` package.

use senkei_model::*;
use std::collections::{BTreeMap, BTreeSet};

const NEXT_VERSION: Version = Version::new(2, 0, 0);
const NEXT_ENGINE_VERSION: Version = Version::new(1, 2, 0);
const RULESET_ID: &str = "senkei.next";
const COST_SCHEDULE_ID: &str = "senkei.next.cu";
const MAX_ENTITIES: u32 = 512;
const MAX_TICK_FALLBACK: u32 = 600;
const MAX_STRING_BYTES: u32 = 64;
const MAX_INT: i64 = 1_000_000_000;

/// Replaces the cloned initial package's domain, world, costs, and public
/// presentation policy with the finite hero ruleset contract.
///
/// Call after assigning `package.next`; package assembly owns the final digest
/// because it may still update content after this hook returns.
pub fn configure(package: &mut RulePackage) {
    let (skill_ids, max_ticks, tower_count) = package
        .next
        .as_ref()
        .map(|rules| {
            let skills = rules
                .heroes
                .iter()
                .flat_map(|hero| hero.skills.iter().map(|skill| id(skill.id.as_str())))
                .collect::<BTreeSet<_>>();
            let ticks = rules
                .parameters
                .get("max_match_ticks")
                .copied()
                .filter(|value| *value > 0 && *value <= i64::from(u32::MAX))
                .map(|value| value as u32)
                .unwrap_or(MAX_TICK_FALLBACK);
            let towers = rules.map.towers.len().clamp(1, MAX_ENTITIES as usize) as u32;
            (skills, ticks, towers)
        })
        .unwrap_or_else(|| (BTreeSet::new(), MAX_TICK_FALLBACK, 1));

    package.ruleset.id = id(RULESET_ID);
    package.ruleset.version = NEXT_VERSION;
    package.ruleset.digest = ContentDigest::new("0".repeat(64));
    package.minimum_engine_version = NEXT_ENGINE_VERSION;
    package.domain = domain_schema(&skill_ids, max_ticks);
    package.world_initialization = WorldInitialization {
        entities: Vec::new(),
        global_fields: BTreeMap::new(),
        collections: ["heroes", "minions", "monsters", "towers", "bases", "bridges", "observations"]
            .into_iter()
            .map(|name| (id(name), Vec::new()))
            .collect(),
    };
    package.world = world_schema(&skill_ids, tower_count);
    package.phases = phases();
    package.required_primitives = [TransitionPrimitiveKind::BattleNavigation,TransitionPrimitiveKind::BattleVision,TransitionPrimitiveKind::BattleSquads,TransitionPrimitiveKind::BattleCombat].into_iter().collect();
    package.transitions.clear();
    package.arbitration = arbitration(package.limits.max_intents_per_side_per_tick);
    package.termination = TerminationPolicy {
        max_ticks,
        // The Next combat hook resolves base destruction and simultaneous
        // outcomes. Only the finite timeout remains in this shared envelope.
        conditions: Vec::new(),
        on_timeout: MatchOutcome::Draw,
        on_timeout_reason: id("time_limit"),
    };
    package.cost_schedule = cost_schedule();
    package.presentation = presentation_policy();
    package.limits.max_entities = MAX_ENTITIES;
    package.limits.max_intents_per_side_per_tick = 32;
    package.limits.max_events = 200_000;
    package.limits.max_diagnostic_events = 250_000;
    package.limits.max_output_bytes = 64_000_000;
    package.limits.max_value_depth = 32;
}

fn domain_schema(skill_ids: &BTreeSet<FieldId>, max_ticks: u32) -> DomainSchema {
    let hero_configuration = record_type([
        ("slot_id", string_type(48)),
        ("catalog_id", string_type(MAX_STRING_BYTES)),
        ("squad", string_type(48)),
        ("node", string_type(MAX_STRING_BYTES)),
        ("skill_path", string_type(MAX_STRING_BYTES)),
    ]);
    DomainSchema {
        schema_version: NEXT_VERSION,
        senkei_configuration: BTreeMap::from([(
            id("heroes"),
            ConfigurationFieldSchema {
                value_type: DomainType::List { element: Box::new(hero_configuration), max_items: 5 },
                required: true,
                default: None,
            },
        )]),
        observation_fields: BTreeMap::from([(
            id("match.tick"),
            observation_field(int_type(0, i64::from(max_ticks)), Visibility::Public, ObservationSource::Tick),
        )]),
        collections: observation_collections(skill_ids),
        capabilities: capabilities(),
        tactical_memory: BTreeMap::new(),
        symbol_domains: BTreeMap::from([
            (id("outcome"), values(&["attacker_victory", "defender_victory", "draw", "aborted"])),
            (id("track"), values(&["LEFT", "RIGHT"])),
            (id("bridge_operation"), values(&["expand", "rebuild", "destroy"])),
        ]),
        max_expression_depth: 64,
        max_collection_items: MAX_ENTITIES,
    }
}

fn world_schema(skill_ids: &BTreeSet<FieldId>, tower_count: u32) -> WorldSchema {
    let mut entity_types = BTreeMap::new();
    entity_types.insert(id("hero"), hero_entity_schema(skill_ids));
    entity_types.insert(id("minion"), entity_schema(common_fields(), None));
    entity_types.insert(id("monster"), entity_schema(common_fields().into_iter().chain([
        (id("camp"), field(string_type(MAX_STRING_BYTES), Visibility::Public, false)),
        (id("respawn_at"), field(tick_type(), Visibility::Internal, true)),
    ]).collect(), None));
    entity_types.insert(id("tower"), entity_schema(common_fields(), None));
    entity_types.insert(id("base"), entity_schema(common_fields(), None));
    entity_types.insert(id("bridge"), bridge_entity_schema());
    entity_types.insert(id("observation"), observation_entity_schema());

    WorldSchema {
        entity_types,
        global_fields: BTreeMap::new(),
        collections: BTreeMap::from([
            (id("heroes"), world_collection("hero", 10)),
            (id("minions"), world_collection("minion", MAX_ENTITIES)),
            (id("monsters"), world_collection("monster", MAX_ENTITIES)),
            (id("towers"), world_collection("tower", tower_count)),
            (id("bases"), world_collection("base", 2)),
            (id("bridges"), world_collection("bridge", 3)),
            (id("observations"), world_collection("observation", 1)),
        ]),
        max_entities: MAX_ENTITIES,
    }
}

fn common_fields() -> BTreeMap<FieldId, FieldSchema> {
    let mut fields = BTreeMap::new();
    for (name, minimum, maximum) in [
        ("hp", 0, MAX_INT), ("max_hp", 1, MAX_INT),
        ("attack", 0, MAX_INT), ("defense", 0, MAX_INT),
        ("speed", 0, MAX_INT), ("range", 0, MAX_INT),
        ("attack_interval", 1, MAX_INT), ("vision", 0, MAX_INT),
        ("attack_ready", 0, i64::from(u32::MAX)),
        ("x", -MAX_INT, MAX_INT), ("y", -MAX_INT, MAX_INT),
        ("edge_progress", 0, MAX_INT), ("cross_remaining", 0, MAX_INT),
        ("ford_remaining", 0, MAX_INT), ("ford_active", 0, 1),
        ("track_wait_ticks", 0, MAX_INT),
        ("moved_tick", 0, i64::from(u32::MAX) + 1),
        ("move_intent_tick", 0, i64::from(u32::MAX) + 1),
        ("track_intent_tick", 0, i64::from(u32::MAX) + 1),
        ("action_lock_until", 0, i64::from(u32::MAX) + 1),
        ("prepared_action_tick", 0, i64::from(u32::MAX) + 1),
        ("build_remaining", 0, MAX_INT),
        ("build_started_tick", 0, i64::from(u32::MAX) + 1),
        ("build_lock_until", 0, i64::from(u32::MAX) + 1),
        ("capture_progress", 0, MAX_INT), ("retreating", 0, 1),
        ("shield", 0, MAX_INT), ("haste", 0, MAX_INT),
        ("haste_until", 0, MAX_INT), ("slow", 0, MAX_INT),
        ("slow_until", 0, MAX_INT), ("empower", 0, MAX_INT),
        ("empower_until", 0, MAX_INT), ("defense_bonus", 0, MAX_INT),
        ("defense_until", 0, MAX_INT),
        ("reveal_attacker_until", 0, MAX_INT), ("reveal_defender_until", 0, MAX_INT),
        ("reveal_until", 0, MAX_INT), ("xp_reward", 0, MAX_INT),
        ("death_tick", 0, i64::from(u32::MAX)),
    ] {
        let visibility = match name {
            "attack_ready" => Visibility::OwningSide,
            "reveal_attacker_until" | "reveal_defender_until" | "reveal_until"
            | "xp_reward" | "death_tick" | "prepared_action_tick"
            | "build_started_tick" | "build_lock_until" | "moved_tick"
            | "move_intent_tick" | "track_intent_tick" | "track_wait_ticks" => Visibility::Internal,
            "action_lock_until" | "retreating" => Visibility::OwningSide,
            _ => Visibility::Public,
        };
        fields.insert(id(name), field(int_type(minimum, maximum), visibility, true));
    }
    for name in [
        "node", "edge_to", "lane", "catalog_id", "track", "track_goal",
        "site", "bridge_state", "build_kind", "capture_owner", "capture_progress_side",
        "track_cross_from", "track_cross_to", "builder_side", "builder_squad",
    ] {
        fields.insert(id(name), field(string_type(MAX_STRING_BYTES), Visibility::Public, name != "catalog_id"));
    }
    for name in ["track_cross_from", "track_cross_to", "builder_side", "builder_squad"] {
        fields.insert(id(name), field(string_type(MAX_STRING_BYTES), Visibility::Internal, true));
    }
    fields.insert(id("track_goal"), field(string_type(MAX_STRING_BYTES), Visibility::OwningSide, true));
    fields.insert(id("goal"), field(string_type(MAX_STRING_BYTES), Visibility::OwningSide, true));
    fields
}

fn hero_entity_schema(skill_ids: &BTreeSet<FieldId>) -> EntityTypeSchema {
    let mut fields = common_fields();
    fields.extend([
        (id("slot_id"), field(string_type(48), Visibility::OwningSide, false)),
        (id("squad"), field(string_type(64), Visibility::OwningSide, true)),
        (id("skill_path"), field(string_type(MAX_STRING_BYTES), Visibility::OwningSide, false)),
        (id("xp"), field(int_type(0, 9_007_199_254_740_991), Visibility::OwningSide, true)),
        (id("level"), field(int_type(1, MAX_INT), Visibility::Public, true)),
        (id("maturity"), field(int_type(0, MAX_INT), Visibility::Public, true)),
        (id("formation"), field(int_type(0, 5), Visibility::Public, true)),
        (id("respawn_at"), field(tick_type(), Visibility::OwningSide, true)),
        (id("life_generation"), field(int_type(0, MAX_INT), Visibility::Internal, true)),
        (id("passive_generation"), field(int_type(0, MAX_INT), Visibility::Internal, true)),
        (id("energy"), field(int_type(0, MAX_INT), Visibility::Public, true)),
        (id("skills"), field(
            DomainType::List { element: Box::new(string_type(MAX_STRING_BYTES)), max_items: 64 },
            Visibility::Public,
            true,
        )),
        (id("cooldowns"), field(cooldowns_type(skill_ids), Visibility::OwningSide, true)),
        (id("target"), field(
            DomainType::Optional(Box::new(DomainType::Entity { entity_type: None })),
            Visibility::Internal,
            true,
        )),
    ]);
    entity_schema(fields, None)
}

fn cooldowns_type(skill_ids: &BTreeSet<FieldId>) -> DomainType {
    DomainType::Record {
        fields: skill_ids.iter().cloned().map(|skill| (skill, tick_type())).collect(),
    }
}

fn observation_collections(skill_ids: &BTreeSet<FieldId>) -> BTreeMap<CollectionId, CollectionSchema> {
    let current_fields = |entity: &str, fields: &[&str]| -> BTreeMap<FieldId, ObservationFieldSchema> {
        let schema = entity_type_schema(entity, skill_ids);
        fields.iter().map(|name| {
            let entity_field = id(*name);
            let world_field = schema.fields.get(&entity_field)
                .expect("collection field must exist on its entity type");
            (entity_field.clone(), current_field(
                world_field.value_type.clone(),
                world_field.visibility,
                &entity_field,
            ))
        }).collect()
    };
    let own_hero_fields = [
        "slot_id", "catalog_id", "squad", "skill_path", "xp", "level", "maturity", "formation",
        "respawn_at", "energy", "skills", "cooldowns", "hp", "max_hp", "attack", "defense", "speed",
        "range", "attack_interval", "vision", "attack_ready", "x", "y", "node", "edge_to", "edge_progress",
        "lane", "track", "track_goal", "cross_remaining", "ford_remaining", "ford_active", "retreating", "goal", "shield", "haste", "haste_until", "slow", "slow_until", "empower", "empower_until",
        "defense_bonus", "defense_until",
    ];
    let enemy_hero_fields = [
        "catalog_id", "level", "maturity", "formation", "energy", "skills", "hp", "max_hp", "attack", "defense",
        "speed", "range", "attack_interval", "vision", "x", "y", "node", "edge_to", "edge_progress", "lane", "track", "cross_remaining", "ford_remaining", "ford_active",
        "shield", "haste", "haste_until", "slow", "slow_until", "empower", "empower_until", "defense_bonus",
        "defense_until",
    ];
    let common_public = [
        "catalog_id", "hp", "max_hp", "attack", "defense", "speed", "range", "attack_interval", "vision", "x", "y",
        "node", "edge_to", "edge_progress", "lane", "track", "cross_remaining", "ford_remaining", "ford_active", "shield", "haste", "haste_until", "slow", "slow_until", "empower",
        "empower_until", "defense_bonus", "defense_until",
    ];
    let mut result = BTreeMap::new();
    result.insert(id("allies.heroes"), observed_collection(
        "hero", 5, Visibility::OwningSide, EntityOwnerSelector::OwnSide,
        current_fields("hero", &own_hero_fields), &["slot_id"], true,
    ));
    result.insert(id("enemies.visible_heroes"), observed_collection(
        "hero", 5, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide,
        current_fields("hero", &enemy_hero_fields), &[], false,
    ));
    result.insert(id("allies.minions"), observed_collection(
        "minion", MAX_ENTITIES, Visibility::OwningSide, EntityOwnerSelector::OwnSide,
        current_fields("minion", &common_public), &[], false,
    ));
    result.insert(id("enemies.visible_minions"), observed_collection(
        "minion", MAX_ENTITIES, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide,
        current_fields("minion", &common_public), &[], false,
    ));
    let mut monster_fields = common_public.to_vec();
    monster_fields.push("camp");
    result.insert(id("neutrals.visible_monsters"), observed_collection(
        "monster", MAX_ENTITIES, Visibility::EnemyVisible, EntityOwnerSelector::Unowned,
        current_fields("monster", &monster_fields), &[], false,
    ));
    result.insert(id("allies.towers"), observed_collection(
        "tower", MAX_ENTITIES, Visibility::OwningSide, EntityOwnerSelector::OwnSide,
        current_fields("tower", &common_public), &[], false,
    ));
    result.insert(id("enemies.visible_towers"), observed_collection(
        "tower", MAX_ENTITIES, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide,
        current_fields("tower", &common_public), &[], false,
    ));
    result.insert(id("allies.bases"), observed_collection(
        "base", 1, Visibility::OwningSide, EntityOwnerSelector::OwnSide,
        current_fields("base", &common_public), &[], false,
    ));
    result.insert(id("enemies.visible_bases"), observed_collection(
        "base", 1, Visibility::EnemyVisible, EntityOwnerSelector::OtherSide,
        current_fields("base", &common_public), &[], false,
    ));
    result.insert(id("battlefield.bridges"), observed_collection(
        "bridge", 3, Visibility::EnemyVisible, EntityOwnerSelector::Any,
        current_fields("bridge", &["site", "bridge_state", "hp", "max_hp", "build_remaining", "build_kind", "node", "edge_to", "edge_progress", "x", "y"]), &[], false,
    ));
    result.insert(id("battlefield.observations"), observed_collection(
        "observation", 1, Visibility::EnemyVisible, EntityOwnerSelector::Any,
        current_fields("observation", &["node", "capture_progress", "capture_owner", "capture_progress_side", "x", "y"]), &[], false,
    ));
    result
}

fn bridge_entity_schema() -> EntityTypeSchema {
    let mut fields = common_fields();
    fields.insert(id("builder"), field(DomainType::Optional(Box::new(entity_type("hero"))), Visibility::Internal, true));
    entity_schema(fields, None)
}

fn observation_entity_schema() -> EntityTypeSchema {
    entity_schema(common_fields(), None)
}

fn entity_type_schema(entity: &str, skill_ids: &BTreeSet<FieldId>) -> EntityTypeSchema {
    if entity == "bridge" { bridge_entity_schema() }
    else if entity == "observation" { observation_entity_schema() }
    else if entity == "hero" { hero_entity_schema(skill_ids) }
    else if entity == "monster" {
        entity_schema(common_fields().into_iter().chain([
            (id("camp"), field(string_type(MAX_STRING_BYTES), Visibility::Public, false)),
            (id("respawn_at"), field(tick_type(), Visibility::Internal, true)),
        ]).collect(), None)
    } else { entity_schema(common_fields(), None) }
}

fn capabilities() -> BTreeMap<CapabilityId, CapabilitySchema> {
    let hero = || entity_type("hero");
    let any_entity = || DomainType::Entity { entity_type: None };
    let mut result = BTreeMap::new();
    result.insert(id("move"), capability(
        vec![parameter("hero", hero()), parameter("node", string_type(MAX_STRING_BYTES))],
        Some(0), None, None, TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result.insert(id("pursue"), capability(
        vec![parameter("hero", hero()), parameter("target", any_entity())],
        Some(0), Some(1), None, TargetOwnerConstraint::Any,
        vec![],
    ));
    result.insert(id("retreat"), capability(
        vec![parameter("hero", hero())],
        Some(0), None, None, TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result.insert(id("activate"), capability(
        vec![parameter("hero", hero()), parameter("skill", string_type(MAX_STRING_BYTES)), parameter("target", any_entity())],
        Some(0), Some(2), None, TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result.insert(id("split"), capability(
        vec![parameter("hero", hero())],
        Some(0), None, None, TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result.insert(id("merge"), capability(
        vec![parameter("hero", hero()), parameter("other_hero", hero())],
        Some(0), Some(1), Some("hero"), TargetOwnerConstraint::OwnSide,
        vec![alive(EntitySelector::IntentActor), alive(EntitySelector::IntentTarget)],
    ));
    result.insert(id("regroup"), capability(
        vec![parameter("hero", hero()), parameter("other_hero", hero())],
        Some(0), Some(1), Some("hero"), TargetOwnerConstraint::OwnSide,
        vec![alive(EntitySelector::IntentActor), alive(EntitySelector::IntentTarget)],
    ));
    result.insert(id("select_track"), capability(
        vec![parameter("hero", hero()), parameter("track", enum_type("track"))],
        Some(0), None, None, TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result.insert(id("bridge_work"), capability(
        vec![parameter("hero", hero()), parameter("bridge", entity_type("bridge")), parameter("operation", enum_type("bridge_operation"))],
        Some(0), Some(1), Some("bridge"), TargetOwnerConstraint::Any,
        vec![alive(EntitySelector::IntentActor)],
    ));
    result
}

fn arbitration(max_intents: u32) -> BTreeMap<CapabilityId, ArbitrationRule> {
    ["move", "pursue", "retreat", "activate", "split", "merge", "regroup", "select_track", "bridge_work"]
        .into_iter()
        .map(|name| (
            id(name),
            ArbitrationRule {
                conflict_keys: if name == "bridge_work" { vec![IntentKey::Actor, IntentKey::Target] } else { vec![IntentKey::Actor] },
                resolution: ArbitrationResolution::SelectOrdered {
                    sort_by: vec![
                        IntentSortTerm { key: IntentKey::Priority, direction: SortDirection::Descending },
                        IntentSortTerm { key: IntentKey::ActionId, direction: SortDirection::Ascending },
                    ],
                    max_accepted: max_intents,
                },
            },
        ))
        .collect()
}

fn phases() -> Vec<ExecutionPhase> {
    [
        ("snapshot", 0, PhaseKind::Snapshot),
        ("tactical_evaluation", 1, PhaseKind::TacticalEvaluation),
        ("intent_validation", 2, PhaseKind::IntentValidation),
        ("arbitration", 3, PhaseKind::Arbitration),
        ("transition", 4, PhaseKind::Transition),
        ("termination", 5, PhaseKind::Termination),
    ]
    .into_iter()
    .map(|(name, order, kind)| ExecutionPhase { id: id(name), order, kind })
    .collect()
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
        version: NEXT_VERSION,
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
    let visible = [
        "catalog_id", "hp", "max_hp", "attack", "defense", "speed", "range", "attack_interval", "vision", "x", "y",
        "node", "edge_to", "edge_progress", "lane", "track", "cross_remaining", "ford_remaining", "ford_active", "shield", "haste", "haste_until", "slow", "slow_until", "empower",
        "empower_until", "defense_bonus", "defense_until",
    ].into_iter().map(id).collect::<BTreeSet<_>>();
    let mut hero = visible.clone();
    hero.extend(["level", "maturity", "formation", "energy", "skills"].into_iter().map(id));
    let mut monster = visible.clone();
    monster.insert(id("camp"));
    let bridge = ["site", "bridge_state", "hp", "max_hp", "build_remaining", "build_kind", "node", "edge_to", "edge_progress", "x", "y"]
        .into_iter().map(id).collect::<BTreeSet<_>>();
    let observation = ["node", "capture_progress", "capture_owner", "capture_progress_side", "x", "y"]
        .into_iter().map(id).collect::<BTreeSet<_>>();
    PresentationPolicy {
        visible_events: event_schemas(),
        visible_entity_fields: BTreeMap::from([
            (id("hero"), hero),
            (id("minion"), visible.clone()),
            (id("monster"), monster),
            (id("tower"), visible.clone()),
            (id("base"), visible),
            (id("bridge"), bridge),
            (id("observation"), observation),
        ]),
        visible_global_fields: BTreeSet::new(),
    }
}

fn event_schemas() -> BTreeMap<EventId, EventSchema> {
    let entity = DomainType::Entity { entity_type: None };
    let amount = int_type(0, MAX_INT);
    BTreeMap::from([
        (id("next.attack"), event([
            ("source", entity.clone()), ("target", entity.clone()), ("amount", amount.clone()),
        ])),
        (id("next.skill_damage"), event([
            ("source", entity.clone()), ("target", entity.clone()), ("amount", amount.clone()),
        ])),
        (id("next.skill"), event([
            ("source", entity.clone()), ("target", entity.clone()), ("skill", string_type(MAX_STRING_BYTES)),
        ])),
        (id("next.death"), event([
            ("source", DomainType::Optional(Box::new(entity.clone()))),
            ("target", DomainType::Optional(Box::new(entity.clone()))),
            ("amount", DomainType::Optional(Box::new(amount))),
        ])),
        (id("next.level_up"), event([("level", int_type(1, MAX_INT))])),
        (id("next.skill_acquired"), event([("skill", string_type(MAX_STRING_BYTES))])),
        (id("next.heal"), event([("amount", amount_type())])),
        (id("next.objective_destroyed"), event([("kind", string_type(MAX_STRING_BYTES))])),
        (id("next.neutral_respawn"), event([])),
        (id("next.bridge_state"), event([("site", string_type(16)), ("state", string_type(16))])),
        (id("next.observation_capture"), event([("owner", string_type(16))])),
    ])
}

fn amount_type() -> DomainType {
    int_type(0, MAX_INT)
}

fn event<const N: usize>(fields: [(&str, DomainType); N]) -> EventSchema {
    EventSchema { payload: fields.into_iter().map(|(name, ty)| (id(name), ty)).collect() }
}

fn observation_field(ty: DomainType, visibility: Visibility, source: ObservationSource) -> ObservationFieldSchema {
    ObservationFieldSchema { value_type: ty, visibility, source }
}

fn current_field(ty: DomainType, visibility: Visibility, name: &FieldId) -> ObservationFieldSchema {
    observation_field(ty, visibility, ObservationSource::CurrentEntityField { field: name.clone() })
}

fn observed_collection(
    entity: &str,
    max_items: u32,
    visibility: Visibility,
    owner: EntityOwnerSelector,
    visible_fields: BTreeMap<FieldId, ObservationFieldSchema>,
    unique_fields: &[&str],
    own_slots: bool,
) -> CollectionSchema {
    let unique_keys = std::iter::once(CollectionUniqueKey::EntityId)
        .chain(unique_fields.iter().map(|name| CollectionUniqueKey::Fields(vec![id(name)])))
        .collect();
    CollectionSchema {
        element_type: id(entity),
        max_items,
        visibility,
        source: CollectionSource::WorldEntities {
            entity_types: [id(entity)].into_iter().collect(),
            owner,
            filter: None,
        },
        visible_fields,
        order_by: if own_slots { vec![id("slot_id")] } else { Vec::new() },
        unique_keys,
    }
}

fn entity_schema(fields: BTreeMap<FieldId, FieldSchema>, default_owner: Option<CombatantSide>) -> EntityTypeSchema {
    EntityTypeSchema { fields, default_owner }
}

fn world_collection(entity: &str, max_items: u32) -> WorldCollectionSchema {
    WorldCollectionSchema {
        element_type: DomainType::Entity { entity_type: Some(id(entity)) },
        max_items,
    }
}

fn field(value_type: DomainType, visibility: Visibility, writable: bool) -> FieldSchema {
    FieldSchema { value_type, visibility, writable }
}

fn parameter(name: &str, value_type: DomainType) -> ParameterSchema {
    ParameterSchema { id: id(name), value_type, optional: false }
}

fn capability(
    arguments: Vec<ParameterSchema>,
    actor_argument: Option<u16>,
    target_argument: Option<u16>,
    target_type: Option<&str>,
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

fn alive(target: EntitySelector) -> RuleExpression {
    RuleExpression::LessThan {
        left: Box::new(int_lit(0)),
        right: Box::new(field_expr(target, "hp")),
    }
}

fn field_expr(target: EntitySelector, name: &str) -> RuleExpression {
    RuleExpression::Field { target, field: id(name) }
}

fn int_lit(value: i64) -> RuleExpression {
    RuleExpression::Literal(DomainValue::Integer(value))
}

fn enum_type(domain: &str) -> DomainType {
    let allowed = if domain == "track" { values(&["LEFT", "RIGHT"]) } else { values(&["expand", "rebuild", "destroy"]) };
    DomainType::Enum { domain: id(domain), values: allowed }
}

fn entity_type(name: &str) -> DomainType {
    DomainType::Entity { entity_type: Some(id(name)) }
}

fn record_type<const N: usize>(fields: [(&str, DomainType); N]) -> DomainType {
    DomainType::Record { fields: fields.into_iter().map(|(name, ty)| (id(name), ty)).collect() }
}

fn int_type(min: i64, max: i64) -> DomainType {
    DomainType::Integer { min: Some(min), max: Some(max) }
}

fn tick_type() -> DomainType {
    int_type(0, i64::from(u32::MAX))
}

fn string_type(max_bytes: u32) -> DomainType {
    DomainType::String { max_bytes }
}

fn values(names: &[&str]) -> BTreeSet<SymbolId> {
    names.iter().map(|name| id(name)).collect()
}

fn id<T: From<String>>(value: impl AsRef<str>) -> T {
    T::from(value.as_ref().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::initial::initial_package;

    fn next_rules() -> NextRules {
        let stats = UnitStats {
            hp: 100,
            attack: 12,
            defense: 4,
            speed: 10,
            range: 20,
            attack_interval: 5,
            vision: 100,
        };
        let hero = HeroDefinition {
            id: "vanguard".into(),
            name: "Vanguard".into(),
            placement: "front".into(),
            role: "tank".into(),
            trait_id: "steady".into(),
            appearance_key: "vanguard".into(),
            stats: stats.clone(),
            growth: stats.clone(),
            skills: vec![SkillDefinition {
                id: "brace".into(),
                name: "Brace".into(),
                passive: false,
                unlock_level: 1,
                prerequisites: Vec::new(),
                cooldown: 10,
                cost: 5,
                range: 100,
                target: "self".into(),
                effect: SkillEffect::Defense,
                power: 2,
                duration: 5,
            }],
            skill_paths: BTreeMap::new(),
            synergy: BTreeMap::new(),
        };
        NextRules {
            mechanics_version: NEXT_VERSION,
            map: BattleMap {
                id: "test".into(),
                nodes: BTreeMap::new(),
                edges: Vec::new(),
                lanes: BTreeMap::new(),
                attacker_base: "attacker_base".into(),
                defender_base: "defender_base".into(),
                towers: Vec::new(),
            },
            heroes: vec![hero],
            minions: Vec::new(),
            monsters: Vec::new(),
            camps: Vec::new(),
            parameters: BTreeMap::from([("max_match_ticks".into(), 375)]),
        }
    }

    #[test]
    fn next_configuration_replaces_the_legacy_domain_and_presentation() {
        let mut package = initial_package();
        package.next = Some(next_rules());
        configure(&mut package);

        assert_eq!(package.ruleset.id.as_str(), RULESET_ID);
        assert_eq!(package.minimum_engine_version, NEXT_ENGINE_VERSION);
        assert!(package.world_initialization.entities.is_empty());
        assert!(package.transitions.is_empty());
        assert_eq!(package.required_primitives.len(), 4);
        assert!(package.required_primitives.contains(&TransitionPrimitiveKind::BattleCombat));
        assert!(!package.world.entity_types.contains_key(&TypeId::from("unit")));
        assert!(!package.domain.collections.contains_key(&CollectionId::from("allies.units")));
        assert_eq!(package.termination.max_ticks, 375);
        assert!(package.termination.conditions.is_empty());

        let hero_type = &package.domain.senkei_configuration[&FieldId::from("heroes")].value_type;
        assert!(matches!(hero_type, DomainType::List { max_items: 5, .. }));
        assert!(package.domain.senkei_configuration[&FieldId::from("heroes")].required);
        assert_eq!(package.domain.capabilities.len(), 9);
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("select_track")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("bridge_work")));
        let track = &package.domain.capabilities[&CapabilityId::from("select_track")];
        assert!(matches!(track.arguments[1].value_type, DomainType::Enum { ref domain, .. } if domain == &SymbolDomainId::from("track")));
        let bridge_work = &package.domain.capabilities[&CapabilityId::from("bridge_work")];
        assert_eq!(bridge_work.target_type.as_ref(), Some(&TypeId::from("bridge")));
        assert!(matches!(bridge_work.arguments[2].value_type, DomainType::Enum { ref domain, .. } if domain == &SymbolDomainId::from("bridge_operation")));
        assert!(package.world.entity_types[&TypeId::from("bridge")].fields.contains_key(&FieldId::from("build_remaining")));
        assert!(package.world.entity_types[&TypeId::from("observation")].fields.contains_key(&FieldId::from("capture_progress_side")));
        let movement_fields = &package.world.entity_types[&TypeId::from("hero")].fields;
        assert_eq!(movement_fields[&FieldId::from("ford_active")].visibility, Visibility::Public);
        assert_eq!(movement_fields[&FieldId::from("track_goal")].visibility, Visibility::OwningSide);
        assert_eq!(movement_fields[&FieldId::from("retreating")].visibility, Visibility::OwningSide);
        assert_eq!(movement_fields[&FieldId::from("action_lock_until")].visibility, Visibility::OwningSide);
        for field in ["moved_tick", "move_intent_tick", "track_intent_tick", "track_wait_ticks"] {
            assert_eq!(movement_fields[&FieldId::from(field)].visibility, Visibility::Internal);
        }
        let bridge_view = &package.domain.collections[&CollectionId::from("battlefield.bridges")];
        assert!(bridge_view.visible_fields.contains_key(&FieldId::from("edge_progress")));
        assert!(!bridge_view.visible_fields.contains_key(&FieldId::from("builder")));
        let observation_view = &package.domain.collections[&CollectionId::from("battlefield.observations")];
        assert!(observation_view.visible_fields.contains_key(&FieldId::from("capture_progress_side")));
        assert!(!observation_view.visible_fields.contains_key(&FieldId::from("builder")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("pursue")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("activate")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("split")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("merge")));
        assert!(package.domain.capabilities.contains_key(&CapabilityId::from("regroup")));
        assert_eq!(
            package.world.entity_types[&TypeId::from("hero")].fields[&FieldId::from("target")].value_type,
            DomainType::Optional(Box::new(DomainType::Entity { entity_type: None })),
        );
        assert!(package.world.entity_types[&TypeId::from("hero")].fields.contains_key(&FieldId::from("death_tick")));
        assert!(package.world.entity_types[&TypeId::from("hero")].fields.contains_key(&FieldId::from("reveal_attacker_until")));
        assert!(package.world.entity_types[&TypeId::from("hero")].fields.contains_key(&FieldId::from("defense_bonus")));
        assert!(package.world.entity_types[&TypeId::from("hero")].fields.contains_key(&FieldId::from("cooldowns")));
        assert!(matches!(
            package.world.entity_types[&TypeId::from("hero")].fields[&FieldId::from("cooldowns")].value_type,
            DomainType::Record { .. }
        ));
    }

    #[test]
    fn hero_collections_keep_identity_and_private_tactical_state_separate() {
        let mut package = initial_package();
        package.next = Some(next_rules());
        configure(&mut package);

        let own = &package.domain.collections[&CollectionId::from("allies.heroes")];
        let enemy = &package.domain.collections[&CollectionId::from("enemies.visible_heroes")];
        assert!(own.visible_fields.contains_key(&FieldId::from("slot_id")));
        assert!(own.visible_fields.contains_key(&FieldId::from("skill_path")));
        assert!(own.visible_fields.contains_key(&FieldId::from("cooldowns")));
        assert!(!enemy.visible_fields.contains_key(&FieldId::from("slot_id")));
        assert!(!enemy.visible_fields.contains_key(&FieldId::from("skill_path")));
        assert!(!enemy.visible_fields.contains_key(&FieldId::from("cooldowns")));
        assert!(!enemy.visible_fields.contains_key(&FieldId::from("goal")));
        assert!(own.unique_keys.contains(&CollectionUniqueKey::Fields(vec![FieldId::from("slot_id")])));
        assert!(own.unique_keys.contains(&CollectionUniqueKey::EntityId));
        assert!(enemy.unique_keys.contains(&CollectionUniqueKey::EntityId));
        assert!(package.presentation.visible_entity_fields[&TypeId::from("hero")].contains(&FieldId::from("catalog_id")));
        assert!(!package.presentation.visible_entity_fields[&TypeId::from("hero")].contains(&FieldId::from("cooldowns")));
    }
}
