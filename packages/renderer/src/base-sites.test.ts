import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity, Replay } from "@senkei/replay-contract";
import { buildBattlefieldBase } from "./battlefield-architecture";
import {
  baseSiteLabelContent,
  findScreenLabelPosition,
  placeLabelOutsideProjectedBounds,
  projectedObjectRect,
  type ScreenRect,
} from "./base-sites";

const overlaps = (left: ScreenRect, right: ScreenRect) =>
  left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;

describe("known base-site label placement", () => {
  it("moves the opening-frame fortress label outside its projected building and preserves its state text", () => {
    const scene = new THREE.Scene();
    const site = {
      id: "A.BASE",
      side: "azure",
      position: { x: 2, y: 30 },
    } as NonNullable<Replay["scene"]["baseSites"]>[number];
    const base = {
      id: "base-a",
      kind: "base",
      side: "azure",
      archetype: "base",
      position: site.position,
      hp: 100,
      maxHp: 100,
      destroyed: false,
    } as unknown as DisplayEntity;
    const fortress = buildBattlefieldBase(scene, base);

    // Camera and viewport match the production T000 tactical capture.
    const camera = new THREE.OrthographicCamera(-24.729, 24.729, 11.695, -11.695, 0.1, 500);
    camera.position.set(2, 55.31, 62.668);
    camera.lookAt(2, 0.31, 30.668);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const bounds = projectedObjectRect(fortress, camera, 1440, 1000, 6);
    expect(bounds).not.toBeNull();

    const markerPoint = new THREE.Vector3(site.position.x, 0.14, site.position.y).project(camera);
    const markerX = (markerPoint.x + 1) * 1440 / 2;
    const markerY = (1 - markerPoint.y) * 1000 / 2;
    const oldPlacement = {
      left: markerX - 88,
      right: markerX + 88,
      top: markerY + 12,
      bottom: markerY + 48,
    };
    expect(overlaps(oldPlacement, bounds!)).toBe(true);

    const placement = placeLabelOutsideProjectedBounds(bounds!, 176, 36, 1440, 1000, 48, [bounds!]);
    expect(placement).not.toBeNull();
    expect(overlaps(placement!, bounds!)).toBe(false);
    expect(placement!.top).toBeGreaterThanOrEqual(36);
    expect(placement!.bottom).toBeLessThanOrEqual(952);
    const relocated = findScreenLabelPosition(
      placement!,
      [
        [0, 0], [0, -42], [0, 42], [-96, 0], [96, 0],
        [-96, -42], [96, -42], [-96, 42], [96, 42],
        [0, -84], [0, 84], [-192, 0], [192, 0],
      ],
      { left: 4, right: 1436, top: 4, bottom: 996 },
      [bounds!],
    );
    expect(relocated).toEqual(placement);
    expect(overlaps(relocated!, bounds!)).toBe(false);

    const content = baseSiteLabelContent(site, base);
    expect(content.title).toBe("AZURE FORTRESS");
    expect(content.status).toBe("Visible fortress");
    expect(`${content.title}\n${content.status}`).toContain("Visible fortress");
    fortress.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
    });
  });

  it("keeps hidden-site status distinct from a revealed fortress", () => {
    const site = {
      id: "B.BASE",
      side: "vermilion",
      position: { x: 10, y: 20 },
    } as NonNullable<Replay["scene"]["baseSites"]>[number];

    expect(baseSiteLabelContent(site, undefined)).toEqual({
      siteState: "unknown",
      status: "State unknown",
      title: "VERMILION FORTRESS SITE",
    });
  });
});
