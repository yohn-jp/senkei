import { describe, expect, it, vi } from "vitest";
import {
  admitMatch, executeAdmittedMatch, inquireMatch, readPublishedMatch,
  type AdmittedMatch, type ExecutionOutput, type FinalizedMatch,
  type MatchRequest, type OfficialMatchPorts, type SettlementReceipt,
} from "./index";

const digest = (character: string) => character.repeat(64);
const v = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "rules", version: v, digest: digest("a") };
const world = {
  world_id: "world", schema_version: v, compiler_version: v, minimum_compiler: v,
  maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null,
  logic_digest: digest("b"), presentation_digest: digest("c"),
};
const request: MatchRequest = { requestId: "request", idempotencyKey: "key", attacker: { id: "attack", revision: "1" }, defenseRegistrationId: "defense-registration" };

function fixture(): { match: AdmittedMatch; execution: ExecutionOutput; receipt: SettlementReceipt } {
  const match = {
    authorityId: "authority", matchId: "match", request, attackerPlayerId: "alice", defenderPlayerId: "bob",
    snapshotDigest: digest("d"),
    snapshot: {
      attacker: { id: "attack", revision: "1", ruleset, program: { ruleset, content_digest: digest("e") }, configuration: {}, initial_memory: {} },
      defender: { id: "defend", revision: "4", ruleset, program: { ruleset, content_digest: digest("f") }, configuration: {}, initial_memory: {} },
      context: { match_id: "match", ruleset, world_identity: world, versions: { replay_schema: v }, max_ticks: 100 },
    },
    assets: { format_version: 1, rule_package: { ruleset }, world_definition: { world: "definition" } },
  } as unknown as AdmittedMatch;
  const execution = {
    snapshotDigest: digest("d"), resultDigest: digest("1"),
    result: { match_id: "match", outcome: "attacker_victory", termination_reason: "victory", final_tick: 10, statistics: {}, cu_spent: { attacker: 12, defender: 22 }, final_state_digest: digest("2") },
    publicReplay: { schema_version: v, match_id: "match", result_digest: digest("1"), ruleset, world_identity: world, frames: [{ tick: 10, events: [{ event: "visible", entity: null, payload: { hp: { kind: "integer", value: 1 } } }], visible_state: null }] },
  } as ExecutionOutput;
  const receipt = { authorityId: "authority", matchId: "match", requestId: "request", idempotencyKey: "key", snapshotDigest: digest("d"), resultDigest: digest("1"), settlementId: "settlement", provenance: "server-proof" };
  return { match, execution, receipt };
}

function harness() {
  const { match, execution, receipt } = fixture();
  let stored: FinalizedMatch | null = null;
  let applied = 0;
  const ports = {
    authorityId: "authority",
    authentication: { authenticate: vi.fn(async (credential: string) => {
      if (credential !== "valid") throw new Error("Bad credentials");
      return { playerId: "alice", identityAuthorityId: "identity-provider" };
    }) },
    admission: {
      admit: vi.fn(async () => match),
      loadAdmitted: vi.fn(async () => match),
    },
    core: {
      verifyAndExecute: vi.fn(async (_match: AdmittedMatch) => execution),
      verifyResult: vi.fn(async () => {}),
      verifyPublicReplay: vi.fn(async () => {}),
    },
    settlement: {
      finalize: vi.fn(async (m: AdmittedMatch, e: ExecutionOutput) => {
        if (stored) {
          if (stored.match.snapshotDigest !== m.snapshotDigest || stored.execution.resultDigest !== e.resultDigest) throw new Error("Conflicting settlement");
          return { status: "committed" as const, receipt: stored.receipt };
        }
        applied++;
        stored = { match: m, execution: e, receipt };
        return { status: "committed" as const, receipt };
      }),
      readFinalized: vi.fn(async () => stored),
      inquire: vi.fn(async () => stored ? { status: "committed" as const, receipt: stored.receipt } : { status: "outcome_unknown" as const }),
    },
    replayAccess: { mayRead: vi.fn(async () => true) },
  } satisfies OfficialMatchPorts<string>;
  return { ports, match, execution, receipt, applied: () => applied };
}

