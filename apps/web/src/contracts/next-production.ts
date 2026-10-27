import type { CoreVersion } from './core';
export type BehaviorSignal = 'constant'|'actor_health_percent'|'target_health_percent'|'target_proximity'|'observed_danger'|'objective_value'|'route_cost'|'squad_health_percent'|'candidate_move'|'candidate_pursue'|'candidate_retreat';
export type BehaviorDomain = 'navigation'|'engagement'|'targeting'|'pursuit'|'survival'|'objective';
export interface NextBehaviorPolicy {
  schema_version: 1; policy_id: string; version: CoreVersion; ruleset_digest: string; test_only: boolean;
  composition:{hero_aggregation:"mean_floor";override_order:"army_then_squad"};
  hero_defaults:Record<string,Partial<Record<BehaviorDomain,number|null>>>;
  domains: Record<BehaviorDomain, {signal: BehaviorSignal; weight: number}[]>;
  candidates: {kind:'move'|'pursue'|'retreat'; capability:string; arguments:('actor'|'observed_target'|'objective_node')[]}[];
}
export interface NextBehaviorInputs { schema_version: 1; army: Record<string, Partial<Record<BehaviorDomain,number>>>; squads: Record<string,Record<string,Partial<Record<BehaviorDomain,number>>>>; heroes: Record<string,Record<string,Partial<Record<BehaviorDomain,number>>>> }
export interface NextBehaviorMatch { policy: NextBehaviorPolicy; inputs: NextBehaviorInputs }
export type ProjectionPolicy = import('../features/progression/match-projection').TrialPolicy;
export type MatchProjection = Awaited<ReturnType<typeof import('../features/progression/match-projection').buildMatchProjection>>;
/** Explicit fixture, never an approved production preset. */
export function localTrialBehavior(rulesetDigest: string, heroDefinitionIds: readonly string[]): NextBehaviorMatch {
  const term = (signal:BehaviorSignal) => [{signal,weight:1}];
  return {policy:{schema_version:1,policy_id:'senkei.local-trial.six-domains',version:{major:1,minor:0,patch:0},ruleset_digest:rulesetDigest,test_only:true,composition:{hero_aggregation:'mean_floor',override_order:'army_then_squad'},hero_defaults:Object.fromEntries(heroDefinitionIds.map(id => [id,{}])),
    domains:{navigation:term('candidate_move'),engagement:term('candidate_pursue'),targeting:term('target_health_percent'),pursuit:term('candidate_pursue'),survival:term('candidate_retreat'),objective:term('objective_value')},
    candidates:[{kind:'move',capability:'move',arguments:['actor','objective_node']},{kind:'pursue',capability:'pursue',arguments:['actor','observed_target']},{kind:'retreat',capability:'retreat',arguments:['actor']}]},inputs:{schema_version:1,army:{},squads:{},heroes:{}}};
}
