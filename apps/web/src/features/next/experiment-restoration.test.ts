import { describe, expect, it } from "vitest";
import type { MatchResult, PresentationReplay, SimulationResponse, SimulationSnapshot } from "../../contracts";
import { reproductionSnapshotDigest, validateNextExperimentDiagnostics, validateNextExperimentReplay, validateNextExperimentReproduction } from "./experiment-restoration";

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

const diagnosticsSnapshot = (): SimulationSnapshot => ({
  attacker: { program: { content_digest: "attacker-program" }, configuration: { "2": "two", "10": "ten" }, "\uE000": "bmp-key", "\u{10000}": "supplementary-key" },
  context: { match_id: "match-a", world_identity: { world_id: "world" } },
  defender: { program: { content_digest: "defender-program" } },
} as unknown as SimulationSnapshot);

function compareScalars(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareScalars).map((key) => `${JSON.stringify(key)}:${canonicalForTest(record[key])}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const result = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function responseWithDiagnostics(snapshot: SimulationSnapshot): Promise<SimulationResponse> {
  const snapshotValue = { attacker: snapshot.attacker, context: snapshot.context, defender: snapshot.defender };
  return {
    authorized_side: "attacker",
    outcome: { result, presentation_replay: replay },
    restricted_diagnostics: {
      identity: {
        schema_version: 1,
        side: "attacker",
        match_id: "match-a",
        result_digest: replay.result_digest,
        snapshot_digest: await sha256(canonicalForTest(snapshotValue)),
        program_digest: "attacker-program",
      },
      events: [], cu_by_side: { attacker: 1, defender: 0 }, final_memory_by_side: { attacker: {}, defender: {} },
    },
  };
}

async function responseForReproduction(snapshot: SimulationSnapshot, includeDiagnostics: boolean): Promise<SimulationResponse> {
  const publicReplay = { ...replay, perspective: undefined };
  if (!includeDiagnostics) return { outcome: { result, presentation_replay: publicReplay } };
  const source = await responseWithDiagnostics(snapshot);
  const diagnostics = source.restricted_diagnostics!;
  return {
    ...source,
    outcome: { result, presentation_replay: publicReplay },
    owner_replay: replay,
    owner_replays: { attacker: replay },
    restricted_diagnostics: {
      ...diagnostics,
      cu_by_side: { attacker: diagnostics.cu_by_side.attacker },
      final_memory_by_side: { attacker: diagnostics.final_memory_by_side.attacker },
    } as SimulationResponse["restricted_diagnostics"],
  };
}

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

describe("Next experiment diagnostics lineage", () => {
  it("uses the Rust serde_json canonical snapshot digest, including Unicode scalar key ordering", async () => {
    const snapshot = diagnosticsSnapshot();
    const digest = await reproductionSnapshotDigest(snapshot);
    const independentlyCanonicalized = await sha256(canonicalForTest({
      attacker: snapshot.attacker,
      context: snapshot.context,
      defender: snapshot.defender,
    }));
    expect(digest).toBe(independentlyCanonicalized);
    expect(digest).toBe((await responseWithDiagnostics(snapshot)).restricted_diagnostics?.identity.snapshot_digest);

    const reordered = {
      defender: snapshot.defender,
      context: snapshot.context,
      attacker: { "\u{10000}": "supplementary-key", program: { content_digest: "attacker-program" }, configuration: { "10": "ten", "2": "two" }, "\uE000": "bmp-key" },
    } as unknown as SimulationSnapshot;
    expect(await reproductionSnapshotDigest(reordered)).toBe(digest);
  });

  it("accepts the exact authorized Run using serde-compatible Unicode scalar key order", async () => {
    const snapshot = diagnosticsSnapshot();
    const response = await responseWithDiagnostics(snapshot);
    await expect(validateNextExperimentDiagnostics(response, snapshot)).resolves.toBeUndefined();
    const reordered = {
      defender: snapshot.defender,
      context: snapshot.context,
      attacker: { "\u{10000}": "supplementary-key", program: { content_digest: "attacker-program" }, configuration: { "10": "ten", "2": "two" }, "\uE000": "bmp-key" },
    } as unknown as SimulationSnapshot;
    await expect(validateNextExperimentDiagnostics(response, reordered)).resolves.toBeUndefined();
  });

  it("rejects an identity from another Run, Program, side, or public result", async () => {
    const snapshot = diagnosticsSnapshot();
    const response = await responseWithDiagnostics(snapshot);
    const diagnostics = response.restricted_diagnostics!;
    const sideMismatch = { ...response, restricted_diagnostics: { ...diagnostics, identity: { ...diagnostics.identity, side: "defender" as const } } };
    await expect(validateNextExperimentDiagnostics(sideMismatch, snapshot)).rejects.toThrow(/side does not match/);
    const programMismatch = { ...response, restricted_diagnostics: { ...diagnostics, identity: { ...diagnostics.identity, program_digest: "other-program" } } };
    await expect(validateNextExperimentDiagnostics(programMismatch, snapshot)).rejects.toThrow(/Program digest/);
    const otherRun = { ...snapshot, context: { ...snapshot.context, match_id: "match-b" } } as SimulationSnapshot;
    await expect(validateNextExperimentDiagnostics(response, otherRun)).rejects.toThrow(/snapshot digest/);
    const resultMismatch = { ...response, restricted_diagnostics: { ...diagnostics, identity: { ...diagnostics.identity, result_digest: "other-result" } } };
    await expect(validateNextExperimentDiagnostics(resultMismatch, snapshot)).rejects.toThrow(/result digest/);
    const replayMismatch = { ...response, outcome: { ...response.outcome, presentation_replay: { ...replay, match_id: "match-b" } } };
    await expect(validateNextExperimentDiagnostics(replayMismatch, snapshot)).rejects.toThrow(/immutable Run and public replay/);
  });

  it("rejects legacy owner diagnostics without identity", async () => {
    const snapshot = diagnosticsSnapshot();
    const response = await responseWithDiagnostics(snapshot);
    const legacy = { ...response, restricted_diagnostics: { events: [], cu_by_side: {}, final_memory_by_side: {} } } as unknown as SimulationResponse;
    await expect(validateNextExperimentDiagnostics(legacy, snapshot)).rejects.toThrow(/no Run identity/);
  });
});

describe("Next experiment reproduction comparison", () => {
  it("accepts identical same-runtime result, public replay, and authorized projections", async () => {
    const snapshot = diagnosticsSnapshot();
    const publicResponse = await responseForReproduction(snapshot, false);
    await expect(validateNextExperimentReproduction(publicResponse, publicResponse, snapshot, false)).resolves.toBeUndefined();

    const localResponse = await responseForReproduction(snapshot, true);
    await expect(validateNextExperimentReproduction(localResponse, localResponse, snapshot, true)).resolves.toBeUndefined();
  });

  it("rejects a changed public replay frame or owner diagnostics after verifying each Run identity", async () => {
    const snapshot = diagnosticsSnapshot();
    const publicResponse = await responseForReproduction(snapshot, false);
    const changedReplay = { ...publicResponse.outcome.presentation_replay, frames: [{ tick: 1, events: [], visible_state: null }] };
    await expect(validateNextExperimentReproduction(
      publicResponse,
      { ...publicResponse, outcome: { ...publicResponse.outcome, presentation_replay: changedReplay } },
      snapshot,
      false,
    )).rejects.toThrow(/differs from the stored Run/);

    const localResponse = await responseForReproduction(snapshot, true);
    const changedDiagnostics = {
      ...localResponse,
      restricted_diagnostics: { ...localResponse.restricted_diagnostics!, events: [{ tick: 1, side: "attacker", diagnostic: "changed" }] },
    } as unknown as SimulationResponse;
    await expect(validateNextExperimentReproduction(localResponse, changedDiagnostics, snapshot, true))
      .rejects.toThrow(/differs from the stored Run/);
  });
});

it("requires intact owner and diagnostic channels on persisted authorized experiments", async () => {
  const { validateNextExperimentAuthorization } = await import("./experiment-restoration");
  const response = {
    authorized_side: "attacker" as const,
    outcome: { result, presentation_replay: { ...replay, perspective: undefined } },
    owner_replays: { attacker: replay },
    restricted_diagnostics: { identity: { side: "attacker" }, events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } },
  } as unknown as import("../../contracts").SimulationResponse;
  expect(() => validateNextExperimentAuthorization(response, true)).not.toThrow();
  expect(() => validateNextExperimentAuthorization({ ...response, owner_replays: {} }, true)).toThrow(/owner replay/);
  expect(() => validateNextExperimentAuthorization({ ...response, restricted_diagnostics: undefined }, true)).toThrow(/diagnostic events/);
  expect(() => validateNextExperimentAuthorization(response, false)).toThrow(/restricted channel/);
  expect(() => validateNextExperimentAuthorization({ outcome: response.outcome }, false)).not.toThrow();
});
