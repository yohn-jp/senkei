import { describe, expect, it } from "vitest";
import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { DiagnosticEvent, MatchResult, SimulationSnapshot } from "../../contracts";
import { reproductionSnapshotDigest } from "./experiment-restoration";
import { coverageDiagnosticText, scopedCoverageEvents, verifyCoverageRun } from "./coverage-observed";
import type { CoverageRun } from "./coverage-observed";

const ruleset = { id: "rules", version: { major: 1, minor: 0, patch: 0 }, digest: "rules-digest" };
const world = { world_id: "world", logic_digest: "world-digest", presentation_digest: "presentation" };
const catalog = { identity: { rulesetId: ruleset.id, rulesetDigest: ruleset.digest, rulesetVersion: ruleset.version } } as DomainCatalogDocument;
const result: MatchResult = {
  match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7,
  statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest",
};
// Digest of the exact MatchResult above, produced using Rust-compatible field order.
const resultDigest = "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b";
const subject = { slot_id: "slot-1", catalog_id: "hero-a", squad: "front" };
const field = (value: string) => ({ kind: "string" as const, value });
const hero = { owner: "attacker" as const, entity_type: "hero", fields: {
  slot_id: field(subject.slot_id), catalog_id: field(subject.catalog_id), squad: field(subject.squad),
} };
const events: DiagnosticEvent[] = [
  { tick: 3, side: "attacker", sequence: 1, action_id: null, entity_id: null,
    record: { kind: "state_evaluated", value: { state: "can_attack", result: "unknown" } } },
  { tick: 3, side: "attacker", sequence: 2, action_id: "action-a", entity_id: "enemy",
    record: { kind: "intent_accepted", value: { intent: { action_id: "action-a", capability: "attack", actor: "hero-entity", target: "enemy", arguments: [], priority: null } } } },
  { tick: 3, side: "attacker", sequence: 3, action_id: "action-b", entity_id: "hero-entity",
    record: { kind: "intent_rejected", value: { intent: { action_id: "action-b", capability: "move", actor: "other", target: "hero-entity", arguments: [], priority: null }, reason: "blocked" } } },
];

async function validRun(): Promise<CoverageRun> {
  const snapshot = {
    attacker: { ruleset, program: { content_digest: "program" } }, defender: {},
    context: { match_id: "match-a", ruleset, world_identity: world },
  } as unknown as SimulationSnapshot;
  const replay = { schema_version: { major: 1, minor: 0, patch: 0 }, match_id: "match-a", result_digest: resultDigest, world_identity: world,
    frames: [{ tick: 3, events: [], visible_state: { entities: { "hero-entity": hero }, global_fields: {} } }] };
  const ownerReplay = { ...replay, perspective: "attacker" };
  return {
    snapshot, includeDiagnostics: true, sourceReplay: ownerReplay,
    reproductionAssets: { rule_package: { ruleset, next: { world_identity: world } } },
    response: {
      authorized_side: "attacker", outcome: { result, presentation_replay: replay },
      owner_replays: { attacker: ownerReplay },
      restricted_diagnostics: { identity: { schema_version: 1, side: "attacker", match_id: "match-a", result_digest: resultDigest,
        snapshot_digest: await reproductionSnapshotDigest(snapshot), program_digest: "program" }, events,
        cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
    },
  } as unknown as CoverageRun;
}

describe("Coverage owner Run evidence", () => {
  it("accepts only a verified current owner Run and keeps UNKNOWN as emitted", async () => {
    const verified = await verifyCoverageRun(await validRun(), catalog, true, "program");
    expect(verified.status).toBe("available");
    if (verified.status !== "available") throw new Error(verified.reason);
    const army = scopedCoverageEvents(verified, "army", [], 3);
    expect(army.status).toBe("available");
    if (army.status !== "available") throw new Error(army.reason);
    expect(army.events).toHaveLength(3);
    expect(coverageDiagnosticText(army.events[0])).toBe("can_attack · UNKNOWN");
  });

  it("rejects stale drafts, missing authorization, wrong identity and other-side events", async () => {
    const run = await validRun();
    expect((await verifyCoverageRun(run, catalog, false, "program")).status).toBe("unavailable");
    expect((await verifyCoverageRun(run, catalog, true, "other-program")).status).toBe("unavailable");
    expect((await verifyCoverageRun({ ...run, includeDiagnostics: false }, catalog, true, "program")).status).toBe("unavailable");
    const diagnostics = run.response.restricted_diagnostics!;
    const otherSide = { ...run, response: { ...run.response, restricted_diagnostics: { ...diagnostics,
      events: [...events, { ...events[0], side: "defender" as const }] } } };
    expect((await verifyCoverageRun(otherSide, catalog, true, "program")).status).toBe("unavailable");
    const wrongProgram = { ...run, response: { ...run.response, restricted_diagnostics: { ...diagnostics,
      identity: { ...diagnostics.identity, program_digest: "other-program" } } } };
    expect((await verifyCoverageRun(wrongProgram, catalog, true, "program")).status).toBe("unavailable");
    const wrongCatalog = { ...catalog, identity: { ...catalog.identity, rulesetDigest: "other" } };
    expect((await verifyCoverageRun(run, wrongCatalog, true, "program")).status).toBe("unavailable");
    const wrongWorld = { ...run, sourceReplay: run.sourceReplay, response: { ...run.response,
      owner_replays: { attacker: { ...run.response.owner_replays!.attacker!, world_identity: { ...world, logic_digest: "other" } } } } } as CoverageRun;
    expect((await verifyCoverageRun(wrongWorld, catalog, true, "program")).status).toBe("unavailable");
  });

  it("requires unique same-Tick owner Hero identity and uses intent actor/target, not the target-first event entity", async () => {
    const verified = await verifyCoverageRun(await validRun(), catalog, true, "program");
    if (verified.status !== "available") throw new Error(verified.reason);
    const heroEvents = scopedCoverageEvents(verified, "hero", [subject], 3);
    expect(heroEvents.status).toBe("available");
    if (heroEvents.status !== "available") throw new Error(heroEvents.reason);
    expect(heroEvents.events.map(event => event.sequence)).toEqual([2, 3]);
    expect(coverageDiagnosticText(heroEvents.events[1])).toContain("actor other · target hero-entity");
    expect(scopedCoverageEvents(verified, "hero", [subject], 4).status).toBe("unavailable");
    const frame = verified.ownerReplay.frames[0];
    const duplicated = { ...verified, ownerReplay: { ...verified.ownerReplay, frames: [{ ...frame,
      visible_state: { ...frame.visible_state!, entities: { ...frame.visible_state!.entities, duplicate: hero } } }] } };
    expect(scopedCoverageEvents(duplicated, "hero", [subject], 3).status).toBe("unavailable");
    expect(scopedCoverageEvents(verified, "squad", [{ ...subject, squad: "other" }], 3).status).toBe("unavailable");
  });
});
