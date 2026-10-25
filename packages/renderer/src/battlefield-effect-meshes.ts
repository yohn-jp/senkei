import * as THREE from "three";
import type { DisplayState, Entity, Event, Replay } from "@senkei/replay-contract";
import type { BattlefieldEffectCue } from "./battlefield-replay-effects";

type BattlefieldState = NonNullable<Entity["battlefield"]>;
type VisibleEntity = DisplayState["entities"][string];

const palette = {
  azure: 0x4bd2df,
  vermilion: 0xee8660,
  neutral: 0xc9bf9a,
  bridge: 0xf2c879,
  ruined: 0xe6a567,
  capture: 0xffdf8b,
};

/**
 * Build short-lived Three.js meshes from exact-tick Replay transition facts.
 * Positions come from entities currently present in `state`; the cue must
 * also match its source event in `replay`. This prevents hidden transitions,
 * guessed positions, and synthetic geometry effects from being rendered.
 */
export function buildBattlefieldTransitionEffects(
  parent: THREE.Group,
  replay: Replay,
  state: DisplayState,
  effects: readonly BattlefieldEffectCue[],
): void {
  if (!effects.length) return;
  const facts = new Map<string, Event>();
  for (const event of replay.timeline) {
    if (!("entityId" in event)) continue;
    facts.set(effectKey(event.tick, event.order, event.entityId), event);
  }

  for (const cue of effects) {
    if (cue.tick !== state.tick) continue;
    const entity = state.entities[cue.entityId];
    if (!entity || !insideBounds(entity.position, replay)) continue;
    const fact = facts.get(effectKey(cue.tick, cue.order, cue.entityId));
    if (!fact || !validEffectFact(cue, fact, entity)) continue;

    const group = new THREE.Group();
    group.name = `battlefield-effect-${cue.channel}-${cue.entityId}-${cue.tick}-${cue.order}`;
    const duration = THREE.MathUtils.clamp(replay.presentation.tickDurationMs * 3, 180, 420);
    group.userData.replayTransition = true;
    group.userData.transitionChannel = cue.channel;
    group.userData.transitionTick = cue.tick;
    group.userData.transitionOrder = cue.order;
    group.userData.transitionEntityId = cue.entityId;
    group.userData.transitionDurationMs = duration;

    const baseY = groundHeight(entity.position, replay);
    group.position.set(entity.position.x, baseY + 0.035, entity.position.y);
    if (cue.channel.startsWith("bridge-")) {
      const site = entity.battlefield?.bridgeSite;
      const route = replay.scene.routes?.find((candidate) => candidate.bridgeSite === site);
      if (route && route.points.length >= 2) {
        const start = route.points[0]!, end = route.points[route.points.length - 1]!;
        group.rotation.y = -Math.atan2(end.y - start.y, end.x - start.x);
      }
    }
    if (cue.channel.startsWith("crossing-")) addCrossingCue(group, cue, entity);
    else if (cue.channel.startsWith("bridge-")) addBridgeCue(group, cue);
    else if (cue.channel.startsWith("capture-")) addCaptureCue(group, cue, entity, replay);
    else continue;
    if (group.children.length) parent.add(group);
  }
}

function addCrossingCue(group: THREE.Group, cue: BattlefieldEffectCue, entity: VisibleEntity): void {
  const color = entity.side === "azure" ? palette.azure
    : entity.side === "vermilion" ? palette.vermilion : palette.neutral;
  const count = cue.channel === "crossing-change" ? 3 : 2;
  for (let index = 0; index < count; index++) {
    const radius = 0.42 + index * 0.27;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.055, 4, 14),
      material(color, index === 0 ? 0.86 : 0.56),
    );
    ring.name = `crossing-ripple-${index}`;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.035 + index * 0.01;
    group.add(ring);
  }
  if (cue.channel !== "crossing-end") {
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      material(color, 0.92),
    );
    marker.name = "crossing-surface-marker";
    marker.position.set(0, 0.38, 0);
    group.add(marker);
  }
}

