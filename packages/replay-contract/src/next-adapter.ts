import { decodeReplay, ReplayError, type Replay, type Entity, type Event, type Result } from "./index";
import type { PresentationReplay as CoreReplay, RulePackage, MatchResult, EntityStateView, DomainValue } from "../../../apps/web/src/contracts/core-model";

export const NEXT_WORLD_UNITS_PER_RENDER_UNIT = 25;

const scalar = (v: DomainValue | undefined): string | number | null =>
  v?.kind === "integer" || v?.kind === "string" || v?.kind === "enum" ? v.value : null;
const num = (e: EntityStateView, k: string): number => {
  const value = scalar(e.fields[k]);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ReplayError(`Missing public ${k}`);
  return value;
};
/** Explicit public-only projection. Internal identities never become render IDs. */
export function presentationToGraphics(source: CoreReplay, ruleset: RulePackage, match: MatchResult): Replay {
  if (source.schema_version.major !== 1 || source.schema_version.minor !== 0 || source.schema_version.patch !== 0)
    throw new ReplayError("Unsupported core replay version");
  if (source.match_id !== match.match_id || !ruleset.next) throw new ReplayError("Replay context mismatch");
  const next = ruleset.next;
  const scale = NEXT_WORLD_UNITS_PER_RENDER_UNIT;
  const nodes = Object.values(next.map.nodes);
  const point = (e: EntityStateView) => ({ x: num(e, "x") / scale, y: num(e, "y") / scale });
  const nodePoint = (nodeId: string) => {
    const node = next.map.nodes[nodeId];
    if (!node) throw new ReplayError(`Missing public map node: ${nodeId}`);
    return { x: node.x / scale, y: node.y / scale };
  };
  let serial = 0;
  const active = new Map<string, Entity>();
  const initialView: Entity[] = [];
  const timeline: Event[] = [];
  let order = 0;
  const emit = (event: Event): void => { timeline.push(event); };
  const project = (raw: EntityStateView): Entity => {
    const kind = raw.entity_type;
    if (!["hero", "minion", "monster", "tower", "base"].includes(kind)) throw new ReplayError("Unknown presentation entity type");
    const catalog = scalar(raw.fields.catalog_id);
    const definition = next.heroes.find(h => h.id === catalog);
    const hp = num(raw, "hp"), maxHp = num(raw, "max_hp");
    return {
      id: `entity-${++serial}`, side: raw.owner === "attacker" ? "azure" : raw.owner === "defender" ? "vermilion" : "neutral",
      kind: kind === "tower" || kind === "base" ? kind : "unit", archetype: kind,
      appearanceKey: definition?.appearance_key ?? (typeof catalog === "string" && catalog ? catalog : kind),
      ...(typeof catalog === "string" && catalog ? { catalogId: catalog } : {}),
      position: point(raw), hp, maxHp,
    };
  };
  const result: Result = { tick: match.final_tick, reason: match.termination_reason,
    winner: match.outcome === "attacker_victory" ? "azure" : match.outcome === "defender_victory" ? "vermilion" : "draw" };
  let priorTick = -1;
  for (const frame of source.frames) {
    if (frame.tick <= priorTick || frame.tick > result.tick) throw new ReplayError("Invalid core frame order");
    priorTick = frame.tick;
    if (!frame.visible_state) continue;
    const current = frame.visible_state.entities;
    order = 0;
    // Absence means visibility loss, never an inferred death.
    for (const [rawId, old] of active) if (!(rawId in current)) {
      emit({ type: "disappear", tick: frame.tick, order: order++, entityId: old.id }); active.delete(rawId);
    }
    for (const [rawId, raw] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
      if (!active.has(rawId) && num(raw, "hp") > 0) {
        const entity = project(raw); active.set(rawId, entity);
        if (frame.tick === 0) initialView.push(entity);
        else emit({ type: "spawn", tick: frame.tick, order: order++, entity });
      }
    }
    // Only remap explicitly allowed cue references already in the public frame.
    for (const cue of frame.events) {
      const actorRef = cue.payload.source?.kind === "entity" ? cue.payload.source.value : cue.entity;
      const actor = actorRef ? active.get(actorRef) : undefined;
      const ref = cue.payload.target;
      const target = ref?.kind === "entity" ? active.get(ref.value) : undefined;
      if (!actor || !target || !current[actorRef!] || !current[ref!.kind === "entity" ? ref.value : ""]) continue;
      if (cue.event === "next.attack" || cue.event === "attack" || cue.event === "basic_attack") emit({ type: "attack", tick: frame.tick, order: order++, entityId: actor.id, targetId: target.id });
      if (cue.event === "next.skill" || cue.event === "skill" || cue.event === "skill_activated") {
        const skill = scalar(cue.payload.skill);
        if (typeof skill === "string") emit({ type: "skill", tick: frame.tick, order: order++, entityId: actor.id, targetId: target.id, skillKey: skill });
      }
    }
    for (const [rawId, raw] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
      const old = active.get(rawId); if (!old) continue;
      const position = point(raw), hp = num(raw,"hp"), maxHp = num(raw,"max_hp");
      if (position.x !== old.position.x || position.y !== old.position.y) emit({ type:"move", tick:frame.tick, order:order++, entityId:old.id, position });
      if (hp !== old.hp || maxHp !== old.maxHp) {
        if (hp <= old.hp && maxHp === old.maxHp) emit({ type:"damage",tick:frame.tick,order:order++,entityId:old.id,hp });
        else emit({type:"vitals",tick:frame.tick,order:order++,entityId:old.id,hp,maxHp});
      }
      if (hp <= 0) { emit({type:"destroy",tick:frame.tick,order:order++,entityId:old.id}); active.delete(rawId); }
      else active.set(rawId,{...old,position,hp,maxHp});
    }
  }
  emit({ type:"match-end", tick:result.tick, order:order++, result });
  return decodeReplay({ schemaVersion:"0.2", header:{ origin:"local",title:"Local Next Senritsu",enbuVersion:"1.1.0",senritsu:{ id:ruleset.ruleset.id,digest:`sha256:${ruleset.ruleset.digest}`},view:source.perspective ?? "public" },
    presentation:{coordinates:"x-right-y-down",assetCatalogVersion:"procedural-next-1",tickDurationMs:next.parameters.tick_duration_ms ?? 100},
    scene:{ bounds:{min:{x:Math.min(...nodes.map(n=>n.x))/scale-3,y:Math.min(...nodes.map(n=>n.y))/scale-3},max:{x:Math.max(...nodes.map(n=>n.x))/scale+3,y:Math.max(...nodes.map(n=>n.y))/scale+3}},
      lanes:Object.entries(next.map.lanes).map(([id,path])=>({id,label:id.toUpperCase(),elevation:0.1,points:path.map(nodePoint)})),
      camps:next.camps.map(c=>({id:c.id,position:nodePoint(c.node)})),
      baseSites:[{id:next.map.attacker_base,side:"azure",position:nodePoint(next.map.attacker_base)},{id:next.map.defender_base,side:"vermilion",position:nodePoint(next.map.defender_base)}],
      routes:next.map.edges.flatMap((edge,index)=>edge.blocked?[]:[{id:`map-edge-${index}`,region:edge.region,points:[nodePoint(edge.from),nodePoint(edge.to)]}]) },initialView,timeline,result });
}
