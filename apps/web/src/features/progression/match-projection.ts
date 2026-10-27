/** Build a private, immutable local-trial match input from repository snapshots. */
type Version = { major: number; minor: number; patch: number };
type Hero = { instanceId: string; playerId: string; authority: string; definition: { id: string; version: string; digest: string; catalogId: string } };
type Equipment = { instanceId: string; playerId: string; authority: string; heroId: string | null; definition: { id: string; version: string; digest: string; effectRef: string } };
type Relation = { from: string; to: string; definitionVersion: string; value: number | null };
type Effect = { stat: string; add: number };
type EquipmentDefinition = { version: Version; effects: Effect[] };
type Formula = { version: Version; stat: string; add_per_level: number; max_level: number; max_bonus: number; rounding: 'floor' };
export type TrialPolicy = { schema_version: 1; test_only: true; hero_catalog_id: string; hero_catalog_version: Version; hero_catalog_digest: string; equipment: Record<string, EquipmentDefinition>; relation: Formula | null };
export type TrialSideInput = { playerId: string; heroSnapshot: { playerId: string; heroes: readonly Hero[] }; equipment: readonly Equipment[]; relations: readonly Relation[]; slots: readonly { slotId: string; heroInstanceId: string }[] };
export type TrialProjectionInput = { policy: TrialPolicy; rulesetDigest: string; approvedRulesetDigest: string; attacker: TrialSideInput; defender: TrialSideInput };
const wireVersion = (v: Version): Version => ({ major: v.major, minor: v.minor, patch: v.patch });
const versionText = (v: Version) => `${v.major}.${v.minor}.${v.patch}`;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const digestShape = (s: string) => /^[0-9a-f]{64}$/.test(s);
async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Validate and freeze one local side against the trial policy; this does not approve a ruleset. */
export async function buildOwnedSideProjection(policyInput: TrialPolicy, sourceInput: TrialSideInput) {
    const policy = structuredClone(policyInput);
    const source = structuredClone(sourceInput);
    if (policy.schema_version !== 1 || policy.test_only !== true || !digestShape(policy.hero_catalog_digest)) throw new Error('Unapproved trial policy');
    if (!source.playerId.trim() || source.heroSnapshot.playerId !== source.playerId || source.slots.length !== 5 || source.slots.some(s => !s.slotId.trim() || !s.heroInstanceId.trim()) || new Set(source.slots.map(s => s.slotId)).size !== 5 || new Set(source.slots.map(s => s.heroInstanceId)).size !== 5) throw new Error('Invalid formation ownership');
    const ownedIds = new Set(source.heroSnapshot.heroes.map(h => h.instanceId));
    if (ownedIds.size !== source.heroSnapshot.heroes.length || source.heroSnapshot.heroes.some(h => !h.instanceId.trim() || h.playerId !== source.playerId || h.authority !== 'local')) throw new Error('Invalid Hero ownership snapshot');
    if (source.equipment.some(e => !e.instanceId.trim() || e.playerId !== source.playerId || e.authority !== 'local' || (e.heroId !== null && !ownedIds.has(e.heroId)))) throw new Error('Invalid equipment ownership snapshot');
    if (source.relations.some(r => !ownedIds.has(r.from) || !ownedIds.has(r.to) || r.from === r.to)) throw new Error('Invalid relationship ownership snapshot');
    const heroes = [];
    for (const slot of [...source.slots].sort((a, b) => compare(a.slotId, b.slotId))) {
      const owned = source.heroSnapshot.heroes.filter(h => h.instanceId === slot.heroInstanceId);
      if (owned.length !== 1) throw new Error('Hero instance not owned');
      const hero = owned[0];
      if (hero.authority !== 'local' || hero.playerId !== source.playerId || hero.definition.catalogId !== policy.hero_catalog_id || hero.definition.version !== versionText(policy.hero_catalog_version) || hero.definition.digest !== policy.hero_catalog_digest) throw new Error('Hero catalog or authority mismatch');
      const equipment = [];
      for (const item of source.equipment.filter(i => i.heroId === hero.instanceId).sort((a, b) => compare(a.instanceId, b.instanceId))) {
        const def = policy.equipment[item.definition.id];
        if (!def || item.authority !== 'local' || item.playerId !== source.playerId || item.definition.effectRef !== item.definition.id || item.definition.version !== versionText(def.version)) throw new Error('Equipment definition or ownership mismatch');
        const digest = await digestJson({ version: wireVersion(def.version), effects: def.effects.map(effect => ({ stat: effect.stat, add: effect.add })) });
        if (item.definition.digest !== digest) throw new Error('Equipment definition digest mismatch');
        equipment.push({ instance_id: item.instanceId, owner_id: source.playerId, definition_id: item.definition.id, definition_version: def.version, definition_digest: digest });
      }
      heroes.push({ slot_id: slot.slotId, owner_id: source.playerId, instance_id: hero.instanceId, catalog_id: hero.definition.id, definition_catalog_id: hero.definition.catalogId, definition_version: policy.hero_catalog_version, definition_digest: hero.definition.digest, equipment });
    }
    const selected = new Set(heroes.map(h => h.instance_id));
    if (new Set(source.equipment.map(e => e.instanceId)).size !== source.equipment.length) throw new Error('Duplicate equipment instance');
    const pairs = new Map<string, Relation>();
    for (const relation of source.relations) {
      if (!selected.has(relation.from) || !selected.has(relation.to)) continue;
      if (relation.from === relation.to || !policy.relation || relation.definitionVersion !== versionText(policy.relation.version) || (relation.value !== null && (!Number.isSafeInteger(relation.value) || relation.value < 0 || relation.value > policy.relation.max_level))) throw new Error('Invalid relationship');
      pairs.set(JSON.stringify([relation.from, relation.to]), relation);
    }
    const relations = [];
    if (policy.relation) {
      const formula = policy.relation;
      const formulaDigest = await digestJson({ version: wireVersion(formula.version), stat: formula.stat, add_per_level: formula.add_per_level, max_level: formula.max_level, max_bonus: formula.max_bonus, rounding: formula.rounding });
      const ids = [...selected].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = pairs.get(JSON.stringify([ids[i], ids[j]]));
        const b = pairs.get(JSON.stringify([ids[j], ids[i]]));
        if (!a && !b) continue;
        for (const [from, to, value] of [[ids[i], ids[j], a?.value ?? null], [ids[j], ids[i], b?.value ?? null]] as const) relations.push({ from_instance_id: from, to_instance_id: to, level: value, formula_version: formula.version, formula_digest: formulaDigest });
      }
    }
    return freeze(structuredClone({ owner_id: source.playerId, authority: 'local' as const, heroes, relations }));
}
export async function buildMatchProjection(input: TrialProjectionInput) {
  input = structuredClone(input);
  const { policy } = input;
  if (policy.schema_version !== 1 || policy.test_only !== true || !digestShape(input.rulesetDigest) || input.rulesetDigest !== input.approvedRulesetDigest || !digestShape(policy.hero_catalog_digest)) throw new Error('Unapproved trial policy');
  const [attacker, defender] = await Promise.all([buildOwnedSideProjection(policy, input.attacker), buildOwnedSideProjection(policy, input.defender)]);
  const instances = [...attacker.heroes, ...defender.heroes].map(h => h.instance_id);
  const items = [...attacker.heroes, ...defender.heroes].flatMap(h => h.equipment.map(e => e.instance_id));
  if (new Set(instances).size !== instances.length || new Set(items).size !== items.length) throw new Error('Duplicate asset identity');
  return freeze(structuredClone({ schema_version: 1, sides: { attacker, defender } }));
}
