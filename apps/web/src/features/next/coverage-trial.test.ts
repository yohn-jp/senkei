import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "../../contracts";
import { localTrialBehavior } from "../../contracts/next-production";
import { canonicalJson, sha256Hex } from "../../worker/input-identity";
import type { VerifiedCoverageRun } from "./coverage-observed";
import { trialBehaviorEvidence } from "./coverage-trial";
import { TrialBehaviorDetails } from "./TrialBehaviorDetails";

const field = (value: string) => ({ kind: "string" as const, value });

async function fixture() {
  const behavior = localTrialBehavior("rules-digest", ["F01"]);
  const policyDigest = await sha256Hex(canonicalJson(behavior.policy));
  const identity: DiagnosticEvent = { tick: 0, sequence: 0, side: "attacker", action_id: null, entity_id: "raw-hero",
    record: { kind: "runtime_notice", value: { code: "enbu.next_hero_identity", details: { slot_id: "slot-1", catalog_id: "F01" } } } };
  const trace: DiagnosticEvent = { tick: 3, sequence: 8, side: "attacker", action_id: "action-a", entity_id: "raw-hero",
    record: { kind: "runtime_notice", value: { code: "enbu.behavior_order_committed", details: {
      owner_replay_tick: "3", owner_replay_sequence: "0", next_policy_id: behavior.policy.policy_id, next_policy_digest: policyDigest,
      observation_digest: "b".repeat(64), decision_source: "default", eligible_candidates: "3", unknown_candidates: "1", selected_score: "0",
      profile_composition_json: JSON.stringify({ squad_id: "front", members: [{ actor: "raw-hero", catalog_id: "F01",
        values: [0, 1, 2, 3, 4, 5], sources: ["test_fallback_zero", "hero_catalog", "hero_instance", "army", "squad", "jinrei_conditional"] }],
      shared: [0, 1, 2, 3, 4, 5], baseline_effective: [0, 1, 2, 3, 4, 4], effective: [0, 1, 2, 3, 4, 5] }),
    } } } };
  const replay = { frames: [{ tick: 3, visible_state: { entities: { "visible-7": { entity_type: "hero", owner: "attacker", fields: {
    slot_id: field("slot-1"), catalog_id: field("F01"), squad: field("front"),
  } } }, global_fields: {} }, events: [{ event: "next.behavior_order_committed", entity: "visible-7", payload: {
    tick: { kind: "integer", value: 3 }, sequence: { kind: "integer", value: 0 }, action_id: field("action-a"),
  } }] }] };
  const run = { snapshot: { attacker: { configuration: { heroes: { kind: "list", value: [{ kind: "record", value: {
    slot_id: field("slot-1"), catalog_id: field("F01"), squad: field("front"),
  } }] } } }, context: { ruleset: { digest: "rules-digest" }, next_behavior: behavior } } };
  const verified = { status: "available", run, ownerReplay: replay, events: [identity, trace], trialPolicyDigest: policyDigest } as unknown as Extract<VerifiedCoverageRun, { status: "available" }>;
  return { verified, trace };
}

