import { useEffect, useRef, useState } from "react";
import type {
  DomainType,
  EditorFeatureProps,
  StructuredTacticsAst,
  TacticalInput,
} from "../../contracts";
import type { SenkeiDraft } from "../../contracts";
import { StructuredTacticsEditor } from "./ast-editor";
import { configurationDefaults, domainValueForType, DomainValueEditor, memoryDefaults } from "./value-editor";
import "./editor.css";

function createDraft(ruleset: NonNullable<EditorFeatureProps["ruleset"]>): SenkeiDraft {
  const ast: StructuredTacticsAst = {
    schema_version: ruleset.structured_ast_version,
    program_name: "new_senkei",
    declarations: [],
  };
  return {
    schema_version: ruleset.model_version,
    id: "draft-" + ruleset.ruleset.digest.slice(0, 12),
    revision: "1",
    ruleset: ruleset.ruleset,
    configuration: configurationDefaults(ruleset.domain.senkei_configuration),
    program_input: { kind: "structured_ast", ast },
    initial_memory: memoryDefaults(ruleset.domain.tactical_memory),
  };
}

function labelForId(value: string): string {
  return value.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function typeLabel(type: DomainType): string {
  if (type.kind === "optional") return "Optional " + typeLabel(type.value);
  if (type.kind === "list" || type.kind === "vector") return type.kind + " of " + typeLabel(type.value.element);
  if (type.kind === "matrix") return "Matrix of " + typeLabel(type.value.element);
  return type.kind;
}

export function EditorFeature(props: EditorFeatureProps) {
  const { ruleset, draft, compilation, onDraftChange, onCompile } = props;
  const [mode, setMode] = useState<"text" | "structured">(draft?.program_input.kind === "text" ? "text" : "structured");
  const [busy, setBusy] = useState<"parse" | "format" | "compile" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (ruleset && !draft) {
      const initial = createDraft(ruleset);
      onDraftChange(initial);
      setMode("structured");
    }
  }, [ruleset, draft]);

  useEffect(() => {
    if (draft) setMode(draft.program_input.kind === "text" ? "text" : "structured");
  }, [draft?.program_input.kind]);

  if (!ruleset) {
    return (
      <section className="editor-panel editor-empty" aria-live="polite">
        <div className="editor-eyebrow">SENRITSU RULESET</div>
        <h2>Preparing your workshop</h2>
        <p>Configuration controls and tactical capabilities appear from the locally bundled ruleset.</p>
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="editor-panel editor-empty" aria-live="polite">
        <div className="editor-eyebrow">SENRITSU RULESET</div>
        <h2>Starting a new Senkei</h2>
        <p>Initial values are generated from this ruleset's schema.</p>
      </section>
    );
  }

  const updateDraft = (next: SenkeiDraft) => {
    setError(null);
    setMessage(null);
    draftRef.current = next;
    onDraftChange(next);
  };

  const updateAst = (ast: StructuredTacticsAst) => {
    updateDraft({ ...draft, program_input: { kind: "structured_ast", ast } });
  };

  const switchToStructured = async () => {
    if (draft.program_input.kind === "structured_ast") {
      setMode("structured");
      return;
    }
    setBusy("parse");
    setError(null);
    setMessage(null);
    const source = draft.program_input.source;
    try {
      const ast = await props.onParse(source, draft.ruleset);
      const latest = draftRef.current;
      if (latest?.program_input.kind === "text" && latest.program_input.source === source) {
        updateDraft({ ...latest, program_input: { kind: "structured_ast", ast } });
        setMode("structured");
      } else {
        setError("The source changed while it was being parsed. Parse the current version again.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Jinrei parser could not read this source.");
    } finally {
      setBusy(null);
    }
  };

  const switchToText = async () => {
    if (draft.program_input.kind === "text") {
      setMode("text");
      return;
    }
    setBusy("format");
    setError(null);
    setMessage(null);
    const ast = draft.program_input.ast;
    try {
      const source = await props.onFormat(ast, draft.ruleset);
      const latest = draftRef.current;
      if (latest?.program_input.kind === "structured_ast" && latest.program_input.ast === ast) {
        updateDraft({ ...latest, program_input: { kind: "text", source } });
        setMode("text");
      } else {
        setError("The visual strategy changed while it was being formatted. Format the current version again.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Jinrei formatter could not format this strategy.");
    } finally {
      setBusy(null);
    }
  };

  const compile = async () => {
    const input: TacticalInput = draft.program_input.kind === "text"
      ? { kind: "text", ruleset_ref: draft.ruleset, source: draft.program_input.source }
      : { kind: "structured_ast", ruleset_ref: draft.ruleset, ast: draft.program_input.ast };
    setBusy("compile");
    setError(null);
    setMessage(null);
    try {
      await onCompile(input);
      setMessage("Compilation completed by the Jinrei core.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Jinrei compiler rejected this strategy.");
    } finally {
      setBusy(null);
    }
  };

  const configuration = ruleset.domain.senkei_configuration;
  const memory = ruleset.domain.tactical_memory;
  const knownConfigurationFields = new Set(Object.keys(configuration));
  const extraConfiguration = Object.entries(draft.configuration).filter(([field]) => !knownConfigurationFields.has(field));
  const rulesetMatches = draft.ruleset.id === ruleset.ruleset.id
    && draft.ruleset.version.major === ruleset.ruleset.version.major
    && draft.ruleset.version.minor === ruleset.ruleset.version.minor
    && draft.ruleset.version.patch === ruleset.ruleset.version.patch
    && draft.ruleset.digest === ruleset.ruleset.digest;
  const symbols = [...new Set(Object.values(ruleset.domain.symbol_domains).flat())];
  const source = draft.program_input.kind === "text" ? draft.program_input.source : "";

  return (
    <section className="editor-workspace">
      <header className="editor-toolbar">
        <div>
          <div className="editor-eyebrow">SENKEI EDITOR · LOCAL</div>
          <h2>Build a formation and its tactics</h2>
          <p>Equipment follows the ruleset schema. Visual and text tactics compile through Jinrei.</p>
        </div>
        <button className="editor-compile-button" disabled={busy !== null || !rulesetMatches} onClick={compile} type="button">
          {busy === "compile" ? "Compiling…" : "Compile tactics"}
        </button>
      </header>

      {!rulesetMatches && (
        <div className="editor-inline-error" role="alert">
          This draft belongs to a different ruleset version. Select or restore a matching draft before compiling.
        </div>
      )}

      <div className="editor-layout">
        <aside className="editor-configuration">
          <div className="editor-section-heading">
            <span className="editor-eyebrow">ARMY CONFIGURATION</span>
            <span className="editor-count">{Object.keys(configuration).length} schema fields</span>
          </div>
          <p className="editor-section-intro">Choose the forces and setup allowed by this ruleset.</p>
          {Object.entries(configuration).length === 0 ? (
            <div className="editor-schema-empty">This ruleset has no configurable deployment fields.</div>
          ) : (
            <div className="editor-config-fields">
              {Object.entries(configuration).map(([field, definition]) => (
                <div className="editor-config-field" key={field}>
                  <div className="editor-config-title">
                    <strong>{labelForId(field)}</strong>
                    <span>{typeLabel(definition.value_type)}{definition.required ? " · required" : ""}</span>
                  </div>
                  <DomainValueEditor
                    label={labelForId(field)}
                    onChange={(value) => updateDraft({ ...draft, configuration: { ...draft.configuration, [field]: value } })}
                    symbols={symbols}
                    value={draft.configuration[field] ?? definition.default ?? domainValueForType(definition.value_type)}
                    valueType={definition.value_type}
                  />
                </div>
              ))}
              {extraConfiguration.map(([field, value]) => (
                <div className="editor-config-field editor-config-extra" key={field}>
                  <div className="editor-config-title">
                    <strong>{labelForId(field)}</strong>
                    <span>Not in the active ruleset schema · preserved</span>
                  </div>
                  <DomainValueEditor
                    label={labelForId(field)}
                    onChange={(next) => updateDraft({ ...draft, configuration: { ...draft.configuration, [field]: next } })}
                    symbols={symbols}
                    value={value}
                  />
                </div>
              ))}
            </div>
          )}

          <details className="editor-memory">
            <summary>Initial tactical memory <span>{Object.keys(memory).length} fields</span></summary>
            {Object.entries(memory).map(([field, valueType]) => (
              <div className="editor-config-field" key={field}>
                <div className="editor-config-title">
                  <strong>{labelForId(field)}</strong>
                  <span>{typeLabel(valueType)}</span>
                </div>
                <DomainValueEditor
                  label={labelForId(field)}
                  onChange={(value) => updateDraft({ ...draft, initial_memory: { ...draft.initial_memory, [field]: value } })}
                  symbols={symbols}
                  value={draft.initial_memory[field] ?? domainValueForType(valueType)}
                  valueType={valueType}
                />
              </div>
            ))}
          </details>
        </aside>

        <section className="editor-tactics">
          <div className="editor-mode-bar">
            <div className="editor-mode-switch" role="group" aria-label="Tactics editing mode">
              <button aria-pressed={mode === "structured"} className={mode === "structured" ? "is-active" : ""} disabled={busy !== null} onClick={switchToStructured} type="button">No-code</button>
              <button aria-pressed={mode === "text"} className={mode === "text" ? "is-active" : ""} disabled={busy !== null} onClick={switchToText} type="button">Jinrei text</button>
            </div>
            <span className="editor-ruleset-tag">{ruleset.ruleset.id} · {ruleset.ruleset.version.major}.{ruleset.ruleset.version.minor}.{ruleset.ruleset.version.patch}</span>
          </div>

          {error && <div className="editor-alert editor-alert-error" role="alert">{error}</div>}
          {message && <div className="editor-alert editor-alert-success" role="status">{message}</div>}

          {mode === "structured" && draft.program_input.kind === "structured_ast" ? (
            <StructuredTacticsEditor ast={draft.program_input.ast} domain={ruleset.domain} onChange={updateAst} />
          ) : mode === "text" && draft.program_input.kind === "text" ? (
            <div className="editor-text-mode">
              <div className="editor-text-help">
                <strong>Jinrei source</strong>
                <span>Parsed and compiled by the Rust core. Schema names are supplied by the active ruleset.</span>
              </div>
              <textarea
                aria-label="Jinrei source"
                className="editor-code-input"
                disabled={busy !== null}
                spellCheck={false}
                value={source}
                onChange={(event) => updateDraft({ ...draft, program_input: { kind: "text", source: event.currentTarget.value } })}
              />
            </div>
          ) : (
            <div className="editor-empty-mode">
              <span>{busy === "parse" ? "Parsing with Jinrei…" : "Formatting with Jinrei…"}</span>
            </div>
          )}

          <section className="editor-compilation" aria-live="polite">
            <div className="editor-section-heading">
              <span className="editor-eyebrow">COMPILE RESULT</span>
              {compilation && <strong>{compilation.estimated_cu.toLocaleString()} estimated CU</strong>}
            </div>
            {!compilation ? (
              <p>Compile the current tactics to check schema types and estimate its logical CU.</p>
            ) : (
              <>
                <p>Jinrei produced a verified program for this ruleset.</p>
                <span className="editor-digest">Program digest · {compilation.program.content_digest}</span>
                {compilation.diagnostics.length > 0 && (
                  <ul className="editor-diagnostic-list">
                    {compilation.diagnostics.map((diagnostic, index) => (
                      <li className={diagnostic.severity === "warning" ? "is-warning" : ""} key={diagnostic.path ?? diagnostic.code + index}>
                        <span>{diagnostic.severity}</span>
                        <strong>{diagnostic.code}</strong>
                        <span>{diagnostic.message}</span>
                        {diagnostic.path && <code>{diagnostic.path}</code>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}
