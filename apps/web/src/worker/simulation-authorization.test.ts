import { describe, expect, it } from "vitest";
import { simulationAuthorizationError } from "./simulation-authorization";

type AuthorizedResponse = {
  authorized_side: string;
  owner_replays: Record<string, { perspective: string }>;
  diagnostics: {
    events: { side: string }[];
    cu_by_side: Record<string, number>;
    final_memory_by_side: Record<string, unknown>;
    identity?: unknown;
  };
};

const authorized = (): AuthorizedResponse => ({
  authorized_side: "attacker",
  owner_replays: { attacker: { perspective: "attacker" } },
  diagnostics: { events: [{ side: "attacker" }], cu_by_side: { attacker: 3 }, final_memory_by_side: { attacker: {} } },
});

describe("simulation owner authorization", () => {
  it("accepts the requested side and public responses without restricted channels", () => {
    expect(simulationAuthorizationError(authorized(), "attacker")).toBeNull();
    expect(simulationAuthorizationError({ owner_replays: {}, diagnostics: null }, null)).toBeNull();
  });
  it("accepts a diagnostic identity for the requested side and rejects a different or malformed side", () => {
    const matchingIdentity = authorized();
    matchingIdentity.diagnostics.identity = { side: "attacker" };
    expect(simulationAuthorizationError(matchingIdentity, "attacker")).toBeNull();

    const foreignIdentity = authorized();
    foreignIdentity.diagnostics.identity = { side: "defender" };
    expect(simulationAuthorizationError(foreignIdentity, "attacker")).toMatch(/diagnostic identity/);

    const malformedIdentity = authorized();
    Object.assign(malformedIdentity.diagnostics, { identity: null });
    expect(simulationAuthorizationError(malformedIdentity, "attacker")).toMatch(/diagnostic identity/);
  });
  it("rejects a forged map key around a different perspective", () => {
    const response = authorized();
    response.owner_replays.attacker.perspective = "defender";
    expect(simulationAuthorizationError(response, "attacker")).toMatch(/unauthorized owner replay/);
    expect(simulationAuthorizationError(authorized(), "defender")).toMatch(/authorization/);
  });
  it("requires the requested owner replay instead of an empty or absent channel", () => {
    expect(simulationAuthorizationError({ ...authorized(), owner_replays: {} }, "attacker")).toMatch(/unauthorized owner replay/);
    expect(simulationAuthorizationError({ ...authorized(), owner_replays: undefined }, "attacker")).toMatch(/unauthorized owner replay/);
  });
  it("preserves initial-rule diagnostics without granting a foreign owner channel", () => {
    expect(simulationAuthorizationError({ ...authorized(), owner_replays: {} }, "attacker", false)).toBeNull();
    expect(simulationAuthorizationError({ ...authorized(), owner_replays: { defender: { perspective: "defender" } } }, "attacker", false)).toMatch(/unauthorized owner replay/);
  });
  it("rejects private events and memory for the opposing side", () => {
    const eventLeak = authorized();
    eventLeak.diagnostics.events.push({ side: "defender" });
    expect(simulationAuthorizationError(eventLeak, "attacker")).toMatch(/unauthorized diagnostic events/);
    const memoryLeak = authorized();
    Object.assign(memoryLeak.diagnostics.final_memory_by_side, { defender: { secret: 1 } });
    expect(simulationAuthorizationError(memoryLeak, "attacker")).toMatch(/unauthorized diagnostic state/);
  });
  it("rejects owner channels in a public-only response", () => {
    expect(simulationAuthorizationError(authorized(), null)).toMatch(/restricted channel/);
    expect(simulationAuthorizationError({ owner_replays: { defender: {} }, diagnostics: null }, null)).toMatch(/restricted channel/);
    expect(simulationAuthorizationError({ replay: { perspective: "attacker" }, diagnostics: null }, null)).toMatch(/public replay channel/);
  });
});
