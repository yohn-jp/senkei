import type { SimulationSnapshot } from "../../contracts";

interface ComparisonRun {
  readonly snapshot: SimulationSnapshot;
  readonly setup?: { readonly campaign_scenario_id?: string | null };
}
export interface RunInputChange {
  readonly path: string;
  readonly label: string;
  readonly ownTarget: boolean;
}
export interface RunComparison {
  readonly category: "exact" | "improved" | "reference";
  readonly snapshotIdentical: boolean;
  readonly matchIdChanged: boolean;
  readonly changes: readonly RunInputChange[];
  readonly unavailable: readonly string[];
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Object insertion order is not an input difference. Array order still is. */
export function canonicalInputKey(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalInputKey).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalInputKey(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function without(value: unknown, keys: readonly string[]): RecordValue {
  return record(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) : {};
}
function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => record(current) ? current[key] : undefined, value);
}
const nonempty = (value: unknown) => typeof value === "string" && value.length > 0;
const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const version = (value: unknown) => record(value) && ["major", "minor", "patch"].every(key => number(value[key]));
const ruleset = (value: unknown) => record(value) && nonempty(value.id) && nonempty(value.digest) && version(value.version);
const versions = ["model", "engine", "ruleset", "jinrei_language", "structured_ast", "typed_ir", "bytecode", "cost_schedule", "replay_schema"];
const hostLimits = ["max_input_bytes", "max_entities", "max_events", "max_diagnostic_events", "max_output_bytes"];

/** Availability checks support a truthful label; they do not replace core preflight. */
function unavailableInputs(snapshot: unknown): string[] {
  const missing: string[] = [];
  const require = (path: string, valid: (value: unknown) => boolean) => { if (!valid(at(snapshot, path))) missing.push(path); };
  for (const side of ["attacker", "defender"]) {
    require(`${side}.schema_version`, version);
    for (const field of ["id", "revision"]) require(`${side}.${field}`, nonempty);
    require(`${side}.ruleset`, ruleset);
    for (const field of ["configuration", "initial_memory"]) require(`${side}.${field}`, record);
    for (const field of ["language_version", "ir_version", "bytecode_version", "cost_schedule_version"]) require(`${side}.program.${field}`, version);
    for (const field of ["cost_schedule_id", "content_digest"]) require(`${side}.program.${field}`, nonempty);
    require(`${side}.program.ruleset`, ruleset);
    require(`${side}.program.bytecode`, value => Array.isArray(value) && value.every(byte => number(byte) && byte <= 255));
  }
  require("context.schema_version", version);
  require("context.match_id", nonempty);
  require("context.ruleset", ruleset);
  for (const field of versions) require(`context.versions.${field}`, version);
  for (const field of hostLimits) require(`context.host_limits.${field}`, number);
  require("context.max_ticks", value => number(value) && (value as number) > 0);
  for (const field of ["entities", "global_fields", "collections"]) require(`context.initial_world.${field}`, record);
  for (const field of ["world_id", "logic_digest", "presentation_digest"]) require(`context.world_identity.${field}`, nonempty);
  for (const field of ["schema_version", "minimum_compiler"]) require(`context.world_identity.${field}`, version);
  for (const field of ["maximum_compiler_exclusive", "validation_profile_version"]) require(`context.world_identity.${field}`, value => value === null || version(value));
  require("context.world_identity.validation_profile_id", value => value === null || nonempty(value));
  return missing;
}

/**
 * UX-C08 comparison of submitted inputs, never of outcomes or current Draft.
 * Only own configuration, compiled code and its associated revision are targets.
 * Every other supplied field (including future fields) remains a fixed condition.
 * Match ID is reported separately: Core can derive runtime entity IDs from it,
 * so equal conditions never promise byte-identical output across Match IDs.
 */
export function classifyRunComparison(previous: ComparisonRun, current: ComparisonRun): RunComparison {
  const before = previous.snapshot, after = current.snapshot;
  const changes: RunInputChange[] = [];
  const add = (path: string, label: string, ownTarget = false, left = at(before, path), right = at(after, path)) => {
    if (canonicalInputKey(left) !== canonicalInputKey(right)) changes.push({ path, label, ownTarget });
  };
  add("attacker.configuration", "自軍の5 Hero・Skill・Squad・Node設定", true);
  add("attacker.program", "自軍のJinrei Program", true,
    { content_digest: before?.attacker?.program?.content_digest, bytecode: before?.attacker?.program?.bytecode },
    { content_digest: after?.attacker?.program?.content_digest, bytecode: after?.attacker?.program?.bytecode });
  // reviseDraft increments revision when own Draft content changes. A revision
  // change alone is not evidence of a declared tactics/configuration improvement.
  add("attacker.revision", "自軍SnapshotのRevision", changes.some(change => change.ownTarget));
  add("attacker.program.identity", "自軍Programの実行版・Ruleset・CU等の条件", false,
    without(before?.attacker?.program, ["content_digest", "bytecode"]), without(after?.attacker?.program, ["content_digest", "bytecode"]));
  add("attacker.identity", "自軍SnapshotのID・Schema・Ruleset等の条件", false,
    without(before?.attacker, ["configuration", "program", "revision", "initial_memory"]), without(after?.attacker, ["configuration", "program", "revision", "initial_memory"]));
  add("attacker.initial_memory", "自軍の初期Memory");
  // Keep opponent identities, full bytecode, metadata and initial memory intact.
  for (const [field, label] of Object.entries({ configuration: "相手の編成・配置", program: "相手の完全なProgram", initial_memory: "相手の初期Memory" })) add(`defender.${field}`, label);
  add("defender.identity", "相手SnapshotのID・Revision・Schema・Ruleset等の条件", false,
    without(before?.defender, ["configuration", "program", "initial_memory"]), without(after?.defender, ["configuration", "program", "initial_memory"]));
  const contextLabels: Record<string, string> = { schema_version: "ContextのSchema", ruleset: "Ruleset identity", world_identity: "World identity", versions: "Ruleset / Engine identity", initial_world: "Worldの初期状態", max_ticks: "Tick上限", host_limits: "実行Host上限" };
  const contextKeys = new Set([...Object.keys(before?.context ?? {}), ...Object.keys(after?.context ?? {})]);
  for (const key of contextKeys) if (key !== "match_id") add(`context.${key}`, contextLabels[key] ?? `その他の実行条件: context.${key}`);
  add("snapshot.other", "その他のSnapshot条件", false, without(before, ["attacker", "defender", "context"]), without(after, ["attacker", "defender", "context"]));
  add("setup.campaign_scenario_id", "Campaign challenge", false, previous.setup?.campaign_scenario_id ?? null, current.setup?.campaign_scenario_id ?? null);
  const unavailable = [...new Set([...unavailableInputs(before), ...unavailableInputs(after)])];
  const fixedChanged = changes.some(change => !change.ownTarget);
  return {
    category: unavailable.length || fixedChanged ? "reference" : changes.length ? "improved" : "exact",
    snapshotIdentical: canonicalInputKey(before) === canonicalInputKey(after),
    matchIdChanged: before?.context?.match_id !== after?.context?.match_id,
    changes,
    unavailable,
  };
}
