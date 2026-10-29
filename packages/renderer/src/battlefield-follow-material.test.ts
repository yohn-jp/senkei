import * as THREE from "three";
import { expect, it } from "vitest";
import { cloneBattlefieldFollowMaterial } from "./battlefield-units";

it("preserves baked LOD shader and cache identity on Follow opacity clones", () => {
  const source = new THREE.MeshStandardMaterial({ vertexColors: true });
  source.onBeforeCompile = shader => { shader.fragmentShader += "\n// per-vertex surface response"; };
  source.customProgramCacheKey = () => "senkei.surface-response.test";
  const copy = cloneBattlefieldFollowMaterial(source);
  expect(copy).not.toBe(source);
  expect(copy.onBeforeCompile).toBe(source.onBeforeCompile);
  expect(copy.customProgramCacheKey()).toBe("senkei.surface-response.test");
  copy.opacity = 0.27;
  copy.transparent = true;
  expect(source.opacity).toBe(1);
  expect(source.transparent).toBe(false);
  copy.dispose();
  source.dispose();
});