describe("Trial Behavior evidence", () => {
  it("displays actual six-domain composition with a test-only policy and unverified Observation content", async () => {
    const { verified, trace } = await fixture();
    const evidence = trialBehaviorEvidence(verified, trace);
    expect(evidence).not.toBeNull();
    expect(evidence?.rows[0]).toMatchObject({ domain: "navigation", catalogDefault: null, memberValue: 0, source: "test_fallback_zero", effectiveValue: 0 });
    expect(evidence?.unknownCandidates).toBe(1);
    expect(evidence?.selectedScore).toBe(0);
    const html = renderToStaticMarkup(createElement(TrialBehaviorDetails, { evidence: evidence! }));
    expect(html).toContain("test_fallback_zero".replaceAll("_", " "));
    expect(html).toContain("Observation content was not retained");
    expect(html).toContain("NOT CHECKED");
    expect(html).toContain("5 · changed");
    expect(html).toContain("0 · unchanged");
  });

  it("rejects stale policy, owner, observation and roster identities", async () => {
    const { verified, trace } = await fixture();
    expect(trialBehaviorEvidence({ ...verified, trialPolicyDigest: "other" }, trace)).toBeNull();
    expect(trialBehaviorEvidence({ ...verified, events: [trace] }, trace)).toBeNull();
    expect(trialBehaviorEvidence(verified, { ...trace, side: "defender" })).toBeNull();
    expect(trialBehaviorEvidence(verified, { ...trace, sequence: 100 })).toBeNull();
    const notice = trace.record;
    if (notice.kind !== "runtime_notice") throw new Error("fixture");
    const wrongObservation = { ...trace, record: { ...notice, value: { ...notice.value,
      details: { ...notice.value.details, observation_digest: "not-a-digest" } } } };
    expect(trialBehaviorEvidence({ ...verified, events: [verified.events[0], wrongObservation] }, wrongObservation)).toBeNull();
    const ambiguous = { ...verified, ownerReplay: { ...verified.ownerReplay, frames: [...verified.ownerReplay.frames, verified.ownerReplay.frames[0]] } };
    expect(trialBehaviorEvidence(ambiguous, trace)).toBeNull();
  });

  it("accepts a scoped WAIT without inventing an action or score", async () => {
    const { verified, trace } = await fixture();
    if (trace.record.kind !== "runtime_notice") throw new Error("fixture");
    const details: Record<string, string> = { ...trace.record.value.details, decision_source: "wait" };
    delete details.selected_score;
    const wait: DiagnosticEvent = { ...trace, action_id: null, record: { kind: "runtime_notice", value: { code: "enbu.behavior_wait", details } } };
    const evidence = trialBehaviorEvidence({ ...verified, events: [verified.events[0], wait] }, wait);
    expect(evidence).toMatchObject({ decisionSource: "wait", selectedScore: null, unknownCandidates: 1 });
  });

  it("rejects malformed compositions and scores rather than substituting values", async () => {
    const { verified, trace } = await fixture();
    if (trace.record.kind !== "runtime_notice") throw new Error("fixture");
    const details = trace.record.value.details;
    const composition = JSON.parse(details.profile_composition_json);
    composition.shared[0] = 0.5;
    const malformed: DiagnosticEvent = { ...trace, record: { kind: "runtime_notice", value: { code: trace.record.value.code,
      details: { ...details, profile_composition_json: JSON.stringify(composition) } } } };
    expect(trialBehaviorEvidence({ ...verified, events: [verified.events[0], malformed] }, malformed)).toBeNull();
    const score: DiagnosticEvent = { ...trace, record: { kind: "runtime_notice", value: { code: trace.record.value.code,
      details: { ...details, selected_score: " " } } } };
    expect(trialBehaviorEvidence({ ...verified, events: [verified.events[0], score] }, score)).toBeNull();
  });

  it("keeps an older Run's missing baseline unavailable", async () => {
    const { verified, trace } = await fixture();
    if (trace.record.kind !== "runtime_notice") throw new Error("fixture");
    const composition = JSON.parse(trace.record.value.details.profile_composition_json);
    delete composition.baseline_effective;
    const legacy: DiagnosticEvent = { ...trace, record: { kind: "runtime_notice", value: { code: trace.record.value.code,
      details: { ...trace.record.value.details, profile_composition_json: JSON.stringify(composition) } } } };
    const evidence = trialBehaviorEvidence({ ...verified, events: [verified.events[0], legacy] }, legacy);
    expect(evidence?.rows.every(row => row.baselineValue === null)).toBe(true);
    const html = renderToStaticMarkup(createElement(TrialBehaviorDetails, { evidence: evidence! }));
    expect(html).not.toContain("· changed");
    expect(html).not.toContain("· unchanged");
  });
});
