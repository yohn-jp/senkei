import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CoreClient, DomainValue, EntityObservation, Observed } from "../../contracts";
import type { NextDecisionInspection, NextDecisionInspectionRequest } from "../../contracts/next-decision-inspection";
import type { CoverageRun } from "./coverage-observed";
import { decisionCommittedReplayTick, decisionInspectionRequest, decisionValueText, verifyDecisionInspection, verifyDecisionRun } from "./next-decision-inspector";
import type { VerifiedDecisionRun } from "./next-decision-inspector";
import "./next-decision-inspector.css";

export interface NextDecisionInspectorProps {
  readonly core: CoreClient | null;
  readonly run: CoverageRun | null;
  readonly selectedTick?: number | null;
  readonly onReplayTick?: (tick: number) => void;
}
type AvailableRun = Extract<VerifiedDecisionRun, { status: "available" }>;
type InspectionClient = CoreClient & { inspectNextDecision?: (request: NextDecisionInspectionRequest) => Promise<NextDecisionInspection> };
const pageSize = 20;
const domains = ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"] as const;
const numberText = (value: number | null): string => value === null ? "UNKNOWN" : String(value);

function Pager({ page, count, change }: { readonly page: number; readonly count: number; readonly change: (next: number) => void }): ReactElement | null {
  if (count <= pageSize) return null;
  const pages = Math.ceil(count / pageSize), current = Math.min(page, pages - 1);
  return <div className="decision-pager"><button type="button" disabled={current === 0} onClick={() => change(current - 1)}>Previous</button>
    <span>{current * pageSize + 1}–{Math.min((current + 1) * pageSize, count)} of {count}</span>
    <button type="button" disabled={current + 1 >= pages} onClick={() => change(current + 1)}>Next</button></div>;
}
function ObservedFields({ fields }: { readonly fields: Readonly<Record<string, Observed<DomainValue>>> }): ReactElement {
  const [page, setPage] = useState(0);
  const entries = Object.entries(fields), current = Math.min(page, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
  return <><dl>{entries.slice(current * pageSize, (current + 1) * pageSize).map(([name, observed]) => <div key={name}>
    <dt>{name}</dt><dd>{observed.status === "known" ? decisionValueText(observed.value) : "UNKNOWN"}</dd></div>)}</dl>
    {!entries.length && <p>No fields were supplied.</p>}<Pager page={current} count={entries.length} change={setPage} /></>;
}
function EntityPage({ entities }: { readonly entities: readonly EntityObservation[] }): ReactElement {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(entities.length / pageSize) - 1));
  return <>{entities.slice(current * pageSize, (current + 1) * pageSize).map(entity => <details key={entity.id}>
    <summary>{entity.id} · {entity.entity_type}</summary><ObservedFields fields={entity.fields} /></details>)}
    {!entities.length && <p>No entities were observed.</p>}<Pager page={current} count={entities.length} change={setPage} /></>;
}
function Observation({ inspection }: { readonly inspection: NextDecisionInspection }): ReactElement {
  const [collection, setCollection] = useState("");
  const observation = inspection.observation.snapshot;
  if (!observation) return <p>Observation unavailable for this Tick.</p>;
  const names = Object.keys(observation.collections);
  const selected = names.includes(collection) ? collection : names[0];
  const item = selected ? observation.collections[selected] : undefined;
  return <><p>Observed IDs are local aliases for this inspection and are not Replay IDs. The source digest identifies the unprojected observation; it is not a hash of the projected values shown here.</p>
    <p>Source digest: <code>{inspection.observation.source_digest ?? "unavailable"}</code></p>
    <details><summary>Observation fields</summary><ObservedFields fields={observation.fields} /></details>
    {selected && <><label>Observation collection <select value={selected} onChange={event => setCollection(event.currentTarget.value)}>
      {names.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {item?.status === "known" ? <EntityPage key={selected} entities={item.value} /> : <p>Collection: UNKNOWN</p>}</>}
    {!selected && <p>No collections were supplied.</p>}</>;
}

/** Render only a response whose frozen Run lineage was checked by the caller. */
export function DecisionInspectionResult({ inspection, verified, onReplayTick }: { readonly inspection: NextDecisionInspection;
  readonly verified: AvailableRun; readonly onReplayTick?: (tick: number) => void }): ReactElement {
  const [page, setPage] = useState(0);
  const { decision } = inspection;
  const current = Math.min(page, Math.max(0, Math.ceil(decision.candidates.length / pageSize) - 1));
  return <section aria-label="Decision inspection result">
    <p>Re-executed the frozen Run input; the result digest matches the retained Run. Equality of the original decision trace is not independently proven.</p>
    <p>Status: <strong>{decision.status.replaceAll("_", " ")}</strong> · subject: {decision.subject ?? "unavailable"}</p>
    <p>Policy: {inspection.policy.id} {verified.testOnly ? "(test-only)" : ""} · digest <code>{inspection.policy.digest}</code></p>
    <details><summary>Actual observation</summary><Observation inspection={inspection} /></details>
    {decision.composition && <details><summary>Actual profile composition</summary>
      <p>Squad: {decision.composition.squad_id}</p>
      <table><thead><tr><th>Domain</th><th>Shared</th><th>Before Jinrei conditional</th><th>Effective</th></tr></thead>
        <tbody>{domains.map((domain, index) => <tr key={domain}><th>{domain}</th><td>{decision.composition!.shared[index]}</td>
          <td>{decision.composition!.baseline_effective[index]}</td><td>{decision.composition!.effective[index]}</td></tr>)}</tbody></table>
      {decision.composition.members.map(member => <details key={member.actor}><summary>{member.actor} · {member.catalog_id}</summary>
        <dl>{domains.map((domain, index) => <div key={domain}><dt>{domain}</dt><dd>{member.values[index]} · {member.sources[index]}</dd></div>)}</dl></details>)}
    </details>}
    <details open><summary>Selections ({decision.selections.length})</summary>
      {!decision.selections.length && <p>No selection was supplied.</p>}
      {decision.selections.map((selection, index) => {
        const tick = decisionCommittedReplayTick(verified, selection);
        return <div className="decision-entry" key={`${selection.actor}:${index}`}>
          <p>{selection.actor} · {selection.source} · capability {selection.capability ?? "none"} · target {selection.target ?? "not supplied"}</p>
          <p>Score: {selection.score === null ? "not supplied" : selection.score} · candidate: {selection.candidate_index ?? "none"} · arbitration accepted: {selection.arbitration_accepted ? "yes" : "no"} · transition completed: {selection.transition_completed ? "yes" : "no"}</p>
          <p>Committed event: {selection.committed_event ? `Tick ${selection.committed_event.tick}, sequence ${selection.committed_event.sequence}` : "none"}
            {selection.committed_event && tick === null ? " · matching owner Replay event unavailable" : ""}</p>
          {tick !== null && onReplayTick && <button type="button" onClick={() => onReplayTick(tick)}>Open committed Tick in Replay</button>}
        </div>;
      })}</details>
    <details open><summary>Evaluated candidates ({decision.candidates.length})</summary>
      <p>Selected is the policy choice; arbitration acceptance and completed transition are reported separately above. UNKNOWN means the score could not be established.</p>
      {decision.candidates.slice(current * pageSize, (current + 1) * pageSize).map(candidate => <details className="decision-entry" key={candidate.index}>
        <summary>#{candidate.index} · {candidate.kind} · {candidate.outcome} · score {candidate.score === null && candidate.outcome === "ineligible" ? "not scored" : numberText(candidate.score)}</summary>
        <p>Actor: {candidate.actor} · target: {candidate.target ?? "none"} · capability: {candidate.capability} · rank: {candidate.rank ?? "unavailable"}</p>
        <table><thead><tr><th>Domain</th><th>Term</th><th>Weight</th><th>Value</th><th>Contribution</th></tr></thead><tbody>
          {candidate.terms.map((term, index) => <tr key={index}><th>{term.domain}</th><td>{term.kind}{term.signal ? ` · ${term.signal}` : ""}</td>
            <td>{term.weight === null ? "—" : term.weight}</td><td>{numberText(term.value)}</td><td>{numberText(term.contribution)}</td></tr>)}
        </tbody></table></details>)}
      {!decision.candidates.length && <p>No evaluated candidates were supplied.</p>}
      <Pager page={current} count={decision.candidates.length} change={setPage} />
    </details>
  </section>;
}

/** Inspect one owner's Hero and Tick against the immutable completed Run. */
export function NextDecisionInspector({ core, run, selectedTick, onReplayTick }: NextDecisionInspectorProps): ReactElement {
  const [checked, setChecked] = useState<{ readonly run: CoverageRun | null; readonly value: VerifiedDecisionRun } | null>(null);
  const [slot, setSlot] = useState("");
  const [tick, setTick] = useState("1");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ readonly run: CoverageRun; readonly slot: string; readonly tick: number; readonly value: NextDecisionInspection } | null>(null);
  const serial = useRef(0);
  useEffect(() => {
    let cancelled = false;
    serial.current += 1; setPending(false); setMessage(null); setResult(null); setSlot("");
    void verifyDecisionRun(run).then(value => { if (!cancelled) setChecked({ run, value }); });
    return () => { cancelled = true; serial.current += 1; };
  }, [run]);
  useEffect(() => {
    if (selectedTick && Number.isSafeInteger(selectedTick) && selectedTick > 0) setTick(String(selectedTick));
  }, [run, selectedTick]);
  const verified = checked?.run === run && checked.value.status === "available" ? checked.value : null;
  const selected = verified?.slots.find(item => item.slotId === slot)?.slotId ?? verified?.slots[0]?.slotId ?? "";
  const parsedTick = /^(0|[1-9][0-9]*)$/.test(tick) ? Number(tick) : NaN;
  const request = verified ? decisionInspectionRequest(verified, parsedTick, selected) : null;
  const inspect = (core as InspectionClient | null)?.inspectNextDecision;
  const visibleResult = result?.run === run && result.slot === selected && result.tick === parsedTick ? result.value : null;
  const change = (): void => { serial.current += 1; setPending(false); setMessage(null); setResult(null); };
  const execute = async (): Promise<void> => {
    if (!verified || !request || !inspect || !core || !run) return;
    const current = ++serial.current;
    setPending(true); setMessage(null); setResult(null);
    try {
      const value = await inspect.call(core, request);
      const valid = await verifyDecisionInspection(verified, request, value);
      if (current !== serial.current) return;
      if (!valid) { setMessage("The inspection response did not match the retained owner Run and was not displayed."); return; }
      setResult({ run, slot: request.selector.slot_id, tick: request.selector.tick, value });
    } catch (error) {
      if (current === serial.current) setMessage(error instanceof Error ? `Inspection unavailable: ${error.message}` : "Inspection unavailable.");
    } finally { if (current === serial.current) setPending(false); }
  };
  return <details className="next-decision-inspector"><summary>Inspect Next Behavior decision</summary>
    <section aria-label="Next Behavior decision inspection">
      <p>Re-execute one owner Hero and Tick from the retained Run using its frozen policy and inputs.</p>
      {!verified && <p role="status">{checked?.run === run && checked.value.status === "unavailable" ? checked.value.reason : "Checking owner Run identity…"}</p>}
      {verified && <><p>Run: {verified.run.snapshot.context.match_id} · {verified.testOnly ? "test-only policy" : "frozen policy"} · result <code>{verified.resultDigest}</code></p>
        {!inspect && <p role="status">Decision inspection is unavailable in this Core.</p>}
        <div className="decision-controls"><label>Owner Hero <select value={selected} onChange={event => { change(); setSlot(event.currentTarget.value); }}>
          {verified.slots.map(item => <option key={item.slotId} value={item.slotId}>{item.slotId} · {item.catalogId}</option>)}</select></label>
          <label>Tick <input type="number" min="1" max={verified.maxTick} step="1" value={tick} onChange={event => { change(); setTick(event.currentTarget.value); }} /></label>
          <button type="button" disabled={!request || !inspect || pending} onClick={() => void execute()}>{pending ? "Inspecting…" : "Inspect decision"}</button></div>
        {!request && <p>Choose a whole Tick from 1 to {verified.maxTick} and an owner Hero from this Run.</p>}
      </>}
      {message && <p role="alert">{message}</p>}
      {verified && visibleResult && <DecisionInspectionResult key={`${selected}:${parsedTick}`} inspection={visibleResult} verified={verified} onReplayTick={onReplayTick} />}
    </section>
  </details>;
}
