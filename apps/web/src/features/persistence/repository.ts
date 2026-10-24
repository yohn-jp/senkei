import type { CoreJsonValue } from "../../contracts/core";
import type {
  LocalSenkeiDocument,
  LocalSenkeiDocumentSummary,
  LocalSenkeiRevisionSummary,
  SenkeiDraft,
  SenkeiDocumentDiffEntry,
} from "../../contracts/workspace";
import type {
  LocalSenkeiExportBundle,
  LocalSenkeiHistoryRevision,
  LocalSenkeiWorkspaceData,
} from "../../contracts/workspace-data";
export type {
  LocalSenkeiExportBundle,
  LocalSenkeiHistoryRevision,
  LocalSenkeiWorkspaceData,
} from "../../contracts/workspace-data";

interface StoredDocumentRecord extends LocalSenkeiHistoryRevision {
  readonly id: string;
}

interface StoredRevisionRecord extends LocalSenkeiHistoryRevision {
  readonly document_id: string;
  readonly revision: number;
  readonly saved_at: string;
}

const DATABASE_NAME = "senkei-local-workspace";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const REVISION_STORE = "revisions";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 100;
const MAX_JSON_NODES = 250_000;
const MAX_NAME_BYTES = 256;
const MAX_DIFF_ENTRIES = 2_000;

export class PersistenceError extends Error {
  readonly code: "unavailable" | "storage" | "invalid_data" | "unsupported_version" | "too_large" | "conflict" | "not_found";

  constructor(
    code: PersistenceError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

const EMPTY_WORKSPACE_DATA: LocalSenkeiWorkspaceData = Object.freeze({
  bundle_version: 1,
  compiled_program: null,
  compilation: null,
  rulesets: Object.freeze([]),
  component_versions: null,
  scenarios: Object.freeze([]),
  simulation_snapshots: Object.freeze([]),
  simulation_scenario_ids: Object.freeze([]),
  baseline_scenario_id: null,
  simulation_outcomes: Object.freeze([]),
  benchmark: null,
  benchmark_history: Object.freeze([]),
  extensions: Object.freeze({}),
});

let databasePromise: Promise<IDBDatabase> | null = null;
const transactionErrors = new WeakMap<IDBTransaction, unknown>();

function abortTransaction(transaction: IDBTransaction, error: unknown): void {
  transactionErrors.set(transaction, error);
  try {
    transaction.abort();
  } catch {
    // A completed or already aborted transaction has nothing to cancel.
  }
}

function persistenceError(error: unknown, action: string): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") {
    return new PersistenceError(
      "storage",
      `${action}: This browser's local storage is full. Export documents you want to keep, then remove unused local documents or free browser storage.`,
      { cause: error },
    );
  }
  if (name === "SecurityError" || name === "InvalidStateError") {
    return new PersistenceError(
      "unavailable",
      `${action}: The browser blocked IndexedDB. Check this site's storage permissions and try again.`,
      { cause: error },
    );
  }
  if (name === "VersionError") {
    return new PersistenceError(
      "unsupported_version",
      `${action}: This local library was created by a newer Senkei version. Update the application before opening it.`,
      { cause: error },
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PersistenceError("storage", `${action}: ${detail}`, { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new PersistenceError("unavailable", "IndexedDB is unavailable in this browser context."),
    );
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(persistenceError(error, "Could not open the local library"));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(REVISION_STORE)) {
        const revisions = database.createObjectStore(REVISION_STORE, {
          keyPath: ["document_id", "revision"],
        });
        revisions.createIndex("by_document_id", "document_id", { unique: false });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(persistenceError(request.error, "Could not open the local library"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(
        new PersistenceError(
          "storage",
          "The local library is blocked by another open tab. Close the other Senkei tab and try again.",
        ),
      );
    };
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

function withTransaction<T>(
  stores: string | readonly string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction, setResult: (value: T) => void) => void,
  action: string,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        let transaction: IDBTransaction;
        let value: T;
        let hasValue = false;
        try {
          transaction = database.transaction(stores as string | string[], mode);
        } catch (error) {
          reject(persistenceError(error, action));
          return;
        }

        transaction.oncomplete = () => {
          if (!hasValue) {
            reject(new PersistenceError("storage", `${action}: IndexedDB completed without a result.`));
            return;
          }
          resolve(value);
        };
        transaction.onerror = () => reject(persistenceError(transactionErrors.get(transaction) ?? transaction.error, action));
        transaction.onabort = () => reject(persistenceError(transactionErrors.get(transaction) ?? transaction.error ?? new Error("transaction aborted"), action));

        try {
          run(transaction, (result) => {
            value = result;
            hasValue = true;
          });
        } catch (error) {
          abortTransaction(transaction, error);
        }
      }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertJsonValue(value: unknown, label: string): asserts value is CoreJsonValue {
  let nodes = 0;
  const visit = (node: unknown, depth: number, path: string): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new PersistenceError("too_large", `${label} has too many JSON values.`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new PersistenceError("too_large", `${label} is nested too deeply.`);
    }
    if (
      node === null ||
      typeof node === "boolean" ||
      typeof node === "string"
    ) {
      return;
    }
    if (typeof node === "number") {
      if (!Number.isSafeInteger(node) || Object.is(node, -0)) {
        throw new PersistenceError("invalid_data", `${label}${path} contains a number that cannot round-trip through the supported core JSON model.`);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const key of Reflect.ownKeys(node)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length) {
          throw new PersistenceError("invalid_data", `${label}${path} contains non-JSON array properties.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new PersistenceError("invalid_data", `${label}${path}[${key}] is not a JSON data property.`);
        }
      }
      for (let index = 0; index < node.length; index += 1) {
        if (!(index in node)) {
          throw new PersistenceError("invalid_data", `${label}${path} contains a sparse array.`);
        }
        visit(node[index], depth + 1, `${path}[${index}]`);
      }
      return;
    }
    if (isRecord(node)) {
      if (Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null) {
        throw new PersistenceError("invalid_data", `${label}${path} contains a non-JSON object.`);
      }
      for (const key of Reflect.ownKeys(node)) {
        if (typeof key !== "string") {
          throw new PersistenceError("invalid_data", `${label}${path} contains a non-JSON symbol key.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new PersistenceError("invalid_data", `${label}${path}.${key} is not a JSON data property.`);
        }
        visit(descriptor.value, depth + 1, `${path}.${key}`);
      }
      return;
    }
    throw new PersistenceError("invalid_data", `${label}${path} is not JSON-compatible.`);
  };
  visit(value, 0, "");
}

function cloneJson<T>(value: T, label: string): T {
  assertJsonValue(value, label);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > MAX_JSON_BYTES) {
    throw new PersistenceError("too_large", `${label} exceeds the 8 MiB local document limit.`);
  }
  return JSON.parse(serialized) as T;
}

function assertVersion(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new PersistenceError("invalid_data", `${label} must be a valid version triple.`);
  }
  const { major, minor, patch } = value;
  if (
    typeof major !== "number" || !Number.isSafeInteger(major) || major < 0 ||
    typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0 ||
    typeof patch !== "number" || !Number.isSafeInteger(patch) || patch < 0
  ) {
    throw new PersistenceError("invalid_data", `${label} must be a valid version triple.`);
  }
}

function assertSupportedSchemaVersion(value: unknown, label: string): void {
  assertVersion(value, label);
  if (!isRecord(value) || value.major !== 1 || value.minor !== 0 || value.patch !== 0) {
    throw new PersistenceError("unsupported_version", `${label} ${isRecord(value) ? `${value.major}.${value.minor}.${value.patch}` : ""} is not supported.`);
  }
}

function assertDomainValue(value: unknown, path: string): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new PersistenceError("invalid_data", `${path} is not a tagged DomainValue.`);
  }
  switch (value.kind) {
    case "null":
      return;
    case "bool":
      if (typeof value.value !== "boolean") break;
      return;
    case "integer":
      if (typeof value.value !== "number" || !Number.isSafeInteger(value.value)) break;
      return;
    case "fixed":
      if (
        !isRecord(value.value) ||
        typeof value.value.coefficient !== "number" || !Number.isSafeInteger(value.value.coefficient) ||
        typeof value.value.scale !== "number" || !Number.isSafeInteger(value.value.scale) || value.value.scale < 0
      ) break;
      return;
    case "string":
    case "enum":
    case "entity":
      if (typeof value.value !== "string") break;
      return;
    case "list":
      if (!Array.isArray(value.value)) break;
      value.value.forEach((child, index) => assertDomainValue(child, `${path}[${index}]`));
      return;
    case "record":
      if (!isRecord(value.value)) break;
      for (const [key, child] of Object.entries(value.value)) assertDomainValue(child, `${path}.${key}`);
      return;
    default:
      throw new PersistenceError("unsupported_version", `${path} uses unsupported DomainValue kind ${value.kind}.`);
  }
  throw new PersistenceError("invalid_data", `${path} is malformed for DomainValue kind ${value.kind}.`);
}

