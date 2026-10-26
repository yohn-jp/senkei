import { describe, expect, it } from "vitest";
import type { MatchContext, MatchResult } from "../../contracts/core-model";
import {
  CAMPAIGN_PROGRESS_PREFIX, LEGACY_CAMPAIGN_PROGRESS_PREFIX, CAMPAIGN_PROGRESS_MAX_BYTES,
  createCampaignProgress, parseCampaignProgress, migrateLegacyCampaignProgress,
  serializeCampaignProgress, mergeCampaignProgress, reduceCampaignProgress, campaignScenarioStatus, campaignCompletionSummary,
} from "./campaign-progress";

const ids = ["first", "second", "final"];
const digest = "rules-a";
const legacyRaw = JSON.stringify({ format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: ids });
const context: Pick<MatchContext, "match_id" | "ruleset"> = {
  match_id: "real-match-input", ruleset: { id: "senkei.next", digest, version: { major: 2, minor: 0, patch: 0 } },
};
const result: MatchResult = {
  match_id: context.match_id, outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 45,
  statistics: {}, cu_spent: { attacker: 0, defender: 0 }, final_state_digest: "resolved-state",
};
const win = (scenario_id: string | null = "first") => ({ scenario_id, context, result });

describe("campaign progress versioned storage", () => {
  it("starts with only the existing first unlock and no claimed completions", () => {
    const progress = createCampaignProgress(digest, ids);
    expect(progress).toEqual({ format_version: 2, ruleset_digest: digest, unlocked_scenario_ids: ["first"], completed_scenario_ids: [], history_incomplete: false });
    expect(campaignScenarioStatus(progress, "first")).toBe("uncompleted");
    expect(campaignScenarioStatus(progress, "second")).toBe("locked");
  });

  it("migrates v1 unlocks without inventing clears or overwriting its original key/raw", () => {
    const original = legacyRaw;
    const progress = migrateLegacyCampaignProgress(legacyRaw, digest, ids);
    expect(CAMPAIGN_PROGRESS_PREFIX).not.toBe(LEGACY_CAMPAIGN_PROGRESS_PREFIX);
    expect(LEGACY_CAMPAIGN_PROGRESS_PREFIX).toBe("senkei.next-campaign-progress.v1");
    expect(progress.unlocked_scenario_ids).toEqual(ids);
    expect(progress.completed_scenario_ids).toEqual([]);
    expect(progress.history_incomplete).toBe(true);
    expect(campaignScenarioStatus(progress, "final")).toBe("completion_unknown");
    expect(legacyRaw).toBe(original);
    expect(parseCampaignProgress(serializeCampaignProgress(progress, ids), digest, ids)).toEqual(progress);
  });

  it("merges validated stored and unsaved session history in canonical catalog order", () => {
    const stored = reduceCampaignProgress(createCampaignProgress(digest, ids), ids, win("first"));
    const session = reduceCampaignProgress(createCampaignProgress(digest, ids), ids, win("first"));
    const withFinal = { ...stored, unlocked_scenario_ids: ids, completed_scenario_ids: [...stored.completed_scenario_ids, "final"], history_incomplete: true };
    const merged = mergeCampaignProgress(withFinal, session, ids);
    expect(merged.unlocked_scenario_ids).toEqual(ids);
    expect(merged.completed_scenario_ids).toEqual(["first", "final"]);
    expect(merged.history_incomplete).toBe(true);
    expect(() => mergeCampaignProgress(stored, { ...session, ruleset_digest: "other" }, ids)).toThrow(/different Rulesets/);
  });

  it("retains the first unlock and deduplicates valid legacy IDs as the old loader did", () => {
    const raw = JSON.stringify({ format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: ["second", "second"] });
    expect(migrateLegacyCampaignProgress(raw, digest, ids).unlocked_scenario_ids).toEqual(["first", "second"]);
  });

  it("rejects malformed, unsupported, mismatched, unknown or oversized original bytes", () => {
    for (const raw of ["{", "null", "{}", JSON.stringify({ format_version: 3 }), legacyRaw.replace(digest, "other-rules"), legacyRaw.replace('"final"', '"absent"'), " ".repeat(CAMPAIGN_PROGRESS_MAX_BYTES + 1)]) {
      expect(() => migrateLegacyCampaignProgress(raw, digest, ids)).toThrow();
    }
    expect(() => parseCampaignProgress(legacyRaw, digest, ids)).toThrow();
    const valid = createCampaignProgress(digest, ids);
    for (const invalid of [
      { ...valid, history_incomplete: undefined },
      { ...valid, completed_scenario_ids: ["second"] },
      { ...valid, completed_scenario_ids: ["first", "first"] },
      { ...valid, unexpected_future_field: true },
      { ...valid, ruleset_digest: "other-rules" },
    ]) expect(() => parseCampaignProgress(JSON.stringify(invalid), digest, ids)).toThrow();
    expect(() => serializeCampaignProgress({ ...valid, ruleset_digest: "漢".repeat(CAMPAIGN_PROGRESS_MAX_BYTES) }, ids)).toThrow(/64 KiB/);
  });
});

describe("actual-result campaign reduction", () => {
  it("records a matched base-destruction victory and unlocks only its immediate successor", () => {
    const original = createCampaignProgress(digest, ids);
    const updated = reduceCampaignProgress(original, ids, win());
    expect(original.completed_scenario_ids).toEqual([]);
    expect(original.unlocked_scenario_ids).toEqual(["first"]);
    expect(updated.completed_scenario_ids).toEqual(["first"]);
    expect(updated.unlocked_scenario_ids).toEqual(["first", "second"]);
    expect(campaignScenarioStatus(updated, "first")).toBe("completed");
    expect(reduceCampaignProgress(updated, ids, win())).toBe(updated);
  });

  it("never records a clear for defeat, Draw, non-base victory, unknown or locked scenario, stale rules or wrong Match", () => {
    const original = createCampaignProgress(digest, ids);
    const runs = [
      { ...win(), result: { ...result, outcome: "draw" as const } },
      { ...win(), result: { ...result, outcome: "defender_victory" as const } },
      { ...win(), result: { ...result, outcome: "aborted" as MatchResult["outcome"] } },
      { ...win(), result: { ...result, termination_reason: "time_limit" } },
      { ...win(), result: { ...result, match_id: "another-match" } },
      { ...win(), context: { ...context, ruleset: { ...context.ruleset, digest: "stale" } } },
      win(null), win("absent"), win("final"),
    ];
    for (const run of runs) expect(reduceCampaignProgress(original, ids, run)).toBe(original);
  });

  it("distinguishes clearing the final scenario from proving all earlier legacy completions", () => {
    let progress = migrateLegacyCampaignProgress(legacyRaw, digest, ids);
    progress = reduceCampaignProgress(progress, ids, win("final"));
    expect(campaignCompletionSummary(progress, ids)).toEqual({ finalScenarioCompleted: true, allRecordedComplete: false });
    expect(campaignScenarioStatus(progress, "first")).toBe("completion_unknown");
    progress = reduceCampaignProgress(progress, ids, win("first"));
    progress = reduceCampaignProgress(progress, ids, win("second"));
    expect(campaignCompletionSummary(progress, ids)).toEqual({ finalScenarioCompleted: true, allRecordedComplete: true });
    expect(progress.unlocked_scenario_ids).toEqual(ids);
  });
});
