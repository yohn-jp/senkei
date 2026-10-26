import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import type { RulesetRef, SenkeiDraft } from "../../contracts";
import "./next-library.css";

export type NextLibraryView = "library" | "recovery";

export interface NextLibrarySlot {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly squad: string;
  readonly node: string;
  readonly skill_path: string;
}

export interface NextLibraryItem {
  readonly saved_at: string;
  readonly ruleset: RulesetRef;
  readonly slots: readonly NextLibrarySlot[];
  readonly draft: SenkeiDraft;
}

export function isNextLibraryItemRestorable(
  item: NextLibraryItem | null,
  loaded: boolean,
  mismatch: string | null,
  readError: string | null,
): boolean {
  return loaded && item !== null && mismatch === null && readError === null;
}

type AsyncAction = () => void | Promise<void>;
type ClearTarget = "saved" | "recovery";
type Confirmation = "restore-saved" | "restore-recovery" | "replace-saved" | "import-saved" | "experiments" | "import-experiments" | ClearTarget;

export interface NextExperimentSummary {
  readonly id: string;
  readonly created_at: string;
  readonly ruleset: RulesetRef;
  readonly scenario_title: string | null;
  readonly outcome: string;
  readonly final_tick: number | null;
}

export interface NextLibraryProps {
  readonly view: NextLibraryView;
  readonly onViewChange: (view: NextLibraryView) => void;
  readonly saved: NextLibraryItem | null;
  readonly recovery: NextLibraryItem | null;
  readonly savedRaw?: string | null;
  readonly recoveryRaw?: string | null;
  readonly savedError: string | null;
  readonly recoveryError: string | null;
  readonly runtimeError?: string | null;
  readonly savedMismatch: string | null;
  readonly recoveryMismatch: string | null;
  readonly message: string | null;
  readonly loaded: boolean;
  readonly canSave: boolean;
  readonly restoreDifferences: { readonly saved: readonly string[]; readonly recovery: readonly string[] };
  readonly onSave: AsyncAction;
  readonly onRestoreSaved: AsyncAction;
  readonly onRestoreRecovery: AsyncAction;
  readonly onExportCurrent: AsyncAction;
  readonly onExportSaved: AsyncAction;
  readonly onExportRecovery: AsyncAction;
  readonly onExportRawSaved?: AsyncAction;
  readonly onExportRawRecovery?: AsyncAction;
  readonly onImport: (file: File) => void | Promise<void>;
  readonly onClearSaved: AsyncAction;
  readonly onClearRecovery: AsyncAction;
  readonly onRetryStorage: AsyncAction;
  readonly onRetryCore: AsyncAction;
  readonly onReady: AsyncAction;
  readonly onBack: AsyncAction;
  readonly experiments: readonly NextExperimentSummary[];
  readonly experimentsLoaded: boolean;
  readonly canExportExperiments?: boolean;
  readonly hasPreservedExperiments?: boolean;
  readonly experimentsCompatible?: boolean;
  readonly experimentError: string | null;
  readonly experimentMismatch: string | null;
  readonly onOpenExperiments: AsyncAction;
  readonly onExportExperiments: AsyncAction;
  readonly onImportExperiments: (file: File) => void | Promise<void>;
  readonly onClearExperiments: AsyncAction;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceLabel(draft: SenkeiDraft): string {
  return draft.program_input.kind === "text" ? "Text Jinrei" : "Structured Jinrei";
}

function rawAvailable(raw: string | null | undefined, callback: AsyncAction | undefined): boolean {
  return typeof raw === "string" && callback !== undefined;
}

function ItemSummary({ item, label, mismatch }: { readonly item: NextLibraryItem | null; readonly label: string; readonly mismatch: string | null }): ReactElement {
  if (!item) return <p className="next-library-empty">{label} is not available as a readable Next setup.</p>;
  return (
    <dl className="next-library-facts">
      <div><dt>Saved</dt><dd>{formatDate(item.saved_at)}</dd></div>
      <div><dt>Ruleset</dt><dd>{item.ruleset.id} · {item.ruleset.version.major}.{item.ruleset.version.minor}.{item.ruleset.version.patch}</dd></div>
      <div><dt>Package digest</dt><dd><code>{item.ruleset.digest}</code></dd></div>
      <div><dt>Heroes</dt><dd>{item.slots.map((slot) => slot.catalog_id).join(" · ") || "No readable slots"}</dd></div>
      <div><dt>Jinrei</dt><dd>{sourceLabel(item.draft)} · revision {item.draft.revision}</dd></div>
      <div><dt>Compatibility</dt><dd className={mismatch ? "is-warning" : "is-good"}>{mismatch ? "Needs review" : "Matches the loaded Next ruleset"}</dd></div>
    </dl>
  );
}

export function NextLibrary(props: NextLibraryProps): ReactElement {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [pendingExperimentImport, setPendingExperimentImport] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const experimentImportRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement;
    confirmationRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    confirmationRef.current?.scrollIntoView({ block: "nearest" });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [confirmation]);

