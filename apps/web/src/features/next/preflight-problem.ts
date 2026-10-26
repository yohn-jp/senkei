import type { ApiError } from "../../contracts/core-model";
import type { WorkerFailureCode } from "../../contracts/core";
import { CoreClientError } from "../../worker/client";

export type PreflightStage = "availability" | "scenario_selection" | "own_compile" | "opponent_compile" | "context_creation" | "snapshot_preflight" | "stale_inputs";
export type PreflightHeroField = "slot_id" | "catalog_id" | "squad" | "node" | "skill_path";
type Side = "attacker" | "defender";

export interface PreflightContext {
  readonly stage: PreflightStage;
  readonly input: "draft" | "original_run";
  /** Caller-owned launch identity; slot mappings must come from this same input. */
  readonly inputKey: string;
  readonly scenarioId: string | null;
  readonly slots?: Readonly<Partial<Record<Side, readonly { readonly slot_id: string }[]>>>;
}

export type PreflightTarget =
  | { readonly kind: "hero"; readonly recordIndex: number | null; readonly slotId: string | null; readonly field: PreflightHeroField | null; readonly squadId: string | null }
  | { readonly kind: "program"; readonly path: string | null }
  | { readonly kind: "scenario" | "compatibility" | "runtime" | "unknown" };

export type PreflightRepairTarget =
  | { readonly kind: "own_hero"; readonly slotId: string; readonly recordIndex: number; readonly field: PreflightHeroField; readonly screen: "collection" | "skills" | "squads" }
  | { readonly kind: "own_jinrei"; readonly path: string | null }
  | { readonly kind: "scenario"; readonly scenarioId: string | null }
  | { readonly kind: "recovery" | "ready" };

export interface PreflightProblem {
  readonly status: "invalid" | "unverified" | "failed";
  readonly stage: PreflightStage;
  readonly input: PreflightContext["input"];
  readonly inputKey: string;
  readonly side: Side | "shared" | "unknown";
  readonly target: PreflightTarget;
  readonly message: string;
  readonly workerCode: WorkerFailureCode | null;
  readonly apiError: ApiError | null;
  readonly repair: PreflightRepairTarget;
  readonly revalidation: "compile_and_preflight" | "snapshot_preflight" | "reload_and_preflight";
}

/** For local readiness checks with an explicitly known validation status. */
export class PreflightLocalFailure extends Error {
  constructor(message: string, readonly status: "invalid" | "unverified") { super(message); }
}

const apiCodes: readonly ApiError["code"][] = ["invalid_request", "invalid_version", "invalid_ruleset", "validation_failed", "compile_failed", "invalid_program", "runtime_failure", "invalid_snapshot", "incompatible_version", "unsupported_primitive", "budget_exceeded", "resource_limit", "transition_conflict", "arithmetic_overflow", "internal_error"];
const invalidCodes = ["invalid_snapshot", "invalid_program", "validation_failed", "compile_failed", "invalid_ruleset", "incompatible_version", "unsupported_primitive", "budget_exceeded"];
const compatibilityCodes = ["invalid_ruleset", "incompatible_version", "invalid_version"];
const fields: readonly PreflightHeroField[] = ["slot_id", "catalog_id", "squad", "node", "skill_path"];
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function apiError(value: unknown): ApiError | null {
  if (!record(value) || !apiCodes.includes(value.code as ApiError["code"]) || typeof value.message !== "string"
    || !(value.path === null || typeof value.path === "string") || !record(value.details)
    || !Object.values(value.details).every((detail) => typeof detail === "string")) return null;
  return value as unknown as ApiError;
}
function defenderRepair(context: PreflightContext): PreflightRepairTarget {
  return context.scenarioId ? { kind: "scenario", scenarioId: context.scenarioId } : { kind: "recovery" };
}

