import type {
  DisplayEntity,
  Event,
  Replay,
  WorldPoint,
} from "@senkei/replay-contract";

export interface BattlefieldUnitMotion {
  readonly dx: number;
  readonly dy: number;
}

export function effectiveTrackPoint(entity: DisplayEntity, replay: Replay): WorldPoint {
  const logical = entity.battlefield;
  if (
    !logical?.edgeTo ||
    (logical.track !== "LEFT" && logical.track !== "RIGHT")
  ) return entity.position;

  const from = replay.scene.nodes?.find((node) => node.id === logical.node)?.position;
  const to = replay.scene.nodes?.find((node) => node.id === logical.edgeTo)?.position;
  const edge = (replay.scene.routes ?? []).find((route) =>
    ((route.points[0].x === from?.x && route.points[0].y === from?.y && route.points[1].x === to?.x && route.points[1].y === to?.y) ||
     (route.points[1].x === from?.x && route.points[1].y === from?.y && route.points[0].x === to?.x && route.points[0].y === to?.y)),
  );
  if (!from || !to || edge?.region !== "lane" || edge.bridgeSite || logical.crossing === "bridge")
    return entity.position;

  const dx = edge.points[1].x - edge.points[0].x;
  const dy = edge.points[1].y - edge.points[0].y;
  const length = Math.hypot(dx, dy) || 1;
  const direction = logical.crossing === "track" ? 0 : logical.track === "LEFT" ? -1 : 1;
  const offset = (replay.scene.trackOffset ?? 0.8) * direction;
  return {
    x: entity.position.x + dy / length * offset,
    y: entity.position.y - dx / length * offset,
  };
}

function movedEntity(entity: DisplayEntity, event: Extract<Event, { type: "move" }>): DisplayEntity {
  return {
    ...entity,
    position: event.position,
    ...(event.logicalPosition ? { battlefield: event.logicalPosition } : {}),
  };
}

/**
 * Indexes public Replay movement by tick. It compares each tick's final
 * authorized position with the prior tick and never consults layout offsets,
 * visibility gaps, or the renderer's current playback cursor.
 */
export class BattlefieldUnitMotionIndex {
  private readonly byTick = new Map<number, ReadonlyMap<string, BattlefieldUnitMotion>>();

  constructor(replay: Replay) {
    const entities = new Map<string, DisplayEntity>();
    for (const entity of replay.initialView)
      entities.set(entity.id, { ...entity, destroyed: false });

    let cursor = 0;
    while (cursor < replay.timeline.length) {
      const tick = replay.timeline[cursor]!.tick;
      const movedBefore = new Map<string, DisplayEntity>();
      while (cursor < replay.timeline.length && replay.timeline[cursor]!.tick === tick) {
        const event = replay.timeline[cursor++]!;
        if (event.type === "spawn") {
          entities.set(event.entity.id, { ...event.entity, destroyed: false });
        } else if (event.type === "match-end") {
          continue;
        } else if (event.type === "move") {
          const current = entities.get(event.entityId);
          if (current) {
            if (!movedBefore.has(event.entityId)) movedBefore.set(event.entityId, current);
            entities.set(event.entityId, movedEntity(current, event));
          }
        } else if (event.type === "destroy") {
          const current = entities.get(event.entityId);
          if (current) entities.set(event.entityId, { ...current, destroyed: true });
        } else if (event.type === "disappear") {
          entities.delete(event.entityId);
        } else if (event.type === "facility-state") {
          const current = entities.get(event.entityId);
          if (current) entities.set(event.entityId, {
            ...current,
            battlefield: event.battlefield,
            ...(event.battlefield.facilityOwner ? { side: event.battlefield.facilityOwner } : {}),
          });
        } else if (event.type === "vitals") {
          const current = entities.get(event.entityId);
          if (current) entities.set(event.entityId, { ...current, hp: event.hp, maxHp: event.maxHp });
        } else if (event.type === "damage") {
          const current = entities.get(event.entityId);
          if (current) entities.set(event.entityId, { ...current, hp: event.hp });
        }
      }

      const moved = new Map<string, BattlefieldUnitMotion>();
      for (const [id, before] of movedBefore) {
        const after = entities.get(id);
        if (!after || before.kind !== "unit" || after.kind !== "unit") continue;
        const from = effectiveTrackPoint(before, replay);
        const to = effectiveTrackPoint(after, replay);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (Math.hypot(dx, dy) > 0.001) moved.set(id, { dx, dy });
      }
      if (moved.size) this.byTick.set(tick, moved);
    }
  }

  at(tick: number, entityId: string): BattlefieldUnitMotion | undefined {
    return this.byTick.get(tick)?.get(entityId);
  }
}

export interface BattlefieldUnitPose {
  readonly walk: number;
  readonly strike: number;
  readonly hit: number;
  readonly attackLean: number;
}

/**
 * Returns rig offsets for the current Replay tick. When motion is paused or
 * reduced, confirmed actions use phase 0.5 so the pose remains visible and
 * repeatable; inactive units remain at their rest pose.
 */
export function battlefieldUnitPose(
  tick: number,
  cues: readonly Event[],
  entityId: string,
  moving: boolean,
  animate: boolean,
  phase: number,
): BattlefieldUnitPose {
  let attack = false;
  let basicAttack = false;
  let hit = false;
  for (const cue of cues) {
    if (!("entityId" in cue) || cue.tick !== tick || cue.entityId !== entityId) continue;
    if (cue.type === "attack" || cue.type === "skill") attack = true;
    if (cue.type === "attack") basicAttack = true;
    if (cue.type === "damage") hit = true;
  }
  const actionPhase = animate ? phase : (moving || attack || hit ? 0.5 : 0);
  const walkPhase = animate ? tick + phase : tick + 0.5;
  const sample = Math.sin(actionPhase * Math.PI);
  return {
    walk: moving && !attack ? Math.sin(walkPhase * Math.PI) * 0.34 : 0,
    strike: attack ? sample : 0,
    hit: hit ? sample : 0,
    attackLean: basicAttack ? sample * 0.16 : 0,
  };
}
