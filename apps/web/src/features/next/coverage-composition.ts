import { catalogStamp, displayDomainValue, sameCatalog } from "@senkei/jinrei-editor";
import type { CoveragePresentationRow, DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { BehaviorProfileComposition, BehaviorResolveReply, BehaviorResolveRequest } from "../../contracts/behavior-resolution";
import type { DomainValue, RulePackage } from "../../contracts";

type Scope = "hero" | "squad" | "army";
interface Slot { readonly slot_id: string; readonly catalog_id: string; readonly squad: string; }

/** Compose a no-Jinrei, no-player-preference baseline for the selected roster. */
export function baselineRequest(
  revision: number, catalog: DomainCatalogDocument, rulePackage: RulePackage,
  extension: BehaviorResolveRequest["catalogMetadataExtension"], scope: Scope,
  slots: readonly Slot[], selected: Slot | null,
): BehaviorResolveRequest | null {
  if (scope !== "army" && !selected) return null;
  const members = scope === "army" ? [] : slots.filter(slot => slot.squad === selected?.squad)
    .map(slot => ({ subjectId: slot.slot_id, heroCatalogId: slot.catalog_id }));
  return {
    revision, stamp: catalogStamp(catalog), rulePackage, catalogMetadataExtension: extension,
    actor: { subjectId: scope === "army" ? "attacker" : scope === "squad" ? selected!.squad : selected!.slot_id,
      scope, heroCatalogId: scope === "hero" ? selected!.catalog_id : null, squadMembers: members },
    preferences: { armyId: "attacker", army: {}, squadId: selected?.squad ?? "", squad: {} },
    tick: 0, side: "attacker", evaluation: { kind: "defaults_only" },
  };
}

/** Reject stale or mismatched replies before attaching values to the current view. */
export function baselineComposition(
  request: BehaviorResolveRequest, reply: BehaviorResolveReply,
): BehaviorProfileComposition | null {
  if (reply.status !== "resolved" || reply.revision !== request.revision || reply.evaluationKind !== "defaults_only"
    || !sameCatalog(reply.stamp, request.stamp)) return null;
  const composition = reply.composition;
  const members = new Set(request.actor.squadMembers.map(member => member.subjectId));
  if (!sameCatalog(composition.catalog_identity, request.stamp) || composition.actor_scope !== request.actor.scope
    || composition.actor_id !== request.actor.subjectId || composition.tick !== request.tick || composition.side !== request.side
    || composition.squad_members.length !== members.size || composition.squad_members.some(member => !members.has(member))
    || composition.unknown_conditions.length || composition.unknown_overrides.length || composition.rejected_overrides.length) return null;
  return composition;
}

/** Include parent-scope fields inherited by the selected actor, even before composition. */
export function inheritedCoverageRows(
  catalog: DomainCatalogDocument, scope: Scope, heroCatalogId: string | undefined,
  rows: readonly CoveragePresentationRow[],
): readonly CoveragePresentationRow[] {
  if (catalog.behaviorProfiles.status !== "authored_extension") return rows;
  const metadata = catalog.behaviorProfiles.value.metadata;
  const known = new Set(rows.map(row => row.fieldId));
  const extra = Object.entries(metadata.fields).flatMap(([fieldId, field]): CoveragePresentationRow[] => {
    const inherited = scope === "hero" ? field.scopes.includes("army") || field.scopes.includes("squad")
      : scope === "squad" && field.scopes.includes("army");
    if (!inherited || known.has(fieldId)) return [];
    const heroValue = heroCatalogId ? metadata.heroDefaults[heroCatalogId]?.[fieldId] : undefined;
    return [{ fieldId, defaultStatus: "available", senritsuDefault: displayDomainValue(metadata.senritsuDefault[fieldId]),
      heroCatalogDefault: scope === "hero" ? heroValue ? displayDomainValue(heroValue) : "No Hero override declared" : "Not applicable to this scope",
      explicitStatus: "NOT_PROVEN", effectiveStatus: "not_proven", observedStatus: "NOT_CHECKED",
      reason: "Inherited field is declared by the Catalog; current Jinrei execution is not resolved." }];
  });
  return [...rows.filter(row => row.fieldId !== "behaviorProfiles" || extra.length === 0), ...extra];
}

export function profileValueText(value: DomainValue | undefined): string {
  if (!value) return "Not supplied";
  switch (value.kind) {
    case "null": return "null";
    case "fixed": return `${value.value.coefficient} × 10⁻${value.value.scale}`;
    case "string": return JSON.stringify(value.value);
    case "list": return `[${value.value.map(profileValueText).join(", ")}]`;
    case "record": return `{${Object.entries(value.value).map(([key, item]) => `${key}: ${profileValueText(item)}`).join(", ")}}`;
    default: return String(value.value);
  }
}
