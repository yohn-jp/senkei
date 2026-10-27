import { useRef, useState, type ReactElement } from 'react';
import type { WorldStateView } from '../../contracts';
import { equipmentForDraft, type OwnedEquipmentDraft } from '../equipment/draft';
import type { EquipmentDefinitionRef, EquipmentInstance } from '../equipment/repository';
import { equipmentDraftKey, groupEquipment, reviewEquipmentChange } from './equipment-inventory';

interface HeroChoice { instanceId: string; label: string }
interface SlotChoice { slot_id: string; instanceId: string }
interface Review {
  item: EquipmentInstance;
  target: string | null;
  next: OwnedEquipmentDraft;
  sourceKey: string;
}
export interface EquipmentInventoryProps {
  playerId: string;
  items: readonly EquipmentInstance[];
  heroes: readonly HeroChoice[];
  slots: readonly SlotChoice[];
  draft: OwnedEquipmentDraft | null;
  approved: readonly EquipmentDefinitionRef[];
  effects: Readonly<Record<string, readonly { stat: string; add: number }[]>>;
  onApply?: (next: OwnedEquipmentDraft) => void;
  baseline?: WorldStateView | null;
  preview?: (next: OwnedEquipmentDraft) => Promise<WorldStateView>;
}

function values(state: WorldStateView | null | undefined, slotId: string): string {
  const fields = Object.values(state?.entities ?? {}).find(entity => entity.owner === 'attacker' && entity.fields.slot_id?.kind === 'string' && entity.fields.slot_id.value === slotId)?.fields;
  if (!fields) return 'unavailable';
  return ['attack', 'defense', 'hp'].map(stat => {
    const field = fields[stat];
    return `${stat}: ${field?.kind === 'integer' ? field.value : 'unavailable'}`;
  }).join(' · ');
}

