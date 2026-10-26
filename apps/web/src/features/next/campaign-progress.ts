import type { MatchContext, MatchResult } from "../../contracts/core-model";

export const CAMPAIGN_PROGRESS_PREFIX = "senkei.next-campaign-progress.v2";
export const LEGACY_CAMPAIGN_PROGRESS_PREFIX = "senkei.next-campaign-progress.v1";
/** A persistence safety bound, not a limit on battles or campaign attempts. */
export const CAMPAIGN_PROGRESS_MAX_BYTES = 64 * 1024;

export interface CampaignProgress {
  readonly format_version: 2;
  readonly ruleset_digest: string;
  readonly unlocked_scenario_ids: readonly string[];
  /** Only wins actually recorded by this completion-aware format. */
  readonly completed_scenario_ids: readonly string[];
  readonly history_incomplete: boolean;
}

export interface CampaignRunResult {
  /** From the completed Run's frozen setup, never the current UI selection. */
  readonly scenario_id: string | null;
  readonly context: Pick<MatchContext, "match_id" | "ruleset">;
  readonly result: MatchResult;
}

export type CampaignScenarioStatus = "locked" | "completed" | "uncompleted" | "completion_unknown";

function checkCatalog(digest: string, ids: readonly string[]): void {
  if (!digest || ids.length === 0 || ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error("Campaign progress requires a digest and a nonempty unique scenario catalog.");
  }
}

function checkSize(raw: string): void {
  if (new TextEncoder().encode(raw).byteLength > CAMPAIGN_PROGRESS_MAX_BYTES) {
    throw new Error("Campaign progress exceeds the 64 KiB storage safety limit; original bytes must be preserved.");
  }
}

function record(raw: string, digest: string, ids: readonly string[], version: number): Record<string, unknown> {
  checkCatalog(digest, ids);
  checkSize(raw);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Campaign progress is malformed.");
  const item = value as Record<string, unknown>;
  if (item.format_version !== version || item.ruleset_digest !== digest) {
    throw new Error("Campaign progress format or Ruleset digest does not match; preserve the original bytes.");
  }
  return item;
}

function idList(value: unknown, ids: readonly string[], legacy = false): readonly string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !ids.includes(id)) ||
      (!legacy && new Set(value).size !== value.length)) {
    throw new Error("Campaign progress contains malformed, duplicate or unavailable scenario IDs.");
  }
  return ids.filter(id => value.includes(id));
}

export function createCampaignProgress(digest: string, ids: readonly string[]): CampaignProgress {
  checkCatalog(digest, ids);
  return { format_version: 2, ruleset_digest: digest, unlocked_scenario_ids: [ids[0]], completed_scenario_ids: [], history_incomplete: false };
}

/** Invalid existing bytes throw; callers must not treat them as a fresh save. */
export function parseCampaignProgress(raw: string, digest: string, ids: readonly string[]): CampaignProgress {
  const value = record(raw, digest, ids, 2);
  const keys = ["format_version", "ruleset_digest", "unlocked_scenario_ids", "completed_scenario_ids", "history_incomplete"];
  if (Object.keys(value).some(key => !keys.includes(key)) || typeof value.history_incomplete !== "boolean") {
    throw new Error("Campaign progress has an unsupported or malformed completion format.");
  }
  const unlocked = idList(value.unlocked_scenario_ids, ids);
  const completed = idList(value.completed_scenario_ids, ids);
  if (!unlocked.includes(ids[0]) || completed.some(id => !unlocked.includes(id))) {
    throw new Error("Campaign progress completion and unlock records are inconsistent.");
  }
  return { format_version: 2, ruleset_digest: digest, unlocked_scenario_ids: unlocked, completed_scenario_ids: completed, history_incomplete: value.history_incomplete };
}

/** Pure migration. Save under the v2 key; never remove or rewrite the v1 source. */
export function migrateLegacyCampaignProgress(raw: string, digest: string, ids: readonly string[]): CampaignProgress {
  const value = record(raw, digest, ids, 1);
  const unlocked = idList(value.unlocked_scenario_ids, ids, true);
  return {
    ...createCampaignProgress(digest, ids),
    unlocked_scenario_ids: ids.filter(id => id === ids[0] || unlocked.includes(id)),
    history_incomplete: true,
  };
}

export function serializeCampaignProgress(progress: CampaignProgress, ids: readonly string[]): string {
  const raw = JSON.stringify(progress);
  checkSize(raw);
  return JSON.stringify(parseCampaignProgress(raw, progress.ruleset_digest, ids));
}

/** Call only for an actual completed Enbu response paired with its frozen Run. */
export function reduceCampaignProgress(progress: CampaignProgress, ids: readonly string[], run: CampaignRunResult): CampaignProgress {
  checkCatalog(progress.ruleset_digest, ids);
  const index = run.scenario_id === null ? -1 : ids.indexOf(run.scenario_id);
  if (index < 0 || !progress.unlocked_scenario_ids.includes(ids[index]) ||
      run.context.ruleset.digest !== progress.ruleset_digest || !run.context.match_id ||
      run.result.match_id !== run.context.match_id || run.result.outcome !== "attacker_victory" ||
      run.result.termination_reason !== "base_destroyed") return progress;
  const completed = new Set([...progress.completed_scenario_ids, ids[index]]);
  const unlocked = new Set([...progress.unlocked_scenario_ids, ids[index]]);
  if (ids[index + 1]) unlocked.add(ids[index + 1]);
  if (completed.size === progress.completed_scenario_ids.length && unlocked.size === progress.unlocked_scenario_ids.length) return progress;
  return { ...progress, completed_scenario_ids: ids.filter(id => completed.has(id)), unlocked_scenario_ids: ids.filter(id => unlocked.has(id)) };
}

export function campaignScenarioStatus(progress: CampaignProgress, id: string): CampaignScenarioStatus {
  if (!progress.unlocked_scenario_ids.includes(id)) return "locked";
  if (progress.completed_scenario_ids.includes(id)) return "completed";
  return progress.history_incomplete ? "completion_unknown" : "uncompleted";
}

export function campaignCompletionSummary(progress: CampaignProgress, ids: readonly string[]) {
  checkCatalog(progress.ruleset_digest, ids);
  return {
    finalScenarioCompleted: progress.completed_scenario_ids.includes(ids[ids.length - 1]),
    allRecordedComplete: ids.every(id => progress.completed_scenario_ids.includes(id)),
  };
}
