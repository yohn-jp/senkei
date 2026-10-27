import { describe, expect, it } from 'vitest';
import { equipmentForDraft, parseOwnedEquipmentDraft } from './draft';
import { heroSelectionsForDraft, parseOwnedHeroSelection } from '../heroes/draft';
import type { EquipmentInstance } from './repository';

const item: EquipmentInstance = { instanceId: 'item', playerId: 'player', authority: 'local', heroId: 'old-hero', definition: { id: 'def', version: '1', digest: 'digest', effectRef: 'effect' } };

describe('strategy-owned asset choices', () => {
  it('isolates equipment assignments between strategies without changing the inventory', () => {
    const draft = { schemaVersion: 1 as const, playerId: 'player', assignments: { item: 'new-hero' } };
    expect(equipmentForDraft([item], 'player', draft)[0].heroId).toBe('new-hero');
    expect(equipmentForDraft([item], 'player', { ...draft, assignments: { item: null } })[0].heroId).toBeNull();
    expect(equipmentForDraft([item], 'player', null)[0].heroId).toBe('old-hero');
    expect(item.heroId).toBe('old-hero');
  });

  it('keeps newly obtained equipment unequipped in an explicitly adopted Draft', () => {
    expect(equipmentForDraft([item], 'player', { schemaVersion: 1, playerId: 'player', assignments: {} })[0].heroId).toBeNull();
  });

  it('rejects stale and cross-Player equipment choices instead of silently replacing them', () => {
    expect(() => equipmentForDraft([item], 'player', { schemaVersion: 1, playerId: 'other', assignments: {} })).toThrow('another local Player');
    expect(() => equipmentForDraft([], 'player', { schemaVersion: 1, playerId: 'player', assignments: { item: null } })).toThrow('unavailable instance');
    expect(() => equipmentForDraft([item], 'other', null)).toThrow('ownership mismatch');
  });

  it('preserves explicit cleared Hero selections separately from legacy choices', () => {
    expect(heroSelectionsForDraft('player', { one: 'hero' }, { schemaVersion: 1, playerId: 'player', slots: {} })).toEqual({});
    expect(heroSelectionsForDraft('player', { one: 'hero' }, null)).toEqual({ one: 'hero' });
    expect(() => heroSelectionsForDraft('other', {}, { schemaVersion: 1, playerId: 'player', slots: {} })).toThrow('another local Player');
  });

  it('validates versioned persisted choices without accepting malformed values', () => {
    expect(parseOwnedEquipmentDraft({ schemaVersion: 2, playerId: 'player', assignments: {} })).toBeNull();
    expect(parseOwnedEquipmentDraft({ schemaVersion: 1, playerId: 'player', assignments: { item: 0 } })).toBeNull();
    expect(parseOwnedHeroSelection({ schemaVersion: 1, playerId: 'player', slots: { one: '' } })).toBeNull();
    expect(parseOwnedHeroSelection({ schemaVersion: 1, playerId: 'player', slots: { '\uFEFF': 'hero' } })?.slots).toEqual({ '\uFEFF': 'hero' });
    const choice = { schemaVersion: 1, playerId: 'player', assignments: { item: null } };
    expect(parseOwnedEquipmentDraft(JSON.parse(JSON.stringify(choice)))).toEqual(choice);
  });
});
