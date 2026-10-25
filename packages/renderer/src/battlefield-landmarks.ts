import * as THREE from "three";
import type { DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";
import { scenicRiverCourse } from "./battlefield-geography";
import { BATTLEFIELD_RIVER_SURFACE_WIDTH, buildBattlefieldWaterDetails } from "./battlefield-water-details";
import {
  buildBattlefieldBridge,
  buildMidObservatory,
  battlefieldStructureDamageStage,
  type BattlefieldBridgeModel,
  type MidObservatoryModel,
} from "./battlefield-architecture";

function ribbon(points: readonly WorldPoint[], width: number, y: number, island?: WorldPoint, islandRadius = 0): THREE.BufferGeometry {
  const left: WorldPoint[] = [];
  const right: WorldPoint[] = [];
  const half = width / 2;
  for (let index = 0; index < points.length; index++) {
    const before = points[Math.max(0, index - 1)];
    const here = points[index];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const size = Math.hypot(dx, dy) || 1;
    const nx = -dy / size;
    const ny = dx / size;
    left.push({ x: here.x + nx * half, y: here.y + ny * half });
    right.push({ x: here.x - nx * half, y: here.y - ny * half });
  }
  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (const point of left.slice(1)) shape.lineTo(point.x, point.y);
  for (const point of right.reverse()) shape.lineTo(point.x, point.y);
  shape.closePath();
  if (island && islandRadius > 0) {
    const hole = new THREE.Path();
    hole.absarc(island.x, island.y, islandRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ShapeGeometry(shape, island && islandRadius > 0 ? 32 : 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
  });
}

/** Static geography is Replay-authored. Facility states are authorized Replay projections. */
export class BattlefieldLandmarks {
  private bridges = new Map<string, { model: BattlefieldBridgeModel; site: string }>();
  private observation?: MidObservatoryModel;
  private water?: THREE.Mesh;
  private waterDetails?: THREE.Group;

  constructor(private scene: THREE.Scene, replay: Replay) {
    const river = scenicRiverCourse(replay);
    if (river && river.length >= 2) {
      const observationPosition = replay.scene.nodes?.find((node) => node.id === "N.MID.OBS")?.position;
      const water = new THREE.Mesh(
        // Keep the river mesh off the paved observatory center. The larger
        // public island foundation continues the dry bank around this hole.
        ribbon(river, BATTLEFIELD_RIVER_SURFACE_WIDTH, 0.072, observationPosition, 2.0),
        new THREE.MeshStandardMaterial({
          color: 0x326d78,
          roughness: 0.34,
          metalness: 0.08,
          flatShading: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      water.name = "canonical-river-from-fixed-crossings";
      water.receiveShadow = true;
      scene.add(water);
      this.water = water;
      this.waterDetails = buildBattlefieldWaterDetails(scene, replay);
    }

    const observationNode = replay.scene.nodes?.find((node) => node.id === "N.MID.OBS");
    for (const route of replay.scene.routes ?? []) {
      if (!route.bridgeSite) continue;
      const model = buildBattlefieldBridge(scene, route, replay.scene.trackOffset ?? 0.8, observationNode?.position);
      this.bridges.set(route.id, { model, site: route.bridgeSite });
    }

    for (const node of replay.scene.nodes ?? []) {
      const plaza = new THREE.Group();
      plaza.name = `combat-domain-${node.id}`;
      plaza.position.set(node.position.x, 0, node.position.y);
      const mid = node.id === "N.MID.OBS";
      const radius = mid ? 2.72 : 1.32;
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.91, radius, mid ? 0.15 : 0.08, mid ? 10 : 7),
        new THREE.MeshStandardMaterial({ color: mid ? 0x747a70 : 0x646d5c, roughness: 1, flatShading: true }),
      );
      pad.name = mid ? "observation-island-edge-stone" : `node-plaza-paving-${node.allegiance}`;
      pad.position.y = mid ? -0.12 : -0.015;
      pad.receiveShadow = true;
      plaza.add(pad);
      if (!mid) {
        for (let index = 0; index < 5; index++) {
          const angle = (index / 5) * Math.PI * 2;
          const curb = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.12, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x939580, roughness: 1, flatShading: true }),
          );
          curb.position.set(Math.cos(angle) * (radius * 0.78), 0.06, Math.sin(angle) * (radius * 0.78));
          curb.rotation.y = -angle;
          curb.castShadow = true;
          plaza.add(curb);
        }
      }
      scene.add(plaza);
      if (mid) {
        const approaches = (replay.scene.routes ?? [])
          .filter((route) => route.bridgeKind === "facility")
          .flatMap((route) => route.points.filter((point) => Math.hypot(point.x - node.position.x, point.y - node.position.y) > 0.001));
        this.observation = buildMidObservatory(scene, node.position, approaches, replay.scene.captureTicks ?? 8);
      }
    }
    this.update(null);
  }

  update(state: DisplayState | null) {
    const facilities = Object.values(state?.entities ?? {}).filter((entity) => entity.battlefield?.bridgeSite);
    for (const { model, site } of this.bridges.values()) {
      const facility = facilities.find((entity) => entity.battlefield?.bridgeSite === site);
      model.setState(facility?.battlefield?.bridgeState ?? "unknown", facility?.id);
      model.setWork(facility?.battlefield?.buildRemaining ?? 0, state?.tick ?? 0, facility?.id);
      model.setIntegrity?.(facility ? battlefieldStructureDamageStage(facility) : "unknown");
    }
    const objective = Object.values(state?.entities ?? {}).find((entity) => entity.kind === "observation");
    const observationSides = new Set(Object.values(state?.entities ?? {})
      .filter((entity) => entity.kind === "unit"
        && entity.hp > 0
        && !entity.destroyed
        && entity.battlefield?.node === "N.MID.OBS"
        && !entity.battlefield.edgeTo
        && (entity.side === "azure" || entity.side === "vermilion"))
      .map((entity) => entity.side));
    this.observation?.update(objective, observationSides.has("azure") && observationSides.has("vermilion"));
  }

  dispose() {
    for (const { model } of this.bridges.values()) model.dispose();
    this.bridges.clear();
    this.observation?.dispose();
    this.observation = undefined;
    if (this.waterDetails) {
      this.scene.remove(this.waterDetails);
      disposeTree(this.waterDetails);
      this.waterDetails = undefined;
    }
    if (this.water) {
      this.scene.remove(this.water);
      disposeTree(this.water);
      this.water = undefined;
    }
    for (const node of [...this.scene.children].filter((child) => child.name.startsWith("combat-domain-"))) {
      this.scene.remove(node);
      disposeTree(node);
    }
  }
}
