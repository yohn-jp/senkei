//! Provisional finite content for `senkei.next` 1.0.0.
//!
//! This module owns game data only. The numbers below are initial tuning
//! values, not engine defaults; see `docs/implementation/NEXT-PARAMETERS.md`.

use senkei_model::{
    BattleMap, CampDefinition, HeroDefinition, NextRules, SkillDefinition, SkillEffect,
    UnitDefinition, UnitStats, Version,
};
use std::collections::BTreeMap;

/// Builds the initial versioned catalog and world parameters around W1's map.
pub fn content(map: BattleMap) -> NextRules {
    let heroes = HEROES.iter().map(build_hero).collect();

    let minions = vec![
        unit(
            "minion_melee",
            [90, 18, 6, 26, 45, 4, 180],
            20,
        ),
        unit(
            "minion_ranged",
            [62, 14, 3, 24, 130, 5, 180],
            20,
        ),
    ];

    let monsters = vec![
        unit(
            "monster_grove_brute",
            [210, 32, 12, 30, 55, 4, 150],
            90,
        ),
        unit(
            "monster_iron_warden",
            [340, 38, 22, 20, 65, 5, 180],
            150,
        ),
        unit(
            "monster_storm_stalker",
            [170, 44, 9, 58, 95, 3, 220],
            110,
        ),
    ];

    let camps = vec![
        CampDefinition {
            id: "camp_nw".into(),
            node: "jungle_nw".into(),
            monster: "monster_grove_brute".into(),
            respawn_ticks: 90,
        },
        CampDefinition {
            id: "camp_center".into(),
            node: "jungle_center".into(),
            monster: "monster_iron_warden".into(),
            respawn_ticks: 120,
        },
        CampDefinition {
            id: "camp_se".into(),
            node: "jungle_se".into(),
            monster: "monster_storm_stalker".into(),
            respawn_ticks: 90,
        },
    ];

    NextRules {
        mechanics_version: Version::new(1, 0, 0),
        map,
        heroes,
        minions,
        monsters,
        camps,
        parameters: parameters(),
    }
}

fn parameters() -> BTreeMap<String, i64> {
    BTreeMap::from([
        // Multipliers are integer per-mille values. These three families are
        // the agreed initial movement ratios from WORLD.md and UNITS.md.
        ("terrain_lane_speed_milli".into(), 1_000),
        ("terrain_jungle_speed_milli".into(), 800),
        ("minion_vision_speed_milli".into(), 1_200),
        ("squad_1_speed_milli".into(), 1_000),
        ("squad_2_speed_milli".into(), 950),
        ("squad_3_speed_milli".into(), 900),
        ("squad_4_speed_milli".into(), 850),
        ("squad_5_speed_milli".into(), 800),
        // Minion cadence and sensor radius are implementation starting points.
        ("minion_spawn_interval".into(), 30),
        ("minion_vision".into(), 180),
        // Hero start and finite progression values.
        ("hero_start_level".into(), 1),
        ("hero_start_xp".into(), 0),
        ("hero_initial_energy".into(), 100),
        ("hero_max_energy".into(), 100),
        ("hero_energy_regen_per_tick".into(), 1),
        ("hero_max_level".into(), 6),
        ("hero_xp_per_level".into(), 100),
        ("hero_respawn_base_ticks".into(), 20),
        ("hero_respawn_per_level_ticks".into(), 5),
        ("hero_kill_xp".into(), 80),
        ("xp_eligibility_range".into(), 250),
        ("structure_tower_xp".into(), 120),
        ("structure_base_xp".into(), 0),
        // Match duration and tick scale are provisional versioned limits.
        ("max_match_ticks".into(), 600),
        ("tick_duration_ms".into(), 100),
        // Coordination/reassembly numbers are provisional, measured in map
        // units and ticks respectively.
        ("squad_maturation_ticks".into(), 40),
        ("squad_merge_distance".into(), 30),
        // Objective combat values apply uniformly to W1's tower placements.
        ("structure_tower_hp".into(), 1_200),
        ("structure_tower_attack".into(), 60),
        ("structure_tower_defense".into(), 20),
        ("structure_tower_range".into(), 200),
        ("structure_tower_attack_interval".into(), 4),
        ("structure_tower_vision".into(), 220),
        ("structure_base_hp".into(), 2_400),
        ("structure_base_attack".into(), 0),
        ("structure_base_defense".into(), 25),
        ("structure_base_range".into(), 0),
        ("structure_base_attack_interval".into(), 1),
        ("structure_base_vision".into(), 260),
    ])
}

