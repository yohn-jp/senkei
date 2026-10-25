import { describe, expect, it } from "vitest";
import type { EntityStateView } from "../../contracts";
import { matchesPresentedEntity } from "./battle-entity-identity";

const record: EntityStateView = {
  entity_type: "hero",
  owner: "attacker",
  fields: {
    catalog_id: { kind: "string", value: "F01" },
    node: { kind: "string", value: "A.MID" },
    edge_to: { kind: "string", value: "A.TOP" },
    edge_progress: { kind: "integer", value: 42 },
    track: { kind: "string", value: "LEFT" },
    cross_remaining: { kind: "integer", value: 0 },
    ford_remaining: { kind: "integer", value: 0 },
    ford_active: { kind: "integer", value: 0 },
    // Logical x/y intentionally do not equal the canonical rendered position.
    x: { kind: "integer", value: 300 },
    y: { kind: "integer", value: 900 },
  },
};

const presented = {
  archetype: "hero",
  side: "azure" as const,
  catalogId: "F01",
  position: { x: 100, y: 200 },
  battlefield: { node: "A.MID", edgeTo: "A.TOP", progress: 42, track: "LEFT" as const, crossing: "none" as const },
};

describe("replay entity logical identity", () => {
  it("matches authorized same-tick graph state despite projected position differences", () => {
    expect(matchesPresentedEntity(record, presented, [{ from: "A.MID", to: "A.TOP" }])).toBe(true);
    expect(matchesPresentedEntity(record, presented)).toBe(true);
  });

  it("keeps exact-one candidate filters on owner, catalog, edge, progress, track and crossing", () => {
    const edge = [{ from: "A.MID", to: "A.TOP", bridge_site: "TOP" }];
    expect(matchesPresentedEntity(record, presented, edge)).toBe(false);
    expect(matchesPresentedEntity(record, { ...presented, battlefield: { ...presented.battlefield, crossing: "bridge" } }, edge)).toBe(true);
    expect(matchesPresentedEntity({ ...record, owner: "defender" }, presented, edge)).toBe(false);
    expect(matchesPresentedEntity(record, { ...presented, catalogId: "F03" }, edge)).toBe(false);
    expect(matchesPresentedEntity(record, { ...presented, battlefield: { ...presented.battlefield, progress: 43 } }, edge)).toBe(false);
    expect(matchesPresentedEntity(record, { ...presented, battlefield: { ...presented.battlefield, edgeTo: "A.BOT" } }, edge)).toBe(false);
  });

  it("matches bridges by authorized static site and state without requiring a lane node", () => {
    const bridge: EntityStateView = {
      entity_type: "bridge",
      owner: "defender",
      fields: {
        site: { kind: "string", value: "bridge.top" },
        bridge_state: { kind: "string", value: "expanded" },
      },
    };
    const presentedBridge = {
      archetype: "bridge",
      side: "vermilion" as const,
      battlefield: { bridgeSite: "bridge.top", bridgeState: "expanded" as const },
    };
    expect(matchesPresentedEntity(bridge, presentedBridge)).toBe(true);
    expect(matchesPresentedEntity(bridge, { ...presentedBridge, battlefield: { ...presentedBridge.battlefield, bridgeSite: "bridge.bot" } })).toBe(false);
    expect(matchesPresentedEntity(bridge, { ...presentedBridge, battlefield: { ...presentedBridge.battlefield, bridgeState: "destroyed" } })).toBe(false);
    expect(matchesPresentedEntity({ ...bridge, owner: "attacker" }, presentedBridge)).toBe(false);
  });

  it("matches observations by their authorized static node identity", () => {
    const observation: EntityStateView = {
      entity_type: "observation",
      owner: null,
      fields: { node: { kind: "string", value: "N.MID.OBS" } },
    };
    const presentedObservation = {
      archetype: "observation",
      side: "neutral" as const,
      battlefield: { node: "N.MID.OBS", captureProgress: 4 },
    };
    expect(matchesPresentedEntity(observation, presentedObservation)).toBe(true);
    expect(matchesPresentedEntity(observation, { ...presentedObservation, battlefield: { ...presentedObservation.battlefield, node: "N.TOP.OBS" } })).toBe(false);
    expect(matchesPresentedEntity({ ...observation, fields: {} }, presentedObservation)).toBe(false);
  });
});
