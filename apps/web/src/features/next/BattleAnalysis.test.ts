import { describe, expect, it } from "vitest";
import type { BattleAnalysisRun } from "./BattleAnalysis";
import { attributeOwnHeroes, BattleAnalysis } from "./BattleAnalysis";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RestrictedDiagnostics } from "../../contracts";
import type { EntityStateView } from "../../contracts/core-model";

const ownerHero: EntityStateView = {
  entity_type: "hero",
  owner: "attacker",
  fields: {
    slot_id: { kind: "string", value: "slot-1" },
    catalog_id: { kind: "string", value: "F01" },
    squad: { kind: "string", value: "front" },
    node: { kind: "string", value: "A.TOP.T2" },
    edge_to: { kind: "string", value: "" },
    edge_progress: { kind: "integer", value: 0 },
    track: { kind: "enum", value: "CENTER" },
    cross_remaining: { kind: "integer", value: 0 },
    ford_remaining: { kind: "integer", value: 0 },
    ford_active: { kind: "integer", value: 0 },
  },
};

const presentedHero = {
  id: "graphics-f01",
  side: "azure",
  kind: "unit",
  archetype: "hero",
  catalogId: "F01",
  // The World has logical A.TOP.T2 at (220,850), but its authored display
  // point is (280,120). Attribution must use graph state, not render XY.
  position: { x: 11.2, y: 4.8 },
  hp: 100,
  maxHp: 100,
  battlefield: {
    node: "A.TOP.T2",
    edgeTo: "",
    progress: 0,
    track: "CENTER",
    crossing: "none",
  },
} as const;

function runWithPresented(...entities: unknown[]): BattleAnalysisRun {
  const rosterHero = {
    slot_id: { kind: "string", value: "slot-1" },
    catalog_id: { kind: "string", value: "F01" },
    squad: { kind: "string", value: "front" },
    node: { kind: "string", value: "A.TOP.T1" },
    skill_path: { kind: "string", value: "balanced" },
  };
  return {
    snapshot: {
      attacker: { configuration: { heroes: { kind: "list", value: [{ kind: "record", value: rosterHero }] } } },
    },
    sourceReplay: {
      frames: [{ tick: 0, visible_state: { entities: { "core-f01": ownerHero } } }],
    },
    graphicsReplay: { initialView: entities, timeline: [] },
  } as unknown as BattleAnalysisRun;
}

describe("Battle Analysis owner Hero attribution", () => {
  it("matches canonical graph location when presentation coordinates differ from logical coordinates", () => {
    const attribution = attributeOwnHeroes(runWithPresented(presentedHero));
    expect(attribution.get("graphics-f01")).toMatchObject({ slot: { slot: "slot-1", catalogId: "F01", squad: "front" }, tick: 0 });
  });

  it("keeps duplicate graph matches ambiguous", () => {
    const duplicate = { ...presentedHero, id: "graphics-f01-duplicate" };
    expect(attributeOwnHeroes(runWithPresented(presentedHero, duplicate)).size).toBe(0);
  });

  it("rejects a different logical edge position even when presentation coordinates match", () => {
    const differentState = {
      ...presentedHero,
      battlefield: { ...presentedHero.battlefield, node: "A.TOP.T1" },
    };
    expect(attributeOwnHeroes(runWithPresented(differentState)).size).toBe(0);
  });
});

// Server rendering exercises the same bounded list and privacy boundary as S13.

function diagnosticMarkup(diagnostics: RestrictedDiagnostics | undefined): string {
  const run = runWithPresented();
  const complete = {
    ...run,
    response: { outcome: { result: { outcome: "draw", match_id: "diagnostics-test", final_tick: 100, cu_spent: { attacker: 1 }, final_state_digest: "digest" } }, restricted_diagnostics: diagnostics },
    graphicsReplay: { ...run.graphicsReplay, header: { view: "attacker" } },
  } as BattleAnalysisRun;
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(BattleAnalysis, { run: complete, baselineRun: null, draftChanged: false, busy: false, onReplayEvent: noop, onReplayTick: noop, onBattle: noop, onEdit: noop, onExactRematch: noop, onRevisedRematch: noop, campaignScenario: null, campaignFeedback: null }));
}

function traceEvents(count: number): RestrictedDiagnostics {
  return {
    identity: { schema_version: 1, side: "attacker", match_id: "diagnostics-test", result_digest: "digest", snapshot_digest: "snapshot", program_digest: "program" },
    events: Array.from({ length: count }, (_, sequence) => ({ tick: sequence, sequence, side: "attacker", action_id: null, entity_id: null, record: { kind: "runtime_notice", value: { code: `own-${sequence}`, details: {} } } })),
    cu_by_side: { attacker: 1, defender: 1 },
    final_memory_by_side: { attacker: {}, defender: {} },
  };
}

describe("Battle Analysis supplied diagnostics", () => {
  it("bounds the initial DOM and exposes navigation for all supplied attacker events", () => {
    const diagnostics = traceEvents(61);
    const html = diagnosticMarkup({ ...diagnostics, events: [...diagnostics.events, { ...diagnostics.events[0], side: "defender", record: { kind: "runtime_notice", value: { code: "private-defender-notice", details: {} } } }] });
    expect(html).toContain("1–24 / 61 supplied attacker events · page 1/3");
    expect(html).toContain('aria-label="Diagnostic pages"');
    expect(html).toContain("最後のTrace");
    expect(html.match(/own-\d+/g)).toHaveLength(24);
    expect(html).not.toContain("private-defender-notice");
    expect(html).not.toContain("own-24");
  });

  it("distinguishes missing diagnostics from an authorized empty attacker trace", () => {
    expect(diagnosticMarkup(undefined)).toContain("RestrictedDiagnostics were not supplied");
    const empty = diagnosticMarkup(traceEvents(0));
    expect(empty).toContain("emitted no attacker-side trace events");
    expect(empty).not.toContain('aria-label="Diagnostic pages"');
  });
});
