import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type {
  DiagnosticEvent, DomainValue, PresentationEvent, PresentationReplay, ReproductionAssets,
  SimulationResponse, SimulationSnapshot,
} from "../../contracts";
import { canonicalJson, sha256Hex } from "../../worker/input-identity";
import {
  validateNextExperimentAuthorization, validateNextExperimentDiagnostics, validateNextExperimentReplay,
} from "./experiment-restoration";

/** A completed local Run, including the separate owner-only channels. */
export interface CoverageRun {
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  readonly sourceReplay: PresentationReplay;
  readonly reproductionAssets: ReproductionAssets;
  readonly includeDiagnostics: boolean;
}

export interface CoverageSubject {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly squad: string;
}

export type VerifiedCoverageRun =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly run: CoverageRun; readonly ownerReplay: PresentationReplay;
      readonly events: readonly DiagnosticEvent[]; readonly trialPolicyDigest: string | null };

const unavailable = (reason: string): VerifiedCoverageRun => ({ status: "unavailable", reason });

/**
 * Keep this separate from public Replay: only an explicitly requested, owner
 * authorized channel with its immutable Run lineage can supply trace events.
 * Schema 1 does not carry a Catalog stamp, so even a verified Run is not a
 * field-by-field comparison with the current Catalog.
 */
export async function verifyCoverageRun(
  run: CoverageRun | null | undefined,
  catalog: DomainCatalogDocument | null,
  current: boolean,
  programDigest: string | undefined,
): Promise<VerifiedCoverageRun> {
  if (!run || !run.includeDiagnostics || !run.response.restricted_diagnostics) {
    return unavailable("No owner-authorized RestrictedDiagnostics were supplied for this Run.");
  }
  if (!current || !programDigest || programDigest !== run.snapshot.attacker.program.content_digest) {
    return unavailable("The current Draft or compiled Program does not match this Run.");
  }
  if (!catalog) return unavailable("The current Catalog is unavailable.");

  try {
    validateNextExperimentAuthorization(run.response, true);
    await validateNextExperimentDiagnostics(run.response, run.snapshot);
    const result = run.response.outcome.result;
    const publicReplay = run.response.outcome.presentation_replay;
    const ownerReplay = run.response.owner_replays?.attacker;
    if (!ownerReplay || ownerReplay.perspective !== "attacker") {
      return unavailable("The attacker owner Replay is unavailable.");
    }
    await validateNextExperimentReplay(publicReplay, result, run.snapshot.context.match_id);
    await validateNextExperimentReplay(ownerReplay, result, run.snapshot.context.match_id);
    const ruleset = run.snapshot.context.ruleset;
    const stamp = catalog.identity;
    if (canonicalJson(ruleset) !== canonicalJson(run.snapshot.attacker.ruleset)
      || canonicalJson(ruleset) !== canonicalJson(run.snapshot.defender.ruleset)
      || canonicalJson(ruleset) !== canonicalJson(run.reproductionAssets.rule_package.ruleset)
      || !publicReplay.ruleset || !ownerReplay.ruleset
      || canonicalJson(ruleset) !== canonicalJson(publicReplay.ruleset)
      || canonicalJson(ruleset) !== canonicalJson(ownerReplay.ruleset)
      || stamp.rulesetId !== ruleset.id || stamp.rulesetDigest !== ruleset.digest
      || canonicalJson(stamp.rulesetVersion) !== canonicalJson(ruleset.version)) {
      return unavailable("The Run and current RulePackage do not match.");
    }
    const world = run.snapshot.context.world_identity;
    if (!world || !publicReplay.world_identity || !ownerReplay.world_identity
      || canonicalJson(world) !== canonicalJson(publicReplay.world_identity)
      || canonicalJson(world) !== canonicalJson(ownerReplay.world_identity)
      || canonicalJson(world) !== canonicalJson(run.reproductionAssets.rule_package.next?.world_identity)) {
      return unavailable("The Run World identity cannot be verified against its Replays and RulePackage.");
    }
    const policy = run.snapshot.context.next_behavior?.policy;
    const trialPolicyDigest = policy?.schema_version === 1 && policy.test_only && policy.ruleset_digest === ruleset.digest
      ? await sha256Hex(canonicalJson(policy)) : null;
    return { status: "available", run, ownerReplay, events: run.response.restricted_diagnostics.events, trialPolicyDigest };
  } catch {
    return unavailable("The owner authorization or immutable Run identity could not be verified.");
  }
}

function scalar(value: DomainValue | undefined): string | null {
  return value && (value.kind === "string" || value.kind === "enum" || value.kind === "entity") ? value.value : null;
}

/**
 * Associate only explicitly identified owner Heroes in the same-tick owner
 * frame. A missing or duplicate identity cannot be used to guess attribution.
 */
