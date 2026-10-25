import { decodeReplay, ReplayError, type Replay, type Entity, type Event, type Result } from "./index";
import type { PresentationReplay as CoreReplay, RulePackage, MatchResult, EntityStateView, DomainValue } from "../../../apps/web/src/contracts/core-model";
import { parseFogReplayValue, type FogReplayState } from "./fog";
import type { RulesetIdentity, WorldIdentityRef } from "./generated";

export const NEXT_WORLD_UNITS_PER_RENDER_UNIT = 25;
type StaticEdge = NonNullable<RulePackage["next"]>["map"]["edges"][number];
type StaticMap = NonNullable<RulePackage["next"]>["map"];

type WorldPoint = { readonly x: number; readonly y: number };
type CanonicalPresentationContent = {
  readonly node_positions: Readonly<Record<string, { readonly position: WorldPoint }>>;
  readonly edge_paths: Readonly<Record<string, { readonly points: readonly WorldPoint[] }>>;
  readonly rivers: Readonly<Record<string, { readonly points: readonly WorldPoint[] }>>;
};
type MapWorldProjection = {
  readonly source_identity: WorldIdentityRef;
  readonly edge_facts: Readonly<Record<string, { readonly river_crossing?: {
    readonly kind: string; readonly bridge_site_id?: string | null; readonly start_progress_wu: number; readonly end_progress_wu: number;
  } | null }>>;
  readonly bridge_sites: Readonly<Record<string, readonly string[]>>;
  readonly presentation_artifact: {
    readonly schema_version: { readonly major: number; readonly minor: number; readonly patch: number };
    readonly content: CanonicalPresentationContent;
  };
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
): Replay {
  if (source.schema_version.major !== 1 || source.schema_version.minor !== 0 || source.schema_version.patch !== 0)
    throw new ReplayError("Unsupported core replay version");
  if (source.match_id !== match.match_id || !ruleset.next) throw new ReplayError("Replay context mismatch");
  const next = ruleset.next;
  const sourceWorld = (source as CoreReplay & { world_identity?: WorldIdentityRef }).world_identity;
  const sourceRuleset = (source as CoreReplay & { ruleset?: RulesetIdentity }).ruleset;
  const packageWorld = (next as typeof next & { world_identity?: WorldIdentityRef }).world_identity;
  const mapWorld = (next.map as typeof next.map & { world_identity?: WorldIdentityRef }).world_identity;
  if (!sourceWorld || !packageWorld || !mapWorld || !sourceRuleset)
    throw new ReplayError("Next Replay requires complete RulePackage and paired World identity on the RulePackage, BattleMap, and Enbu replay");
  if (sourceRuleset.id !== ruleset.ruleset.id || stableVersion(sourceRuleset.version) !== stableVersion(ruleset.ruleset.version) || sourceRuleset.digest !== ruleset.ruleset.digest)
    throw new ReplayError("Replay RulePackage identity does not match the supplied RulePackage");
  if (stableIdentity(sourceWorld) !== stableIdentity(packageWorld) || stableIdentity(packageWorld) !== stableIdentity(mapWorld))
    throw new ReplayError("Replay, RulePackage, and BattleMap World identities do not match");
  const projection = (next.map as typeof next.map & { world_projection?: MapWorldProjection }).world_projection;
  if (!projection || stableIdentity(projection.source_identity) !== stableIdentity(packageWorld) ||
      projection.presentation_artifact.schema_version.major !== 1 ||
      projection.presentation_artifact.schema_version.minor !== 0 ||
      projection.presentation_artifact.schema_version.patch !== 0)
    throw new ReplayError("Next Replay requires a paired, versioned canonical World presentation artifact");
  const worldPresentation = projection.presentation_artifact.content;
  const scale = NEXT_WORLD_UNITS_PER_RENDER_UNIT;
  const nodePoint = (nodeId: string) => {
    const node = next.map.nodes[nodeId];
    if (!node) throw new ReplayError(`Missing public map node: ${nodeId}`);
    const point = worldPresentation.node_positions[nodeId]?.position;
    const presentation = node as typeof node & { presentation_x?: number; presentation_y?: number };
    if (!point || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) ||
        point.x !== presentation.presentation_x || point.y !== presentation.presentation_y)
      throw new ReplayError(`Missing paired World presentation position for map node: ${nodeId}`);
    return { x: point.x / scale, y: point.y / scale };
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
      position: presentationPosition(raw, kind, next.map.nodes, next.map.edges, projection, worldPresentation, nodePoint),
      hp, maxHp, ...(battlefield ? { battlefield } : {}),
    };
  };
  const result: Result = { tick: match.final_tick, reason: match.termination_reason,
    winner: match.outcome === "attacker_victory" ? "azure" : match.outcome === "defender_victory" ? "vermilion" : "draw" };
  const river = presentationRiver(worldPresentation, scale);
  const extent = [
    ...Object.keys(next.map.nodes).map(nodePoint),
    ...Object.values(worldPresentation.edge_paths).flatMap(path => path.points.map(point => ({ x: point.x / scale, y: point.y / scale }))),
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
      const position = presentationPosition(raw, raw.entity_type, next.map.nodes, next.map.edges, projection, worldPresentation, nodePoint);
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
  return decodeReplay({ schemaVersion:"0.3", header:{ origin:"local",title:"Local Next Senritsu",enbuVersion:`${engineVersion.major}.${engineVersion.minor}.${engineVersion.patch}`,senritsu:{ id:ruleset.ruleset.id,digest:`sha256:${ruleset.ruleset.digest}`},ruleset:ruleset.ruleset,world:sourceWorld,view:source.perspective ?? "public" },
    presentation:{coordinates:"x-right-y-down",assetCatalogVersion:"procedural-battlefield-2",tickDurationMs:next.parameters.tick_duration_ms ?? 100},
    ...(fogFrames.length ? { fog: { worldUnitsPerRenderUnit: scale, frames: fogFrames } } : {}),
    scene:{ bounds:{min:{x:Math.min(...extent.map(point=>point.x))-3,y:Math.min(...extent.map(point=>point.y))-3},max:{x:Math.max(...extent.map(point=>point.x))+3,y:Math.max(...extent.map(point=>point.y))+3}},
      lanes:Object.entries(next.map.lanes).map(([id,path])=>({id,label:id.toUpperCase(),elevation:0.1,points:path.map(nodePoint)})),
      trackOffset:(next.parameters.lane_track_offset_wu ?? 20) / scale,
      captureTicks:next.parameters.mid_capture_ticks ?? 8,
      camps:next.camps.map(c=>({id:c.id,position:nodePoint(c.node)})),
      baseSites:[{id:next.map.attacker_base,side:"azure",position:nodePoint(next.map.attacker_base)},{id:next.map.defender_base,side:"vermilion",position:nodePoint(next.map.defender_base)}],
      nodes:Object.entries(next.map.nodes).map(([id,node])=>({id,allegiance:(node.allegiance ?? "N") as "A"|"B"|"N",position:nodePoint(id)})),
      ...(river.length >= 2 ? { river } : {}),
      routes:next.map.edges.flatMap(edge=>{
        if(edge.blocked)return[];
        const id=edge.id || `${edge.from}-${edge.to}`;
        const path=worldPresentation.edge_paths[id]?.points;
        if(!path || path.length<2)throw new ReplayError(`Missing paired World presentation route: ${id}`);
        const points=path.map(point=>({x:point.x/scale,y:point.y/scale}));
        if(points[0]!.x!==nodePoint(edge.from).x || points[0]!.y!==nodePoint(edge.from).y){
          if(points.at(-1)!.x===nodePoint(edge.from).x && points.at(-1)!.y===nodePoint(edge.from).y) points.reverse();
          else throw new ReplayError(`World presentation route endpoints do not match map edge: ${id}`);
        }
        if(points.at(-1)!.x!==nodePoint(edge.to).x || points.at(-1)!.y!==nodePoint(edge.to).y) throw new ReplayError(`World presentation route endpoints do not match map edge: ${id}`);
        return [{id,region:edge.region,points,...(edge.bridge_site?{bridgeSite:edge.bridge_site as "TOP"|"MID"|"BOT"}:{}),...(edge.ford?{ford:true}:{})}];
      }) },initialView,timeline,result });
}

