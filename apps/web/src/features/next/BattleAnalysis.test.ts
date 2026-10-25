import { describe, expect, it } from "vitest";
import type { BattleAnalysisRun } from "./BattleAnalysis";
import { attributeOwnHeroes } from "./BattleAnalysis";
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
