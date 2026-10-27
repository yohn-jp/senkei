import type { DiagnosticEvent, DomainValue } from "../../contracts";
import type { BehaviorDomain } from "../../contracts/next-production";
import { committedCoverageOrder } from "./coverage-observed";
import type { VerifiedCoverageRun } from "./coverage-observed";

const domains: readonly BehaviorDomain[] = ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"];
const sources = new Set(["test_fallback_zero", "hero_catalog", "hero_instance", "army", "squad", "jinrei_conditional"]);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const scalar = (value: DomainValue | undefined): string | null => value && (value.kind === "string" || value.kind === "enum" || value.kind === "entity") ? value.value : null;
const sixIntegers = (value: unknown): value is number[] => Array.isArray(value) && value.length === 6 && value.every(Number.isSafeInteger);
const natural = (value: string | undefined): number | null => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
};

export interface TrialBehaviorEvidence {
  readonly slotId: string;
  readonly catalogId: string;
  readonly policyId: string;
  readonly policyDigest: string;
  readonly observationDigest: string;
  readonly decisionSource: "explicit" | "default" | "wait";
  readonly eligibleCandidates: number;
  readonly unknownCandidates: number;
  readonly selectedScore: number | null;
  readonly rows: readonly { readonly domain: BehaviorDomain; readonly catalogDefault: number | null;
    readonly memberValue: number; readonly source: string; readonly sharedValue: number; readonly effectiveValue: number }[];
}

/**
 * Interpret only owner notices from a verified immutable Run. The original
 * Observation is not retained, so its digest is identified as unverified.
 */
export function trialBehaviorEvidence(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>, event: DiagnosticEvent,
): TrialBehaviorEvidence | null {
  if (!verified.events.includes(event) || event.side !== "attacker" || event.record.kind !== "runtime_notice"
    || !event.entity_id || !["enbu.behavior_order_committed", "enbu.behavior_wait"].includes(event.record.value.code)) return null;
  const policy = verified.run.snapshot.context.next_behavior?.policy;
  const details = event.record.value.details;
  if (!policy?.test_only || !verified.trialPolicyDigest || details.next_policy_id !== policy.policy_id
    || details.next_policy_digest !== verified.trialPolicyDigest || !/^[0-9a-f]{64}$/.test(details.observation_digest ?? "")) return null;
  const source = details.decision_source;
  if (event.record.value.code === "enbu.behavior_wait") {
    if (source !== "wait" || event.action_id !== null) return null;
  } else if ((source !== "explicit" && source !== "default") || !committedCoverageOrder(verified, event)) return null;
  const eligibleCandidates = natural(details.eligible_candidates), unknownCandidates = natural(details.unknown_candidates);
  if (source === "default" ? details.selected_score === undefined : details.selected_score !== undefined) return null;
  if (details.selected_score !== undefined && !/^-?(0|[1-9][0-9]*)$/.test(details.selected_score)) return null;
  const selectedScore = details.selected_score === undefined ? null : Number(details.selected_score);
  if (eligibleCandidates === null || unknownCandidates === null || (selectedScore !== null && !Number.isSafeInteger(selectedScore))) return null;
  let composition: unknown;
  try { composition = JSON.parse(details.profile_composition_json ?? ""); } catch { return null; }
  if (!object(composition) || typeof composition.squad_id !== "string" || !Array.isArray(composition.members)
    || !composition.members.length || composition.members.length > 256 || !sixIntegers(composition.shared) || !sixIntegers(composition.effective)) return null;
  const shared = composition.shared, effective = composition.effective;
  const frames = verified.ownerReplay.frames.filter(frame => frame.tick === event.tick);
  const roster = verified.run.snapshot.attacker.configuration.heroes;
  if (frames.length !== 1 || !frames[0].visible_state || roster?.kind !== "list") return null;
  const actors = new Set<string>();
  let selected: { slotId: string; catalogId: string; values: number[]; sources: string[] } | null = null;
  for (const member of composition.members) {
    if (!object(member) || typeof member.actor !== "string" || !member.actor || actors.has(member.actor)
      || typeof member.catalog_id !== "string" || !sixIntegers(member.values) || !Array.isArray(member.sources)
      || member.sources.length !== 6 || !member.sources.every(item => typeof item === "string" && sources.has(item))) return null;
    actors.add(member.actor);
    const notices = verified.events.filter(entry => entry.side === "attacker" && entry.tick === 0 && entry.action_id === null
      && entry.entity_id === member.actor && entry.record.kind === "runtime_notice" && entry.record.value.code === "enbu.next_hero_identity");
    if (notices.length !== 1 || notices[0].record.kind !== "runtime_notice") return null;
    const identity = notices[0].record.value.details;
    if (!identity.slot_id || identity.catalog_id !== member.catalog_id) return null;
    const frozen = roster.value.filter(entry => entry.kind === "record" && scalar(entry.value.slot_id) === identity.slot_id);
    if (frozen.length !== 1 || frozen[0].kind !== "record" || scalar(frozen[0].value.catalog_id) !== member.catalog_id) return null;
    const visible = Object.values(frames[0].visible_state.entities).filter(entity => entity.owner === "attacker" && entity.entity_type === "hero"
      && scalar(entity.fields.slot_id) === identity.slot_id && scalar(entity.fields.catalog_id) === member.catalog_id
      && scalar(entity.fields.squad) === composition.squad_id);
    if (visible.length !== 1) return null;
    if (member.actor === event.entity_id) selected = { slotId: identity.slot_id, catalogId: member.catalog_id,
      values: member.values, sources: member.sources as string[] };
  }
  if (!selected) return null;
  const defaults = policy.hero_defaults[selected.catalogId];
  if (!defaults) return null;
  const rows = domains.map((domain, index) => ({ domain, catalogDefault: defaults[domain], memberValue: selected!.values[index],
    source: selected!.sources[index], sharedValue: shared[index], effectiveValue: effective[index] }));
  if (rows.some(row => row.catalogDefault !== null && !Number.isSafeInteger(row.catalogDefault))) return null;
  return { slotId: selected.slotId, catalogId: selected.catalogId, policyId: policy.policy_id, policyDigest: verified.trialPolicyDigest,
    observationDigest: details.observation_digest, decisionSource: source as TrialBehaviorEvidence["decisionSource"], eligibleCandidates, unknownCandidates, selectedScore, rows };
}