export function EquipmentInventory({ playerId, items, heroes, slots, draft, approved, effects, onApply, baseline, preview }: EquipmentInventoryProps): ReactElement {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<WorldStateView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const previewSequence = useRef(0);
  let current: EquipmentInstance[];
  try { current = equipmentForDraft(items, playerId, draft); }
  catch (cause) { return <InvalidEquipmentDraft playerId={playerId} items={items} onApply={onApply} reason={cause instanceof Error ? cause.message : String(cause)} />; }
  const base = { schemaVersion: 1 as const, playerId, assignments: Object.fromEntries(current.map(item => [item.instanceId, item.heroId])) };
  const sourceKey = JSON.stringify([equipmentDraftKey(base), current.map(item => [item.instanceId, item.definition]), heroes.map(hero => hero.instanceId), approved]);
  const isCurrent = review?.sourceKey === sourceKey;
  const groups = groupEquipment(current);
  const visible = groups.filter(group => `${group.definition.id} ${group.definition.version} ${group.instances.map(item => item.instanceId).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const heroName = (id: string | null) => id === null ? 'Unequipped' : heroes.find(hero => hero.instanceId === id)?.label ?? `Unavailable Hero: ${id}`;
  const begin = (item: EquipmentInstance, heroId: string | null) => {
    previewSequence.current++;
    setBusy(false); setResult(null); setError('');
    try {
      const next = reviewEquipmentChange(playerId, items, draft, heroes.map(hero => hero.instanceId), item.instanceId, heroId, approved);
      setReview({ item, target: heroId, next, sourceKey });
    } catch (cause) { setReview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const calculate = async () => {
    if (!review || !isCurrent || !preview) return;
    const sequence = ++previewSequence.current;
    setBusy(true); setResult(null); setError('');
    try { const value = await preview(review.next); if (previewSequence.current === sequence) setResult(value); }
    catch (cause) { if (previewSequence.current === sequence) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (previewSequence.current === sequence) setBusy(false); }
  };
  const cancel = () => { previewSequence.current++; setBusy(false); setReview(null); setResult(null); setError(''); };
  const affected = review ? new Set([review.item.heroId, review.target].filter((id): id is string => id !== null)) : new Set<string>();
  return <section aria-label="Equipment inventory"><h3>Equipment inventory · local trial</h3>
    <p>Instances remain owned during battle. This trial policy has no equipment-slot rules; the displayed effects come from the selected ruleset.</p>
    <label>Search equipment <input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {groups.length === 0 ? <p>No local equipment owned.</p> : visible.length === 0 ? <p>No equipment matches this search.</p> : <ul>{visible.map(group => <li key={JSON.stringify(group.definition)}><details><summary>{group.definition.id} · version {group.definition.version} · {group.instances.length} owned · {group.equippedCount} assigned</summary>
      <p>Definition digest: {group.definition.digest}</p>
      <p>Ruleset effects: {approved.some(definition => definition.id === group.definition.id && definition.version === group.definition.version && definition.digest === group.definition.digest && definition.effectRef === group.definition.effectRef) ? effects[group.definition.id]?.map(effect => `${effect.stat} ${effect.add >= 0 ? '+' : ''}${effect.add}`).join(', ') || 'none' : 'unavailable for this definition'}</p>
      <ul>{group.instances.map(item => <li key={item.instanceId}>
        <p>{item.instanceId} · {heroName(item.heroId)}</p>
        {onApply ? <><label>Target Hero <select value={target[item.instanceId] ?? ''} onChange={event => setTarget({ ...target, [item.instanceId]: event.target.value })}><option value="">Select Hero</option>{heroes.map(hero => <option key={hero.instanceId} value={hero.instanceId}>{hero.label}</option>)}</select></label>
          <button type="button" disabled={!target[item.instanceId]} onClick={() => begin(item, target[item.instanceId])}>Review equipment change</button>
          {item.heroId !== null && <button type="button" onClick={() => begin(item, null)}>Review removal</button>}</> : <p>Draft application is unavailable.</p>}
      </li>)}</ul>
    </details></li>)}</ul>}
    {review && <div role="group" aria-label="Review equipment change"><h4>Review equipment change</h4>
      <p>{review.item.definition.id} · {review.item.instanceId}</p>
      <p>Current: {heroName(review.item.heroId)} → Proposed: {heroName(review.target)}</p>
      <p>Applying updates this Draft and requires a new Preflight. Existing Runs stay fixed.</p>
      {!isCurrent && <p role="alert">The inventory or Draft changed. Cancel and review the current values.</p>}
      {isCurrent && preview && baseline ? <button type="button" disabled={busy} onClick={() => void calculate()}>Compare Enbu initial state</button> : <p>Enbu comparison is unavailable until the current Draft has passed Preflight.</p>}
      {busy && <p role="status">Calculating the proposed initial state…</p>}
      {result && isCurrent && <ul>{slots.filter(slot => affected.has(slot.instanceId)).map(slot => <li key={slot.slot_id}>Slot {slot.slot_id} · {heroName(slot.instanceId)}<br />Current: {values(baseline, slot.slot_id)}<br />Proposed: {values(result, slot.slot_id)}</li>)}</ul>}
      {result && isCurrent && !slots.some(slot => affected.has(slot.instanceId)) && <p>The affected Hero is not selected in this formation; no formation stat changes are shown.</p>}
      <button type="button" disabled={!isCurrent || busy || !onApply} onClick={() => { if (onApply && review && isCurrent) { onApply(review.next); cancel(); } }}>Apply to Draft</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function InvalidEquipmentDraft({ playerId, items, onApply, reason }: {
  playerId: string; items: readonly EquipmentInstance[]; onApply?: (next: OwnedEquipmentDraft) => void; reason: string;
}): ReactElement {
  const [reviewedKey, setReviewedKey] = useState<string | null>(null);
  const inventoryKey = JSON.stringify([playerId, items]);
  const validInventory = items.every(item => item.playerId === playerId && item.authority === 'local') && new Set(items.map(item => item.instanceId)).size === items.length;
  return <section aria-label="Equipment inventory"><h3>Equipment inventory</h3><p role="alert">{reason}</p>
    {onApply && validInventory && <><button type="button" onClick={() => setReviewedKey(inventoryKey)}>Review current inventory choices</button>
      {reviewedKey !== null && <div role="group" aria-label="Review equipment recovery"><p>The proposed Draft starts with all {items.length} current items unassigned. Existing Draft choices are replaced only on Apply; ownership is unchanged.</p>
        {reviewedKey !== inventoryKey && <p role="alert">Inventory changed. Review the current inventory again.</p>}
        <button type="button" disabled={reviewedKey !== inventoryKey} onClick={() => { onApply({ schemaVersion: 1, playerId, assignments: Object.fromEntries(items.map(item => [item.instanceId, null])) }); setReviewedKey(null); }}>Apply current inventory to Draft</button>
        <button type="button" onClick={() => setReviewedKey(null)}>Cancel</button>
      </div>}</>}
  </section>;
}
