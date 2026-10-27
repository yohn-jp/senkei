import { useId, type KeyboardEvent, type ReactElement } from 'react';
import type { RelationshipEvent } from '../relationships/repository';

export interface RelationshipGraphHero {
  readonly instanceId: string;
  readonly label: string;
}

export interface RelationshipGraphProps {
  readonly heroes: readonly RelationshipGraphHero[];
  readonly events: readonly RelationshipEvent[];
  readonly formationIds: readonly string[];
  readonly selectedPair?: { readonly from: string; readonly to: string } | null;
  onSelectPair(from: string, to: string): void;
}

interface RelationshipPair {
  readonly from: RelationshipGraphHero;
  readonly to: RelationshipGraphHero;
  readonly forward: RelationshipEvent | undefined;
  readonly reverse: RelationshipEvent | undefined;
}

/** Build only pairs of actual owned instances; a missing directed record is not zero. */
export function buildRelationshipGraph(
  heroes: readonly RelationshipGraphHero[],
  events: readonly RelationshipEvent[],
): { readonly heroes: readonly RelationshipGraphHero[]; readonly pairs: readonly RelationshipPair[] } {
  const byId = new Map<string, RelationshipGraphHero>();
  for (const hero of heroes) if (!byId.has(hero.instanceId)) byId.set(hero.instanceId, hero);
  const ordered = [...byId.values()].sort((a, b) => a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0);
  const latest = new Map<string, RelationshipEvent>();
  for (const event of events) {
    if (event.source !== 'authoritative' || event.from === event.to || !byId.has(event.from) || !byId.has(event.to)) continue;
    latest.set(JSON.stringify([event.from, event.to]), event);
  }
  const pairs: RelationshipPair[] = [];
  for (let index = 0; index < ordered.length; index++) {
    for (let next = index + 1; next < ordered.length; next++) {
      const from = ordered[index]; const to = ordered[next];
      pairs.push({ from, to, forward: latest.get(JSON.stringify([from.instanceId, to.instanceId])), reverse: latest.get(JSON.stringify([to.instanceId, from.instanceId])) });
    }
  }
  return { heroes: ordered, pairs };
}

function isSelected(pair: RelationshipPair, selected: RelationshipGraphProps['selectedPair']): boolean {
  return !!selected && ((selected.from === pair.from.instanceId && selected.to === pair.to.instanceId)
    || (selected.to === pair.from.instanceId && selected.from === pair.to.instanceId));
}

function directedValue(event: RelationshipEvent | undefined): string {
  return event?.value === null || event === undefined ? 'undefined' : String(event.value);
}

/** The picture uses the same owned IDs as the list; selecting an edge is read-only. */
export function RelationshipGraph({ heroes, events, formationIds, selectedPair, onSelectPair }: RelationshipGraphProps): ReactElement {
  const graph = buildRelationshipGraph(heroes, events);
  const marker = useId().replaceAll(':', '');
  const formation = new Set(formationIds);
  const positions = new Map(graph.heroes.map((hero, index) => {
    const angle = 2 * Math.PI * index / graph.heroes.length - Math.PI / 2;
    return [hero.instanceId, { x: 400 + Math.cos(angle) * 220, y: 280 + Math.sin(angle) * 220 }] as const;
  }));
  const activate = (event: KeyboardEvent<SVGGElement>, pair: RelationshipPair): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelectPair(pair.from.instanceId, pair.to.instanceId);
  };
  return <section aria-label="Owned Hero relationship graph">
    <h4>Relationship graph · local trial</h4>
    <p>Nodes are owned Hero instances. Arrows show recorded directions; a missing value is undefined. Selecting a pair only opens its details.</p>
    {graph.heroes.length === 0 ? <p>No owned Heroes are available.</p> : <>
      <svg viewBox="0 0 800 560" role="group" aria-label="Owned Hero relationships" style={{ width: '100%', maxWidth: 760, height: 'auto' }}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="#dce9e4" /></marker></defs>
        {graph.pairs.filter(pair => pair.forward || pair.reverse).map(pair => {
          const a = positions.get(pair.from.instanceId)!; const b = positions.get(pair.to.instanceId)!;
          const dx = b.x - a.x; const dy = b.y - a.y; const distance = Math.hypot(dx, dy) || 1;
          const start = { x: a.x + 20 * dx / distance, y: a.y + 20 * dy / distance };
          const end = { x: b.x - 20 * dx / distance, y: b.y - 20 * dy / distance };
          const selected = isSelected(pair, selectedPair);
          return <g key={JSON.stringify([pair.from.instanceId, pair.to.instanceId])} role="button" tabIndex={0}
            aria-label={`Inspect ${pair.from.label} and ${pair.to.label}`} aria-pressed={selected}
            onClick={() => onSelectPair(pair.from.instanceId, pair.to.instanceId)} onKeyDown={event => activate(event, pair)}>
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth="18" />
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={selected ? '#ffd28a' : '#dce9e4'} strokeWidth={selected ? 3 : 2}
              markerStart={pair.reverse ? `url(#${marker})` : undefined} markerEnd={pair.forward ? `url(#${marker})` : undefined} />
          </g>;
        })}
        {graph.heroes.map((hero, index) => {
          const point = positions.get(hero.instanceId)!;
          return <g key={hero.instanceId}><title>{`${hero.label}${formation.has(hero.instanceId) ? ' · in formation' : ''}`}</title>
            <circle cx={point.x} cy={point.y} r="17" fill="#1b3341" stroke={formation.has(hero.instanceId) ? '#ffd28a' : '#dce9e4'} strokeWidth="2" />
            <text x={point.x} y={point.y + 5} textAnchor="middle" fill="#fff" fontSize="14">{index + 1}</text>
          </g>;
        })}
      </svg>
      <ol aria-label="Graph Hero identities">{graph.heroes.map(hero => <li key={hero.instanceId}>{hero.label}{formation.has(hero.instanceId) ? ' · in formation' : ''}</li>)}</ol>
      {graph.pairs.length === 0 ? <p>At least two owned Heroes are needed to inspect a pair.</p> : <details><summary>Inspect any owned pair</summary>
        <ul>{graph.pairs.map(pair => <li key={JSON.stringify([pair.from.instanceId, pair.to.instanceId])}>
          <button type="button" aria-pressed={isSelected(pair, selectedPair)} onClick={() => onSelectPair(pair.from.instanceId, pair.to.instanceId)}>
            {pair.from.label} ↔ {pair.to.label} · {pair.from.label} → {pair.to.label}: {directedValue(pair.forward)} · {pair.to.label} → {pair.from.label}: {directedValue(pair.reverse)}
          </button>
        </li>)}</ul>
      </details>}
    </>}
  </section>;
}
