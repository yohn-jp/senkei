import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  battlefieldTerrainTileSize,
  createBattlefieldTerrainMaterial,
} from "./battlefield-terrain-materials";

describe("battlefield surface materials", () => {
  it("keeps fine grain subordinate to broad material color regions", () => {
    const material = createBattlefieldTerrainMaterial("meadow");
    const pixels = (material.map as THREE.DataTexture).image.data as Uint8Array;
    let adjacentDifference = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 127; x++) {
      adjacentDifference += Math.abs(pixels[(y * 128 + x) * 4] - pixels[(y * 128 + x + 1) * 4]);
    }
    expect(adjacentDifference / (128 * 127)).toBeLessThan(0.8);
    expect(material.flatShading).toBe(true);
    expect(material.roughness).toBeGreaterThanOrEqual(0.9);
    expect(material.metalness).toBe(0);
    material.dispose();
  });

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
