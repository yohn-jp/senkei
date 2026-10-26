import type { CombatantSide } from "../contracts/core-model";

/** Enforce explicit owner-channel selection at the worker/WASM request boundary. */
export function simulationDiagnosticsRequestError(includeDiagnostics: unknown, diagnosticsSide: unknown): string | null {
  if (typeof includeDiagnostics !== "boolean") return "simulate.include_diagnostics must be a boolean.";
  if (includeDiagnostics) {
    return diagnosticsSide === "attacker" || diagnosticsSide === "defender"
      ? null
      : "simulate.diagnostics_side must identify one owner side when diagnostics are requested.";
  }
  return diagnosticsSide === undefined
    ? null
    : "simulate.diagnostics_side must be omitted when diagnostics are not requested.";
}

export function isCombatantSide(value: unknown): value is CombatantSide {
  return value === "attacker" || value === "defender";
}