function assertDomainRecord(value: Record<string, unknown>, path: string): void {
  for (const [key, child] of Object.entries(value)) assertDomainValue(child, `${path}.${key}`);
}

function assertSimulationSnapshot(value: unknown, path: string): void {
  if (!isRecord(value) || !isRecord(value.attacker) || !isRecord(value.defender) || !isRecord(value.context)) {
    throw new PersistenceError("invalid_data", `${path} must contain attacker, defender, and context snapshots.`);
  }
  assertSenkeiSnapshot(value.attacker, `${path}.attacker`);
  assertSenkeiSnapshot(value.defender, `${path}.defender`);
  assertMatchContext(value.context, `${path}.context`);
}

function assertSimulationOutcome(value: unknown, path: string): void {
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.presentation_replay)) {
    throw new PersistenceError("invalid_data", `${path} must contain a public result and presentation replay.`);
  }
  const result = value.result;
  if (
    typeof result.match_id !== "string" ||
    !["attacker_victory", "defender_victory", "draw", "aborted"].includes(String(result.outcome)) ||
    typeof result.termination_reason !== "string" ||
    typeof result.final_tick !== "number" || !Number.isSafeInteger(result.final_tick) || result.final_tick < 0 ||
    !isRecord(result.statistics) ||
    !isRecord(result.cu_spent) ||
    typeof result.final_state_digest !== "string" || !/^[0-9a-f]{64}$/.test(result.final_state_digest)
  ) {
    throw new PersistenceError("invalid_data", `${path}.result is malformed.`);
  }
  assertDomainRecord(result.statistics, `${path}.result.statistics`);
  for (const side of ["attacker", "defender"]) {
    const cu = result.cu_spent[side];
    if (typeof cu !== "number" || !Number.isSafeInteger(cu) || cu < 0) {
      throw new PersistenceError("invalid_data", `${path}.result.cu_spent.${side} is invalid.`);
    }
  }
  const replay = value.presentation_replay;
  if (
    typeof replay.match_id !== "string" ||
    typeof replay.result_digest !== "string" || !/^[0-9a-f]{64}$/.test(replay.result_digest) ||
    !Array.isArray(replay.frames)
  ) {
    throw new PersistenceError("invalid_data", `${path}.presentation_replay is malformed.`);
  }
  assertSupportedSchemaVersion(replay.schema_version, `${path}.presentation_replay.schema_version`);
  replay.frames.forEach((frame, index) => {
    if (
      !isRecord(frame) ||
      typeof frame.tick !== "number" || !Number.isSafeInteger(frame.tick) || frame.tick < 0 ||
      !Array.isArray(frame.events)
    ) {
      throw new PersistenceError("invalid_data", `${path}.presentation_replay.frames[${index}] is malformed.`);
    }
    frame.events.forEach((event, eventIndex) => {
      if (
        !isRecord(event) ||
        typeof event.event !== "string" ||
        (event.entity !== null && typeof event.entity !== "string") ||
        !isRecord(event.payload)
      ) {
        throw new PersistenceError("invalid_data", `${path}.presentation_replay.frames[${index}].events[${eventIndex}] is malformed.`);
      }
      assertDomainRecord(event.payload, `${path}.presentation_replay.frames[${index}].events[${eventIndex}].payload`);
    });
  });
}

