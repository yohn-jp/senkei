import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  battlefieldTerrainTileSize,
  createBattlefieldTerrainMaterial,
} from "./battlefield-terrain-materials";

describe("battlefield surface materials", () => {
  it("creates stable, distinct tileable material maps with mip filtering", () => {
    const grass = createBattlefieldTerrainMaterial("meadow", { vertexColors: true });
    const soil = createBattlefieldTerrainMaterial("packed-earth");
    const grassMap = grass.map as THREE.DataTexture;
    const soilMap = soil.map as THREE.DataTexture;
    const grassPixels = grassMap.image.data as Uint8Array;

    expect(grass.vertexColors).toBe(true);
    expect(grassMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(grassMap.wrapS).toBe(THREE.RepeatWrapping);
    expect(grassMap.wrapT).toBe(THREE.RepeatWrapping);
    expect(grassMap.generateMipmaps).toBe(true);
    expect(grassMap.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(grassMap.anisotropy).toBe(4);
    expect(battlefieldTerrainTileSize("meadow")).toBeGreaterThan(battlefieldTerrainTileSize("road-stone"));
    expect(grassPixels.some((pixel, index) => index % 4 === 0 && pixel < 200)).toBe(true);
    expect(grassMap.image.data).not.toEqual(soilMap.image.data);
    const rowSize = 128 * 4;
    for (let y = 0; y < 128; y++) {
      const row = y * rowSize;
      expect(Math.abs(grassPixels[row] - grassPixels[row + rowSize - 4])).toBeLessThan(14);
    }
    grass.dispose();
    soil.dispose();
  });

  it("releases its map when the Three.js material is disposed", () => {
    const material = createBattlefieldTerrainMaterial("road-stone");
    const map = material.map as THREE.DataTexture;
    const dispose = vi.spyOn(map, "dispose");

    material.dispose();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
