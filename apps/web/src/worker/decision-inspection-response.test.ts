import { describe, expect, it } from "vitest";
import type { SimulationSnapshot } from "../contracts/core";
import type { CombatantSide } from "../contracts/core-model";
import type { NextDecisionInspection, NextDecisionInspectionRequest } from "../contracts/next-decision-inspection";
import { localTrialBehavior } from "../contracts/next-production";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "./input-identity";
import { decisionInspectionResponseError } from "./decision-inspection-response";

async function fixture(side: CombatantSide = "attacker") {
  const snapshot = { attacker: {}, defender: {}, context: { next_behavior: localTrialBehavior("a".repeat(64), ["F01"]) } } as unknown as SimulationSnapshot;
  const snapshot_digest = await reproductionSnapshotDigest(snapshot);
  const request = { format_version: 1, assets: {}, snapshot, snapshot_digest, authorized_side: side,
    selector: { tick: 1, slot_id: "slot-1" } } as unknown as NextDecisionInspectionRequest;
  const response: NextDecisionInspection = { format_version: 1, identity: { snapshot_digest, result_digest: "b".repeat(64), authorized_side: side,
    selector: request.selector, inspection_digest: await sha256Hex(canonicalJson({ format_version: 1, snapshot_digest, authorized_side: side, selector: request.selector })) },
    policy: { id: snapshot.context.next_behavior!.policy.policy_id, digest: await sha256Hex(canonicalJson(snapshot.context.next_behavior!.policy)) },
    observation: { identity_space: "inspection_observed", source_digest: "c".repeat(64), snapshot: { tick: 1, side,
      fields: { missing: { status: "unknown" }, zero: { status: "known", value: { kind: "integer", value: 0 } } },
      collections: { visible: { status: "known", value: [{ id: "observed-1", entity_type: "hero", fields: { target: { status: "known", value: { kind: "entity", value: "observed-2" } } } }] } } } },
    decision: { status: "evaluated", subject: "observed-1", composition: null,
      candidates: [{ index: 0, actor: "observed-1", target: "observed-2", kind: "target", capability: "select_target",
        arguments: [{ kind: "entity", value: "observed-2" }], outcome: "selected", score: 0, rank: 0,
        terms: [{ domain: "targeting", kind: "signal", signal: "target_health_percent", weight: 1, value: null, contribution: null }] }],
      selections: [{ source: "default", actor: "observed-1", capability: "select_target", arguments: [{ kind: "entity", value: "observed-2" }],
        target: "observed-2", score: 0, candidate_index: 0, arbitration_accepted: true, transition_completed: true, committed_event: { tick: 1, sequence: 0 } }] } };
  return { request, response };
}

describe("decision inspection Worker boundary", () => {
  it("accepts both authorized sides and known zero/unknown observations", async () => {
    for (const side of ["attacker", "defender"] as const) {
      const { request, response } = await fixture(side);
      expect(await decisionInspectionResponseError(response, request)).toBeNull();
    }
  });
  it("rejects stale snapshot, selector, side, policy and malformed result identity", async () => {
    const { request, response } = await fixture();
    for (const altered of [
      { ...response, identity: { ...response.identity, authorized_side: "defender" as const } },
      { ...response, identity: { ...response.identity, snapshot_digest: "x" } },
      { ...response, identity: { ...response.identity, selector: { ...request.selector, tick: 2 } } },
      { ...response, identity: { ...response.identity, inspection_digest: "x" } },
      { ...response, identity: { ...response.identity, result_digest: "x" } },
      { ...response, policy: { ...response.policy, digest: "x" } },
    ]) expect(await decisionInspectionResponseError(altered, request)).not.toBeNull();
  });
  it("rejects undeclared payload fields and raw IDs at every projected boundary", async () => {
    const { request, response } = await fixture();
    const snapshot = response.observation.snapshot!, candidate = response.decision.candidates[0], selection = response.decision.selections[0];
    for (const altered of [
      { ...response, leak: "secret" },
      { ...response, identity: { ...response.identity, leak: "secret" } },
      { ...response, observation: { ...response.observation, snapshot: { ...snapshot, leak: "secret" } } },
      { ...response, observation: { ...response.observation, snapshot: { ...snapshot, fields: { x: { status: "unknown", value: "secret" } } } } },
      { ...response, observation: { ...response.observation, snapshot: { ...snapshot, fields: { x: { status: "known", value: { kind: "entity", value: "raw-enemy" } } } } } },
      { ...response, decision: { ...response.decision, candidates: [{ ...candidate, leak: "secret" }] } },
      { ...response, decision: { ...response.decision, candidates: [{ ...candidate, arguments: [{ kind: "entity", value: "visible-1" }] }] } },
      { ...response, decision: { ...response.decision, selections: [{ ...selection, arguments: [{ kind: "entity", value: "raw-enemy" }] }] } },
      { ...response, decision: { ...response.decision, selections: [{ ...selection, committed_event: { tick: 1, sequence: 0, leak: "secret" } }] } },
    ]) expect(await decisionInspectionResponseError(altered, request)).not.toBeNull();
  });
  it("fails closed on duplicate candidates and an unrecognized commit reference", async () => {
    const { request, response } = await fixture();
    const candidate = response.decision.candidates[0], selection = response.decision.selections[0];
    expect(await decisionInspectionResponseError({ ...response, decision: { ...response.decision, candidates: [candidate, candidate] } }, request)).not.toBeNull();
    expect(await decisionInspectionResponseError({ ...response, decision: { ...response.decision, selections: [{ ...selection, candidate_index: 9 }] } }, request)).not.toBeNull();
    expect(await decisionInspectionResponseError({ ...response, decision: { ...response.decision, selections: [{ ...selection, committed_event: { tick: 2, sequence: 0 } }] } }, request)).not.toBeNull();
  });
});
