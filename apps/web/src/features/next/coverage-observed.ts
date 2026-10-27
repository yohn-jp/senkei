import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type {
  DiagnosticEvent, DomainValue, PresentationReplay, ReproductionAssets,
  SimulationResponse, SimulationSnapshot,
} from "../../contracts";
import { canonicalJson } from "../../worker/input-identity";
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
      readonly events: readonly DiagnosticEvent[] };

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
      || canonicalJson(ruleset) !== canonicalJson(run.reproductionAssets.rule_package.ruleset)
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
    return { status: "available", run, ownerReplay, events: run.response.restricted_diagnostics.events };
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
function subjectIds(replay: PresentationReplay, tick: number, subjects: readonly CoverageSubject[]): Set<string> | null {
  const frames = replay.frames.filter(frame => frame.tick === tick);
  if (frames.length !== 1 || !frames[0].visible_state) return null;
  const entities = Object.entries(frames[0].visible_state.entities);
  const ids = new Set<string>();
  for (const subject of subjects) {
    const matches = entities.filter(([, entity]) => entity.owner === "attacker" && entity.entity_type === "hero"
      && scalar(entity.fields.slot_id) === subject.slot_id && scalar(entity.fields.catalog_id) === subject.catalog_id
      && scalar(entity.fields.squad) === subject.squad);
    if (matches.length !== 1) return null;
    ids.add(matches[0][0]);
  }
  return ids;
}

export type ScopedCoverageEvents =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly events: readonly DiagnosticEvent[] };

/** Keep unscoped state evaluations at Army level; never infer a Hero from target-first entity_id. */
export function scopedCoverageEvents(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>,
  scope: "army" | "squad" | "hero",
  subjects: readonly CoverageSubject[],
  tick: number,
): ScopedCoverageEvents {
  const events = verified.events.filter(event => event.side === "attacker" && event.tick === tick);
  if (scope === "army") return { status: "available", events };
  if (!subjects.length) return { status: "unavailable", reason: "No Hero is selected for this scope." };
  const ids = subjectIds(verified.ownerReplay, tick, subjects);
  if (!ids) return { status: "unavailable", reason: "A unique owner Hero identity is unavailable at this Tick." };
  return { status: "available", events: events.filter(({ record }) => {
    if (record.kind !== "intent_proposed" && record.kind !== "intent_accepted" && record.kind !== "intent_rejected") return false;
    return (record.value.intent.actor !== null && ids.has(record.value.intent.actor))
      || (record.value.intent.target !== null && ids.has(record.value.intent.target));
  }) };
}

/** Report only values actually emitted by the owner diagnostics channel. */
export function coverageDiagnosticText(event: DiagnosticEvent): string {
  const { record } = event;
  switch (record.kind) {
    case "state_evaluated": return `${record.value.state} · ${record.value.result.toUpperCase()}`;
    case "intent_proposed":
    case "intent_accepted":
    case "intent_rejected": {
      const { intent } = record.value;
      const outcome = record.kind === "intent_rejected" ? `rejected (${record.value.reason})`
        : record.kind === "intent_accepted" ? "accepted" : "proposed";
      return `${intent.capability} · ${outcome} · actor ${intent.actor ?? "not supplied"} · target ${intent.target ?? "not supplied"}`;
    }
    case "cost_charged": return `${record.value.operation} · ${record.value.amount} CU`;
    case "memory_read": return `${record.value.state} · memory read`;
    case "memory_written": return `${record.value.state} · memory updated`;
    case "runtime_notice": return record.value.code;
  }
}
