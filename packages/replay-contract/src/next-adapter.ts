import { decodeReplay, ReplayError, type Replay, type Entity, type Event, type Result } from "./index";
import type { PresentationReplay as CoreReplay, RulePackage, MatchResult, EntityStateView, DomainValue } from "../../../apps/web/src/contracts/core-model";
import { parseFogReplayValue, type FogReplayState } from "./fog";

export const NEXT_WORLD_UNITS_PER_RENDER_UNIT = 25;
type StaticEdge = NonNullable<RulePackage["next"]>["map"]["edges"][number];
type StaticMap = NonNullable<RulePackage["next"]>["map"];

export type PresentationRiverAnchor =
  | { readonly kind: "bridge-site"; readonly site: "TOP" | "MID" | "BOT" }
  | { readonly kind: "edge-midpoint"; readonly edgeId: string }
  | { readonly kind: "node"; readonly nodeId: string };

/** Ordered, presentation-only river centerline anchors for a World. */
export interface NextPresentationWorldDefinition {
  readonly river: {
    readonly anchors: readonly PresentationRiverAnchor[];
    readonly terminalExtension: number;
  };
}

/**
 * The authored diagonal course runs from the TOP bridge to the BOT bridge.
 * The two jungle fords and the MID island are explicit intervening landmarks;
 * their order is part of World presentation and never inferred from positions.
 */
export const NEXT_BATTLEFIELD_PRESENTATION_WORLD: NextPresentationWorldDefinition = {
  river: {
    anchors: [
      { kind: "bridge-site", site: "TOP" },
      { kind: "edge-midpoint", edgeId: "ford.jungle.upper" },
      { kind: "bridge-site", site: "MID" },
      { kind: "edge-midpoint", edgeId: "ford.jungle.lower" },
      { kind: "bridge-site", site: "BOT" },
    ],
    terminalExtension: 8,
  },
};

const scalar = (v: DomainValue | undefined): string | number | null =>
  v?.kind === "integer" || v?.kind === "string" || v?.kind === "enum" ? v.value : null;
const maybeNum = (e: EntityStateView, k: string): number | undefined => {
  const value = scalar(e.fields[k]);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  return value;
};
const num = (e: EntityStateView, k: string): number => {
  const value = maybeNum(e, k);
  if (value === undefined) throw new ReplayError(`Missing public ${k}`);
  return value;
};
const maybeString = (e: EntityStateView, k: string): string | undefined => {
  const value = scalar(e.fields[k]);
  return typeof value === "string" && value ? value : undefined;
};
const publicSide = (value: string | undefined): Entity["side"] =>
  value === "attacker" || value === "azure" ? "azure" : value === "defender" || value === "vermilion" ? "vermilion" : "neutral";
function battlefieldState(raw: EntityStateView, kind: string, owner: Entity["side"], edges: readonly StaticEdge[]): Entity["battlefield"] {
  const node = maybeString(raw, "node");
  const edgeTo = maybeString(raw, "edge_to");
  const progress = maybeNum(raw, "edge_progress");
  const track = maybeString(raw, "track");
  const crossRemaining = maybeNum(raw, "cross_remaining") ?? 0;
  const fordRemaining = maybeNum(raw, "ford_remaining") ?? 0;
  // The canonical Enbu field is an integer 0/1. Keep this tolerant of absent
  // values in older replays, while only a positive authorized value signals
  // that the unit is still in the ford crossing state.
  const fordActive = (maybeNum(raw, "ford_active") ?? 0) > 0;
  const edge = edgeTo && node ? edges.find(item => (item.from === node && item.to === edgeTo) || (item.to === node && item.from === edgeTo)) : undefined;
  const site = maybeString(raw, "site");
  const bridgeState = maybeString(raw, "bridge_state");
  const buildRemaining = maybeNum(raw, "build_remaining");
  const captureProgress = maybeNum(raw, "capture_progress");
  const captureSide = maybeString(raw, "capture_progress_side");
  if (kind === "bridge") return {
    ...(site ? { bridgeSite: site as "TOP" | "MID" | "BOT" } : {}),
    ...(bridgeState ? { bridgeState: bridgeState as "normal" | "expanded" | "destroyed" } : {}),
    ...(buildRemaining !== undefined ? { buildRemaining } : {}),
    facilityOwner: owner,
  };
  if (kind === "observation") {
    const captureOwner = maybeString(raw, "capture_owner");
    return {
      ...(captureProgress !== undefined ? { captureProgress } : {}),
      ...(captureSide ? { captureSide: publicSide(captureSide) } : {}),
      ...(captureOwner ? { facilityOwner: publicSide(captureOwner) } : {}),
    };
  }
  if (!node) return undefined;
  const crossing = fordActive || fordRemaining > 0 ? "ford" : crossRemaining > 0 ? "track" : edge?.bridge_site ? "bridge" : "none";
  return {
    node,
    edgeTo: edgeTo ?? "",
    progress: progress ?? 0,
    ...(track === "LEFT" || track === "CENTER" || track === "RIGHT" ? { track } : {}),
    crossing,
    remaining: fordRemaining || crossRemaining,
  };
}

