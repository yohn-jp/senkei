import { useEffect, useId, useState } from "react";
import type { RulePackage } from "../../contracts";
import type { NextRouteMatch } from "../../contracts/next-route-minion";
import { canonicalJson } from "../../worker/input-identity";
import {
  connectedNodes, localRoutePolicy, prepareRoutePlan, routeMoveKey, verifyRouteEvidence,
} from "./route-plan";
import type { RouteEvidence, RouteMove, RoutePlanRun } from "./route-plan";

export interface RoutePlanEditorProps {
  readonly rulePackage: RulePackage | null;
  readonly run: RoutePlanRun | null;
  /** True only when the current roster and compiled Program match this Run. */
  readonly runCurrent: boolean;
  readonly routeDraft: NextRouteMatch | null;
  readonly onApply: (next: NextRouteMatch | null) => void;
}

type Checked = { readonly run: RoutePlanRun | null; readonly rules: RulePackage | null; readonly evidence: RouteEvidence };
type Preview =
  | { readonly kind: "apply"; readonly plan: NextRouteMatch; readonly run: RoutePlanRun; readonly rules: RulePackage; readonly original: NextRouteMatch | null }
  | { readonly kind: "remove"; readonly original: NextRouteMatch };

/** Local metadata editor: no movement, source, or saved Draft changes until Apply. */
export function RoutePlanEditor({ rulePackage, run, runCurrent, routeDraft, onApply }: RoutePlanEditorProps) {
  const id = useId();
  const [checked, setChecked] = useState<Checked | null>(null);
  const [selected, setSelected] = useState("");
  const [waypoints, setWaypoints] = useState<readonly string[]>([]);
  const [nextNode, setNextNode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setChecked(null);
    setPreview(null);
    setError(null);
    void verifyRouteEvidence(run, rulePackage, runCurrent).then(evidence => {
      if (!cancelled) setChecked({ run, rules: rulePackage, evidence });
    });
    return () => { cancelled = true; };
  }, [run, rulePackage, runCurrent]);

  const evidence = runCurrent && checked?.run === run && checked.rules === rulePackage ? checked.evidence : null;
  const available = evidence?.status === "available" ? evidence : null;
  const candidate = available?.moves.find(move => routeMoveKey(move) === selected) ?? null;

  const choose = (move: RouteMove | null) => {
    setSelected(move ? routeMoveKey(move) : "");
    const policy = rulePackage ? localRoutePolicy(rulePackage) : null;
    const saved = move && routeDraft && policy && canonicalJson(routeDraft.policy) === canonicalJson(policy)
      ? routeDraft.commands.find(command => command.side === "attacker" && command.action_id === move.actionId
          && command.actor === move.actor && command.destination === move.destination)
      : null;
    setWaypoints(saved ? [...saved.waypoints] : []);
    setNextNode("");
    setPreview(null);
    setError(null);
  };
  useEffect(() => {
    choose(available?.moves[0] ?? null);
    // A new Run, RulePackage or applied Draft starts a fresh edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, routeDraft]);

  const connected = candidate && rulePackage ? connectedNodes(rulePackage, candidate.startNode) : new Set<string>();
  const review = () => {
    if (!candidate || !available || !rulePackage || !run || !runCurrent) return;
    const result = prepareRoutePlan(rulePackage, available, routeDraft, candidate, waypoints);
    if (!result.ok) { setError(result.reason); setPreview(null); return; }
    setError(null);
    setPreview({ kind: "apply", plan: result.plan, run, rules: rulePackage, original: routeDraft });
  };
  const validPreview = preview?.kind === "remove" ? preview.original === routeDraft
    : preview?.kind === "apply" && preview.run === run && preview.rules === rulePackage
      && preview.original === routeDraft && runCurrent && available !== null;
  const apply = () => {
    if (!preview || !validPreview) return;
    onApply(preview.kind === "remove" ? null : preview.plan);
    setPreview(null);
    setError(null);
  };
  const update = (next: readonly string[]) => { setWaypoints(next); setPreview(null); setError(null); };

  return <details className="next-battle-options">
    <summary>Route plan · {routeDraft ? "configured" : "not configured"}</summary>
    <section aria-label="Test-only route plan">
      <p>Test-only Fastest uses the existing travel-time route. A move must win the normal order selection before its waypoints apply. Dynamic crossing and node-exit checks remain in force.</p>
      {routeDraft && <p>A route plan is saved for this Draft. Review changes or removal before applying them.</p>}
      {!evidence && <p>{runCurrent ? "Checking the owner Run identity…" : "The current formation or compiled Program differs from the Run."}</p>}
      {evidence?.status === "unavailable" && <p role="status">{evidence.reason}</p>}
      {available && available.moves.length === 0 && <p>No owner-authorized, accepted Jinrei move with a verified Hero identity is available in this Run.</p>}
      {available && available.moves.length > 0 && <>
        <label htmlFor={`${id}-move`}>Accepted Jinrei move</label>{" "}
        <select id={`${id}-move`} value={candidate ? selected : ""} onChange={event => choose(available.moves.find(move => routeMoveKey(move) === event.target.value) ?? null)}>
          <option value="" disabled>Select a move</option>
          {available.moves.map(move => <option key={routeMoveKey(move)} value={routeMoveKey(move)}>
            {move.slotId} · {move.catalogId} · {move.actionId} → {move.destination} · tick {move.firstTick}
          </option>)}
        </select>
        {candidate && <>
          <p>Destination: <strong>{candidate.destination}</strong> · policy: <strong>Fastest (test-only)</strong></p>
          <label htmlFor={`${id}-waypoint`}>Public World node</label>{" "}
          <select id={`${id}-waypoint`} value={nextNode} onChange={event => setNextNode(event.target.value)}>
            <option value="">Select a waypoint</option>
            {available.nodes.map(node => <option key={node} value={node} disabled={!connected.has(node)}>{node}{connected.has(node) ? "" : " · disconnected"}</option>)}
          </select>{" "}
          <button type="button" disabled={!nextNode || !connected.has(nextNode)} onClick={() => { update([...waypoints, nextNode]); setNextNode(""); }}>Add waypoint</button>
          {waypoints.length === 0 ? <p>No waypoints. The engine chooses the fastest legal route to the destination.</p> : <ol aria-label="Ordered waypoints">
            {waypoints.map((node, index) => <li key={`${index}:${node}`}>
              {node}{" "}<button type="button" disabled={index === 0} aria-label={`Move ${node} at position ${index + 1} earlier`} onClick={() => {
                const next = [...waypoints]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next);
              }}>↑</button>{" "}
              <button type="button" disabled={index === waypoints.length - 1} aria-label={`Move ${node} at position ${index + 1} later`} onClick={() => {
                const next = [...waypoints]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; update(next);
              }}>↓</button>{" "}
              <button type="button" aria-label={`Remove ${node} at position ${index + 1}`} onClick={() => update(waypoints.filter((_, at) => at !== index))}>Remove</button>
            </li>)}
          </ol>}
          <button type="button" onClick={review}>Review route</button>
        </>}
      </>}
      {routeDraft && <button type="button" onClick={() => { setError(null); setPreview({ kind: "remove", original: routeDraft }); }}>Review removal</button>}
      {error && <p role="alert">{error}</p>}
      {preview && validPreview && <section aria-label="Review route change">
        {preview.kind === "remove" ? <p>Remove the saved route plan from the next local match?</p> : <>
          <p>Apply this test-only Fastest plan to the next local match:</p>
          <ul>{preview.plan.commands.map(command => {
            const move = available?.moves.find(item => item.actionId === command.action_id && item.actor === command.actor && item.destination === command.destination);
            return <li key={command.action_id}>{move?.slotId ?? "Hero"} · {command.action_id} → {command.destination}
              {command.waypoints.length ? ` via ${command.waypoints.join(" → ")}` : " · no waypoints"}</li>;
          })}</ul>
          <p>The next launch runs Core preflight against the current snapshot and World.</p>
        </>}
        <button type="button" onClick={apply}>{preview.kind === "remove" ? "Apply removal" : "Apply route plan"}</button>{" "}
        <button type="button" onClick={() => setPreview(null)}>Cancel</button>
      </section>}
    </section>
  </details>;
}