function addBridgeCue(group: THREE.Group, cue: BattlefieldEffectCue): void {
  const destruction = cue.channel === "bridge-destroyed";
  const completion = cue.channel === "bridge-expanded" || cue.channel === "bridge-rebuilt";
  const color = destruction ? palette.ruined : palette.bridge;
  addGroundRing(group, color, destruction ? 1.45 : 1.1, destruction ? 0.09 : 0.07);

  if (cue.channel === "bridge-work-started" || cue.channel === "bridge-work-progress") {
    // A brief work pulse marks the authorized bridge site while the persistent
    // architectural scaffold carries the ongoing progress state.
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.68, 0.12),
        material(0xb99053, 0.92),
      );
      beam.name = `bridge-work-post-${side}`;
      beam.position.set(side * 0.72, 0.36, 0);
      beam.rotation.z = side * -0.1;
      group.add(beam);
    }
    addBeam(group, "bridge-work-crosspiece", [1.55, 0.1, 0.12], [0, 0.69, 0], 0xd6b16c);
    addFacet(group, "bridge-work-hammer-spark", 0.16, [0, 0.86, 0], palette.capture);
    return;
  }

  if (destruction) {
    for (let index = 0; index < 5; index++) {
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(0.12 + index % 2 * 0.035, 0.32 + index % 3 * 0.1, 4),
        material(index % 2 ? palette.ruined : 0x8b795f, 0.9),
      );
      shard.name = `bridge-break-shard-${index}`;
      const angle = index * Math.PI * 0.4;
      shard.position.set(Math.cos(angle) * 0.68, 0.3 + index % 2 * 0.18, Math.sin(angle) * 0.52);
      shard.rotation.z = (index % 2 ? 1 : -1) * 0.35;
      group.add(shard);
    }
  } else if (completion) {
    for (const lateral of [-0.56, 0, 0.56]) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.1, 0.25),
        material(lateral === 0 ? palette.bridge : 0xb98a4f, 0.96),
      );
      plank.name = `bridge-completion-plank-${lateral}`;
      plank.position.set(lateral, 0.18, lateral * 0.2);
      plank.rotation.y = lateral * 0.12;
      group.add(plank);
    }
    addFacet(group, "bridge-completion-beacon", 0.2, [0, 0.62, 0], palette.capture);
  } else {
    addFacet(group, "bridge-state-marker", 0.17, [0, 0.55, 0], color);
  }
}

function addCaptureCue(
  group: THREE.Group,
  cue: BattlefieldEffectCue,
  entity: VisibleEntity,
  replay: Replay,
): void {
  const owner = cue.to?.facilityOwner;
  const side = cue.to?.captureSide;
  const color = owner === "azure" || side === "azure" ? palette.azure
    : owner === "vermilion" || side === "vermilion" ? palette.vermilion
      : entity.side === "neutral" ? palette.capture : entity.side === "azure" ? palette.azure : palette.vermilion;
  const released = cue.channel === "capture-released";
  addGroundRing(group, released ? palette.neutral : color, released ? 1.25 : 0.92, 0.07);

  if (cue.channel === "capture-progress") {
    const total = replay.scene.captureTicks;
    const progress = cue.to?.captureProgress ?? 0;
    const fraction = total && total > 0 ? THREE.MathUtils.clamp(progress / total, 0, 1) : 0;
    if (fraction > 0) {
      const pillarHeight = 0.3 + fraction * 0.9;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.1, pillarHeight, 5),
        material(color, 0.88),
      );
      pillar.name = "capture-progress-pillar";
      pillar.position.y = pillarHeight / 2 + 0.08;
      group.add(pillar);
    }
    addFacet(group, "capture-progress-cue", 0.13, [0, 0.18, 0], color);
  } else if (cue.channel === "capture-completed") {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.2, 1.6, 6),
      material(color, 0.8),
    );
    pillar.name = "capture-complete-beacon";
    pillar.position.y = 0.83;
    group.add(pillar);
    addFacet(group, "capture-complete-crest", 0.23, [0, 1.72, 0], color);
  } else {
    addFacet(group, "capture-release-cue", 0.17, [0, 0.25, 0], palette.neutral);
  }
}

function addGroundRing(group: THREE.Group, color: number, radius: number, tube: number): void {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 4, 16),
    material(color, 0.88),
  );
  ring.name = "transition-ground-ring";
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.025;
  group.add(ring);
}

function addBeam(
  group: THREE.Group,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
): void {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, 0.95));
  beam.name = name;
  beam.position.set(...position);
  group.add(beam);
}

function addFacet(
  group: THREE.Group,
  name: string,
  radius: number,
  position: [number, number, number],
  color: number,
): void {
  const facet = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), material(color, 0.94));
  facet.name = name;
  facet.position.set(...position);
  group.add(facet);
}

function material(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: false,
    toneMapped: false,
  });
}

