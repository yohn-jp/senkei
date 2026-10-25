import type { CombatantSide, DomainValue } from "../../../apps/web/src/contracts/core-model";

export const FOG_REPLAY_SCHEMA_VERSION = 1 as const;
export const EDGE_SAMPLE_COUNT = 9;

export type FogVisibility = "unexplored" | "explored" | "visible";

export interface FogContact {
  readonly id: string;
  readonly state: "last_known";
  readonly kind: "hero" | "minion" | "monster";
  readonly side: CombatantSide;
  /** Last observed logical World Units; this position is never extrapolated. */
  readonly x: number;
  readonly y: number;
  readonly last_seen_tick: number;
}

/** Version 1 lives in a core Replay frame's visible_state.global_fields.fog. */
export interface FogReplayState {
  readonly schema_version: typeof FOG_REPLAY_SCHEMA_VERSION;
  readonly tick: number;
  readonly side: CombatantSide;
  readonly nodes: Readonly<Record<string, FogVisibility>>;
  /** Nine uniformly spaced values in each authored route's endpoint order. */
  readonly edges: Readonly<Record<string, readonly FogVisibility[]>>;
  /** Hidden now, remembered from a real earlier observation. */
  readonly contacts: readonly FogContact[];
}

type RecordValue = Extract<DomainValue, { kind: "record" }>;

export function parseFogReplayValue(
  input: DomainValue | undefined,
  expectedTick?: number,
  expectedSide?: CombatantSide,
): FogReplayState | undefined {
  if (!input || input.kind === "null") return undefined;
  const root = asRecord(input, "fog");
  onlyKeys(root.value, ["schema_version", "tick", "side", "nodes", "edges", "contacts"], "fog");

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

  const contactValue = root.value.contacts;
  if (!contactValue || contactValue.kind !== "list") throw new FogReplayError("fog.contacts must be a list");
  const ids = new Set<string>();
  const contacts = contactValue.value.map((value, index): FogContact => {
    const path = `fog.contacts[${index}]`;
    const contact = asRecord(value, path);
    onlyKeys(contact.value, ["id", "state", "kind", "side", "x", "y", "last_seen_tick"], path);
    const id = string(contact.value.id, `${path}.id`);
    if (!/^contact-[1-9]\d*$/.test(id) || ids.has(id)) throw new FogReplayError(`${path}.id is invalid or repeated`);
    ids.add(id);
    if (string(contact.value.state, `${path}.state`) !== "last_known") throw new FogReplayError(`${path}.state must be last_known`);
    const kind = string(contact.value.kind, `${path}.kind`);
    if (kind !== "hero" && kind !== "minion" && kind !== "monster") throw new FogReplayError(`${path}.kind is not an observable unit type`);
    const contactSide = combatantSide(contact.value.side, `${path}.side`);
    if (contactSide === side) throw new FogReplayError(`${path}.side must be the opposing side`);
    const x = integer(contact.value.x, `${path}.x`, true);
    const y = integer(contact.value.y, `${path}.y`, true);
    const lastSeenTick = integer(contact.value.last_seen_tick, `${path}.last_seen_tick`);
    if (lastSeenTick >= tick) throw new FogReplayError(`${path} must refer to a prior visible tick`);
    return { id, state: "last_known", kind, side: contactSide, x, y, last_seen_tick: lastSeenTick };
  });

  return { schema_version: FOG_REPLAY_SCHEMA_VERSION, tick, side, nodes, edges, contacts };
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

function integer(value: DomainValue | undefined, path: string, signed = false): number {
  if (!value || value.kind !== "integer" || !Number.isSafeInteger(value.value) || (!signed && value.value < 0))
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

function fogVisibility(value: DomainValue, path: string): FogVisibility {
  const visibility = string(value, path);
  if (visibility !== "unexplored" && visibility !== "explored" && visibility !== "visible")
    throw new FogReplayError(`${path} is not a Fog visibility state`);
  return visibility;
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
