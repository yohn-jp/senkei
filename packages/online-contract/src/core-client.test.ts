import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { reproductionSnapshotDigest } from "../../../apps/web/src/worker/input-identity";
import type { SimulationResponse } from "../../../apps/web/src/contracts/core";
import type { AdmittedMatch } from "./index";
import { ReproducingCoreClientAdapter } from "./core-client";

async function fixture() {
  const result = { match_id: "match", outcome: "draw", termination_reason: "timeout", final_tick: 1, statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "a".repeat(64) };
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  const replay = { schema_version: { major: 1, minor: 0, patch: 0 }, match_id: "match", result_digest: digest, frames: [] };
  const snapshot = { attacker: { id: "attack" }, defender: { id: "defend" }, context: { match_id: "match" } };
  const snapshotDigest = await reproductionSnapshotDigest(snapshot as never);
  const match = { matchId: "match", snapshot, snapshotDigest, assets: { format_version: 1 } } as unknown as AdmittedMatch;
  const response = { outcome: { result, presentation_replay: replay } } as SimulationResponse;
  const core = { preflightReproduction: vi.fn(async () => {}), reproduce: vi.fn(async () => response) };
  return { match, response, core, adapter: new ReproducingCoreClientAdapter(core) };
}

describe("CoreClient authority adapter", () => {
  it("revalidates the retained input, requests only public output, and compares a full reproduction", async () => {
    const { match, core, adapter } = await fixture();
    const execution = await adapter.verifyAndExecute(match);
    await adapter.verifyResult(match, execution);
    await adapter.verifyPublicReplay(match, execution);
    expect(core.preflightReproduction).toHaveBeenCalledTimes(2);
    expect(core.reproduce).toHaveBeenCalledTimes(2);
    expect(core.reproduce).toHaveBeenCalledWith(match.snapshot, match.assets, match.snapshotDigest, { include_diagnostics: false });
  });
  it("rejects a changed input before invoking the core", async () => {
    const { match, core, adapter } = await fixture();
    await expect(adapter.verifyAndExecute({ ...match, snapshotDigest: "0".repeat(64) })).rejects.toThrow("Snapshot digest mismatch");
    expect(core.preflightReproduction).not.toHaveBeenCalled();
  });
  it("rejects unrequested owner channels and forged result digests", async () => {
    const { match, response, core, adapter } = await fixture();
    core.reproduce.mockResolvedValueOnce({ ...response, authorized_side: "attacker" });
    await expect(adapter.verifyAndExecute(match)).rejects.toThrow("restricted channel");
    const bad = structuredClone(response);
    (bad.outcome.presentation_replay as { result_digest: string }).result_digest = "0".repeat(64);
    core.reproduce.mockResolvedValueOnce(bad);
    await expect(adapter.verifyAndExecute(match)).rejects.toThrow("result digest");
  });
  it("rejects any modified stored public projection even when its result identity is unchanged", async () => {
    const { match, adapter } = await fixture();
    const execution = await adapter.verifyAndExecute(match);
    const altered = structuredClone(execution);
    (altered.publicReplay as unknown as { frames: unknown[] }).frames = [{ tick: 0, events: [], visible_state: null }];
    await expect(adapter.verifyPublicReplay(match, altered)).rejects.toThrow("differs from the reproduced core output");
  });
});
