import type { CoreVersion } from './core';
import type { CombatantSide, WorldIdentityRef } from './core-model';

/** No authored production Minion command vocabulary is selected by this contract. */
export interface NextMinionBehaviorMatch {
  readonly policy: { readonly schema_version: 1; readonly policy_id: string; readonly version: CoreVersion;
    readonly ruleset_digest: string; readonly test_only: true; readonly candidate: 'lane_waypoint' };
  readonly inputs: { readonly schema_version: 1;
    readonly army: Partial<Record<CombatantSide, 'lane_waypoint'>>;
    readonly lanes: Partial<Record<CombatantSide, Partial<Record<'top' | 'mid' | 'bot', 'lane_waypoint'>>>> };
}

/** Additional preferences require separately authored risk and Unknown-handling policy. */
export interface NextRouteMatch {
  readonly policy: { readonly schema_version: 1; readonly policy_id: string; readonly version: CoreVersion;
    readonly ruleset_digest: string; readonly world_identity: WorldIdentityRef; readonly test_only: true;
    readonly preferences: readonly 'fastest'[] };
  readonly commands: readonly { readonly side: CombatantSide; readonly action_id: string; readonly actor: string;
    readonly destination: string; readonly preference: 'fastest'; readonly waypoints: readonly string[] }[];
}
