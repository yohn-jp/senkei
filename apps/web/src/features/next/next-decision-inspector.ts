import type { DomainValue, PresentationReplay } from "../../contracts";
import type { NextDecisionInspection, NextDecisionInspectionRequest, NextDecisionInspectionSelection } from "../../contracts/next-decision-inspection";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "../../worker/input-identity";
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

const alias = (value: unknown): value is string => typeof value === "string" && /^observed-[1-9][0-9]*$/.test(value);
const optionalAlias = (value: unknown): boolean => value === null || alias(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const optionalInteger = (value: unknown): boolean => value === null || integer(value);
const digest = (value: unknown): boolean => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const domains = new Set(["navigation", "engagement", "targeting", "pursuit", "survival", "objective"]);
const signals = new Set(["constant", "actor_health_percent", "target_health_percent", "target_proximity", "observed_danger", "objective_value", "route_cost", "squad_health_percent", "candidate_move", "candidate_pursue", "candidate_retreat", "candidate_target"]);

function projectedValue(value: DomainValue): boolean {
  if (!value || typeof value !== "object") return false;
  switch (value.kind) {
    case "null": return true;
    case "bool": return typeof value.value === "boolean";
    case "integer": return integer(value.value);
    case "fixed": return !!value.value && integer(value.value.coefficient) && integer(value.value.scale);
    case "string": case "enum": return typeof value.value === "string";
    case "entity": return alias(value.value);
    case "list": return Array.isArray(value.value) && value.value.every(projectedValue);
    case "record": return !!value.value && typeof value.value === "object" && Object.values(value.value).every(projectedValue);
    default: return false;
  }
}
function projectedFields(fields: Record<string, { readonly status: string; readonly value?: DomainValue }>): boolean {
  return !!fields && typeof fields === "object" && Object.values(fields).every(field => field?.status === "unknown"
    || (field?.status === "known" && projectedValue(field.value!)));
}

/** Verify lineage and projection before any response data is rendered. */
export async function verifyDecisionInspection(run: AvailableRun, request: NextDecisionInspectionRequest, response: NextDecisionInspection): Promise<boolean> {
  try {
    const identity = response.identity;
    const expectedDigest = await sha256Hex(canonicalJson({ format_version: 1, snapshot_digest: run.snapshotDigest,
      authorized_side: "attacker", selector: request.selector }));
    if (response.format_version !== 1 || request.snapshot_digest !== run.snapshotDigest
      || await reproductionSnapshotDigest(request.snapshot) !== run.snapshotDigest || request.authorized_side !== "attacker"
      || !decisionInspectionRequest(run, request.selector.tick, request.selector.slot_id)
      || identity.snapshot_digest !== run.snapshotDigest || identity.result_digest !== run.resultDigest
      || identity.authorized_side !== "attacker" || identity.selector.tick !== request.selector.tick
      || identity.selector.slot_id !== request.selector.slot_id || identity.inspection_digest !== expectedDigest
      || response.policy.id !== run.policyId || response.policy.digest !== run.policyDigest) return false;
    const observation = response.observation;
    if (observation.identity_space !== "inspection_observed" || (observation.source_digest !== null && !digest(observation.source_digest))) return false;
    if (observation.snapshot) {
      const snapshot = observation.snapshot;
      if (!observation.source_digest || snapshot.side !== "attacker" || snapshot.tick !== request.selector.tick || !projectedFields(snapshot.fields)) return false;
      if (!snapshot.collections || Object.values(snapshot.collections).some(collection => {
        if (collection.status === "unknown") return false;
        return collection.status !== "known" || !Array.isArray(collection.value) || collection.value.some(entity =>
          !alias(entity.id) || typeof entity.entity_type !== "string" || !projectedFields(entity.fields));
      })) return false;
    } else if (observation.source_digest !== null) return false;
    const decision = response.decision;
    if (!new Set(["evaluated", "subject_unavailable", "execution_incomplete", "tick_not_reached"]).has(decision.status)
      || !optionalAlias(decision.subject) || !Array.isArray(decision.candidates) || !Array.isArray(decision.selections)) return false;
    const composition = decision.composition;
    if (composition && (typeof composition.squad_id !== "string" || !Array.isArray(composition.members)
      || composition.members.some(member => !alias(member.actor) || typeof member.catalog_id !== "string"
        || !Array.isArray(member.values) || member.values.length !== 6 || !member.values.every(integer)
        || !Array.isArray(member.sources) || member.sources.length !== 6 || !member.sources.every((source: unknown) => typeof source === "string"))
      || [composition.shared, composition.baseline_effective, composition.effective].some(values => !Array.isArray(values) || values.length !== 6 || !values.every(integer)))) return false;
    const indices = new Set<number>();
    for (const candidate of decision.candidates) {
      if (!integer(candidate.index) || candidate.index < 0 || indices.has(candidate.index) || !alias(candidate.actor)
        || !optionalAlias(candidate.target) || typeof candidate.capability !== "string"
        || !Array.isArray(candidate.arguments) || !candidate.arguments.every(projectedValue)
        || !["move", "pursue", "retreat", "target"].includes(candidate.kind)
        || !["ineligible", "unknown", "selected", "conflict"].includes(candidate.outcome)
        || !optionalInteger(candidate.score) || !optionalInteger(candidate.rank) || !Array.isArray(candidate.terms)) return false;
      indices.add(candidate.index);
      for (const term of candidate.terms) if (!domains.has(term.domain) || !["offset", "target_health_offset", "signal"].includes(term.kind)
        || !(term.signal === null || signals.has(term.signal)) || !optionalInteger(term.weight)
        || !optionalInteger(term.value) || !optionalInteger(term.contribution)) return false;
    }
    for (const selection of decision.selections) {
      const event = selection.committed_event;
      if (!["explicit", "default", "wait"].includes(selection.source) || !alias(selection.actor) || !optionalAlias(selection.target)
        || !(selection.capability === null || typeof selection.capability === "string")
        || !(selection.arguments === null || (Array.isArray(selection.arguments) && selection.arguments.every(projectedValue)))
        || !optionalInteger(selection.score)
        || !(selection.candidate_index === null || (integer(selection.candidate_index) && indices.has(selection.candidate_index)))
        || typeof selection.arbitration_accepted !== "boolean" || typeof selection.transition_completed !== "boolean"
        || (event !== null && (!integer(event.tick) || event.tick !== request.selector.tick || !integer(event.sequence) || event.sequence < 0))) return false;
    }
    return true;
  } catch { return false; }
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
