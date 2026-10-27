import type { CoreJsonValue, CoreVersion, SimulationSnapshot, SimulationRequestPayload } from "./core";
import type { CombatantSide, DomainValue, MatchResult, PresentationReplay, RestrictedDiagnostics, RulePackage, TacticalIntent } from "./core-model";

/** Generic, opt-in input. This does not define a production Behavior policy. */
export interface BehaviorExecutionInputs {
  readonly schema_version: 1;
  readonly catalog_key: CoreJsonValue;
  readonly bindings: Readonly<Partial<Record<CombatantSide, {
    readonly actor: string;
    readonly army_id: string;
    readonly preferences: Readonly<Record<string, DomainValue>>;
    readonly field: string;
  }>>>;
  readonly candidates: Readonly<Record<string, Readonly<Partial<Record<CombatantSide, readonly {
    readonly intent: TacticalIntent;
    readonly profile_argument: number | null;
  }[]>>>>>;
}

export type BehaviorSimulationRequest = {
  readonly format_version: 1;
  readonly rule_package: RulePackage;
  readonly catalog_metadata_extension: CoreJsonValue;
  readonly snapshot: SimulationSnapshot;
  readonly behavior_inputs: BehaviorExecutionInputs;
} & SimulationRequestPayload;

/** Schema-2 diagnostics must not be imported as a normal Next experiment. */
export interface BehaviorSimulationResponse {
  readonly format_version: 1;
  readonly behavior_runtime_version: CoreVersion;
  readonly result: MatchResult;
  readonly replay: PresentationReplay;
  readonly owner?: {
    readonly authorized_side: CombatantSide;
    readonly behavior_run_digest: string;
    readonly diagnostics: RestrictedDiagnostics;
    readonly trace: readonly CoreJsonValue[];
  };
}
