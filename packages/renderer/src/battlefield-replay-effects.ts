import type { Entity, Event, Replay } from "@senkei/replay-contract";

type BattlefieldState = NonNullable<Entity["battlefield"]>;

export type BattlefieldEffectChannel =
  | "attack"
  | "skill"
  | "hit"
  | "death"
  | "crossing-start"
  | "crossing-change"
  | "crossing-end"
  | "bridge-work-started"
  | "bridge-work-progress"
  | "bridge-work-stopped"
  | "bridge-expanded"
  | "bridge-destroyed"
  | "bridge-rebuilt"
  | "bridge-state-changed"
  | "capture-progress"
  | "capture-completed"
  | "capture-released";

export interface BattlefieldEffectCue {
  readonly tick: number;
  readonly order: number;
  readonly entityId: string;
  readonly channel: BattlefieldEffectChannel;
  /** State directly reported by the same authorized Replay event. */
  readonly from?: BattlefieldState;
  readonly to?: BattlefieldState;
}

interface VisibleEntity {
  readonly kind: Entity["kind"];
  readonly battlefield?: BattlefieldState;
}

/**
 * Indexes action and facility transition cues from the authorized public
 * Replay. A disappear event erases prior state; a later spawn begins a fresh
 * visible history and cannot reveal a transition that happened while hidden.
 */
export class BattlefieldReplayEffectIndex {
  private readonly byTick = new Map<number, readonly BattlefieldEffectCue[]>();

  constructor(replay: Replay) {
    const visible = new Map<string, VisibleEntity>();
    for (const entity of replay.initialView)
      visible.set(entity.id, { kind: entity.kind, battlefield: entity.battlefield });

    for (const event of replay.timeline) {
      if (event.type === "spawn") {
        visible.set(event.entity.id, {
          kind: event.entity.kind,
          battlefield: event.entity.battlefield,
        });
        continue;
      }
      if (event.type === "disappear") {
        visible.delete(event.entityId);
        continue;
      }

      const current = "entityId" in event ? visible.get(event.entityId) : undefined;
      if (!current || !("entityId" in event)) continue;

      const effects: BattlefieldEffectCue[] = [];
      const add = (
        channel: BattlefieldEffectChannel,
        from?: BattlefieldState,
        to?: BattlefieldState,
      ) => effects.push({
        tick: event.tick,
        order: event.order,
        entityId: event.entityId,
        channel,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });

      if (event.type === "attack") add("attack");
      else if (event.type === "skill") add("skill");
      else if (event.type === "damage") add("hit");
      else if (event.type === "destroy" && current.kind === "unit") add("death");
      else if (event.type === "move" && current.kind === "unit" && event.logicalPosition) {
        const from = current.battlefield;
        const to = event.logicalPosition;
        const before = from?.crossing;
        const after = to.crossing;
        if (before !== undefined && after !== undefined && before !== after) {
          if (before === "none" && after !== "none") add("crossing-start", from, to);
          else if (before !== "none" && after === "none") add("crossing-end", from, to);
          else add("crossing-change", from, to);
        }
        visible.set(event.entityId, { ...current, battlefield: to });
      } else if (event.type === "facility-state") {
        const from = current.battlefield;
        const to = event.battlefield;
        if (current.kind === "bridge") indexBridgeChanges(from, to, add);
        else if (current.kind === "observation") indexCaptureChanges(from, to, add);
        visible.set(event.entityId, { ...current, battlefield: to });
      } else if (event.type === "move" && event.logicalPosition) {
        visible.set(event.entityId, { ...current, battlefield: event.logicalPosition });
      }

      if (effects.length) {
        const tickEffects = this.byTick.get(event.tick) ?? [];
        this.byTick.set(event.tick, [...tickEffects, ...effects]);
      }

      if (event.type === "destroy") {
        // Preserve the entity through its confirmed death cue. It is removed
        // only by disappear, which means the public view was lost.
        continue;
      }
      if (event.type === "facility-state") continue;
      if (event.type === "move" && event.logicalPosition) continue;
    }
  }

  at(tick: number, entityId?: string): readonly BattlefieldEffectCue[] {
    const effects = this.byTick.get(tick) ?? [];
    return entityId === undefined
      ? effects
      : effects.filter((effect) => effect.entityId === entityId);
  }
}

function indexBridgeChanges(
  from: BattlefieldState | undefined,
  to: BattlefieldState,
  add: (channel: BattlefieldEffectChannel, from?: BattlefieldState, to?: BattlefieldState) => void,
): void {
  if (!from) return;

  const beforeBuild = from.buildRemaining;
  const afterBuild = to.buildRemaining;
  if (beforeBuild !== undefined && afterBuild !== undefined && beforeBuild !== afterBuild) {
    if (beforeBuild === 0 && afterBuild > 0) add("bridge-work-started", from, to);
    else if (beforeBuild > afterBuild && afterBuild > 0) add("bridge-work-progress", from, to);
    else if (beforeBuild > 0 && afterBuild === 0 && from.bridgeState === to.bridgeState)
      add("bridge-work-stopped", from, to);
  }

  if (!from.bridgeState || !to.bridgeState || from.bridgeState === to.bridgeState) return;
  if (to.bridgeState === "destroyed") add("bridge-destroyed", from, to);
  else if (from.bridgeState === "destroyed" && to.bridgeState === "normal") add("bridge-rebuilt", from, to);
  else if (to.bridgeState === "expanded") add("bridge-expanded", from, to);
  else add("bridge-state-changed", from, to);
}

function indexCaptureChanges(
  from: BattlefieldState | undefined,
  to: BattlefieldState,
  add: (channel: BattlefieldEffectChannel, from?: BattlefieldState, to?: BattlefieldState) => void,
): void {
  if (!from) return;
  if (from.captureProgress !== undefined && to.captureProgress !== undefined
    && (from.captureProgress !== to.captureProgress || from.captureSide !== to.captureSide))
    add("capture-progress", from, to);

  if (from.facilityOwner === undefined || to.facilityOwner === undefined
    || from.facilityOwner === to.facilityOwner) return;
  if (to.facilityOwner === "neutral") add("capture-released", from, to);
  else add("capture-completed", from, to);
}
