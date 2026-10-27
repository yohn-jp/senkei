import type { SimulationResponse, SimulationSnapshot } from './core';
import type { CombatantSide } from './core-model';

export interface ActorDecisionRequest {
  readonly snapshot: SimulationSnapshot;
  readonly include_diagnostics: true;
  readonly diagnostics_side: CombatantSide;
}
export interface AutonomousCombatTrace {
  readonly tick: number;
  readonly actor: string;
  readonly kind: 'minion' | 'tower' | 'base';
  readonly candidates: readonly string[];
  readonly action: { readonly kind: 'attack'; readonly target: string; readonly selection: 'requested_target' | 'nearest_then_entity_id' }
    | { readonly kind: 'no_attack'; readonly reason: 'moved' | 'action_locked' | 'attack_not_ready' | 'attack_unavailable' | 'no_eligible_target' };
  readonly committed_event: { readonly tick: number; readonly event_index: number } | null;
}
/** A separately requested inspection; it is never an ordinary saved Run. */
export interface ActorDecisionResponse {
  readonly format_version: 1;
  readonly trace_schema_version: 1;
  readonly authorized_side: CombatantSide;
  readonly simulation: SimulationResponse;
  readonly trace: readonly AutonomousCombatTrace[];
}