function subjectIds(replay: PresentationReplay, tick: number, subjects: readonly CoverageSubject[], scope: "squad" | "hero"): Set<string> | null {
  const frames = replay.frames.filter(frame => frame.tick === tick);
  if (frames.length !== 1 || !frames[0].visible_state) return null;
  const entities = Object.entries(frames[0].visible_state.entities);
  const ids = new Set<string>();
  const squads = new Set<string>();
  for (const subject of subjects) {
    const matches = entities.filter(([, entity]) => entity.owner === "attacker" && entity.entity_type === "hero"
      && scalar(entity.fields.slot_id) === subject.slot_id && scalar(entity.fields.catalog_id) === subject.catalog_id);
    if (matches.length !== 1) return null;
    ids.add(matches[0][0]);
    const squad = scalar(matches[0][1].fields.squad);
    if (squad === null) return null;
    squads.add(squad);
  }
  if (ids.size !== subjects.length) return null;
  if (scope === "squad") {
    if (squads.size !== 1) return null;
    const squad = [...squads][0];
    // Empty means individual authority, not one shared group of all solo Heroes.
    if (squad === "" && subjects.length !== 1) return null;
    if (squad !== "") {
      const liveMembers = entities.filter(([, entity]) => entity.owner === "attacker" && entity.entity_type === "hero"
        && scalar(entity.fields.squad) === squad);
      if (liveMembers.length !== ids.size || liveMembers.some(([id]) => !ids.has(id))) return null;
    }
  }
  return ids;
}

export type ScopedCoverageEvents =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly events: readonly DiagnosticEvent[]; readonly rawIdentityAvailable: boolean };

/** Resolve only the producer's explicit owner Replay reference, never by matching raw to projected entity IDs. */
export function committedCoverageOrder(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>,
  event: DiagnosticEvent,
): PresentationEvent | null {
  if (event.side !== "attacker" || event.record.kind !== "runtime_notice"
    || event.record.value.code !== "enbu.behavior_order_committed" || !event.action_id) return null;
  const details = event.record.value.details;
  if (!/^(0|[1-9][0-9]*)$/.test(details.owner_replay_tick ?? "")
    || !/^(0|[1-9][0-9]*)$/.test(details.owner_replay_sequence ?? "")) return null;
  const tick = Number(details.owner_replay_tick), sequence = Number(details.owner_replay_sequence);
  if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(sequence) || tick !== event.tick) return null;
  const frames = verified.ownerReplay.frames.filter(frame => frame.tick === tick);
  if (frames.length !== 1) return null;
  const matches = frames[0].events.filter(candidate => candidate.event === "next.behavior_order_committed"
    && candidate.payload.tick?.kind === "integer" && candidate.payload.tick.value === tick
    && candidate.payload.sequence?.kind === "integer" && candidate.payload.sequence.value === sequence);
  return matches.length === 1 && matches[0].payload.action_id?.kind === "string"
    && matches[0].payload.action_id.value === event.action_id ? matches[0] : null;
}

function orderMembers(order: PresentationEvent): readonly DomainValue[] {
  return order.payload.members?.kind === "list" ? order.payload.members.value : [];
}

function frozenSubjectsMatch(verified: Extract<VerifiedCoverageRun, { status: "available" }>, subjects: readonly CoverageSubject[]): boolean {
  const roster = verified.run.snapshot.attacker.configuration?.heroes;
  if (roster?.kind !== "list") return false;
  return subjects.every(subject => {
    const matches = roster.value.filter(entry => entry.kind === "record" && scalar(entry.value.slot_id) === subject.slot_id);
    return matches.length === 1 && matches[0].kind === "record"
      && scalar(matches[0].value.catalog_id) === subject.catalog_id && scalar(matches[0].value.squad) === subject.squad;
  });
}

/** Bind raw diagnostic IDs only through the owner's immutable roster notices. */
function rawSubjectIds(verified: Extract<VerifiedCoverageRun, { status: "available" }>, subjects: readonly CoverageSubject[]): Set<string> | null {
  const roster = verified.run.snapshot.attacker.configuration?.heroes;
  if (roster?.kind !== "list") return null;
  const notices = verified.events.filter(event => event.side === "attacker" && event.tick === 0
    && event.action_id === null && event.record.kind === "runtime_notice" && event.record.value.code === "enbu.next_hero_identity");
  const ids = new Set<string>();
  for (const subject of subjects) {
    const rosterMatches = roster.value.filter(entry => entry.kind === "record" && scalar(entry.value.slot_id) === subject.slot_id);
    const matches = notices.filter(event => event.record.kind === "runtime_notice"
      && event.record.value.details.slot_id === subject.slot_id);
    const entry = rosterMatches[0], notice = matches[0];
    if (rosterMatches.length !== 1 || entry.kind !== "record" || scalar(entry.value.catalog_id) !== subject.catalog_id
      || scalar(entry.value.squad) !== subject.squad || matches.length !== 1 || notice.record.kind !== "runtime_notice"
      || notice.record.value.details.catalog_id !== subject.catalog_id || !notice.entity_id
      || notices.filter(other => other.entity_id === notice.entity_id).length !== 1 || ids.has(notice.entity_id)) return null;
    ids.add(notice.entity_id);
  }
  return ids;
}

