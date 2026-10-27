import { useRef, useState } from 'react';
import type { WorldStateView } from '../../contracts';

export interface PairSquadChange { readonly slotId: string; readonly squadId: string; readonly nodeId: string }
interface PairSlot { readonly slot_id: string; readonly squad_id?: string; readonly node_id?: string }
interface Proposal { readonly change: PairSquadChange; readonly source: string }

function stat(state: WorldStateView | null | undefined, slotId: string, key: string): string {
  const field = Object.values(state?.entities ?? {}).find(entity => entity.owner === 'attacker' && entity.fields.slot_id?.kind === 'string' && entity.fields.slot_id.value === slotId)?.fields[key];
  return field?.kind === 'integer' ? String(field.value) : 'unavailable';
}

/** Review is read-only; the parent validates and explicitly applies the Draft change. */
export function PairFormationPreview({ slots, selections, from, to, baseline, preview, onApply }: {
  slots: readonly PairSlot[]; selections: Readonly<Record<string, string>>; from: string; to: string;
  baseline?: WorldStateView | null; preview?: (change: PairSquadChange) => Promise<WorldStateView>; onApply?: (change: PairSquadChange) => void;
}) {
  const [chosen, setChosen] = useState(''); const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<WorldStateView | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const source = JSON.stringify([slots, selections, from, to]);
  const first = slots.find(slot => selections[slot.slot_id] === from); const second = slots.find(slot => selections[slot.slot_id] === to);
  const choices = [...new Set([...slots.flatMap(slot => slot.squad_id ? [slot.squad_id] : []), ...Array.from({ length: 5 }, (_, index) => `squad-${index + 1}`)])].sort();
  const current = proposal?.source === source;
  const cancel = () => { sequence.current++; setBusy(false); setProposal(null); setResult(null); setError(''); };
  const review = () => {
    sequence.current++; setBusy(false); setResult(null); setError('');
    if (!first || !second || !chosen || !second.node_id || chosen === second.squad_id) { setError('Select a different Squad for the second Hero.'); return; }
    const members = slots.filter(slot => slot.slot_id !== second.slot_id && slot.squad_id === chosen);
    const nodes = new Set(members.map(slot => slot.node_id));
    if (members.length && (nodes.size !== 1 || !members[0].node_id)) { setError('Resolve the target Squad’s shared starting node before reviewing this change.'); return; }
    setProposal({ change: { slotId: second.slot_id, squadId: chosen, nodeId: members[0]?.node_id ?? second.node_id }, source });
  };
  const calculate = async () => {
    if (!proposal || !current || !preview) return;
    const token = ++sequence.current; setBusy(true); setResult(null); setError('');
    try { const value = await preview(proposal.change); if (sequence.current === token) setResult(value); }
    catch (cause) { if (sequence.current === token) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (sequence.current === token) setBusy(false); }
  };
  if (!first || !second) return <p>Select both owned Heroes in the formation to review their Squad arrangement.</p>;
  if (!onApply || !first.squad_id || !second.squad_id || !second.node_id) return <p>Squad Draft review is unavailable for this formation.</p>;
  const targetCount = proposal ? slots.filter(slot => slot.slot_id !== second.slot_id && slot.squad_id === proposal.change.squadId).length + 1 : 0;
  return <section aria-label="Review relationship formation"><h5>Review this pair in a formation</h5>
    <p>Move the second Hero to an existing Squad or an unused Squad. Joining uses that Squad's shared starting node; a new Squad keeps the Hero's current node.</p>
    <label>Second Hero's proposed Squad <select value={chosen} onChange={event => { setChosen(event.target.value); cancel(); }}><option value="">Select Squad</option>{choices.map(squad => <option key={squad} value={squad}>{squad}</option>)}</select></label>
    <button type="button" disabled={!chosen || chosen === second.squad_id} onClick={review}>Review Squad change</button>
    {proposal && <div role="group" aria-label="Review Squad change"><p>Slot {second.slot_id}: {second.squad_id} → {proposal.change.squadId} · start node {proposal.change.nodeId}.</p>
      <p>{proposal.change.squadId === first.squad_id ? 'The pair would start in the same Squad.' : 'The pair would start in separate Squads.'} {targetCount === 1 ? 'The moved Hero would start Solo.' : `${targetCount} Heroes would start in the target Squad.`}</p>
      <p>These are initial conditions. Enbu resolves in-match cooperation and maturity as members join, split, die or revive.</p>
      {!current && <p role="alert">Formation changed. Cancel and review the current formation.</p>}
      {current && preview && baseline ? <button type="button" disabled={busy} onClick={() => void calculate()}>Compare Enbu Squad state</button> : <p>Enbu comparison is unavailable until the current Draft has passed Preflight.</p>}
      {busy && <p role="status">Calculating the proposed initial state…</p>}
      {result && current && <ul>{[first, second].map(slot => <li key={slot.slot_id}>Slot {slot.slot_id} · Current attack {stat(baseline, slot.slot_id, 'attack')}, defense {stat(baseline, slot.slot_id, 'defense')} · Proposed attack {stat(result, slot.slot_id, 'attack')}, defense {stat(result, slot.slot_id, 'defense')}</li>)}</ul>}
      <button type="button" disabled={!current || busy} onClick={() => { if (current) { onApply(proposal.change); cancel(); } }}>Apply Squad change to Draft</button><button type="button" onClick={cancel}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
