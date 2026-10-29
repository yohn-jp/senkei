// A separate worker from benchmark measurement. No synthetic gate is called Jinrei.
const $=id=>document.getElementById(id);
const labels={initial:'初期状態',disabled:'無効',not_spawned:'未出撃',moving:'移動中（攻撃なし）',
  target_defeated:'対象撃破済み',cooldown:'クールダウン中',not_visible:'視認条件不成立',attack:'攻撃実行'};
const names={engagement:'交戦開始',defeat:'対象撃破'};
let worker=null,requestId=0;
function viewEvent(event){
 const row=document.createElement('li');
 row.textContent='Tick '+event.tick+' · Group '+event.group+' · '+(names[event.type]||event.type);
 return row;
}
function render(data){
 const {view,summary,metrics}=data;
 $('inspect-status').textContent='Tick '+view.tick+' の状態を取得しました。';
 $('inspect-gate').textContent=labels[view.gate]||view.gate;
 $('inspect-gate-detail').textContent='Actor '+$('inspect-actor').value+' / Group '+view.target.group+
   ' · '+(view.attacked?'このTickで攻撃':'このTickでは攻撃しない')+
   ' · 視認 '+(view.target.visible?'成立':'不成立');
 $('inspect-states').textContent='前Tick: '+JSON.stringify(view.before)+'\n現在: '+JSON.stringify(view.after)+
   '\n全対象HP: '+JSON.stringify(view.snapshot.targets);
 $('inspect-measure').textContent='任意Tick取得中央値 '+metrics.query_median_ms.toFixed(4)+
   ' ms / 1回 · 状態JSON '+metrics.snapshot_bytes+' B · 要約JSON '+metrics.summary_bytes+' B';
 $('inspect-summary').textContent='総攻撃 '+summary.totals.hits+' 回 · 残HP合計 '+summary.totals.remainingHp+
   ' · 強調イベント '+summary.events.length+' 件';
 const list=$('inspect-events');list.replaceChildren();
 for(const event of summary.events.slice(0,80))list.append(viewEvent(event));
 if(summary.events.length>80){const more=document.createElement('li');more.textContent='ほか '+(summary.events.length-80)+' 件';list.append(more);}
}
function inspect(event){
 event?.preventDefault();
 const tick=Number($('inspect-tick').value),actorId=Number($('inspect-actor').value);
 const horizon=Number($('ticks').value),actors=Number($('actors').value),scenario=$('scenario').value;
 if(scenario==='all'){$('inspect-status').textContent='Inspectorでは個別シナリオを選択してください。';return;}
 if(!Number.isSafeInteger(tick)||tick<0||tick>horizon||!Number.isInteger(actorId)||actorId<0||actorId>=actors){
  $('inspect-status').textContent='Tickは0〜'+horizon+'、Actor IDは0〜'+(actors-1)+'で指定してください。';return;
 }
 worker?.terminate();requestId++;
 worker=new Worker(new URL('./inspector-worker.mjs',import.meta.url),{type:'module'});
 $('inspect-status').textContent='対象Tickを計算しています…';$('inspect-run').disabled=true;
 const current=requestId;
 worker.addEventListener('message',({data})=>{
  if(data.requestId!==current)return;
  if(data.type==='inspected')render(data);else $('inspect-status').textContent=data.message;
  $('inspect-run').disabled=false;worker?.terminate();worker=null;
 });
 worker.addEventListener('error',()=>{
  if(current===requestId){$('inspect-status').textContent='Workerの実行に失敗しました。';$('inspect-run').disabled=false;worker?.terminate();worker=null;}
 });
 worker.postMessage({type:'inspect',scenario,actors,horizon,tick,actorId,requestId:current});
}
$('inspect-form').addEventListener('submit',inspect);
$('inspect-tick').addEventListener('change',()=>{const h=Number($('ticks').value),t=Number($('inspect-tick').value);if(t>h)$('inspect-tick').value=String(h);});
