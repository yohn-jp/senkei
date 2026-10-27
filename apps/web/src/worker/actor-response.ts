import type { ActorDecisionRequest, ActorDecisionResponse } from '../contracts/actor-decisions';
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from './input-identity';
import { matchResultDigestJson } from './result-identity';
import { simulationAuthorizationError } from './simulation-authorization';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Only the requested owner's current, input-bound autonomous facts may leave the Worker. */
export async function actorResponseError(value: unknown, request: ActorDecisionRequest): Promise<string | null> {
  if (!record(value) || value.format_version !== 1 || value.trace_schema_version !== 1
    || value.authorized_side !== request.diagnostics_side || !record(value.simulation) || !Array.isArray(value.trace)
    || Object.keys(value).some(key => !['format_version','trace_schema_version','authorized_side','simulation','trace'].includes(key))) return 'Invalid autonomous inspection envelope.';
  const response = value as unknown as ActorDecisionResponse;
  const simulation = response.simulation;
  const side = request.diagnostics_side;
  const outcome = simulation.outcome;
  if (!outcome?.result || !outcome.presentation_replay) return 'Missing autonomous simulation outcome.';
  const permission = simulationAuthorizationError({ replay: outcome.presentation_replay, authorized_side: simulation.authorized_side,
    owner_replays: simulation.owner_replays, owner_replay: simulation.owner_replay, diagnostics: simulation.restricted_diagnostics }, side);
  if (permission) return permission;
  const identity = simulation.restricted_diagnostics?.identity;
  const owner = simulation.owner_replays?.[side];
  const digest = await sha256Hex(matchResultDigestJson(outcome.result));
  if (!identity || identity.schema_version !== 1 || identity.match_id !== request.snapshot.context.match_id
    || outcome.result.match_id !== identity.match_id || outcome.presentation_replay.match_id !== identity.match_id
    || identity.snapshot_digest !== await reproductionSnapshotDigest(request.snapshot)
    || identity.program_digest !== request.snapshot[side].program.content_digest || identity.result_digest !== digest
    || outcome.presentation_replay.result_digest !== digest || !owner || owner.match_id !== identity.match_id || owner.result_digest !== digest
    || canonicalJson(owner.world_identity) !== canonicalJson(request.snapshot.context.world_identity)) return 'Autonomous inspection identity does not match the immutable Run.';
  const seen = new Set<string>();
  for (const trace of response.trace) {
    if (!record(trace) || Object.keys(trace).some(key => !['tick','actor','kind','candidates','action','committed_event'].includes(key))
      || !Number.isSafeInteger(trace.tick) || trace.tick < 0 || typeof trace.actor !== 'string'
      || !['minion','tower','base'].includes(trace.kind) || !Array.isArray(trace.candidates) || !record(trace.action)) return 'Invalid autonomous decision record.';
    const key = JSON.stringify([trace.tick,trace.actor]);
    if (seen.has(key)) return 'Duplicate autonomous decision record.';
    seen.add(key);
    const frames = owner.frames.filter(frame => frame.tick === trace.tick);
    const entities = frames.length === 1 ? frames[0].visible_state?.entities : undefined;
    const actor = entities?.[trace.actor];
    if (!actor || actor.owner !== side || actor.entity_type !== trace.kind
      || new Set(trace.candidates).size !== trace.candidates.length || trace.candidates.some(id => typeof id !== 'string' || !entities?.[id])) return 'Autonomous decision references an unauthorized entity.';
    if (trace.action.kind === 'no_attack') {
      if (!['moved','action_locked','attack_not_ready','attack_unavailable','no_eligible_target'].includes(trace.action.reason)
        || Object.keys(trace.action).some(key => !['kind','reason'].includes(key)) || trace.committed_event !== null) return 'Invalid non-attack decision.';
    } else if (trace.action.kind === 'attack') {
      const link = trace.committed_event;
      if (!record(link) || Object.keys(link).some(key => !['tick','event_index'].includes(key)) || link.tick !== trace.tick
        || !Number.isSafeInteger(link.event_index) || link.event_index < 0 || !trace.candidates.includes(trace.action.target)
        || !['requested_target','nearest_then_entity_id'].includes(trace.action.selection)
        || Object.keys(trace.action).some(key => !['kind','target','selection'].includes(key))) return 'Invalid autonomous attack reference.';
      const event = frames[0].events[link.event_index];
      const target = event?.payload.target;
      const source = event?.payload.source;
      if (!event || event.event !== 'next.attack' || event.entity !== trace.action.target || source?.kind !== 'entity' || source.value !== trace.actor
        || target?.kind !== 'entity' || target.value !== trace.action.target) return 'Autonomous attack does not reference its committed owner event.';
    } else return 'Unknown autonomous decision kind.';
  }
  return null;
}
