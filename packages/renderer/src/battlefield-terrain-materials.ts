import * as THREE from "three";

export type BattlefieldTerrainMaterialKind =
  | "meadow"
  | "forest-floor"
  | "packed-earth"
  | "road-stone"
  | "river-gravel"
  | "rock";

export interface BattlefieldTerrainMaterialOptions {
  readonly color?: THREE.ColorRepresentation;
  readonly roughness?: number;
  readonly vertexColors?: boolean;
  readonly side?: THREE.Side;
}

const textureSize = 128;
const tileWorldSizes: Record<BattlefieldTerrainMaterialKind, number> = {
  meadow: 5.6,
  "forest-floor": 3.8,
  "packed-earth": 2.9,
  "road-stone": 2.2,
  "river-gravel": 2.5,
  rock: 1.6,
};

function hash(x: number, y: number, seed: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 41.73) * 43758.5453;
  return value - Math.floor(value);
}

function periodicNoise(x: number, y: number, cells: number, seed: number): number {
  const px = (x / textureSize) * cells;
  const py = (y / textureSize) * cells;
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % cells) + cells) % cells, x1 = (x0 + 1) % cells;
  const y0 = ((iy % cells) + cells) % cells, y1 = (y0 + 1) % cells;
  const top = THREE.MathUtils.lerp(hash(x0, y0, seed), hash(x1, y0, seed), sx);
  const bottom = THREE.MathUtils.lerp(hash(x0, y1, seed), hash(x1, y1, seed), sx);
  return THREE.MathUtils.lerp(top, bottom, sy);
}

function texturePalette(kind: BattlefieldTerrainMaterialKind): readonly [number, number, number] {
  switch (kind) {
    case "meadow": return [211, 215, 187];
    case "forest-floor": return [202, 205, 171];
    case "packed-earth": return [211, 200, 176];
    case "road-stone": return [211, 211, 201];
    case "river-gravel": return [207, 204, 187];
    case "rock": return [204, 208, 204];
  }
}

function createTerrainTexture(kind: BattlefieldTerrainMaterialKind): THREE.DataTexture {
  const pixels = new Uint8Array(textureSize * textureSize * 4);
  const palette = texturePalette(kind);
  const seed = Object.keys(tileWorldSizes).indexOf(kind) + 5;

  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      // Broad flecks repeat in irregular cells while a restrained fine grain
      // stays legible after mipmapping. The tint remains neutral enough for
      // Replay-derived vertex colors to set the actual terrain regions.
      const cell = periodicNoise(x, y, 16, seed) - 0.5;
      const grain = periodicNoise(x, y, 32, seed + 31) - 0.5;
      const chip = periodicNoise(x, y, 32, seed + 67);
      const amount = 1 + cell * 0.17 + grain * 0.105 + (chip - 0.5) * 0.035;

      const offset = (y * textureSize + x) * 4;
      pixels[offset] = Math.max(0, Math.min(255, palette[0] * amount));
      pixels[offset + 1] = Math.max(0, Math.min(255, palette[1] * amount));
      pixels[offset + 2] = Math.max(0, Math.min(255, palette[2] * amount));
      pixels[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(pixels, textureSize, textureSize, THREE.RGBAFormat);
  texture.name = `battlefield-${kind}-microtexture`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function battlefieldTerrainTileSize(kind: BattlefieldTerrainMaterialKind): number {
  return tileWorldSizes[kind];
}

/**
 * A small deterministic, tileable material for actual battlefield meshes.
 * Color and vertex color carry the broad region palette; this map contributes
 * restrained earth, grass, or stone grain at close range.
 */
export function createBattlefieldTerrainMaterial(
  kind: BattlefieldTerrainMaterialKind,
  options: BattlefieldTerrainMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const map = createTerrainTexture(kind);
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    map,
    vertexColors: options.vertexColors ?? false,
    roughness: options.roughness ?? 0.96,
    metalness: 0,
    flatShading: true,
    side: options.side ?? THREE.FrontSide,
  });
  // Three.js material disposal does not own or dispose its textures.
  material.addEventListener("dispose", () => map.dispose());
  return material;
}
