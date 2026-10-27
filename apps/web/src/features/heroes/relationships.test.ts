import { it, expect } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { OwnedRelationshipRepository } from './relationships';
it('serializes concurrent writes from separate repository instances', async () => {
  const name = crypto.randomUUID(); const owns = (player: string, hero: string) => player === 'p' && ['a','b'].includes(hero);
  const a = new OwnedRelationshipRepository('p', owns, indexedDB, name); const b = new OwnedRelationshipRepository('p', owns, indexedDB, name);
  const event = (eventId: string) => ({ eventId, source: 'authoritative' as const, from: 'a', to: 'b', definitionVersion: 'trial', value: null, tags: [], history: eventId });
  await Promise.all([a.applyEvent(event('one')), b.applyEvent(event('two'))]);
  const result = await a.read(); expect(result.ok && result.value.events.map(e => e.eventId)).toEqual(['one','two']);
});
