import type { TrialPolicy } from "../progression/match-projection";
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RulePackage, WorldStateView } from '../../contracts';
import type { OwnedEquipmentDraft } from '../equipment/draft';
import { EquipmentRepository, type EquipmentDefinitionRef, type EquipmentInstance } from '../equipment/repository';
import { EquipmentInventory } from '../progression/EquipmentInventory';
import { RelationshipGraph } from '../progression/RelationshipGraph';
import { PairFormationPreview, type PairSquadChange } from '../progression/PairFormationPreview';
import { PairEpisodes } from '../relationships/EpisodeReader';
import type { EpisodeProvider } from '../relationships/episodes';
import type { RelationshipArchive } from '../relationships/repository';
import { HeroRepository, heroOwnershipAuthority, type HeroOwnershipSnapshot } from './repository';
import { changeOwnedHeroSelection, selectedOwnedHero } from './draft';
import { OwnedRelationshipRepository } from './relationships';
import { OwnedAssetsRecovery, type OwnedAssetsArchive } from './recovery';

export interface OwnedAssetsState {
  playerId: string;
  heroes: HeroOwnershipSnapshot;
  equipment: EquipmentInstance[];
  relationships: RelationshipArchive;
  slotSelections: Record<string, string>;
}
export interface OwnedAssetsPanelProps {
  ruleset: RulePackage;
  slots: readonly { slot_id: string; catalog_id: string; squad_id?: string; node_id?: string }[];
  heroSelections?: { schemaVersion: 1; playerId: string; slots: Readonly<Record<string, string>> } | null;
  equipmentDraft?: OwnedEquipmentDraft | null;
  onEquipmentDraftChange?(next: OwnedEquipmentDraft): void;
  equipmentBaseline?: WorldStateView | null;
  previewEquipment?(next: OwnedEquipmentDraft): Promise<WorldStateView>;
  onSquadDraftChange?(change: PairSquadChange): void;
  previewSquadChange?(change: PairSquadChange): Promise<WorldStateView>;
  episodeProvider?: EpisodeProvider;
  onSelectOwnedHero(slotId: string, instanceId: string, definitionId: string): void;
  onAssetsChanged(state: OwnedAssetsState | null): void;
}
type Version = { major: number; minor: number; patch: number };

