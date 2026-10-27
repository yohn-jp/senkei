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
it('captures an event before asynchronous database opening', async () => {
  const r = new OwnedRelationshipRepository('p', () => true, indexedDB, crypto.randomUUID());
  const event = { eventId: 'first', source: 'authoritative' as const, from: 'a', to: 'b', definitionVersion: 'test', value: 1, tags: ['original'], history: 'before' };
  const pending = r.applyEvent(event); event.history = 'after'; event.tags.push('changed');
  expect((await pending).ok).toBe(true); const result = await r.read();
  expect(result.ok && result.value.events[0]).toMatchObject({history: 'before', tags: ['original']});
});