function validEffectFact(cue: BattlefieldEffectCue, fact: Event, entity: VisibleEntity): boolean {
  if (cue.channel.startsWith("crossing-")) {
    if (entity.kind !== "unit" || fact.type !== "move" || !fact.logicalPosition || !cue.to
      || !sameState(cue.to, fact.logicalPosition) || !cue.from?.crossing || !cue.to.crossing)
      return false;
    const before = cue.from.crossing, after = cue.to.crossing;
    if (cue.channel === "crossing-start") return before === "none" && after !== "none";
    if (cue.channel === "crossing-end") return before !== "none" && after === "none";
    return before !== "none" && after !== "none" && before !== after;
  }

  if (cue.channel.startsWith("bridge-")) {
    if (entity.kind !== "bridge" || fact.type !== "facility-state"
      || !cue.to || !sameState(cue.to, fact.battlefield) || !cue.from)
      return false;
    const from = cue.from, to = cue.to;
    const oldBuild = from.buildRemaining, newBuild = to.buildRemaining;
    const buildChanged = oldBuild !== undefined && newBuild !== undefined && oldBuild !== newBuild;
    const stateChanged = Boolean(from.bridgeState && to.bridgeState && from.bridgeState !== to.bridgeState);
    if (cue.channel === "bridge-work-started") return buildChanged && oldBuild === 0 && newBuild! > 0;
    if (cue.channel === "bridge-work-progress") return buildChanged && oldBuild! > newBuild! && newBuild! > 0;
    if (cue.channel === "bridge-work-stopped") return buildChanged && oldBuild! > 0 && newBuild === 0 && !stateChanged;
    if (!stateChanged) return false;
    if (cue.channel === "bridge-destroyed") return to.bridgeState === "destroyed";
    if (cue.channel === "bridge-rebuilt") return from.bridgeState === "destroyed" && to.bridgeState === "normal";
    if (cue.channel === "bridge-expanded") return to.bridgeState === "expanded";
    return cue.channel === "bridge-state-changed";
  }

  if (cue.channel.startsWith("capture-")) {
    if (entity.kind !== "observation" || fact.type !== "facility-state"
      || !cue.to || !sameState(cue.to, fact.battlefield) || !cue.from)
      return false;
    const from = cue.from, to = cue.to;
    const progressChanged = from.captureProgress !== undefined && to.captureProgress !== undefined
      && (from.captureProgress !== to.captureProgress || from.captureSide !== to.captureSide);
    const ownerChanged = from.facilityOwner !== undefined && to.facilityOwner !== undefined
      && from.facilityOwner !== to.facilityOwner;
    if (cue.channel === "capture-progress") return progressChanged;
    if (!ownerChanged) return false;
    if (cue.channel === "capture-released") return to.facilityOwner === "neutral";
    return cue.channel === "capture-completed" && to.facilityOwner !== "neutral";
  }
  return false;
}

function sameState(a: BattlefieldState | undefined, b: BattlefieldState): boolean {
  if (!a) return false;
  const aKeys = Object.keys(a) as (keyof BattlefieldState)[];
  const bKeys = Object.keys(b) as (keyof BattlefieldState)[];
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

function effectKey(tick: number, order: number, entityId: string): string {
  return `${tick}:${order}:${entityId}`;
}

function insideBounds(point: { x: number; y: number }, replay: Replay): boolean {
  const { min, max } = replay.scene.bounds;
  return point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y;
}

function groundHeight(point: { x: number; y: number }, replay: Replay): number {
  if (!replay.scene.routes?.length) {
    const nearestLane = replay.scene.lanes.reduce(
      (best, lane) => {
        for (let index = 1; index < lane.points.length; index++) {
          const distance = distanceToSegment(point, lane.points[index - 1]!, lane.points[index]!);
          if (distance < best.distance) best = { distance, height: lane.elevation + 0.11 };
        }
        return best;
      },
      { distance: Infinity, height: 0 },
    );
    return nearestLane.height;
  }

  let best = Infinity;
  let height = -0.035;
  for (const lane of replay.scene.lanes)
    for (let index = 1; index < lane.points.length; index++) {
      const distance = distanceToSegment(point, lane.points[index - 1]!, lane.points[index]!);
      if (distance < best) {
        best = distance;
        height = lane.elevation - 0.035;
      }
    }
  for (const route of replay.scene.routes)
    if (route.region === "jungle")
      for (let index = 1; index < route.points.length; index++) {
        const distance = distanceToSegment(point, route.points[index - 1]!, route.points[index]!);
        if (distance < best) {
          best = distance;
          height = 0.047;
        }
      }
  for (const camp of replay.scene.camps ?? []) {
    const distance = Math.hypot(point.x - camp.position.x, point.y - camp.position.y);
    if (distance <= 3 && distance <= best) {
      best = distance;
      height = -0.035;
    }
  }
  return height;
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const t = THREE.MathUtils.clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
