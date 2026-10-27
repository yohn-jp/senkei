#!/usr/bin/env node
// Real native/WASM parity for frozen, test-only owned assets and Next Behavior.
// Generate the fixture with NEXT_ADAPTER_FIXTURE_DIR=target/next-balance/adapter
// and the next_scenarios balance test, then provide SENKEI_NATIVE_DISPATCHER and
// SENKEI_WASM_PATH for prebuilt release artifacts.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixture = resolve(process.argv[2] ?? 'target/next-balance/adapter/next-public-simulation.request.json');
const wasmPath = resolve(root, process.env.SENKEI_WASM_PATH ?? 'apps/web/public/wasm/senkei_wasm.wasm');
const api = {major:1, minor:0, patch:0};
const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value;
const eq = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const version = v => ({major:v.major, minor:v.minor, patch:v.patch});
// serde serializes these typed structs in declaration order, unlike map keys.
const equipmentDigest = def => sha(JSON.stringify({version:version(def.version),effects:def.effects.map(e => ({stat:e.stat,add:e.add}))}));
const relationDigest = f => sha(JSON.stringify({version:version(f.version),stat:f.stat,add_per_level:f.add_per_level,max_level:f.max_level,max_bonus:f.max_bonus,rounding:f.rounding}));
function heroId(side,slot) {
  const hash=createHash('sha256');
  for (const s of ['senkei.projected-entity.v1','0'.repeat(64),'next.hero','hero',side,'string',slot]) {
    const bytes=Buffer.from(s); const length=Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length)); hash.update(length); hash.update(bytes);
  }
  return `prj:${hash.digest('hex')}`;
}
function nativeDispatcher() {
  const binary=process.env.SENKEI_NATIVE_DISPATCHER;
  assert(binary, 'SENKEI_NATIVE_DISPATCHER must point to a prebuilt native dispatcher');
  const child=spawn(binary,[],{cwd:root,stdio:['pipe','pipe','inherit']});
  const lines=createInterface({input:child.stdout});
  const pending=[];
  let failure;
  lines.on('line', line => { const next=pending.shift(); if (!next) { failure=new Error('unexpected native output'); return; } try { next.resolve(JSON.parse(line)); } catch(e) { next.reject(e); } });
  child.on('error',e => { failure=e; while(pending.length) pending.shift().reject(e); });
  child.on('exit',code => { if(code!==0) { failure=new Error(`native exited ${code}`); while(pending.length) pending.shift().reject(failure); } });
  return { request(req) { if(failure) return Promise.reject(failure); return new Promise((resolve,reject) => { pending.push({resolve,reject}); child.stdin.write(JSON.stringify(req)+'\n'); }); }, close() { child.stdin.end(); } };
}
async function wasmDispatcher() {
  const {instance}=await WebAssembly.instantiate(await readFile(wasmPath),{});
  const {memory,senkei_alloc:alloc,senkei_dispatch:dispatch,senkei_dealloc:free}=instance.exports;
  assert(memory instanceof WebAssembly.Memory && typeof dispatch==='function' && typeof alloc==='function' && typeof free==='function','missing WASM dispatch exports');
  return req => { const bytes=new TextEncoder().encode(JSON.stringify(req)); const ptr=alloc(bytes.length); new Uint8Array(memory.buffer,ptr,bytes.length).set(bytes); const packed=BigInt(dispatch(ptr,bytes.length)); const out=Number(packed & 0xffffffffn); const size=Number(packed >> 32n); const copy=new Uint8Array(memory.buffer,out,size).slice(); free(ptr,bytes.length); free(out,size); return JSON.parse(new TextDecoder().decode(copy)); };
}
const native=nativeDispatcher();
try {
  const wasm=await wasmDispatcher(); let serial=0;
  async function both(operation,payload,{ok=true,label=operation}={}) {
    const request={api_version:api,request_id:`owned-runtime-${++serial}`,operation,payload};
    const before=JSON.stringify(request);
    const n=await native.request(request); const w=wasm(request);
    assert(JSON.stringify(request)===before, `${label}: dispatcher mutated input`);
    assert(eq(n,w),`${label}: native/WASM responses differ\nnative=${JSON.stringify(n)}\nwasm=${JSON.stringify(w)}`);
    assert(n.ok===ok,`${label}: expected ok=${ok}, got ${JSON.stringify(n.error)}`);
    return n.result;
  }
  const genericFixture=JSON.parse(await readFile(resolve(root,'tests/conformance/behavior-fixture.request.json'),'utf8')).payload;
  const genericBinding=genericFixture.behavior_inputs.bindings.attacker;
  const profileRequest={revision:1,stamp:genericFixture.behavior_inputs.catalog_key,rulePackage:genericFixture.rule_package,
    catalogMetadataExtension:genericFixture.catalog_metadata_extension,
    actor:{subjectId:genericBinding.actor,scope:'army',heroCatalogId:null,squadMembers:[]},
    preferences:{armyId:genericBinding.army_id,army:genericBinding.preferences,squadId:'',squad:{}},
    tick:1,side:'attacker',evaluation:{kind:'defaults_only'}};
  const profile=await both('editor_resolve_behavior',profileRequest,{label:'Catalog-bound profile composition'});
  assert(profile.status==='resolved' && profile.composition.values['navigation.lane'].value==='mid','Catalog profile composition failed');
  const staleProfile=clone(profileRequest); staleProfile.stamp.catalogDigest='f'.repeat(64);
  await both('editor_resolve_behavior',staleProfile,{ok:false,label:'stale Catalog profile'});
  const packageValue=await both('next_ruleset',{local_trial:true},{label:'trial rules'});
  const policy=packageValue.next.projection_policy;
  assert(policy?.test_only && policy.equipment['test.blade'] && policy.relation,'trial projection policy missing');
  const template=await readFile(fixture,'utf8').then(bytes=>JSON.parse(bytes).payload).catch(error=> {
    if(error.code !== 'ENOENT') throw error;
    return null;
  });
  const source='senkei owned_idle { state inert { false, }, }';
  const compiled=await both('compile_text',{ruleset_ref:packageValue.ruleset,source});
  const context=await both('new_match_context',{ruleset_ref:packageValue.ruleset,match_id:'owned-parity'});
  context.max_ticks=2;
  const string = value => ({kind:'string',value});
  function makeSnapshot(side) {
    const heroes=packageValue.next.heroes.slice(0,5).map((hero,i)=>({kind:'record',value:{slot_id:string(`slot-${i+1}`),catalog_id:string(hero.id),squad:string(side==='attacker' && i>1 ? `squad-${i}` : 'squad-0'),node:string(side==='attacker' ? packageValue.next.map.attacker_base : packageValue.next.map.defender_base),skill_path:string(Object.keys(hero.skill_paths).sort()[0])}}));
    return {schema_version:clone(context.schema_version),id:`owned-${side}`,revision:'1',ruleset:clone(packageValue.ruleset),configuration:{heroes:{kind:'list',value:heroes}},program:clone(compiled.program),initial_memory:{}};
  }
  const attacker=template ? clone(template.attacker) : makeSnapshot('attacker');
  const defender=template ? clone(template.defender) : makeSnapshot('defender');
  // First two Heroes share a current Squad so the relation effect is observable.
  attacker.configuration.heroes.value[1].value.squad.value=attacker.configuration.heroes.value[0].value.squad.value;
  for(const snapshot of [attacker,defender]) { snapshot.ruleset=clone(packageValue.ruleset); snapshot.program=clone(compiled.program); }
  const blade=policy.equipment['test.blade']; const formula=policy.relation;
  const sides={};
  for(const [side,snapshot] of Object.entries({attacker,defender})) {
    const owner=`owner-${side}`;
    const heroes=snapshot.configuration.heroes.value.map((record,i) => {
      const fields=record.value;
      return {slot_id:fields.slot_id.value,owner_id:owner,instance_id:`${side}-${i}`,catalog_id:fields.catalog_id.value,definition_catalog_id:policy.hero_catalog_id,definition_version:clone(policy.hero_catalog_version),definition_digest:policy.hero_catalog_digest,
        equipment:side==='attacker' && i===0 ? [{instance_id:'test-item',owner_id:owner,definition_id:'test.blade',definition_version:clone(blade.version),definition_digest:equipmentDigest(blade)}] : []};
    });
    sides[side]={owner_id:owner,authority:'local',heroes,relations:side==='attacker' ? [{from_instance_id:'attacker-0',to_instance_id:'attacker-1',level:4,formula_version:clone(formula.version),formula_digest:relationDigest(formula)},{from_instance_id:'attacker-1',to_instance_id:'attacker-0',level:4,formula_version:clone(formula.version),formula_digest:relationDigest(formula)}] : []};
  }
  context.match_projection={schema_version:1,sides};
  const term=(signal,weight)=>({signal,weight});
  const zero=()=>[term('constant',0)];
  const behavior={schema_version:1,policy_id:'conformance-test-only',version:api,ruleset_digest:packageValue.ruleset.digest,test_only:true,
    composition:{hero_aggregation:'mean_floor',override_order:'army_then_squad',action_order:'score_desc_then_action_id_asc',targeting_profile:'target_health_weight'}, hero_defaults:Object.fromEntries(packageValue.next.heroes.map(h=>[h.id,{navigation:null,engagement:null,targeting:null,pursuit:null,survival:null,objective:null}])),
    domains:{navigation:zero(),engagement:zero(),targeting:zero(),pursuit:zero(),survival:zero(),objective:zero()},
    candidates:[{kind:'move',capability:'move',arguments:['actor','objective_node']},{kind:'pursue',capability:'pursue',arguments:['actor','observed_target']},{kind:'retreat',capability:'retreat',arguments:['actor']},{kind:'target',capability:'select_target',arguments:['actor','observed_target']}]};
  const blank=()=>({navigation:null,engagement:null,targeting:null,pursuit:null,survival:null,objective:null});
  const h=heroId('attacker','slot-1');
  const inputs={schema_version:1,army:{attacker:{...blank(),navigation:1}},squads:{attacker:{'attacker:squad-0':{...blank(),objective:1}}},heroes:{attacker:{[h]:{...blank(),survival:1}}}};
  context.next_behavior={policy:behavior,inputs};
  const payload={attacker,defender,context,include_diagnostics:true,diagnostics_side:'attacker'};
  const frozen=JSON.stringify(payload);
  const first=await both('simulate',payload,{label:'owned behavior attacker'});
  const again=await both('simulate',payload,{label:'repeat immutable snapshot'});
  assert(eq(first,again) && JSON.stringify(payload)===frozen,'snapshot or repeated result changed');
  assert(first.diagnostics?.events.every(e=>e.side==='attacker'),'attacker diagnostics leaked other side');
  assert(Object.keys(first.owner_replays ?? {}).join() === 'attacker','attacker owner replay scope');
  const decision=first.diagnostics.events.find(e=>e.record.kind==='runtime_notice' && e.record.value.code==='enbu.behavior_order_committed');
  assert(decision?.record.value.details.next_policy_digest===sha(JSON.stringify(canonical(behavior))), 'Next policy digest differs from canonical JavaScript JSON');
  assert(decision.record.value.details.observation_digest?.length===64 && decision.record.value.details.profile_composition_json,'owner decision provenance missing');
  const actorTrace=await both('simulate_actor_decisions',payload,{label:'owner autonomous decisions'});
  assert(actorTrace.format_version===1 && actorTrace.trace_schema_version===1 && actorTrace.authorized_side==='attacker','actor trace identity');
  assert(eq(actorTrace.simulation,first),'actor inspection changed the complete simulation response');
  assert(actorTrace.trace.length>0 && actorTrace.trace.every(t=>t.actor.startsWith('visible-') && t.kind!=='monster'),'actor trace leaked private identity or neutral decisions');
  for (const trace of actorTrace.trace) if (trace.committed_event) {
    const frame=first.owner_replays.attacker.frames.find(f=>f.tick===trace.committed_event.tick);
    const event=frame?.events[trace.committed_event.event_index];
    assert(event?.event==='next.attack' && event.payload.source.value===trace.actor && event.payload.target.value===trace.action.target,'actor event reference mismatch');
  }
  await both('simulate_actor_decisions',{attacker,defender,context,include_diagnostics:false},{ok:false,label:'actor trace requires owner authorization'});
  const defenderResult=await both('simulate',{...payload,diagnostics_side:'defender'},{label:'defender owner'});
  assert(defenderResult.diagnostics?.events.every(e=>e.side==='defender'),'defender diagnostics leaked other side');
  assert(Object.keys(defenderResult.owner_replays ?? {}).join() === 'defender','defender owner replay scope');
  const publicResult=await both('simulate',{attacker,defender,context,include_diagnostics:false},{label:'public'});
  assert(publicResult.diagnostics===null && Object.keys(publicResult.owner_replays ?? {}).length===0,'public response leaks owner data');
  const firstFrame=Object.values(first.owner_replays.attacker.frames[0].visible_state.entities);
  const own=firstFrame.find(e=>e.entity_type==='hero' && e.fields.slot_id?.value==='slot-1');
  assert(own,'owner Hero projection missing');
  const definition=packageValue.next.heroes.find(hero=>hero.id===attacker.configuration.heroes.value[0].value.catalog_id.value);
  assert(own.fields.attack?.value===definition.stats.attack+2,'owned equipment attack effect absent');
  assert(own.fields.defense?.value===definition.stats.defense+4,'owned relation effect absent');
  const assets=await both('next_reproduction_assets',{local_trial:true}, {label:'reproduction assets'});
  assert(eq(assets.rule_package,packageValue),'retained trial package differs');
  const snapshot={attacker,defender,context};
  const reproduced=await both('reproduce',{assets,snapshot,snapshot_digest:first.diagnostics.identity.snapshot_digest,include_diagnostics:true,diagnostics_side:'attacker'},{label:'retained reproduction'});
  assert(eq(first,reproduced),'reproduction differs from original complete response');
  for(const [domain,expected] of [['navigation','move'],['engagement','select_target'],['targeting','select_target'],['pursuit','pursue'],['survival','retreat'],['objective','move']]) {
    const x=clone(payload); x.context.next_behavior.inputs={schema_version:1,army:{},squads:{},heroes:{}};
    // Put both armies in observable range; only observed candidates may pursue.
    for(const snapshot of [x.attacker,x.defender]) for(const record of snapshot.configuration.heroes.value) record.value.node.value='N.MID.OBS';
    x.context.next_behavior.policy.domains[domain][0].weight=10;
    const r=await both('simulate',x,{label:`domain ${domain}`});
    assert(r.diagnostics.events.some(e=>e.record.kind==='intent_accepted' && e.record.value.intent.capability===expected && e.record.value.intent.action_id.startsWith('behavior:')),`${domain} did not select ${expected}`);
  }
  const wait=clone(payload); wait.context.next_behavior.policy.domains.navigation=[term('route_cost',1)]; wait.context.next_behavior.policy.candidates=[behavior.candidates[0]];
  const waited=await both('simulate',wait,{label:'unknown wait'});
  assert(waited.diagnostics.events.some(e=>e.record.kind==='runtime_notice' && e.record.value.code==='enbu.behavior_unknown_observation'),'unknown WAIT omitted diagnostic');
  assert(waited.diagnostics.events.some(e=>e.record.kind==='runtime_notice' && e.record.value.code==='enbu.behavior_wait'),'WAIT decision omitted diagnostic');
  const minion=clone(payload); minion.context.max_ticks=31;
  const minionPolicy={schema_version:1,policy_id:'conformance-lane-only',version:api,ruleset_digest:packageValue.ruleset.digest,test_only:true,candidate:'lane_waypoint'};
  minion.context.next_minion_behavior={policy:minionPolicy,inputs:{schema_version:1,army:{attacker:'lane_waypoint'},lanes:{defender:{bot:'lane_waypoint'}}}};
  const minionResult=await both('simulate',minion,{label:'scoped Minion trace'});
  const minionEvents=minionResult.diagnostics.events.filter(e=>e.record.kind==='runtime_notice' && e.record.value.code==='enbu.minion_lane_decision');
  assert(minionEvents.length>0,'scoped Minion notices missing');
  for (const event of minionEvents) {
    const details=event.record.value.details;
    const frame=minionResult.owner_replays.attacker.frames.find(frame=>frame.tick===event.tick);
    assert(event.side==='attacker' && event.entity_id?.startsWith('visible-') && frame?.visible_state.entities[event.entity_id]?.entity_type==='minion','Minion trace is not linked to the authorized frame');
    assert(details.identity_space==='owner_replay' && details.candidate==='lane_waypoint' && details.next_policy_digest===sha(JSON.stringify(canonical(minionPolicy))),'Minion policy identity mismatch');
  }
  const fog=clone(payload); fog.context.next_behavior.policy.candidates=[behavior.candidates[1]];
  const hidden=await both('simulate',fog,{label:'fog'});
  const defenderIds=new Set(defender.configuration.heroes.value.map(r=>heroId('defender',r.value.slot_id.value)));
  assert(!hidden.diagnostics.events.some(e=>e.record.kind==='intent_accepted' && e.record.value.intent.capability==='pursue' && defenderIds.has(e.record.value.intent.target)),'pursued unseen defender');
  await both('compile_text',{ruleset_ref:packageValue.ruleset,source:'senkei invalid_hold { action x { when true, do hold(argmin hero in allies.heroes by hero.hp then hero.id), }, }'},{ok:false,label:'unsupported explicit HOLD'});
  for(const [label,mutate] of [
    ['cross-owner item',p=>{p.context.match_projection.sides.attacker.heroes[0].equipment[0].owner_id='owner-defender';}],
    ['unknown hero',p=>{p.context.next_behavior.inputs.heroes.attacker={missing:blank()};}],
    ['unknown squad',p=>{p.context.next_behavior.inputs.squads.attacker={missing:blank()};}],
    ['policy version',p=>{p.context.next_behavior.policy.schema_version=99;}],
    ['equipment version',p=>{p.context.match_projection.sides.attacker.heroes[0].equipment[0].definition_version.major=99;}],
    ['target signal on move',p=>{p.context.next_behavior.policy.domains.navigation=[term('target_health_percent',1)];}],
    ['unsupported hold',p=>{p.context.next_behavior.policy.candidates=[{kind:'hold',capability:'hold',arguments:['actor']}];}],
  ]) { const invalid=clone(payload); mutate(invalid); await both('simulate',invalid,{ok:false,label}); }
  console.log('PASS Next owned-runtime native/WASM full-response parity');
} finally { native.close(); }
