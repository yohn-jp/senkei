import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { RulePackage } from '../../contracts';
import { EquipmentRepository, type EquipmentDefinitionRef, type EquipmentInstance } from '../equipment/repository';
import type { RelationshipArchive } from '../relationships/repository';
import { HeroRepository, heroOwnershipAuthority, type HeroOwnershipSnapshot } from './repository';
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
  slots: readonly { slot_id: string; catalog_id: string }[];
  onSelectOwnedHero(slotId: string, instanceId: string, definitionId: string): void;
  onAssetsChanged(state: OwnedAssetsState | null): void;
}
type Version = { major: number; minor: number; patch: number };
type TrialPolicy = { schema_version: 1; test_only: true; hero_catalog_id: string; hero_catalog_version: Version; hero_catalog_digest: string; equipment: Record<string, {version: Version; effects: unknown[]}>; relation: {version: Version; max_level: number} };
const versionString = (v: Version) => `${v.major}.${v.minor}.${v.patch}`;
function trialPolicy(ruleset: RulePackage): TrialPolicy | null { const p = (ruleset.next as unknown as { projection_policy?: TrialPolicy } | undefined)?.projection_policy; return p?.schema_version === 1 && p.test_only === true && p.hero_catalog_id && p.hero_catalog_digest && p.hero_catalog_version && p.equipment && p.relation ? p : null; }
async function equipmentDefinitions(policy: TrialPolicy): Promise<EquipmentDefinitionRef[]> { return Promise.all(Object.entries(policy.equipment).map(async ([id, d]) => { const bytes = new TextEncoder().encode(JSON.stringify({version: {major: d.version.major, minor: d.version.minor, patch: d.version.patch}, effects: d.effects.map(e => { const effect = e as {stat: unknown; add: unknown}; return {stat: effect.stat, add: effect.add}; })})); const hash = await crypto.subtle.digest('SHA-256', bytes); const digest = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(''); return { id, version: versionString(d.version), digest, effectRef: id }; })); }
export async function approvedEquipmentDefinitions(ruleset: RulePackage): Promise<EquipmentDefinitionRef[]> { const policy = trialPolicy(ruleset); return policy ? equipmentDefinitions(policy) : []; }
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
export function OwnedAssetsPanel({ ruleset, slots, onSelectOwnedHero, onAssetsChanged }: OwnedAssetsPanelProps): ReactElement {
  const [state, setState] = useState<OwnedAssetsState | null>(null); const [error, setError] = useState(''); const [selected, setSelected] = useState(''); const [pair, setPair] = useState(''); const [level, setLevel] = useState('0'); const policy = trialPolicy(ruleset); const [restoreProfile, setRestoreProfile] = useState<OwnedAssetsArchive | null>(null); const [notice, setNotice] = useState(''); const refreshSequence = useRef(0);
  const refresh = useCallback(async (player: string) => { const sequence = ++refreshSequence.current; const next = await readOwnedAssets(player, policy ? await equipmentDefinitions(policy) : []); if (sequence === refreshSequence.current) { setState(next); onAssetsChanged(next); } }, [onAssetsChanged, policy]);
  useEffect(() => { let active = true; onAssetsChanged(null); (async () => {
    try { const id = playerId(); const next = await readOwnedAssets(id, policy ? await equipmentDefinitions(policy) : []); if (active) { setState(next); onAssetsChanged(next); } }
    catch (e) { if (active) setError(String(e)); }
  })(); return () => { active = false; }; }, [ruleset.ruleset.id, ruleset.ruleset.digest]);
  const obtain = async () => { try {
    const id = playerId(); const ref = ruleset.ruleset; const version = policy ? versionString(policy.hero_catalog_version) : versionString(ref.version); const catalogId = policy?.hero_catalog_id ?? ref.id; const digest = policy?.hero_catalog_digest ?? ref.digest;
    if (!ruleset.next?.heroes.length) throw new Error('No Next Hero catalog is available');
    await new HeroRepository().obtainTrialRoster({ requestId: `trial:${id}:${catalogId}:${version}:${digest}`, playerId: id, catalog: { id: catalogId, version, digest, heroes: ruleset.next.heroes } }); await refresh(id); setError('');
  } catch (e) { setError(String(e)); } };
  const choose = async (slotId: string, id: string) => { if (!state) return; const hero = state.heroes.heroes.find(h => h.instanceId === id); if (!hero) return;
    try { const selections = { ...readSelections(state.playerId), [slotId]: id }; localStorage.setItem(selectionKey(state.playerId), JSON.stringify(selections)); onSelectOwnedHero(slotId, id, hero.definition.id); await refresh(state.playerId); } catch (e) { setError(String(e)); }
  };
  const grant = async (definition: EquipmentDefinitionRef) => { if (!state || !policy) return; try { const repo = new EquipmentRepository(indexedDB, 'senkei-equipment', await equipmentDefinitions(policy), heroOwnershipAuthority(state.heroes)); const instanceId = crypto.randomUUID(); await repo.grant({requestId: crypto.randomUUID(), playerId: state.playerId, instanceId, definition}); await refresh(state.playerId); } catch (e) { setError(String(e)); } };
  const equip = async (item: EquipmentInstance, heroId: string | null) => { if (!state || !policy) return; try { const repo = new EquipmentRepository(indexedDB, 'senkei-equipment', await equipmentDefinitions(policy), heroOwnershipAuthority(state.heroes)); if (heroId) await repo.equip({requestId: crypto.randomUUID(), playerId: state.playerId, instanceId: item.instanceId, heroId}); else await repo.unequip({requestId: crypto.randomUUID(), playerId: state.playerId, instanceId: item.instanceId}); await refresh(state.playerId); } catch (e) { setError(String(e)); } };
  const edit = async () => { if (!state || !policy || !selected || !pair) return; const value = Number(level); if (!Number.isInteger(value) || value < 0 || value > policy.relation.max_level) { setError('Invalid trial level'); return; } try { const repo = new OwnedRelationshipRepository(state.playerId, heroOwnershipAuthority(state.heroes).ownsHero); const result = await repo.applyEvent({eventId: crypto.randomUUID(), source: 'authoritative', from: selected, to: pair, definitionVersion: versionString(policy.relation.version), value, tags: [], history: 'Explicit local trial edit'}); if (!result.ok) throw new Error(result.reason); await refresh(state.playerId); } catch (e) { setError(String(e)); } };
  const exportArchive = async () => { if (!state) return; try { const archive = await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).export(); const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], {type: 'application/json'})); const link = document.createElement('a'); link.href = url; link.download = 'senkei-owned-assets.json'; link.click(); URL.revokeObjectURL(url); } catch (e) { setError(String(e)); } };
  const importArchive = async (file: File) => { if (!state) return; try { const archive = JSON.parse(await file.text()) as OwnedAssetsArchive; if (!archive || archive.schemaVersion !== 1 || typeof archive.playerId !== 'string' || !archive.playerId.trim()) throw new Error('Invalid archive'); if (archive.playerId !== state.playerId) { setRestoreProfile(archive); return; } await new OwnedAssetsRecovery(state.playerId, policy ? await equipmentDefinitions(policy) : []).begin(archive); await refresh(state.playerId); setError(''); setNotice('Owned assets recovered. Formation selections are a separate local draft.'); } catch (e) { setError(String(e)); } };
  const confirmProfileRestore = async () => { if (!restoreProfile) return; try { const id = restoreProfile.playerId; await new OwnedAssetsRecovery(id, policy ? await equipmentDefinitions(policy) : []).begin(restoreProfile); onAssetsChanged(null); localStorage.setItem(PLAYER_KEY, id); setSelected(''); setPair(''); await refresh(id); setRestoreProfile(null); setError(''); setNotice('Archived local profile restored. Select owned Heroes for your formation; formation selections are a separate local draft.'); } catch (e) { setError(String(e)); } };
  const hero = state?.heroes.heroes.find(h => h.instanceId === selected);
  return <section aria-label="Owned Heroes and local assets"><h2>Owned Heroes · local trial</h2>
    <p>Local trial ownership is stored on this device.</p><button type="button" onClick={() => void obtain()}>Obtain trial roster</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{restoreProfile && <div role="group" aria-label="Restore archived local profile"><p>Archive belongs to local player <code>{restoreProfile.playerId}</code>. Restore that profile on this device? The current profile remains stored. This does not transfer ownership.</p><button type="button" onClick={() => void confirmProfileRestore()}>Restore archived local profile</button><button type="button" onClick={() => setRestoreProfile(null)}>Cancel profile restore</button></div>}
    {state && <><button type="button" onClick={() => void exportArchive()}>Export owned assets</button><label>Recover owned assets <input type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file) void importArchive(file); e.target.value = ''; }} /></label><p>Player: <code>{state.playerId}</code></p>
      {slots.map(slot => <label key={slot.slot_id}>Slot {slot.slot_id} <select value={state.slotSelections[slot.slot_id] ?? ''} onChange={e => void choose(slot.slot_id, e.target.value)}><option value="">Select owned Hero</option>{state.heroes.heroes.map(h => <option key={h.instanceId} value={h.instanceId}>{ruleset.next?.heroes.find(d => d.id === h.definition.id)?.name ?? h.definition.id} · {h.instanceId}</option>)}</select></label>)}
      {policy && <TrialEquipment policy={policy} grant={grant} />}
      <h3>Hero detail</h3><label>Hero <select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select Hero</option>{state.heroes.heroes.map(h => <option key={h.instanceId} value={h.instanceId}>{h.definition.id} · {h.instanceId}</option>)}</select></label>
      {hero && <><p>{hero.definition.id} · {hero.instanceId}</p><h4>Equipment</h4><ul>{state.equipment.map(i => <li key={i.instanceId}>{i.definition.id} · {i.instanceId} · {i.heroId ?? 'unequipped'} {policy && <button type="button" onClick={() => void equip(i, i.heroId === hero.instanceId ? null : hero.instanceId)}>{i.heroId === hero.instanceId ? 'Unequip' : 'Equip to selected Hero'}</button>}</li>)}</ul><h4>Directed relationships</h4><ul>{state.heroes.heroes.filter(other => other.instanceId !== hero.instanceId).map(other => { const event = [...state.relationships.events].reverse().find(e => e.from === hero.instanceId && e.to === other.instanceId); return <li key={other.instanceId}>{hero.definition.id} → {other.definition.id}: {event?.value ?? 'undefined'}{event && ` · ${event.history}`}</li>; })}</ul>{policy && <fieldset><legend>Test-only relationship edit</legend><label>Target <select value={pair} onChange={e => setPair(e.target.value)}><option value="">Select target</option>{state.heroes.heroes.filter(h => h.instanceId !== hero.instanceId).map(h => <option key={h.instanceId} value={h.instanceId}>{h.definition.id} · {h.instanceId}</option>)}</select></label><label>Level <input type="number" min={0} max={policy.relation.max_level} value={level} onChange={e => setLevel(e.target.value)} /></label><button type="button" onClick={() => void edit()}>Record trial edit</button></fieldset>}</>}
    </>}
  </section>;
}

function TrialEquipment({policy, grant}: {policy: TrialPolicy; grant(definition: EquipmentDefinitionRef): Promise<void>}): ReactElement { const [definitions, setDefinitions] = useState<EquipmentDefinitionRef[]>([]); useEffect(() => { void equipmentDefinitions(policy).then(setDefinitions); }, [policy]); return <section><h3>Test-only equipment</h3>{definitions.map(d => <button type="button" key={d.id} onClick={() => void grant(d)}>Obtain {d.id}</button>)}</section>; }
