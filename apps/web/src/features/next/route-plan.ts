import type {
  DiagnosticEvent, DomainValue, RulePackage, SimulationResponse, SimulationSnapshot, WorldIdentityRef,
} from "../../contracts";
import type { NextRouteMatch } from "../../contracts/next-route-minion";
import { canonicalJson, compareUnicodeScalars } from "../../worker/input-identity";
import {
  validateNextExperimentAuthorization, validateNextExperimentDiagnostics, validateNextExperimentReplay,
} from "./experiment-restoration";

/** The Run remains an immutable source of owner-authorized move evidence. */
export interface RoutePlanRun {
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  readonly includeDiagnostics: boolean;
}

export interface RouteMove {
  readonly actionId: string;
  readonly actor: string;
  readonly destination: string;
  readonly slotId: string;
  readonly catalogId: string;
  readonly startNode: string;
  readonly firstTick: number;
}

export type RouteEvidence =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly moves: readonly RouteMove[]; readonly nodes: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hasKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\uD800-\uDFFF]/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function version(value: unknown): value is { major: number; minor: number; patch: number } {
  return isRecord(value) && hasKeys(value, ["major", "minor", "patch"])
    && [value.major, value.minor, value.patch].every(part => Number.isInteger(part) && (part as number) >= 0 && (part as number) <= 65535);
}

function worldIdentity(value: unknown): value is WorldIdentityRef {
  if (!isRecord(value) || !hasKeys(value, ["world_id", "schema_version", "compiler_version", "minimum_compiler",
    "maximum_compiler_exclusive", "validation_profile_id", "validation_profile_version", "logic_digest", "presentation_digest"])) return false;
  return text(value.world_id) && version(value.schema_version) && version(value.compiler_version)
    && version(value.minimum_compiler) && (value.maximum_compiler_exclusive === null || version(value.maximum_compiler_exclusive))
    && ((value.validation_profile_id === null && value.validation_profile_version === null)
      || (text(value.validation_profile_id) && version(value.validation_profile_version)))
    && digest(value.logic_digest) && digest(value.presentation_digest);
}

/** Parse only the Rust DTO shape; Core preflight still validates it against its RulePackage and World. */
export function parseRouteDraft(value: unknown): NextRouteMatch | null {
  if (!isRecord(value) || !hasKeys(value, ["policy", "commands"]) || !isRecord(value.policy) || !Array.isArray(value.commands)) return null;
  const policy = value.policy;
  if (!hasKeys(policy, ["schema_version", "policy_id", "version", "ruleset_digest", "world_identity", "test_only", "preferences"])
    || policy.schema_version !== 1 || !text(policy.policy_id) || !policy.policy_id.trim()
    || new TextEncoder().encode(policy.policy_id).length > 128 || !version(policy.version) || policy.version.major === 0
    || !digest(policy.ruleset_digest) || !worldIdentity(policy.world_identity) || policy.test_only !== true
    || !Array.isArray(policy.preferences) || policy.preferences.length !== 1 || policy.preferences[0] !== "fastest") return null;
  const commands: NextRouteMatch["commands"][number][] = [];
  const seen = new Set<string>();
  for (const command of value.commands) {
    if (!isRecord(command) || !hasKeys(command, ["side", "action_id", "actor", "destination", "preference", "waypoints"])
      || command.side !== "attacker" || !text(command.action_id) || !text(command.actor) || !text(command.destination)
      || command.preference !== "fastest" || !Array.isArray(command.waypoints) || !command.waypoints.every(text)) return null;
    const key = JSON.stringify([command.side, command.action_id]);
    if (seen.has(key)) return null;
    seen.add(key);
    commands.push({ side: "attacker", action_id: command.action_id, actor: command.actor,
      destination: command.destination, preference: "fastest", waypoints: [...command.waypoints] });
  }
  return { policy: {
    schema_version: 1, policy_id: policy.policy_id,
    version: { major: policy.version.major, minor: policy.version.minor, patch: policy.version.patch },
    ruleset_digest: policy.ruleset_digest,
    world_identity: { ...policy.world_identity }, test_only: true, preferences: ["fastest"],
  }, commands };
}

function unavailable(reason: string): RouteEvidence { return { status: "unavailable", reason }; }
function scalar(value: DomainValue | undefined): string | null {
  return value?.kind === "string" ? value.value : null;
}

