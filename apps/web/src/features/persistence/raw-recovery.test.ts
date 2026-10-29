import { expect, it, vi } from "vitest";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { exportOriginalDocumentRecords, listDocuments, loadDocumentRevision } from "./repository";

it("exports the original IndexedDB records when an unsupported legacy version cannot load", async () => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("senkei-local-workspace", 2);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("documents", { keyPath: "id" });
      const revisions = request.result.createObjectStore("revisions", { keyPath: ["document_id", "revision"] });
      revisions.createIndex("by_document_id", "document_id", { unique: false });
      request.result.createObjectStore("next_experiments", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const storedDocument = { id: "old-one", document: {
    format: "senkei.local-document", document_version: 99, id: "old-one", name: "Old strategy",
    revision: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    payload: { obsolete: "keep bytes" },
  }, workspace_data: { bundle_version: 99 } };
  const storedRevision = { ...storedDocument, document_id: "old-one", revision: 1, saved_at: "2026-01-01T00:00:00Z" };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["documents", "revisions"], "readwrite");
    tx.objectStore("documents").put(storedDocument);
    tx.objectStore("revisions").put(storedRevision);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  try {
    expect((await listDocuments()).find(item => item.id === "old-one")?.name).toBe("Old strategy");
    await expect(loadDocumentRevision("old-one")).rejects.toThrow("not supported");
    const raw = JSON.parse(await exportOriginalDocumentRecords("old-one")) as {
      format: string; document_record: unknown; revision_records: unknown[];
    };
    expect(raw.format).toBe("senkei.raw-local-records");
    expect(raw.document_record).toEqual(storedDocument);
    expect(raw.revision_records).toEqual([storedRevision]);
  } finally { vi.unstubAllGlobals(); }
});
