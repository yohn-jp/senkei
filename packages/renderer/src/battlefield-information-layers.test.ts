import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { BattlefieldFog } from "./battlefield-fog";
import { applyBattlefieldInformationLayers } from "./battlefield-information-layers";

describe("battlefield information layer controls", () => {
  it("toggles vision, lane guides and engagements independently", () => {
    const fog = { setEnabled: vi.fn() } as unknown as BattlefieldFog;
    const laneGuides = new THREE.Group();
    const effects = new THREE.Group();
    const label = (): HTMLElement => ({ style: { visibility: "visible" } }) as HTMLElement;
    const laneLabel = label(), entityLabel = label(), cueLabel = label();
    const targets = {
      fog,
      laneGuides,
      effects,
      laneLabels: [laneLabel],
      entityLabels: [entityLabel],
      engagementLabels: [cueLabel],
    };

    applyBattlefieldInformationLayers({ vision: true, lanes: false, engagements: true }, targets);
    expect(fog.setEnabled).toHaveBeenLastCalledWith(true);
    expect(laneGuides.visible).toBe(false);
    expect(laneLabel.style.visibility).toBe("hidden");
    expect(effects.visible).toBe(true);
    expect(entityLabel.style.visibility).toBe("visible");
    expect(cueLabel.style.visibility).toBe("visible");

    applyBattlefieldInformationLayers({ vision: false, lanes: true, engagements: false }, targets);
    expect(fog.setEnabled).toHaveBeenLastCalledWith(false);
    expect(laneGuides.visible).toBe(true);
    expect(laneLabel.style.visibility).toBe("visible");
    expect(effects.visible).toBe(false);
    expect(entityLabel.style.visibility).toBe("hidden");
    expect(cueLabel.style.visibility).toBe("hidden");
  });
});
