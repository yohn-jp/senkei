import type { CombatantSide } from "../contracts/core-model";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Reject channel confusion before any local core data reaches a UI consumer. */
export function simulationAuthorizationError(
  response: Readonly<Record<string, unknown>>,
  requestedSide: CombatantSide | null,
): string | null {
  if (record(response.replay)?.perspective != null) {
    return "The core returned an owner perspective through the public replay channel.";
  }
  const channels = record(response.owner_replays);
  const alias = record(response.owner_replay);
  if (requestedSide === null) {
    return response.authorized_side != null || response.diagnostics != null || alias !== null ||
      Object.keys(channels ?? {}).length > 0
      ? "The core returned a restricted channel without an owner request." : null;
  }
  if (response.authorized_side !== requestedSide) {
    return "The core diagnostics authorization does not match the requested owner side.";
  }
  if (channels === null || Object.entries(channels).some(([side, replay]) =>
    side !== requestedSide || record(replay)?.perspective !== requestedSide)) {
    return "The core returned an unauthorized owner replay channel.";
  }
  if (alias !== null && alias.perspective !== requestedSide) {
    return "The core returned a replay for a different owner side.";
  }
  const diagnostics = record(response.diagnostics);
  if (diagnostics === null || !Array.isArray(diagnostics.events) ||
    diagnostics.events.some((event: unknown) => record(event)?.side !== requestedSide)) {
    return "The core returned unauthorized diagnostic events.";
  }
  for (const field of ["cu_by_side", "final_memory_by_side"]) {
    const values = record(diagnostics[field]);
    if (values === null || Object.keys(values).some((side) => side !== requestedSide)) {
      return "The core returned unauthorized diagnostic state.";
    }
  }
  return null;
}
