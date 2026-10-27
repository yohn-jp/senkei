/** A producer must be explicitly configured before any official operation is possible. */
export const officialProducer = { kind: "not-configured" } as const;

export interface OfficialIdentity {
  readonly operationId: string;
  readonly requestId: string;
  readonly playerId: string;
  readonly authorityId: string;
}
export interface CommitResult {
  readonly resultId: string;
  readonly acquisitionIds: readonly string[];
  readonly settlementIds: readonly string[];
  /** Opaque producer evidence; storage of this value does not authenticate it. */
  readonly evidence: string;
}
export type OfficialTransaction = OfficialIdentity & (
  | { readonly status: "submitted" }
  | { readonly status: "outcome_unknown" }
  | { readonly status: "pending" | "rejected"; readonly evidence: string }
  | ({ readonly status: "committed" } & CommitResult)
);
export type OfficialResponse = OfficialIdentity & (
  | { readonly status: "outcome_unknown" }
  | { readonly status: "pending" | "rejected"; readonly evidence: string }
  | ({ readonly status: "committed" } & CommitResult)
);
/** Implementations must authenticate the producer and return the claims established by its evidence.
 * No verifier is supplied by the application until an official authority is chosen. */
export interface OfficialEvidenceVerifier {
  verify(response: OfficialResponse): Promise<OfficialResponse>;
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}
function checkIdentity(value: OfficialIdentity): void {
  if (!value || !id(value.operationId) || !id(value.requestId) || !id(value.playerId) || !id(value.authorityId) || value.authorityId.toLowerCase() === "local") throw new Error("Invalid official identity");
}
function sameIdentity(a: OfficialIdentity, b: OfficialIdentity): boolean {
  return a.operationId === b.operationId && a.requestId === b.requestId && a.playerId === b.playerId && a.authorityId === b.authorityId;
}
function checkResponse(value: OfficialResponse): void {
  checkIdentity(value);
  if (!["pending", "rejected", "outcome_unknown", "committed"].includes(value.status)) throw new Error("Invalid response status");
  if ((value.status === "pending" || value.status === "rejected") && !id(value.evidence)) throw new Error("Invalid response evidence");
  if (value.status === "committed") {
    if (!id(value.resultId) || !id(value.evidence) || !Array.isArray(value.acquisitionIds) || !Array.isArray(value.settlementIds) || !value.acquisitionIds.every(id) || !value.settlementIds.every(id)) throw new Error("Invalid commit evidence");
    const all = [value.resultId, ...value.acquisitionIds, ...value.settlementIds];
    if (new Set(all).size !== all.length) throw new Error("Result, acquisition and settlement identities must be distinct");
  }
}
function sameResponse(a: OfficialResponse, b: OfficialResponse): boolean {
  if (!sameIdentity(a, b) || a.status !== b.status) return false;
  if ((a.status === "pending" || a.status === "rejected") && (b.status === "pending" || b.status === "rejected")) return a.evidence === b.evidence;
  if (a.status !== "committed" || b.status !== "committed") return true;
  return a.resultId === b.resultId && a.evidence === b.evidence && JSON.stringify(a.acquisitionIds) === JSON.stringify(b.acquisitionIds) && JSON.stringify(a.settlementIds) === JSON.stringify(b.settlementIds);
}
export function createOfficialTransaction(identity: OfficialIdentity): OfficialTransaction {
  checkIdentity(identity);
  return { operationId: identity.operationId, requestId: identity.requestId, playerId: identity.playerId, authorityId: identity.authorityId, status: "submitted" };
}
export function inquiryFor(transaction: OfficialTransaction): OfficialIdentity {
  checkIdentity(transaction);
  if (transaction.status !== "outcome_unknown" && transaction.status !== "pending") throw new Error("Inquiry requires a pending or unknown outcome");
  const { operationId, requestId, playerId, authorityId } = transaction;
  return { operationId, requestId, playerId, authorityId };
}
export async function applyOfficialResponse(current: OfficialTransaction, response: OfficialResponse, verifier?: OfficialEvidenceVerifier): Promise<OfficialTransaction> {
  checkIdentity(current);
  checkResponse(response);
  if (!sameIdentity(current, response)) throw new Error("Official response identity mismatch");
  if (current.status === "committed" || current.status === "rejected") {
    if (!sameResponse(current, response)) throw new Error("Conflicting terminal response");
  }
  if (response.status !== "outcome_unknown") {
    if (!verifier) throw new Error("Official evidence verifier not configured");
    const verified = await verifier.verify(response);
    checkResponse(verified);
    if (!sameResponse(response, verified)) throw new Error("Evidence claims mismatch");
  }
  if ((current.status === "committed" || current.status === "rejected") && sameResponse(current, response)) return current;
  return structuredClone(response);
}

/** Durable, untrusted local evidence cache. Reading a record never establishes authority. */
export class OfficialTransactionEvidenceStore {
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly databaseName = "senkei-official-transaction-evidence") {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("transactions", { keyPath: "requestId" });
        store.createIndex("operationId", "operationId", { unique: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Evidence database blocked"));
    });
  }
  async get(requestId: string): Promise<OfficialTransaction | undefined> {
    if (!id(requestId)) throw new Error("Invalid request identity");
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("transactions", "readonly");
        const request = tx.objectStore("transactions").get(requestId);
        request.onsuccess = () => resolve(request.result as OfficialTransaction | undefined);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  /** Atomic compare-and-set prevents a second tab from overwriting a newer outcome. */
  async put(next: OfficialTransaction, expected?: OfficialTransaction): Promise<void> {
    checkIdentity(next);
    if (next.status !== "submitted") checkResponse(next);
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("transactions", "readwrite");
        const store = tx.objectStore("transactions");
        const request = store.get(next.requestId);
        let conflict = false;
        request.onsuccess = () => {
          const previous = request.result as OfficialTransaction | undefined;
          if (JSON.stringify(previous) !== JSON.stringify(expected) || (previous && !sameIdentity(previous, next))) { conflict = true; tx.abort(); return; }
          store.put(structuredClone(next));
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(conflict ? new Error("Evidence record conflict") : tx.error ?? new Error("Evidence transaction aborted"));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
}
