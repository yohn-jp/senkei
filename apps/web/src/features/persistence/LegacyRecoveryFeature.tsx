import { useEffect, useState, type ChangeEvent } from "react";
import type {
  LocalSenkeiDocument,
  LocalSenkeiDocumentSummary,
  LocalSenkeiRevisionSummary,
  SenkeiDocumentDiffEntry,
} from "../../contracts/workspace";
import {
  compareDocumentRevisions,
  deleteDocument,
  exportDocumentJson,
  exportOriginalDocumentRecords,
  importDocumentFile,
  listDocumentHistory,
  listDocuments,
  loadDocumentRevision,
  restoreDocumentRevision,
} from "./repository";
import "./persistence.css";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function prettyValue(value: unknown, present: boolean): string {
  if (!present) return "(not present)";
  return JSON.stringify(value, null, 2) ?? "null";
}

export function LegacyRecoveryFeature() {
  const [documents, setDocuments] = useState<readonly LocalSenkeiDocumentSummary[]>([]);
  const [activeDocument, setActiveDocument] = useState<LocalSenkeiDocument | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly LocalSenkeiRevisionSummary[]>([]);
  const [diff, setDiff] = useState<readonly SenkeiDocumentDiffEntry[] | null>(null);
  const [beforeRevision, setBeforeRevision] = useState("");
  const [afterRevision, setAfterRevision] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshDocuments = async (): Promise<void> => setDocuments(await listDocuments());
  const loadSelected = async (documentId: string): Promise<void> => {
    // Selecting a stored record must not depend on interpreting an unsupported legacy schema.
    setSelectedDocumentId(documentId);
    setActiveDocument(null); setHistory([]); setDiff(null);
    const [snapshot, revisions] = await Promise.all([
      loadDocumentRevision(documentId),
      listDocumentHistory(documentId),
    ]);
    setActiveDocument(snapshot.document);
    setHistory(revisions);
    setDiff(null);
  };

  useEffect(() => {
    let current = true;
    void listDocuments().then((items) => {
      if (current) setDocuments(items);
    }).catch((caught: unknown) => {
      if (current) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { current = false; };
  }, []);

  const perform = async (message: string, action: () => Promise<void>): Promise<void> => {
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

  const handleImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busy) return;
    void perform(`Imported ${file.name}.`, async () => {
      const document = await importDocumentFile(file);
      await refreshDocuments();
      await loadSelected(document.id);
    });
  };

  const handleExport = (): void => {
    if (!selectedDocumentId) return;
    void perform("A complete JSON export with revision history was downloaded.", async () => {
      const json = await exportDocumentJson(selectedDocumentId);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `senkei-${selectedDocumentId}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  };

  const handleExportRaw = (): void => {
    if (!selectedDocumentId) return;
    void perform("Original stored records were exported without schema conversion.", async () => {
      const json = await exportOriginalDocumentRecords(selectedDocumentId);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = window.document.createElement("a");
      link.href = url; link.download = `senkei-${selectedDocumentId}-raw-records.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  };

  const handleDelete = (): void => {
    if (!selectedDocumentId) return;
    const selected = documents.find((document) => document.id === selectedDocumentId);
    if (!window.confirm(`Delete “${selected?.name ?? "this document"}” and its complete local revision history?`)) return;
    void perform("The local document and revision history were deleted.", async () => {
      await deleteDocument(selectedDocumentId);
      await refreshDocuments();
      setSelectedDocumentId(null);
      setActiveDocument(null);
      setHistory([]);
      setDiff(null);
    });
  };

  const handleRestore = (revision: number): void => {
    if (!selectedDocumentId) return;
    void perform(`Revision ${revision} was restored as a new revision.`, async () => {
      await restoreDocumentRevision(selectedDocumentId, revision);
      await refreshDocuments();
      await loadSelected(selectedDocumentId);
    });
  };

  const handleCompare = (): void => {
    const before = Number(beforeRevision);
    const after = Number(afterRevision);
    if (!selectedDocumentId || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)) {
      setError("Choose two revisions to compare.");
      return;
    }
    void perform("Revision comparison updated.", async () => {
      setDiff(await compareDocumentRevisions(selectedDocumentId, before, after));
    });
  };

  const revisions = history.filter((entry) => entry.document_id === selectedDocumentId)
    .sort((left, right) => right.revision - left.revision);

  return (
    <section className="persistence-feature" aria-label="Legacy document recovery">
      <div className="persistence-toolbar">
        <div>
          <div className="feature-eyebrow">LOCAL DATA · INDEXEDDB</div>
          <h2>Legacy documents</h2>
          <p>These saved strategies remain in their original format. Next does not run or convert them. Export a complete copy before deleting data.</p>
        </div>
        <label className="persistence-button persistence-button-secondary persistence-import">
          Import legacy export
          <input accept="application/json,.json" aria-label="Import legacy JSON export" onChange={handleImport} type="file" />
        </label>
      </div>

      {(error || notice) && <div className={`persistence-message${error ? " is-error" : " is-success"}`} role={error ? "alert" : "status"}>{error ?? notice}</div>}

      <div className="persistence-layout">
        <aside className="persistence-list-panel" aria-label="Legacy documents">
          <div className="persistence-list-heading"><span>DOCUMENTS</span><span>{documents.length.toString().padStart(2, "0")}</span></div>
          <div className="persistence-document-list">
            {documents.length === 0 ? <p className="persistence-empty">No legacy documents found.</p> : documents.map((document) => (
              <button aria-current={document.id === selectedDocumentId ? "true" : undefined} aria-label={`Open ${document.name}`} className={`persistence-document${document.id === selectedDocumentId ? " is-selected" : ""}`} disabled={busy} key={document.id} onClick={() => void perform(`Opened ${document.name}.`, () => loadSelected(document.id))} type="button">
                <span className="persistence-document-name">{document.name}</span>
                <span className="persistence-document-meta">REV {document.revision} · {formatDate(document.updated_at)}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="persistence-detail-panel">
          <section className="persistence-card persistence-current-card">
            <div className="persistence-card-header">
              <div><div className="feature-eyebrow">PRESERVED DOCUMENT</div><h3>{activeDocument?.name ?? documents.find(item => item.id === selectedDocumentId)?.name ?? "Select or import a document"}</h3></div>
              {activeDocument && <span className="persistence-revision-chip">REV {activeDocument.revision}</span>}
            </div>
            {selectedDocumentId ? <>
              <p className="persistence-document-id">{selectedDocumentId}</p>
              <p>{activeDocument ? "This format is not runnable in the Next workspace. Export keeps its payload and every saved revision intact."
                : "This stored record cannot be interpreted by the current application. You can still export the original records before considering deletion."}</p>
              <div className="persistence-action-row">
                {activeDocument && <button className="persistence-button" disabled={busy} onClick={handleExport} type="button">Export complete history</button>}
                <button className="persistence-button persistence-button-secondary" disabled={busy} onClick={handleExportRaw} type="button">Export original records (recovery only)</button>
                <button className="persistence-button persistence-button-danger" disabled={busy} onClick={handleDelete} type="button">Delete local data</button>
              </div>
              <p>Original-record exports preserve IndexedDB JSON values, are not converted, and cannot be imported as a standard workspace bundle.</p>
            </> : <p className="persistence-empty">Choose a saved document or import a legacy JSON export.</p>}
          </section>

          <section className="persistence-card">
            <div className="persistence-card-header"><div><div className="feature-eyebrow">IMMUTABLE HISTORY</div><h3>Revisions</h3></div><span className="persistence-count">{revisions.length} saved</span></div>
            {revisions.length === 0 ? <p className="persistence-empty">Select a document to inspect its saved revisions.</p> : <div className="persistence-revision-list">
              {revisions.map((revision) => <div className="persistence-revision" key={revision.revision}>
                <div className="persistence-revision-select"><strong>Revision {revision.revision}</strong><span>{formatDate(revision.saved_at)}</span></div>
                <button aria-label={`Restore revision ${revision.revision}`} className="persistence-text-button" disabled={busy || revision.revision === activeDocument?.revision} onClick={() => handleRestore(revision.revision)} type="button">Restore</button>
              </div>)}
            </div>}
            {revisions.length > 1 && <div className="persistence-compare">
              <label>Before<select onChange={(event) => setBeforeRevision(event.currentTarget.value)} value={beforeRevision}><option value="">Choose revision</option>{revisions.map((revision) => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label>
              <label>After<select onChange={(event) => setAfterRevision(event.currentTarget.value)} value={afterRevision}><option value="">Choose revision</option>{revisions.map((revision) => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label>
              <button className="persistence-button persistence-button-secondary" disabled={busy} onClick={handleCompare} type="button">Compare</button>
            </div>}
          </section>

          {diff && <section className="persistence-card persistence-diff-card" aria-live="polite">
            <div className="persistence-card-header"><div><div className="feature-eyebrow">REVISION COMPARISON</div><h3>Changes</h3></div><span className="persistence-count">{diff.length} fields</span></div>
            {diff.length === 0 ? <p className="persistence-empty">These revisions have identical document contents.</p> : <div className="persistence-diff-list">{diff.map((entry) => <article className="persistence-diff-entry" key={entry.path}><code>{entry.path}</code><div className="persistence-diff-values"><pre>{prettyValue(entry.before, entry.before_present)}</pre><pre>{prettyValue(entry.after, entry.after_present)}</pre></div></article>)}</div>}
          </section>}
        </div>
      </div>
    </section>
  );
}
