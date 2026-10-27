import type { EquipmentInstance } from './repository';

/** A strategy's equipment choices; asset ownership stays in EquipmentRepository. */
export interface OwnedEquipmentDraft {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly assignments: Readonly<Record<string, string | null>>;
}

export function parseOwnedEquipmentDraft(value: unknown): OwnedEquipmentDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.playerId !== 'string' || !record.playerId.trim()
    || !record.assignments || typeof record.assignments !== 'object' || Array.isArray(record.assignments)) return null;
  const entries = Object.entries(record.assignments);
  if (entries.some(([id, hero]) => !id.trim() || (hero !== null && (typeof hero !== 'string' || !hero.trim())))) return null;
  return { schemaVersion: 1, playerId: record.playerId, assignments: Object.fromEntries(entries) as Record<string, string | null> };
}

/** Legacy setups retain their existing assignments until an explicit Draft adoption. */
export function equipmentForDraft(items: readonly EquipmentInstance[], playerId: string, draft: OwnedEquipmentDraft | null): EquipmentInstance[] {
  if (draft && draft.playerId !== playerId) throw new Error('Equipment Draft belongs to another local Player. Restore that profile or explicitly adopt its equipment choices.');
  const ids = new Set(items.map(item => item.instanceId));
  if (draft && Object.keys(draft.assignments).some(id => !ids.has(id))) throw new Error('Equipment Draft references an unavailable instance. Review the current inventory.');
  return items.map(item => {
    if (item.playerId !== playerId) throw new Error('Equipment ownership mismatch.');
    return { ...structuredClone(item), heroId: draft ? (Object.hasOwn(draft.assignments, item.instanceId) ? draft.assignments[item.instanceId] : null) : item.heroId };
  });
}
