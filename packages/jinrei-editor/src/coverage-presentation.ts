import {
  behaviorCoverage,
  displayDomainValue,
  type ActorSelection,
  type ComparisonSurface,
  type CoverageStatus,
} from "./editor.js";
import type { DomainCatalogDocument } from "./catalog.js";

export interface CoveragePresentationRow {
  readonly fieldId: string;
  readonly defaultStatus: "available" | "not_declared";
  readonly senritsuDefault: string;
  readonly heroCatalogDefault: string;
  readonly explicitStatus: "NOT_PROVEN";
  readonly effectiveStatus: CoverageStatus;
  readonly observedStatus: "NOT_CHECKED";
  readonly reason: string;
}

export interface CoveragePresentation {
  readonly surface: ComparisonSurface;
  readonly status: "not_proven";
  readonly provenFields: 0;
  readonly assessedFields: number;
  readonly rows: readonly CoveragePresentationRow[];
  readonly profileDeclared: boolean;
}

/**
 * Present only coverage facts the current Catalog and compiler actually supply.
 * Jinrei's compiled tactics are not a Behavior Profile binding, and no runtime
 * profile resolver or observation adapter is connected to this view.
 */
export function behaviorCoveragePresentation(
  catalog: DomainCatalogDocument,
  actor: ActorSelection,
  surface: ComparisonSurface,
): CoveragePresentation {
  const matrix = behaviorCoverage(catalog, actor, surface);
  return {
    surface,
    status: matrix.status,
    provenFields: 0,
    assessedFields: matrix.assessedFields,
    profileDeclared: catalog.behaviorProfiles.status === "authored_extension",
    rows: matrix.cells.map((cell) => ({
      fieldId: cell.fieldId,
      defaultStatus: cell.defaultStatus,
      senritsuDefault: cell.defaultStatus === "available"
        ? displayDomainValue(cell.senritsuDefaultValue)
        : "Not declared by this RulePackage",
      heroCatalogDefault: actor.scope === "hero"
        ? cell.heroCatalogDefaultValue
          ? displayDomainValue(cell.heroCatalogDefaultValue)
          : "No Hero override declared"
        : "Not applicable to this scope",
      explicitStatus: "NOT_PROVEN",
      effectiveStatus: cell.effectiveStatus,
      observedStatus: cell.observedStatus,
      reason: cell.reason,
    })),
  };
}
