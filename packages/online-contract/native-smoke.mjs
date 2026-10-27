#!/usr/bin/env node
// Run after building senkei-wasm-dispatch; this exercises a real Rust core, not a service.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";

const binary = process.env.SENKEI_NATIVE_DISPATCHER ?? resolve("target/debug/senkei-wasm-dispatch");
const api = { major: 1, minor: 0, patch: 0 };
let sequence = 0;
function dispatch(operation, payload) {
  const input = `${JSON.stringify({ api_version: api, request_id: `online-smoke-${++sequence}`, operation, payload })}\n`;
  const raw = execFileSync(binary, [], { cwd: process.cwd(), encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  const response = JSON.parse(raw);
  if (!response.ok) throw new Error(`${operation}: ${JSON.stringify(response.error)}`);
  return response.result;
}
const assets = dispatch("next_reproduction_assets", {});
const rules = assets.rule_package;
const program = dispatch("compile_text", { ruleset_ref: rules.ruleset, source: "senkei smoke { state inert { false, }, }" }).program;
const context = dispatch("new_match_context", { ruleset_ref: rules.ruleset, match_id: "online-native-smoke" });
context.max_ticks = 1;
const value = item => ({ kind: "string", value: item });
const side = owner => ({ schema_version: rules.model_version, id: `smoke-${owner}`, revision: "1", ruleset: rules.ruleset, initial_memory: {}, program,
  configuration: { heroes: { kind: "list", value: rules.next.heroes.slice(0, 5).map((hero, index) => ({ kind: "record", value: {
    slot_id: value(`slot-${index + 1}`), catalog_id: value(hero.id), squad: value(`squad-${index + 1}`),
    skill_path: value(Object.keys(hero.skill_paths)[0]), node: value(owner === "attacker" ? rules.next.map.attacker_base : rules.next.map.defender_base),
  } })) } } });
const snapshot = { attacker: side("attacker"), defender: side("defender"), context };
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, entries: [] }, appType: "custom" });
try {
  const { reproductionSnapshotDigest } = await server.ssrLoadModule("/apps/web/src/worker/input-identity.ts");
  const { ReproducingCoreClientAdapter, executeAdmittedMatch } = await server.ssrLoadModule("/packages/online-contract/src/index.ts");
  const snapshotDigest = await reproductionSnapshotDigest(snapshot);
  const match = { authorityId: "authority", matchId: context.match_id, attackerPlayerId: "attacker", defenderPlayerId: "defender",
    request: { requestId: "request", idempotencyKey: "key", attacker: { id: snapshot.attacker.id, revision: snapshot.attacker.revision }, defenseRegistrationId: "defense" }, snapshot, assets, snapshotDigest };
  const core = new ReproducingCoreClientAdapter({
    async preflightReproduction(snapshot, assets, snapshot_digest) { dispatch("preflight_reproduction", { snapshot, assets, snapshot_digest }); },
    async reproduce(snapshot, assets, snapshot_digest) {
      const result = dispatch("reproduce", { snapshot, assets, snapshot_digest, include_diagnostics: false });
      return { outcome: { result: result.result, presentation_replay: result.replay }, authorized_side: result.authorized_side, owner_replays: result.owner_replays, owner_replay: result.owner_replay, restricted_diagnostics: result.diagnostics };
    },
  });
  let recorded;
  const ports = { authorityId: "authority", authentication: { authenticate: async () => { throw new Error("unused"); } },
    admission: { admit: async () => { throw new Error("unused"); }, loadAdmitted: async () => match }, core,
    settlement: { finalize: async (input, execution) => {
      recorded = { input, execution };
      return { status: "committed", receipt: { authorityId: input.authorityId, matchId: input.matchId, requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey, snapshotDigest: input.snapshotDigest, resultDigest: execution.resultDigest, settlementId: "test-only", provenance: "test-only" } };
    }, readFinalized: async () => null, inquire: async () => ({ status: "outcome_unknown" }) }, replayAccess: { mayRead: async () => false } };
  const finalization = await executeAdmittedMatch(ports, match.matchId);
  assert.equal(finalization.status, "committed");
  assert.equal(recorded.execution.result.match_id, match.matchId);
  assert.equal(recorded.execution.publicReplay.perspective, undefined);
  assert.equal(recorded.execution.snapshotDigest, snapshotDigest);
  const tampered = structuredClone(recorded.execution);
  tampered.publicReplay.frames[0].events.push({ event: "forged", entity: null, payload: {} });
  await assert.rejects(core.verifyPublicReplay(match, tampered), /differs from the reproduced core output/);
  const broken = structuredClone(match);
  assert.ok(broken.snapshot.attacker.program.bytecode.length > 0);
  broken.snapshot.attacker.program.bytecode[0] ^= 1;
  broken.snapshotDigest = await reproductionSnapshotDigest(broken.snapshot);
  await assert.rejects(core.verifyAndExecute(broken), /preflight_reproduction/);
  console.log("PASS: trusted native CoreClient preflight, reproduction, result identity, changed-bytecode and altered public replay rejection; settlement is a test double");
} finally { await server.close(); }