function presentationPosition(
  entity: EntityStateView,
  kind: string,
  nodes: StaticMap["nodes"],
  edges: readonly StaticEdge[],
  projection: MapWorldProjection,
  presentation: CanonicalPresentationContent,
  nodePoint: (id: string) => { x: number; y: number },
): { x: number; y: number } {
  const site = maybeString(entity, "site");
  if (kind === "bridge" && site) {
    const centers = (projection.bridge_sites[site] ?? []).map(edgeId => {
      const edge = edges.find(candidate => (candidate.id || `${candidate.from}-${candidate.to}`) === edgeId);
      const crossing = projection.edge_facts[edgeId]?.river_crossing;
      if (!edge || !crossing || crossing.bridge_site_id !== site || edge.length <= 0)
        throw new ReplayError(`Invalid paired World bridge site geometry: ${site}`);
      const points = presentation.edge_paths[edgeId]?.points;
      if (!points || points.length < 2) throw new ReplayError(`Missing canonical bridge route presentation: ${edgeId}`);
      const from = nodePoint(edge.from);
      const isForward = points[0]!.x === from.x * NEXT_WORLD_UNITS_PER_RENDER_UNIT && points[0]!.y === from.y * NEXT_WORLD_UNITS_PER_RENDER_UNIT;
      const oriented = isForward ? points : [...points].reverse();
      const amount = ((crossing.start_progress_wu + crossing.end_progress_wu) / 2) / edge.length;
      return polylinePosition(oriented, amount);
    });
    if (centers.length === 0) throw new ReplayError(`Missing paired World bridge site geometry: ${site}`);
    return { x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length, y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length };
  }
  const fromId = maybeString(entity, "node");
  const toId = maybeString(entity, "edge_to");
  if (!fromId || !nodes[fromId]) throw new ReplayError(`Entity has no known logical map position: ${kind}`);
  if (toId) {
    const edge = edges.find((candidate) =>
      (candidate.from === fromId && candidate.to === toId) ||
      (candidate.to === fromId && candidate.from === toId),
    );
    if (!edge) throw new ReplayError(`Entity position references an unknown map edge: ${fromId}->${toId}`);
    const length = edge.length;
    if (!Number.isSafeInteger(length) || length <= 0) throw new ReplayError("Map edge has invalid logical length");
    const progress = Math.max(0, Math.min(length, maybeNum(entity, "edge_progress") ?? 0));
    const amount = progress / length;
    const path = presentation.edge_paths[edge.id || `${edge.from}-${edge.to}`]?.points;
    if (!path || path.length < 2) throw new ReplayError("Missing canonical edge route presentation");
    const oriented = path[0]!.x === nodePoint(fromId).x * NEXT_WORLD_UNITS_PER_RENDER_UNIT &&
      path[0]!.y === nodePoint(fromId).y * NEXT_WORLD_UNITS_PER_RENDER_UNIT ? path : [...path].reverse();
    return polylinePosition(oriented, amount);
  }
  return nodePoint(fromId);
}

