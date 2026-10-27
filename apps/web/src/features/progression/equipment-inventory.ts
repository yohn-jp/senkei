import { equipmentForDraft, type OwnedEquipmentDraft } from '../equipment/draft';
import type { EquipmentDefinitionRef, EquipmentInstance } from '../equipment/repository';

/** A group never combines different versions or definitions that happen to share a name. */
export interface EquipmentGroup {
  readonly definition: EquipmentDefinitionRef;
  readonly instances: readonly EquipmentInstance[];
  readonly equippedCount: number;
}

export function groupEquipment(items: readonly EquipmentInstance[]): EquipmentGroup[] {
  const groups = new Map<string, { definition: EquipmentDefinitionRef; instances: EquipmentInstance[]; equippedCount: number }>();
  for (const item of items) {
    const definition = item.definition;
    const key = JSON.stringify([definition.id, definition.version, definition.digest, definition.effectRef]);
    let group = groups.get(key);
    if (!group) {
      group = { definition: structuredClone(definition), instances: [], equippedCount: 0 };
      groups.set(key, group);
    }
    group.instances.push(structuredClone(item));
    if (item.heroId !== null) group.equippedCount++;
  }
  return [...groups.values()];
}

/** Construct a complete Draft without writing ownership or the current Draft. */
export function reviewEquipmentChange(
  playerId: string,
  items: readonly EquipmentInstance[],
  draft: OwnedEquipmentDraft | null,
  ownedHeroIds: readonly string[],
  instanceId: string,
  heroId: string | null,
  approved: readonly EquipmentDefinitionRef[],
): OwnedEquipmentDraft {
  const current = equipmentForDraft(items, playerId, draft);
  const item = current.find(candidate => candidate.instanceId === instanceId);
  if (!item) throw new Error('Equipment is no longer owned. Reload inventory.');
  if (heroId !== null && !ownedHeroIds.includes(heroId)) throw new Error('Hero is no longer owned. Reload inventory.');
  if (!approved.some(definition => definition.id === item.definition.id && definition.version === item.definition.version && definition.digest === item.definition.digest && definition.effectRef === item.definition.effectRef)) {
    throw new Error('This equipment definition is not available in the current ruleset.');
  }
  return { schemaVersion: 1, playerId, assignments: Object.fromEntries(current.map(candidate => [candidate.instanceId, candidate.instanceId === instanceId ? heroId : candidate.heroId])) };
}

/** Stable comparison for invalidating an open review when another edit changes its source. */
export function equipmentDraftKey(draft: OwnedEquipmentDraft): string {
  return JSON.stringify([draft.playerId, Object.entries(draft.assignments).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
}
