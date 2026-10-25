import { describe, expect, it } from "vitest";
import type { DisplayEntity } from "@senkei/replay-contract";
import { battlefieldModelGeometrySignature } from "./battlefield-model-signature";

function entity(overrides: Partial<DisplayEntity>): DisplayEntity {
  return {
    id: "entity",
    side: "azure",
    kind: "unit",
    archetype: "hero",
    appearanceKey: "senkei.next.hero.f01",
    catalogId: "F01",
    position: { x: 0, y: 0 },
    hp: 100,
    maxHp: 100,
    destroyed: false,
    ...overrides,
  } as DisplayEntity;
}

describe("battlefield model geometry signature", () => {
  it("does not rebuild an unchanged unit model when HP or max HP updates", () => {
    expect(battlefieldModelGeometrySignature(entity({ hp: 61 }), true))
      .toBe(battlefieldModelGeometrySignature(entity({ hp: 100, maxHp: 120 }), true));
  });

  it("rebuilds towers only when their visible damage stage changes", () => {
    const intact = entity({ kind: "tower", archetype: "watchtower", hp: 80 });
    const alsoIntact = entity({ kind: "tower", archetype: "watchtower", hp: 72 });
    const damaged = entity({ kind: "tower", archetype: "watchtower", hp: 65 });
    expect(battlefieldModelGeometrySignature(intact, true)).toBe(battlefieldModelGeometrySignature(alsoIntact, true));
    expect(battlefieldModelGeometrySignature(intact, true)).not.toBe(battlefieldModelGeometrySignature(damaged, true));
  });
});