const versionString = (v: Version) => `${v.major}.${v.minor}.${v.patch}`;
function trialPolicy(ruleset: RulePackage): TrialPolicy | null { const p = (ruleset.next as unknown as { projection_policy?: TrialPolicy } | undefined)?.projection_policy; return p?.schema_version === 1 && p.test_only === true && p.hero_catalog_id && p.hero_catalog_digest && p.hero_catalog_version && p.equipment ? p : null; }
async function equipmentDefinitions(policy: TrialPolicy): Promise<EquipmentDefinitionRef[]> { return Promise.all(Object.entries(policy.equipment).map(async ([id, d]) => { const bytes = new TextEncoder().encode(JSON.stringify({version: {major: d.version.major, minor: d.version.minor, patch: d.version.patch}, effects: d.effects.map(e => { const effect = e as {stat: unknown; add: unknown}; return {stat: effect.stat, add: effect.add}; })})); const hash = await crypto.subtle.digest('SHA-256', bytes); const digest = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(''); return { id, version: versionString(d.version), digest, effectRef: id }; })); }
export async function approvedEquipmentDefinitions(ruleset: RulePackage): Promise<EquipmentDefinitionRef[]> { const policy = trialPolicy(ruleset); return policy ? equipmentDefinitions(policy) : []; }
function downloadArchive(archive: OwnedAssetsArchive, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
  try { const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); }
  finally { URL.revokeObjectURL(url); }
}
const PLAYER_KEY = 'senkei.local-player.v1';
const selectionKey = (player: string) => `senkei.owned-selection.v1:${player}`;
function playerId(): string {
  const current = localStorage.getItem(PLAYER_KEY); if (current) return current;
  const id = crypto.randomUUID(); localStorage.setItem(PLAYER_KEY, id); return localStorage.getItem(PLAYER_KEY) ?? id;
}
function readSelections(player: string): Record<string, string> {
  try { const value: unknown = JSON.parse(localStorage.getItem(selectionKey(player)) ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter(([,v]) => typeof v === 'string')) as Record<string,string>; } catch { return {}; }
}
/** Reads current persistent data for preflight; callers must validate the selected IDs against these records. */
export async function readOwnedAssets(player: string, approved: readonly EquipmentDefinitionRef[] = []): Promise<OwnedAssetsState> {
  await new OwnedAssetsRecovery(player, approved).resume();
  const heroes = await new HeroRepository().snapshot(player); const authority = heroOwnershipAuthority(heroes);
  const equipment = await new EquipmentRepository(indexedDB, 'senkei-equipment', [], authority).list(player);
  const result = await new OwnedRelationshipRepository(player, authority.ownsHero).read();
  if (!result.ok) throw new Error(result.reason);
  return { playerId: player, heroes, equipment, relationships: result.value, slotSelections: readSelections(player) };
}
export function OwnedAssetsPanel({ ruleset, slots, heroSelections, equipmentDraft, onEquipmentDraftChange, equipmentBaseline, previewEquipment, onSquadDraftChange, previewSquadChange, episodeProvider, onSelectOwnedHero, onAssetsChanged }: OwnedAssetsPanelProps): ReactElement {
  const [state, setState] = useState<OwnedAssetsState | null>(null); const [error, setError] = useState(''); const [selected, setSelected] = useState(''); const [pair, setPair] = useState(''); const [level, setLevel] = useState('0'); const policy = trialPolicy(ruleset); const [restoreProfile, setRestoreProfile] = useState<OwnedAssetsArchive | null>(null); const [pendingRecovery, setPendingRecovery] = useState<OwnedAssetsArchive | null>(null); const [notice, setNotice] = useState(''); const refreshSequence = useRef(0);
  const refresh = useCallback(async (player: string) => { const sequence = ++refreshSequence.current; const next = await readOwnedAssets(player, policy ? await equipmentDefinitions(policy) : []); if (sequence === refreshSequence.current) { setState(next); setPendingRecovery(null); onAssetsChanged(next); } }, [onAssetsChanged, policy]);
  useEffect(() => { let active = true; onAssetsChanged(null); (async () => {
    const id = playerId();
    try { const next = await readOwnedAssets(id, policy ? await equipmentDefinitions(policy) : []); if (active) { setState(next); setPendingRecovery(null); onAssetsChanged(next); } }
    catch (e) { if (active) {
      setError(String(e));
      try { setPendingRecovery(await new OwnedAssetsRecovery(id, policy ? await equipmentDefinitions(policy) : []).pendingArchive()); }
      catch (recoveryError) { setError(String(recoveryError)); }
    } }
  })(); return () => { active = false; }; }, [ruleset.ruleset.id, ruleset.ruleset.digest]);
  const obtain = async () => { try {
    const id = playerId(); const ref = ruleset.ruleset; const version = policy ? versionString(policy.hero_catalog_version) : versionString(ref.version); const catalogId = policy?.hero_catalog_id ?? ref.id; const digest = policy?.hero_catalog_digest ?? ref.digest;
    if (!ruleset.next?.heroes.length) throw new Error('No Next Hero catalog is available');
    await new HeroRepository().obtainTrialRoster({ requestId: `trial:${id}:${catalogId}:${version}:${digest}`, playerId: id, catalog: { id: catalogId, version, digest, heroes: ruleset.next.heroes } }); await refresh(id); setError('');
  } catch (e) { setError(String(e)); } };
  const choose = async (slotId: string, id: string) => { if (!state) return; const hero = state.heroes.heroes.find(h => h.instanceId === id); if (id && !hero) return;
    try { if (heroSelections === undefined) { const selections = changeOwnedHeroSelection(readSelections(state.playerId), slotId, id); localStorage.setItem(selectionKey(state.playerId), JSON.stringify(selections)); }
      onSelectOwnedHero(slotId, id, hero?.definition.id ?? ''); if (heroSelections === undefined) await refresh(state.playerId); } catch (e) { setError(String(e)); }
  };
  const grant = async (definition: EquipmentDefinitionRef) => { if (!state || !policy) return; try { const repo = new EquipmentRepository(indexedDB, 'senkei-equipment', await equipmentDefinitions(policy), heroOwnershipAuthority(state.heroes)); const instanceId = crypto.randomUUID(); await repo.grant({requestId: crypto.randomUUID(), playerId: state.playerId, instanceId, definition}); await refresh(state.playerId); } catch (e) { setError(String(e)); } };
  const edit = async () => { const levelPolicy = policy?.relation ?? policy?.maturity; if (!state || !policy || !levelPolicy || !selected || !pair) return; const value = Number(level); if (!Number.isInteger(value) || value < 0 || value > levelPolicy.max_level) { setError('Invalid trial level'); return; } try { const repo = new OwnedRelationshipRepository(state.playerId, heroOwnershipAuthority(state.heroes).ownsHero); const result = await repo.applyEvent({eventId: crypto.randomUUID(), source: 'authoritative', from: selected, to: pair, definitionVersion: versionString(levelPolicy.version), value, tags: [], history: 'Explicit local trial edit'}); if (!result.ok) throw new Error(result.reason); await refresh(state.playerId); } catch (e) { setError(String(e)); } };
  const exportArchive = async () => { if (!state) return; try { const archive = await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).export(); downloadArchive(archive, 'senkei-owned-assets.json'); } catch (e) { setError(String(e)); const pending = await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).pendingArchive(); setPendingRecovery(pending); } };
  const abandonRecovery = async () => { if (!pendingRecovery) return; try {
    const id = pendingRecovery.playerId; await new OwnedAssetsRecovery(id, policy ? await equipmentDefinitions(policy) : []).abandonPending();
    setPendingRecovery(null); setNotice('Automatic restore retry abandoned. Previously applied assets remain; use the saved archive for a deliberate retry.');
    if (id === playerId()) await refresh(id);
  } catch (e) { setError(String(e)); } };
  const importArchive = async (file: File) => { if (!state) return; try { const archive = JSON.parse(await file.text()) as OwnedAssetsArchive; if (!archive || archive.schemaVersion !== 1 || typeof archive.playerId !== 'string' || !archive.playerId.trim()) throw new Error('Invalid archive'); if (archive.playerId !== state.playerId) { setRestoreProfile(archive); return; } await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).begin(archive); await refresh(state.playerId); setError(''); setNotice('Owned assets recovered. Formation selections are a separate local draft.'); } catch (e) { setError(String(e)); setPendingRecovery(await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).pendingArchive()); } };
  const confirmProfileRestore = async () => { if (!restoreProfile) return; try { const id = restoreProfile.playerId; await new OwnedAssetsRecovery(id, policy ? await equipmentDefinitions(policy) : []).begin(restoreProfile); onAssetsChanged(null); localStorage.setItem(PLAYER_KEY, id); setSelected(''); setPair(''); await refresh(id); setRestoreProfile(null); setError(''); setNotice('Archived local profile restored. Select owned Heroes for your formation; formation selections are a separate local draft.'); } catch (e) { setError(String(e)); } };
  const hero = state?.heroes.heroes.find(h => h.instanceId === selected);
  const selections = state && heroSelections?.playerId === state.playerId ? heroSelections.slots : state?.slotSelections ?? {};
  return <section aria-label="Owned Heroes and local assets"><h2>Owned Heroes · local trial</h2>
    <p>Local trial ownership is stored on this device.</p><button type="button" onClick={() => void obtain()}>Obtain trial roster</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {pendingRecovery && <section aria-label="Pending asset recovery" role="region"><p role="alert">Asset recovery could not complete. Some Heroes or equipment may already have been applied. The original pending archive remains saved. Export it before abandoning the automatic retry.</p>
      <button type="button" onClick={() => downloadArchive(pendingRecovery, 'senkei-pending-owned-assets.json')}>Export pending original archive</button>
      <button type="button" onClick={() => void abandonRecovery()}>Abandon automatic recovery (keep partial assets)</button>
    </section>}{restoreProfile && <div role="group" aria-label="Restore archived local profile"><p>Archive belongs to local player <code>{restoreProfile.playerId}</code>. Restore that profile on this device? The current profile remains stored. This does not transfer ownership.</p><button type="button" onClick={() => void confirmProfileRestore()}>Restore archived local profile</button><button type="button" onClick={() => setRestoreProfile(null)}>Cancel profile restore</button></div>}
    {state && <><button type="button" onClick={() => void exportArchive()}>Export owned assets</button><label>Recover owned assets <input type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file) void importArchive(file); e.target.value = ''; }} /></label><p>Player: <code>{state.playerId}</code></p>
      {heroSelections && heroSelections.playerId !== state.playerId && <p role="alert">The Hero selections belong to another local Player. Select owned Heroes for this Draft.</p>}
      {slots.map(slot => <label key={slot.slot_id}>Slot {slot.slot_id} <select value={selectedOwnedHero(selections, slot.slot_id)} onChange={e => void choose(slot.slot_id, e.target.value)}><option value="">Select owned Hero</option>{state.heroes.heroes.map(h => <option key={h.instanceId} value={h.instanceId}>{ruleset.next?.heroes.find(d => d.id === h.definition.id)?.name ?? h.definition.id} · {h.instanceId}</option>)}</select></label>)}
      {policy && <TrialEquipment policy={policy} grant={grant} />}
      {policy && <LocalEquipment policy={policy} state={state} slots={slots.map(slot => ({slot_id: slot.slot_id, instanceId: selectedOwnedHero(selections, slot.slot_id)}))} draft={equipmentDraft ?? null} onApply={onEquipmentDraftChange} baseline={equipmentBaseline} preview={previewEquipment} />}
      <h3>Hero relationships</h3><RelationshipGraph heroes={state.heroes.heroes.map(h => ({ instanceId: h.instanceId, label: `${h.definition.id} · ${h.instanceId}` }))} events={state.relationships.events} formationIds={Object.values(selections)} selectedPair={selected && pair ? { from: selected, to: pair } : null} onSelectPair={(from, to) => { setSelected(from); setPair(to); }} />
      <label>Hero <select value={selected} onChange={e => { setSelected(e.target.value); setPair(''); }}><option value="">Select Hero</option>{state.heroes.heroes.map(h => <option key={h.instanceId} value={h.instanceId}>{h.definition.id} · {h.instanceId}</option>)}</select></label>
      {hero && <><p>{hero.definition.id} · {hero.instanceId}</p><h4>Other owned Heroes</h4><ul>{state.heroes.heroes.filter(other => other.instanceId !== hero.instanceId).map(other => <li key={other.instanceId}><button type="button" onClick={() => setPair(other.instanceId)} aria-pressed={pair === other.instanceId}>Inspect {other.definition.id} · {other.instanceId}</button></li>)}</ul>
        {pair && state.heroes.heroes.some(other => other.instanceId === pair) && <><RelationshipPair state={state} from={hero.instanceId} to={pair} slots={slots} selections={selections} /><PairEpisodes playerId={state.playerId} pair={{ from: hero.instanceId, to: pair }} provider={episodeProvider} /><PairFormationPreview slots={slots} selections={selections} from={hero.instanceId} to={pair} baseline={equipmentBaseline} preview={previewSquadChange} onApply={onSquadDraftChange} /></>}
        {(policy?.relation || policy?.maturity) && <fieldset><legend>Test-only relationship edit</legend><label>Target <select value={pair} onChange={e => setPair(e.target.value)}><option value="">Select target</option>{state.heroes.heroes.filter(h => h.instanceId !== hero.instanceId).map(h => <option key={h.instanceId} value={h.instanceId}>{h.definition.id} · {h.instanceId}</option>)}</select></label><label>Level <input type="number" min={0} max={(policy.relation ?? policy.maturity)!.max_level} value={level} onChange={e => setLevel(e.target.value)} /></label><button type="button" onClick={() => void edit()}>Record trial edit</button></fieldset>}</>}
    </>}
  </section>;
}

