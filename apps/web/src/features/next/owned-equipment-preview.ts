import type { CoreClient, ReproductionAssets, SimulationSnapshot } from '../../contracts';
import { equipmentForDraft, type OwnedEquipmentDraft } from '../equipment/draft';
import { heroSelectionsForDraft, type OwnedHeroSelection } from '../heroes/draft';
import type { OwnedAssetsState } from '../heroes/OwnedAssetsPanel';
import { buildOwnedSideProjection } from '../progression/match-projection';
import { initialOwnedState } from '../progression/initial-preview';
import { reproductionSnapshotDigest } from './experiment-restoration';

/** Reuses Enbu's initializer with a hypothetical input, leaving Draft and Run untouched. */
export async function previewOwnedEquipment(
  core: CoreClient, snapshot: SimulationSnapshot, assets: ReproductionAssets,
  owned: OwnedAssetsState, heroes: OwnedHeroSelection | null, candidate: OwnedEquipmentDraft,
) {
  const policy = assets.rule_package.next?.projection_policy;
  const projection = snapshot.context.match_projection;
  if (!policy || !projection || projection.sides.attacker.owner_id !== owned.playerId
    || assets.rule_package.ruleset.digest !== snapshot.attacker.ruleset.digest) throw new Error('Validate the current owned formation in Ready before comparing equipment.');
  const selections = heroSelectionsForDraft(owned.playerId, owned.slotSelections, heroes);
  const attacker = await buildOwnedSideProjection(policy, {
    playerId: owned.playerId, heroSnapshot: owned.heroes,
    equipment: equipmentForDraft(owned.equipment, owned.playerId, candidate),
    relations: owned.relationships.events,
    slots: projection.sides.attacker.heroes.map(hero => ({ slotId: hero.slot_id, heroInstanceId: selections[hero.slot_id] ?? '' })),
  });
  const preview = structuredClone({ ...snapshot, context: { ...snapshot.context,
    match_projection: { ...projection, sides: { ...projection.sides, attacker } },
  } });
  await core.preflightReproduction(preview, assets, await reproductionSnapshotDigest(preview));
  return initialOwnedState(core, preview, assets);
}
