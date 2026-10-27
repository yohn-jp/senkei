import { reproductionSnapshotDigest } from "../../worker/input-identity";
import { sameJsonResponse } from "../../worker/json-response-equality";
export { reproductionSnapshotDigest } from "../../worker/input-identity";
import type { DomainValue, MatchResult, PresentationReplay, SimulationResponse, SimulationSnapshot } from "../../contracts";
import { simulationAuthorizationError } from "../../worker/simulation-authorization";

/** Stored/imported responses must obey the same permissions as live Worker replies. */
export function validateNextExperimentAuthorization(response: SimulationResponse, includeDiagnostics: boolean): void {
  const error = simulationAuthorizationError({
    authorized_side: response.authorized_side,
    owner_replays: response.owner_replays,
    owner_replay: response.owner_replay,
    replay: response.outcome?.presentation_replay,
    diagnostics: response.restricted_diagnostics ?? null,
  }, includeDiagnostics ? "attacker" : null);
  if (error !== null) throw new Error(error);
}

function orderedDomainValue(value: DomainValue): DomainValue {
  switch (value.kind) {
    case "null": return { kind: "null" };
    case "fixed": return { kind: "fixed", value: { coefficient: value.value.coefficient, scale: value.value.scale } };
    case "list": return { kind: "list", value: value.value.map(orderedDomainValue) };
    case "record": return {
      kind: "record",
      value: Object.fromEntries(Object.keys(value.value).sort().map((key) => [key, orderedDomainValue(value.value[key])])),
    };
    case "bool": return { kind: "bool", value: value.value };
    case "integer": return { kind: "integer", value: value.value };
    case "string": return { kind: "string", value: value.value };
    case "enum": return { kind: "enum", value: value.value };
    case "entity": return { kind: "entity", value: value.value };
  }
}

/** Recreates Rust MatchResult field order and BTreeMap ordering before SHA-256. */
function matchResultDigestInput(result: MatchResult): MatchResult {
  return {
    match_id: result.match_id,
    outcome: result.outcome,
    termination_reason: result.termination_reason,
    final_tick: result.final_tick,
    statistics: Object.fromEntries(Object.keys(result.statistics).sort()
      .map((key) => [key, orderedDomainValue(result.statistics[key])])) as MatchResult["statistics"],
    cu_spent: { attacker: result.cu_spent.attacker, defender: result.cu_spent.defender },
    final_state_digest: result.final_state_digest,
  };
}

/** Binds imported owner diagnostics to the exact Run, public result and authorized Program. */
export async function validateNextExperimentDiagnostics(
  response: SimulationResponse,
  snapshot: SimulationSnapshot,
): Promise<void> {
  const diagnostics = response.restricted_diagnostics;
  const identity = diagnostics?.identity;
  if (!diagnostics || !identity) {
    throw new Error("Stored diagnostics have no Run identity; they cannot be attached to this experiment.");
  }
  if (identity.schema_version !== 1) throw new Error("Stored diagnostics use an unsupported identity schema.");
  if (identity.side !== "attacker" && identity.side !== "defender") {
    throw new Error("Stored diagnostics identity has an invalid authorized side.");
  }
  if (identity.side !== response.authorized_side) {
    throw new Error("Stored diagnostics identity side does not match the authorized response side.");
  }
  const result = response.outcome?.result;
  const replay = response.outcome?.presentation_replay;
  if (!result || !replay || identity.match_id !== result.match_id || result.match_id !== replay.match_id) {
    throw new Error("Stored diagnostics identity does not match the immutable Run and public replay.");
  }
  if (identity.result_digest !== replay.result_digest) {
    throw new Error("Stored diagnostics result digest does not match the public replay.");
  }
  const sideSnapshot = snapshot[identity.side];
  const programDigest = sideSnapshot?.program?.content_digest;
  if (typeof programDigest !== "string" || identity.program_digest !== programDigest) {
    throw new Error("Stored diagnostics Program digest does not match the authorized Run Program.");
  }
  const actualSnapshotDigest = await reproductionSnapshotDigest(snapshot);
  if (identity.snapshot_digest !== actualSnapshotDigest) {
    throw new Error("Stored diagnostics snapshot digest does not match the complete immutable Run input.");
  }
}

/** Validates the owner/public replay against the immutable match result it accompanies. */
export async function validateNextExperimentReplay(
  replay: PresentationReplay,
  result: MatchResult,
  expectedMatchId: string,
): Promise<void> {
  if (replay.match_id !== expectedMatchId || result.match_id !== expectedMatchId) {
    throw new Error("Replay match identity differs from the stored Enbu result.");
  }
  if (replay.perspective !== undefined && replay.perspective !== "attacker") {
    throw new Error("Stored replay perspective is not authorized for this attacker workspace.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(matchResultDigestInput(result)));
  const digestBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(digestBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (replay.result_digest !== digest) {
    throw new Error("Replay result digest does not match the immutable Enbu result.");
  }
}

function reproductionResponseView(response: SimulationResponse): unknown {
  return {
    authorized_side: response.authorized_side,
    result: response.outcome?.result,
    presentation_replay: response.outcome?.presentation_replay,
    owner_replay: response.owner_replay,
    owner_replays: response.owner_replays,
    restricted_diagnostics: response.restricted_diagnostics,
  };
}

/** Confirms that a same-runtime replay reproduces the exact stored local response. */
export async function validateNextExperimentReproduction(
  actualResponse: SimulationResponse,
  storedResponse: SimulationResponse,
  snapshot: SimulationSnapshot,
  includeDiagnostics: boolean,
): Promise<void> {
  for (const response of [actualResponse, storedResponse]) {
    validateNextExperimentAuthorization(response, includeDiagnostics);
    const result = response.outcome?.result;
    const replay = response.outcome?.presentation_replay;
    if (!result || !replay) {
      throw new Error("Reproduction response is missing its authoritative result or public replay.");
    }
    await validateNextExperimentReplay(replay, result, snapshot.context.match_id);
    if (includeDiagnostics) await validateNextExperimentDiagnostics(response, snapshot);
  }

  if (!sameJsonResponse(reproductionResponseView(actualResponse), reproductionResponseView(storedResponse))) {
    throw new Error("Reproduced Enbu result, replay, or authorized local projection differs from the stored Run.");
  }
}
