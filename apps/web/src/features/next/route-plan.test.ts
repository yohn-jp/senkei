import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiagnosticEvent, MatchResult, RulePackage, SimulationSnapshot, TacticalIntent } from "../../contracts";
import type { NextRouteMatch } from "../../contracts/next-route-minion";
import { reproductionSnapshotDigest } from "./experiment-restoration";
import { RoutePlanEditor } from "./RoutePlanEditor";
import { connectedNodes, localRoutePolicy, parseRouteDraft, prepareRoutePlan, verifyRouteEvidence } from "./route-plan";
import type { RoutePlanRun } from "./route-plan";

const version = { major: 1, minor: 0, patch: 0 };
const ruleset = { id: "rules", version, digest: "a".repeat(64) };
const world = { world_id: "world", schema_version: version, compiler_version: version, minimum_compiler: version,
  maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null,
  logic_digest: "b".repeat(64), presentation_digest: "c".repeat(64) };
const rules = { ruleset, next: { world_identity: world, map: { world_identity: world,
  world_projection: { source_identity: world, node_ids: ["a", "b", "c", "isolated"] },
  nodes: { a: {}, b: {}, c: {}, isolated: {} }, edges: [
    { from: "a", to: "b", length: 10, blocked: false, region: "lane" },
    { from: "b", to: "c", length: 10, blocked: false, region: "lane" },
    { from: "a", to: "isolated", length: 10, blocked: true, region: "lane" },
  ] } } } as unknown as RulePackage;
