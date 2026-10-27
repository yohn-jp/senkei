/**
 * Provider-independent boundaries for a future official Match authority.
 * All ports below are trusted server-side implementations, not browser claims.
 * This package supplies no authentication, storage, worker, settlement or policy.
 */
import type { ReproductionAssets, SimulationSnapshot } from "../../../apps/web/src/contracts/core";
import type { MatchResult, PresentationReplay, WorldIdentityRef } from "../../../apps/web/src/contracts/core-model";
export { ReproducingCoreClientAdapter } from "./core-client";
export * from "./economy";
export * from "./progression-read";

export interface Principal {
  readonly playerId: string;
  readonly identityAuthorityId: string;
}

export interface MatchRequest {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly attacker: { readonly id: string; readonly revision: string };
  readonly defenseRegistrationId: string;
}

/** The private, immutable record retained by the authority, never a client response. */
export interface AdmittedMatch {
  readonly authorityId: string;
  readonly matchId: string;
  readonly request: MatchRequest;
  readonly attackerPlayerId: string;
  readonly defenderPlayerId: string;
  /** Includes both Senkei snapshots, programs, initial memory, World, versions and limits. */
  readonly snapshot: SimulationSnapshot;
  /** The actual RulePackage and authored World, not merely their hashes. */
  readonly assets: ReproductionAssets;
  /** Core reproduction digest of the complete snapshot. */
  readonly snapshotDigest: string;
}

export interface ExecutionOutput {
  readonly snapshotDigest: string;
  readonly resultDigest: string;
  readonly result: MatchResult;
  /** Enbu's allowlisted public projection, never an owner replay or diagnostics. */
  readonly publicReplay: PresentationReplay;
}

export interface SettlementReceipt {
  readonly authorityId: string;
  readonly matchId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly snapshotDigest: string;
  readonly resultDigest: string;
  readonly settlementId: string;
  /** Opaque authority provenance; not independently authenticated by this package. */
  readonly provenance: string;
}

export type SettlementOutcome =
  | { readonly status: "committed"; readonly receipt: SettlementReceipt }
  | { readonly status: "pending" | "rejected" | "outcome_unknown" };

export interface FinalizedMatch {
  readonly match: AdmittedMatch;
  readonly execution: ExecutionOutput;
  readonly receipt: SettlementReceipt;
}

export interface PublicMatchResult {
  readonly matchId: string;
  readonly outcome: MatchResult["outcome"];
  readonly terminationReason: string;
  readonly finalTick: number;
  readonly resultDigest: string;
}

export interface PublishedMatch {
  readonly result: PublicMatchResult;
  readonly replay: PresentationReplay;
}

export interface AuthenticationPort<Credentials> {
  /** Authenticate credentials and establish player identity; reject invalid credentials. */
  authenticate(credentials: Credentials): Promise<Principal>;
}

export interface AdmissionPort {
  /**
   * Atomically authenticate the supplied principal's ownership of the exact attacker
   * revision, resolve the selected registered defense and pin immutable input assets.
   * Apply the configured ticket, limits and anti-abuse policy here. Request identity
   * is scoped to the principal; a repeated identical request returns the same Match,
   * while reuse with different content is rejected. No policy is defined here.
   */
  admit(principal: Principal, request: MatchRequest): Promise<AdmittedMatch>;
  /** Load the privately retained admitted input for an asynchronous authority job. */
  loadAdmitted(matchId: string): Promise<AdmittedMatch | null>;
}

export interface OfficialCorePort {
  /**
   * Recompute the complete input digest, resolve and verify the retained package and
   * World, revalidate both Senkei snapshots, programs/bytecode, equipment, cost and
   * versions using the core, then execute Enbu to completion. Generate publicReplay
   * directly through Enbu's allowlisted public projection. Never accept a browser's
   * result, CU claim or legality verdict as this output.
   */
  verifyAndExecute(match: AdmittedMatch): Promise<ExecutionOutput>;
  /** Recompute the Rust core MatchResult digest; reject any result/digest mismatch. */
  verifyResult(match: AdmittedMatch, execution: ExecutionOutput): Promise<void>;
  /**
   * Establish that this exact replay is the authorized public projection for the
   * retained match and result, with allowed fields/events only. It must not contain
   * opponent source, IR, bytecode, internal conditions, memory, trace or hidden state.
   */
  verifyPublicReplay(match: AdmittedMatch, execution: ExecutionOutput): Promise<void>;
}

