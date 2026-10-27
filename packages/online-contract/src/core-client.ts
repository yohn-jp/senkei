import type { CoreClient, SimulationResponse } from "../../../apps/web/src/contracts/core";
import { validateNextExperimentAuthorization, validateNextExperimentReplay } from "../../../apps/web/src/features/next/experiment-restoration";
import { reproductionSnapshotDigest } from "../../../apps/web/src/worker/input-identity";
import { sameJsonResponse } from "../../../apps/web/src/worker/json-response-equality";
import type { AdmittedMatch, ExecutionOutput, OfficialCorePort } from "./index";

/**
 * Connect the authority to an already configured, trusted server-side CoreClient.
 * The caller must ensure the implementation actually runs the trusted Rust core;
 * a browser-supplied response or an arbitrary CoreClient is not an authority.
 * Public projection verification reruns the match and compares the complete output.
 */
export class ReproducingCoreClientAdapter implements OfficialCorePort {
  constructor(private readonly core: Pick<CoreClient, "preflightReproduction" | "reproduce">) {}

  private async execute(match: AdmittedMatch): Promise<SimulationResponse> {
    if (await reproductionSnapshotDigest(match.snapshot) !== match.snapshotDigest) throw new Error("Snapshot digest mismatch");
    await this.core.preflightReproduction(match.snapshot, match.assets, match.snapshotDigest);
    const response = await this.core.reproduce(match.snapshot, match.assets, match.snapshotDigest, { include_diagnostics: false });
    validateNextExperimentAuthorization(response, false);
    const result = response.outcome?.result;
    const replay = response.outcome?.presentation_replay;
    if (!result || !replay || replay.perspective !== undefined) throw new Error("Missing public core output");
    await validateNextExperimentReplay(replay, result, match.matchId);
    return response;
  }

  async verifyAndExecute(match: AdmittedMatch): Promise<ExecutionOutput> {
    const response = await this.execute(match);
    return {
      snapshotDigest: match.snapshotDigest,
      resultDigest: response.outcome.presentation_replay.result_digest,
      result: response.outcome.result,
      publicReplay: response.outcome.presentation_replay,
    };
  }

  async verifyResult(match: AdmittedMatch, execution: ExecutionOutput): Promise<void> {
    if (execution.resultDigest !== execution.publicReplay.result_digest) throw new Error("Result digest mismatch");
    await validateNextExperimentReplay(execution.publicReplay, execution.result, match.matchId);
  }

  async verifyPublicReplay(match: AdmittedMatch, execution: ExecutionOutput): Promise<void> {
    const reproduced = await this.execute(match);
    if (!sameJsonResponse(reproduced.outcome.result, execution.result) ||
        !sameJsonResponse(reproduced.outcome.presentation_replay, execution.publicReplay)) {
      throw new Error("Stored result or public replay differs from the reproduced core output");
    }
  }
}
