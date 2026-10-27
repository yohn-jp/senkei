import type { DisplayEntity, DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";
import { NodeDisplayLayout } from "./node-display-layout";

type Sample = { readonly tick: number; readonly offset: WorldPoint | null };
type ReplayEvent = Replay["timeline"][number];

/**
 * Canonical presentation slots from the authorized Replay, independent of the
 * order in which the renderer visits ticks. The existing allocator runs once
 * per event tick, not once for every earlier tick on every seek.
 */
export class BattlefieldReplayLayoutIndex {
  private readonly samples = new Map<string, Sample[]>();

  constructor(replay: Replay) {
    const byTick = new Map<number, ReplayEvent[]>();
    byTick.set(0, []);
    for (const event of replay.timeline) {
      // Combat cues and vitals cannot change layout membership or placement.
      if (event.type !== "spawn" && event.type !== "move" && event.type !== "facility-state"
        && event.type !== "destroy" && event.type !== "disappear") continue;
      const events = byTick.get(event.tick) ?? [];
      events.push(event);
      byTick.set(event.tick, events);
      // A death is shown for its confirmed tick, but not on subsequent ticks.
      if (event.type === "destroy" && event.tick < replay.result.tick && !byTick.has(event.tick + 1))
        byTick.set(event.tick + 1, []);
    }

    const entities: Record<string, DisplayEntity> = Object.create(null);
    for (const entity of replay.initialView) entities[entity.id] = { ...entity, destroyed: false };
    const allocator = new NodeDisplayLayout();
    let previous = new Map<string, WorldPoint>();
    for (const [tick, events] of [...byTick].sort(([a], [b]) => a - b)) {
      for (const event of events) {
        if (event.type === "spawn") {
          entities[event.entity.id] = { ...event.entity, destroyed: false };
        } else if (event.type === "disappear") {
          delete entities[event.entityId];
        } else if (event.type === "match-end") {
          continue;
        } else {
          const current = entities[event.entityId];
          if (!current) continue; // Decoded Replay validation rejects inactive references.
          if (event.type === "move") entities[event.entityId] = {
            ...current, position: event.position,
            ...(event.logicalPosition ? { battlefield: event.logicalPosition } : {}),
          };
          else if (event.type === "facility-state") entities[event.entityId] = {
            ...current, battlefield: event.battlefield,
            ...(event.battlefield.facilityOwner ? { side: event.battlefield.facilityOwner } : {}),
          };
          else if (event.type === "destroy") entities[event.entityId] = { ...current, destroyed: true };
        }
      }
      const state: DisplayState = { tick, entities, cues: events, result: null };
      const offsets = allocator.update(state, replay);
      const ids = new Set([...previous.keys(), ...offsets.keys()]);
      for (const id of ids) {
        const before = previous.get(id), after = offsets.get(id);
        if (before && after && before.x === after.x && before.y === after.y) continue;
        const history = this.samples.get(id) ?? [];
        history.push({ tick, offset: after ? { ...after } : null });
        this.samples.set(id, history);
      }
      previous = new Map(offsets);
    }
  }

  at(state: DisplayState): ReadonlyMap<string, WorldPoint> {
    const offsets = new Map<string, WorldPoint>();
    for (const id of Object.keys(state.entities).sort()) {
      const history = this.samples.get(id);
      if (!history) continue;
      let low = 0, high = history.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (history[middle]!.tick <= state.tick) low = middle + 1;
        else high = middle;
      }
      const offset = history[low - 1]?.offset;
      if (offset) offsets.set(id, offset);
    }
    return offsets;
  }
}
