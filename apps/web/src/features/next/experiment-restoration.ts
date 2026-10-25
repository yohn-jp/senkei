import type { DomainValue, MatchResult, PresentationReplay } from "../../contracts";

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