fn unit(id: &str, stats_values: [i64; 7], xp: i64) -> UnitDefinition {
    UnitDefinition {
        id: id.into(),
        stats: stats(stats_values),
        xp,
    }
}

fn stats(values: [i64; 7]) -> UnitStats {
    UnitStats {
        hp: values[0],
        attack: values[1],
        defense: values[2],
        speed: values[3],
        range: values[4],
        attack_interval: values[5],
        vision: values[6],
    }
}

#[derive(Clone)]
struct SkillSpec {
    name: &'static str,
    effect: SkillEffect,
    power: i64,
    duration: i64,
    range: i64,
    target: &'static str,
    cooldown: i64,
    cost: i64,
}

#[derive(Clone)]
struct BranchSpec {
    passive: SkillSpec,
    active: SkillSpec,
}

#[derive(Clone)]
struct HeroSpec {
    id: &'static str,
    name: &'static str,
    placement: &'static str,
    role: &'static str,
    trait_id: &'static str,
    stats: [i64; 7],
    growth: [i64; 7],
    branches: [BranchSpec; 2],
}

const fn passive(name: &'static str, effect: SkillEffect, power: i64) -> SkillSpec {
    SkillSpec {
        name,
        effect,
        power,
        duration: 0,
        range: 0,
        target: "self",
        cooldown: 0,
        cost: 0,
    }
}

const fn active(
    name: &'static str,
    effect: SkillEffect,
    power: i64,
    duration: i64,
    range: i64,
    target: &'static str,
    cooldown: i64,
    cost: i64,
) -> SkillSpec {
    SkillSpec {
        name,
        effect,
        power,
        duration,
        range,
        target,
        cooldown,
        cost,
    }
}

