import type { CombatantSide, DomainValue } from "../../../apps/web/src/contracts/core-model";

export const FOG_REPLAY_SCHEMA_VERSION = 1 as const;
export const EDGE_SAMPLE_COUNT = 9;

export type FogVisibility = "unexplored" | "explored" | "visible";

export type FogFacilitySide = CombatantSide | "neutral";

export interface FogFacilityState {
  readonly hp?: number;
  readonly max_hp?: number;
  readonly build_remaining?: number;
  readonly capture_progress?: number;
  readonly bridge_state?: string;
  readonly build_kind?: string;
  readonly capture_owner?: string;
  readonly capture_progress_side?: string;
}

export interface FogFacility {
  readonly id: string;
  readonly state: "last_known";
  readonly kind: "tower" | "base" | "bridge" | "observation";
  readonly side: FogFacilitySide;
  /** Public World node ID or fixed bridge site ID. */
  readonly site: string;
  readonly last_seen_tick: number;
  readonly facility_state?: FogFacilityState;
}

/** Version 1 lives in a core Replay frame's visible_state.global_fields.fog. */
export interface FogReplayState {
  readonly schema_version: typeof FOG_REPLAY_SCHEMA_VERSION;
  readonly tick: number;
  readonly side: CombatantSide;
  readonly nodes: Readonly<Record<string, FogVisibility>>;
  /** Nine uniformly spaced values in each authored route's endpoint order. */
  readonly edges: Readonly<Record<string, readonly FogVisibility[]>>;
  /** Hidden now; includes only a facility's last observed state and tick. */
  readonly facilities: readonly FogFacility[];
}

type RecordValue = Extract<DomainValue, { kind: "record" }>;

export function parseFogReplayValue(
  input: DomainValue | undefined,
  expectedTick?: number,
  expectedSide?: CombatantSide,
): FogReplayState | undefined {
  if (!input || input.kind === "null") return undefined;
  const root = asRecord(input, "fog");
  onlyKeys(root.value, ["schema_version", "tick", "side", "nodes", "edges", "facilities"], "fog");

  const schemaVersion = integer(root.value.schema_version, "fog.schema_version");
  if (schemaVersion !== FOG_REPLAY_SCHEMA_VERSION) throw new FogReplayError("Unsupported Fog Replay schema version");
  const tick = integer(root.value.tick, "fog.tick");
  if (expectedTick !== undefined && expectedTick !== tick) throw new FogReplayError("Fog Replay tick mismatch");
  const side = combatantSide(root.value.side, "fog.side");
  if (expectedSide !== undefined && expectedSide !== side) throw new FogReplayError("Fog Replay perspective mismatch");

  const nodeRecord = asRecord(root.value.nodes, "fog.nodes");
  const nodes = emptyRecord<FogVisibility>();
  for (const [id, value] of Object.entries(nodeRecord.value)) nodes[id] = fogVisibility(value, `fog.nodes.${id}`);

  const edgeRecord = asRecord(root.value.edges, "fog.edges");
  const edges = emptyRecord<readonly FogVisibility[]>();
  for (const [id, value] of Object.entries(edgeRecord.value)) {
    if (value.kind !== "list" || value.value.length !== EDGE_SAMPLE_COUNT)
      throw new FogReplayError(`fog.edges.${id} must have ${EDGE_SAMPLE_COUNT} samples`);
    edges[id] = value.value.map((sample, index) => fogVisibility(sample, `fog.edges.${id}[${index}]`));
  }

  const facilityValue = root.value.facilities;
  if (!facilityValue || facilityValue.kind !== "list") throw new FogReplayError("fog.facilities must be a list");
  const ids = new Set<string>();
  const facilities = facilityValue.value.map((value, index): FogFacility => {
    const path = `fog.facilities[${index}]`;
    const facility = asRecord(value, path);
    onlyKeys(facility.value, ["id", "state", "kind", "side", "site", "last_seen_tick", "facility_state"], path);
    const id = string(facility.value.id, `${path}.id`);
    if (!/^facility-[1-9]\d*$/.test(id) || ids.has(id)) throw new FogReplayError(`${path}.id is invalid or repeated`);
    ids.add(id);
    if (string(facility.value.state, `${path}.state`) !== "last_known") throw new FogReplayError(`${path}.state must be last_known`);
    const kind = string(facility.value.kind, `${path}.kind`);
    if (kind !== "tower" && kind !== "base" && kind !== "bridge" && kind !== "observation")
      throw new FogReplayError(`${path}.kind is not an observable facility type`);
    const facilityOwner = fogFacilitySide(facility.value.side, `${path}.side`);
    const site = string(facility.value.site, `${path}.site`);
    if (!site) throw new FogReplayError(`${path}.site must be a public static site key`);
    const lastSeenTick = integer(facility.value.last_seen_tick, `${path}.last_seen_tick`);
    if (lastSeenTick >= tick) throw new FogReplayError(`${path} must refer to a prior visible tick`);
    const facilityState = facility.value.facility_state === undefined
      ? undefined
      : parseFacilityState(facility.value.facility_state, `${path}.facility_state`);
    return {
      id, state: "last_known", kind, side: facilityOwner, site, last_seen_tick: lastSeenTick,
      ...(facilityState ? { facility_state: facilityState } : {}),
    };
  });

  return { schema_version: FOG_REPLAY_SCHEMA_VERSION, tick, side, nodes, edges, facilities };
}

