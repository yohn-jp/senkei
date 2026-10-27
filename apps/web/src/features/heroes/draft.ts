/** Instance choices belong to one strategy, separate from Player asset ownership. */
export interface OwnedHeroSelection {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly slots: Readonly<Record<string, string>>;
}

export function parseOwnedHeroSelection(value: unknown): OwnedHeroSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.playerId !== 'string' || !record.playerId.trim()
    || !record.slots || typeof record.slots !== 'object' || Array.isArray(record.slots)) return null;
  const entries = Object.entries(record.slots);
  if (entries.some(([slot, id]) => !slot.replace(/\p{White_Space}/gu, '')
    || /[\uD800-\uDFFF]/u.test(slot) || new TextEncoder().encode(slot).byteLength > 48
    || typeof id !== 'string' || !id.trim())) return null;
  return { schemaVersion: 1, playerId: record.playerId, slots: Object.fromEntries(entries) as Record<string, string> };
}

export function heroSelectionsForDraft(playerId: string, legacy: Readonly<Record<string, string>>, draft: OwnedHeroSelection | null): Readonly<Record<string, string>> {
  if (draft && draft.playerId !== playerId) throw new Error('Owned Hero Draft belongs to another local Player. Restore that profile or explicitly select Heroes for this Draft.');
  return draft?.slots ?? legacy;
}

/** Opaque slot IDs are own properties, never inherited keys or prototype setters. */
export function selectedOwnedHero(slots: Readonly<Record<string, string>>, slotId: string): string {
  return Object.hasOwn(slots, slotId) ? slots[slotId] ?? '' : '';
}
export function changeOwnedHeroSelection(slots: Readonly<Record<string, string>>, slotId: string, instanceId: string): Record<string, string> {
  const next = Object.fromEntries(Object.entries(slots)) as Record<string, string>;
  if (instanceId) Object.defineProperty(next, slotId, { value: instanceId, enumerable: true, writable: true, configurable: true });
  else delete next[slotId];
  return next;
}