function TrialEquipment({policy, grant}: {policy: TrialPolicy; grant(definition: EquipmentDefinitionRef): Promise<void>}): ReactElement { const [definitions, setDefinitions] = useState<EquipmentDefinitionRef[]>([]); useEffect(() => { void equipmentDefinitions(policy).then(setDefinitions); }, [policy]); return <section><h3>Test-only equipment</h3>{definitions.map(d => <button type="button" key={d.id} onClick={() => void grant(d)}>Obtain {d.id}</button>)}</section>; }

function LocalEquipment({ policy, state, slots, draft, onApply, baseline, preview }: {
  policy: TrialPolicy;
  state: OwnedAssetsState;
  slots: readonly { slot_id: string; instanceId: string }[];
  draft: OwnedEquipmentDraft | null;
  onApply?: (next: OwnedEquipmentDraft) => void;
  baseline?: WorldStateView | null;
  preview?: (next: OwnedEquipmentDraft) => Promise<WorldStateView>;
}): ReactElement {
  const [definitions, setDefinitions] = useState<EquipmentDefinitionRef[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDefinitions([]); setError('');
    void equipmentDefinitions(policy).then(value => { if (active) setDefinitions(value); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [policy]);
  return <>{error && <p role="alert">Equipment definitions could not be read: {error}</p>}
    <EquipmentInventory playerId={state.playerId} items={state.equipment} heroes={state.heroes.heroes.map(hero => ({ instanceId: hero.instanceId, label: `${hero.definition.id} · ${hero.instanceId}` }))}
      slots={slots} draft={draft} approved={definitions} effects={Object.fromEntries(Object.entries(policy.equipment).map(([id, definition]) => [id, definition.effects]))} onApply={onApply} baseline={baseline} preview={preview} />
  </>;
}

function RelationshipPair({ state, from, to, slots, selections }: {
  state: OwnedAssetsState;
  from: string;
  to: string;
  slots: readonly { slot_id: string; squad_id?: string }[];
  selections: Readonly<Record<string, string>>;
}): ReactElement {
  const name = (id: string) => {
    const hero = state.heroes.heroes.find(candidate => candidate.instanceId === id);
    return hero ? `${hero.definition.id} · ${hero.instanceId}` : id;
  };
  const latest = (a: string, b: string) => [...state.relationships.events].reverse().find(event => event.from === a && event.to === b);
  const first = latest(from, to); const second = latest(to, from);
  const fromSlot = slots.find(slot => selectedOwnedHero(selections, slot.slot_id) === from);
  const toSlot = slots.find(slot => selectedOwnedHero(selections, slot.slot_id) === to);
  const situation = !fromSlot || !toSlot ? 'At least one Hero is outside the selected formation.'
    : !fromSlot.squad_id || !toSlot.squad_id ? 'Planned Squad membership is unavailable.'
    : fromSlot.squad_id === toSlot.squad_id ? `Both are planned in Squad ${fromSlot.squad_id}.`
    : 'The Heroes are planned in separate Squads.';
  return <section aria-label="Relationship pair"><h4>Relationship pair</h4>
    <p>{situation}</p>
    {[{ a: from, b: to, event: first }, { a: to, b: from, event: second }].map(({ a, b, event }) => <div key={a}>
      <p>{name(a)} → {name(b)}: {event?.value ?? 'undefined'}</p>
      {event && <p>Definition: {event.definitionVersion} · Tags: {event.tags.length ? event.tags.join(', ') : 'none'} · History: {event.history}</p>}
    </div>)}
    <p>Persistent directed values are distinct from the symmetric combat effect and in-match Squad maturity. The trial rules require both directions and living Heroes together; Enbu determines the actual effect. Missing values are undefined.</p>
    <p>Unique cooperation is not configured. Viewing this pair does not change the formation or grant progress.</p>
  </section>;
}
