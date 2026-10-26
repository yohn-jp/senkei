import { describe, expect, it } from "vitest";
import { CoreClientError } from "../../worker/client";
import type { ApiError } from "../../contracts/core-model";
import { classifyPreflightProblem, PreflightLocalFailure, type PreflightContext } from "./preflight-problem";

const context: PreflightContext = { stage: "snapshot_preflight", input: "draft", inputKey: "submitted-1", scenarioId: "protect-core", slots: { attacker: [{ slot_id: "slot-a" }, { slot_id: "slot-b" }] } };
const api = (extra: Partial<ApiError> = {}): ApiError => ({ code: "invalid_snapshot", message: "Actual core cause", path: null, details: {}, ...extra });
const targetError = (side: "attacker" | "defender", field = "skill_path") => api({ path: `${side}.configuration.heroes.value[1].value.${field}`, details: { preflight_side: side, preflight_record_index: "1", preflight_slot_id: "slot-b", preflight_field: field, preflight_squad_id: "alpha" } });

describe("structured Preflight problem classification", () => {
  it("resolves an own field only against the immutable submitted slot mapping", () => {
    const error = targetError("attacker");
    const result = classifyPreflightProblem(new CoreClientError({ code: "core_error", message: error.message, details: { ...error } }), context);
    expect(result).toMatchObject({ status: "invalid", side: "attacker", inputKey: "submitted-1", apiError: error, workerCode: "core_error", target: { kind: "hero", recordIndex: 1, slotId: "slot-b", field: "skill_path", squadId: "alpha" }, repair: { kind: "own_hero", slotId: "slot-b", screen: "skills", field: "skill_path" }, revalidation: "compile_and_preflight" });
  });

  it("directs NPC errors to the actual scenario and never an own editor", () => {
    expect(classifyPreflightProblem(targetError("defender", "node"), context)).toMatchObject({ side: "defender", repair: { kind: "scenario", scenarioId: "protect-core" } });
  });

  it.each(["attacker", "defender"] as const)("does not infer %s ownership from human messages", side => {
    const result = classifyPreflightProblem(api({ message: `${side} Hero slot-b invalid skill at line 99` }), context);
    expect(result).toMatchObject({ side: "unknown", target: { kind: "unknown" }, repair: { kind: "recovery" } });
  });

  it("uses compiler caller stage for side while preserving the opaque source byte locator", () => {
    const cause = api({ code: "compile_failed", path: "source@27" });
    expect(classifyPreflightProblem(cause, { ...context, stage: "own_compile" })).toMatchObject({ side: "attacker", target: { kind: "program", path: "source@27" }, repair: { kind: "own_jinrei", path: "source@27" } });
    expect(classifyPreflightProblem(cause, { ...context, stage: "opponent_compile" })).toMatchObject({ side: "defender", repair: { kind: "scenario", scenarioId: "protect-core" } });
    expect(classifyPreflightProblem({ ...cause, path: null }, { ...context, stage: "own_compile" }).repair).toEqual({ kind: "own_jinrei", path: null });
  });

  it("preserves program identity failures without inventing source locations", () => {
    expect(classifyPreflightProblem(api({ code: "invalid_program", path: "defender.program", details: { preflight_side: "defender", preflight_field: "program" } }), context)).toMatchObject({ target: { kind: "program", path: "defender.program" }, repair: { kind: "scenario" } });
  });

  it("does not use missing, mismatched, duplicate or out-of-range slot mappings for repair", () => {
    for (const slots of [undefined, { attacker: [{ slot_id: "other" }] }, { attacker: [{ slot_id: "slot-b" }, { slot_id: "slot-b" }] }, { attacker: [{ slot_id: "slot-a" }, { slot_id: "other" }] }]) {
      expect(classifyPreflightProblem(targetError("attacker"), { ...context, slots }).repair).toEqual({ kind: "recovery" });
    }
  });

  it("rejects inconsistent structured paths/details and malformed record indices", () => {
    const base = targetError("attacker");
    for (const error of [{ ...base, path: base.path!.replace("attacker", "defender") }, { ...base, details: { ...base.details, preflight_record_index: "-1" } }, { ...base, details: { ...base.details, preflight_field: "invented" } }]) {
      expect(classifyPreflightProblem(error, context).repair).toEqual({ kind: "recovery" });
    }
  });

  it("does not claim a current Draft edit repairs an immutable original Run", () => {
    expect(classifyPreflightProblem(targetError("attacker"), { ...context, input: "original_run" })).toMatchObject({ input: "original_run", repair: { kind: "recovery" }, revalidation: "snapshot_preflight" });
  });

  it("retains compatibility and runtime categories instead of assigning Hero repair", () => {
    expect(classifyPreflightProblem(api({ code: "invalid_ruleset" }), { ...context, stage: "own_compile" })).toMatchObject({ target: { kind: "compatibility" }, repair: { kind: "recovery" }, revalidation: "reload_and_preflight" });
    expect(classifyPreflightProblem(api({ code: "invalid_ruleset", path: "defender.program", details: { preflight_side: "defender", preflight_field: "program" } }), context)).toMatchObject({ side: "defender", target: { kind: "compatibility" }, repair: { kind: "recovery" } });
    for (const code of ["worker_error", "unsupported_protocol", "invalid_request"] as const) {
      expect(classifyPreflightProblem(new CoreClientError({ code, message: "transport failure" }), context)).toMatchObject({ status: "failed", workerCode: code, target: { kind: "runtime" }, repair: { kind: "recovery" } });
    }
    expect(classifyPreflightProblem(api({ code: "resource_limit" }), { ...context, stage: "own_compile" })).toMatchObject({ status: "failed", target: { kind: "runtime" }, repair: { kind: "recovery" } });
    expect(classifyPreflightProblem(new Error("unknown failure"), context)).toMatchObject({ status: "failed", side: "unknown", target: { kind: "unknown" } });
  });

  it("preserves explicitly typed local availability, stale and scenario failures", () => {
    const cause = new PreflightLocalFailure("not ready", "unverified");
    expect(classifyPreflightProblem(cause, { ...context, stage: "stale_inputs" })).toMatchObject({ status: "unverified", repair: { kind: "ready" } });
    expect(classifyPreflightProblem(cause, { ...context, stage: "availability" })).toMatchObject({ status: "unverified", repair: { kind: "recovery" } });
    expect(classifyPreflightProblem(new PreflightLocalFailure("locked scenario", "invalid"), { ...context, stage: "scenario_selection" })).toMatchObject({ status: "invalid", repair: { kind: "scenario", scenarioId: "protect-core" } });
  });
});
