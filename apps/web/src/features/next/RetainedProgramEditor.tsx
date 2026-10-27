import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CompileOutcome, CoreClient, TacticalSource } from "../../contracts";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "../../worker/input-identity";
import type { CoverageRun } from "./coverage-observed";
import { compileRetainedSource, loadRetainedOriginal } from "./retained-program-editor";
import type { RetainedEditorCore, RetainedOriginal } from "./retained-program-editor";
import "./retained-program-editor.css";

export interface RetainedProgramEditorProps {
  readonly core: CoreClient | null;
  readonly run: CoverageRun | null;
  /** The original attacker source retained with this Run. */
  readonly source: TacticalSource | null;
  readonly onPrepared?: (compiled: CompileOutcome, source: string) => void;
}
type Ready = { readonly core: CoreClient; readonly run: CoverageRun; readonly sourceKey: string; readonly original: RetainedOriginal };
type Compiled = { readonly ready: Ready; readonly text: string; readonly outcome: CompileOutcome };

/** Prepare an improved Program from a copy of the original owner's retained source. */
export function RetainedProgramEditor({ core, run, source, onPrepared }: RetainedProgramEditorProps): ReactElement {
  const sourceKey = canonicalJson(source);
  const [ready, setReady] = useState<Ready | null>(null);
  const [text, setText] = useState("");
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const revision = useRef(0);
  const nextRevision = (): number => {
    if (revision.current >= Number.MAX_SAFE_INTEGER) throw new Error("The compile revision space is exhausted. Reload the workspace.");
    return ++revision.current;
  };
  useEffect(() => {
    const current = ++generation.current;
    setReady(null); setCompiled(null); setBusy(false); setMessage(null); setText("");
    if (!core || !run || !source) {
      setMessage("An owner-authorized Run with its original source and retained assets is required.");
      return;
    }
    setBusy(true);
    const retained = core as RetainedEditorCore;
    void loadRetainedOriginal(retained, run, source, nextRevision()).then(original => {
      if (current !== generation.current) return;
      setReady({ core, run, sourceKey, original }); setText(original.source);
    }).catch((error: unknown) => {
      if (current === generation.current) setMessage(error instanceof Error ? error.message : "The retained source is unavailable.");
    }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current += 1; };
  }, [core, run, sourceKey, retry]);
  const active = ready && ready.core === core && ready.run === run && ready.sourceKey === sourceKey ? ready : null;
  const validCompile = active && compiled?.ready === active && compiled.text === text ? compiled : null;
  const edit = (value: string): void => { generation.current += 1; setText(value); setCompiled(null); setBusy(false); setMessage(null); };
  const compile = async (): Promise<void> => {
    if (!active || !core) return;
    const current = ++generation.current, snapshot = text;
    setBusy(true); setMessage(null); setCompiled(null);
    try {
      const outcome = await compileRetainedSource(core as RetainedEditorCore, active.original.verified, active.original.stamp, snapshot, nextRevision());
      if (current === generation.current) setCompiled({ ready: active, text: snapshot, outcome });
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : "Retained compilation failed."); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const prepare = async (): Promise<void> => {
    if (!active || !validCompile || !onPrepared) return;
    const current = ++generation.current;
    setBusy(true); setMessage(null);
    try {
      const verified = active.original.verified;
      if (await reproductionSnapshotDigest(verified.run.snapshot) !== verified.snapshotDigest
        || await sha256Hex(canonicalJson(verified.run.reproductionAssets)) !== verified.assetsDigest) throw new Error("The retained Run or its assets changed. Reload its source before preparing a rematch.");
      if (current === generation.current) onPrepared(validCompile.outcome, validCompile.text);
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : "The retained Run could not be verified."); }
    finally { if (current === generation.current) setBusy(false); }
  };
  return <details className="retained-program-editor"><summary>Improve the retained Run's Jinrei</summary>
    <section aria-label="Retained Run Jinrei editor">
      <p>Compile a copy of the original attacker source using this Run's retained RulePackage, World and Catalog. Preparing a rematch is a separate action.</p>
      {!active && busy && <p role="status">Verifying the owner Run and original source…</p>}
      {message && <p role="alert">{message}</p>}
      {!active && !busy && core && run && source && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry retained source</button>}
      {active && <><p>Run: {active.run.snapshot.context.match_id} · Catalog <code>{active.original.stamp.catalogDigest}</code></p>
        <p>The original source reproduced the frozen owner Program. This copy does not modify the current Draft.</p>
        <label>Original attacker Jinrei copy<textarea value={text} spellCheck={false} onChange={event => edit(event.currentTarget.value)} /></label>
        <div className="retained-program-actions"><button type="button" disabled={busy} onClick={() => void compile()}>{busy ? "Working…" : "Compile retained Jinrei"}</button>
          <button type="button" disabled={busy || !validCompile || !onPrepared} onClick={() => void prepare()}>Prepare improved retained Run</button></div>
        {validCompile && <section aria-label="Retained compile result"><p>Compiled against the retained Catalog · estimated {validCompile.outcome.estimated_cu} CU.</p>
          {validCompile.outcome.diagnostics.map((item, index) => <p key={index}>{item.severity} · {item.code}: {item.message}</p>)}
        </section>}
        {!onPrepared && <p>Preparing an improved Run is unavailable in this workspace.</p>}
      </>}
    </section>
  </details>;
}
