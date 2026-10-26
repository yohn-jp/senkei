import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import { buildBattlefieldHero } from "./battlefield-units";

// Hash actual generated buffers and hierarchy, rather than trusting manifest labels.
function fingerprint(root: THREE.Object3D): string {
  const hash = createHash("sha256");
  root.traverse(object => {
    hash.update(JSON.stringify([object.name, object.position.toArray(), object.rotation.toArray(), object.scale.toArray()]));
    if (!(object instanceof THREE.Mesh)) return;
    for (const name of Object.keys(object.geometry.attributes).sort()) {
      const attribute = object.geometry.getAttribute(name) as THREE.BufferAttribute;
      hash.update(name);
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    const index = object.geometry.index;
    if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength));
  });
  return hash.digest("hex");
}

function generate(id: string) {
  const entity: DisplayEntity = {
    id: `audit:${id}`, side: "azure", kind: "unit", archetype: "hero",
    catalogId: id.toUpperCase(), appearanceKey: `senkei.next.hero.${id}`,
    position: { x: 17, y: 23 }, hp: 100, maxHp: 100, destroyed: false,
  };
  const before = structuredClone(entity);
  const root = new THREE.Group();
  buildBattlefieldHero(root, entity, 0x347e83, entity.appearanceKey!);
  expect(entity).toEqual(before);
  return root;
}

describe("appearance regeneration independent of Replay", () => {
  it("recreates every existing identity buffer-for-buffer despite intervening generation", () => {
    const ids = ["f01", "f02", "f03", "f04", "f05", "f06", "r01", "r02", "r03", "r04", "r05", "r06"];
    const originals = ids.map(id => generate(id));
    for (const [index, id] of ids.entries()) {
      const regenerated = generate(id);
      expect(fingerprint(regenerated), id).toBe(fingerprint(originals[index]));
      expect(regenerated.userData.assetManifest).toEqual(originals[index].userData.assetManifest);
    }
  });
});