/** Classifies structured evidence only. A message never establishes a target. */
export function classifyPreflightProblem(cause: unknown, context: PreflightContext): PreflightProblem {
  const workerCode = cause instanceof CoreClientError ? cause.code : null;
  const error = apiError(workerCode === "core_error" ? (cause as CoreClientError).details : cause);
  const message = error?.message ?? (cause instanceof Error ? cause.message : String(cause));
  const result: PreflightProblem = {
    status: cause instanceof PreflightLocalFailure ? cause.status : error && invalidCodes.includes(error.code) ? "invalid" : "failed",
    stage: context.stage, input: context.input, inputKey: context.inputKey,
    side: "unknown", target: { kind: "unknown" }, message, workerCode, apiError: error,
    repair: { kind: "recovery" }, revalidation: context.input === "original_run" ? "snapshot_preflight" : "compile_and_preflight",
  };
  if ((workerCode !== null && workerCode !== "core_error") || (error && !invalidCodes.includes(error.code) && !compatibilityCodes.includes(error.code))) {
    return { ...result, target: { kind: "runtime" }, revalidation: "reload_and_preflight" };
  }
  if (error && compatibilityCodes.includes(error.code)) {
    const declaredSide = error.details.preflight_side;
    const side = declaredSide === "attacker" || declaredSide === "defender" ? declaredSide
      : context.stage === "own_compile" ? "attacker" : context.stage === "opponent_compile" ? "defender" : "shared";
    return { ...result, side, target: { kind: "compatibility" }, revalidation: "reload_and_preflight" };
  }
  if (cause instanceof PreflightLocalFailure) {
    if (context.stage === "scenario_selection") return { ...result, side: "defender", target: { kind: "scenario" }, repair: { kind: "scenario", scenarioId: context.scenarioId } };
    if (context.stage === "stale_inputs") return { ...result, repair: { kind: "ready" } };
    return result;
  }
  if (!error) return result;
  const compilerSide = context.stage === "own_compile" ? "attacker" : context.stage === "opponent_compile" ? "defender" : null;
  if (compilerSide) return programProblem(result, context, compilerSide, error.path);
  const { details, path } = error;
  const side = details.preflight_side;
  if (side !== "attacker" && side !== "defender") return result;
  if (details.preflight_field === "program" && path === `${side}.program`) return programProblem(result, context, side, path);
  if (path === `${side}.configuration.heroes` && details.preflight_record_index === undefined && details.preflight_field === undefined) {
    return { ...result, side, target: { kind: "hero", recordIndex: null, slotId: null, field: null, squadId: null }, repair: side === "defender" ? defenderRepair(context) : result.repair };
  }
  const rawIndex = details.preflight_record_index;
  // This is a producer metadata integer, never a number extracted from prose.
  if (rawIndex === undefined || !/^(0|[1-9][0-9]*)$/.test(rawIndex)) return result;
  const index = Number(rawIndex);
  const field = fields.find((candidate) => candidate === details.preflight_field) ?? null;
  if (!Number.isSafeInteger(index) || path !== `${side}.configuration.heroes.value[${index}]${field ? `.value.${field}` : ""}`) return result;
  const slots = context.slots?.[side];
  const declaredSlot = details.preflight_slot_id;
  const slotId = declaredSlot && slots?.[index]?.slot_id === declaredSlot && slots.filter((slot) => slot.slot_id === declaredSlot).length === 1 ? declaredSlot : null;
  const target: PreflightTarget = { kind: "hero", recordIndex: index, slotId, field, squadId: details.preflight_squad_id ?? null };
  const repair: PreflightRepairTarget = side === "defender" ? defenderRepair(context)
    : context.input === "draft" && slotId && field ? { kind: "own_hero", slotId, recordIndex: index, field, screen: field === "skill_path" ? "skills" : field === "node" || field === "squad" ? "squads" : "collection" }
      : { kind: "recovery" };
  return { ...result, side, target, repair };
}

function programProblem(result: PreflightProblem, context: PreflightContext, side: Side, path: string | null): PreflightProblem {
  return { ...result, side, target: { kind: "program", path }, repair: side === "defender" ? defenderRepair(context)
    : context.input === "draft" ? { kind: "own_jinrei", path } : { kind: "recovery" } };
}