const HEROES: [HeroSpec; 12] = [
    HeroSpec {
        id: "F01",
        name: "Bannerhold",
        placement: "frontline",
        role: "defense",
        trait_id: "command",
        stats: [260, 32, 24, 48, 85, 4, 190],
        growth: [22, 3, 3, 0, 0, 0, 4],
        branches: [
            BranchSpec {
                passive: passive("Steadfast Standard", SkillEffect::Defense, 4),
                active: active("Rallying Guard", SkillEffect::Shield, 30, 4, 100, "ally", 8, 20),
            },
            BranchSpec {
                passive: passive("War Chorus", SkillEffect::Empower, 3),
                active: active("Marching Call", SkillEffect::Haste, 120, 3, 180, "ally", 10, 24),
            },
        ],
    },
    HeroSpec {
        id: "F02",
        name: "Stoneheart",
        placement: "frontline",
        role: "defense",
        trait_id: "sustain",
        stats: [285, 28, 27, 43, 70, 4, 175],
        growth: [25, 2, 3, 0, 0, 0, 3],
        branches: [
            BranchSpec {
                passive: passive("Second Wind", SkillEffect::Shield, 16),
                active: active("Mend the Line", SkillEffect::Heal, 34, 0, 110, "ally", 8, 18),
            },
            BranchSpec {
                passive: passive("Granite Hide", SkillEffect::Defense, 5),
                active: active("Stone Shelter", SkillEffect::Shield, 36, 5, 70, "self", 10, 24),
            },
        ],
    },
    HeroSpec {
        id: "F03",
        name: "Breach",
        placement: "frontline",
        role: "damage",
        trait_id: "assault",
        stats: [220, 43, 16, 54, 80, 3, 180],
        growth: [18, 5, 1, 0, 0, 0, 3],
        branches: [
            BranchSpec {
                passive: passive("Siegebreaker", SkillEffect::Empower, 5),
                active: active("Armor Rupture", SkillEffect::Damage, 45, 0, 90, "enemy", 8, 24),
            },
            BranchSpec {
                passive: passive("Relentless Advance", SkillEffect::Haste, 100),
                active: active("Driving Blow", SkillEffect::Damage, 34, 0, 100, "enemy", 7, 20),
            },
        ],
    },
    HeroSpec {
        id: "F04",
        name: "Rook",
        placement: "frontline",
        role: "damage",
        trait_id: "skirmish",
        stats: [195, 39, 13, 68, 75, 3, 225],
        growth: [15, 4, 1, 1, 0, 0, 5],
        branches: [
            BranchSpec {
                passive: passive("Quickstep", SkillEffect::Haste, 100),
                active: active("Cut Across", SkillEffect::Damage, 32, 0, 100, "enemy", 7, 18),
            },
            BranchSpec {
                passive: passive("Opportunist", SkillEffect::Empower, 3),
                active: active("Hamstring", SkillEffect::Slow, 180, 3, 120, "enemy", 9, 20),
            },
        ],
    },
    HeroSpec {
        id: "F05",
        name: "Lockstep",
        placement: "frontline",
        role: "support",
        trait_id: "control",
        stats: [225, 27, 17, 52, 95, 4, 190],
        growth: [19, 2, 2, 0, 0, 0, 4],
        branches: [
            BranchSpec {
                passive: passive("Grounded Stance", SkillEffect::Defense, 3),
                active: active("Pinning Mark", SkillEffect::Slow, 220, 3, 130, "enemy", 10, 22),
            },
            BranchSpec {
                passive: passive("Field Rations", SkillEffect::Shield, 12),
                active: active("Covering Ward", SkillEffect::Shield, 30, 4, 130, "ally", 8, 20),
            },
        ],
    },
    HeroSpec {
        id: "F06",
        name: "Pathfinder",
        placement: "frontline",
        role: "support",
        trait_id: "recon",
        stats: [190, 24, 12, 65, 125, 4, 285],
        growth: [16, 2, 1, 1, 0, 0, 7],
        branches: [
            BranchSpec {
                passive: passive("Trail Runner", SkillEffect::Haste, 100),
                active: active("Flare Signal", SkillEffect::Reveal, 1, 4, 260, "enemy", 10, 20),
            },
            BranchSpec {
                passive: passive("Fieldcraft", SkillEffect::Empower, 2),
                active: active("Scout's Pace", SkillEffect::Haste, 150, 3, 220, "ally", 9, 20),
            },
        ],
    },
    HeroSpec {
        id: "R01",
        name: "Tempest",
        placement: "backline",
        role: "damage",
        trait_id: "control",
        stats: [180, 41, 11, 48, 190, 4, 240],
        growth: [14, 4, 1, 0, 0, 0, 5],
        branches: [
            BranchSpec {
                passive: passive("Gathering Storm", SkillEffect::Empower, 4),
                active: active("Storm Lance", SkillEffect::Damage, 42, 0, 210, "enemy", 9, 24),
            },
            BranchSpec {
                passive: passive("Eye of the Gale", SkillEffect::Defense, 2),
                active: active("Crosswind", SkillEffect::Slow, 180, 3, 210, "enemy", 10, 24),
            },
        ],
    },
    HeroSpec {
        id: "R02",
        name: "Farshot",
        placement: "backline",
        role: "damage",
        trait_id: "assault",
        stats: [165, 52, 8, 45, 260, 5, 270],
        growth: [13, 6, 1, 0, 0, 0, 4],
        branches: [
            BranchSpec {
                passive: passive("Deadeye", SkillEffect::Empower, 6),
                active: active("Piercing Volley", SkillEffect::Damage, 56, 0, 340, "enemy", 11, 30),
            },
            BranchSpec {
                passive: passive("Steady Aim", SkillEffect::Haste, 80),
                active: active("Measured Shot", SkillEffect::Damage, 42, 0, 300, "enemy", 8, 22),
            },
        ],
    },
    HeroSpec {
        id: "R03",
        name: "Farwatch",
        placement: "backline",
        role: "damage",
        trait_id: "recon",
        stats: [170, 39, 9, 54, 320, 5, 330],
        growth: [14, 4, 1, 0, 0, 0, 7],
        branches: [
            BranchSpec {
                passive: passive("Long Sight", SkillEffect::Empower, 3),
                active: active("Horizon Flare", SkillEffect::Reveal, 1, 4, 420, "enemy", 10, 20),
            },
            BranchSpec {
                passive: passive("Light Footfall", SkillEffect::Haste, 80),
                active: active("Distant Mark", SkillEffect::Damage, 35, 0, 390, "enemy", 8, 20),
            },
        ],
    },
    HeroSpec {
        id: "R04",
        name: "Lifeline",
        placement: "backline",
        role: "support",
        trait_id: "sustain",
        stats: [190, 20, 12, 48, 180, 4, 235],
        growth: [16, 2, 1, 0, 0, 0, 5],
        branches: [
            BranchSpec {
                passive: passive("Restorative Training", SkillEffect::Shield, 14),
                active: active("Restoring Pulse", SkillEffect::Heal, 42, 0, 250, "ally", 7, 20),
            },
            BranchSpec {
                passive: passive("Protective Drill", SkillEffect::Defense, 2),
                active: active("Safe Passage", SkillEffect::Shield, 34, 4, 210, "ally", 8, 20),
            },
        ],
    },
    HeroSpec {
        id: "R05",
        name: "Conductor",
        placement: "backline",
        role: "support",
        trait_id: "command",
        stats: [180, 25, 11, 50, 185, 4, 250],
        growth: [15, 2, 1, 0, 0, 0, 6],
        branches: [
            BranchSpec {
                passive: passive("Clear Orders", SkillEffect::Defense, 2),
                active: active("Focus Fire", SkillEffect::Empower, 15, 3, 250, "ally", 10, 24),
            },
            BranchSpec {
                passive: passive("Tempo Keeper", SkillEffect::Haste, 80),
                active: active("Quick Formation", SkillEffect::Haste, 180, 4, 250, "ally", 11, 26),
            },
        ],
    },
    HeroSpec {
        id: "R06",
        name: "Aegis",
        placement: "backline",
        role: "defense",
        trait_id: "skirmish",
        stats: [220, 30, 16, 55, 165, 4, 225],
        growth: [19, 3, 2, 0, 0, 0, 4],
        branches: [
            BranchSpec {
                passive: passive("Rear Guard", SkillEffect::Defense, 4),
                active: active("Backline Shelter", SkillEffect::Shield, 38, 4, 190, "ally", 8, 20),
            },
            BranchSpec {
                passive: passive("Escape Drill", SkillEffect::Haste, 80),
                active: active("Withdrawal Signal", SkillEffect::Haste, 200, 3, 190, "ally", 10, 22),
            },
        ],
    },
];

