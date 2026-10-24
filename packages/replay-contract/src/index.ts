import Ajv2020 from "ajv/dist/2020.js";
import schema from "../replay.schema.json";
import type {
  PresentationReplay,
  Entity,
  Event,
  Result,
  WorldPoint,
} from "./generated";
export type {
  PresentationReplay,
  Entity,
  Event,
  Result,
  WorldPoint,
} from "./generated";
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type Replay = DeepReadonly<PresentationReplay>;
export type DisplayEntity = DeepReadonly<Entity & { destroyed: boolean }>;
export type DisplayState = DeepReadonly<{
  tick: number;
  entities: Record<string, DisplayEntity>;
  cues: Event[];
  result: Result | null;
}>;
export function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value as DeepReadonly<T>;
}
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile<PresentationReplay>(schema);
export class ReplayError extends Error {}
export function decodeReplay(input: unknown): Replay {
  if (!validate(input)) {
    const first = validate.errors?.[0];
    throw new ReplayError(
      `Schema: ${first?.instancePath || "/"} ${first?.message ?? "invalid"}`,
    );
  }
  const r = structuredClone(input);
  const fail = (message: string): never => {
    throw new ReplayError(message);
  };
  if (r.header.origin === "sample" && r.header.enbuVersion !== null)
    fail("Sample must not claim an Enbu execution");
  if ((r.header.origin === "official" || r.header.origin === "local") && !r.header.enbuVersion)
    fail("Official replay requires an Enbu version");
  const { min, max } = r.scene.bounds;
  if (min.x >= max.x || min.y >= max.y) fail("Invalid scene bounds");
  const point = (p: WorldPoint) => {
    if (p.x < min.x || p.x > max.x || p.y < min.y || p.y > max.y)
      fail("Position outside scene");
  };
  const lanes = new Set<string>();
  for (const lane of r.scene.lanes) {
    if (lanes.has(lane.id)) fail("Duplicate lane ID");
    lanes.add(lane.id);
    lane.points.forEach(point);
  }
  const entities = new Map<string, Entity>();
  const seen = new Set<string>();
  const add = (e: Entity) => {
    if (seen.has(e.id)) fail(`Entity ID reused: ${e.id}`);
    if (e.hp <= 0 || e.hp > e.maxHp) fail(`Invalid initial HP: ${e.id}`);
    point(e.position);
    seen.add(e.id);
    entities.set(e.id, structuredClone(e));
  };
  r.initialView.forEach(add);
  let previousTick = -1,
    previousOrder = -1,
    ended = false;
  for (const e of r.timeline) {
    if (ended) fail("Event after match-end");
    if (
      e.tick < previousTick ||
      (e.tick === previousTick && e.order <= previousOrder)
    )
      fail(`Event order at tick ${e.tick}`);
    if (e.tick > r.result.tick) fail("Event beyond result tick");
    previousTick = e.tick;
    previousOrder = e.order;
    if ((e.type === "vitals" || e.type === "skill") && r.schemaVersion !== "0.2") fail("Event requires replay 0.2");
    if (e.type === "spawn") {
      add(e.entity);
      continue;
    }
    if (e.type === "match-end") {
      if (
        e.tick !== r.result.tick ||
        e.result.tick !== e.tick ||
        e.result.winner !== r.result.winner ||
        e.result.reason !== r.result.reason
      )
        fail("Result does not match match-end");
      ended = true;
      continue;
    }
    const entity = entities.get(e.entityId);
    if (!entity) fail(`Unknown or inactive entity: ${e.entityId}`);
    const current = entity!;
    if (e.type === "destroy") {
      if (current.hp !== 0) fail("Destroy requires confirmed zero HP");
      entities.delete(e.entityId);
    } else if (e.type === "disappear") entities.delete(e.entityId);
    else {
      if (current.hp === 0)
        fail("Zero HP entity requires destroy or disappear");
      if (e.type === "move") {
        point(e.position);
        current.position = e.position;
      }
      if (e.type === "vitals") {
        if (e.hp > e.maxHp) fail("HP exceeds maximum");
        current.hp = e.hp; current.maxHp = e.maxHp;
      }
      if (e.type === "damage") {
        if (e.hp > current.hp) fail("Damage cannot increase HP");
        current.hp = e.hp;
      }
      if (
        (e.type === "attack" || e.type === "skill") &&
        (!entities.has(e.targetId) || entities.get(e.targetId)!.hp === 0)
      )
        fail(`Invalid attack target: ${e.targetId}`);
    }
  }
  if (!ended) fail("Missing match-end");
  return freeze(r);
}
export { presentationToGraphics, NEXT_WORLD_UNITS_PER_RENDER_UNIT } from "./next-adapter";
