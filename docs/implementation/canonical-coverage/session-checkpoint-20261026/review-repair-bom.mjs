import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from '/workspace/wt-repair-focus/node_modules/vite/dist/node/index.js';
const root='/workspace/wt-repair-focus';
const vite=await createServer({root,configFile:false,server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
 const {resolveHeroRepair}=await vite.ssrLoadModule('/apps/web/src/features/next/repair-focus.ts');
 const {classifyPreflightProblem}=await vite.ssrLoadModule('/apps/web/src/features/next/preflight-problem.ts');
 const {instance}=await WebAssembly.instantiate(readFileSync('/workspace/wt-preflight-producer/apps/web/public/wasm/senkei_wasm.wasm'),{});
 const {memory,senkei_alloc,senkei_dispatch,senkei_dealloc}=instance.exports;let n=0;const preflightEnvelopes=[];
 const rpc=(operation,payload)=>{const b=Buffer.from(JSON.stringify({api_version:{major:1,minor:0,patch:0},request_id:`review-${++n}`,operation,payload}));const p=senkei_alloc(b.length);new Uint8Array(memory.buffer,p,b.length).set(b);const z=senkei_dispatch(p,b.length),o=Number(z&0xffffffffn),l=Number(z>>32n);const r=JSON.parse(Buffer.from(new Uint8Array(memory.buffer,o,l)).toString());senkei_dealloc(p,b.length);senkei_dealloc(o,l);if(operation==='preflight')preflightEnvelopes.push(r);if(!r.ok)return {error:r.error};return r.result;};
 const pkg=rpc('next_ruleset',{});const program=rpc('compile_text',{ruleset_ref:pkg.ruleset,source:'senkei inert { state idle { false, }, }'}).program;
 const makeSlots=(side)=>pkg.next.heroes.slice(0,5).map((hero,i)=>({slot_id:i===0?'\uFEFF':`slot-${i}`,catalog_id:hero.id,squad:`squad-${i}`,node:side==='attacker'?pkg.next.map.attacker_base:pkg.next.map.defender_base,skill_path:Object.keys(hero.skill_paths)[0]}));
 const slots=makeSlots('attacker');const config=(rows)=>({heroes:{kind:'list',value:rows.map(slot=>({kind:'record',value:Object.fromEntries(Object.entries(slot).map(([k,v])=>[k,{kind:'string',value:v}]))}))}});
 const side=(name,rows)=>({schema_version:pkg.model_version,id:name,revision:'1',ruleset:pkg.ruleset,program,initial_memory:{},configuration:config(rows)});
 const context=rpc('new_match_context',{ruleset_ref:pkg.ruleset,match_id:'bom-review'});
 const good=rpc('preflight',{attacker:side('own',slots),defender:side('npc',makeSlots('defender')),context});
 slots[0].skill_path='invalid-value';const bad=rpc('preflight',{attacker:side('own',slots),defender:side('npc',makeSlots('defender')),context});
 const error=bad.error ?? bad.reply?.error;const classified=classifyPreflightProblem(error,{stage:'snapshot_preflight',input:'draft',inputKey:'same',scenarioId:null,slots:{attacker:slots}});
 const resolved=classified.repair.kind==='own_hero'?resolveHeroRepair(slots,classified.repair):'not-own';
 const result={preflightEnvelopes,good,bad,classified,resolved};writeFileSync('/workspace/scratch/review-repair-bom.json',JSON.stringify(result,null,2));console.log(JSON.stringify({good:preflightEnvelopes[0].ok,target:classified.repair,resolved}));
}finally{await vite.close();}
