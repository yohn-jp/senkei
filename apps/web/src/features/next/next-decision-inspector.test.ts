import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MatchResult, SimulationSnapshot } from "../../contracts";
import type { NextDecisionInspection } from "../../contracts/next-decision-inspection";
import { localTrialBehavior } from "../../contracts/next-production";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "../../worker/input-identity";
import type { CoverageRun } from "./coverage-observed";
import { DecisionInspectionResult, NextDecisionInspector } from "./NextDecisionInspector";
import { decisionCommittedReplayTick, decisionInspectionRequest, verifyDecisionInspection, verifyDecisionRun } from "./next-decision-inspector";

const version = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "rules", version, digest: "a".repeat(64) };
const world = { world_id: "world", schema_version: version, compiler_version: version, minimum_compiler: version,
  maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null,
  logic_digest: "b".repeat(64), presentation_digest: "c".repeat(64) };
const result: MatchResult = { match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7,
  statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest" };
const resultDigest = "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b";
const field = (value: string) => ({ kind: "string" as const, value });

async function validRun(): Promise<CoverageRun> {
  const snapshot = { attacker: { ruleset, program: { content_digest: "program" }, configuration: { heroes: { kind: "list", value: [
    { kind: "record", value: { slot_id: field("slot-1"), catalog_id: field("F01") } },
  ] } } }, defender: { ruleset }, context: { match_id: "match-a", ruleset, world_identity: world, max_ticks: 10,
    next_behavior: localTrialBehavior(ruleset.digest, ["F01"]) } } as unknown as SimulationSnapshot;
  const replay = { schema_version: version, match_id: "match-a", result_digest: resultDigest, ruleset, world_identity: world, frames: [] };
  const owner = { ...replay, perspective: "attacker", frames: [{ tick: 2, visible_state: null, events: [{ event: "next.behavior_order_committed",
    entity: "visible-1", payload: { tick: { kind: "integer", value: 2 }, sequence: { kind: "integer", value: 4 } } }] }] };
  return { snapshot, includeDiagnostics: true, sourceReplay: replay, reproductionAssets: { format_version: 1, rule_package: { ruleset, next: { world_identity: world } }, world_definition: {} },
    response: { authorized_side: "attacker", outcome: { result, presentation_replay: replay }, owner_replays: { attacker: owner },
      restricted_diagnostics: { identity: { schema_version: 1, side: "attacker", match_id: "match-a", result_digest: resultDigest,
        snapshot_digest: await reproductionSnapshotDigest(snapshot), program_digest: "program" }, events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } } },
  } as unknown as CoverageRun;
}

async function setup() {
  const run = await validRun();
  const verified = await verifyDecisionRun(run);
  if (verified.status !== "available") throw new Error(verified.reason);
  const request = decisionInspectionRequest(verified, 2, "slot-1")!;
  const response: NextDecisionInspection = { format_version: 1,
    identity: { snapshot_digest: verified.snapshotDigest, result_digest: verified.resultDigest, authorized_side: "attacker", selector: request.selector,
      inspection_digest: await sha256Hex(canonicalJson({ format_version: 1, snapshot_digest: verified.snapshotDigest, authorized_side: "attacker", selector: request.selector })) },
    policy: { id: verified.policyId, digest: verified.policyDigest },
    observation: { identity_space: "inspection_observed", source_digest: "d".repeat(64), snapshot: { tick: 2, side: "attacker",
      fields: { zero: { status: "known", value: { kind: "integer", value: 0 } }, absent: { status: "unknown" },
        boolean: { status: "known", value: { kind: "bool", value: false } } },
      collections: { heroes: { status: "known", value: [{ id: "observed-1", entity_type: "hero", fields: { self: { status: "known", value: { kind: "entity", value: "observed-1" } } } }] } } } },
    decision: { status: "evaluated", subject: "observed-1", composition: { squad_id: "squad", members: [{ actor: "observed-1", catalog_id: "F01", values: [0, 0, 0, 0, 0, 0], sources: ["army", "army", "army", "army", "army", "army"] }], shared: [0, 0, 0, 0, 0, 0], baseline_effective: [0, 0, 0, 0, 0, 0], effective: [0, 0, 0, 0, 0, 0] },
      candidates: [{ index: 0, actor: "observed-1", target: "observed-2", kind: "target", capability: "select_target", arguments: [{ kind: "entity", value: "observed-1" }], outcome: "selected", score: 0, rank: 1,
        terms: [{ domain: "targeting", kind: "signal", signal: "target_health_percent", weight: 0, value: null, contribution: null }] }],
      selections: [{ source: "default", actor: "observed-1", target: "observed-2", capability: "select_target", arguments: [{ kind: "entity", value: "observed-1" }], score: 0, candidate_index: 0,
        arbitration_accepted: true, transition_completed: true, committed_event: { tick: 2, sequence: 4 } }] } };
  return { run, verified, request, response };
}