export class FogReplayError extends Error {}

function asRecord(value: DomainValue | undefined, path: string): RecordValue {
  if (!value || value.kind !== "record") throw new FogReplayError(`${path} must be a record`);
  return value;
}

function onlyKeys(value: Readonly<Record<string, DomainValue>>, allowed: readonly string[], path: string): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) throw new FogReplayError(`${path}.${key} is outside the Fog Replay contract`);
  }
}

function integer(value: DomainValue | undefined, path: string): number {
  if (!value || value.kind !== "integer" || !Number.isSafeInteger(value.value) || value.value < 0)
    throw new FogReplayError(`${path} must be a non-negative safe integer`);
  return value.value;
}

function string(value: DomainValue | undefined, path: string): string {
  if (!value || value.kind !== "string") throw new FogReplayError(`${path} must be a string`);
  return value.value;
}

function combatantSide(value: DomainValue | undefined, path: string): CombatantSide {
  const side = string(value, path);
  if (side !== "attacker" && side !== "defender") throw new FogReplayError(`${path} is not a combatant side`);
  return side;
}

function fogFacilitySide(value: DomainValue | undefined, path: string): FogFacilitySide {
  const side = string(value, path);
  if (side !== "attacker" && side !== "defender" && side !== "neutral")
    throw new FogReplayError(`${path} is not a facility side`);
  return side;
}

function parseFacilityState(value: DomainValue, path: string): FogFacilityState {
  const record = asRecord(value, path);
  const allowed = [
    "hp", "max_hp", "build_remaining", "capture_progress", "bridge_state", "build_kind",
    "capture_owner", "capture_progress_side",
  ] as const;
  onlyKeys(record.value, allowed, path);
  const result: {
    hp?: number;
    max_hp?: number;
    build_remaining?: number;
    capture_progress?: number;
    bridge_state?: string;
    build_kind?: string;
    capture_owner?: string;
    capture_progress_side?: string;
  } = {};
  for (const key of ["hp", "max_hp", "build_remaining", "capture_progress"] as const) {
    const field = record.value[key];
    if (field !== undefined) result[key] = integer(field, `${path}.${key}`);
  }
  for (const key of ["bridge_state", "build_kind", "capture_owner", "capture_progress_side"] as const) {
    const field = record.value[key];
    if (field !== undefined) result[key] = string(field, `${path}.${key}`);
  }
  return result;
}

function fogVisibility(value: DomainValue, path: string): FogVisibility {
  const visibility = string(value, path);
  if (visibility !== "unexplored" && visibility !== "explored" && visibility !== "visible")
    throw new FogReplayError(`${path} is not a Fog visibility state`);
  return visibility;
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
