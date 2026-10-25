import type { CombatantSide, DomainValue, EntityStateView } from "../../contracts";

export interface PresentedBattlefieldState {
  readonly node?: string;
  readonly edgeTo?: string;
  readonly progress?: number;
  readonly track?: "LEFT" | "CENTER" | "RIGHT";
  readonly crossing?: "none" | "track" | "bridge" | "ford";
}

export interface PresentedEntityIdentity {
  readonly archetype: string;
  readonly side: "azure" | "vermilion" | "neutral";
  readonly catalogId?: string;
  readonly battlefield?: PresentedBattlefieldState;
}

export interface MapEdgeIdentity {
  readonly from: string;
  readonly to: string;
  readonly bridge_site?: string;
}

function stringField(value: DomainValue | undefined): string | null {
  if (!value) return null;
  return value.kind === "string" || value.kind === "enum" || value.kind === "entity" ? value.value : null;
}

function integerField(value: DomainValue | undefined): number | null {
  return value?.kind === "integer" ? value.value : null;
}

/** Match private owner-frame identity to its same-tick canonical graph location. */
export function matchesPresentedEntity(
  raw: EntityStateView,
  presented: PresentedEntityIdentity,
  mapEdges: readonly MapEdgeIdentity[],
): boolean {
  const battlefield = presented.battlefield;
  const owner: CombatantSide | null = presented.side === "azure" ? "attacker" : presented.side === "vermilion" ? "defender" : null;
  if (!battlefield || raw.entity_type !== presented.archetype || raw.owner !== owner ||
      (presented.catalogId !== undefined && stringField(raw.fields.catalog_id) !== presented.catalogId)) return false;

  const node = stringField(raw.fields.node);
  const edgeTo = stringField(raw.fields.edge_to) ?? "";
  const progress = integerField(raw.fields.edge_progress) ?? 0;
  const rawTrack = stringField(raw.fields.track);
  const track = rawTrack === "LEFT" || rawTrack === "CENTER" || rawTrack === "RIGHT" ? rawTrack : undefined;
  const edge = node && edgeTo
    ? mapEdges.find((candidate) => (candidate.from === node && candidate.to === edgeTo) || (candidate.to === node && candidate.from === edgeTo))
    : undefined;
  const crossing = (integerField(raw.fields.ford_active) ?? 0) > 0 || (integerField(raw.fields.ford_remaining) ?? 0) > 0
    ? "ford"
    : (integerField(raw.fields.cross_remaining) ?? 0) > 0
      ? "track"
      : edge?.bridge_site ? "bridge" : "none";
  return node === battlefield.node && edgeTo === (battlefield.edgeTo ?? "") &&
    progress === (battlefield.progress ?? 0) && track === battlefield.track && crossing === battlefield.crossing;
}
