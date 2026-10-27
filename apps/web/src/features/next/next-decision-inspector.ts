import type { DomainValue, PresentationReplay } from "../../contracts";
import type { NextDecisionInspection, NextDecisionInspectionRequest, NextDecisionInspectionSelection } from "../../contracts/next-decision-inspection";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "../../worker/input-identity";
import { decisionInspectionResponseError } from "../../worker/decision-inspection-response";
import type { CoverageRun } from "./coverage-observed";
import { validateNextExperimentAuthorization, validateNextExperimentDiagnostics, validateNextExperimentReplay } from "./experiment-restoration";

export type VerifiedDecisionRun =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly run: CoverageRun; readonly ownerReplay: PresentationReplay;
      readonly snapshotDigest: string; readonly resultDigest: string; readonly policyId: string; readonly policyDigest: string;
      readonly testOnly: boolean; readonly maxTick: number; readonly slots: readonly { readonly slotId: string; readonly catalogId: string }[] };
type AvailableRun = Extract<VerifiedDecisionRun, { status: "available" }>;
const unavailable = (reason: string): VerifiedDecisionRun => ({ status: "unavailable", reason });
const stringValue = (value: DomainValue | undefined): string | null =>
  value && (value.kind === "string" || value.kind === "enum" || value.kind === "entity") ? value.value : null;

/** Bind the inspection to the retained Run, not the mutable workspace or current Catalog. */
export async function verifyDecisionRun(run: CoverageRun | null): Promise<VerifiedDecisionRun> {
  if (!run?.includeDiagnostics || !run.response.restricted_diagnostics) return unavailable("An owner-authorized completed Run is required.");
  try {
    validateNextExperimentAuthorization(run.response, true);
    await validateNextExperimentDiagnostics(run.response, run.snapshot);
    const publicReplay = run.response.outcome.presentation_replay;
    const ownerReplay = run.response.owner_replays?.attacker;
    const result = run.response.outcome.result;
    if (!ownerReplay || ownerReplay.perspective !== "attacker") return unavailable("The attacker owner Replay is unavailable.");
    await Promise.all([
      validateNextExperimentReplay(publicReplay, result, run.snapshot.context.match_id),
      validateNextExperimentReplay(ownerReplay, result, run.snapshot.context.match_id),
    ]);
    const ruleset = run.snapshot.context.ruleset;
    const world = run.snapshot.context.world_identity;
    if ([run.snapshot.attacker.ruleset, run.snapshot.defender.ruleset, run.reproductionAssets.rule_package.ruleset,
      publicReplay.ruleset, ownerReplay.ruleset].some(value => !value || canonicalJson(value) !== canonicalJson(ruleset))
      || !world || [publicReplay.world_identity, ownerReplay.world_identity, run.reproductionAssets.rule_package.next?.world_identity]
        .some(value => !value || canonicalJson(value) !== canonicalJson(world))) {
      return unavailable("The retained Run, Replays and RulePackage do not share the same Rule and World identities.");
    }
    const policy = run.snapshot.context.next_behavior?.policy;
    if (!policy || policy.schema_version !== 1 || !policy.policy_id || policy.ruleset_digest !== ruleset.digest) {
      return unavailable("The frozen Run has no compatible Next Behavior policy.");
    }
    const roster = run.snapshot.attacker.configuration?.heroes;
    if (roster?.kind !== "list") return unavailable("The frozen owner roster is unavailable.");
    const slots = roster.value.map(entry => entry.kind === "record" ? {
      slotId: stringValue(entry.value.slot_id), catalogId: stringValue(entry.value.catalog_id),
    } : { slotId: null, catalogId: null });
    if (!slots.length || slots.some(slot => !slot.slotId || !slot.catalogId || new TextEncoder().encode(slot.slotId).length > 48)
      || new Set(slots.map(slot => slot.slotId)).size !== slots.length) return unavailable("The frozen owner roster is ambiguous.");
    if (!Number.isSafeInteger(result.final_tick) || result.final_tick < 1 || !Number.isSafeInteger(run.snapshot.context.max_ticks)) {
      return unavailable("This Run has no inspectable decision Tick.");
    }
    return { status: "available", run, ownerReplay, snapshotDigest: await reproductionSnapshotDigest(run.snapshot),
      resultDigest: publicReplay.result_digest, policyId: policy.policy_id, policyDigest: await sha256Hex(canonicalJson(policy)),
      testOnly: policy.test_only, maxTick: Math.min(result.final_tick, run.snapshot.context.max_ticks),
      slots: slots as { slotId: string; catalogId: string }[] };
  } catch {
    return unavailable("The owner authorization or immutable Run identity could not be verified.");
  }
}

export function decisionInspectionRequest(run: AvailableRun, tick: number, slotId: string): NextDecisionInspectionRequest | null {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > run.maxTick || !run.slots.some(slot => slot.slotId === slotId)) return null;
  return { format_version: 1, assets: run.run.reproductionAssets, snapshot: run.run.snapshot, snapshot_digest: run.snapshotDigest,
    authorized_side: "attacker", selector: { tick, slot_id: slotId } };
}

/** The Worker validates projection and request identity; this adds the retained Run result identity. */
export async function verifyDecisionInspection(run: AvailableRun, request: NextDecisionInspectionRequest, response: NextDecisionInspection): Promise<boolean> {
  return request.authorized_side === "attacker" && request.snapshot_digest === run.snapshotDigest
    && !!decisionInspectionRequest(run, request.selector.tick, request.selector.slot_id)
    && await decisionInspectionResponseError(response, request) === null
    && response.identity.result_digest === run.resultDigest;
}

/** The anonymous inspection IDs are never compared with Replay IDs. */
export function decisionCommittedReplayTick(run: AvailableRun, selection: NextDecisionInspectionSelection): number | null {
  const event = selection.committed_event;
  if (!event) return null;
  const frames = run.ownerReplay.frames.filter(frame => frame.tick === event.tick);
  if (frames.length !== 1) return null;
  const matches = frames[0].events.filter(item => item.event === "next.behavior_order_committed"
    && item.payload.tick?.kind === "integer" && item.payload.tick.value === event.tick
    && item.payload.sequence?.kind === "integer" && item.payload.sequence.value === event.sequence);
  return matches.length === 1 ? event.tick : null;
}

export function decisionValueText(value: DomainValue): string {
  if (value.kind === "null") return "null";
  if (value.kind === "fixed") return `${value.value.coefficient} × 10^−${value.value.scale}`;
  if (value.kind === "list" || value.kind === "record") return JSON.stringify(value.value);
  return String(value.value);
}
