import type { BehaviorSimulationRequest } from "../contracts/behavior";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "./input-identity";
import { simulationAuthorizationError } from "./simulation-authorization";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Reject channel and complete-input lineage mismatches before Web consumption. */
export async function behaviorResponseError(value: unknown, request: BehaviorSimulationRequest): Promise<string | null> {
  const response = record(value);
  const runtime = record(response?.behavior_runtime_version);
  if (response?.format_version !== 1 || runtime?.major !== 1 || runtime.minor !== 0 || runtime.patch !== 0) {
    return "Unsupported Behavior response or runtime version.";
  }
  const result = record(response.result);
  const replay = record(response.replay);
  const match = request.snapshot.context.match_id;
  if (result?.match_id !== match || replay?.match_id !== match || replay.perspective != null) {
    return "Behavior public result/replay does not match the submitted Match.";
  }
  if (!request.include_diagnostics) {
    return "owner" in response ? "Behavior returned a restricted channel without an owner request." : null;
  }
  const side = request.diagnostics_side;
  const owner = record(response.owner);
  const diagnostics = record(owner?.diagnostics);
  const identity = record(diagnostics?.identity);
  const authorization = simulationAuthorizationError({
    replay, authorized_side: owner?.authorized_side, owner_replays: {}, diagnostics,
  }, side, false);
  if (authorization) return authorization;
  if (identity?.schema_version !== 2 || identity.match_id !== match ||
      identity.result_digest !== replay.result_digest ||
      identity.program_digest !== request.snapshot[side].program.content_digest) {
    return "Behavior diagnostic identity does not match the authorized Program and result.";
  }
  const digest = await sha256Hex(canonicalJson({
    behavior_input_schema: 1,
    behavior_runtime_version: runtime,
    simulation_snapshot_digest: await reproductionSnapshotDigest(request.snapshot),
    inputs: request.behavior_inputs,
  }));
  if (owner?.behavior_run_digest !== digest || identity.snapshot_digest !== digest) {
    return "Behavior diagnostic identity does not match the complete immutable input.";
  }
  if (!Array.isArray(owner.trace) || owner.trace.some(value => {
    const trace = record(value);
    const composition = record(trace?.composition);
    return trace?.side !== side || composition?.side !== side || composition.tick !== trace.tick;
  })) return "Behavior returned an unauthorized decision trace.";
  return null;
}