function assertSimulationResponse(value: unknown, path: string): void {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", `${path} is malformed.`);
  assertSimulationOutcome(value.outcome, `${path}.outcome`);
  if (value.restricted_diagnostics !== undefined && !isRecord(value.restricted_diagnostics)) {
    throw new PersistenceError("invalid_data", `${path}.restricted_diagnostics is malformed.`);
  }
}

function assertBenchmarkOutcome(value: unknown, path: string): void {
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    throw new PersistenceError("invalid_data", `${path} must contain benchmark cases.`);
  }
  value.cases.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.case_id !== "string") {
      throw new PersistenceError("invalid_data", `${path}.cases[${index}] is malformed.`);
    }
    if (entry.case_role !== undefined && entry.case_role !== "before" && entry.case_role !== "current") {
      throw new PersistenceError("invalid_data", `${path}.cases[${index}].case_role is unsupported.`);
    }
    assertSimulationOutcome(entry.outcome, `${path}.cases[${index}].outcome`);
  });
}

function assertRulesetRef(value: unknown, path: string): void {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) {
    throw new PersistenceError("invalid_data", `${path} is a malformed ruleset reference.`);
  }
  assertVersion(value.version, `${path}.version`);
}

function assertComponentVersions(value: unknown, path: string): void {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", `${path} is malformed.`);
  for (const key of ["model", "engine", "ruleset", "jinrei_language", "structured_ast", "typed_ir", "bytecode", "cost_schedule", "replay_schema"]) {
    assertVersion(value[key], `${path}.${key}`);
  }
}

function assertWorldState(value: unknown, path: string): void {
  if (!isRecord(value) || !isRecord(value.entities) || !isRecord(value.global_fields) || !isRecord(value.collections)) {
    throw new PersistenceError("invalid_data", `${path} is malformed.`);
  }
  assertDomainRecord(value.global_fields, `${path}.global_fields`);
  for (const [collectionId, values] of Object.entries(value.collections)) {
    if (!Array.isArray(values)) {
      throw new PersistenceError("invalid_data", `${path}.collections.${collectionId} must be an array.`);
    }
    values.forEach((item, index) => assertDomainValue(item, `${path}.collections.${collectionId}[${index}]`));
  }
  for (const [entityId, entity] of Object.entries(value.entities)) {
    if (
      !isRecord(entity) ||
      typeof entity.entity_type !== "string" ||
      (entity.owner !== null && entity.owner !== "attacker" && entity.owner !== "defender") ||
      !isRecord(entity.fields)
    ) {
      throw new PersistenceError("invalid_data", `${path}.entities.${entityId} is malformed.`);
    }
    assertDomainRecord(entity.fields, `${path}.entities.${entityId}.fields`);
  }
}

function assertHostLimits(value: unknown, path: string): void {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", `${path} is malformed.`);
  for (const key of ["max_input_bytes", "max_entities", "max_events", "max_diagnostic_events", "max_output_bytes"]) {
    const limit = value[key];
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0) {
      throw new PersistenceError("invalid_data", `${path}.${key} must be a non-negative safe integer.`);
    }
  }
}

function assertMatchContext(value: unknown, path: string): void {
  if (
    !isRecord(value) ||
    typeof value.match_id !== "string" ||
    typeof value.max_ticks !== "number" || !Number.isSafeInteger(value.max_ticks) || value.max_ticks < 0
  ) {
    throw new PersistenceError("invalid_data", `${path} is malformed.`);
  }
  assertSupportedSchemaVersion(value.schema_version, `${path}.schema_version`);
  assertRulesetRef(value.ruleset, `${path}.ruleset`);
  assertComponentVersions(value.versions, `${path}.versions`);
  assertWorldState(value.initial_world, `${path}.initial_world`);
  assertHostLimits(value.host_limits, `${path}.host_limits`);
}

function assertTacticalProgram(value: unknown, path: string): void {
  if (
    !isRecord(value) ||
    typeof value.cost_schedule_id !== "string" ||
    typeof value.content_digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.content_digest) ||
    !Array.isArray(value.bytecode)
  ) {
    throw new PersistenceError("invalid_data", `${path} is a malformed TacticalProgram.`);
  }
  assertVersion(value.language_version, `${path}.language_version`);
  assertVersion(value.ir_version, `${path}.ir_version`);
  assertVersion(value.bytecode_version, `${path}.bytecode_version`);
  assertVersion(value.cost_schedule_version, `${path}.cost_schedule_version`);
  assertRulesetRef(value.ruleset, `${path}.ruleset`);
  if (value.bytecode.some((byte) => typeof byte !== "number" || !Number.isSafeInteger(byte) || byte < 0 || byte > 255)) {
    throw new PersistenceError("invalid_data", `${path}.bytecode must contain unsigned bytes.`);
  }
}