  const perform = async (action: AsyncAction, success: string, closeConfirmation = true): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (closeConfirmation) {
        setConfirmation(null);
        setPendingImport(null);
        setPendingExperimentImport(null);
      }
    }
  };

  const selectImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file || busy) return;
    setLocalError(null);
    setNotice(null);
    setPendingImport(file);
    if (props.saved || props.savedError || props.savedRaw != null) setConfirmation("import-saved");
    else void perform(() => props.onImport(file), `Imported ${file.name}.`);
  };

  const selectExperimentImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file || busy) return;
    setLocalError(null);
    setNotice(null);
    setPendingExperimentImport(file);
    if (props.experiments.length > 0 || props.experimentMismatch || props.experimentError) setConfirmation("import-experiments");
    else void perform(() => props.onImportExperiments(file), `Imported ${file.name}.`);
  };

  const save = (): void => {
    if (!props.canSave || busy) return;
    if ((props.savedError || props.savedMismatch) && (props.saved || props.savedRaw != null)) {
      setConfirmation("replace-saved");
      return;
    }
    void perform(props.onSave, "Pinned Next setup saved.");
  };

  const restore = (kind: "saved" | "recovery"): void => {
    if (busy || !isNextLibraryItemRestorable(kind === "saved" ? props.saved : props.recovery,
      props.loaded, kind === "saved" ? props.savedMismatch : props.recoveryMismatch,
      kind === "saved" ? props.savedError : props.recoveryError)) return;
    if (props.restoreDifferences[kind].length > 0) setConfirmation(kind === "saved" ? "restore-saved" : "restore-recovery");
    else void perform(kind === "saved" ? props.onRestoreSaved : props.onRestoreRecovery, "Setup restored. Recheck Ready before battle.");
  };

  const confirm = (): void => {
    const action = confirmation;
    if (!action) return;
    if (action === "restore-saved") void perform(props.onRestoreSaved, "Pinned setup restored. Recheck Ready before battle.");
    else if (action === "restore-recovery") void perform(props.onRestoreRecovery, "Recovery copy restored. Recheck Ready before battle.");
    else if (action === "replace-saved") void perform(props.onSave, "Pinned Next setup replaced and saved.");
    else if (action === "import-saved" && pendingImport) {
      const file = pendingImport;
      void perform(() => props.onImport(file), `Imported ${file.name}.`);
    } else if (action === "import-experiments" && pendingExperimentImport) {
      const file = pendingExperimentImport;
      void perform(() => props.onImportExperiments(file), `Imported ${file.name}.`);
    } else if (action === "saved") void perform(props.onClearSaved, "Pinned Next setup cleared.");
    else if (action === "recovery") void perform(props.onClearRecovery, "Recovery copy cleared.");
    else if (action === "experiments") void perform(props.onClearExperiments, "Local Next experiments cleared.");
  };

  const visibleError = localError ?? props.runtimeError ?? props.experimentError ?? props.savedError ?? props.recoveryError;
  const activeView = props.view;
  const restoring = confirmation === "restore-saved" || confirmation === "restore-recovery";
  const restoreKind = confirmation === "restore-recovery" ? "recovery" : "saved";

  return (
    <section className="next-library" aria-label="Next Library and recovery" data-testid="next-library">
      <header className="next-library-header">
        <div>
          <span className="next-library-eyebrow">S14–S15 · LOCAL SETUPS</span>
          <h2 ref={titleRef} tabIndex={-1}>{activeView === "library" ? <>Setup <em>Library</em></> : <>Recovery <em>desk</em></>}</h2>
          <p>Pinned setups and unsaved recovery copies stay in their existing Next storage.</p>
        </div>
        <div className="next-library-header-actions">
          <button type="button" onClick={() => void perform(props.onBack, "Returned to the previous screen.")}>Back</button>
          <button className="is-primary" type="button" onClick={() => void perform(props.onReady, "Returned to Ready.")}>Readyへ</button>
        </div>
      </header>

      <nav className="next-library-nav" aria-label="Library screens" role="tablist">
        {([
          ["library", "S14 · Library"],
          ["recovery", "S15 · Recovery"],
        ] as const).map(([view, label]) => (
          <button aria-selected={activeView === view} className={activeView === view ? "is-active" : ""} id={`next-library-tab-${view}`} key={view} onClick={() => props.onViewChange(view)} onKeyDown={(event) => {
            const views = ["library", "recovery"] as const;
            const current = views.indexOf(view);
            const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (current + 1) % views.length
              : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current + views.length - 1) % views.length
                : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            const target = views[next]!;
            props.onViewChange(target);
            document.getElementById(`next-library-tab-${target}`)?.focus();
          }} role="tab" tabIndex={activeView === view ? 0 : -1} type="button">{label}</button>
        ))}
      </nav>

      <p className="next-library-download-note">Export actions start a JSON download. Download started does not confirm that the file was saved on your device; check your browser’s downloads.</p>

      {!props.loaded && <div className="next-library-message" role="status"><strong>Checking local setup storage…</strong><p>Existing values stay untouched until their format and ruleset identity are read.</p></div>}
      {(visibleError || props.message || notice) && <div className={`next-library-message${visibleError ? " is-error" : ""}`} role={visibleError ? "alert" : "status"}>
        <div><strong>{visibleError ? "Recovery needs attention" : "Library status"}</strong><p>{visibleError ?? notice ?? props.message}</p></div>
        {visibleError && <div className="next-library-message-actions"><button disabled={busy} onClick={() => void perform(props.onRetryStorage, "Storage was checked again.")} type="button">Retry storage</button><button disabled={busy} onClick={() => void perform(props.onRetryCore, "Core and Catalog reload requested.")} type="button">Retry Core / Catalog</button></div>}
      </div>}

      {activeView === "library" && <div className="next-library-layout" role="tabpanel" aria-labelledby="next-library-tab-library">
        <aside className="next-library-list" aria-label="Next saved setup sources">
          <div className="next-library-list-title"><span>ON THIS DEVICE</span><small>Next · LocalStorage</small></div>
          <button aria-pressed={activeView === "library"} className={`next-library-source${activeView === "library" ? " is-selected" : ""}`} onClick={() => props.onViewChange("library")} type="button"><span className="next-library-source-mark">P</span><span><strong>Pinned setup</strong><small>{props.saved ? formatDate(props.saved.saved_at) : props.savedError ? "Unreadable data preserved" : "No pinned setup"}</small></span><b>↗</b></button>
          <button className="next-library-source" onClick={() => props.onViewChange("recovery")} type="button"><span className="next-library-source-mark is-recovery">R</span><span><strong>Recovery copy</strong><small>{props.recovery ? formatDate(props.recovery.saved_at) : props.recoveryError ? "Unreadable data preserved" : "No recovery copy"}</small></span><b>↗</b></button>
          <div className="next-library-source-note"><strong>Other local data stays separate</strong><p>Legacy IndexedDB documents and Graphics G1 fixtures use different formats. They are not converted into or loaded as Next setups.</p></div>
        </aside>

        <div className="next-library-detail">
          <section className="next-library-card">
            <div className="next-library-card-heading"><div><span className="next-library-eyebrow">EXPLICIT RESTORE POINT</span><h3>Pinned Next setup</h3></div><span className="next-library-badge">LOCAL</span></div>
            <ItemSummary item={props.saved} label="Pinned setup" mismatch={props.savedMismatch} />
            {props.savedMismatch && <p className="next-library-warning" role="alert">Compatibility check failed. The saved bytes remain available to export; restore is disabled until the matching RulePackage is loaded. {props.savedMismatch}</p>}
            {props.savedError && <div className="next-library-warning" role="alert">{props.savedError}{rawAvailable(props.savedRaw, props.onExportRawSaved) && <button onClick={() => void perform(props.onExportRawSaved!, "Preserved pinned bytes JSON download started.")} type="button">Export preserved bytes</button>}</div>}
            <div className="next-library-actions">
              <button className="is-primary" disabled={busy || !isNextLibraryItemRestorable(props.saved, props.loaded, props.savedMismatch, props.savedError)} onClick={() => restore("saved")} type="button">Restore pinned setup</button>
              <button disabled={busy || !props.canSave} onClick={save} type="button">Save current setup</button>
              <button disabled={busy || !props.canSave} onClick={() => void perform(props.onExportCurrent, "Current setup JSON download started.")} type="button">Export current</button>
              {props.saved && <button disabled={busy} onClick={() => void perform(props.onExportSaved, "Pinned setup JSON download started.")} type="button">Export pinned</button>}
              {(props.saved || props.savedError) && <button className="is-danger" disabled={busy} onClick={() => setConfirmation("saved")} type="button">Clear pinned…</button>}
            </div>
          </section>

          <section className="next-library-card next-library-import-card">
            <div><span className="next-library-eyebrow">PORTABLE JSON</span><h3>Import a Next setup</h3><p>The existing format and full ruleset identity are checked before restore. An incompatible file remains available for export and review.</p></div>
            <input accept="application/json,.json" aria-label="Import a Next setup JSON file" hidden onChange={selectImport} ref={importRef} type="file" />
            <button disabled={busy} onClick={() => importRef.current?.click()} type="button">Choose JSON file</button>
          </section>

          <section aria-label="Stored Next experiments" className="next-library-card next-library-experiments">
            <div className="next-library-card-heading"><div><span className="next-library-eyebrow">IMMUTABLE ENBU RECORDS</span><h3>Recent experiments</h3><p>Each Run retains its RulePackage, authored World, complete input, result, replay and authorized local diagnostics independently from the editable setup.</p></div><span className="next-library-badge">INDEXEDDB</span></div>
            <div className="next-library-retention" role="note" aria-label="Completed Run retention"><strong>Up to 2 completed Runs</strong><p>Only the latest completed Run and its previous comparison Run are retained. When a third completed Run is saved successfully, it replaces the older record; later completed Runs follow the same rule.</p><p>Export experiments before completing another battle to keep a copy of these records outside this Library. Pinned setup and Recovery store your editable setup separately.</p></div>
            {!props.experimentsLoaded && <p role="status">Checking local experiment storage…</p>}
            {props.experiments.length > 0 && !props.experimentsCompatible && !props.experimentMismatch && <p className="next-library-message" role="status">Stored outcomes are shown for review. Import or open remains unavailable until Core reproduces and verifies each retained Run.</p>}
            {props.experimentMismatch && <p className="next-library-warning" role="alert">The saved experiments stay preserved, but this runtime could not verify every Run using its retained RulePackage, authored World and complete input. They cannot be opened as a comparison. {props.experimentMismatch}</p>}
            {props.experiments.length > 0 ? <ol className="next-library-experiment-list">{props.experiments.map((experiment, index) => <li key={experiment.id}><strong>{index === 0 ? "Latest completed Run" : "Previous completed Run"} · {experiment.ruleset.id} {experiment.ruleset.version.major}.{experiment.ruleset.version.minor}.{experiment.ruleset.version.patch} · {experiment.scenario_title ?? "Local PvE"} · {experiment.outcome.replaceAll("_", " ")}</strong><small>{formatDate(experiment.created_at)} · {experiment.final_tick === null ? "Tick unverified" : `${experiment.final_tick} ticks`} · {experiment.id}</small></li>)}</ol> : props.experimentsLoaded && !props.experimentMismatch && !props.experimentError && <p className="next-library-empty">No completed Next Enbu experiments are saved on this device.</p>}
            <div className="next-library-actions">
              <button className="is-primary" disabled={busy || !props.experimentsLoaded || props.experimentsCompatible === false || props.experiments.length === 0 || Boolean(props.experimentMismatch)} onClick={() => void perform(props.onOpenExperiments, "Restored the latest result and comparison baseline.")} type="button">Open latest comparison</button>
              <button disabled={busy || !(props.canExportExperiments ?? props.experiments.length > 0)} onClick={() => void perform(props.onExportExperiments, "Next experiments JSON download started.")} type="button">Export experiments</button>
              {(props.experiments.length > 0 || props.hasPreservedExperiments) && <button className="is-danger" disabled={busy} onClick={() => setConfirmation("experiments")} type="button">Clear experiments…</button>}
              <input accept="application/json,.json" aria-label="Import Next experiment file" hidden onChange={selectExperimentImport} ref={experimentImportRef} type="file" />
              <button disabled={busy} onClick={() => experimentImportRef.current?.click()} type="button">Import experiments</button>
            </div>
          </section>
        </div>
      </div>}

      {activeView === "recovery" && <div className="next-library-recovery" role="tabpanel" aria-labelledby="next-library-tab-recovery">
        <section className="next-library-card">
          <div className="next-library-card-heading"><div><span className="next-library-eyebrow">S15 · AUTOMATIC RECOVERY COPY</span><h3>Unsaved work</h3><p>This copy stays separate from the pinned restore point. Select restore only after reviewing its identity.</p></div><span className="next-library-badge is-recovery">RECOVERY</span></div>
          <ItemSummary item={props.recovery} label="Recovery copy" mismatch={props.recoveryMismatch} />
          {props.recoveryMismatch && <p className="next-library-warning" role="alert">This recovery copy does not match the current Next ruleset. It is preserved and cannot be restored in this session. {props.recoveryMismatch}</p>}
          {props.recoveryError && <div className="next-library-warning" role="alert">{props.recoveryError}{rawAvailable(props.recoveryRaw, props.onExportRawRecovery) && <button onClick={() => void perform(props.onExportRawRecovery!, "Preserved recovery bytes JSON download started.")} type="button">Export preserved bytes</button>}</div>}
          <div className="next-library-actions">
            <button className="is-primary" disabled={busy || !isNextLibraryItemRestorable(props.recovery, props.loaded, props.recoveryMismatch, props.recoveryError)} onClick={() => restore("recovery")} type="button">Restore recovery copy</button>
            {props.recovery && <button disabled={busy} onClick={() => void perform(props.onExportRecovery, "Recovery copy JSON download started.")} type="button">Export recovery copy</button>}
            {(props.recovery || props.recoveryError) && <button className="is-danger" disabled={busy} onClick={() => setConfirmation("recovery")} type="button">Clear recovery…</button>}
          </div>
        </section>
        <section className="next-library-card next-library-recovery-help"><span className="next-library-eyebrow">RECOVERY CHECKS</span><h3>When recovery is unavailable</h3><p>Storage errors offer retry. A format or ruleset mismatch keeps the original bytes available to export. Loading a compatible RulePackage is required before the normal restore action appears.</p><div className="next-library-actions"><button disabled={busy} onClick={() => void perform(props.onRetryStorage, "Storage was checked again.")} type="button">Retry storage</button><button disabled={busy} onClick={() => void perform(props.onRetryCore, "Core and Catalog reload requested.")} type="button">Retry Core / Catalog</button></div></section>
      </div>}

      {confirmation && <section ref={confirmationRef} className="next-library-confirm" aria-label="Confirm Library change" role="alertdialog" aria-modal="false" aria-labelledby="next-library-confirm-title">
        <div><span className="next-library-eyebrow">EXPLICIT CONFIRMATION</span><h3 id="next-library-confirm-title">{restoring ? `Replace the current Draft with the ${restoreKind === "saved" ? "pinned setup" : "recovery copy"}?` : confirmation === "saved" ? "Clear the pinned setup?" : confirmation === "recovery" ? "Clear the recovery copy?" : confirmation === "experiments" ? "Clear saved experiments?" : confirmation === "import-experiments" ? "Replace saved experiments with this import?" : confirmation === "import-saved" ? "Replace the pinned setup with this import?" : "Replace the pinned setup with the current draft?"}</h3><p>{restoring ? "Restore replaces the current editable setup with the selected copy. Review the differences below. The pinned restore point and completed experiments stay unchanged. Automatic Recovery will follow the restored Draft. You can keep the current Draft or export it before replacing it." : confirmation === "saved" ? "The local pinned setup will be removed. Export preserved bytes first if you need a copy." : confirmation === "recovery" ? "The local recovery copy will be removed. The current editing draft remains open." : confirmation === "experiments" ? "The saved immutable Enbu records and any preserved raw experiment payload will be removed from this device. Export preserved data first if you need a copy. The current editable setup remains open." : confirmation === "import-experiments" ? "Each imported Run is reproduced using its retained RulePackage, authored World and complete immutable input. Existing experiments remain until every result, replay and authorized local projection passes validation and the replacement is saved." : confirmation === "import-saved" ? "The existing pinned setup remains until the imported JSON passes validation and is accepted by the storage handler." : "The saved data does not match the loaded ruleset or could not be parsed. Export it first if you need to keep the original bytes."}</p>{restoring && <ul className="next-library-restore-differences" aria-label="Setup differences">{props.restoreDifferences[restoreKind].map((difference, index) => <li key={index}>{difference}</li>)}</ul>}</div>
        <div className="next-library-actions"><button disabled={busy} onClick={() => { setConfirmation(null); setPendingImport(null); setPendingExperimentImport(null); }} type="button">{restoring ? "Keep current Draft" : "Keep existing data"}</button>{restoring && <button disabled={busy || !props.canSave} onClick={() => void perform(props.onExportCurrent, "Current Draft JSON download started. The restore review remains open.", false)} type="button">Export current Draft first</button>}<button className="is-danger" disabled={busy || (confirmation === "import-saved" && !pendingImport) || (confirmation === "import-experiments" && !pendingExperimentImport)} onClick={confirm} type="button">{restoring ? "Replace current Draft" : confirmation === "saved" || confirmation === "recovery" || confirmation === "experiments" ? "Confirm clear" : confirmation === "import-saved" ? "Validate and replace" : confirmation === "import-experiments" ? "Validate and import" : "Confirm replacement"}</button></div>
      </section>}
    </section>
  );
}
