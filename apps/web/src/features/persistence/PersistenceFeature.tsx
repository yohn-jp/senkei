import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import type { PersistenceFeatureProps } from "../../contracts/features";
import "./persistence.css";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function prettyValue(value: unknown, present: boolean): string {
  if (!present) return "(not present)";
  return JSON.stringify(value, null, 2) ?? "null";
}

export function PersistenceFeature(props: PersistenceFeatureProps) {
  const [name, setName] = useState("");
  const [beforeRevision, setBeforeRevision] = useState("");
  const [afterRevision, setAfterRevision] = useState("");
  const [revisionToRestore, setRevisionToRestore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeDocument = props.active_document?.id === props.selected_document_id
    ? props.active_document
    : null;
  const selectedRevision = revisionToRestore ?? props.selected_revision;
  const visibleError = error ?? props.storage_error ?? null;
  const revisions = props.history.filter((entry) => entry.document_id === props.selected_document_id);
  const orderedRevisions = useMemo(
    () => [...revisions].sort((left, right) => right.revision - left.revision),
    [revisions],
  );

  const perform = async (message: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError("Enter a name for this document.");
      return;
    }
    void perform("Document created and its first revision saved.", async () => {
      await props.onCreate(nextName);
      setName("");
    });
  };

  const handleSave = () => {
    if (!activeDocument || !props.active_draft) return;
    void perform("A new immutable revision was saved.", async () => {
      await props.onSave({ ...activeDocument, payload: props.active_draft! });
    });
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busy) return;
    void perform(`Imported ${file.name}.`, () => props.onImport(file));
  };

  const handleCompare = () => {
    const before = Number(beforeRevision);
    const after = Number(afterRevision);
    if (!props.selected_document_id || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)) {
      setError("Choose two revisions to compare.");
      return;
    }
    void perform("Revision comparison updated.", () =>
      props.onCompareRevisions(props.selected_document_id!, before, after),
    );
  };

  const handleDelete = () => {
    if (!props.selected_document_id) return;
    const selected = props.documents.find((document) => document.id === props.selected_document_id);
    const label = selected?.name ?? "this document";
    if (!window.confirm(`Delete “${label}” and all of its local revision history?`)) return;
    void perform("Document and its revision history deleted.", () => props.onDelete(props.selected_document_id!));
  };

  return (
    <section className="persistence-feature" aria-label="Local document library">
      <div className="persistence-toolbar">
        <div>
          <div className="feature-eyebrow">LOCAL LIBRARY · INDEXEDDB</div>
          <h2>Saved strategies</h2>
          <p>Documents, version history, and test inputs stay on this device.</p>
        </div>
        <label className="persistence-button persistence-button-secondary persistence-import">
          Import JSON export
          <input accept="application/json,.json" aria-label="Import JSON export" onChange={handleImport} type="file" />
        </label>
      </div>

      {(visibleError || notice) && (
        <div className={`persistence-message${visibleError ? " is-error" : " is-success"}`} role={visibleError ? "alert" : "status"}>
          {visibleError ?? notice}
        </div>
      )}

      <div className="persistence-layout">
        <aside className="persistence-list-panel" aria-label="Saved documents">
          <form className="persistence-create" onSubmit={handleCreate}>
            <label htmlFor="new-document-name">New document</label>
            <div className="persistence-input-row">
              <input
                autoComplete="off"
                id="new-document-name"
                maxLength={128}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Strategy name"
                value={name}
              />
              <button className="persistence-button" disabled={busy || !props.active_draft} type="submit">
                Create document
              </button>
            </div>
            {!props.active_draft && <small>Open a draft in Tactics before creating a document.</small>}
          </form>

          <div className="persistence-list-heading">
            <span>DOCUMENTS</span>
            <span>{props.documents.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="persistence-document-list">
            {props.documents.length === 0 ? (
              <p className="persistence-empty">No documents saved yet.</p>
            ) : props.documents.map((document) => (
              <button
                aria-current={document.id === props.selected_document_id ? "true" : undefined}
                aria-label={`Open ${document.name}`}
                className={`persistence-document${document.id === props.selected_document_id ? " is-selected" : ""}`}
                disabled={busy}
                key={document.id}
                onClick={() => void perform(`Opened ${document.name}.`, () => props.onSelect(document.id))}
                type="button"
              >
                <span className="persistence-document-name">{document.name}</span>
                <span className="persistence-document-meta">REV {document.revision} · {formatDate(document.updated_at)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="persistence-detail-panel">
          <section className="persistence-card persistence-current-card">
            <div className="persistence-card-header">
              <div>
                <div className="feature-eyebrow">CURRENT DOCUMENT</div>
                <h3>{activeDocument?.name ?? "Select a document"}</h3>
              </div>
              {activeDocument && <span className="persistence-revision-chip">REV {activeDocument.revision}</span>}
            </div>
            {activeDocument ? (
              <>
                <p className="persistence-document-id">{activeDocument.id}</p>
                <div className="persistence-action-row">
                  <button
                    className="persistence-button"
                    disabled={busy || !props.active_draft}
                    onClick={handleSave}
                    type="button"
                  >
                    Save revision
                  </button>
                  <button
                    className="persistence-button persistence-button-secondary"
                    disabled={busy}
                    onClick={() => void perform("Export prepared as a JSON file.", () => props.onExport(activeDocument.id))}
                    type="button"
                  >
                    Export document
                  </button>
                  <button
                    className="persistence-button persistence-button-danger"
                    disabled={busy}
                    onClick={handleDelete}
                    type="button"
                  >
                    Delete document
                  </button>
                </div>
              </>
            ) : (
              <p className="persistence-empty">Choose a saved document or import a JSON export.</p>
            )}
          </section>

          <section className="persistence-card">
            <div className="persistence-card-header">
              <div>
                <div className="feature-eyebrow">IMMUTABLE HISTORY</div>
                <h3>Revisions</h3>
              </div>
              <span className="persistence-count">{orderedRevisions.length} saved</span>
            </div>
            {orderedRevisions.length === 0 ? (
              <p className="persistence-empty">Select a document to view its revision history.</p>
            ) : (
              <div className="persistence-revision-list">
                {orderedRevisions.map((revision) => (
                  <div className={`persistence-revision${revision.revision === selectedRevision ? " is-selected" : ""}`} key={revision.revision}>
                    <button
                      aria-pressed={revision.revision === selectedRevision}
                      className="persistence-revision-select"
                      disabled={busy}
                      onClick={() => setRevisionToRestore(revision.revision)}
                      type="button"
                    >
                      <strong>Revision {revision.revision}</strong>
                      <span>{formatDate(revision.saved_at)}</span>
                    </button>
                    <button
                      aria-label={`Restore revision ${revision.revision}`}
                      className="persistence-text-button"
                      disabled={busy || revision.revision === activeDocument?.revision}
                      onClick={() => void perform(`Revision ${revision.revision} restored as a new revision.`, async () => {
                        await props.onRestoreRevision(props.selected_document_id!, revision.revision);
                        setRevisionToRestore(null);
                      })}
                      type="button"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            {orderedRevisions.length > 1 && (
              <div className="persistence-compare">
                <label>
                  Before
                  <select onChange={(event) => setBeforeRevision(event.currentTarget.value)} value={beforeRevision}>
                    <option value="">Choose revision</option>
                    {orderedRevisions.map((revision) => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}
                  </select>
                </label>
                <label>
                  After
                  <select onChange={(event) => setAfterRevision(event.currentTarget.value)} value={afterRevision}>
                    <option value="">Choose revision</option>
                    {orderedRevisions.map((revision) => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}
                  </select>
                </label>
                <button className="persistence-button persistence-button-secondary" disabled={busy} onClick={handleCompare} type="button">
                  Compare
                </button>
              </div>
            )}
          </section>

          {props.diff && (
            <section className="persistence-card persistence-diff-card" aria-live="polite">
              <div className="persistence-card-header">
                <div>
                  <div className="feature-eyebrow">REVISION COMPARISON</div>
                  <h3>Changes</h3>
                </div>
                <span className="persistence-count">{props.diff.length} fields</span>
              </div>
              {props.diff.length === 0 ? (
                <p className="persistence-empty">These revisions have identical document contents.</p>
              ) : (
                <div className="persistence-diff-list">
                  {props.diff.map((entry) => (
                    <article className="persistence-diff-entry" key={entry.path}>
                      <code>{entry.path}</code>
                      <div className="persistence-diff-values">
                        <pre>{prettyValue(entry.before, entry.before_present)}</pre>
                        <pre>{prettyValue(entry.after, entry.after_present)}</pre>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