/** Raw diagnostics and projected Replay IDs have distinct, explicit bindings. */
export function scopedCoverageEvents(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>,
  scope: "army" | "squad" | "hero",
  subjects: readonly CoverageSubject[],
  tick: number,
): ScopedCoverageEvents {
  const events = verified.events.filter(event => event.side === "attacker" && event.tick === tick
    && !(event.record.kind === "runtime_notice" && event.record.value.code === "enbu.next_hero_identity"));
  if (scope === "army") return { status: "available", events, rawIdentityAvailable: true };
  if (!subjects.length) return { status: "unavailable", reason: "No Hero is selected for this scope." };
  if (!frozenSubjectsMatch(verified, subjects)) return { status: "unavailable", reason: "The selected Hero roster does not match the frozen Run." };
  const ids = subjectIds(verified.ownerReplay, tick, subjects, scope);
  if (!ids) return { status: "unavailable", reason: "A unique owner Hero or matching Squad is unavailable at this Tick." };
  const rawIds = rawSubjectIds(verified, subjects);
  return { status: "available", events: events.filter(event => {
    const { record } = event;
    if (rawIds && (record.kind === "intent_proposed" || record.kind === "intent_accepted" || record.kind === "intent_rejected")) {
      return (record.value.intent.actor !== null && rawIds.has(record.value.intent.actor))
        || (record.value.intent.target !== null && rawIds.has(record.value.intent.target));
    }
    if (rawIds && record.kind === "runtime_notice" && record.value.code === "enbu.behavior_unknown_observation") {
      return rawIds.has(record.value.details.actor ?? "");
    }
    if (rawIds && record.kind === "runtime_notice" && record.value.code === "enbu.behavior_wait") {
      return event.entity_id !== null && rawIds.has(event.entity_id);
    }
    const order = committedCoverageOrder(verified, event);
    if (!order) return false;
    return orderMembers(order).some(member => member.kind === "record"
      && member.value.entity?.kind === "entity" && ids.has(member.value.entity.value));
  }), rawIdentityAvailable: rawIds !== null };
}

function valueText(value: DomainValue | undefined): string {
  if (!value) return "not supplied";
  if (value.kind === "null") return "null";
  if (value.kind === "fixed") return `${value.value.coefficient} × 10⁻${value.value.scale}`;
  if (value.kind === "list" || value.kind === "record") return JSON.stringify(value.value);
  return String(value.value);
}

/** Report only values actually emitted by the owner diagnostics channel. */
export function coverageDiagnosticText(event: DiagnosticEvent, verified?: Extract<VerifiedCoverageRun, { status: "available" }>): string {
  const { record } = event;
  switch (record.kind) {
    case "state_evaluated": return `${record.value.state} · ${record.value.result.toUpperCase()}`;
    case "intent_proposed":
    case "intent_accepted":
    case "intent_rejected": {
      const { intent } = record.value;
      const outcome = record.kind === "intent_rejected" ? `rejected (${record.value.reason})`
        : record.kind === "intent_accepted" ? "accepted" : "proposed";
      return `${intent.capability}(${intent.arguments.map(valueText).join(", ")}) · ${outcome} · actor ${intent.actor ?? "not supplied"} · target ${intent.target ?? "not supplied"}${intent.priority === null ? "" : ` · priority ${intent.priority}`}`;
    }
    case "cost_charged": return `${record.value.operation} · ${record.value.amount} CU`;
    case "memory_read": return `${record.value.state} · memory read`;
    case "memory_written": return `${record.value.state} · memory updated`;
    case "runtime_notice": {
      if (record.value.code === "enbu.behavior_unknown_observation") {
        const { actor, candidates } = record.value.details;
        return `UNKNOWN observation · actor ${actor ?? "not supplied"} · candidates ${candidates ?? "not supplied"}`;
      }
      if (record.value.code === "enbu.behavior_wait") return "WAIT · no order selected";
      if (record.value.code !== "enbu.behavior_order_committed") return record.value.code;
      const order = verified ? committedCoverageOrder(verified, event) : null;
      if (!order) return "Committed-order Replay reference unavailable";
      const members = orderMembers(order).flatMap(member => member.kind === "record" && member.value.entity?.kind === "entity"
        ? [`${member.value.entity.value}: goal ${valueText(member.value.goal)}, target ${valueText(member.value.target)}, retreating ${valueText(member.value.retreating)}`] : []);
      return members.length ? `Committed · ${members.join("; ")}` : "Committed · member details not supplied";
    }
  }
}