describe("official Match boundary", () => {
  it("authenticates before admission and exposes only a Match reference", async () => {
    const { ports, match } = harness();
    await expect(admitMatch(ports, "invalid", request)).rejects.toThrow("Bad credentials");
    expect(ports.admission.admit).not.toHaveBeenCalled();
    expect(await admitMatch(ports, "valid", request)).toEqual({ matchId: "match" });
    expect(ports.admission.admit).toHaveBeenCalledWith({ playerId: "alice", identityAuthorityId: "identity-provider" }, request);
    ports.admission.admit.mockResolvedValueOnce({ ...match, attackerPlayerId: "bob" });
    await expect(admitMatch(ports, "valid", request)).rejects.toThrow("Admission identity mismatch");
    ports.admission.admit.mockResolvedValueOnce({ ...match, request: { ...request, idempotencyKey: "other" } });
    await expect(admitMatch(ports, "valid", request)).rejects.toThrow("Admission identity mismatch");
  });

  it("rejects client-supplied result or ownership claims before admission", async () => {
    const { ports } = harness();
    await expect(admitMatch(ports, "valid", { ...request, result: "attacker_victory" } as MatchRequest)).rejects.toThrow("Unexpected contract field");
    await expect(admitMatch(ports, "valid", { ...request, attacker: { ...request.attacker, owner: "alice" } } as MatchRequest)).rejects.toThrow("Unexpected contract field");
    expect(ports.authentication.authenticate).not.toHaveBeenCalled();
    expect(ports.admission.admit).not.toHaveBeenCalled();
  });

  it("rejects a mismatched RulePackage or missing paired World before executing", async () => {
    const { ports, match } = harness();
    const badRule = structuredClone(match);
    (badRule.snapshot.defender as { ruleset: unknown }).ruleset = { ...ruleset, digest: digest("9") };
    ports.admission.loadAdmitted.mockResolvedValueOnce(badRule);
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow("RulePackage identity mismatch");
    const badWorld = structuredClone(match);
    (badWorld.snapshot.context as { world_identity?: unknown }).world_identity = undefined;
    ports.admission.loadAdmitted.mockResolvedValueOnce(badWorld);
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow("Missing paired World identity");
    const badCompiler = structuredClone(match);
    (badCompiler.snapshot.context as { world_identity?: unknown }).world_identity = { ...world, compiler_version: { major: 0, minor: 0, patch: 0 } };
    ports.admission.loadAdmitted.mockResolvedValueOnce(badCompiler);
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow("Incompatible World compiler");
    expect(ports.core.verifyAndExecute).not.toHaveBeenCalled();
    expect(ports.settlement.finalize).not.toHaveBeenCalled();
  });

  it("freezes retained input, verifies the core output, and makes duplicate completion idempotent through the atomic port", async () => {
    const { ports, applied } = harness();
    ports.core.verifyAndExecute.mockImplementation(async (match) => {
      expect(Object.isFrozen(match.snapshot.attacker)).toBe(true);
      return fixture().execution;
    });
    const first = await executeAdmittedMatch(ports, "match");
    const second = await executeAdmittedMatch(ports, "match");
    expect(first).toEqual(second);
    expect(first.status).toBe("committed");
    expect(applied()).toBe(1);
    expect(ports.core.verifyResult).toHaveBeenCalledTimes(2);
    expect(ports.core.verifyPublicReplay).toHaveBeenCalledTimes(2);
    const changed = structuredClone(fixture().execution);
    (changed as { resultDigest: string }).resultDigest = digest("3");
    (changed.publicReplay as { result_digest: string }).result_digest = digest("3");
    ports.core.verifyAndExecute.mockResolvedValueOnce(changed);
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow("Conflicting settlement");
    expect(applied()).toBe(1);
  });

  it.each([
    ["input digest", (e: ExecutionOutput) => { (e as { snapshotDigest: string }).snapshotDigest = digest("9"); }],
    ["result Match", (e: ExecutionOutput) => { (e.result as { match_id: string }).match_id = "other"; }],
    ["replay result", (e: ExecutionOutput) => { (e.publicReplay as { result_digest: string }).result_digest = digest("9"); }],
    ["paired World", (e: ExecutionOutput) => { (e.publicReplay as { world_identity: unknown }).world_identity = { ...world, presentation_digest: digest("9") }; }],
    ["owner replay", (e: ExecutionOutput) => { (e.publicReplay as { perspective?: string }).perspective = "attacker"; }],
    ["private field", (e: ExecutionOutput) => { (e.publicReplay.frames[0] as unknown as { source: string }).source = "secret program"; }],
    ["private nested field", (e: ExecutionOutput) => { (e.publicReplay.frames[0].events[0].payload.hp as unknown as { memory: string }).memory = "secret"; }],
  ])("rejects %s before settlement", async (_label, mutate) => {
    const { ports, execution } = harness();
    const bad = structuredClone(execution);
    mutate(bad);
    ports.core.verifyAndExecute.mockResolvedValueOnce(bad);
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow();
    expect(ports.settlement.finalize).not.toHaveBeenCalled();
  });

  it("requires independent core result and public-projection checks before settlement", async () => {
    const first = harness();
    first.ports.core.verifyResult.mockRejectedValueOnce(new Error("Result digest mismatch"));
    await expect(executeAdmittedMatch(first.ports, "match")).rejects.toThrow("Result digest mismatch");
    expect(first.ports.settlement.finalize).not.toHaveBeenCalled();
    const second = harness();
    second.ports.core.verifyPublicReplay.mockRejectedValueOnce(new Error("Nonpublic event"));
    await expect(executeAdmittedMatch(second.ports, "match")).rejects.toThrow("Nonpublic event");
    expect(second.ports.settlement.finalize).not.toHaveBeenCalled();
  });

  it("does not turn an ambiguous settlement into a committed result", async () => {
    const { ports } = harness();
    ports.settlement.finalize.mockResolvedValueOnce({ status: "outcome_unknown" } as never);
    expect(await executeAdmittedMatch(ports, "match")).toEqual({ status: "outcome_unknown" });
    expect(await inquireMatch(ports, "match")).toEqual({ status: "outcome_unknown" });
    expect(await readPublishedMatch(ports, "match", { kind: "anonymous" })).toBeNull();
  });

  it("rejects a committed receipt for another input and a missing finalized record during inquiry", async () => {
    const { ports, receipt } = harness();
    ports.settlement.finalize.mockResolvedValueOnce({ status: "committed", receipt: { ...receipt, snapshotDigest: digest("9") } });
    await expect(executeAdmittedMatch(ports, "match")).rejects.toThrow("Settlement receipt identity mismatch");
    ports.settlement.inquire.mockResolvedValueOnce({ status: "committed", receipt });
    await expect(inquireMatch(ports, "match")).rejects.toThrow("Committed Match record is missing");
  });

  it("authorizes reading separately and never publishes private input, diagnostics or CU", async () => {
    const { ports } = harness();
    await executeAdmittedMatch(ports, "match");
    ports.replayAccess.mayRead.mockResolvedValueOnce(false);
    await expect(readPublishedMatch(ports, "match", { kind: "anonymous" })).rejects.toThrow("Replay access denied");
    expect(ports.settlement.readFinalized).not.toHaveBeenCalled();
    const published = await readPublishedMatch(ports, "match", { kind: "player", credentials: "valid" });
    expect(published).toEqual({ result: { matchId: "match", outcome: "attacker_victory", terminationReason: "victory", finalTick: 10, resultDigest: digest("1") }, replay: fixture().execution.publicReplay });
    expect(JSON.stringify(published)).not.toMatch(/snapshot|program|cu_spent|diagnostic/);
    expect(ports.replayAccess.mayRead).toHaveBeenLastCalledWith("match", { kind: "player", principal: { playerId: "alice", identityAuthorityId: "identity-provider" } });
    expect((await inquireMatch(ports, "match")).status).toBe("committed");
  });
});