function assertSenkeiSnapshot(value: unknown, path: string): void {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.revision !== "string" ||
    !isRecord(value.configuration) ||
    !isRecord(value.initial_memory)
  ) {
    throw new PersistenceError("invalid_data", `${path} is a malformed SenkeiSnapshot.`);
  }
  assertSupportedSchemaVersion(value.schema_version, `${path}.schema_version`);
  assertRulesetRef(value.ruleset, `${path}.ruleset`);
  assertTacticalProgram(value.program, `${path}.program`);
  assertDomainRecord(value.configuration, `${path}.configuration`);
  assertDomainRecord(value.initial_memory, `${path}.initial_memory`);
}

function assertRulePackage(value: unknown, path: string): void {
  if (!isRecord(value) || !isRecord(value.ruleset) || !isRecord(value.domain) || !isRecord(value.world)) {
    throw new PersistenceError("invalid_data", `${path} is not a complete ruleset package.`);
  }
  assertRulesetRef(value.ruleset, `${path}.ruleset`);
  for (const key of ["minimum_engine_version", "model_version", "primitive_set_version", "jinrei_language_version", "structured_ast_version", "typed_ir_version", "bytecode_version"]) {
    assertVersion(value[key], `${path}.${key}`);
  }
  if (!isRecord(value.domain.senkei_configuration) || !isRecord(value.world_initialization) || !isRecord(value.world.entity_types)) {
    throw new PersistenceError("invalid_data", `${path} is missing configuration, world initialization, or world schema records.`);
  }
}

function assertDraft(value: unknown): asserts value is SenkeiDraft {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", "Document payload must be an object.");
  if (typeof value.id !== "string" || !value.id || typeof value.revision !== "string" || !value.revision) {
    throw new PersistenceError("invalid_data", "Document payload is missing its Senkei identity.");
  }
  assertSupportedSchemaVersion(value.schema_version, "Document schema_version");
  if (
    !isRecord(value.ruleset) ||
    typeof value.ruleset.id !== "string" ||
    typeof value.ruleset.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.ruleset.digest)
  ) {
    throw new PersistenceError("invalid_data", "Document ruleset reference is malformed.");
  }
  assertVersion(value.ruleset.version, "Document ruleset version");
  if (!isRecord(value.configuration) || !isRecord(value.initial_memory)) {
    throw new PersistenceError("invalid_data", "Document configuration and initial memory must be records.");
  }
  assertDomainRecord(value.configuration, "Document configuration");
  assertDomainRecord(value.initial_memory, "Document initial_memory");
  if (!isRecord(value.program_input)) {
    throw new PersistenceError("invalid_data", "Document program_input must be an object.");
  }
  if (value.program_input.kind === "text") {
    if (typeof value.program_input.source !== "string") {
      throw new PersistenceError("invalid_data", "Text program_input must contain source text.");
    }
  } else if (value.program_input.kind === "structured_ast") {
    const ast = value.program_input.ast;
    if (!isRecord(ast)) throw new PersistenceError("invalid_data", "Structured program_input must contain an AST.");
    assertSupportedSchemaVersion(ast.schema_version, "Tactics AST schema_version");
    if (typeof ast.program_name !== "string" || !Array.isArray(ast.declarations)) {
      throw new PersistenceError("invalid_data", "Structured tactics AST is missing its program name or declarations.");
    }
  } else {
    throw new PersistenceError("unsupported_version", "Document program_input kind is not supported.");
  }
}

function assertDocument(value: unknown): asserts value is LocalSenkeiDocument {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", "Local document must be an object.");
  if (value.format !== "senkei.local-document") {
    throw new PersistenceError("unsupported_version", "This file is not a Senkei local document.");
  }
  if (value.document_version !== 1) {
    throw new PersistenceError("unsupported_version", `Local document version ${String(value.document_version)} is not supported.`);
  }
  if (
    typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128 ||
    typeof value.name !== "string" || utf8ByteLength(value.name) > MAX_NAME_BYTES || value.name.trim() === "" ||
    typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at)) ||
    typeof value.updated_at !== "string" || Number.isNaN(Date.parse(value.updated_at))
  ) {
    throw new PersistenceError("invalid_data", "Local document metadata is invalid.");
  }
  assertDraft(value.payload);
  cloneJson(value, "Local document");
}

