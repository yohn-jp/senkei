import { useRef, useState } from 'react';
import type { CoreClient, SimulationResponse, SimulationSnapshot } from '../../contracts';
import type { ActorDecisionResponse } from '../../contracts/actor-decisions';
import { sameJsonResponse } from '../../worker/json-response-equality';

interface InspectionRun { readonly snapshot: SimulationSnapshot; readonly response: SimulationResponse; readonly includeDiagnostics: boolean }

/** Explicit bounded inspection of the frozen Run; no result, Draft or asset is replaced. */
export function AutonomousDecisions({ core, run, onReplayTick }: { core: CoreClient | null; run: InspectionRun | null; onReplayTick(tick: number): void }) {
  const [inspection, setInspection] = useState<{run: InspectionRun; response: ActorDecisionResponse} | null>(null);
  const [pending, setPending] = useState<InspectionRun | null>(null);
  const [failure, setFailure] = useState<{run: InspectionRun; message: string} | null>(null);
  const [page, setPage] = useState(0);
  const sequence = useRef(0);
  const inspect = async () => {
    if (!run || !core?.inspectActorDecisions || !run.includeDiagnostics) return;
    const selected = run; const revision = ++sequence.current;
    setPending(selected); setFailure(null); setInspection(null); setPage(0);
    try {
      const response = await core.inspectActorDecisions({snapshot:selected.snapshot,include_diagnostics:true,diagnostics_side:'attacker'});
      if (!sameJsonResponse(response.simulation.outcome, selected.response.outcome)
        || !sameJsonResponse(response.simulation.owner_replays?.attacker, selected.response.owner_replays?.attacker)) throw new Error('The current Core cannot reproduce this original Run exactly. Its saved result remains available.');
      if (sequence.current === revision) setInspection({run:selected,response});
    } catch (cause) { if (sequence.current === revision) setFailure({run:selected,message:cause instanceof Error ? cause.message : String(cause)}); }
    finally { if (sequence.current === revision) setPending(null); }
  };
  if (!run) return null;
  const result = inspection?.run === run ? inspection.response : null;
  const error = failure?.run === run ? failure.message : null;
  const busy = pending === run;
  const count = result ? Math.max(1,Math.ceil(result.trace.length / 40)) : 1;
  const selectedPage = Math.min(page,count - 1);
  return <section aria-label="Autonomous combat decisions"><h4>Autonomous combat decisions</h4>
    <p>Inspect your Minion, Tower and Base basic-attack decisions from this frozen Run. This is a separate bounded local rerun; neutral Monster decisions have no Player-owner channel.</p>
    {run.includeDiagnostics && core?.inspectActorDecisions ? <button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? 'Inspecting autonomous decisions…' : 'Inspect autonomous decisions'}</button> : <p>Owner diagnostics and a compatible Core are required for this inspection.</p>}
    {error && <p role="alert">{error} The original Run remains unchanged; you can retry or continue its Replay.</p>}
    {result && <><p>{result.trace.length} authorized decisions · Match {run.snapshot.context.match_id}</p>
      {result.trace.length === 0 ? <p>No autonomous decisions were disclosed by this owner view.</p> : <>
        <ol start={selectedPage * 40 + 1}>{result.trace.slice(selectedPage * 40, (selectedPage + 1) * 40).map(trace => <li key={`${trace.tick}:${trace.actor}`}>
          Tick {trace.tick} · {trace.kind} {trace.actor} · {trace.action.kind === 'attack' ? `attack ${trace.action.target} (${trace.action.selection})` : `no basic attack: ${trace.action.reason}`} · {trace.candidates.length} evaluated eligible candidates
          {trace.committed_event && <button type="button" onClick={() => onReplayTick(trace.committed_event!.tick)}>View committed attack</button>}
        </li>)}</ol>
        <button type="button" disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>Previous decisions</button><span>Page {selectedPage + 1} / {count}</span><button type="button" disabled={selectedPage + 1 >= count} onClick={() => setPage(selectedPage + 1)}>Next decisions</button>
      </>}
    </>}
  </section>;
}
