import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  decodeReplay,
  type DisplayState,
  type Event,
} from "@senkei/replay-contract";
import { ReplayPlayer } from "@senkei/replay-player";
import { Battlefield } from "@senkei/renderer";
import basic from "../../../../packages/replay-contract/fixtures/basic-three-lane.json";
import clash from "../../../../packages/replay-contract/fixtures/clash-and-loss.json";
import tower from "../../../../packages/replay-contract/fixtures/tower-collapse.json";
import malformed from "../../../../packages/replay-contract/fixtures/invalid/schema-version.json";
import "./style.css";
const fixtures = {
  "tower-collapse": tower,
  "basic-three-lane": basic,
  "clash-and-loss": clash,
  "malformed-replay": malformed,
};
type FixtureKey = keyof typeof fixtures;
const names: Record<FixtureKey, string> = {
  "tower-collapse": "朱軍の塔、陥落",
  "basic-three-lane": "三路の進軍",
  "clash-and-loss": "中央の交戦",
  "malformed-replay": "不正データ（復帰確認）",
};
const kindNames: Record<string, string> = {
  infantry: "槍歩兵",
  heavy: "重装兵",
  archer: "射手",
  watchtower: "監視塔",
  citadel: "本拠地",
};
const sideNames = { azure: "蒼軍", vermilion: "朱軍", neutral: "中立" };
function CameraIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
    </svg>
  );
}
function eventLabel(event: Event) {
  const types = {
    vitals: "回復・成長",
    skill: "スキル",
    spawn: "援軍が出現",
    move: "進軍",
    attack: "攻撃",
    damage: "確定HP更新",
    destroy: "破壊・損失",
    disappear: "観測終了",
    "match-end": "サンプル終局",
  };
  return types[event.type];
}
function Scene({
  player,
  selected,
  onSelect,
  cameraEpoch,
}: {
  player: ReplayPlayer;
  selected: string | null;
  onSelect: (id: string) => void;
  cameraEpoch: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<Battlefield | null>(null);
  const [failure, setFailure] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [pixel, setPixel] = useState(true);
  useEffect(() => {
    let scene: Battlefield | null = null;
    setFailure(null);
    try {
      scene = new Battlefield(
        host.current!,
        player.replay,
        onSelect,
        (message) => {
          player.pause();
          setFailure(message);
        },
      );
      renderer.current = scene;
      scene.update(player.state, player.playing);
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "WebGL2を開始できませんでした",
      );
    }
    const unsubscribe = player.subscribe(() =>
      scene?.update(player.state, player.playing),
    );
    return () => {
      unsubscribe();
      scene?.dispose();
      renderer.current = null;
    };
  }, [player, attempt]);
  useEffect(() => {
    renderer.current?.select(selected);
  }, [selected, player, attempt]);
  useEffect(() => {
    renderer.current?.resetCamera();
  }, [cameraEpoch]);
  useEffect(() => {
    renderer.current?.setPixel(pixel);
  }, [pixel, attempt, player]);
  return (
    <section className="battlefield" aria-label="戦場">
      <div className="scene-host" ref={host} />
      <div className="scene-caption">
        <span className="eyebrow">THREE-LANE DIORAMA</span>
        <h1>{player.replay.header.title}</h1>
        <p>記録された戦場を、読み解く。</p>
      </div>
      <div className="scene-tools">
        <button
          aria-label="カメラを初期位置へ"
          onClick={() => renderer.current?.resetCamera()}
        >
          <CameraIcon /> <span>視点を戻す</span>
        </button>
        <button aria-label="拡大" onClick={() => renderer.current?.zoom(1.2)}>
          ＋
        </button>
        <button
          aria-label="縮小"
          onClick={() => renderer.current?.zoom(1 / 1.2)}
        >
          −
        </button>
        <button
          aria-label="Pixel 3D"
          aria-pressed={pixel}
          onClick={() => setPixel(!pixel)}
        >
          ▦ <span>{pixel ? "Pixel" : "Smooth"}</span>
        </button>
      </div>
      <div className="scene-bottom">
        <span>
          ◆ 蒼軍 <i /> ▲ 朱軍
        </span>
        <span className="gesture">ドラッグで回転 · スクロールでズーム</span>
        <span>TOP / MID / BOT</span>
      </div>
      {failure && (
        <div className="error-overlay" role="alert">
          <span className="eyebrow">RENDERER ERROR</span>
          <h2>戦場を描画できません</h2>
          <p>WebGL2対応のブラウザが必要です。</p>
          <code>{failure}</code>
          <button onClick={() => setAttempt((a) => a + 1)}>描画を再試行</button>
        </div>
      )}
    </section>
  );
}
function App() {
  const [fixture, setFixture] = useState<FixtureKey>("tower-collapse");
  const [player, setPlayer] = useState<ReplayPlayer | null>(null),
    [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DisplayState | null>(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null),
    [cameraEpoch, setCameraEpoch] = useState(0);
  useEffect(() => {
    setSelected(null);
    setPlaying(false);
    setSpeed(1);
    try {
      const next = new ReplayPlayer(decodeReplay(fixtures[fixture]));
      setPlayer(next);
      setState(next.state);
      setError(null);
    } catch (e) {
      setPlayer(null);
      setState(null);
      setError(e instanceof Error ? e.message : "Replay不正");
    }
  }, [fixture]);
  useEffect(() => {
    if (!player) return;
    const sync = () => {
      setState(player.state);
      setPlaying(player.playing);
      setSpeed(player.speed);
      setSelected((id) =>
        id && player.state.entities[id] && !player.state.entities[id].destroyed
          ? id
          : null,
      );
    };
    const unsub = player.subscribe(sync);
    let previous = performance.now(),
      frame = 0;
    const animate = (now: number) => {
      player.advance(
        document.hidden ? 0 : Math.max(0, Math.min(250, now - previous)),
      );
      previous = now;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      unsub();
      cancelAnimationFrame(frame);
    };
  }, [player]);
  const entity = selected ? state?.entities[selected] : null;
  const notable =
    player?.replay.timeline.filter(
      (e) => !["move", "damage"].includes(e.type),
    ) ?? [];
  const changeFixture = (value: string) => setFixture(value as FixtureKey);
  const counts = (side: string) =>
    state
      ? Object.values(state.entities).filter(
          (e) => e.side === side && e.kind === "unit" && !e.destroyed,
        ).length
      : "—";
  return (
    <div className="app">
      <header className="header">
        <a className="brand" href="./" aria-label="Senkei ホーム">
          <span className="brand-mark">戦</span>
          <span>
            SENKEI<small>戦型 / 演武</small>
          </span>
        </a>
        <div className="header-context">
          <span className="active-tab">演武</span>
          <span className="header-rule" />
          REPLAY THEATER
        </div>
        <span className="sample-badge">
          <b />
          サンプル戦闘
        </span>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <div className="fixture-block">
            <span className="eyebrow">01 / SAMPLE REPLAY</span>
            <h2>演武を選ぶ</h2>
            <label className="sr-only" htmlFor="fixture">
              Fixture選択
            </label>
            <select
              id="fixture"
              value={fixture}
              onChange={(e) => changeFixture(e.target.value)}
            >
              {Object.entries(names).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            <p>
              固定Fixtureによる合成の戦闘です。
              <br />
              Enbuの実行結果・正式勝敗ではありません。
            </p>
          </div>
          <div className="army-block">
            <span className="eyebrow">ON THE FIELD</span>
            <div className="army-count">
              <span className="azure">
                ◆ 蒼軍 <b>{counts("azure")}</b>
              </span>
              <span className="vermilion">
                ▲ 朱軍 <b>{counts("vermilion")}</b>
              </span>
            </div>
            <div className="legend">
              <div>
                <span>⚑</span>
                <b>槍歩兵</b>
                <small>長槍・小盾</small>
              </div>
              <div>
                <span>▣</span>
                <b>重装兵</b>
                <small>大盾・重鎧</small>
              </div>
              <div>
                <span>⌁</span>
                <b>射手</b>
                <small>弓・フード</small>
              </div>
            </div>
            <p className="muted">兵科は表示用のサンプルです。</p>
          </div>
          <section className="events">
            <span className="eyebrow">RECORDED MOMENTS</span>
            <h2>戦場の記録</h2>
            {notable.map((event) => (
              <button
                className={
                  state?.tick === event.tick ? "event current" : "event"
                }
                key={`${event.tick}-${event.order}`}
                disabled={!player}
                onClick={() => {
                  player?.pause();
                  player?.seek(event.tick);
                }}
              >
                <span className="event-tick">
                  {String(event.tick).padStart(2, "0")}
                </span>
                <span>
                  {eventLabel(event as Event)}
                  <small>
                    {event.type === "match-end"
                      ? "記録された結果"
                      : "entityId" in event
                        ? event.entityId
                        : "援軍"}
                  </small>
                </span>
                <span className="event-arrow">↗</span>
              </button>
            ))}
          </section>
          <div className="sidebar-foot">
            PRESENTATION REPLAY <span>v0.1</span>
          </div>
        </aside>
        <div className="arena">
          <div className="mobile-fixture">
            <label htmlFor="mobile-fixture">サンプル</label>
            <select
              id="mobile-fixture"
              aria-label="モバイルFixture選択"
              value={fixture}
              onChange={(e) => changeFixture(e.target.value)}
            >
              {Object.entries(names).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            <button
              aria-label="モバイル視点リセット"
              onClick={() => setCameraEpoch((e) => e + 1)}
            >
              <CameraIcon />
            </button>
          </div>
          {player && state ? (
            <Scene
              player={player}
              selected={selected}
              onSelect={setSelected}
              cameraEpoch={cameraEpoch}
            />
          ) : (
            <section className="contract-error" role="alert">
              <span className="eyebrow">INVALID REPLAY</span>
              <h1>リプレイを読み込めません</h1>
              <p>データ契約に一致しないため、再生を停止しました。</p>
              <code>{error}</code>
              <button onClick={() => changeFixture("tower-collapse")}>
                正常なサンプルへ戻る
              </button>
            </section>
          )}
          {entity && (
            <section className="entity-detail" aria-label="選択情報">
              <span>
                {sideNames[entity.side]} /{" "}
                {kindNames[entity.archetype] ?? entity.archetype}
              </span>
              <span>
                HP {entity.hp} / {entity.maxHp}
              </span>
              <button
                aria-label="詳細を閉じる"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </section>
          )}
          {state?.result && (
            <div className="result-banner" role="status" aria-label="終局結果">
              <span>サンプル終局</span>
              <strong>
                {state.result.winner === "draw"
                  ? "引き分け"
                  : `${sideNames[state.result.winner]}の勝利`}
              </strong>
              <small>{state.result.reason}</small>
            </div>
          )}
          <section className="transport" aria-label="再生操作">
            <div className="timeline-head">
              <span className="eyebrow">
                {playing ? "PLAYING" : state?.result ? "FINISHED" : "PAUSED"}
              </span>
              <output aria-label="現在Tick">
                <span>TICK</span>{" "}
                <b>{String(state?.tick ?? 0).padStart(2, "0")}</b>
                <small> / {player?.replay.result.tick ?? "—"}</small>
              </output>
            </div>
            <input
              className="timeline"
              aria-label="Tickシーク"
              type="range"
              min="0"
              max={player?.replay.result.tick ?? 28}
              value={state?.tick ?? 0}
              disabled={!player}
              onChange={(e) => player?.seek(Number(e.target.value))}
            />
            <div className="transport-row">
              <div className="play-buttons">
                <button
                  aria-label="先頭へ戻る"
                  disabled={!player}
                  onClick={() => player?.reset()}
                >
                  ↶
                </button>
                <button
                  className="play"
                  aria-label={playing ? "停止" : "再生"}
                  disabled={!player}
                  onClick={() => (playing ? player?.pause() : player?.play())}
                >
                  <span>{playing ? "Ⅱ" : "▶"}</span>
                  {playing ? "停止" : "再生"}
                </button>
              </div>
              <p className="transport-note">
                {state?.result
                  ? "もう一度、戦場を見返す。"
                  : "進軍 · 交戦 · 損失を、任意のTickから。"}
              </p>
              <div className="speed" aria-label="再生速度">
                {[1, 2, 4].map((rate) => (
                  <button
                    key={rate}
                    disabled={!player}
                    aria-label={`${rate}倍速`}
                    aria-pressed={speed === rate}
                    onClick={() => player?.setSpeed(rate)}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
          </section>
          <footer className="arena-footer">
            <span>合成Fixture · 戦闘の再計算なし</span>
            <span>PIXEL 3D / PROCEDURAL ASSETS</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
