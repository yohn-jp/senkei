import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { behaviorCoveragePresentation } from "@senkei/jinrei-editor";
import type { ActorSelection, ComparisonSurface, DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { CompileOutcome, CoreClient, RulePackage, SenkeiDraft, TacticalInput } from "../../contracts";
import { EditorFeature } from "../editor";
import { JinreiDomainPanel } from "./JinreiDomainPanel";
import "./jinrei-workbench.css";

export interface JinreiWorkbenchSlot {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly squad: string;
  readonly node: string;
  readonly skill_path: string;
}

export type JinreiWorkbenchScreen = "workbench" | "coverage";
type WorkbenchView = "no-code" | "text" | "catalog";
type BehaviorScope = "hero" | "squad" | "army";

export interface JinreiWorkbenchProps {
  /** True only while S08 is the visible workspace screen. */
  readonly active?: boolean;
  readonly core: CoreClient | null;
  readonly ruleset: RulePackage | null;
  readonly catalog: DomainCatalogDocument | null;
  readonly catalogError: string | null;
  readonly draft: SenkeiDraft | null;
  readonly draftKey: string | null;
  readonly compilation: CompileOutcome | null;
  readonly slots: readonly JinreiWorkbenchSlot[];
  readonly activeSlot: number;
  readonly screen: JinreiWorkbenchScreen;
  onActiveSlotChange(index: number): void;
  onDraftChange(draft: SenkeiDraft | null): void;
  onSourceChange(source: string): void;
  onCompile(input: TacticalInput): Promise<CompileOutcome>;
  onCompiled(result: CompileOutcome, draftKey: string): void;
  onReady(): void;
  onFormation(): void;
  onScreenChange(screen: JinreiWorkbenchScreen): void;
}

function actorForScope(
  scope: BehaviorScope,
  slot: JinreiWorkbenchSlot | null,
): ActorSelection {
  if (scope === "army") return { scope: "army", side: "attacker" };
  if (scope === "squad") return { scope, side: "attacker", squadId: slot?.squad ?? "" };
  return {
    scope: "hero", side: "attacker", squadId: slot?.squad ?? "",
    heroId: slot?.slot_id ?? "", heroCatalogId: slot?.catalog_id,
  };
}

function diagnosticPath(message: string): string | null {
  return message.match(/(?: at |path\s+)(\/[^\s:]+)/i)?.[1] ?? null;
}

export function JinreiWorkbench({
  active = false,
  core,
  ruleset,
  catalog,
  catalogError,
  draft,
  draftKey,
  compilation,
  slots,
  activeSlot,
  screen,
  onActiveSlotChange,
  onDraftChange,
  onSourceChange,
  onCompile,
  onCompiled,
  onReady,
  onFormation,
  onScreenChange,
}: JinreiWorkbenchProps): ReactElement {
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>("no-code");
  const [coverageScope, setCoverageScope] = useState<BehaviorScope>("hero");
  const [surface, setSurface] = useState<ComparisonSurface>("effective");
  const [filter, setFilter] = useState("");
  const [compileError, setCompileError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState<"no-code" | "text" | null>(null);
  const [lastCompiledDraftKey, setLastCompiledDraftKey] = useState<string | null>(null);
  const firstVisitStarted = useRef(false);
  const draftRef = useRef(draft);
  const draftKeyRef = useRef(draftKey);
  const activeHero = slots[activeSlot] ?? null;

  const coverageActor = useMemo(() => actorForScope(coverageScope, activeHero), [coverageScope, activeHero]);
  const coverage = useMemo(() => catalog
    ? behaviorCoveragePresentation(catalog, coverageActor, surface)
    : null, [catalog, coverageActor, surface]);
  const visibleRows = useMemo(() => coverage?.rows.filter((row) =>
    `${row.fieldId} ${row.reason} ${row.senritsuDefault} ${row.heroCatalogDefault}`
      .toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())) ?? [], [coverage, filter]);
  const compileState = compilation
    ? "COMPILED"
    : "COMPILE REQUIRED";
  const compileStateDetail = !compilation && lastCompiledDraftKey && lastCompiledDraftKey !== draftKey
    ? "The previous compile expired after an edit."
    : "The current Draft needs a Jinrei compile.";

  useEffect(() => {
    draftRef.current = draft;
    draftKeyRef.current = draftKey;
  }, [draft, draftKey]);

  const selectEditorMode = async (nextMode: "no-code" | "text"): Promise<void> => {
    const current = draftRef.current;
    if (!current || !ruleset || !core) {
      setModeError("The current RulePackage and local Rust core are required to change Jinrei representation.");
      return;
    }
    setModeError(null);
    if (nextMode === "no-code" && current.program_input.kind === "structured_ast") {
      setWorkbenchView("no-code");
      return;
    }
    if (nextMode === "text" && current.program_input.kind === "text") {
      setWorkbenchView("text");
      return;
    }

    const startingDraft = current;
    const startingKey = draftKeyRef.current;
    setModeBusy(nextMode);
    try {
      let programInput: SenkeiDraft["program_input"];
      if (nextMode === "no-code") {
        if (current.program_input.kind !== "text") throw new Error("The current Draft is already in No-code form.");
        programInput = { kind: "structured_ast", ast: await core.parseText(current.program_input.source, current.ruleset) };
      } else {
        if (current.program_input.kind !== "structured_ast") throw new Error("The current Draft is already in Text form.");
        programInput = { kind: "text", source: await core.formatAst(current.program_input.ast, current.ruleset) };
      }
      if (draftRef.current !== startingDraft || draftKeyRef.current !== startingKey) {
        throw new Error("Jinrei changed during conversion. The original Draft is preserved; select the representation again.");
      }
      onDraftChange({ ...startingDraft, program_input: programInput });
      setWorkbenchView(nextMode);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Jinrei could not be converted to ${nextMode}.`;
      setModeError(nextMode === "no-code"
        ? `No-code could not parse this Jinrei source. The original Text Draft was preserved. ${message}`
        : message);
      if (nextMode === "no-code") setWorkbenchView("text");
    } finally {
      setModeBusy(null);
    }
  };

  useEffect(() => {
    if (!active || !ruleset || !core || !draft || firstVisitStarted.current) return;
    firstVisitStarted.current = true;
    if (draft.program_input.kind === "structured_ast") {
      setWorkbenchView("no-code");
      return;
    }
    void selectEditorMode("no-code");
  }, [active, ruleset, core, draft]);

  useEffect(() => {
    if (compilation && draftKey) setLastCompiledDraftKey(draftKey);
  }, [compilation, draftKey]);

  useEffect(() => {
    setCompileError(null);
  }, [draftKey]);

  const compile = async (input: TacticalInput): Promise<CompileOutcome> => {
    setCompileError(null);
    try {
      const result = await onCompile(input);
      if (draftKey) setLastCompiledDraftKey(draftKey);
      onCompiled(result, draftKey ?? "");
      return result;
    } catch (cause) {
      setCompileError(cause instanceof Error ? cause.message : "The Jinrei compiler rejected this source.");
      throw cause;
    }
  };

  const openDiagnostic = async (path: string | null): Promise<void> => {
    onScreenChange("workbench");
    setWorkbenchView("text");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let editor = document.querySelector<HTMLTextAreaElement>(".next-jinrei-workbench textarea[aria-label='Jinrei source']");
    if (!editor) {
      await selectEditorMode("text");
      for (let attempt = 0; attempt < 20 && !editor; attempt++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        editor = document.querySelector<HTMLTextAreaElement>(".next-jinrei-workbench textarea[aria-label='Jinrei source']");
      }
    }
    editor?.focus();
    editor?.scrollIntoView({ block: "center" });
    if (path) setCompileError(`Editing location: ${path}. The compiler path is shown here; text offsets are not supplied by the compiler.`);
  };

  const diagnosticRows = compilation?.diagnostics ?? [];

  return (
    <section className="next-jinrei-workbench" aria-label="Jinrei Workbench and Behavior Coverage">
      <header className="next-jinrei-workbench-heading">
        <div><span className="next-eyebrow">JINREI · DOMAIN CATALOG · COVERAGE</span><h3>Shape your <em>orders</em></h3><p>One Draft and one Jinrei compiler connect every scope and view.</p></div>
        <div className={`next-jinrei-compile-badge${compilation ? " is-current" : ""}`} aria-live="polite"><span>{compilation ? "✓" : "◌"}</span><strong className={`next-compile-state${compilation ? " is-ready" : ""}`}>{compileState}</strong><small>{compileStateDetail}</small></div>
      </header>

      <nav className="next-jinrei-screen-nav" aria-label="Jinrei screens" role="tablist">
        <button aria-selected={screen === "workbench"} onClick={() => onScreenChange("workbench")} role="tab" type="button"><span>08</span><strong>Jinrei Workbench</strong><small>EDIT · CATALOG</small></button>
        <button aria-selected={screen === "coverage"} onClick={() => onScreenChange("coverage")} role="tab" type="button"><span>09</span><strong>Behavior Coverage</strong><small>HERO · SQUAD · ARMY</small></button>
      </nav>

      <section className="next-jinrei-screen" hidden={screen !== "workbench"} aria-label="Jinrei editor and Domain Catalog">
        <nav className="next-jinrei-view-nav" aria-label="Workbench view" role="tablist">
          <button aria-selected={workbenchView === "no-code"} disabled={modeBusy !== null} onClick={() => void selectEditorMode("no-code")} role="tab" type="button">No-code</button>
          <button aria-selected={workbenchView === "text"} disabled={modeBusy !== null} onClick={() => void selectEditorMode("text")} role="tab" type="button">Jinrei Text</button>
          <button aria-selected={workbenchView === "catalog"} disabled={modeBusy !== null} onClick={() => setWorkbenchView("catalog")} role="tab" type="button">Domain Catalog</button>
        </nav>

        <div className="next-jinrei-editor-pane" hidden={workbenchView === "catalog"} aria-busy={modeBusy !== null}>
          {modeBusy && <p className="next-jinrei-conversion-state" role="status">{modeBusy === "no-code" ? "Parsing the existing source with the Jinrei core…" : "Formatting this AST with the Jinrei core…"}</p>}
          {modeError && <section className="next-jinrei-diagnostic-alert" role="alert"><div><strong>{workbenchView === "text" ? "Text Draft preserved" : "Representation conversion failed"}</strong><p>{modeError}</p></div>{draft?.program_input.kind === "text" && <button onClick={() => void selectEditorMode("no-code")} type="button">Retry No-code ↻</button>}</section>}
          {!draft && <div className="next-jinrei-state" role="status"><strong>Jinrei Draft is being prepared.</strong><p>Catalog and compiler feedback will appear when the shared formation draft is ready.</p></div>}
          {draft && <div className="next-jinrei-editor-mount" hidden={modeBusy !== null}>
          <EditorFeature
            ruleset={ruleset}
            draft={draft}
            compilation={compilation}
            onDraftChange={onDraftChange}
            onParse={(source, rulesetRef) => core
              ? core.parseText(source, rulesetRef)
              : Promise.reject(new Error("The local Rust core is still loading."))}
            onFormat={(ast, rulesetRef) => core
              ? core.formatAst(ast, rulesetRef)
              : Promise.reject(new Error("The local Rust core is still loading."))}
            onCompile={async (input) => { await compile(input); }}
          />
          </div>}
          {compileError && <section className="next-jinrei-diagnostic-alert" role="alert"><div><strong>Compile needs attention</strong><p>{compileError}</p></div><button onClick={() => void openDiagnostic(diagnosticPath(compileError))} type="button">Open Jinrei editor ↗</button></section>}
          {diagnosticRows.length > 0 && <section className="next-jinrei-diagnostic-card" aria-label="Jinrei compiler diagnostics">
            <header><div><span className="next-eyebrow">CURRENT COMPILE</span><strong>{compilation?.estimated_cu.toLocaleString()} CU · {diagnosticRows.length} diagnostic{diagnosticRows.length === 1 ? "" : "s"}</strong></div></header>
            <ul>{diagnosticRows.map((diagnostic, index) => <li key={`${diagnostic.path ?? diagnostic.code}-${index}`}>
              <div><strong>{diagnostic.code}</strong><span>{diagnostic.message}</span>{diagnostic.path && <code>{diagnostic.path}</code>}</div>
              <button onClick={() => void openDiagnostic(diagnostic.path)} type="button">Edit this location ↗</button>
            </li>)}</ul>
          </section>}
          <div className="next-jinrei-context-actions">
            <p>Editing Hero {activeHero?.catalog_id ?? "—"} · {activeHero?.squad ?? "no Squad"} · initial Node {activeHero?.node ?? "—"}. These selections are shared with Hero Atelier.</p>
            <button onClick={onFormation} type="button">Edit Hero / Squad</button>
            <button onClick={onReady} type="button">準備確認へ</button>
          </div>
        </div>

        <div className="next-jinrei-catalog-pane" hidden={workbenchView !== "catalog"}>
          {catalog && core && <JinreiDomainPanel
            catalog={catalog}
            core={core}
            draftKey={draftKey ?? "unkeyed-draft"}
            onCompiled={(result, key) => {
              onCompiled(result, key);
              if (key === draftKey) setLastCompiledDraftKey(key);
            }}
            onSourceChange={onSourceChange}
            slot={activeHero ? { slotId: activeHero.slot_id, squadId: activeHero.squad, heroCatalogId: activeHero.catalog_id } : null}
            source={draft?.program_input.kind === "text" ? draft.program_input.source : ""}
          />}
          {(!catalog || !core) && <div className="next-jinrei-state" role={catalogError ? "alert" : "status"}>
            <strong>{catalogError ? "Domain Catalog unavailable" : "Domain Catalog loading"}</strong>
            <p>{catalogError ?? "The workspace is loading the RulePackage-bound Senritsu Catalog and Rust compiler."}</p>
            <small>The draft stays available. Catalog completion and battle readiness require the matching current Catalog.</small>
          </div>}
          <div className="next-jinrei-context-actions"><button onClick={onReady} type="button">準備確認へ</button></div>
        </div>
      </section>

      <section className="next-coverage-screen" hidden={screen !== "coverage"} aria-label="Hero Behavior Coverage">
        <header className="next-coverage-heading"><div><span className="next-eyebrow">09 · BEHAVIOR PROFILE ANALYSIS</span><h4>Coverage by <em>Hero</em></h4><p>Inspect declared defaults and the current evidence boundary for each scope.</p></div><div className="next-coverage-proof-state"><strong>NOT PROVEN</strong><span>0 fields proven</span></div></header>

        <div className="next-coverage-controls">
          <label><span>Coverage scope</span><select value={coverageScope} onChange={(event) => setCoverageScope(event.currentTarget.value as BehaviorScope)}><option value="hero">Hero</option><option value="squad">Squad</option><option value="army">Army</option></select></label>
          {coverageScope === "hero" && <div className="next-coverage-hero-picker" role="group" aria-label="Coverage Hero">
            {slots.map((slot, index) => <button aria-pressed={activeSlot === index} key={slot.slot_id} onClick={() => onActiveSlotChange(index)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><strong>{slot.catalog_id}</strong><small>{slot.squad}</small></button>)}
          </div>}
          {coverageScope === "squad" && <label><span>Squad in current formation</span><select value={activeHero?.squad ?? ""} onChange={(event) => {
            const index = slots.findIndex((slot) => slot.squad === event.currentTarget.value);
            if (index >= 0) onActiveSlotChange(index);
          }}>{[...new Set(slots.map((slot) => slot.squad))].map((squad) => <option key={squad} value={squad}>{squad} · {slots.filter((slot) => slot.squad === squad).map((slot) => slot.catalog_id).join(", ")}</option>)}</select></label>}
          <label><span>Comparison</span><select value={surface} onChange={(event) => setSurface(event.currentTarget.value as ComparisonSurface)}><option value="default">Default</option><option value="effective">Effective</option><option value="observed">Observed</option></select></label>
          <label className="next-coverage-filter"><span>Filter behavior fields</span><input onChange={(event) => setFilter(event.currentTarget.value)} placeholder="Search declared fields" type="search" value={filter} /></label>
        </div>

        {catalog && coverage ? <>
          <div className="next-coverage-provenance" role="note"><strong>{coverage.profileDeclared ? "Behavior Profile extension declared" : "Behavior Profile not declared"}</strong><span>RulePackage {catalog.identity.rulesetId} · Catalog {catalog.catalogDigest.slice(0, 12)}… · extension {catalog.metadataExtensionDigest?.slice(0, 12) ?? "none"}</span><p>{coverage.profileDeclared
            ? "Senritsu and Hero Catalog defaults below come from this Catalog. Squad/Army merge, Jinrei override resolution and decision coverage are not supplied by the connected compiler."
            : "This RulePackage declares no Behavior Profile metadata. A missing default remains Not Declared; no fallback value is inferred."}</p></div>
          <div className="next-coverage-legend" aria-label="Coverage states"><span><b>Default</b> Catalog-authored baseline</span><span><b>Explicit</b> authored Behavior Profile override, if producer supplies one</span><span><b>Effective</b> resolved inheritance result</span><span><b>Unknown</b> value unavailable in an authorized observation</span><span><b>Not Proven</b> static coverage proof unavailable</span><span><b>Not Checked</b> no authorized Observation supplied to this screen</span></div>
          <div className="next-coverage-table-wrap">
            <table className="next-coverage-table"><thead><tr><th scope="col">Behavior field</th><th scope="col">Default · Senritsu</th><th scope="col">Default · Hero Catalog</th><th scope="col">Explicit · Jinrei</th><th scope="col">Effective</th><th scope="col">Observed</th><th scope="col">Evidence</th></tr></thead>
              <tbody>{visibleRows.map((row) => <tr key={row.fieldId}><th scope="row"><code>{row.fieldId}</code></th><td data-label="Default · Senritsu"><span className={`next-coverage-value${row.defaultStatus === "not_declared" ? " is-unavailable" : ""}`}>{row.senritsuDefault}</span></td><td data-label="Default · Hero Catalog"><span className="next-coverage-value">{row.heroCatalogDefault}</span></td><td data-label="Explicit · Jinrei"><span className="next-coverage-state is-unproven">NOT PROVEN</span><small>Compiled tactics have no Behavior Profile field binding in this Compiler output.</small></td><td data-label="Effective"><span className="next-coverage-state is-unproven">{row.effectiveStatus.replaceAll("_", " ").toUpperCase()}</span><small>{row.reason}</small></td><td data-label="Observed"><span className="next-coverage-state is-unchecked">{row.observedStatus}</span><small>No authorized Enbu Observation envelope is connected here.</small></td><td data-label="Evidence"><details><summary>Why unavailable</summary><p>{row.reason}</p></details></td></tr>)}</tbody>
            </table>
            {visibleRows.length === 0 && <p className="next-jinrei-state">No declared Behavior Profile fields match this filter. Catalog observations and capabilities can be explored in the Domain Catalog view.</p>}
          </div>
          <div className="next-coverage-limits" role="status"><strong>Coverage remains Not Proven.</strong><span>No producer currently supplies Behavior Profile composition, per-Hero Explicit binding, state-class static proof, or an identity-matched authorized Observed envelope to S09. No Unknown value is substituted with zero or false.</span></div>
        </> : <div className="next-jinrei-state" role={catalogError ? "alert" : "status"}><strong>{catalogError ? "Coverage cannot be verified" : "Loading current Catalog"}</strong><p>{catalogError ?? "Coverage requires the identity-matched RulePackage Catalog."}</p><small>Unavailable data remains unreported as a behavior result.</small></div>}

        <footer className="next-jinrei-context-actions"><p>Coverage is informational. It does not replace Jinrei compilation or Ready / Preflight validation.</p><button onClick={() => { onScreenChange("workbench"); }} type="button">Edit Jinrei →</button><button onClick={onReady} type="button">準備確認へ</button></footer>
      </section>
    </section>
  );
}