/** Explicit public-only projection. Internal identities never become render IDs. */
export function presentationToGraphics(
  source: CoreReplay,
  ruleset: RulePackage,
  match: MatchResult,
  engineVersion = ruleset.minimum_engine_version,
  presentationWorld: NextPresentationWorldDefinition = NEXT_BATTLEFIELD_PRESENTATION_WORLD,
): Replay {
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
  const fogFrames: FogReplayState[] = [];
  let order = 0;
  const emit = (event: Event): void => { timeline.push(event); };
  const project = (raw: EntityStateView): Entity => {
    const kind = raw.entity_type;
    if (!["hero", "minion", "monster", "tower", "base", "bridge", "observation"].includes(kind)) throw new ReplayError("Unknown presentation entity type");
    const catalog = scalar(raw.fields.catalog_id);
    const definition = next.heroes.find(h => h.id === catalog);
    const hp = maybeNum(raw, "hp") ?? 1;
    const maxHp = maybeNum(raw, "max_hp") ?? 1;
    const side = raw.owner === "attacker" ? "azure" : raw.owner === "defender" ? "vermilion" : "neutral";
    const battlefield = battlefieldState(raw, kind, side, next.map.edges);
    return {
      id: `entity-${++serial}`, side,
      kind: kind === "tower" || kind === "base" || kind === "bridge" || kind === "observation" ? kind : "unit", archetype: kind,
      appearanceKey: definition?.appearance_key ?? (typeof catalog === "string" && catalog ? catalog : kind),
      ...(typeof catalog === "string" && catalog ? { catalogId: catalog } : {}),
      position: point(raw), hp, maxHp, ...(battlefield ? { battlefield } : {}),
    };
  };
  const result: Result = { tick: match.final_tick, reason: match.termination_reason,
    winner: match.outcome === "attacker_victory" ? "azure" : match.outcome === "defender_victory" ? "vermilion" : "draw" };
  const river = presentationRiver(next.map, presentationWorld, scale);
  const extent = [
    ...nodes.map(node => ({ x: node.x / scale, y: node.y / scale })),
    ...river,
  ];
  let priorTick = -1;
  for (const frame of source.frames) {
    if (frame.tick <= priorTick || frame.tick > result.tick) throw new ReplayError("Invalid core frame order");
    priorTick = frame.tick;
    if (!frame.visible_state) continue;
    const fog = parseFogReplayValue(frame.visible_state.global_fields.fog, frame.tick, source.perspective);
    if (fog) {
      if (!source.perspective) throw new ReplayError("Fog requires an authorized perspective");
      const routeIds = new Set(next.map.edges.filter(edge => !edge.blocked).map(edge => edge.id || `${edge.from}-${edge.to}`));
      fogFrames.push({ ...fog, edges: Object.fromEntries(Object.entries(fog.edges).filter(([id]) => routeIds.has(id))) });
    }
    const current = frame.visible_state.entities;
    order = 0;
    // Absence means visibility loss, never an inferred death.
    for (const [rawId, old] of active) if (!(rawId in current)) {
      emit({ type: "disappear", tick: frame.tick, order: order++, entityId: old.id }); active.delete(rawId);
    }
    for (const [rawId, raw] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
      if (!active.has(rawId) && (raw.entity_type === "bridge" || raw.entity_type === "observation" || num(raw, "hp") > 0)) {
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
      const position = point(raw);
      const persistentFacility = raw.entity_type === "bridge" || raw.entity_type === "observation";
      const hp = maybeNum(raw,"hp") ?? old.hp;
      const maxHp = maybeNum(raw,"max_hp") ?? old.maxHp;
      const battlefield = battlefieldState(raw, raw.entity_type, raw.owner === "attacker" ? "azure" : raw.owner === "defender" ? "vermilion" : "neutral", next.map.edges);
      const positionChanged = position.x !== old.position.x || position.y !== old.position.y;
      const battlefieldChanged = JSON.stringify(battlefield) !== JSON.stringify(old.battlefield);
      if (positionChanged || (raw.entity_type !== "bridge" && raw.entity_type !== "observation" && battlefieldChanged))
        emit({ type:"move", tick:frame.tick, order:order++, entityId:old.id, position, ...(battlefield ? { logicalPosition: battlefield } : {}) });
      if ((raw.entity_type === "bridge" || raw.entity_type === "observation") && battlefieldChanged && battlefield)
        emit({ type:"facility-state", tick:frame.tick, order:order++, entityId:old.id, battlefield });
      if (hp !== old.hp || maxHp !== old.maxHp) {
        if (hp <= old.hp && maxHp === old.maxHp) emit({ type:"damage",tick:frame.tick,order:order++,entityId:old.id,hp });
        else emit({type:"vitals",tick:frame.tick,order:order++,entityId:old.id,hp,maxHp});
      }
      if (hp <= 0 && !persistentFacility) { emit({type:"destroy",tick:frame.tick,order:order++,entityId:old.id}); active.delete(rawId); }
      else active.set(rawId,{...old,position,hp,maxHp,...(battlefield ? {battlefield} : {})});
    }
  }
  emit({ type:"match-end", tick:result.tick, order:order++, result });
  return decodeReplay({ schemaVersion:"0.3", header:{ origin:"local",title:"Local Next Senritsu",enbuVersion:`${engineVersion.major}.${engineVersion.minor}.${engineVersion.patch}`,senritsu:{ id:ruleset.ruleset.id,digest:`sha256:${ruleset.ruleset.digest}`},view:source.perspective ?? "public" },
    presentation:{coordinates:"x-right-y-down",assetCatalogVersion:"procedural-battlefield-2",tickDurationMs:next.parameters.tick_duration_ms ?? 100},
    ...(fogFrames.length ? { fog: { worldUnitsPerRenderUnit: scale, frames: fogFrames } } : {}),
    scene:{ bounds:{min:{x:Math.min(...extent.map(point=>point.x))-3,y:Math.min(...extent.map(point=>point.y))-3},max:{x:Math.max(...extent.map(point=>point.x))+3,y:Math.max(...extent.map(point=>point.y))+3}},
      lanes:Object.entries(next.map.lanes).map(([id,path])=>({id,label:id.toUpperCase(),elevation:0.1,points:path.map(nodePoint)})),
      trackOffset:(next.parameters.lane_track_offset_wu ?? 20) / scale,
      captureTicks:next.parameters.mid_capture_ticks ?? 8,
      camps:next.camps.map(c=>({id:c.id,position:nodePoint(c.node)})),
      baseSites:[{id:next.map.attacker_base,side:"azure",position:nodePoint(next.map.attacker_base)},{id:next.map.defender_base,side:"vermilion",position:nodePoint(next.map.defender_base)}],
      nodes:Object.entries(next.map.nodes).map(([id,node])=>({id,allegiance:(node.allegiance ?? "N") as "A"|"B"|"N",position:{x:node.x/scale,y:node.y/scale}})),
      ...(river.length >= 2 ? { river } : {}),
      routes:next.map.edges.flatMap(edge=>edge.blocked?[]:[{id:edge.id || `${edge.from}-${edge.to}`,region:edge.region,points:[nodePoint(edge.from),nodePoint(edge.to)],...(edge.bridge_site?{bridgeSite:edge.bridge_site as "TOP"|"MID"|"BOT"}:{}),...(edge.ford?{ford:true}:{})}]) },initialView,timeline,result });
}

function presentationRiver(
  map: StaticMap,
  presentationWorld: NextPresentationWorldDefinition,
  scale: number,
): { x: number; y: number }[] {
  const anchors = presentationWorld.river.anchors.map(anchor => {
    switch (anchor.kind) {
      case "node": {
        const node = map.nodes[anchor.nodeId];
        return node ? { x: node.x / scale, y: node.y / scale } : undefined;
      }
      case "edge-midpoint": {
        const edge = map.edges.find(item => item.id === anchor.edgeId);
        if (!edge) return undefined;
        const from = map.nodes[edge.from], to = map.nodes[edge.to];
        if (!from || !to) return undefined;
        return { x: (from.x + to.x) / (2 * scale), y: (from.y + to.y) / (2 * scale) };
      }
      case "bridge-site": {
        const edges = map.edges.filter(edge => edge.bridge_site === anchor.site);
        if (!edges.length) return undefined;
        const observation = anchor.site === "MID"
          ? Object.values(map.nodes).find(node => node.region === "observation")
          : undefined;
        if (observation) return { x: observation.x / scale, y: observation.y / scale };
        const endpoints = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))]
          .map(id => map.nodes[id])
          .filter((node): node is NonNullable<typeof node> => node !== undefined);
        if (!endpoints.length) return undefined;
        return {
          x: endpoints.reduce((sum, node) => sum + node.x, 0) / (endpoints.length * scale),
          y: endpoints.reduce((sum, node) => sum + node.y, 0) / (endpoints.length * scale),
        };
      }
    }
  });
  // Generic/older maps without this complete presentation path remain valid and
  // simply have no river. A partial path is never reordered or guessed.
  if (anchors.length < 2 || anchors.some(anchor => anchor === undefined)) return [];
  return riverLine(anchors as { x: number; y: number }[], presentationWorld.river.terminalExtension);
}

function riverLine(points: readonly {x:number;y:number}[], terminalExtension: number): {x:number;y:number}[] {
  const ordered = points.filter((point, index) =>
    index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 0.05,
  );
  if (ordered.length < 2) return ordered;
  const extend = (from: {x:number;y:number}, toward: {x:number;y:number}, distance: number): {x:number;y:number} => {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + dx / length * distance, y: from.y + dy / length * distance };
  };
  const first = extend(ordered[0]!, ordered[1]!, -terminalExtension);
  const last = extend(ordered[ordered.length - 1]!, ordered[ordered.length - 2]!, -terminalExtension);
  return [first, ...ordered, last];
}
