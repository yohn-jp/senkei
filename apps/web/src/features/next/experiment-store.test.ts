import { describe, expect, it } from "vitest";
import { parseNextExperimentStore } from "../persistence/repository";

function countJsonValues(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((sum, item) => sum + countJsonValues(item), 0);
  if (typeof value === "object" && value !== null) {
    return 1 + Object.values(value).reduce((sum, item) => sum + countJsonValues(item), 0);
  }
  return 1;
}

function experiment(id: string, paddingValues: number) {
  return {
    id,
    match_id: `match-${id}`,
    created_at: "2026-10-25T00:00:00.000Z",
    snapshot: { context: { match_id: `match-${id}` } },
    response: {},
    setup: { padding: Array<null>(paddingValues).fill(null) },
    include_diagnostics: true,
    estimated_cu: 1,
  };
}

describe("Next experiment store bounds", () => {
  it("accepts two individually bounded complete records when their aggregate exceeds the single-export node cap", () => {
    const first = experiment("latest", 2_050_000);
    const second = experiment("baseline", 2_050_000);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [first, second] };
    expect(countJsonValues(first)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(second)).toBeLessThanOrEqual(4_000_000);
    expect(countJsonValues(store)).toBeGreaterThan(4_000_000);
    expect(parseNextExperimentStore(store).experiments).toHaveLength(2);
  });

  it("still rejects any one experiment that exceeds the 4M per-record cap", () => {
    const oversized = experiment("oversized", 4_000_010);
    const store = { format_version: 1 as const, ruleset_digest: "ruleset-digest", experiments: [oversized] };
    expect(() => parseNextExperimentStore(store)).toThrow(/Next experiment 1 has too many JSON values/);
  });
});
