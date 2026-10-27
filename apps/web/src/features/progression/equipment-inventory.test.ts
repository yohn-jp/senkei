import { describe, expect, it } from 'vitest';
import type { EquipmentInstance } from '../equipment/repository';
import { equipmentDraftKey, groupEquipment, reviewEquipmentChange } from './equipment-inventory';

const definition = { id: 'blade', version: '1.0.0', digest: 'digest', effectRef: 'blade' };
const item = (instanceId: string, heroId: string | null = null): EquipmentInstance => ({ instanceId, playerId: 'player', authority: 'local', heroId, definition });

describe('equipment inventory and Draft review', () => {
  it('aggregates exact definitions while retaining every instance and assignment', () => {
    const items = [item('one', 'hero'), item('two'), { ...item('three'), definition: { ...definition, version: '2.0.0' } }];
    const groups = groupEquipment(items);
    expect(groups.map(group => [group.instances.length, group.equippedCount])).toEqual([[2, 1], [1, 0]]);
    expect(groups[0].instances.map(candidate => candidate.instanceId)).toEqual(['one', 'two']);
  });
  it('makes a full proposed Draft without mutating ownership or the existing Draft', () => {
    const items = [item('one', 'hero-a'), item('two')];
    const legacy = reviewEquipmentChange('player', items, null, ['hero-a', 'hero-b'], 'two', 'hero-b', [definition]);
    expect(legacy.assignments).toEqual({ one: 'hero-a', two: 'hero-b' });
    expect(items[1].heroId).toBeNull();
    const next = reviewEquipmentChange('player', items, legacy, ['hero-a', 'hero-b'], 'one', null, [definition]);
    expect(next.assignments).toEqual({ one: null, two: 'hero-b' });
    expect(legacy.assignments).toEqual({ one: 'hero-a', two: 'hero-b' });
    expect(equipmentDraftKey(next)).not.toEqual(equipmentDraftKey(legacy));
  });
  it('rejects stale instances, foreign Heroes and unapproved definitions', () => {
    const items = [item('one')];
    expect(() => reviewEquipmentChange('player', items, null, ['hero'], 'missing', 'hero', [definition])).toThrow();
    expect(() => reviewEquipmentChange('player', items, null, ['hero'], 'one', 'other', [definition])).toThrow();
    expect(() => reviewEquipmentChange('player', items, null, ['hero'], 'one', 'hero', [])).toThrow();
    expect(() => reviewEquipmentChange('other', items, null, ['hero'], 'one', 'hero', [definition])).toThrow();
  });
});
