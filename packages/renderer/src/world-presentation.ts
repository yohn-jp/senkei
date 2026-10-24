import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";
import { buildBattlefieldTerrain } from "./battlefield-terrain";

/** Real-match world presentation. All traversable topology comes from Replay. */
export function buildWorldPresentation(scene: THREE.Scene, replay: Replay): void {
  buildBattlefieldTerrain(scene, replay);
}

export function buildWorldCamp(
  parent: THREE.Group,
  position: WorldPoint,
  campId: string,
  replay: Replay,
): void {
  const scale = replay.scene.routes?.length ? 1.22 : 1;
  const campAccent = campId.includes("center")
    ? 0x8eb9a6
    : campId.includes("se")
      ? 0xc98968
      : 0xc2a36b;
  const stone = new THREE.MeshStandardMaterial({
    color: 0x696852,
    roughness: 1,
    flatShading: true,
  });
  const clearing = new THREE.MeshStandardMaterial({
    color: 0x999171,
    roughness: 1,
    flatShading: true,
  });
  const camp = new THREE.Group();
  camp.position.set(position.x, 0, position.y);
  camp.name = `jungle-camp-${campId}`;

  // A flush, irregular earth clearing reads as part of the terrain rather than
  // as a miniature display plinth. Its location is the Replay's actual camp.
  const clearingMesh = new THREE.Mesh(
    new THREE.CircleGeometry(2.85 * scale, 9),
    clearing,
  );
  clearingMesh.rotation.x = -Math.PI / 2;
  clearingMesh.position.y = -0.024;
  clearingMesh.receiveShadow = true;
  camp.add(clearingMesh);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.45 * scale, 0.065, 4, 12),
    new THREE.MeshStandardMaterial({
      color: campAccent,
      roughness: 1,
      flatShading: true,
      emissive: campAccent,
      emissiveIntensity: 0.06,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.015;
  camp.add(ring);

  // Seven low, uneven stones leave broad gaps around the real clearing. They
  // are purely scenic and carry no movement or visibility meaning.
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.13;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.44, 0), stone);
    rock.position.set(
      Math.cos(angle) * 2.67 * scale,
      0.19 + (i % 3) * 0.035,
      Math.sin(angle) * 2.67 * scale,
    );
    rock.scale.set(1.15 + (i % 2) * 0.26, 0.74 + (i % 3) * 0.12, 0.88);
    rock.rotation.set(0.08 * (i % 2), angle * 0.55, 0.11 * (i % 3));
    rock.castShadow = true;
    rock.receiveShadow = true;
    camp.add(rock);
  }

  // A weathered waystone makes the clearing legible without inventing a
  // monster, reward or other state absent from the public Replay.
  const waystone = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.48, 0),
    new THREE.MeshStandardMaterial({
      color: 0x6c766b,
      roughness: 0.88,
      flatShading: true,
    }),
  );
  waystone.position.set(0, 0.39, 0);
  waystone.scale.set(0.68, 1.16, 0.62);
  waystone.rotation.y = 0.42;
  waystone.castShadow = true;
  camp.add(waystone);

  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18, 0),
    new THREE.MeshStandardMaterial({
      color: campAccent,
      roughness: 0.55,
      emissive: campAccent,
      emissiveIntensity: 0.28,
      flatShading: true,
    }),
  );
  marker.position.set(0, 1.02, 0);
  camp.add(marker);
  parent.add(camp);
}
