//! Logical map for the next Senritsu ruleset.
//!
//! Coordinates are integer world units. Enbu uses the graph and edge lengths
//! below for movement; a renderer may project the coordinates but must not
//! derive routes from them.

use senkei_model::{BattleMap, MapEdge, MapNode, TowerPlacement};
use std::collections::BTreeMap;

/// Build the deterministic three-lane map used by `senkei.next`.
///
/// Lane node lists run from the attacker base toward the defender base. The
/// three jungle nodes are connected to one another and to the adjacent lanes,
/// so Heroes can rotate between lanes while lane-specific units can use lane
/// node waypoints to stay on their assigned route.
pub fn battle_map() -> BattleMap {
    let nodes = BTreeMap::from([
        ("attacker_base".into(), node(0, 0, "base")),
        ("defender_base".into(), node(1200, 800, "base")),
        ("top_a".into(), node(120, 20, "top")),
        ("top_1".into(), node(370, 35, "top")),
        ("top_2".into(), node(720, 90, "top")),
        ("top_d".into(), node(1030, 300, "top")),
        ("mid_a".into(), node(70, 110, "mid")),
        ("mid_1".into(), node(360, 300, "mid")),
        ("mid_2".into(), node(770, 485, "mid")),
        ("mid_d".into(), node(1090, 675, "mid")),
        ("bot_a".into(), node(25, 200, "bot")),
        ("bot_1".into(), node(315, 500, "bot")),
        ("bot_2".into(), node(690, 700, "bot")),
        ("bot_d".into(), node(1120, 770, "bot")),
        ("jungle_nw".into(), node(420, 155, "jungle")),
        ("jungle_center".into(), node(590, 405, "jungle")),
        ("jungle_se".into(), node(850, 625, "jungle")),
    ]);

    // The edge list is intentionally kept in a fixed order, although
    // navigation treats it as an undirected graph and does not depend on that
    // order for path selection.
    let edges = vec![
        edge("attacker_base", "top_a", 122, "lane"),
        edge("top_a", "top_1", 251, "lane"),
        edge("top_1", "top_2", 355, "lane"),
        edge("top_2", "top_d", 374, "lane"),
        edge("top_d", "defender_base", 568, "lane"),
        edge("attacker_base", "mid_a", 130, "lane"),
        edge("mid_a", "mid_1", 347, "lane"),
        edge("mid_1", "mid_2", 450, "lane"),
        edge("mid_2", "mid_d", 372, "lane"),
        edge("mid_d", "defender_base", 157, "lane"),
        edge("attacker_base", "bot_a", 202, "lane"),
        edge("bot_a", "bot_1", 417, "lane"),
        edge("bot_1", "bot_2", 425, "lane"),
        edge("bot_2", "bot_d", 432, "lane"),
        edge("bot_d", "defender_base", 106, "lane"),
        edge("top_1", "jungle_nw", 170, "jungle"),
        edge("jungle_nw", "mid_1", 240, "jungle"),
        edge("jungle_nw", "jungle_center", 320, "jungle"),
        edge("mid_1", "jungle_center", 310, "jungle"),
        edge("jungle_center", "mid_2", 270, "jungle"),
        edge("jungle_center", "bot_1", 280, "jungle"),
        edge("jungle_center", "jungle_se", 340, "jungle"),
        edge("mid_2", "jungle_se", 230, "jungle"),
        edge("jungle_se", "bot_2", 260, "jungle"),
    ];

    let lanes = BTreeMap::from([
        (
            "top".into(),
            vec![
                "attacker_base",
                "top_a",
                "top_1",
                "top_2",
                "top_d",
                "defender_base",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "mid".into(),
            vec![
                "attacker_base",
                "mid_a",
                "mid_1",
                "mid_2",
                "mid_d",
                "defender_base",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
        (
            "bot".into(),
            vec![
                "attacker_base",
                "bot_a",
                "bot_1",
                "bot_2",
                "bot_d",
                "defender_base",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        ),
    ]);

    let towers = ["top", "mid", "bot"]
        .into_iter()
        .flat_map(|lane| {
            [
                TowerPlacement {
                    id: format!("tower_attacker_{lane}"),
                    node: format!("{lane}_1"),
                    side: "attacker".into(),
                    lane: lane.into(),
                },
                TowerPlacement {
                    id: format!("tower_defender_{lane}"),
                    node: format!("{lane}_2"),
                    side: "defender".into(),
                    lane: lane.into(),
                },
            ]
        })
        .collect();

    BattleMap {
        id: "senkei-next-three-lane".into(),
        nodes,
        edges,
        lanes,
        attacker_base: "attacker_base".into(),
        defender_base: "defender_base".into(),
        towers,
    }
}

fn node(x: i64, y: i64, region: &str) -> MapNode {
    MapNode {
        x,
        y,
        region: region.into(),
    }
}

fn edge(from: &str, to: &str, length: i64, region: &str) -> MapEdge {
    MapEdge {
        from: from.into(),
        to: to.into(),
        length,
        region: region.into(),
        blocked: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_has_three_attacker_to_defender_lanes_and_connected_jungle() {
        let map = battle_map();
        assert_eq!(map.lanes.len(), 3);
        for lane in ["top", "mid", "bot"] {
            let route = &map.lanes[lane];
            assert_eq!(route.first().map(String::as_str), Some("attacker_base"));
            assert_eq!(route.last().map(String::as_str), Some("defender_base"));
            assert!(route.iter().all(|id| map.nodes.contains_key(id)));
            assert!(route.windows(2).all(|pair| {
                map.edges.iter().any(|edge| {
                    (edge.from == pair[0] && edge.to == pair[1])
                        || (edge.from == pair[1] && edge.to == pair[0])
                })
            }));
        }

        for camp_node in ["jungle_nw", "jungle_center", "jungle_se"] {
            assert_eq!(map.nodes[camp_node].region, "jungle");
            assert!(map.edges.iter().any(|edge| {
                (edge.from == camp_node || edge.to == camp_node) && edge.region == "jungle"
            }));
        }
        assert_eq!(map.towers.len(), 6);
        assert!(map.edges.iter().all(|edge| {
            edge.length > 0
                && !edge.blocked
                && map.nodes.contains_key(&edge.from)
                && map.nodes.contains_key(&edge.to)
        }));
    }
}
