import { expect, it } from 'vitest';
import type { ActorDecisionRequest, ActorDecisionResponse } from '../contracts/actor-decisions';
import type { SimulationSnapshot } from '../contracts/core';
import { actorResponseError } from './actor-response';
import { reproductionSnapshotDigest, sha256Hex } from './input-identity';
import { matchResultDigestJson } from './result-identity';

async function fixture() {
  const world = {world_id:'world',logic_digest:'logic',presentation_digest:'presentation'};
  const snapshot = {attacker:{program:{content_digest:'program'}},defender:{program:{content_digest:'opponent'}},context:{match_id:'match',world_identity:world}} as unknown as SimulationSnapshot;
  const request: ActorDecisionRequest = {snapshot,include_diagnostics:true,diagnostics_side:'attacker'};
  const result = {match_id:'match',outcome:'draw' as const,termination_reason:'limit',final_tick:1,statistics:{},cu_spent:{attacker:0,defender:0},final_state_digest:'state'};
  const digest = await sha256Hex(matchResultDigestJson(result));
  const frame = {tick:1,events:[{event:'next.attack',entity:'visible-target',payload:{source:{kind:'entity' as const,value:'visible-actor'},target:{kind:'entity' as const,value:'visible-target'}}}],visible_state:{global_fields:{},entities:{
    'visible-actor':{owner:'attacker' as const,entity_type:'minion',fields:{}},
    'visible-target':{owner:'defender' as const,entity_type:'tower',fields:{}},
  }}};
  const replay = {schema_version:{major:1,minor:0,patch:0},match_id:'match',result_digest:digest,world_identity:world,frames:[frame]};
  const response = {format_version:1,trace_schema_version:1,authorized_side:'attacker',simulation:{authorized_side:'attacker',outcome:{result,presentation_replay:replay},owner_replays:{attacker:{...replay,perspective:'attacker'}},restricted_diagnostics:{identity:{schema_version:1,side:'attacker',match_id:'match',result_digest:digest,snapshot_digest:await reproductionSnapshotDigest(snapshot),program_digest:'program'},events:[],cu_by_side:{attacker:0},final_memory_by_side:{attacker:{}}}},trace:[{tick:1,actor:'visible-actor',kind:'minion',candidates:['visible-target'],action:{kind:'attack',target:'visible-target',selection:'nearest_then_entity_id'},committed_event:{tick:1,event_index:0}}]} as unknown as ActorDecisionResponse;
  return {request,response};
}

it('requires input-bound owner trace and an exact projected source/target attack event', async () => {
  const {request,response} = await fixture();
  expect(await actorResponseError(response,request)).toBeNull();
  const wrongEvent = structuredClone(response) as any;
  wrongEvent.simulation.owner_replays.attacker.frames[0].events[0].payload.source.value = 'visible-target';
  expect(await actorResponseError(wrongEvent,request)).toMatch(/committed owner event/);
  const altered = {...request,snapshot:{...request.snapshot,context:{...request.snapshot.context,max_ticks:2}}};
  expect(await actorResponseError(response,altered)).toMatch(/immutable Run/);
});

it('rejects other owners, neutral records, unobserved candidates, duplicates and extra private fields', async () => {
  const {request,response} = await fixture();
  expect(await actorResponseError({...response,authorized_side:'defender'},request)).toMatch(/envelope/);
  expect(await actorResponseError({...response,trace:[{...response.trace[0],kind:'monster'}]},request)).toMatch(/decision record/);
  expect(await actorResponseError({...response,trace:[{...response.trace[0],candidates:['hidden']}]},request)).toMatch(/unauthorized entity/);
  expect(await actorResponseError({...response,trace:[...response.trace,...response.trace]},request)).toMatch(/Duplicate/);
  expect(await actorResponseError({...response,private_inputs:request.snapshot},request)).toMatch(/envelope/);
});

it('keeps a non-attack reason distinct from a committed action', async () => {
  const {request,response} = await fixture();
  const idle = {...response,trace:[{...response.trace[0],candidates:[],action:{kind:'no_attack',reason:'action_locked'},committed_event:null}]};
  expect(await actorResponseError(idle,request)).toBeNull();
  expect(await actorResponseError({...idle,trace:[{...idle.trace[0],committed_event:{tick:1,event_index:0}}]},request)).toMatch(/non-attack/);
});