const result: MatchResult = { match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7,
  statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest" };
const resultDigest = "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b";
const field = (value: string) => ({ kind: "string" as const, value });
const move: TacticalIntent = { action_id: "march", capability: "move", actor: "actual-hero", target: null,
  arguments: [{ kind: "entity", value: "actual-hero" }, field("c")], priority: null };
const notice: DiagnosticEvent = { tick: 0, side: "attacker", sequence: 0, action_id: null, entity_id: "actual-hero",
  record: { kind: "runtime_notice", value: { code: "enbu.next_hero_identity", details: { slot_id: "slot-1", catalog_id: "F01" } } } };
const proposal: DiagnosticEvent = { tick: 1, side: "attacker", sequence: 1, action_id: "march", entity_id: "actual-hero",
  record: { kind: "intent_proposed", value: { intent: move } } };
const accepted: DiagnosticEvent = { tick: 1, side: "attacker", sequence: 2, action_id: "march", entity_id: "actual-hero",
  record: { kind: "intent_accepted", value: { intent: move } } };

async function validRun(): Promise<RoutePlanRun> {
  const snapshot = { attacker: { ruleset, program: { content_digest: "program" }, configuration: { heroes: { kind: "list", value: [
    { kind: "record", value: { slot_id: field("slot-1"), catalog_id: field("F01"), squad: field("solo"), node: field("a") } },
  ] } } }, defender: { ruleset }, context: { match_id: "match-a", ruleset, world_identity: world } } as unknown as SimulationSnapshot;
  const replay = { schema_version: version, match_id: "match-a", result_digest: resultDigest, ruleset, world_identity: world, frames: [] };
  return { snapshot, includeDiagnostics: true, response: {
    authorized_side: "attacker", outcome: { result, presentation_replay: replay },
    owner_replays: { attacker: { ...replay, perspective: "attacker" } },
    restricted_diagnostics: { identity: { schema_version: 1, side: "attacker", match_id: "match-a", result_digest: resultDigest,
      snapshot_digest: await reproductionSnapshotDigest(snapshot), program_digest: "program" },
      events: [notice, proposal, accepted], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
  } } as unknown as RoutePlanRun;
}

function plan(): NextRouteMatch {
  return { policy: localRoutePolicy(rules)!, commands: [{ side: "attacker", action_id: "march", actor: "actual-hero",
    destination: "c", preference: "fastest", waypoints: ["b"] }] };
}

describe("Route plan evidence and preparation", () => {
  it("binds actual proposed and accepted Jinrei moves to an explicit owner roster notice", async () => {
    const evidence = await verifyRouteEvidence(await validRun(), rules, true);
    expect(evidence).toEqual({ status: "available", nodes: ["a", "b", "c", "isolated"], moves: [{
      actionId: "march", actor: "actual-hero", destination: "c", slotId: "slot-1", catalogId: "F01", startNode: "a", firstTick: 1,
    }] });
    expect([...connectedNodes(rules, "a")]).toEqual(["a", "b", "c"]);
  });

  it("does not expose stale, unauthorized, mismatched Program, snapshot, World or Replay identities", async () => {
    const run = await validRun();
    expect((await verifyRouteEvidence(run, rules, false)).status).toBe("unavailable");
    expect((await verifyRouteEvidence({ ...run, includeDiagnostics: false }, rules, true)).status).toBe("unavailable");
    const diagnostics = run.response.restricted_diagnostics!;
    const withIdentity = (identity: typeof diagnostics.identity) => ({ ...run, response: { ...run.response,
      restricted_diagnostics: { ...diagnostics, identity } } });
    expect((await verifyRouteEvidence(withIdentity({ ...diagnostics.identity, program_digest: "other" }), rules, true)).status).toBe("unavailable");
    expect((await verifyRouteEvidence(withIdentity({ ...diagnostics.identity, snapshot_digest: "other" }), rules, true)).status).toBe("unavailable");
    const badWorld = { ...rules, next: { ...rules.next!, world_identity: { ...world, world_id: "different" } } };
    expect((await verifyRouteEvidence(run, badWorld, true)).status).toBe("unavailable");
    const owner = run.response.owner_replays!.attacker!;
    const badReplay = { ...run, response: { ...run.response, owner_replays: { attacker: { ...owner, result_digest: "other" } } } };
    expect((await verifyRouteEvidence(badReplay, rules, true)).status).toBe("unavailable");
    const defenderEvent = { ...run, response: { ...run.response, restricted_diagnostics: { ...diagnostics,
      events: [...diagnostics.events, { ...accepted, side: "defender" as const }] } } };
    expect((await verifyRouteEvidence(defenderEvent, rules, true)).status).toBe("unavailable");
  });

  it("never infers actor IDs or treats rejected/generated orders as submitted Jinrei moves", async () => {
    const run = await validRun();
    const diagnostics = run.response.restricted_diagnostics!;
    const withEvents = (events: readonly DiagnosticEvent[]) => ({ ...run, response: { ...run.response, restricted_diagnostics: { ...diagnostics, events } } });
    expect(await verifyRouteEvidence(withEvents([proposal, accepted]), rules, true)).toMatchObject({ status: "available", moves: [] });
    expect(await verifyRouteEvidence(withEvents([notice, accepted]), rules, true)).toMatchObject({ status: "available", moves: [] });
    expect(await verifyRouteEvidence(withEvents([notice, proposal, { ...accepted, record: { kind: "intent_rejected", value: { intent: move, reason: "no" } } }]), rules, true))
      .toMatchObject({ status: "available", moves: [] });
    const duplicateNotice = { ...notice, sequence: 3, entity_id: "other-hero" };
    expect(await verifyRouteEvidence(withEvents([notice, duplicateNotice, proposal, accepted]), rules, true)).toMatchObject({ status: "available", moves: [] });
    const wrongEvent = { ...accepted, action_id: "other" };
    expect(await verifyRouteEvidence(withEvents([notice, proposal, wrongEvent]), rules, true)).toMatchObject({ status: "available", moves: [] });
  });

  it("reviews ordered connected waypoints and fails closed for stale commands", async () => {
    const evidence = await verifyRouteEvidence(await validRun(), rules, true);
    if (evidence.status !== "available") throw new Error(evidence.reason);
    const selected = evidence.moves[0];
    expect(prepareRoutePlan(rules, evidence, null, selected, ["b", "a"]).ok).toBe(true);
    const prepared = prepareRoutePlan(rules, evidence, null, selected, ["b", "a"]);
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(prepared.plan.commands[0].waypoints).toEqual(["b", "a"]);
    expect(prepared.plan.commands[0].actor).toBe("actual-hero");
    expect(prepareRoutePlan(rules, evidence, null, selected, ["isolated"]).ok).toBe(false);
    const stale = { ...plan(), commands: [{ ...plan().commands[0], actor: "stale-hero" }] };
    expect(prepareRoutePlan(rules, evidence, stale, selected, ["b"]).ok).toBe(false);
    expect(prepareRoutePlan(rules, evidence, plan(), { ...selected, actor: "not-observed" }, ["b"]).ok).toBe(false);
  });
});

describe("saved route shape", () => {
  it("round-trips a finite test-only policy and rejects unsupported or malformed metadata", () => {
    const original = plan();
    expect(parseRouteDraft(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(parseRouteDraft({ ...original, policy: { ...original.policy, test_only: false } })).toBeNull();
    expect(parseRouteDraft({ ...original, policy: { ...original.policy, preferences: ["safest"] } })).toBeNull();
    expect(parseRouteDraft({ ...original, policy: { ...original.policy, version: { ...version, major: -1 } } })).toBeNull();
    expect(parseRouteDraft({ ...original, policy: { ...original.policy, world_identity: { ...world, world_id: "" } } })).toBeNull();
    expect(parseRouteDraft({ ...original, commands: [...original.commands, original.commands[0]] })).toBeNull();
    expect(parseRouteDraft({ ...original, commands: [{ ...original.commands[0], side: "defender" }] })).toBeNull();
    expect(parseRouteDraft({ ...original, extra: true })).toBeNull();
  });

  it("renders a safe unavailable state before any owner Run has been verified", () => {
    const html = renderToStaticMarkup(createElement(RoutePlanEditor, { rulePackage: null, run: null, runCurrent: false, routeDraft: null, onApply: () => {} }));
    expect(html).toContain("Test-only");
    expect(html).not.toContain("Apply route plan");
    expect(html).not.toContain("actual-hero");
  });
});