function assertWorkspaceData(value: unknown): asserts value is LocalSenkeiWorkspaceData {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", "Workspace data must be an object.");
  if (value.bundle_version !== 1) {
    throw new PersistenceError("unsupported_version", `Workspace bundle version ${String(value.bundle_version)} is not supported.`);
  }
  for (const key of ["rulesets", "scenarios", "simulation_snapshots", "simulation_scenario_ids", "simulation_outcomes", "benchmark_history"]) {
    if (!Array.isArray(value[key])) throw new PersistenceError("invalid_data", `Workspace data ${key} must be an array.`);
  }
  const simulationSnapshots = value.simulation_snapshots as unknown[];
  const simulationScenarioIds = value.simulation_scenario_ids as unknown[];
  if (simulationScenarioIds.length !== simulationSnapshots.length) {
    throw new PersistenceError("invalid_data", "Workspace simulation scenario IDs must align with saved simulation snapshots.");
  }
  if (simulationScenarioIds.some((id) => id !== null && typeof id !== "string")) {
    throw new PersistenceError("invalid_data", "Workspace simulation scenario IDs must be strings or null.");
  }
  if (value.baseline_scenario_id !== null && typeof value.baseline_scenario_id !== "string") {
    throw new PersistenceError("invalid_data", "Workspace baseline scenario ID must be a string or null.");
  }
  (value.rulesets as unknown[]).forEach((item, index) => assertRulePackage(item, `Workspace rulesets[${index}]`));
  (value.simulation_snapshots as unknown[]).forEach((item, index) => assertSimulationSnapshot(item, `Workspace simulation_snapshots[${index}]`));
  (value.scenarios as unknown[]).forEach((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.campaign_id !== "string" ||
      typeof item.campaign_title !== "string" ||
      typeof item.order !== "number" || !Number.isSafeInteger(item.order) ||
      (item.difficulty !== "beginner" && item.difficulty !== "standard" && item.difficulty !== "expert") ||
      typeof item.title !== "string" ||
      typeof item.description !== "string" ||
      typeof item.objective !== "string" ||
      !Array.isArray(item.criteria) ||
      !isRecord(item.npc)
    ) {
      throw new PersistenceError("invalid_data", `Workspace scenarios[${index}] is malformed.`);
    }
    if (item.criteria.some((criterion) => !isRecord(criterion) || typeof criterion.id !== "string" || typeof criterion.label !== "string")) {
      throw new PersistenceError("invalid_data", `Workspace scenarios[${index}].criteria is malformed.`);
    }
    assertDraft(item.npc);
  });
  (value.simulation_outcomes as unknown[]).forEach((item, index) => {
    assertSimulationResponse(item, `Workspace simulation_outcomes[${index}]`);
  });
  (value.benchmark_history as unknown[]).forEach((item, index) => {
    assertBenchmarkOutcome(item, `Workspace benchmark_history[${index}]`);
  });
  if (value.compiled_program !== null && !isRecord(value.compiled_program)) {
    throw new PersistenceError("invalid_data", "Workspace compiled_program must be a core program or null.");
  }
  if (value.compiled_program !== null) assertTacticalProgram(value.compiled_program, "Workspace compiled_program");
  if (value.compilation !== null && !isRecord(value.compilation)) {
    throw new PersistenceError("invalid_data", "Workspace compilation must be a compile result or null.");
  }
  if (value.compilation !== null) {
    const compilation = value.compilation;
    if (
      !isRecord(compilation.ast) ||
      typeof compilation.estimated_cu !== "number" ||
      !Number.isSafeInteger(compilation.estimated_cu) ||
      compilation.estimated_cu < 0 ||
      !Array.isArray(compilation.diagnostics)
    ) {
      throw new PersistenceError("invalid_data", "Workspace compilation result is malformed.");
    }
    assertSupportedSchemaVersion(compilation.ast.schema_version, "Workspace compilation AST schema_version");
    assertTacticalProgram(compilation.program, "Workspace compilation program");
  }
  if (value.component_versions !== null && !isRecord(value.component_versions)) {
    throw new PersistenceError("invalid_data", "Workspace component_versions must be a version set or null.");
  }
  if (value.component_versions !== null) {
    assertComponentVersions(value.component_versions, "Workspace component_versions");
  }
  if (value.benchmark !== null && !isRecord(value.benchmark)) {
    throw new PersistenceError("invalid_data", "Workspace benchmark must be a benchmark result or null.");
  }
  if (value.benchmark !== null) assertBenchmarkOutcome(value.benchmark, "Workspace benchmark");
  assertJsonValue(value, "Workspace data");
  const encoded = JSON.stringify(value);
  if (encoded === undefined || utf8ByteLength(encoded) > MAX_JSON_BYTES) {
    throw new PersistenceError("too_large", "Workspace data exceeds the 8 MiB local document limit.");
  }
}

function assertHistoryRevision(value: unknown, documentId?: string): asserts value is LocalSenkeiHistoryRevision {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", "History revision must be an object.");
  assertDocument(value.document);
  assertWorkspaceData(value.workspace_data);
  if (documentId !== undefined && value.document.id !== documentId) {
    throw new PersistenceError("invalid_data", "History contains a different document id.");
  }
}

function normalizeWorkspaceData(
  value?: LocalSenkeiWorkspaceData | null,
): LocalSenkeiWorkspaceData {
  const copied = cloneJson(value ?? EMPTY_WORKSPACE_DATA, "Workspace data");
  assertWorkspaceData(copied);
  return copied;
}

function validateStoredDocument(value: unknown): StoredDocumentRecord {
  if (!isRecord(value)) throw new PersistenceError("invalid_data", "Stored document is not an object.");
  assertHistoryRevision(value);
  if (value.id !== value.document.id) {
    throw new PersistenceError("invalid_data", "Stored document index does not match its document id.");
  }
  return value as unknown as StoredDocumentRecord;
}

function validateStoredRevision(value: unknown): StoredRevisionRecord {
  if (!isRecord(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new PersistenceError("invalid_data", "Stored history revision is malformed.");
  }
  assertHistoryRevision(value, typeof value.document_id === "string" ? value.document_id : undefined);
  if (
    value.document_id !== value.document.id ||
    value.revision !== value.document.revision ||
    typeof value.saved_at !== "string" || Number.isNaN(Date.parse(value.saved_at))
  ) {
    throw new PersistenceError("invalid_data", "Stored history metadata does not match its snapshot.");
  }
  return value as unknown as StoredRevisionRecord;
}

function summaryFromStoredValue(value: unknown): LocalSenkeiDocumentSummary {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new PersistenceError("invalid_data", "A local library entry has corrupt document metadata.");
  }
  const document = isRecord(value.document) ? value.document : null;
  if (
    !document ||
    value.id !== document.id ||
    typeof document.name !== "string" ||
    utf8ByteLength(document.name) > MAX_NAME_BYTES ||
    typeof document.revision !== "number" || !Number.isSafeInteger(document.revision) || document.revision < 1 ||
    typeof document.updated_at !== "string" || Number.isNaN(Date.parse(document.updated_at))
  ) {
    // Keep an unreadable row visible so the user can remove its corrupt record.
    return {
      id: value.id,
      name: "Unreadable local document",
      revision: 0,
      updated_at: "1970-01-01T00:00:00.000Z",
    };
  }
  return {
    id: value.id,
    name: document.name,
    revision: document.revision,
    updated_at: document.updated_at,
  };
}

function uniqueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new PersistenceError("unavailable", "A secure browser UUID generator is required to create a document.");
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) throw new PersistenceError("invalid_data", "Enter a name for the document.");
  if (utf8ByteLength(normalized) > MAX_NAME_BYTES) {
    throw new PersistenceError("too_large", "Document names must be 256 UTF-8 bytes or less.");
  }
  return normalized;
}

function revisionRecord(snapshot: LocalSenkeiHistoryRevision): StoredRevisionRecord {
  return {
    document_id: snapshot.document.id,
    revision: snapshot.document.revision,
    saved_at: snapshot.document.updated_at,
    ...snapshot,
  };
}

export async function listDocuments(): Promise<readonly LocalSenkeiDocumentSummary[]> {
  try {
    return await withTransaction(
      DOCUMENT_STORE,
      "readonly",
      (transaction, setResult) => {
        const request = transaction.objectStore(DOCUMENT_STORE).getAll();
        request.onsuccess = () => {
          try {
            const summaries = request.result.map(summaryFromStoredValue);
            summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            setResult(summaries);
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not list saved documents",
    );
  } catch (error) {
    throw persistenceError(error, "Could not list saved documents");
  }
}

export async function createDocument(
  name: string,
  payload: SenkeiDraft,
  workspaceData?: LocalSenkeiWorkspaceData | null,
): Promise<LocalSenkeiDocument> {
  const timestamp = new Date().toISOString();
  const document: LocalSenkeiDocument = {
    format: "senkei.local-document",
    document_version: 1,
    id: uniqueId(),
    name: validateName(name),
    revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
    payload: cloneJson(payload, "Document payload"),
  };
  assertDocument(document);
  const snapshot: LocalSenkeiHistoryRevision = {
    document,
    workspace_data: normalizeWorkspaceData(workspaceData),
  };
  try {
    return await withTransaction(
      [DOCUMENT_STORE, REVISION_STORE],
      "readwrite",
      (transaction, setResult) => {
        transaction.objectStore(DOCUMENT_STORE).add({ id: document.id, ...snapshot } satisfies StoredDocumentRecord);
        transaction.objectStore(REVISION_STORE).add(revisionRecord(snapshot));
        setResult(document);
      },
      "Could not create the document",
    );
  } catch (error) {
    throw persistenceError(error, "Could not create the document");
  }
}

export async function saveDocument(
  submitted: LocalSenkeiDocument,
  workspaceData?: LocalSenkeiWorkspaceData | null,
): Promise<LocalSenkeiDocument> {
  assertDocument(submitted);
  const copied = cloneJson(submitted, "Document");
  const now = new Date().toISOString();
  try {
    return await withTransaction(
      [DOCUMENT_STORE, REVISION_STORE],
      "readwrite",
      (transaction, setResult) => {
        const documents = transaction.objectStore(DOCUMENT_STORE);
        const getRequest = documents.get(copied.id);
        getRequest.onsuccess = () => {
          try {
            if (getRequest.result === undefined) {
              throw new PersistenceError("not_found", "This document no longer exists in the local library.");
            }
            const current = validateStoredDocument(getRequest.result);
            if (copied.revision !== current.document.revision) {
              throw new PersistenceError(
                "conflict",
                `This document changed in another view (revision ${current.document.revision}). Reload it before saving.`,
              );
            }
            if (current.document.revision === Number.MAX_SAFE_INTEGER) {
              throw new PersistenceError("too_large", "The document has reached the maximum revision number.");
            }
            const document: LocalSenkeiDocument = {
              ...copied,
              created_at: current.document.created_at,
              revision: current.document.revision + 1,
              updated_at: now,
            };
            assertDocument(document);
            const snapshot: LocalSenkeiHistoryRevision = {
              document,
              workspace_data: normalizeWorkspaceData(workspaceData ?? current.workspace_data),
            };
            documents.put({ id: document.id, ...snapshot } satisfies StoredDocumentRecord);
            transaction.objectStore(REVISION_STORE).add(revisionRecord(snapshot));
            setResult(document);
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not save the document",
    );
  } catch (error) {
    throw persistenceError(error, "Could not save the document");
  }
}

export async function loadDocument(documentId: string): Promise<LocalSenkeiDocument> {
  return (await loadDocumentRevision(documentId)).document;
}

export async function loadDocumentRevision(
  documentId: string,
  revision?: number,
): Promise<LocalSenkeiHistoryRevision> {
  try {
    return await withTransaction(
      revision === undefined ? DOCUMENT_STORE : REVISION_STORE,
      "readonly",
      (transaction, setResult) => {
        const store = transaction.objectStore(revision === undefined ? DOCUMENT_STORE : REVISION_STORE);
        const request = revision === undefined
          ? store.get(documentId)
          : store.get([documentId, revision]);
        request.onsuccess = () => {
          try {
            if (request.result === undefined) {
              throw new PersistenceError("not_found", "The requested document or revision was not found.");
            }
            const stored = revision === undefined
              ? validateStoredDocument(request.result)
              : validateStoredRevision(request.result);
            setResult({ document: stored.document, workspace_data: stored.workspace_data });
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not load the document",
    );
  } catch (error) {
    throw persistenceError(error, "Could not load the document");
  }
}

export async function listDocumentHistory(documentId: string): Promise<readonly LocalSenkeiRevisionSummary[]> {
  try {
    return await withTransaction(
      REVISION_STORE,
      "readonly",
      (transaction, setResult) => {
        const index = transaction.objectStore(REVISION_STORE).index("by_document_id");
        const request = index.getAll(IDBKeyRange.only(documentId));
        request.onsuccess = () => {
          try {
            const revisions = request.result.map(validateStoredRevision);
            revisions.sort((a, b) => b.revision - a.revision);
            setResult(revisions.map(({ document_id, revision, saved_at }) => ({ document_id, revision, saved_at })));
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not read document history",
    );
  } catch (error) {
    throw persistenceError(error, "Could not read document history");
  }
}

function stableJson(value: CoreJsonValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key] as CoreJsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function flattenJson(value: CoreJsonValue, prefix: string, output: Map<string, CoreJsonValue>): void {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((child, index) => flattenJson(child, `${prefix}/${index}`, output));
    return;
  }
  if (isRecord(value) && Object.keys(value).length > 0) {
    Object.keys(value).sort().forEach((key) => {
      flattenJson(value[key] as CoreJsonValue, `${prefix}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, output);
    });
    return;
  }
  output.set(prefix || "/", value);
}

export async function compareDocumentRevisions(
  documentId: string,
  beforeRevision: number,
  afterRevision: number,
): Promise<readonly SenkeiDocumentDiffEntry[]> {
  const [beforeSnapshot, afterSnapshot] = await Promise.all([
    loadDocumentRevision(documentId, beforeRevision),
    loadDocumentRevision(documentId, afterRevision),
  ]);
  const beforeRoot = cloneJson(
    {
      name: beforeSnapshot.document.name,
      payload: beforeSnapshot.document.payload,
      workspace_data: beforeSnapshot.workspace_data,
    },
    "Before revision",
  ) as unknown as CoreJsonValue;
  const afterRoot = cloneJson(
    {
      name: afterSnapshot.document.name,
      payload: afterSnapshot.document.payload,
      workspace_data: afterSnapshot.workspace_data,
    },
    "After revision",
  ) as unknown as CoreJsonValue;
  const beforeLeaves = new Map<string, CoreJsonValue>();
  const afterLeaves = new Map<string, CoreJsonValue>();
  flattenJson(beforeRoot, "", beforeLeaves);
  flattenJson(afterRoot, "", afterLeaves);
  const paths = [...new Set([...beforeLeaves.keys(), ...afterLeaves.keys()])].sort();
  const diff = paths.flatMap((path) => {
    const beforePresent = beforeLeaves.has(path);
    const afterPresent = afterLeaves.has(path);
    const before = beforeLeaves.get(path) ?? null;
    const after = afterLeaves.get(path) ?? null;
    if (beforePresent === afterPresent && stableJson(before) === stableJson(after)) return [];
    return [{
      path,
      before_present: beforePresent,
      before,
      after_present: afterPresent,
      after,
    }];
  });
  if (diff.length > MAX_DIFF_ENTRIES) {
    throw new PersistenceError(
      "too_large",
      `This comparison contains more than ${MAX_DIFF_ENTRIES.toLocaleString()} changed fields. Compare smaller revisions or use the JSON export.`,
    );
  }
  return diff;
}

export async function restoreDocumentRevision(
  documentId: string,
  revision: number,
): Promise<LocalSenkeiDocument> {
  const now = new Date().toISOString();
  try {
    return await withTransaction(
      [DOCUMENT_STORE, REVISION_STORE],
      "readwrite",
      (transaction, setResult) => {
        const getCurrent = transaction.objectStore(DOCUMENT_STORE).get(documentId);
        getCurrent.onsuccess = () => {
          try {
            if (getCurrent.result === undefined) {
              throw new PersistenceError("not_found", "This document no longer exists in the local library.");
            }
            const current = validateStoredDocument(getCurrent.result);
            const getSource = transaction.objectStore(REVISION_STORE).get([documentId, revision]);
            getSource.onsuccess = () => {
              try {
                if (getSource.result === undefined) {
                  throw new PersistenceError("not_found", `Revision ${revision} was not found.`);
                }
                const source = validateStoredRevision(getSource.result);
                if (current.document.revision === Number.MAX_SAFE_INTEGER) {
                  throw new PersistenceError("too_large", "The document has reached the maximum revision number.");
                }
                const document: LocalSenkeiDocument = {
                  ...source.document,
                  id: current.document.id,
                  name: current.document.name,
                  created_at: current.document.created_at,
                  revision: current.document.revision + 1,
                  updated_at: now,
                };
                const snapshot: LocalSenkeiHistoryRevision = {
                  document,
                  workspace_data: cloneJson(source.workspace_data, "Restored workspace data"),
                };
                transaction.objectStore(DOCUMENT_STORE).put({ id: document.id, ...snapshot } satisfies StoredDocumentRecord);
                transaction.objectStore(REVISION_STORE).add(revisionRecord(snapshot));
                setResult(document);
              } catch (error) {
                abortTransaction(transaction, error);
              }
            };
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not restore the selected revision",
    );
  } catch (error) {
    throw persistenceError(error, "Could not restore the selected revision");
  }
}

export async function deleteDocument(documentId: string): Promise<void> {
  try {
    await withTransaction(
      [DOCUMENT_STORE, REVISION_STORE],
      "readwrite",
      (transaction, setResult) => {
        const documents = transaction.objectStore(DOCUMENT_STORE);
        const request = documents.get(documentId);
        request.onsuccess = () => {
          if (request.result === undefined) {
            abortTransaction(transaction, new PersistenceError("not_found", "This document no longer exists in the local library."));
            return;
          }
          documents.delete(documentId);
          const index = transaction.objectStore(REVISION_STORE).index("by_document_id");
          const cursorRequest = index.openCursor(IDBKeyRange.only(documentId));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
              return;
            }
            setResult(undefined);
          };
        };
      },
      "Could not delete the document",
    );
  } catch (error) {
    throw persistenceError(error, "Could not delete the document");
  }
}

function assertExportBundle(value: unknown): asserts value is LocalSenkeiExportBundle {
  if (!isRecord(value) || value.format !== "senkei.local-workspace") {
    throw new PersistenceError("unsupported_version", "This file is not a Senkei library export.");
  }
  if (value.bundle_version !== 1) {
    throw new PersistenceError("unsupported_version", `Export bundle version ${String(value.bundle_version)} is not supported.`);
  }
  if (!Array.isArray(value.history) || value.history.length === 0) {
    throw new PersistenceError("invalid_data", "Export must contain at least one saved revision.");
  }
  if (value.history.length > 10_000) {
    throw new PersistenceError("too_large", "Export contains too many document revisions.");
  }
  if (
    typeof value.active_document_id !== "string" ||
    typeof value.active_revision !== "number" ||
    !Number.isSafeInteger(value.active_revision) || value.active_revision < 1
  ) {
    throw new PersistenceError("invalid_data", "Export active document and revision metadata is invalid.");
  }
  let documentId: string | undefined;
  let previousRevision = 0;
  for (const item of value.history) {
    assertHistoryRevision(item, documentId);
    documentId ??= item.document.id;
    if (item.document.revision !== previousRevision + 1) {
      throw new PersistenceError("invalid_data", "Export history must contain every revision in order, starting at revision 1.");
    }
    previousRevision = item.document.revision;
  }
  const finalRevision = value.history[value.history.length - 1] as LocalSenkeiHistoryRevision;
  if (documentId !== value.active_document_id || finalRevision.document.revision !== value.active_revision) {
    throw new PersistenceError("invalid_data", "Export active document metadata does not match its history.");
  }
  if (finalRevision.document.revision !== Math.max(...value.history.map((item) => (item as LocalSenkeiHistoryRevision).document.revision))) {
    throw new PersistenceError("invalid_data", "Export history does not end with its latest revision.");
  }
  cloneJson(value, "Local export bundle");
}

export async function exportDocumentJson(documentId: string): Promise<string> {
  const history = await loadAllHistory(documentId);
  const latest = await loadDocumentRevision(documentId);
  if (history[history.length - 1].document.revision !== latest.document.revision) {
    throw new PersistenceError("invalid_data", "Document history is missing its current immutable revision.");
  }
  const bundle: LocalSenkeiExportBundle = {
    format: "senkei.local-workspace",
    bundle_version: 1,
    active_document_id: documentId,
    active_revision: history[history.length - 1].document.revision,
    history,
  };
  const json = JSON.stringify(bundle, null, 2);
  if (utf8ByteLength(json) > MAX_JSON_BYTES) {
    throw new PersistenceError("too_large", "This document history exceeds the 8 MiB export limit.");
  }
  return json;
}

async function loadAllHistory(documentId: string): Promise<readonly LocalSenkeiHistoryRevision[]> {
  try {
    return await withTransaction(
      REVISION_STORE,
      "readonly",
      (transaction, setResult) => {
        const request = transaction.objectStore(REVISION_STORE).index("by_document_id").getAll(IDBKeyRange.only(documentId));
        request.onsuccess = () => {
          try {
            const revisions = request.result.map(validateStoredRevision);
            revisions.sort((a, b) => a.revision - b.revision);
            if (revisions.length === 0) throw new PersistenceError("not_found", "This document has no saved history.");
            setResult(revisions.map(({ document, workspace_data }) => ({ document, workspace_data })));
          } catch (error) {
            abortTransaction(transaction, error);
          }
        };
      },
      "Could not export document history",
    );
  } catch (error) {
    throw persistenceError(error, "Could not export document history");
  }
}

export async function importDocumentJson(json: string): Promise<LocalSenkeiDocument> {
  if (utf8ByteLength(json) > MAX_JSON_BYTES) {
    throw new PersistenceError("too_large", "The selected file exceeds the 8 MiB import limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new PersistenceError("invalid_data", "The selected file is not valid JSON.", { cause: error });
  }
  assertExportBundle(parsed);
  const history = parsed.history as readonly LocalSenkeiHistoryRevision[];
  const latest = history[history.length - 1];
  try {
    return await withTransaction(
      [DOCUMENT_STORE, REVISION_STORE],
      "readwrite",
      (transaction, setResult) => {
        const documents = transaction.objectStore(DOCUMENT_STORE);
        const existingRequest = documents.get(latest.document.id);
        existingRequest.onsuccess = () => {
          if (existingRequest.result !== undefined) {
            abortTransaction(transaction, new PersistenceError(
              "conflict",
              "A document with this id is already in the local library. Delete it first or use a different export.",
            ));
            return;
          }
          const revisions = transaction.objectStore(REVISION_STORE);
          for (const snapshot of history) {
            revisions.add(revisionRecord(snapshot));
          }
          documents.add({ id: latest.document.id, ...latest } satisfies StoredDocumentRecord);
          setResult(latest.document);
        };
      },
      "Could not import the document",
    );
  } catch (error) {
    throw persistenceError(error, "Could not import the document");
  }
}

export async function importDocumentFile(file: File): Promise<LocalSenkeiDocument> {
  if (file.size > MAX_JSON_BYTES) {
    throw new PersistenceError("too_large", "The selected file exceeds the 8 MiB import limit.");
  }
  try {
    return await importDocumentJson(await file.text());
  } catch (error) {
    throw persistenceError(error, `Could not import ${file.name || "the selected file"}`);
  }
}

export async function loadWorkspaceData(documentId: string): Promise<LocalSenkeiWorkspaceData> {
  return (await loadDocumentRevision(documentId)).workspace_data;
}

export function createExportBlob(json: string): Blob {
  return new Blob([json], { type: "application/json;charset=utf-8" });
}

