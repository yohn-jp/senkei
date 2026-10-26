import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import { Battlefield } from "./index";

describe("Battlefield health bar layout", () => {
  it("preserves the previously applied display offset before the next layout delta", () => {
    // Test the real updater without creating a WebGL renderer.
    const renderer = Object.create(Battlefield.prototype) as Battlefield;
    const updater = renderer as unknown as {
      updateHealthBar(group: THREE.Group, entity: DisplayEntity): void;
    };
    const group = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    fill.name = "health-bar-fill";
    group.add(fill);
    group.userData.displayOffset = { x: 0.5, y: 0 };

    const entity = {
      id: "hero", kind: "unit", side: "azure", hp: 50, maxHp: 100,
    } as DisplayEntity;
    updater.updateHealthBar(group, entity);
    expect(fill.position.x).toBeCloseTo(-0.42 * 0.5 + 0.5);

    // The render loop applies the delta, not an absolute child transform.
    fill.position.x += 0.75 - 0.5;
    expect(fill.position.x).toBeCloseTo(-0.42 * 0.5 + 0.75);

    // A later tick with the same layout offset must keep that same position.
    group.userData.displayOffset = { x: 0.75, y: 0 };
    updater.updateHealthBar(group, entity);
    expect(fill.position.x).toBeCloseTo(-0.42 * 0.5 + 0.75);
  });
});
