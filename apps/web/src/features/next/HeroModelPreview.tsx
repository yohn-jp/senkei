import { useEffect, useRef, useState } from "react";

type Pose = "idle" | "move" | "attack" | "hit" | "death";
type Preview = { dispose(): void; setPose(pose: Pose): void; resetView(): void };

export function HeroModelPreview({ catalogId, appearanceKey, name }: {
  readonly catalogId: string; readonly appearanceKey: string; readonly name: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
  const currentPose = useRef<Pose>("idle");
  const [pose, setPose] = useState<Pose>("idle");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false;
    setReady(false);
    setError(null);
    void import("@senkei/renderer").then(({ createHeroModelPreview }) => {
      if (closed || !host.current) return;
      preview.current = createHeroModelPreview(host.current, {
        catalogId, appearanceKey, name,
        onError: (message: string) => { if (!closed) { setError(message); setReady(false); } },
      });
      preview.current.setPose(currentPose.current);
      setReady(true);
    }).catch((cause: unknown) => {
      if (!closed) setError(cause instanceof Error ? cause.message : "The 3D model could not be loaded.");
    });
    return () => { closed = true; preview.current?.dispose(); preview.current = null; };
  }, [catalogId, appearanceKey, name, attempt]);
  const changePose = (next: Pose) => {
    currentPose.current = next;
    setPose(next);
    preview.current?.setPose(next);
  };
  return <section aria-label={`${name} 3D model`} className="next-hero-model-preview">
    <div className="next-hero-model-canvas" ref={host} />
    {!ready && !error && <p className="next-hero-model-status" role="status">Loading 3D model…</p>}
    {error && <div className="next-hero-model-status" role="status"><p>3D preview unavailable: {error}</p><button onClick={() => setAttempt(value => value + 1)} type="button">Retry model</button></div>}
    <div aria-label="Hero animation preview" className="next-hero-model-controls" role="group">
      <span>Animation preview</span>
      {(["idle", "move", "attack", "hit", "death"] as const).map(value => <button aria-label={`Preview ${value} animation`} aria-pressed={pose === value} disabled={!ready} key={value} onClick={() => changePose(value)} type="button">{value[0].toUpperCase() + value.slice(1)}</button>)}
      <button disabled={!ready} onClick={() => preview.current?.resetView()} type="button">Reset view</button>
    </div>
    <p className="next-hero-model-hint">Drag to turn · Scroll or pinch to zoom. The same equipment and model appear on the battlefield.</p>
  </section>;
}
