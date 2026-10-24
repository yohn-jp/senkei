use senkei_model::*;
use std::collections::BTreeSet;

/// Additional finite-system invariants, before constructing a VerifiedRulePlan.
pub(crate) fn validate_next(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let Some(r) = &package.next else { return };
    let mut check = |ok: bool, path: &str, message: &str| { if !ok { issues.push(ValidationIssue::new("invalid_next_rules",path,message)); } };
    check(r.mechanics_version == Version::new(1,0,0),"next.mechanics_version","unsupported finite battle mechanics version");
    check(package.minimum_engine_version >= Version::new(1,1,0),"minimum_engine_version","next mechanics require Enbu 1.1.0");
    check(r.heroes.len()==12,"next.heroes","catalog must contain exactly twelve Heroes");
    check(r.heroes.iter().filter(|h|h.placement=="frontline").count()==6 && r.heroes.iter().filter(|h|h.placement=="backline").count()==6,"next.heroes.placement","six frontline and six backline Heroes are required");
    for (key,value) in [("terrain_lane_speed_milli",1000),("terrain_jungle_speed_milli",800),("minion_vision_speed_milli",1200),("squad_1_speed_milli",1000),("squad_2_speed_milli",950),("squad_3_speed_milli",900),("squad_4_speed_milli",850),("squad_5_speed_milli",800)] { check(r.parameters.get(key)==Some(&value),"next.parameters","agreed initial movement ratios must be preserved"); }
    let ids: BTreeSet<_> = r.heroes.iter().map(|h|h.id.as_str()).collect();
    check(ids.len()==12,"next.heroes","Hero IDs must be unique");
    for prefix in ["F","R"] { for n in 1..=6 { check(ids.contains(format!("{prefix}{n:02}").as_str()),"next.heroes","catalog requires F01–F06 and R01–R06"); } }
    for h in &r.heroes {
        check(h.stats.hp>0 && h.stats.speed>0 && h.stats.attack_interval>0 && h.stats.range>=0,"next.heroes.stats","invalid Hero stats");
        check(!h.skill_paths.is_empty() && !h.skills.is_empty(),"next.heroes.skills","Heroes require configured skill paths");
        let skills:BTreeSet<_>=h.skills.iter().map(|s|s.id.as_str()).collect();
        check(skills.len()==h.skills.len(),"next.heroes.skills","duplicate skill ID");
        for skill in &h.skills { check(skill.cooldown>=0 && skill.cost>=0 && skill.unlock_level>=1 && skill.prerequisites.iter().all(|id|skills.contains(id.as_str())),"next.heroes.skills","invalid skill prerequisites or cost"); }
        for path in h.skill_paths.values() { let mut acquired=BTreeSet::new(); for id in path { if let Some(skill)=h.skills.iter().find(|s| &s.id==id) { check(skill.prerequisites.iter().all(|p|acquired.contains(p)),"next.heroes.skill_paths","path does not satisfy prerequisite order"); acquired.insert(id.clone()); } else { check(false,"next.heroes.skill_paths","path references absent skill"); } } }
    }
    check(r.map.nodes.contains_key(&r.map.attacker_base) && r.map.nodes.contains_key(&r.map.defender_base),"next.map","map bases must exist");
    check(r.map.attacker_base != r.map.defender_base,"next.map","bases must be distinct");
    for node in r.map.nodes.values() { check((-1_000_000..=1_000_000).contains(&node.x) && (-1_000_000..=1_000_000).contains(&node.y),"next.map.nodes","coordinates exceed deterministic bounds"); }
    for edge in &r.map.edges { check(edge.length>0 && edge.length<=1_000_000 && edge.from!=edge.to && r.map.nodes.contains_key(&edge.from) && r.map.nodes.contains_key(&edge.to),"next.map.edges","edges require positive bounded length and existing endpoints"); }
    for lane in ["top","mid","bot"] { check(r.map.lanes.get(lane).is_some_and(|p|p.len()>=2 && p.first()==Some(&r.map.attacker_base) && p.last()==Some(&r.map.defender_base) && p.iter().all(|id|r.map.nodes.contains_key(id))),"next.map.lanes","all three base-to-base lanes are required"); }
    for camp in &r.camps { check(r.map.nodes.contains_key(&camp.node) && r.monsters.iter().any(|m|m.id==camp.monster) && camp.respawn_ticks>0,"next.camps","invalid camp position/type/respawn"); }
    check(!r.minions.is_empty() && r.camps.len()>=2,"next","minion waves and multiple camps required");
    const CAPS: &[&str]= &["move","pursue","retreat","activate","split","merge","regroup","target"];
    check(package.domain.capabilities.keys().all(|id| CAPS.contains(&id.as_str())),"domain.capabilities","unsupported finite battle capability");
}
