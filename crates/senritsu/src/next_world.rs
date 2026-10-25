//! Versioned logical Battlefield topology for `senkei.next`.
//!
//! Coordinates only arrange the authored battlefield. Edge identities,
//! endpoint membership, length, terrain and fixed bridge site are the rules.

use senkei_model::{BattleMap, MapEdge, MapNode, TowerPlacement};
use std::collections::BTreeMap;

pub const BATTLEFIELD_MAP_ID: &str = "senkei-battlefield-v2";

/// Construct the canonical 35-node, 42-edge battlefield from BATTLEFIELD.md.
pub fn battle_map() -> BattleMap {
    let mut nodes = BTreeMap::new();
    let mut add_node = |id: &str, x: i64, y: i64, region: &str, allegiance: &str| {
        nodes.insert(
            id.into(),
            MapNode {
                x,
                y,
                region: region.into(),
                allegiance: allegiance.into(),
            },
        );
    };
    add_node("A.BASE", 80, 1520, "base", "A");
    add_node("B.BASE", 1520, 80, "base", "B");
    for (id, x, y, region, allegiance) in [
        // TOP forms the upper outer arc. B-side coordinates transpose the A
        // side across the diagonal river rather than crowding the MID route.
        ("A.TOP.T1", 220, 1200, "top", "A"),
        ("A.TOP.T2", 220, 850, "top", "A"),
        ("A.TOP.J", 260, 520, "top", "A"),
        ("A.TOP.BANK", 380, 400, "riverbank", "A"),
        ("B.TOP.BANK", 400, 380, "riverbank", "B"),
        ("B.TOP.J", 520, 260, "top", "B"),
        ("B.TOP.T2", 850, 220, "top", "B"),
        ("B.TOP.T1", 1200, 220, "top", "B"),
        // MID remains on x + y = 1600 and frames the river-island objective.
        ("A.MID.T1", 330, 1270, "mid", "A"),
        ("A.MID.T2", 510, 1090, "mid", "A"),
        ("A.MID.J", 650, 950, "mid", "A"),
        ("A.MID.BANK", 735, 865, "riverbank", "A"),
        ("B.MID.BANK", 865, 735, "riverbank", "B"),
        ("B.MID.J", 950, 650, "mid", "B"),
        ("B.MID.T2", 1090, 510, "mid", "B"),
        ("B.MID.T1", 1270, 330, "mid", "B"),
        // BOT occupies the lower outer arc, mirrored with TOP by side.
        ("A.BOT.T1", 340, 1440, "bot", "A"),
        ("A.BOT.T2", 700, 1380, "bot", "A"),
        ("A.BOT.J", 1080, 1340, "bot", "A"),
        ("A.BOT.BANK", 1200, 1220, "riverbank", "A"),
        ("B.BOT.BANK", 1220, 1200, "riverbank", "B"),
        ("B.BOT.J", 1340, 1080, "bot", "B"),
        ("B.BOT.T2", 1380, 700, "bot", "B"),
        ("B.BOT.T1", 1440, 340, "bot", "B"),
        ("N.MID.OBS", 800, 800, "observation", "N"),
        // Upper/lower jungle crossings meet the diagonal river between fixed
        // bridge sites. Camp terminals sit off the jungle trunk paths.
        ("N.A.UJ", 450, 700, "jungle", "N"),
        ("N.B.UJ", 700, 450, "jungle", "N"),
        ("N.A.LJ", 930, 1150, "jungle", "N"),
        ("N.B.LJ", 1150, 930, "jungle", "N"),
        ("N.A.UC", 350, 780, "camp", "N"),
        ("N.B.UC", 780, 350, "camp", "N"),
        ("N.A.LC", 700, 1220, "camp", "N"),
        ("N.B.LC", 1220, 700, "camp", "N"),
    ] {
        add_node(id, x, y, region, allegiance);
    }

    let mut edges = Vec::with_capacity(42);
    let mut add_edge = |id: &str,
                        from: &str,
                        to: &str,
                        length: i64,
                        region: &str,
                        bridge_site: &str,
                        ford: bool| {
        edges.push(MapEdge {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            length,
            region: region.into(),
            blocked: false,
            bridge_site: bridge_site.into(),
            ford,
        });
    };
    for lane in ["TOP", "MID", "BOT"] {
        let a = format!("A.{lane}");
        let b = format!("B.{lane}");
        add_edge(
            &format!("lane.{lane}.a-base-t1"),
            "A.BASE",
            &format!("{a}.T1"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-t1-t2"),
            &format!("{a}.T1"),
            &format!("{a}.T2"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-t2-j"),
            &format!("{a}.T2"),
            &format!("{a}.J"),
            100,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.a-j-bank"),
            &format!("{a}.J"),
            &format!("{a}.BANK"),
            50,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-bank-j"),
            &format!("{b}.BANK"),
            &format!("{b}.J"),
            50,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-j-t2"),
            &format!("{b}.J"),
            &format!("{b}.T2"),
            100,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-t2-t1"),
            &format!("{b}.T2"),
            &format!("{b}.T1"),
            150,
            "lane",
            "",
            false,
        );
        add_edge(
            &format!("lane.{lane}.b-t1-base"),
            &format!("{b}.T1"),
            "B.BASE",
            150,
            "lane",
            "",
            false,
        );
    }
    add_edge(
        "bridge.TOP",
        "A.TOP.BANK",
        "B.TOP.BANK",
        100,
        "bridge",
        "TOP",
        false,
    );
    add_edge(
        "bridge.BOT",
        "A.BOT.BANK",
        "B.BOT.BANK",
        100,
        "bridge",
        "BOT",
        false,
    );
    add_edge(
        "bridge.MID.A",
        "A.MID.BANK",
        "N.MID.OBS",
        50,
        "bridge",
        "MID",
        false,
    );
    add_edge(
        "bridge.MID.B",
        "N.MID.OBS",
        "B.MID.BANK",
        50,
        "bridge",
        "MID",
        false,
    );
    for (side, upper, middle, lower) in [("A", "TOP", "MID", "BOT"), ("B", "TOP", "MID", "BOT")] {
        add_edge(
            &format!("jungle.{side}.upper-1"),
            &format!("{side}.{upper}.J"),
            &format!("N.{side}.UJ"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.upper-2"),
            &format!("N.{side}.UJ"),
            &format!("{side}.{middle}.J"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-1"),
            &format!("{side}.{middle}.J"),
            &format!("N.{side}.LJ"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-2"),
            &format!("N.{side}.LJ"),
            &format!("{side}.{lower}.J"),
            325,
            "jungle",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.upper-camp"),
            &format!("N.{side}.UJ"),
            &format!("N.{side}.UC"),
            45,
            "jungle_camp",
            "",
            false,
        );
        add_edge(
            &format!("jungle.{side}.lower-camp"),
            &format!("N.{side}.LJ"),
            &format!("N.{side}.LC"),
            45,
            "jungle_camp",
            "",
            false,
        );
    }
    add_edge(
        "ford.jungle.upper",
        "N.A.UJ",
        "N.B.UJ",
        620,
        "river_ford",
        "",
        true,
    );
    add_edge(
        "ford.jungle.lower",
        "N.A.LJ",
        "N.B.LJ",
        620,
        "river_ford",
        "",
        true,
    );

    let lanes = BTreeMap::from([
        (
            "top".into(),
            [
                "A.BASE",
                "A.TOP.T1",
                "A.TOP.T2",
                "A.TOP.J",
                "A.TOP.BANK",
                "B.TOP.BANK",
                "B.TOP.J",
                "B.TOP.T2",
                "B.TOP.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "mid".into(),
            [
                "A.BASE",
                "A.MID.T1",
                "A.MID.T2",
                "A.MID.J",
                "A.MID.BANK",
                "N.MID.OBS",
                "B.MID.BANK",
                "B.MID.J",
                "B.MID.T2",
                "B.MID.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "bot".into(),
            [
                "A.BASE",
                "A.BOT.T1",
                "A.BOT.T2",
                "A.BOT.J",
                "A.BOT.BANK",
                "B.BOT.BANK",
                "B.BOT.J",
                "B.BOT.T2",
                "B.BOT.T1",
                "B.BASE",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
    ]);
    let towers = ["TOP", "MID", "BOT"]
        .into_iter()
        .flat_map(|lane| {
            [
                TowerPlacement {
                    id: format!("tower_a_{lane}_t1"),
                    node: format!("A.{lane}.T1"),
                    side: "attacker".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_a_{lane}_t2"),
                    node: format!("A.{lane}.T2"),
                    side: "attacker".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_b_{lane}_t1"),
                    node: format!("B.{lane}.T1"),
                    side: "defender".into(),
                    lane: lane.to_lowercase(),
                },
                TowerPlacement {
                    id: format!("tower_b_{lane}_t2"),
                    node: format!("B.{lane}.T2"),
                    side: "defender".into(),
                    lane: lane.to_lowercase(),
                },
            ]
        })
        .collect();
    BattleMap {
        id: BATTLEFIELD_MAP_ID.into(),
        nodes,
        edges,
        lanes,
        attacker_base: "A.BASE".into(),
        defender_base: "B.BASE".into(),
        towers,
    }
}

/// Exact arithmetic time over a route, using distance and terrain millirates.
#[cfg(test)]
pub fn normalized_route_time_milli(distance: i64, terrain_speed_milli: i64) -> Option<i64> {
    if distance < 0 || terrain_speed_milli <= 0 {
        return None;
    }
    i64::try_from(i128::from(distance).checked_mul(1_000_000)? / i128::from(terrain_speed_milli))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    fn edge_exists(map: &BattleMap, a: &str, b: &str) -> bool {
        map.edges
            .iter()
            .any(|e| (e.from == a && e.to == b) || (e.from == b && e.to == a))
    }
    fn path_distance(map: &BattleMap, route: &[String]) -> i64 {
        route
            .windows(2)
            .map(|w| {
                map.edges
                    .iter()
                    .find(|e| (e.from == w[0] && e.to == w[1]) || (e.from == w[1] && e.to == w[0]))
                    .expect("connected consecutive nodes")
                    .length
            })
            .sum()
    }
    fn route_distance(map: &BattleMap, lane: &str) -> i64 {
        path_distance(map, &map.lanes[lane])
    }

    #[test]
    fn canonical_topology_has_exact_ids_edges_sites_and_no_hidden_shortcuts() {
        let map = battle_map();
        assert_eq!(map.id, BATTLEFIELD_MAP_ID);
        assert_eq!(map.nodes.len(), 35);
        assert_eq!(map.edges.len(), 42);
        assert_eq!(map.towers.len(), 12);
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "A").count(),
            13
        );
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "B").count(),
            13
        );
        assert_eq!(
            map.nodes.values().filter(|n| n.allegiance == "N").count(),
            9
        );
        let ids: BTreeSet<_> = map.nodes.keys().collect();
        assert_eq!(ids.len(), 35);
        let edge_ids: BTreeSet<_> = map.edges.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(edge_ids.len(), 42);
        let pairs: BTreeSet<_> = map
            .edges
            .iter()
            .map(|e| {
                let (a, b) = if e.from < e.to {
                    (&e.from, &e.to)
                } else {
                    (&e.to, &e.from)
                };
                (a.clone(), b.clone())
            })
            .collect();
        assert_eq!(pairs.len(), 42);
        for e in &map.edges {
            assert!(map.nodes.contains_key(&e.from) && map.nodes.contains_key(&e.to));
            assert!(e.length > 0 && !e.blocked);
        }
        let bridge_sites: BTreeMap<_, Vec<_>> = ["TOP", "MID", "BOT"]
            .into_iter()
            .map(|site| {
                (
                    site,
                    map.edges.iter().filter(|e| e.bridge_site == site).collect(),
                )
            })
            .collect();
        assert_eq!(bridge_sites["TOP"].len(), 1);
        assert_eq!(bridge_sites["BOT"].len(), 1);
        assert_eq!(bridge_sites["MID"].len(), 2);
        assert!(map.edges.iter().filter(|e| !e.bridge_site.is_empty()).all(|e| !e.ford), "a bridge-site edge is not a permanent ford; breakage enables ford traversal dynamically");
        assert_eq!(
            map.edges.iter().filter(|e| e.ford).count(),
            2,
            "only Jungle river crossings are permanent fords"
        );
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.region == "jungle" || e.region == "jungle_camp")
                .filter(|e| !e.bridge_site.is_empty())
                .count(),
            0
        );
        assert!(map
            .edges
            .iter()
            .filter(|e| e.region == "river_ford")
            .all(|e| e.bridge_site.is_empty() && e.ford));
        for lane in ["top", "mid", "bot"] {
            let route = &map.lanes[lane];
            assert_eq!(route.first().map(String::as_str), Some("A.BASE"));
            assert_eq!(route.last().map(String::as_str), Some("B.BASE"));
            assert!(route.windows(2).all(|p| edge_exists(&map, &p[0], &p[1])));
            assert_eq!(route_distance(&map, lane), 1000, "{lane}");
        }
        for lane in ["TOP", "BOT"] {
            assert_eq!(
                map.edges
                    .iter()
                    .find(|e| e.bridge_site == lane)
                    .unwrap()
                    .length,
                100
            );
        }
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.bridge_site == "MID")
                .map(|e| e.length)
                .sum::<i64>(),
            100
        );
        assert!(
            map.nodes["A.BASE"].x < map.nodes["B.BASE"].x
                && map.nodes["A.BASE"].y > map.nodes["B.BASE"].y
        );
        assert!(map.nodes["N.MID.OBS"].allegiance == "N");
    }

    #[test]
    fn visual_embedding_keeps_lane_arcs_river_crossings_and_side_symmetry() {
        let map = battle_map();
        let mut symmetric_pairs = vec![("A.BASE".to_owned(), "B.BASE".to_owned())];
        for lane in ["TOP", "MID", "BOT"] {
            for segment in ["T1", "T2", "J", "BANK"] {
                symmetric_pairs.push((
                    format!("A.{lane}.{segment}"),
                    format!("B.{lane}.{segment}"),
                ));
            }
        }
        symmetric_pairs.extend([
            ("N.A.UJ".to_owned(), "N.B.UJ".to_owned()),
            ("N.A.LJ".to_owned(), "N.B.LJ".to_owned()),
            ("N.A.UC".to_owned(), "N.B.UC".to_owned()),
            ("N.A.LC".to_owned(), "N.B.LC".to_owned()),
        ]);
        for (a, b) in symmetric_pairs {
            assert_eq!(
                map.nodes[&a].x,
                map.nodes[&b].y,
                "{a} ↔ {b} x/y symmetry"
            );
            assert_eq!(
                map.nodes[&a].y,
                map.nodes[&b].x,
                "{a} ↔ {b} y/x symmetry"
            );
        }

        let point = |id: &str| (map.nodes[id].x, map.nodes[id].y);
        let edge_midpoint = |id: &str| {
            let edge = map.edges.iter().find(|edge| edge.id == id).unwrap();
            let (x1, y1) = point(&edge.from);
            let (x2, y2) = point(&edge.to);
            ((x1 + x2) / 2, (y1 + y2) / 2)
        };
        let river_crossings = [
            edge_midpoint("bridge.TOP"),
            edge_midpoint("ford.jungle.upper"),
            point("N.MID.OBS"),
            edge_midpoint("ford.jungle.lower"),
            edge_midpoint("bridge.BOT"),
        ];
        assert_eq!(
            river_crossings,
            [
                (390, 390),
                (575, 575),
                (800, 800),
                (1040, 1040),
                (1210, 1210)
            ]
        );
        assert!(river_crossings
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0 && pair[0].1 < pair[1].1));
        assert!(map.nodes.values().all(|node| {
            (0..=1600).contains(&node.x) && (0..=1600).contains(&node.y)
        }));
    }

    #[test]
    fn jungle_camps_fords_are_real_reachable_branches_and_rotation_is_symmetric() {
        let map = battle_map();
        let adjacency = |start: &str| {
            let mut seen = BTreeSet::from([start.to_owned()]);
            let mut queue = vec![start.to_owned()];
            while let Some(n) = queue.pop() {
                for e in &map.edges {
                    let next = if e.from == n {
                        Some(e.to.as_str())
                    } else if e.to == n {
                        Some(e.from.as_str())
                    } else {
                        None
                    };
                    if let Some(next) = next {
                        if seen.insert(next.to_owned()) {
                            queue.push(next.to_owned());
                        }
                    }
                }
            }
            seen
        };
        let all = adjacency("A.BASE");
        assert_eq!(
            all.len(),
            35,
            "unexpected reachable ids: {:?}",
            all.difference(&map.nodes.keys().cloned().collect())
                .collect::<Vec<_>>()
        );
        for camp in ["N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC"] {
            assert!(all.contains(camp));
            assert_eq!(
                map.edges
                    .iter()
                    .filter(|e| e.from == camp || e.to == camp)
                    .count(),
                1,
                "camp is a terminal branch"
            );
        }
        for lane in ["TOP", "MID", "BOT"] {
            let a = format!("A.{lane}.T1");
            let b = format!("B.{lane}.T1");
            assert_eq!(map.nodes[&a].allegiance, "A");
            assert_eq!(map.nodes[&b].allegiance, "B");
        }
        let lane_side = [
            "A.TOP.J", "A.TOP.T2", "A.TOP.T1", "A.BASE", "A.MID.T1", "A.MID.T2", "A.MID.J",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        let jungle = ["A.TOP.J", "N.A.UJ", "A.MID.J"]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(path_distance(&map, &lane_side), 800);
        assert_eq!(path_distance(&map, &jungle), 650);
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &lane_side), 1_000),
            Some(800_000)
        );
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &jungle), 800),
            Some(812_500)
        );
        assert_eq!(
            normalized_route_time_milli(path_distance(&map, &jungle), 1_000),
            Some(650_000)
        );
        for lane in ["TOP", "MID", "BOT"] {
            let a: Vec<_> = map
                .edges
                .iter()
                .filter(|e| e.id.starts_with(&format!("lane.{lane}.a-")))
                .map(|e| e.length)
                .collect();
            let b: Vec<_> = map
                .edges
                .iter()
                .filter(|e| e.id.starts_with(&format!("lane.{lane}.b-")))
                .map(|e| e.length)
                .collect();
            assert_eq!(
                a.into_iter().rev().collect::<Vec<_>>(),
                b,
                "rotated lane segment lengths on {lane}"
            );
        }
        assert_eq!(
            map.edges
                .iter()
                .filter(|e| e.region == "river_ford")
                .count(),
            2
        );
    }
}
