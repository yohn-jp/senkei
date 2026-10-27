import { describe, expect, it } from "vitest";
import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { DiagnosticEvent, MatchResult, SimulationSnapshot } from "../../contracts";
import { reproductionSnapshotDigest } from "./experiment-restoration";
import { committedCoverageOrder, coverageDiagnosticText, scopedCoverageEvents, verifyCoverageRun } from "./coverage-observed";
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
  { tick: 0, side: "attacker", sequence: 0, action_id: null, entity_id: "hero-entity",
    record: { kind: "runtime_notice", value: { code: "enbu.next_hero_identity", details: { slot_id: "slot-1", catalog_id: "hero-a" } } } },
  { tick: 3, side: "attacker", sequence: 1, action_id: null, entity_id: null,
    record: { kind: "state_evaluated", value: { state: "can_attack", result: "unknown" } } },
  { tick: 3, side: "attacker", sequence: 2, action_id: "action-a", entity_id: "enemy",
    record: { kind: "intent_accepted", value: { intent: { action_id: "action-a", capability: "attack", actor: "hero-entity", target: "enemy", arguments: [], priority: null } } } },
  { tick: 3, side: "attacker", sequence: 3, action_id: "action-b", entity_id: "hero-entity",
    record: { kind: "intent_rejected", value: { intent: { action_id: "action-b", capability: "move", actor: "other", target: "hero-entity", arguments: [], priority: null }, reason: "blocked" } } },
  { tick: 3, side: "attacker", sequence: 4, action_id: "action-a", entity_id: "hero-entity",
    record: { kind: "runtime_notice", value: { code: "enbu.behavior_order_committed", details: { owner_replay_tick: "3", owner_replay_sequence: "0" } } } },
];

async function validRun(): Promise<CoverageRun> {
  const snapshot = {
    attacker: { ruleset, program: { content_digest: "program" }, configuration: { heroes: { kind: "list", value: [
      { kind: "record", value: { slot_id: field("slot-1"), catalog_id: field("hero-a"), squad: field("front") } },
    ] } } }, defender: { ruleset },
    context: { match_id: "match-a", ruleset, world_identity: world },
  } as unknown as SimulationSnapshot;
  const replay = { schema_version: { major: 1, minor: 0, patch: 0 }, match_id: "match-a", result_digest: resultDigest, ruleset, world_identity: world,
    frames: [{ tick: 3, events: [], visible_state: { entities: {}, global_fields: {} } }] };
  const ownerReplay = { ...replay, perspective: "attacker", frames: [{ tick: 3, visible_state: { entities: { "visible-10": hero }, global_fields: {} },
    events: [{ event: "next.behavior_order_committed", entity: "visible-10", payload: {
      tick: { kind: "integer", value: 3 }, sequence: { kind: "integer", value: 0 }, action_id: field("action-a"),
      members: { kind: "list", value: [{ kind: "record", value: {
        entity: { kind: "entity", value: "visible-10" }, goal: field("node-b"), target: { kind: "null" }, retreating: { kind: "bool", value: false },
      } }] },
    } }] }] };
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
    expect(army.events).toHaveLength(4);
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

  it("uses roster notices for raw intent IDs and an explicit reference for projected committed-order IDs", async () => {
    const verified = await verifyCoverageRun(await validRun(), catalog, true, "program");
    if (verified.status !== "available") throw new Error(verified.reason);
    const heroEvents = scopedCoverageEvents(verified, "hero", [subject], 3);
    expect(heroEvents.status).toBe("available");
    if (heroEvents.status !== "available") throw new Error(heroEvents.reason);
    expect(heroEvents.rawIdentityAvailable).toBe(true);
    expect(heroEvents.events.map(event => event.sequence)).toEqual([2, 3, 4]);
    expect(coverageDiagnosticText(heroEvents.events[1], verified)).toContain("actor other · target hero-entity");
    expect(coverageDiagnosticText(heroEvents.events[2], verified)).toContain("visible-10: goal node-b, target null, retreating false");
    expect(scopedCoverageEvents(verified, "hero", [subject], 4).status).toBe("unavailable");
    const frame = verified.ownerReplay.frames[0];
    const duplicated = { ...verified, ownerReplay: { ...verified.ownerReplay, frames: [{ ...frame,
      visible_state: { ...frame.visible_state!, entities: { ...frame.visible_state!.entities, duplicate: hero } } }] } };
    expect(scopedCoverageEvents(duplicated, "hero", [subject], 3).status).toBe("unavailable");
    expect(scopedCoverageEvents(verified, "squad", [{ ...subject, squad: "other" }], 3).status).toBe("unavailable");
  });

  it("rejects wrong, ambiguous, or malformed committed-order references", async () => {
    const verified = await verifyCoverageRun(await validRun(), catalog, true, "program");
    if (verified.status !== "available") throw new Error(verified.reason);
    const notice = events[4];
    expect(committedCoverageOrder(verified, notice)).not.toBeNull();
    const frame = verified.ownerReplay.frames[0];
    const duplicate = { ...verified, ownerReplay: { ...verified.ownerReplay, frames: [{ ...frame, events: [...frame.events, frame.events[0]] }] } };
    expect(committedCoverageOrder(duplicate, notice)).toBeNull();
    expect(scopedCoverageEvents(duplicate, "hero", [subject], 3)).toMatchObject({ status: "available", events: [events[2], events[3]] });
    expect(committedCoverageOrder(verified, { ...notice, action_id: "different" })).toBeNull();
    expect(committedCoverageOrder(verified, { ...notice, side: "defender" })).toBeNull();
    const malformed = { ...notice, record: { kind: "runtime_notice" as const, value: { code: "enbu.behavior_order_committed", details: { owner_replay_tick: "03", owner_replay_sequence: "0" } } } };
    expect(committedCoverageOrder(verified, malformed)).toBeNull();
    expect(coverageDiagnosticText(malformed, verified)).toBe("Committed-order Replay reference unavailable");
  });

  it("keeps legacy or ambiguous raw identities unbound without losing separately verified commitments", async () => {
    const verified = await verifyCoverageRun(await validRun(), catalog, true, "program");
    if (verified.status !== "available") throw new Error(verified.reason);
    const legacy = { ...verified, events: verified.events.filter(event => event.tick !== 0) };
    expect(scopedCoverageEvents(legacy, "hero", [subject], 3)).toMatchObject({
      status: "available", rawIdentityAvailable: false, events: [events[4]],
    });
    const duplicate = { ...verified, events: [...verified.events, { ...events[0], sequence: 99, entity_id: "other-id" }] };
    expect(scopedCoverageEvents(duplicate, "hero", [subject], 3)).toMatchObject({
      status: "available", rawIdentityAvailable: false, events: [events[4]],
    });
  });
});
