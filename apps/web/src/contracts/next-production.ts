import type { CoreVersion } from './core';
export type BehaviorSignal = 'constant'|'actor_health_percent'|'target_health_percent'|'target_proximity'|'observed_danger'|'objective_value'|'route_cost'|'squad_health_percent'|'candidate_move'|'candidate_pursue'|'candidate_retreat'|'candidate_target';
export type BehaviorDomain = 'navigation'|'engagement'|'targeting'|'pursuit'|'survival'|'objective';
/** All six nullable fields are required in canonical Rust Snapshot JSON. */
export type NextBehaviorProfile = Readonly<Record<BehaviorDomain, number | null>>;
export function completeBehaviorProfile(profile: Partial<NextBehaviorProfile> = {}): NextBehaviorProfile {
  return {navigation:profile.navigation ?? null,engagement:profile.engagement ?? null,targeting:profile.targeting ?? null,
    pursuit:profile.pursuit ?? null,survival:profile.survival ?? null,objective:profile.objective ?? null};
}
export interface NextBehaviorPolicy {
  schema_version: 1; policy_id: string; version: CoreVersion; ruleset_digest: string; test_only: boolean;
  composition:{hero_aggregation:"mean_floor";override_order:"army_then_squad";action_order:"score_desc_then_action_id_asc";targeting_profile:"target_health_weight"};
  hero_defaults:Record<string,NextBehaviorProfile>;
  domains: Record<BehaviorDomain, {signal: BehaviorSignal; weight: number}[]>;
  candidates: {kind:'move'|'pursue'|'retreat'|'target'; capability:string; arguments:('actor'|'observed_target'|'objective_node')[]}[];
}
export interface NextBehaviorInputs { schema_version: 1; army: Record<string, NextBehaviorProfile>; squads: Record<string,Record<string,NextBehaviorProfile>>; heroes: Record<string,Record<string,NextBehaviorProfile>> }
export interface NextBehaviorMatch { policy: NextBehaviorPolicy; inputs: NextBehaviorInputs }
export type ProjectionPolicy = import('../features/progression/match-projection').TrialPolicy;
export type MatchProjection = Awaited<ReturnType<typeof import('../features/progression/match-projection').buildMatchProjection>>;
/** Explicit fixture, never an approved production preset. */
export function localTrialBehavior(rulesetDigest: string, heroDefinitionIds: readonly string[]): NextBehaviorMatch {
  const term = (signal:BehaviorSignal, weight=1) => [{signal,weight}];
  return {policy:{schema_version:1,policy_id:'senkei.local-trial.six-domains',version:{major:1,minor:0,patch:0},ruleset_digest:rulesetDigest,test_only:true,composition:{hero_aggregation:'mean_floor',override_order:'army_then_squad',action_order:'score_desc_then_action_id_asc',targeting_profile:'target_health_weight'},hero_defaults:Object.fromEntries(heroDefinitionIds.map(id => [id,completeBehaviorProfile()])),
    domains:{navigation:term('candidate_move'),engagement:term('candidate_target',3),targeting:term('target_health_percent'),pursuit:term('candidate_pursue'),survival:term('candidate_retreat'),objective:term('objective_value')},
    candidates:[{kind:'move',capability:'move',arguments:['actor','objective_node']},{kind:'pursue',capability:'pursue',arguments:['actor','observed_target']},{kind:'retreat',capability:'retreat',arguments:['actor']},{kind:'target',capability:'select_target',arguments:['actor','observed_target']}]},inputs:{schema_version:1,army:{},squads:{},heroes:{}}};
}
