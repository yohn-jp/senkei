import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroPreview, type HeroView, type HeroLight, type HeroInspection } from '../../../../packages/renderer/src/hero-preview';
import manifest from '../../../../assets/manifests/f01.json';
import './style.css';

function Atelier() {
  const host = useRef<HTMLDivElement>(null), viewer = useRef<HeroPreview | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [lod, setLod] = useState('detail'), [clip, setClip] = useState('Idle');
  const [view, setView] = useState<HeroView>('detail'), [light, setLight] = useState<HeroLight>('studio');
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [position, setPosition] = useState(0);
  const [inspection, setInspection] = useState<HeroInspection>();
  useEffect(() => {
    if (!host.current) return;
    try { viewer.current = new HeroPreview(host.current, setError); setReady(true); }
    catch { setError('WebGL2を開始できませんでした。対応ブラウザで再読込してください。'); }
    return () => { viewer.current?.dispose(); viewer.current = null; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true; setInspection(undefined); setPosition(0); setError('');
    const asset = manifest.lods.find(l => l.level === lod)!;
    viewer.current?.load(asset.url, clip).then(result => { if (active && result) setInspection(result); }).catch(() => { if (active) setError('モデルを読み込めませんでした。再読込してください。'); });
    return () => { active = false; };
  }, [ready, lod]);
  const selectClip = (name: string) => { setPosition(0); setClip(name); viewer.current?.play(name); };
  const selectView = (name: HeroView) => { setView(name); viewer.current?.setView(name); };
  const selectLight = (name: HeroLight) => { setLight(name); viewer.current?.light(name); };
  return <main>
    <header><a href="/">SENKEI <span>戦型</span></a><span className="edition">HERO ATELIER / PRODUCTION STUDY 01</span><a href="/graphics/">戦場ビュー ↗</a></header>
    <div className="workspace">
      <section className="stage" aria-label="Heroプレビュー">
        <div className="stage-heading"><span className="eyebrow">THE VANGUARD COLLECTION</span><h1>不退の旗手<span>AEGIS MARSHAL</span></h1><p>F01 / 前衛・防御・指揮</p></div>
        <div ref={host} className="viewport" data-testid="hero-viewport"/>
        <div className="stage-note"><span className="status-dot"/> {lod === 'detail' ? 'HERO DETAIL' : 'BATTLE LOD'}<span>01 — AZURE GUARD</span></div>
        <div className="camera-tools" aria-label="カメラ操作"><button onClick={() => viewer.current?.rotate(-Math.PI/4)} aria-label="左へ45度回転">↶</button><button onClick={() => viewer.current?.rotate(Math.PI/4)} aria-label="右へ45度回転">↷</button><button onClick={() => viewer.current?.zoom(.85)} aria-label="ズームイン">＋</button><button onClick={() => viewer.current?.zoom(1.18)} aria-label="ズームアウト">−</button><button onClick={() => selectView(view)} aria-label="カメラをリセット">↺</button></div>
        {!inspection && !error && <div className="loading" role="status">F01を読み込み中…</div>}
        {error && <div className="loading error" role="alert">{error}<button onClick={() => location.reload()}>再読込</button></div>}
      </section>
      <aside>
        <div className="hero-id"><span>HERO / F01</span><span className="badge">制作PoC</span></div>
        <h2>前線を支える、<br/>揺るぎない意志。</h2>
        <p className="description">前方へ示す剣は進軍の合図。稜線を刻む大盾と幾重の銀甲で戦列を守る、青の指揮官。</p>
        <p className="disclaimer">名称・物語は制作上の仮設定です。実性能・スキル効果を示すものではありません。</p>
        <div className="traits"><div><small>POSITION</small><strong>前衛</strong></div><div><small>COMBAT</small><strong>防御</strong></div><div><small>TACTICS</small><strong>指揮</strong></div></div>
        <fieldset disabled={!inspection}><legend>01 <span>動作 / MOTION</span></legend><div className="motions">{[['Idle','待機'],['Walk','移動'],['Attack','攻撃'],['Skill','指揮'],['Death','死亡']].map(([name,label])=><button key={name} disabled={!inspection?.clips.some(c=>c.name===name)} aria-pressed={clip===name} onClick={()=>selectClip(name)}>{label}<small>{name}</small></button>)}</div>
        <div className="playback"><button aria-pressed={paused} onClick={()=>{setPaused(!paused);viewer.current?.pause(!paused);}}>{paused?'▶ 再生':'Ⅱ 一時停止'}</button><label>姿勢 <input aria-label="アニメーション位置" type="range" min="0" max="100" value={position} onChange={e=>{setPosition(Number(e.target.value));setPaused(true);viewer.current?.pause(true);viewer.current?.seek(Number(e.target.value)/100);}}/></label><button onClick={()=>{selectClip(clip);}}>先頭へ</button></div></fieldset>
        <fieldset><legend>02 <span>構図 / CAMERA</span></legend><div className="segments">{([['detail','全身'],['portrait','近景'],['battle','戦場']] as const).map(([name,label])=><button key={name} aria-pressed={view===name} onClick={()=>selectView(name)}>{label}</button>)}</div></fieldset>
        <fieldset><legend>03 <span>照明 / LIGHT</span></legend><div className="segments">{([['studio','Studio'],['daylight','Daylight'],['rim','Rim']] as const).map(([name,label])=><button key={name} aria-pressed={light===name} onClick={()=>selectLight(name)}>{label}</button>)}</div></fieldset>
        <fieldset><legend>04 <span>造形 / MODEL</span></legend><div className="segments">{[['detail','Detail'],['battle','Battle LOD']].map(([name,label])=><button key={name} aria-pressed={lod===name} onClick={()=>setLod(name)}>{label}</button>)}</div></fieldset>
        <output className="inspection" data-testid="hero-inspection" aria-live="polite">{inspection?`${Math.round(inspection.triangles).toLocaleString('en-US')} triangles · ${inspection.clips.length} motions · ${inspection.skinnedMeshes} skinned meshes`:'—'}</output>
        <p className="hint">ドラッグで回転 / スクロール・ピンチでズーム<br/>ボタンからも回転・拡大できます。</p>
      </aside>
    </div><footer><span>STYLIZED TACTICAL FANTASY</span><span>{manifest.appearanceKey}</span><a href="https://studio.blender.org/characters/snow/v4/" target="_blank" rel="noreferrer">Snow base © Blender Foundation · CC BY 4.0 / Senkei armor</a></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Atelier/>);
