import { describe, expect, it } from "vitest";
import type { BehaviorSimulationRequest } from "../contracts/behavior";
import { behaviorResponseError } from "./behavior-response";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "./input-identity";

async function fixture() {
  // Boundary fixtures test lineage, not RulePackage validity or gameplay.
  const request = {
    format_version: 1, include_diagnostics: true, diagnostics_side: "attacker",
    snapshot: { attacker: { program: { content_digest: "a".repeat(64) } }, defender: {}, context: { match_id: "match" } },
    behavior_inputs: { schema_version: 1, catalog_key: {}, bindings: {}, candidates: {} },
  } as unknown as BehaviorSimulationRequest;
  const runtime = { major: 1, minor: 0, patch: 0 };
  const digest = await sha256Hex(canonicalJson({ behavior_input_schema: 1, behavior_runtime_version: runtime,
    simulation_snapshot_digest: await reproductionSnapshotDigest(request.snapshot), inputs: request.behavior_inputs }));
  const response = {
    format_version: 1, behavior_runtime_version: runtime,
    result: { match_id: "match" }, replay: { match_id: "match", result_digest: "b".repeat(64) },
    owner: { authorized_side: "attacker", behavior_run_digest: digest,
      diagnostics: { identity: { schema_version: 2, side: "attacker", match_id: "match", result_digest: "b".repeat(64),
        program_digest: "a".repeat(64), snapshot_digest: digest }, events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
      trace: [{ tick: 1, side: "attacker", composition: { tick: 1, side: "attacker" } }] },
  };
  return { request, response };
}

describe("Behavior Worker response boundary", () => {
  it("accepts exact owner lineage and public-only results", async () => {
    const { request, response } = await fixture();
    expect(await behaviorResponseError(response, request)).toBeNull();
    const { owner: _owner, ...publicResult } = response;
    expect(await behaviorResponseError(publicResult, { ...request, include_diagnostics: false, diagnostics_side: undefined })).toBeNull();
    expect(await behaviorResponseError(response, { ...request, include_diagnostics: false, diagnostics_side: undefined })).toMatch(/restricted channel/);
  });
  it("rejects private foreign events, trace and identity", async () => {
    const { request, response } = await fixture();
    expect(await behaviorResponseError({ ...response, owner: { ...response.owner, authorized_side: "defender" } }, request)).toMatch(/authorization/);
    expect(await behaviorResponseError({ ...response, owner: { ...response.owner, trace: [{ side: "defender" }] } }, request)).toMatch(/unauthorized decision trace/);
    const diagnostics = response.owner.diagnostics;
    expect(await behaviorResponseError({ ...response, owner: { ...response.owner, diagnostics: { ...diagnostics, events: [{ side: "defender" }] } } }, request)).toMatch(/unauthorized diagnostic events/);
  });
  it("rejects stale inputs, wrong Program, Match and diagnostic schema", async () => {
    const { request, response } = await fixture();
    expect(await behaviorResponseError(response, { ...request, behavior_inputs: { ...request.behavior_inputs, catalog_key: { changed: true } } })).toMatch(/complete immutable input/);
    expect(await behaviorResponseError({ ...response, result: { match_id: "other" } }, request)).toMatch(/submitted Match/);
    const diagnostics = response.owner.diagnostics;
    for (const identity of [{ ...diagnostics.identity, schema_version: 1 }, { ...diagnostics.identity, program_digest: "foreign" }]) {
      expect(await behaviorResponseError({ ...response, owner: { ...response.owner, diagnostics: { ...diagnostics, identity } } }, request)).toMatch(/authorized Program/);
    }
  });
});