/** Bind a raw actor only through the producer's owner roster identity notice. */
function rosterActor(run: RoutePlanRun, events: readonly DiagnosticEvent[], actor: string):
  { slotId: string; catalogId: string; startNode: string } | null {
  const roster = run.snapshot.attacker.configuration?.heroes;
  if (roster?.kind !== "list") return null;
  const notices = events.filter(event => event.side === "attacker" && event.tick === 0
    && event.action_id === null && event.record.kind === "runtime_notice"
    && event.record.value.code === "enbu.next_hero_identity");
  const matching = notices.filter(event => event.entity_id === actor);
  if (matching.length !== 1 || matching[0].record.kind !== "runtime_notice") return null;
  const { slot_id: slotId, catalog_id: catalogId } = matching[0].record.value.details;
  if (!text(slotId) || !text(catalogId) || notices.filter(event => event.record.kind === "runtime_notice"
    && event.record.value.details.slot_id === slotId).length !== 1) return null;
  const records = roster.value.filter(entry => entry.kind === "record" && scalar(entry.value.slot_id) === slotId);
  if (records.length !== 1 || records[0].kind !== "record" || scalar(records[0].value.catalog_id) !== catalogId) return null;
  const startNode = scalar(records[0].value.node);
  return startNode ? { slotId, catalogId, startNode } : null;
}

/** Static public topology only; dynamic enemy and crossing legality stay in Core. */
export function connectedNodes(rules: RulePackage, from: string): ReadonlySet<string> {
  const map = rules.next?.map;
  const nodes = map?.nodes;
  const found = new Set<string>();
  if (!map || !nodes || !Object.prototype.hasOwnProperty.call(nodes, from)) return found;
  found.add(from);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const edge of map.edges) {
      if (edge.blocked || !Number.isSafeInteger(edge.length) || edge.length <= 0 || edge.from === edge.to
        || !Object.prototype.hasOwnProperty.call(nodes, edge.from) || !Object.prototype.hasOwnProperty.call(nodes, edge.to)) continue;
      const next = edge.from === node ? edge.to : edge.to === node ? edge.from : null;
      if (next && !found.has(next)) { found.add(next); queue.push(next); }
    }
  }
  return found;
}

export function routeMoveKey(move: RouteMove): string {
  return JSON.stringify([move.actionId, move.actor, move.destination]);
}

/** Verify owner channel, full input and both Replay identities before reading any raw IDs. */
export async function verifyRouteEvidence(
  run: RoutePlanRun | null,
  rules: RulePackage | null,
  runCurrent: boolean,
): Promise<RouteEvidence> {
  if (!runCurrent) return unavailable("The current formation or compiled Program differs from this Run. Run the current Draft to select a route.");
  if (!run || !run.includeDiagnostics || !run.response.restricted_diagnostics) return unavailable("Run this Draft with owner diagnostics to select an accepted move.");
  const next = rules?.next;
  if (!rules || !next?.world_identity || !next.map.world_identity || !next.map.world_projection) return unavailable("The current paired World is unavailable.");
  try {
    validateNextExperimentAuthorization(run.response, true);
    await validateNextExperimentDiagnostics(run.response, run.snapshot);
    const result = run.response.outcome.result;
    const publicReplay = run.response.outcome.presentation_replay;
    const ownerReplay = run.response.owner_replays?.attacker;
    if (!ownerReplay || ownerReplay.perspective !== "attacker") return unavailable("The attacker owner Replay is unavailable.");
    await Promise.all([
      validateNextExperimentReplay(publicReplay, result, run.snapshot.context.match_id),
      validateNextExperimentReplay(ownerReplay, result, run.snapshot.context.match_id),
    ]);
    const ruleset = run.snapshot.context.ruleset;
    const world = run.snapshot.context.world_identity;
    if (!world || !publicReplay.ruleset || !ownerReplay.ruleset || !publicReplay.world_identity || !ownerReplay.world_identity
      || [rules.ruleset, run.snapshot.attacker.ruleset, run.snapshot.defender.ruleset, publicReplay.ruleset, ownerReplay.ruleset]
        .some(value => canonicalJson(value) !== canonicalJson(ruleset))
      || [next.world_identity, next.map.world_identity, next.map.world_projection.source_identity,
        publicReplay.world_identity, ownerReplay.world_identity].some(value => canonicalJson(value) !== canonicalJson(world))) {
      return unavailable("The Run, RulePackage, World or Replay identity does not match.");
    }
    const nodes = Object.keys(next.map.nodes).sort(compareUnicodeScalars);
    const projectedNodes = [...next.map.world_projection.node_ids].sort(compareUnicodeScalars);
    if (!nodes.length || canonicalJson(nodes) !== canonicalJson(projectedNodes)) return unavailable("The paired World node projection cannot be verified.");
    const events = run.response.restricted_diagnostics.events;
    const proposed = new Set(events.filter(event => event.record.kind === "intent_proposed").map(event =>
      `${event.tick}:${canonicalJson(event.record.kind === "intent_proposed" ? event.record.value.intent : null)}`));
    const moves = new Map<string, RouteMove>();
    for (const event of events) {
      if (event.side !== "attacker" || event.record.kind !== "intent_accepted" || !Number.isSafeInteger(event.tick) || event.tick < 0) continue;
      const intent = event.record.value.intent;
      if (intent.capability !== "move" || !text(intent.action_id) || event.action_id !== intent.action_id
        || !text(intent.actor) || intent.target !== null || intent.arguments.length !== 2
        || intent.arguments[0].kind !== "entity" || intent.arguments[0].value !== intent.actor
        || intent.arguments[1].kind !== "string" || !text(intent.arguments[1].value)
        || !proposed.has(`${event.tick}:${canonicalJson(intent)}`)) continue;
      const owner = rosterActor(run, events, intent.actor);
      if (!owner || !connectedNodes(rules, owner.startNode).has(intent.arguments[1].value)) continue;
      const move: RouteMove = { actionId: intent.action_id, actor: intent.actor, destination: intent.arguments[1].value,
        ...owner, firstTick: event.tick };
      const key = routeMoveKey(move);
      const old = moves.get(key);
      if (!old || move.firstTick < old.firstTick) moves.set(key, move);
    }
    return { status: "available", moves: [...moves.values()].sort((a, b) =>
      compareUnicodeScalars(a.slotId, b.slotId) || compareUnicodeScalars(a.actionId, b.actionId)
      || compareUnicodeScalars(a.actor, b.actor) || compareUnicodeScalars(a.destination, b.destination)), nodes };
  } catch {
    return unavailable("Owner authorization or the Run's immutable identity could not be verified.");
  }
}

