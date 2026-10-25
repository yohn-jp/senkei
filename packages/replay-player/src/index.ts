import {
  freeze,
  type Replay,
  type DisplayState,
  type DisplayEntity,
  type Event,
} from "@senkei/replay-contract";

/** Projection only: no movement, combat, or victory calculation. */
export function stateAt(replay: Replay, tick: number): DisplayState {
  if (!Number.isInteger(tick) || tick < 0 || tick > replay.result.tick)
    throw new RangeError("Tick out of range");
  const entities: Record<string, DisplayEntity> = Object.create(null);
  for (const e of replay.initialView)
    entities[e.id] = { ...e, destroyed: false };
  let result: DisplayState["result"] = null;
  const cues: Event[] = [];
  for (const event of replay.timeline) {
    if (event.tick > tick) break;
    if (
      event.tick >= tick - 1 &&
      ["attack", "skill", "damage", "vitals", "destroy", "spawn"].includes(event.type)
    )
      cues.push(event as Event);
    if (event.type === "spawn")
      entities[event.entity.id] = { ...event.entity, destroyed: false };
    else if (event.type === "match-end") result = event.result;
    else if (event.type === "disappear") delete entities[event.entityId];
    else {
      const current = entities[event.entityId];
      if (event.type === "move")
        entities[event.entityId] = {
          ...current,
          position: event.position,
          ...(event.logicalPosition ? { battlefield: event.logicalPosition } : {}),
        };
      if (event.type === "facility-state")
        entities[event.entityId] = { ...current, battlefield: event.battlefield,
          ...(event.battlefield.facilityOwner ? { side: event.battlefield.facilityOwner } : {}) };
      if (event.type === "vitals")
        entities[event.entityId] = { ...current, hp: event.hp, maxHp: event.maxHp };
      if (event.type === "damage")
        entities[event.entityId] = { ...current, hp: event.hp };
      if (event.type === "destroy")
        entities[event.entityId] = { ...current, destroyed: true };
    }
  }
  let fogFrame: NonNullable<Replay["fog"]>["frames"][number] | undefined;
  for (const frame of replay.fog?.frames ?? []) {
    if (frame.tick > tick) break;
    fogFrame = frame;
  }
  return freeze({ tick, entities, cues, result, ...(fogFrame ? {
    fog: { state: fogFrame, worldUnitsPerRenderUnit: replay.fog!.worldUnitsPerRenderUnit },
  } : {}) });
}
export class ReplayPlayer {
  private current: DisplayState;
  private active = false;
  private rate = 1;
  private accumulated = 0;
  private listeners = new Set<() => void>();
  constructor(readonly replay: Replay) {
    this.current = stateAt(replay, 0);
  }
  get state() {
    return this.current;
  }
  get playing() {
    return this.active;
  }
  get speed() {
    return this.rate;
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  play() {
    if (this.current.tick === this.replay.result.tick)
      this.current = stateAt(this.replay, 0);
    this.active = this.current.tick < this.replay.result.tick;
    this.emit();
  }
  pause() {
    this.active = false;
    this.emit();
  }
  setSpeed(speed: number) {
    if (![1, 2, 4].includes(speed)) throw new RangeError("Unsupported speed");
    this.rate = speed;
    this.emit();
  }
  seek(tick: number) {
    this.current = stateAt(this.replay, tick);
    this.accumulated = 0;
    if (this.current.result) this.active = false;
    this.emit();
  }
  reset() {
    this.active = false;
    this.seek(0);
  }
  /** Elapsed time drives only the playback cursor. Paused time is never consumed. */
  advance(elapsedMs: number) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
      throw new RangeError("Invalid elapsed time");
    if (!this.active) return;
    this.accumulated += elapsedMs * this.rate;
    const steps = Math.floor(
      this.accumulated / this.replay.presentation.tickDurationMs,
    );
    if (!steps) return;
    this.accumulated %= this.replay.presentation.tickDurationMs;
    this.current = stateAt(
      this.replay,
      Math.min(this.replay.result.tick, this.current.tick + steps),
    );
    if (this.current.result) {
      this.active = false;
      this.accumulated = 0;
    }
    this.emit();
  }
}