fn build_hero(spec: &HeroSpec) -> HeroDefinition {
    let prefix = spec.id.to_ascii_lowercase();
    let mut skills = Vec::with_capacity(4);
    let mut skill_paths = BTreeMap::new();
    for (branch_index, branch) in spec.branches.iter().enumerate() {
        let branch_name = if branch_index == 0 { "a" } else { "b" };
        let passive_id = format!("{prefix}_{branch_name}_passive");
        let active_id = format!("{prefix}_{branch_name}_active");
        skills.push(skill_definition(&passive_id, branch.passive.clone(), true, 2, vec![]));
        skills.push(skill_definition(
            &active_id,
            branch.active.clone(),
            false,
            4,
            vec![passive_id.clone()],
        ));
        skill_paths.insert(
            format!("path_{branch_name}"),
            vec![passive_id, active_id],
        );
    }

    let command_trait = spec.trait_id == "command";
    let support_role = spec.role == "support";
    HeroDefinition {
        id: spec.id.into(),
        name: spec.name.into(),
        placement: spec.placement.into(),
        role: spec.role.into(),
        trait_id: spec.trait_id.into(),
        appearance_key: format!("senkei.next.hero.{}", prefix),
        stats: stats(spec.stats),
        growth: stats(spec.growth),
        skills,
        skill_paths,
        synergy: BTreeMap::from([
            (
                "maturity_effect_milli".into(),
                if command_trait { 1_150 } else { 1_000 },
            ),
            (
                "ally_skill_effect_milli".into(),
                if support_role { 1_100 } else { 1_000 },
            ),
        ]),
    }
}

