import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RelationshipEvent } from '../relationships/repository';
import { buildRelationshipGraph, RelationshipGraph } from './RelationshipGraph';

const heroes = [
  { instanceId: 'hero-b', label: 'Beta · hero-b' },
  { instanceId: 'hero-a', label: 'Alpha · hero-a' },
  { instanceId: 'hero-c', label: 'Gamma · hero-c' },
];
const event = (eventId: string, from: string, to: string, value: number | null, source: RelationshipEvent['source'] = 'authoritative'): RelationshipEvent => ({
  eventId, from, to, value, source, definitionVersion: '1.0.0', tags: [], history: eventId,
});

describe('owned relationship graph', () => {
  it('uses latest directed records for owned pairs and does not turn missing or null into zero', () => {
    const events = [event('old', 'hero-a', 'hero-b', 9), event('new', 'hero-a', 'hero-b', 0), event('reverse', 'hero-b', 'hero-a', null),
      event('foreign', 'hero-a', 'not-owned', 999), event('replay', 'hero-c', 'hero-a', 4, 'replay')];
    const before = structuredClone({ heroes, events });
    const graph = buildRelationshipGraph(heroes, events);
    expect(graph.heroes.map(hero => hero.instanceId)).toEqual(['hero-a', 'hero-b', 'hero-c']);
    expect(graph.pairs).toHaveLength(3);
    expect(graph.pairs[0].forward?.eventId).toBe('new');
    expect(graph.pairs[0].forward?.value).toBe(0);
    expect(graph.pairs[0].reverse?.value).toBeNull();
    expect(graph.pairs[1].forward).toBeUndefined();
    expect(graph.pairs[1].reverse).toBeUndefined();
    expect({ heroes, events }).toEqual(before);
  });

  it('offers recorded graph edges and all owned pairs as keyboard-accessible buttons without exposing outsiders', () => {
    const html = renderToStaticMarkup(createElement(RelationshipGraph, {
      heroes,
      events: [event('one', 'hero-a', 'hero-b', 0), event('foreign', 'hero-a', 'not-owned', 999)],
      formationIds: ['hero-a'], selectedPair: { from: 'hero-b', to: 'hero-a' }, onSelectPair: vi.fn(),
    }));
    expect(html).toContain('aria-label="Owned Hero relationships"');
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('aria-label="Inspect Alpha · hero-a and Beta · hero-b" aria-pressed="true"');
    expect(html).toContain('Alpha · hero-a → Beta · hero-b: 0');
    expect(html).toContain('Beta · hero-b → Alpha · hero-a: undefined');
    expect(html).toContain('Alpha · hero-a ↔ Gamma · hero-c');
    expect(html).toContain('Alpha · hero-a · in formation');
    expect(html).not.toContain('not-owned');
    expect(html).not.toContain(': 999');
  });

  it('shows an honest empty and single-Hero state', () => {
    const props = { events: [], formationIds: [], onSelectPair: vi.fn() };
    expect(renderToStaticMarkup(createElement(RelationshipGraph, { ...props, heroes: [] }))).toContain('No owned Heroes are available.');
    const single = renderToStaticMarkup(createElement(RelationshipGraph, { ...props, heroes: [heroes[0]] }));
    expect(single).toContain('At least two owned Heroes are needed to inspect a pair.');
    expect(single).not.toContain('Inspect any owned pair');
  });
});
