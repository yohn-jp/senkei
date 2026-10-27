import type { NextDecisionInspection, NextDecisionInspectionRequest } from "../contracts/next-decision-inspection";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "./input-identity";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): boolean => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const alias = (value: unknown): boolean => typeof value === "string" && /^observed-[1-9][0-9]*$/.test(value);
const optionalAlias = (value: unknown): boolean => value === null || alias(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const optionalInteger = (value: unknown): boolean => value === null || integer(value);
const digest = (value: unknown): boolean => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const domains = new Set(["navigation", "engagement", "targeting", "pursuit", "survival", "objective"]);
const signals = new Set(["constant", "actor_health_percent", "target_health_percent", "target_proximity", "observed_danger", "objective_value", "route_cost", "squad_health_percent", "candidate_move", "candidate_pursue", "candidate_retreat", "candidate_target"]);
const sources = new Set(["test_fallback_zero", "hero_catalog", "hero_instance", "army", "squad", "jinrei_conditional"]);

function projectedValue(value: unknown): boolean {
  if (!record(value) || typeof value.kind !== "string") return false;
  if (value.kind === "null") return exact(value, ["kind"]);
  if (!exact(value, ["kind", "value"])) return false;
  switch (value.kind) {
    case "bool": return typeof value.value === "boolean";
    case "integer": return integer(value.value);
    case "fixed": return exact(value.value, ["coefficient", "scale"]) && record(value.value)
      && integer(value.value.coefficient) && integer(value.value.scale);
    case "string": case "enum": return typeof value.value === "string";
    case "entity": return alias(value.value);
    case "list": return Array.isArray(value.value) && value.value.every(projectedValue);
    case "record": return record(value.value) && Object.values(value.value).every(projectedValue);
    default: return false;
  }
}
function observedValue(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.status === "unknown") return exact(value, ["status"]);
  return value.status === "known" && exact(value, ["status", "value"]) && projectedValue(value.value);
}
function observedFields(value: unknown): boolean { return record(value) && Object.values(value).every(observedValue); }
function observedEntity(value: unknown): boolean {
  return exact(value, ["id", "entity_type", "fields"]) && record(value) && alias(value.id)
    && typeof value.entity_type === "string" && observedFields(value.fields);
}
function observedCollection(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.status === "unknown") return exact(value, ["status"]);
  return value.status === "known" && exact(value, ["status", "value"]) && Array.isArray(value.value) && value.value.every(observedEntity);
}
function observationShape(value: unknown, side: string, tick: number): boolean {
  if (!exact(value, ["tick", "side", "fields", "collections"]) || !record(value)) return false;
  return value.tick === tick && value.side === side && observedFields(value.fields) && record(value.collections)
    && Object.values(value.collections).every(observedCollection);
}
function values6(value: unknown): boolean { return Array.isArray(value) && value.length === 6 && value.every(integer); }
function compositionShape(value: unknown): boolean {
  if (value === null) return true;
  if (!exact(value, ["squad_id", "members", "shared", "baseline_effective", "effective"]) || !record(value)
    || typeof value.squad_id !== "string" || !Array.isArray(value.members)) return false;
  return value.members.every(member => exact(member, ["actor", "catalog_id", "values", "sources"]) && record(member)
      && alias(member.actor) && typeof member.catalog_id === "string" && values6(member.values) && Array.isArray(member.sources)
      && member.sources.length === 6 && member.sources.every((source: unknown) => typeof source === "string" && sources.has(source)))
    && values6(value.shared) && values6(value.baseline_effective) && values6(value.effective);
}
function termShape(term: unknown): boolean {
  return exact(term, ["domain", "kind", "signal", "weight", "value", "contribution"]) && record(term)
    && typeof term.domain === "string" && domains.has(term.domain)
    && typeof term.kind === "string" && ["offset", "target_health_offset", "signal"].includes(term.kind)
    && (term.signal === null || (typeof term.signal === "string" && signals.has(term.signal)))
    && optionalInteger(term.weight) && optionalInteger(term.value) && optionalInteger(term.contribution);
}
function candidateShape(candidate: unknown): boolean {
  return exact(candidate, ["index", "actor", "target", "kind", "capability", "arguments", "outcome", "score", "rank", "terms"])
    && record(candidate) && integer(candidate.index) && candidate.index >= 0 && alias(candidate.actor) && optionalAlias(candidate.target)
    && typeof candidate.kind === "string" && ["move", "pursue", "retreat", "target"].includes(candidate.kind)
    && typeof candidate.capability === "string" && Array.isArray(candidate.arguments) && candidate.arguments.every(projectedValue)
    && typeof candidate.outcome === "string" && ["ineligible", "unknown", "selected", "conflict"].includes(candidate.outcome)
    && optionalInteger(candidate.score) && optionalInteger(candidate.rank) && Array.isArray(candidate.terms) && candidate.terms.every(termShape);
}
function selectionShape(selection: unknown, indices: ReadonlySet<number>, tick: number): boolean {
  if (!exact(selection, ["source", "actor", "capability", "arguments", "target", "score", "candidate_index", "arbitration_accepted", "transition_completed", "committed_event"])
    || !record(selection) || typeof selection.source !== "string" || !["explicit", "default", "wait"].includes(selection.source)
    || !alias(selection.actor) || !optionalAlias(selection.target) || !(selection.capability === null || typeof selection.capability === "string")
    || !(selection.arguments === null || (Array.isArray(selection.arguments) && selection.arguments.every(projectedValue)))
    || !optionalInteger(selection.score) || !(selection.candidate_index === null || (integer(selection.candidate_index) && indices.has(selection.candidate_index)))
    || typeof selection.arbitration_accepted !== "boolean" || typeof selection.transition_completed !== "boolean") return false;
  const event = selection.committed_event;
  return event === null || (exact(event, ["tick", "sequence"]) && record(event) && event.tick === tick && integer(event.sequence) && event.sequence >= 0);
}