fn skill_definition(
    id: &str,
    spec: SkillSpec,
    passive: bool,
    unlock_level: i64,
    prerequisites: Vec<String>,
) -> SkillDefinition {
    SkillDefinition {
        id: id.into(),
        name: spec.name.into(),
        passive,
        unlock_level,
        prerequisites,
        cooldown: spec.cooldown,
        cost: spec.cost,
        range: spec.range,
        target: spec.target.into(),
        effect: spec.effect,
        power: spec.power,
        duration: spec.duration,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senkei_model::{MapNode, TowerPlacement};

    fn sample_map() -> BattleMap {
        let nodes = ["jungle_nw", "jungle_center", "jungle_se"]
            .into_iter()
            .map(|id| {
                (
                    id.to_owned(),
                    MapNode {
                        x: 100,
                        y: 100,
                        region: "jungle".into(),
                    },
                )
            })
            .collect();
        BattleMap {
            id: "test-map".into(),
            nodes,
            edges: vec![],
            lanes: BTreeMap::new(),
            attacker_base: "attacker_base".into(),
            defender_base: "defender_base".into(),
            towers: vec![TowerPlacement {
                id: "tower_attacker_top".into(),
                node: "top_1".into(),
                side: "attacker".into(),
                lane: "top".into(),
            }],
        }
    }

    #[test]
    fn catalog_has_the_canonical_twelve_roles() {
        let rules = content(sample_map());
        let catalog: BTreeMap<_, _> = rules.heroes.iter().map(|hero| (hero.id.as_str(), hero)).collect();
        assert_eq!(catalog.len(), 12);
        for id in ["F01", "F02", "F03", "F04", "F05", "F06", "R01", "R02", "R03", "R04", "R05", "R06"] {
            assert!(catalog.contains_key(id), "missing {id}");
        }
        assert_eq!(("frontline", "defense", "command"), (
            catalog["F01"].placement.as_str(), catalog["F01"].role.as_str(), catalog["F01"].trait_id.as_str()
        ));
        assert_eq!(("backline", "defense", "skirmish"), (
            catalog["R06"].placement.as_str(), catalog["R06"].role.as_str(), catalog["R06"].trait_id.as_str()
        ));
    }

    #[test]
    fn each_preconfigured_path_is_a_distinct_passive_then_active_branch() {
        let rules = content(sample_map());
        for hero in &rules.heroes {
            assert_eq!(hero.skill_paths.len(), 2, "{}", hero.id);
            assert_eq!(hero.skills.len(), 4, "{}", hero.id);
            for path in ["path_a", "path_b"] {
                let ids = &hero.skill_paths[path];
                assert_eq!(ids.len(), 2);
                let passive = hero.skills.iter().find(|skill| skill.id == ids[0]).unwrap();
                let active = hero.skills.iter().find(|skill| skill.id == ids[1]).unwrap();
                assert!(passive.passive);
                assert!(!active.passive);
                assert_eq!(passive.unlock_level, 2);
                assert_eq!(active.unlock_level, 4);
                assert_eq!(active.prerequisites, vec![passive.id.clone()]);
            }
            assert_ne!(hero.skill_paths["path_a"], hero.skill_paths["path_b"]);
        }
    }

    #[test]
    fn world_content_uses_the_fixed_map_camp_nodes_and_finite_parameters() {
        let rules = content(sample_map());
        assert_eq!(rules.camps.len(), 3);
        assert_eq!(rules.camps[0].node, "jungle_nw");
        assert_eq!(rules.camps[1].node, "jungle_center");
        assert_eq!(rules.camps[2].node, "jungle_se");
        assert_eq!(rules.parameters["terrain_jungle_speed_milli"], 800);
        assert_eq!(rules.parameters["minion_vision_speed_milli"], 1_200);
        assert_eq!(rules.parameters["squad_5_speed_milli"], 800);
        assert_eq!(rules.parameters["hero_max_level"], 6);
        assert_eq!(rules.minions.len(), 2);
        assert_eq!(rules.monsters.len(), 3);
    }
}