export interface SettlementPort {
  /**
   * Atomically and durably persist the pinned input, result, public replay, ticket
   * accounting and rating change. Same Match/request and identical execution returns
   * the original receipt; conflicting input or result is rejected. A timeout or lost
   * reply is outcome_unknown, never success. This port decides no reward entitlement.
   */
  finalize(match: AdmittedMatch, execution: ExecutionOutput): Promise<SettlementOutcome>;
  /** Read only records committed by the same atomic settlement boundary. */
  readFinalized(matchId: string): Promise<FinalizedMatch | null>;
  /** Inquiry uses the original Match identity; it does not submit another settlement. */
  inquire(matchId: string): Promise<SettlementOutcome>;
}

export type Viewer = { readonly kind: "anonymous" } | { readonly kind: "player"; readonly principal: Principal };
export interface ReplayAccessPort {
  /** Replay permission is independent of permission to publish/fork tactical code. */
  mayRead(matchId: string, viewer: Viewer): Promise<boolean>;
}

export interface OfficialMatchPorts<Credentials> {
  readonly authorityId: string;
  readonly authentication: AuthenticationPort<Credentials>;
  readonly admission: AdmissionPort;
  readonly core: OfficialCorePort;
  readonly settlement: SettlementPort;
  readonly replayAccess: ReplayAccessPort;
}

function requireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) throw new Error(`Invalid ${label}`);
}
function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid ${label}`);
}
function requirePrincipal(principal: Principal): void {
  if (!principal || typeof principal !== "object") throw new Error("Invalid principal");
  fields(principal, ["playerId", "identityAuthorityId"]);
  requireId(principal.playerId, "player identity");
  requireId(principal.identityAuthorityId, "identity authority");
}
function requireRequest(request: MatchRequest): void {
  if (!request || typeof request !== "object" || !request.attacker || typeof request.attacker !== "object") throw new Error("Invalid match request");
  fields(request, ["requestId", "idempotencyKey", "attacker", "defenseRegistrationId"]);
  fields(request.attacker, ["id", "revision"]);
  requireId(request.requestId, "request identity");
  requireId(request.idempotencyKey, "idempotency key");
  requireId(request.attacker.id, "attacker snapshot identity");
  requireId(request.attacker.revision, "attacker snapshot revision");
  requireId(request.defenseRegistrationId, "defense registration identity");
}
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
function immutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
  };
  freeze(cloned);
  return cloned;
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid contract object");
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("Unexpected contract field");
}
function version(value: unknown): void {
  fields(value, ["major", "minor", "patch"]);
  if (![value.major, value.minor, value.patch].every((part) => Number.isSafeInteger(part) && (part as number) >= 0)) throw new Error("Invalid component version");
}
function requireRuleset(value: unknown): void {
  fields(value, ["id", "version", "digest"]);
  requireId(value.id, "ruleset identity");
  requireDigest(value.digest, "ruleset digest");
  version(value.version);
}
function requireWorld(world: WorldIdentityRef | undefined): asserts world is WorldIdentityRef {
  if (!world || typeof world !== "object") throw new Error("Missing paired World identity");
  fields(world, ["world_id", "schema_version", "compiler_version", "minimum_compiler", "maximum_compiler_exclusive", "validation_profile_id", "validation_profile_version", "logic_digest", "presentation_digest"]);
  requireId(world.world_id, "World identity");
  requireDigest(world.logic_digest, "World logic digest");
  requireDigest(world.presentation_digest, "World presentation digest");
  version(world.schema_version);
  version(world.compiler_version);
  version(world.minimum_compiler);
  if (world.maximum_compiler_exclusive !== null) version(world.maximum_compiler_exclusive);
  const compareVersion = (a: typeof world.compiler_version, b: typeof world.compiler_version): number =>
    a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if ((world.compiler_version.major === 0 && world.compiler_version.minor === 0 && world.compiler_version.patch === 0) ||
      compareVersion(world.compiler_version, world.minimum_compiler) < 0 ||
      (world.maximum_compiler_exclusive !== null &&
        (compareVersion(world.minimum_compiler, world.maximum_compiler_exclusive) >= 0 || compareVersion(world.compiler_version, world.maximum_compiler_exclusive) >= 0))) throw new Error("Incompatible World compiler");
  if ((world.validation_profile_id === null) !== (world.validation_profile_version === null)) throw new Error("Incomplete World identity");
  if (world.validation_profile_id !== null) {
    requireId(world.validation_profile_id, "World validation profile");
    version(world.validation_profile_version);
  }
}
function requireDomainValue(value: unknown): void {
  fields(value, ["kind"], ["value"]);
  switch (value.kind) {
    case "null":
      fields(value, ["kind"]); return;
    case "bool":
      if (typeof value.value !== "boolean") throw new Error("Invalid replay value"); break;
    case "integer":
      if (!Number.isSafeInteger(value.value)) throw new Error("Invalid replay value"); break;
    case "fixed":
      fields(value.value, ["coefficient", "scale"]);
      if (!Number.isSafeInteger(value.value.coefficient) || !Number.isSafeInteger(value.value.scale)) throw new Error("Invalid replay value"); break;
    case "string": case "enum": case "entity":
      if (typeof value.value !== "string") throw new Error("Invalid replay value"); break;
    case "list":
      if (!Array.isArray(value.value)) throw new Error("Invalid replay value");
      value.value.forEach(requireDomainValue); break;
    case "record":
      domainFields(value.value); break;
    default: throw new Error("Invalid replay value");
  }
  if (!Object.hasOwn(value, "value")) throw new Error("Missing replay value");
}
function domainFields(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid replay values");
  Object.values(value).forEach(requireDomainValue);
}
/** Only the public Enbu DTO is accepted; its field payloads still require the core's semantic allowlist. */
function requirePublicShape(replay: PresentationReplay): void {
  fields(replay, ["schema_version", "match_id", "result_digest", "ruleset", "world_identity", "frames"]);
  version(replay.schema_version);
  requireRuleset(replay.ruleset);
  requireWorld(replay.world_identity);
  if (!Array.isArray(replay.frames)) throw new Error("Invalid replay frames");
  for (const frame of replay.frames) {
    fields(frame, ["tick", "events", "visible_state"]);
    if (typeof frame.tick !== "number" || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.events)) throw new Error("Invalid replay frame");
    for (const event of frame.events) {
      fields(event, ["event", "entity", "payload"]);
      requireId(event.event, "replay event");
      if (event.entity !== null) requireId(event.entity, "replay entity");
      domainFields(event.payload);
    }
    if (frame.visible_state !== null) {
      fields(frame.visible_state, ["entities", "global_fields"]);
      const entities = frame.visible_state.entities;
      if (!entities || typeof entities !== "object" || Array.isArray(entities)) throw new Error("Invalid replay entities");
      for (const entity of Object.values(entities)) {
        fields(entity, ["entity_type", "owner", "fields"]);
        requireId(entity.entity_type, "entity type");
        if (entity.owner !== null && entity.owner !== "attacker" && entity.owner !== "defender") throw new Error("Invalid replay owner");
        domainFields(entity.fields);
      }
      domainFields(frame.visible_state.global_fields);
    }
  }
}
function requireMatch(match: AdmittedMatch, authorityId: string): void {
  if (!match || typeof match !== "object") throw new Error("Missing admitted Match");
  requireId(match.authorityId, "Match authority");
  requireId(match.matchId, "Match identity");
  requireId(match.attackerPlayerId, "attacker player");
  requireId(match.defenderPlayerId, "defender player");
  requireDigest(match.snapshotDigest, "snapshot digest");
  requireRequest(match.request);
  if (match.authorityId !== authorityId) throw new Error("Match authority mismatch");
  const snapshot = match.snapshot;
  const context = snapshot?.context;
  if (!context || !snapshot.attacker || !snapshot.defender || !match.assets?.rule_package || match.assets.format_version !== 1 || !match.assets.world_definition) throw new Error("Missing reproduction input");
  if (context.match_id !== match.matchId || snapshot.attacker.id !== match.request.attacker.id || snapshot.attacker.revision !== match.request.attacker.revision) throw new Error("Admitted Match input mismatch");
  requireWorld(context.world_identity);
  const ruleset = context.ruleset;
  if (!ruleset || !sameJson(ruleset, snapshot.attacker.ruleset) || !sameJson(ruleset, snapshot.defender.ruleset) ||
      !sameJson(ruleset, snapshot.attacker.program?.ruleset) || !sameJson(ruleset, snapshot.defender.program?.ruleset) ||
      !sameJson(ruleset, match.assets.rule_package.ruleset)) throw new Error("RulePackage identity mismatch");
  requireRuleset(ruleset);
}
function requireReceipt(receipt: SettlementReceipt, match: AdmittedMatch, resultDigest: string): void {
  if (!receipt || typeof receipt !== "object") throw new Error("Missing settlement receipt");
  requireId(receipt.settlementId, "settlement identity");
  requireId(receipt.provenance, "settlement provenance");
  if (receipt.authorityId !== match.authorityId || receipt.matchId !== match.matchId || receipt.requestId !== match.request.requestId ||
      receipt.idempotencyKey !== match.request.idempotencyKey || receipt.snapshotDigest !== match.snapshotDigest || receipt.resultDigest !== resultDigest) throw new Error("Settlement receipt identity mismatch");
}
function requireExecution(match: AdmittedMatch, execution: ExecutionOutput): void {
  if (!execution || typeof execution !== "object" || !execution.result || !execution.publicReplay) throw new Error("Missing core execution output");
  requireDigest(execution.resultDigest, "result digest");
  const { result, publicReplay: replay } = execution;
  if (execution.snapshotDigest !== match.snapshotDigest || result.match_id !== match.matchId || replay.match_id !== match.matchId || replay.result_digest !== execution.resultDigest) throw new Error("Core execution identity mismatch");
  if (!Number.isSafeInteger(result.final_tick) || result.final_tick < 0 || result.final_tick > match.snapshot.context.max_ticks) throw new Error("Invalid final tick");
  if (replay.perspective !== undefined) throw new Error("Owner replay cannot be published");
  if (!replay.ruleset || !sameJson(replay.ruleset, match.snapshot.context.ruleset) || !replay.world_identity || !sameJson(replay.world_identity, match.snapshot.context.world_identity) || !sameJson(replay.schema_version, match.snapshot.context.versions.replay_schema)) throw new Error("Public replay identity mismatch");
  requirePublicShape(replay);
}
async function checkExecution(core: OfficialCorePort, match: AdmittedMatch, execution: ExecutionOutput): Promise<void> {
  requireExecution(match, execution);
  await core.verifyResult(match, execution);
  await core.verifyPublicReplay(match, execution);
}
function checkedOutcome(outcome: SettlementOutcome, match: AdmittedMatch, resultDigest: string): SettlementOutcome {
  if (!outcome || typeof outcome !== "object") throw new Error("Invalid settlement outcome");
  if (outcome.status === "committed") {
    requireReceipt(outcome.receipt, match, resultDigest);
    const receipt = outcome.receipt;
    return immutable({ status: "committed", receipt: {
      authorityId: receipt.authorityId, matchId: receipt.matchId, requestId: receipt.requestId,
      idempotencyKey: receipt.idempotencyKey, snapshotDigest: receipt.snapshotDigest,
      resultDigest: receipt.resultDigest, settlementId: receipt.settlementId, provenance: receipt.provenance,
    } });
  }
  else if (outcome.status !== "pending" && outcome.status !== "rejected" && outcome.status !== "outcome_unknown") throw new Error("Invalid settlement outcome");
  return { status: outcome.status };
}

/** Admit a challenge; returned data never contains either side's private snapshot. */
export async function admitMatch<Credentials>(ports: OfficialMatchPorts<Credentials>, credentials: Credentials, input: MatchRequest): Promise<{ readonly matchId: string }> {
  requireId(ports.authorityId, "Match authority");
  requireRequest(input);
  const request = immutable(input);
  const principal = immutable(await ports.authentication.authenticate(credentials));
  requirePrincipal(principal);
  const match = immutable(await ports.admission.admit(principal, request));
  requireMatch(match, ports.authorityId);
  if (match.attackerPlayerId !== principal.playerId || !sameJson(match.request, request)) throw new Error("Admission identity mismatch");
  return { matchId: match.matchId };
}

/** Called by a server-side asynchronous worker, never with a client-supplied result. */
export async function executeAdmittedMatch<Credentials>(ports: OfficialMatchPorts<Credentials>, matchId: string): Promise<SettlementOutcome> {
  requireId(ports.authorityId, "Match authority");
  requireId(matchId, "Match identity");
  const loaded = await ports.admission.loadAdmitted(matchId);
  if (!loaded) throw new Error("Admitted Match not found");
  const match = immutable(loaded);
  requireMatch(match, ports.authorityId);
  if (match.matchId !== matchId) throw new Error("Loaded Match identity mismatch");
  const execution = immutable(await ports.core.verifyAndExecute(match));
  await checkExecution(ports.core, match, execution);
  return checkedOutcome(await ports.settlement.finalize(match, execution), match, execution.resultDigest);
}

/** Server-side inquiry for an ambiguous settlement by its original Match ID. */
export async function inquireMatch<Credentials>(ports: OfficialMatchPorts<Credentials>, matchId: string): Promise<SettlementOutcome> {
  requireId(ports.authorityId, "Match authority");
  requireId(matchId, "Match identity");
  const outcome = await ports.settlement.inquire(matchId);
  if (!outcome || !["pending", "rejected", "outcome_unknown", "committed"].includes(outcome.status)) throw new Error("Invalid settlement outcome");
  if (outcome.status === "committed") {
    const finalized = await ports.settlement.readFinalized(matchId);
    if (!finalized) throw new Error("Committed Match record is missing");
    const copy = immutable(finalized);
    requireMatch(copy.match, ports.authorityId);
    if (copy.match.matchId !== matchId) throw new Error("Finalized Match identity mismatch");
    await checkExecution(ports.core, copy.match, copy.execution);
    requireReceipt(copy.receipt, copy.match, copy.execution.resultDigest);
    if (!sameJson(copy.receipt, outcome.receipt)) throw new Error("Conflicting settlement receipt");
    return checkedOutcome(outcome, copy.match, copy.execution.resultDigest);
  }
  return { status: outcome.status };
}

/** A viewer may receive only a separately authorized, committed public projection. */
export async function readPublishedMatch<Credentials>(ports: OfficialMatchPorts<Credentials>, matchId: string, viewer: { readonly kind: "anonymous" } | { readonly kind: "player"; readonly credentials: Credentials }): Promise<PublishedMatch | null> {
  requireId(ports.authorityId, "Match authority");
  requireId(matchId, "Match identity");
  let resolved: Viewer;
  if (viewer.kind === "anonymous") resolved = { kind: "anonymous" };
  else if (viewer.kind === "player") {
    const principal = immutable(await ports.authentication.authenticate(viewer.credentials));
    requirePrincipal(principal);
    resolved = { kind: "player", principal };
  } else throw new Error("Invalid viewer");
  if (await ports.replayAccess.mayRead(matchId, immutable(resolved)) !== true) throw new Error("Replay access denied");
  const loaded = await ports.settlement.readFinalized(matchId);
  if (!loaded) return null;
  const finalized = immutable(loaded);
  requireMatch(finalized.match, ports.authorityId);
  if (finalized.match.matchId !== matchId) throw new Error("Finalized Match identity mismatch");
  await checkExecution(ports.core, finalized.match, finalized.execution);
  requireReceipt(finalized.receipt, finalized.match, finalized.execution.resultDigest);
  const result = finalized.execution.result;
  return immutable({
    result: { matchId, outcome: result.outcome, terminationReason: result.termination_reason, finalTick: result.final_tick, resultDigest: finalized.execution.resultDigest },
    replay: finalized.execution.publicReplay,
  });
}
