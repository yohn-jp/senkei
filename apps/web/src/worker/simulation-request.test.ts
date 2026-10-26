import { describe, expect, it } from "vitest";
import { simulationDiagnosticsRequestError } from "./simulation-request";

describe("simulation diagnostic request authorization", () => {
  it("requires an explicit attacker or defender when diagnostics are requested", () => {
    expect(simulationDiagnosticsRequestError(true, "attacker")).toBeNull();
    expect(simulationDiagnosticsRequestError(true, "defender")).toBeNull();
    expect(simulationDiagnosticsRequestError(true, undefined)).toMatch(/must identify one owner side/);
    expect(simulationDiagnosticsRequestError(true, "both")).toMatch(/must identify one owner side/);
  });

  it("rejects an owner side when diagnostics are not requested", () => {
    expect(simulationDiagnosticsRequestError(false, undefined)).toBeNull();
    expect(simulationDiagnosticsRequestError(false, "attacker")).toMatch(/must be omitted/);
    expect(simulationDiagnosticsRequestError(false, "defender")).toMatch(/must be omitted/);
  });
});
