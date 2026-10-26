import type { DisplayEntity, Entity, Replay, WorldPoint } from "@senkei/replay-contract";
import { effectiveTrackPoint } from "./battlefield-unit-motion";

type Sample = { readonly tick: number; readonly yaw: number | undefined };

function direction(from: WorldPoint, to: WorldPoint): number | undefined {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.hypot(dx, dy) > 0.001 ? Math.atan2(dx, dy) : undefined;
}

/**
 * Sparse orientation history from authorized Replay facts only. Idle units
 * retain their last visible heading; disappear ends that history. Queries do
 * not depend on the renderer's previous cursor, frame rate or model layout.
 */
export class BattlefieldUnitOrientationIndex {
  private readonly samples = new Map<string, Sample[]>();

  constructor(replay: Replay) {
    const visible = new Map<string, DisplayEntity>();
    const appear = (entity: Entity, tick: number) => {
      const current = { ...entity, destroyed: false };
      visible.set(entity.id, current);
      if (entity.kind !== "unit") return;
      const opposite = replay.scene.baseSites?.find(site => site.side !== entity.side);
      this.record(entity.id, tick, opposite
        ? direction(effectiveTrackPoint(current, replay), opposite.position) ?? 0
        : 0);
    };
    for (const entity of replay.initialView) appear(entity, 0);

    let cursor = 0;
    while (cursor < replay.timeline.length) {
      const tick = replay.timeline[cursor]!.tick;
      const movedBefore = new Map<string, DisplayEntity>();
      const attacks = new Map<string, string>();
      while (cursor < replay.timeline.length && replay.timeline[cursor]!.tick === tick) {
        const event = replay.timeline[cursor++]!;
        if (event.type === "match-end") continue;
        if (event.type === "spawn") {
          movedBefore.delete(event.entity.id);
          attacks.delete(event.entity.id);
          appear(event.entity, tick);
          continue;
        }
        const current = visible.get(event.entityId);
        if (!current) continue;
        if (event.type === "disappear") {
          visible.delete(event.entityId);
          movedBefore.delete(event.entityId);
          attacks.delete(event.entityId);
          if (current.kind === "unit") this.record(event.entityId, tick, undefined);
        } else if (event.type === "move") {
          if (!movedBefore.has(event.entityId)) movedBefore.set(event.entityId, current);
          visible.set(event.entityId, { ...current, position: event.position,
            ...(event.logicalPosition ? { battlefield: event.logicalPosition } : {}) });
        } else if (event.type === "attack" && !attacks.has(event.entityId)) {
          attacks.set(event.entityId, event.targetId);
        } else if (event.type === "destroy") {
          visible.set(event.entityId, { ...current, destroyed: true });
        }
      }
      for (const [id, before] of movedBefore) {
        const after = visible.get(id);
        if (!after || after.kind !== "unit") continue;
        const yaw = direction(effectiveTrackPoint(before, replay), effectiveTrackPoint(after, replay));
        if (yaw !== undefined) this.record(id, tick, yaw);
      }
      // Like the current-Tick renderer, a confirmed attack takes precedence
      // over movement and uses the final authorized positions at that Tick.
      for (const [id, targetId] of attacks) {
        const actor = visible.get(id), target = visible.get(targetId);
        if (!actor || actor.kind !== "unit" || !target) continue;
        const yaw = direction(effectiveTrackPoint(actor, replay), effectiveTrackPoint(target, replay));
        if (yaw !== undefined) this.record(id, tick, yaw);
      }
    }
  }

  private record(id: string, tick: number, yaw: number | undefined): void {
    const samples = this.samples.get(id) ?? [];
    const previous = samples.at(-1);
    if (previous?.tick === tick) samples[samples.length - 1] = { tick, yaw };
    else if (!previous || previous.yaw !== yaw) samples.push({ tick, yaw });
    this.samples.set(id, samples);
  }

  at(tick: number, entityId: string): number | undefined {
    const samples = this.samples.get(entityId) ?? [];
    let low = 0, high = samples.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle]!.tick <= tick) low = middle + 1;
      else high = middle;
    }
    return samples[low - 1]?.yaw;
  }
}
