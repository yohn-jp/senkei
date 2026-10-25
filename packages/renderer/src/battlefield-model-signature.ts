import type { DisplayEntity } from "@senkei/replay-contract";
import { battlefieldStructureDamageStage } from "./battlefield-architecture";

/** Geometry inputs only: HP values update bars; only appearance or visual stage changes rebuild meshes. */
export function battlefieldModelGeometrySignature(entity: DisplayEntity, hasAuthoredRoutes: boolean): string {
  return JSON.stringify({
    kind: entity.kind,
    archetype: entity.archetype,
    appearanceKey: entity.appearanceKey,
    catalogId: entity.catalogId ?? null,
    side: entity.side,
    destroyed: entity.destroyed,
    damageStage: entity.kind === "unit" ? null : battlefieldStructureDamageStage(entity),
    bridgeState: entity.kind === "bridge" ? entity.battlefield?.bridgeState ?? null : null,
    bridgeWorkActive: entity.kind === "bridge" ? Boolean(entity.battlefield?.buildRemaining) : false,
    observationOwner: entity.kind === "observation" ? entity.battlefield?.facilityOwner ?? null : null,
    captureSide: entity.kind === "observation" ? entity.battlefield?.captureSide ?? null : null,
    captureProgress: entity.kind === "observation" ? entity.battlefield?.captureProgress ?? 0 : 0,
    legacyDamaged: !hasAuthoredRoutes && entity.kind !== "unit" ? entity.hp < entity.maxHp : false,
  });
}
