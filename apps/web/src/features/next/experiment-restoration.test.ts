import { describe, expect, it } from "vitest";
import type { MatchResult, PresentationReplay } from "../../contracts";
import { validateNextExperimentReplay } from "./experiment-restoration";

const result: MatchResult = {
  match_id: "match-a",
  outcome: "attacker_victory",
  termination_reason: "base_destroyed",
  final_tick: 7,
  statistics: {},
  cu_spent: { attacker: 1, defender: 2 },
  final_state_digest: "state-digest",
};

const replay: PresentationReplay = {
  schema_version: { major: 1, minor: 0, patch: 0 },
  match_id: "match-a",
  perspective: "attacker",
  result_digest: "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b",
  frames: [],
};

describe("Next experiment replay restoration identity", () => {
  it("matches the producer's SHA-256 of the serialized MatchResult, not its final-state digest", async () => {
    await expect(validateNextExperimentReplay(replay, result, "match-a")).resolves.toBeUndefined();
    expect(replay.result_digest).not.toBe(result.final_state_digest);
    await expect(validateNextExperimentReplay({ ...replay, result_digest: result.final_state_digest }, result, "match-a"))
      .rejects.toThrow("Replay result digest does not match the immutable Enbu result.");
  });

  it("reconstructs Rust struct and BTreeMap ordering for portable JSON records", async () => {
    const reordered = {
      final_state_digest: result.final_state_digest,
      cu_spent: { defender: 2, attacker: 1 },
      statistics: {
        z: { value: {
          z: { value: { scale: 1, coefficient: 3 }, kind: "fixed" },
          a: { value: 4, kind: "integer" },
        }, kind: "record" },
        a: { value: { scale: 2, coefficient: 120 }, kind: "fixed" },
      },
      final_tick: result.final_tick,
      termination_reason: result.termination_reason,
      outcome: result.outcome,
      match_id: result.match_id,
    } as MatchResult;
    const replayWithStatsDigest = {
      ...replay,
      result_digest: "a2896715a9f29849266786906bf6b9793d26b20d15c69fdead627a43f4405b80",
    };
    await expect(validateNextExperimentReplay(replayWithStatsDigest, reordered, "match-a")).resolves.toBeUndefined();
  });

  it("still rejects the wrong match or a defender-perspective replay", async () => {
    await expect(validateNextExperimentReplay(replay, result, "different-match"))
      .rejects.toThrow("Replay match identity differs from the stored Enbu result.");
    await expect(validateNextExperimentReplay({ ...replay, perspective: "defender" }, result, "match-a"))
      .rejects.toThrow("Stored replay perspective is not authorized for this attacker workspace.");
  });
});

it("requires intact owner and diagnostic channels on persisted authorized experiments", async () => {
  const { validateNextExperimentAuthorization } = await import("./experiment-restoration");
  const response = {
    authorized_side: "attacker" as const,
    outcome: { result, presentation_replay: { ...replay, perspective: undefined } },
    owner_replays: { attacker: replay },
    restricted_diagnostics: { events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
  } as unknown as import("../../contracts").SimulationResponse;
  expect(() => validateNextExperimentAuthorization(response, true)).not.toThrow();
  expect(() => validateNextExperimentAuthorization({ ...response, owner_replays: {} }, true)).toThrow(/owner replay/);
  expect(() => validateNextExperimentAuthorization({ ...response, restricted_diagnostics: undefined }, true)).toThrow(/diagnostic events/);
  expect(() => validateNextExperimentAuthorization(response, false)).toThrow(/restricted channel/);
  expect(() => validateNextExperimentAuthorization({ outcome: response.outcome }, false)).not.toThrow();
});
