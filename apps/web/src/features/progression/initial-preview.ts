import type { CoreClient, ReproductionAssets, SimulationSnapshot } from '../../contracts';
import { reproductionSnapshotDigest, validateNextExperimentDiagnostics, validateNextExperimentAuthorization } from '../next/experiment-restoration';
/** Reads the actual Enbu initializer. This separate one-tick trial is never saved or settled. */
export async function initialOwnedState(core: CoreClient, snapshot: SimulationSnapshot, assets: ReproductionAssets) {
  const sourceDigest = await reproductionSnapshotDigest(snapshot);
  const preview = { ...snapshot, context: { ...snapshot.context, match_id: `preview-${sourceDigest.slice(0,32)}`, max_ticks: 1 } };
  const digest = await reproductionSnapshotDigest(preview);
  const response = await core.reproduce(preview, assets, digest, {include_diagnostics:true,diagnostics_side:'attacker'});
  validateNextExperimentAuthorization(response, true);
  await validateNextExperimentDiagnostics(response, preview);
  const replay = response.owner_replays?.attacker;
  const frame = replay?.frames[0];
  if (replay?.perspective !== 'attacker' || frame?.tick !== 0 || !frame.visible_state) throw new Error('Enbu did not provide an authorized initial asset projection.');
  return frame.visible_state;
}