function stableIdentity(value: WorldIdentityRef): string {
  return JSON.stringify({
    world_id: value.world_id,
    schema_version: stableVersion(value.schema_version),
    minimum_compiler: stableVersion(value.minimum_compiler),
    maximum_compiler_exclusive: value.maximum_compiler_exclusive && stableVersion(value.maximum_compiler_exclusive),
    validation_profile_id: value.validation_profile_id,
    validation_profile_version: value.validation_profile_version && stableVersion(value.validation_profile_version),
    logic_digest: value.logic_digest,
    presentation_digest: value.presentation_digest,
  });
}

function stableVersion(value: { major: number; minor: number; patch: number }): string {
  return `${value.major}.${value.minor}.${value.patch}`;
}

function presentationRiver(presentation: CanonicalPresentationContent, scale: number): { x: number; y: number }[] {
  const rivers = Object.values(presentation.rivers);
  if (rivers.length > 1) throw new ReplayError("Replay scene cannot represent multiple canonical rivers");
  return (rivers[0]?.points ?? []).map(point => ({ x: point.x / scale, y: point.y / scale }));
}

function polylinePosition(points: readonly WorldPoint[], amount: number): { x: number; y: number } {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) throw new ReplayError("Canonical presentation path has zero length");
  let remaining = Math.max(0, Math.min(1, amount)) * total;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (remaining <= length || index === lengths.length - 1) {
      const from = points[index]!, to = points[index + 1]!;
      const t = length === 0 ? 0 : remaining / length;
      return { x: (from.x + (to.x - from.x) * t) / NEXT_WORLD_UNITS_PER_RENDER_UNIT, y: (from.y + (to.y - from.y) * t) / NEXT_WORLD_UNITS_PER_RENDER_UNIT };
    }
    remaining -= length;
  }
  throw new ReplayError("Canonical presentation path has no usable segment");
}