export function localRoutePolicy(rules: RulePackage): NextRouteMatch["policy"] | null {
  const world = rules.next?.world_identity;
  return world ? { schema_version: 1, policy_id: "senkei.local-trial.fastest-route", version: { major: 1, minor: 0, patch: 0 },
    ruleset_digest: rules.ruleset.digest, world_identity: world, test_only: true, preferences: ["fastest"] } : null;
}

export type RoutePlanResult = { readonly ok: true; readonly plan: NextRouteMatch } | { readonly ok: false; readonly reason: string };

/** Prepare an explicitly reviewed replacement without modifying the current Draft. */
export function prepareRoutePlan(
  rules: RulePackage,
  evidence: Extract<RouteEvidence, { status: "available" }>,
  current: NextRouteMatch | null,
  selected: RouteMove,
  waypoints: readonly string[],
): RoutePlanResult {
  const policy = localRoutePolicy(rules);
  const verifiedMove = evidence.moves.find(move => routeMoveKey(move) === routeMoveKey(selected));
  if (!policy || !verifiedMove) return { ok: false, reason: "The selected move is no longer verified." };
  if (current && (!parseRouteDraft(current) || canonicalJson(current.policy) !== canonicalJson(policy))) {
    return { ok: false, reason: "The saved route belongs to a different policy or World. Review its removal before creating a new route." };
  }
  const matches = (command: NextRouteMatch["commands"][number]) => evidence.moves.find(move =>
    command.side === "attacker" && command.action_id === move.actionId && command.actor === move.actor && command.destination === move.destination);
  for (const command of current?.commands ?? []) {
    const move = matches(command);
    if (!move || command.waypoints.some(node => !connectedNodes(rules, move.startNode).has(node))) {
      return { ok: false, reason: "A saved route is not verified by the current Run. Review its removal before creating a new route." };
    }
  }
  const connected = connectedNodes(rules, verifiedMove.startNode);
  if (!connected.has(verifiedMove.destination) || waypoints.some(node => !connected.has(node))) {
    return { ok: false, reason: "The destination and every waypoint must be connected in the public World." };
  }
  const replacement = { side: "attacker" as const, action_id: verifiedMove.actionId, actor: verifiedMove.actor,
    destination: verifiedMove.destination, preference: "fastest" as const, waypoints: [...waypoints] };
  const commands = [...(current?.commands ?? []).filter(command => command.action_id !== verifiedMove.actionId), replacement]
    .sort((a, b) => compareUnicodeScalars(a.action_id, b.action_id));
  return { ok: true, plan: { policy, commands } };
}
