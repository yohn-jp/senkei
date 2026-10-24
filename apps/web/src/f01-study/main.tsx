import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { F01Viewer, VIEWS, type View, type Light, type StudyStats } from '../../../../packages/renderer/src/f01-study/viewer';
import { DEFAULT_F01 } from '../../../../packages/renderer/src/f01-study/model';
import './style.css';

function Study() {
  const host=useRef<HTMLDivElement>(null), viewer=useRef<F01Viewer|null>(null);
  const [view,setView]=useState<View>('oblique'),[light,setLight]=useState<Light>('studio');
  const [wireframe,setWireframe]=useState(false),[stats,setStats]=useState<StudyStats|null>(null);
  const [error,setError]=useState(''),[epoch,setEpoch]=useState(0),[seed,setSeed]=useState(String(DEFAULT_F01.seed));
  useEffect(()=>{
    if(!host.current)return;
    setError('');setStats(null);setView('oblique');setLight('studio');setWireframe(false);
    try {viewer.current=new F01Viewer(host.current,setError,setStats);}
    catch(e){setError(`3D描画を開始できませんでした。${e instanceof Error?e.message:''}`);}
    return ()=>{viewer.current?.dispose();viewer.current=null;};
  },[epoch]);
  const chooseView=(next:View)=>{setView(next);viewer.current?.setView(next);};
  const chooseLight=(next:Light)=>{setLight(next);viewer.current?.setLight(next);};
  const regenerate=()=>{
    const value=Number(seed);
    if(!/^\d+$/.test(seed)||!Number.isSafeInteger(value)||value>0xffffffff){setError('seedは0〜4294967295の整数で指定してください。');return;}
    try{viewer.current?.regenerate({...DEFAULT_F01,seed:value});viewer.current?.setWireframe(wireframe);setError('');}
    catch(e){setError(e instanceof Error?e.message:'再生成に失敗しました。');}
  };
  return <main>
    <header><a href="/graphics/" className="wordmark">SENKEI <span>戦型</span></a><span className="study-number">FORM STUDIES / 001</span><span className="state">静的造形の実証</span></header>
    <section className="workspace">
      <div className="stage">
        <div className="stage-title"><p>THE VANGUARD</p><h1>不退の旗手</h1><span>AEGIS MARSHAL / F01</span></div>
        <div className="viewport" ref={host}/>
        <div className="stage-footer"><span>THREE.JS · CODE-AUTHORED GEOMETRY</span><span>Y ↑ / Z FRONT</span></div>
        <div className="camera-tools" aria-label="モデル操作">
          <button onClick={()=>viewer.current?.rotate(-Math.PI/6)} aria-label="左へ回転">↶</button>
          <button onClick={()=>viewer.current?.rotate(Math.PI/6)} aria-label="右へ回転">↷</button>
          <button onClick={()=>viewer.current?.zoom(1.2)} aria-label="拡大">＋</button>
          <button onClick={()=>viewer.current?.zoom(1/1.2)} aria-label="縮小">−</button>
          <button onClick={()=>chooseView(view)} aria-label="構図をリセット">↺</button>
        </div>
        {!stats&&!error&&<div className="notice" role="status">モデルを生成しています…</div>}
      </div>
      <aside>
        <div className="eyebrow">01 / SHAPE BEFORE MOTION</div>
        <h2>形を、確かめる。</h2>
        <p className="intro">前線を支える大盾と、指揮を示す三つの稜線。銀甲・青布・淡い金を、ひとつの輪郭へ。</p>
        <p className="disclaimer">F01〈前衛・防御・指揮〉の造形試作。名称は仮称です。完成品・品質承認済みモデルではありません。</p>
        <fieldset disabled={!stats}><legend>構図 <span>INSPECTION</span></legend><div className="view-grid">{Object.entries(VIEWS).map(([id,v])=><button key={id} onClick={()=>chooseView(id as View)} aria-pressed={id===view}>{v.label}</button>)}</div></fieldset>
        <fieldset disabled={!stats}><legend>照明 <span>LIGHTING</span></legend><div className="light-grid">{([['studio','Studio'],['daylight','Daylight'],['neutral','Neutral']] as const).map(([id,label])=><button key={id} onClick={()=>chooseLight(id)} aria-pressed={id===light}>{label}</button>)}</div></fieldset>
        <fieldset disabled={!stats}><legend>メッシュ <span>GEOMETRY</span></legend><button className="wire" aria-pressed={wireframe} onClick={()=>{setWireframe(!wireframe);viewer.current?.setWireframe(!wireframe);}}>{wireframe?'面表示へ戻す':'ワイヤーフレーム'}</button></fieldset>
        <fieldset disabled={!stats}><legend>再生成 <span>REPRODUCIBILITY</span></legend><div className="seed"><label htmlFor="seed">seed</label><input id="seed" value={seed} inputMode="numeric" onChange={e=>setSeed(e.target.value)} /><button onClick={regenerate}>再生成</button></div><p className="hint">同じseedで同じ形を再生成。seedの差は髪の形状に反映されます。</p></fieldset>
        {error&&<div className="error" role="alert">{error}<button onClick={()=>setEpoch(epoch+1)}>プレビュー再起動</button></div>}
        <output data-testid="f01-status" className="metrics">{stats?<><strong>{stats.triangles.toLocaleString('en-US')}<small>triangles</small></strong><span>{stats.meshes} meshes / {stats.materials} materials</span><span>{stats.drawCalls} draw calls（ステージ含む）</span><code>{stats.fingerprint}</code></>:'—'}</output>
        <p className="boundary">アニメーション・LOD・戦闘への統合は行っていません。戦場距離は同じモデルを引いた画角で表示します。</p>
      </aside>
    </section>
    <footer><span>PROCEDURAL HERO / STATIC STUDY</span><span>ドラッグで回転・スクロールで拡大。ボタンでも操作できます。</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Study/>);
