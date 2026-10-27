import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildMatchProjection, type TrialProjectionInput, type TrialPolicy, type TrialSideInput } from './match-projection';

vi.stubGlobal('crypto', webcrypto);
afterEach(() => vi.restoreAllMocks());
const version = { major: 1, minor: 0, patch: 0 };
const catalogDigest = 'a'.repeat(64);
const ruleDigest = 'b'.repeat(64);
const definition = { version, effects: [{ stat: 'attack', add: 2 }] };
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
async function fixture(): Promise<TrialProjectionInput> {
  const policy: TrialPolicy = { schema_version: 1, test_only: true, hero_catalog_id: 'senkei.next.heroes', hero_catalog_version: version, hero_catalog_digest: catalogDigest,
    equipment: { 'test.blade': definition }, relation: { version, stat: 'defense', add_per_level: 1, max_level: 10, max_bonus: 5, rounding: 'floor' } };
  const equipmentDigest = await digest(definition);
  const side = (playerId: string): TrialSideInput => {
    const heroes = Array.from({ length: 5 }, (_, i) => ({ instanceId: `${playerId}-${i}`, playerId, authority: 'local', definition: { id: `hero-${i}`, version: '1.0.0', digest: catalogDigest, catalogId: policy.hero_catalog_id } }));
    return { playerId, heroSnapshot: { playerId, heroes }, equipment: [{ instanceId: `${playerId}-blade`, playerId, authority: 'local', heroId: heroes[0].instanceId, definition: { id: 'test.blade', version: '1.0.0', digest: equipmentDigest, effectRef: 'test.blade' } }], relations: [], slots: heroes.map((hero, i) => ({ slotId: `slot-${i}`, heroInstanceId: hero.instanceId })) };
  };
  return { policy, rulesetDigest: ruleDigest, approvedRulesetDigest: ruleDigest, attacker: side('attacker'), defender: side('defender') };
}

describe('buildMatchProjection', () => {
  it('clones inputs before asynchronous hashing and freezes both sides', async () => {
    const input = await fixture();
    const original = crypto.subtle.digest.bind(crypto.subtle);
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = buildMatchProjection(input);
    (input.attacker.equipment[0].definition as { digest: string }).digest = 'changed';
    (input.defender.slots[0] as { heroInstanceId: string }).heroInstanceId = 'changed';
    resume();
    const frozen = await pending;
    expect(frozen.sides.attacker.heroes[0].equipment[0].definition_digest).not.toBe('changed');
    expect(frozen.sides.defender.heroes[0].instance_id).toBe('defender-0');
    expect(Object.isFrozen(frozen.sides.attacker.heroes[0].equipment)).toBe(true);
    expect(Object.isFrozen(frozen.sides.defender.heroes[0])).toBe(true);
  });
  it('preserves an undefined reciprocal direction and stabilizes slot ordering', async () => {
    const input = await fixture();
    input.attacker.relations = [{ from: 'attacker-0', to: 'attacker-1', definitionVersion: '1.0.0', value: 3 }];
    input.attacker.slots = [...input.attacker.slots].reverse();
    const projection = await buildMatchProjection(input);
    expect(projection.sides.attacker.heroes.map(h => h.slot_id)).toEqual(['slot-0', 'slot-1', 'slot-2', 'slot-3', 'slot-4']);
    expect(projection.sides.attacker.relations.map(r => r.level)).toEqual([3, null]);
    expect(projection.sides.defender.relations).toEqual([]);
  });
  it.each(['foreign hero', 'official hero', 'foreign equipment', 'official equipment', 'hero catalog digest', 'hero catalog version', 'unknown equip target', 'definition digest', 'definition version', 'unapproved equipment', 'duplicate hero', 'duplicate equipment', 'foreign relation', 'unapproved rules'] as const)('rejects %s', async failure => {
    const input = await fixture();
    const heroes = input.attacker.heroSnapshot.heroes as unknown as Array<{ instanceId: string; playerId: string; authority: string; definition: { digest: string; version: string } }>;
    const items = input.attacker.equipment as unknown as Array<{ instanceId: string; playerId: string; authority: string; heroId: string | null; definition: { id: string; version: string; digest: string } }>;
    switch (failure) {
      case 'foreign hero': heroes[0].playerId = 'other'; break;
      case 'official hero': heroes[0].authority = 'official'; break;
      case 'foreign equipment': items[0].playerId = 'other'; break;
      case 'official equipment': items[0].authority = 'official'; break;
      case 'hero catalog digest': heroes[0].definition.digest = 'c'.repeat(64); break;
      case 'hero catalog version': heroes[0].definition.version = '9.0.0'; break;
      case 'unknown equip target': items[0].heroId = 'other'; break;
      case 'definition digest': items[0].definition.digest = 'c'.repeat(64); break;
      case 'definition version': items[0].definition.version = '9.0.0'; break;
      case 'unapproved equipment': items[0].definition.id = 'unknown'; break;
      case 'duplicate hero': heroes[1].instanceId = heroes[0].instanceId; break;
      case 'duplicate equipment': input.attacker.equipment = [...input.attacker.equipment, input.attacker.equipment[0]]; break;
      case 'foreign relation': input.attacker.relations = [{ from: 'attacker-0', to: 'other-1', definitionVersion: '1.0.0', value: 3 }]; break;
      case 'unapproved rules': input.approvedRulesetDigest = 'c'.repeat(64); break;
    }
    await expect(buildMatchProjection(input)).rejects.toThrow();
  });
});
