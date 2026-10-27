import type { ReproductionAssets, SimulationSnapshot } from "./core";
import type { CombatantSide, DomainValue, ObservationSnapshot } from "./core-model";
import type { BehaviorDomain, BehaviorSignal } from "./next-production";

export interface NextDecisionInspectionRequest {
  readonly format_version: 1;
  readonly assets: ReproductionAssets;
  readonly snapshot: SimulationSnapshot;
  readonly snapshot_digest: string;
  readonly authorized_side: CombatantSide;
  readonly selector: { readonly tick: number; readonly slot_id: string };
}

export interface NextDecisionInspectionTerm {
  readonly domain: BehaviorDomain;
  readonly kind: "offset" | "target_health_offset" | "signal";
  readonly signal: BehaviorSignal | null;
  readonly weight: number | null;
  readonly value: number | null;
  readonly contribution: number | null;
}

export interface NextDecisionInspectionCandidate {
  readonly index: number;
  /** Inspection-local observed alias, not a Replay entity ID. */
  readonly actor: string;
  readonly target: string | null;
  readonly kind: "move" | "pursue" | "retreat" | "target";
  readonly capability: string;
  readonly arguments: readonly DomainValue[];
  readonly outcome: "ineligible" | "unknown" | "selected" | "conflict";
  readonly score: number | null;
  readonly rank: number | null;
  readonly terms: readonly NextDecisionInspectionTerm[];
}

export interface NextDecisionInspectionSelection {
  readonly source: "explicit" | "default" | "wait";
  readonly actor: string;
  readonly capability: string | null;
  /** Null when no selection exists or any argument is not observable. */
  readonly arguments: readonly DomainValue[] | null;
  readonly target: string | null;
  readonly score: number | null;
  readonly candidate_index: number | null;
  readonly arbitration_accepted: boolean;
  readonly transition_completed: boolean;
  readonly committed_event: { readonly tick: number; readonly sequence: number } | null;
}

export interface NextDecisionInspection {
  readonly format_version: 1;
  readonly identity: { readonly snapshot_digest: string; readonly result_digest: string; readonly authorized_side: CombatantSide;
    readonly selector: { readonly tick: number; readonly slot_id: string }; readonly inspection_digest: string };
  readonly policy: { readonly id: string; readonly digest: string };
  readonly observation: { readonly identity_space: "inspection_observed"; readonly source_digest: string | null; readonly snapshot: ObservationSnapshot | null };
  readonly decision: {
    readonly status: "evaluated" | "subject_unavailable" | "execution_incomplete" | "tick_not_reached";
    readonly subject: string | null;
    readonly composition: {
      readonly squad_id: string;
      readonly members: readonly { readonly actor: string; readonly catalog_id: string; readonly values: readonly number[]; readonly sources: readonly string[] }[];
      readonly shared: readonly number[]; readonly baseline_effective: readonly number[]; readonly effective: readonly number[];
    } | null;
    readonly candidates: readonly NextDecisionInspectionCandidate[];
    readonly selections: readonly NextDecisionInspectionSelection[];
  };
}