describe("owner Next decision inspection", () => {
  it("binds inspection to the retained authorized Run, policy, snapshot, Tick and Hero", async () => {
    const { run, verified, request, response } = await setup();
    expect(await verifyDecisionInspection(verified, request, response)).toBe(true);
    expect(decisionInspectionRequest(verified, 0, "slot-1")).toBeNull();
    expect(decisionInspectionRequest(verified, 8, "slot-1")).toBeNull();
    expect(decisionInspectionRequest(verified, 2, "other")).toBeNull();
    const identity = response.identity;
    for (const wrong of [
      { ...response, identity: { ...identity, authorized_side: "defender" as const } },
      { ...response, identity: { ...identity, snapshot_digest: "other" } },
      { ...response, identity: { ...identity, result_digest: "other" } },
      { ...response, identity: { ...identity, inspection_digest: "other" } },
      { ...response, identity: { ...identity, selector: { tick: 3, slot_id: "slot-1" } } },
      { ...response, policy: { ...response.policy, digest: "other" } },
    ]) expect(await verifyDecisionInspection(verified, request, wrong)).toBe(false);
    expect((await verifyDecisionRun({ ...run, includeDiagnostics: false })).status).toBe("unavailable");
    expect((await verifyDecisionRun({ ...run, response: { ...run.response, authorized_side: "defender" } })).status).toBe("unavailable");
    const mutated = { ...request, snapshot: { ...request.snapshot, context: { ...request.snapshot.context, max_ticks: 9 } } };
    expect(await verifyDecisionInspection(verified, mutated, response)).toBe(false);
  });

  it("rejects raw or Replay IDs in projected observation and candidate data", async () => {
    const { verified, request, response } = await setup();
    const candidate = response.decision.candidates[0];
    expect(await verifyDecisionInspection(verified, request, { ...response, decision: { ...response.decision,
      candidates: [{ ...candidate, actor: "visible-1" }] } })).toBe(false);
    expect(await verifyDecisionInspection(verified, request, { ...response, decision: { ...response.decision,
      candidates: [{ ...candidate, arguments: [{ kind: "entity", value: "raw-enemy" }] }] } })).toBe(false);
    const observation = response.observation.snapshot!;
    expect(await verifyDecisionInspection(verified, request, { ...response, observation: { ...response.observation,
      snapshot: { ...observation, fields: { leaked: { status: "known", value: { kind: "entity", value: "raw-enemy" } } } } } })).toBe(false);
    expect(await verifyDecisionInspection(verified, request, { ...response, observation: { ...response.observation,
      snapshot: { ...observation, side: "defender" } } })).toBe(false);
  });

  it("keeps known zero and false, unknowns, and commit separate from selection", async () => {
    const { verified, response } = await setup();
    expect(decisionCommittedReplayTick(verified, response.decision.selections[0])).toBe(2);
    expect(decisionCommittedReplayTick({ ...verified, ownerReplay: { ...verified.ownerReplay, frames: [] } }, response.decision.selections[0])).toBeNull();
    const html = renderToStaticMarkup(createElement(DecisionInspectionResult, { inspection: response, verified, onReplayTick: vi.fn() }));
    expect(html).toContain("UNKNOWN"); expect(html).toContain(">0</dd>"); expect(html).toContain(">false</dd>");
    expect(html).toContain("arbitration accepted: yes"); expect(html).toContain("transition completed: yes");
    expect(html).toContain("Tick 2, sequence 4"); expect(html).toContain("Open committed Tick in Replay");
    expect(html).toContain("not Replay IDs"); expect(html).toContain("not independently proven");
  });

  it("initially exposes no unverified Run or automatically executed inspection", () => {
    const inspectNextDecision = vi.fn();
    const html = renderToStaticMarkup(createElement(NextDecisionInspector, { core: { inspectNextDecision } as never, run: null }));
    expect(html).toContain("Checking owner Run identity");
    expect(html).not.toContain("observed-1"); expect(inspectNextDecision).not.toHaveBeenCalled();
  });
});
