import type { SimulationSnapshot, ReproductionAssets, WorldStateView } from '../../contracts';
/** All displayed values come from this preflight's retained input and definitions. */
export function FrozenAssetsPreview({snapshot,assets,initialState}:{snapshot:SimulationSnapshot; assets:ReproductionAssets; initialState?:WorldStateView}) {
  const projection = snapshot.context.match_projection;
  if (!projection) return null;
  const definitions = assets.rule_package.next?.projection_policy;
  const values = (slotId:string) => Object.values(initialState?.entities ?? {}).find(entity => entity.owner === 'attacker' && entity.fields.slot_id?.kind === 'string' && entity.fields.slot_id.value === slotId)?.fields;
  const integer = (slotId:string,field:string) => { const value=values(slotId)?.[field]; return value?.kind==='integer' ? value.value : 'unavailable'; };
  return <section aria-label="Frozen asset preview" className="frozen-assets-preview"><h3>Frozen asset preview</h3>
    <p>Local test policy · unapproved for production. Match inputs remain fixed during battle and Replay.</p>
    <ul>{projection.sides.attacker.heroes.map(hero => <li key={hero.instance_id}>{hero.slot_id}: {hero.catalog_id} · {hero.instance_id}
      <p>Enbu initial stats: Attack {integer(hero.slot_id,'attack')} · Defense {integer(hero.slot_id,'defense')} · HP {integer(hero.slot_id,'hp')}.</p>
      <ul>{hero.equipment.map(item => <li key={item.instance_id}>{item.definition_id} · {item.instance_id} · {definitions?.equipment[item.definition_id]?.effects.map(effect => `${effect.stat} ${effect.add >= 0 ? '+' : ''}${effect.add}`).join(', ')}</li>)}</ul>
    </li>)}</ul>
    <p>Directed relationship values are fixed. Symmetric cooperation requires both defined directions and living Heroes in the same current Squad; split, death and revival recompute applicability. Undefined values grant no inferred bonus.</p>
    <p>{projection.sides.attacker.relations.length} directed relationship inputs. Formula: {definitions?.relation ? `${definitions.relation.rounding}, pair-normalized, capped at ${definitions.relation.max_bonus} (${definitions.relation.stat})` : 'undefined'}.</p>
    <details><summary>Immutable input references</summary><pre>{JSON.stringify({projection,behavior:snapshot.context.next_behavior,minionBehavior:snapshot.context.next_minion_behavior,route:snapshot.context.next_route,match:snapshot.context.match_id},null,2)}</pre></details>
  </section>;
}