/** Validate identity and privacy at the Worker boundary, before exposing a Core reply. */
export async function decisionInspectionResponseError(value: unknown, request: NextDecisionInspectionRequest): Promise<string | null> {
  try {
    if (!exact(value, ["format_version", "identity", "policy", "observation", "decision"]) || !record(value) || value.format_version !== 1) return "Invalid decision inspection response format.";
    const identity = value.identity, policy = value.policy, observation = value.observation, decision = value.decision;
    const expectedSnapshot = await reproductionSnapshotDigest(request.snapshot);
    const expectedInspection = await sha256Hex(canonicalJson({ format_version: 1, snapshot_digest: expectedSnapshot,
      authorized_side: request.authorized_side, selector: request.selector }));
    const frozenPolicy = request.snapshot.context.next_behavior?.policy;
    if (request.format_version !== 1 || !["attacker", "defender"].includes(request.authorized_side)
      || !integer(request.selector.tick) || request.selector.tick < 1 || typeof request.selector.slot_id !== "string" || !request.selector.slot_id
      || request.snapshot_digest !== expectedSnapshot || !frozenPolicy || !exact(identity, ["snapshot_digest", "result_digest", "authorized_side", "selector", "inspection_digest"])
      || !record(identity) || !exact(identity.selector, ["tick", "slot_id"]) || !record(identity.selector)
      || identity.snapshot_digest !== expectedSnapshot || !digest(identity.result_digest) || identity.authorized_side !== request.authorized_side
      || identity.selector.tick !== request.selector.tick || identity.selector.slot_id !== request.selector.slot_id || identity.inspection_digest !== expectedInspection
      || !exact(policy, ["id", "digest"]) || !record(policy) || policy.id !== frozenPolicy.policy_id
      || policy.digest !== await sha256Hex(canonicalJson(frozenPolicy))) return "Decision inspection identity did not match the request.";
    if (!exact(observation, ["identity_space", "source_digest", "snapshot"]) || !record(observation)
      || observation.identity_space !== "inspection_observed" || !(observation.source_digest === null || digest(observation.source_digest))
      || (observation.snapshot === null ? observation.source_digest !== null : !observation.source_digest || !observationShape(observation.snapshot, request.authorized_side, request.selector.tick))) {
      return "Invalid projected observation in decision inspection.";
    }
    if (!exact(decision, ["status", "subject", "composition", "candidates", "selections"]) || !record(decision)
      || typeof decision.status !== "string" || !["evaluated", "subject_unavailable", "execution_incomplete", "tick_not_reached"].includes(decision.status)
      || !optionalAlias(decision.subject) || !compositionShape(decision.composition)
      || !Array.isArray(decision.candidates) || !decision.candidates.every(candidateShape) || !Array.isArray(decision.selections)) {
      return "Invalid projected decision in inspection.";
    }
    const indices = new Set<number>();
    for (const candidate of decision.candidates) {
      const index = (candidate as NextDecisionInspection["decision"]["candidates"][number]).index;
      if (indices.has(index)) return "Duplicate candidate in decision inspection.";
      indices.add(index);
    }
    if (!decision.selections.every(selection => selectionShape(selection, indices, request.selector.tick))) return "Invalid projected selection in decision inspection.";
    return null;
  } catch { return "Invalid decision inspection response."; }
}
