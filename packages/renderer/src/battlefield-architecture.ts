import * as THREE from "three";
import type { DisplayEntity, Replay, WorldPoint } from "@senkei/replay-contract";

export type BridgeVisualState = "normal" | "expanded" | "destroyed" | "unknown";

export interface BattlefieldBridgeModel {
  readonly group: THREE.Group;
  setState(state: BridgeVisualState, entityId?: string): void;
  dispose(): void;
}

export interface MidObservatoryModel {
  readonly group: THREE.Group;
  update(entity: DisplayEntity | undefined): void;
  dispose(): void;
}

const palette = {
  slate: 0x515e5d,
  slateLight: 0x78817a,
  sandstone: 0xb2a688,
  sandstoneLight: 0xd0c1a0,
  shadowStone: 0x444d4a,
  agedWood: 0x806b4d,
  agedWoodLight: 0xa18a62,
  bronze: 0xa77c43,
  waterStone: 0x5d726f,
  neutral: 0x8f9a8a,
  azure: 0x4d9fa4,
  azureLight: 0x74bdba,
  vermilion: 0xb65e48,
  vermilionLight: 0xd27b59,
} as const;

type Faction = "azure" | "vermilion" | "neutral";

function factionColor(side: Faction): number {
  return side === "azure" ? palette.azure : side === "vermilion" ? palette.vermilion : palette.neutral;
}

function material(color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.91, flatShading: true, ...options });
}

function mesh<T extends THREE.BufferGeometry>(
  parent: THREE.Object3D,
  geometry: T,
  color: number,
  name: string,
  position?: readonly [number, number, number],
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.Mesh<T, THREE.MeshStandardMaterial> {
  const result = new THREE.Mesh(geometry, material(color, options));
  result.name = name;
  if (position) result.position.set(position[0], position[1], position[2]);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function box(
  parent: THREE.Object3D,
  name: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  color: number,
  rotationY = 0,
): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  const result = mesh(parent, new THREE.BoxGeometry(...size), color, name, position);
  result.rotation.y = rotationY;
  return result;
}

function cone(
  parent: THREE.Object3D,
  name: string,
  radius: number,
  height: number,
  position: readonly [number, number, number],
  color: number,
  sides = 5,
): THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial> {
  return mesh(parent, new THREE.ConeGeometry(radius, height, sides), color, name, position);
}

function addBanner(parent: THREE.Object3D, side: Faction, name: string, position: readonly [number, number, number], scale = 1) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(position[0], position[1], position[2]);
  parent.add(group);
  const pole = mesh(group, new THREE.CylinderGeometry(0.045 * scale, 0.065 * scale, 1.8 * scale, 5), palette.agedWood, `${name}-mast`, [0, 0.85 * scale, 0]);
  pole.castShadow = true;
  cone(group, `${name}-finial`, 0.1 * scale, 0.22 * scale, [0, 1.82 * scale, 0], palette.bronze, 4);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.83 * scale, -0.13 * scale);
  shape.lineTo(0.83 * scale, -0.6 * scale);
  shape.lineTo(0.48 * scale, -0.45 * scale);
  shape.lineTo(0, -0.62 * scale);
  shape.closePath();
  const flag = mesh(
    group,
    new THREE.ShapeGeometry(shape),
    factionColor(side),
    `${name}-cloth`,
    [0.05 * scale, 1.63 * scale, 0.035 * scale],
    { side: THREE.DoubleSide, roughness: 0.8 },
  );
  flag.castShadow = true;
  return { group, flag };
}

function addCornerTower(parent: THREE.Object3D, side: Faction, name: string, x: number, z: number, scale = 1) {
  const root = new THREE.Group();
  root.name = name;
  root.position.set(x, 0, z);
  parent.add(root);
  mesh(root, new THREE.CylinderGeometry(0.56 * scale, 0.76 * scale, 0.38 * scale, 6), palette.shadowStone, `${name}-foot`, [0, 0.19 * scale, 0]);
  mesh(root, new THREE.CylinderGeometry(0.5 * scale, 0.64 * scale, 1.27 * scale, 6), palette.sandstone, `${name}-shaft`, [0, 1.0 * scale, 0]);
  mesh(root, new THREE.CylinderGeometry(0.68 * scale, 0.68 * scale, 0.18 * scale, 6), palette.sandstoneLight, `${name}-crown`, [0, 1.73 * scale, 0]);
  for (let index = 0; index < 6; index++) {
    const angle = (index / 6) * Math.PI * 2;
    const crenel = box(
      root,
      `${name}-crenel-${index}`,
      [0.25 * scale, 0.29 * scale, 0.25 * scale],
      [Math.cos(angle) * 0.59 * scale, 1.94 * scale, Math.sin(angle) * 0.59 * scale],
      palette.sandstoneLight,
      -angle,
    );
    crenel.rotation.y = -angle;
  }
  addBanner(root, side, `${name}-banner`, [0, 1.92 * scale, 0.2 * scale], 0.72 * scale);
  return root;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((entry) => entry.dispose());
  });
}

/** Full world-space fortress generated only for a currently visible Replay base. */
export function buildBattlefieldBase(parent: THREE.Object3D, entity: DisplayEntity, facingRadians = 0): THREE.Group {
  const group = new THREE.Group();
  group.name = `${entity.side}-battlefield-fortress-${entity.id}`;
  group.userData.entityId = entity.id;
  group.userData.destroyed = entity.destroyed;
  group.position.set(entity.position.x, 0, entity.position.y);
  group.rotation.y = facingRadians;
  parent.add(group);
  const side = entity.side;
  if (entity.destroyed) {
    mesh(group, new THREE.CylinderGeometry(3.2, 3.55, 0.28, 8), palette.shadowStone, `${group.name}-broken-foundation`, [0, 0.12, 0]);
    for (let index = 0; index < 20; index++) {
      const angle = (index * 2.399963229728653) % (Math.PI * 2);
      const radius = 0.75 + (index % 5) * 0.48;
      const height = 0.19 + (index % 4) * 0.11;
      const fragment = box(
        group,
        `${group.name}-rubble-${index}`,
        [0.56 + (index % 3) * 0.14, height, 0.38 + (index % 2) * 0.18],
        [Math.cos(angle) * radius, 0.27 + height * 0.45, Math.sin(angle) * radius],
        index % 3 === 0 ? palette.sandstoneLight : index % 3 === 1 ? palette.slateLight : palette.sandstone,
        angle * 0.7,
      );
      fragment.rotation.z = ((index % 5) - 2) * 0.12;
    }
    return group;
  }

  // The courtyard ring leaves the actual Enbu base node clear for spawning,
  // regrouping and combat while a much larger keep defines the site silhouette.
  box(group, `${group.name}-foundation-rear`, [7.35, 0.32, 0.72], [0, 0.16, -3.24], palette.shadowStone);
  box(group, `${group.name}-foundation-left`, [0.72, 0.32, 5.7], [-3.22, 0.16, 0], palette.shadowStone);
  box(group, `${group.name}-foundation-right`, [0.72, 0.32, 5.7], [3.22, 0.16, 0], palette.shadowStone);
  for (const sideX of [-2.08, 2.08]) {
    box(group, `${group.name}-foundation-gatewing-${sideX}`, [2.03, 0.32, 0.72], [sideX, 0.16, 3.24], palette.shadowStone);
  }
  // A low stone rim defines the court while leaving the node center uncovered.
  const courtRing = mesh(group, new THREE.TorusGeometry(2.78, 0.15, 4, 8), palette.sandstoneLight, `${group.name}-court-rim`, [0, 0.43, 0]);
  courtRing.rotation.x = Math.PI / 2;
  courtRing.scale.set(1, 1, 0.88);

  const wallY = 0.95;
  for (const sideX of [-1, 1]) {
    box(group, `${group.name}-wall-side-${sideX}`, [0.42, 1.25, 5.35], [sideX * 3.18, wallY, 0], palette.sandstone);
  }
  box(group, `${group.name}-wall-rear`, [5.95, 1.25, 0.42], [0, wallY, -3.17], palette.sandstone);
  for (const sideX of [-1, 1]) {
    box(group, `${group.name}-wall-gatewing-${sideX}`, [1.92, 1.25, 0.42], [sideX * 2.12, wallY, 3.17], palette.sandstone);
  }
  box(group, `${group.name}-gate-lintel`, [2.42, 0.38, 0.46], [0, 1.72, 3.17], palette.sandstoneLight);
  box(group, `${group.name}-gate-door`, [1.45, 1.32, 0.15], [0, 0.83, 3.2], palette.agedWood);
  box(group, `${group.name}-gate-bronze-crossbar`, [1.5, 0.12, 0.2], [0, 1.08, 3.12], palette.bronze);
  for (const z of [-3.15, 3.15]) {
    for (let x = -2.45, index = 0; x <= 2.46; x += 0.64, index++) {
      if (z > 0 && Math.abs(x) < 1.0) continue;
      box(group, `${group.name}-wall-merlon-${z}-${index}`, [0.3, 0.27, 0.32], [x, 1.7, z], palette.sandstoneLight);
    }
  }
  for (const x of [-3.16, 3.16]) {
    for (let z = -2.45, index = 0; z <= 2.46; z += 0.64, index++) {
      box(group, `${group.name}-side-merlon-${x}-${index}`, [0.32, 0.27, 0.3], [x, 1.7, z], palette.sandstoneLight);
    }
  }
  for (const x of [-3.18, 3.18]) for (const z of [-3.17, 3.17]) addCornerTower(group, side, `${group.name}-walltower-${x}-${z}`, x, z, 0.9);

  // Rear keep, raised above the courtyard with a split silhouette and colored pennants.
  box(group, `${group.name}-keep-foot`, [2.72, 0.42, 2.2], [0, 0.55, -2.08], palette.shadowStone);
  box(group, `${group.name}-keep-hall`, [2.35, 2.25, 1.9], [0, 1.78, -2.08], palette.sandstone);
  box(group, `${group.name}-keep-band`, [2.55, 0.24, 2.1], [0, 2.98, -2.08], palette.sandstoneLight);
  for (const x of [-1.0, 1.0]) {
    mesh(group, new THREE.CylinderGeometry(0.42, 0.56, 2.5, 6), palette.sandstoneLight, `${group.name}-keep-turret-${x}`, [x, 1.86, -2.08]);
    cone(group, `${group.name}-keep-roof-${x}`, 0.62, 1.0, [x, 3.55, -2.08], palette.slate, 5);
  }
  cone(group, `${group.name}-keep-spire`, 1.35, 1.15, [0, 3.67, -2.08], side === "azure" ? palette.azure : palette.vermilion, 6);
  addBanner(group, side, `${group.name}-keep-standard`, [0, 3.34, -0.96], 1.08);
  return group;
}

/** A local-space tower silhouette for a Replay entity group already at entity.position. */
export function buildBattlefieldTower(parent: THREE.Object3D, entity: DisplayEntity): THREE.Group {
  const group = new THREE.Group();
  group.name = `${entity.side}-battlefield-tower-${entity.id}`;
  group.userData.entityId = entity.id;
  group.userData.destroyed = entity.destroyed;
  parent.add(group);
  if (entity.destroyed) {
    for (let index = 0; index < 8; index++) {
      const angle = index * 0.83;
      const fragment = box(group, `${group.name}-rubble-${index}`, [0.62, 0.28 + (index % 3) * 0.16, 0.48], [Math.cos(angle) * (0.6 + index % 3 * 0.2), 0.2 + index % 2 * 0.1, Math.sin(angle) * (0.6 + index % 3 * 0.2)], index % 2 ? palette.sandstone : palette.slateLight, angle);
      fragment.rotation.z = (index % 4 - 2) * 0.1;
    }
    return group;
  }
  mesh(group, new THREE.CylinderGeometry(1.35, 1.58, 0.42, 8), palette.shadowStone, `${group.name}-bastion-foot`, [0, 0.21, 0]);
  mesh(group, new THREE.CylinderGeometry(0.92, 1.22, 2.0, 8), palette.sandstone, `${group.name}-bastion-shaft`, [0, 1.4, 0]);
  mesh(group, new THREE.CylinderGeometry(1.24, 1.24, 0.27, 8), palette.sandstoneLight, `${group.name}-parapet-walk`, [0, 2.53, 0]);
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    box(group, `${group.name}-merlon-${index}`, [0.35, 0.48, 0.34], [Math.cos(angle) * 1.05, 2.88, Math.sin(angle) * 1.05], palette.sandstoneLight, -angle);
  }
  mesh(group, new THREE.CylinderGeometry(0.56, 0.76, 0.62, 6), palette.slate, `${group.name}-watch-roof`, [0, 3.34, 0]);
  cone(group, `${group.name}-roof-spire`, 0.7, 1.05, [0, 4.08, 0], palette.slate, 6);
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2;
    const slit = box(group, `${group.name}-arrow-slit-${index}`, [0.12, 0.52, 0.06], [Math.cos(angle) * 0.98, 1.58, Math.sin(angle) * 0.98], palette.shadowStone, -angle);
    slit.material.color.set(palette.shadowStone);
  }
  addBanner(group, entity.side, `${group.name}-standard`, [0.22, 3.45, 0.15], 0.8);
  return group;
}

function routeSpan(route: NonNullable<Replay["scene"]["routes"]>[number], islandCenter?: WorldPoint): readonly [WorldPoint, WorldPoint] {
  let [start, end] = route.points;
  if (islandCenter && route.bridgeSite === "MID") {
    const distance = (point: WorldPoint) => Math.hypot(point.x - islandCenter.x, point.y - islandCenter.y);
    const startAtIsland = distance(start) < 1e-5;
    const endAtIsland = distance(end) < 1e-5;
    if (startAtIsland !== endAtIsland) {
      const bank = startAtIsland ? end : start;
      const dx = islandCenter.x - bank.x;
      const dy = islandCenter.y - bank.y;
      const length = Math.hypot(dx, dy) || 1;
      const boundary = 2.52;
      const edgePoint = { x: islandCenter.x - dx / length * boundary, y: islandCenter.y - dy / length * boundary };
      if (startAtIsland) start = edgePoint;
      else end = edgePoint;
    }
  }
  return [start, end];
}

/** Route-derived bridge link; CENTER is the only deck in normal state. */
export function buildBattlefieldBridge(
  parent: THREE.Object3D,
  route: NonNullable<Replay["scene"]["routes"]>[number],
  trackOffset: number,
  islandCenter?: WorldPoint,
): BattlefieldBridgeModel {
  const [start, end] = routeSpan(route, islandCenter);
  const dx = end.x - start.x;
  const dz = end.y - start.y;
  const span = Math.max(0.72, Math.hypot(dx, dz));
  const angle = Math.atan2(dz, dx);
  const group = new THREE.Group();
  group.name = `fixed-bridge-${route.bridgeSite ?? "site"}-${route.id}`;
  group.position.set((start.x + end.x) / 2, 0, (start.y + end.y) / 2);
  group.rotation.y = -angle;
  group.userData.routeId = route.id;
  group.userData.site = route.bridgeSite;
  parent.add(group);

  const centerPiers = new THREE.Group();
  centerPiers.name = `${group.name}-piers-and-abutments`;
  group.add(centerPiers);
  const pierCount = Math.max(1, Math.floor(span / 1.55));
  for (let index = 0; index < pierCount; index++) {
    const x = pierCount === 1 ? 0 : THREE.MathUtils.lerp(-span * 0.28, span * 0.28, index / (pierCount - 1));
    mesh(centerPiers, new THREE.CylinderGeometry(0.27, 0.4, 0.92, 6), palette.waterStone, `${group.name}-pier-${index}`, [x, -0.28, 0]);
    mesh(centerPiers, new THREE.CylinderGeometry(0.42, 0.48, 0.2, 6), palette.sandstone, `${group.name}-pier-cap-${index}`, [x, 0.22, 0]);
  }
  for (const x of [-span / 2 + 0.07, span / 2 - 0.07]) {
    box(centerPiers, `${group.name}-abutment-${x}`, [0.24, 0.72, 2.8], [x, 0.06, 0], palette.slateLight);
    box(centerPiers, `${group.name}-abutment-coping-${x}`, [0.3, 0.12, 2.95], [x, 0.47, 0], palette.sandstoneLight);
  }

  const laneOffset = Math.max(0.62, Math.abs(trackOffset));
  const laneWidth = Math.max(0.7, laneOffset * 1.02);
  const boardStep = Math.max(0.22, Math.min(0.42, span / 6.5));
  const boardCount = Math.max(4, Math.floor(span / boardStep));
  const boardLength = (span - 0.16) / boardCount;
  const centerDeck = new THREE.Group();
  centerDeck.name = `${group.name}-center-deck`;
  group.add(centerDeck);
  const expandedDeck = new THREE.Group();
  expandedDeck.name = `${group.name}-expanded-side-decks`;
  group.add(expandedDeck);
  for (let index = 0; index < boardCount; index++) {
    const x = -span / 2 + 0.08 + boardLength * (index + 0.5);
    box(centerDeck, `${group.name}-center-plank-${index}`, [boardLength * 0.87, 0.12, laneWidth], [x, 0.32, 0], index % 3 === 0 ? palette.agedWoodLight : palette.agedWood);
    for (const lateral of [-laneOffset, laneOffset]) {
      box(expandedDeck, `${group.name}-side-plank-${lateral}-${index}`, [boardLength * 0.87, 0.12, laneWidth], [x, 0.32, lateral], index % 3 === 0 ? palette.agedWoodLight : palette.agedWood);
    }
  }
  const centerRails = new THREE.Group();
  centerRails.name = `${group.name}-center-rails`;
  group.add(centerRails);
  const sideRails = new THREE.Group();
  sideRails.name = `${group.name}-expanded-rails`;
  group.add(sideRails);
  for (const side of [-1, 1]) {
    const centerZ = side * (laneWidth / 2 + 0.07);
    box(centerRails, `${group.name}-center-rail-beam-${side}`, [span - 0.2, 0.12, 0.12], [0, 0.86, centerZ], palette.agedWood);
    box(centerRails, `${group.name}-center-rail-cap-${side}`, [span - 0.2, 0.12, 0.17], [0, 1.0, centerZ], palette.agedWoodLight);
    for (let index = 0; index <= Math.floor(span / 0.62); index++) {
      const x = -span / 2 + 0.1 + (index / Math.floor(span / 0.62)) * (span - 0.2);
      box(centerRails, `${group.name}-center-post-${side}-${index}`, [0.12, 0.64, 0.12], [x, 0.65, centerZ], palette.agedWood);
    }

    const outerZ = side * (laneOffset + laneWidth / 2 + 0.08);
    box(sideRails, `${group.name}-outer-rail-beam-${side}`, [span - 0.2, 0.14, 0.15], [0, 0.93, outerZ], palette.agedWood);
    box(sideRails, `${group.name}-outer-rail-coping-${side}`, [span - 0.2, 0.12, 0.19], [0, 1.08, outerZ], palette.agedWoodLight);
    for (let index = 0; index <= Math.floor(span / 0.62); index++) {
      const x = -span / 2 + 0.1 + (index / Math.floor(span / 0.62)) * (span - 0.2);
      box(sideRails, `${group.name}-outer-post-${side}-${index}`, [0.14, 0.75, 0.14], [x, 0.68, outerZ], palette.agedWood);
    }
  }

  const brokenDeck = new THREE.Group();
  brokenDeck.name = `${group.name}-broken-water-gap`;
  group.add(brokenDeck);
  const remnantLength = Math.min(0.58, span * 0.28);
  for (const side of [-1, 1]) {
    const center = side * (span / 2 - remnantLength / 2 - 0.05);
    for (let index = 0; index < 3; index++) {
      const z = (index - 1) * (laneWidth * 0.65);
      const plank = box(brokenDeck, `${group.name}-broken-plank-${side}-${index}`, [remnantLength, 0.1, laneWidth * 0.48], [center, 0.29, z], palette.agedWood);
      plank.rotation.z = side * (index === 1 ? -0.13 : 0.04);
    }
    const beam = box(brokenDeck, `${group.name}-fallen-beam-${side}`, [0.16, 0.8, 0.16], [side * (span * 0.12), -0.02, side * 0.35], palette.agedWood);
    beam.rotation.z = side * 0.63;
  }
  centerDeck.visible = false;
  expandedDeck.visible = false;
  centerRails.visible = false;
  sideRails.visible = false;
  brokenDeck.visible = false;

  const model: BattlefieldBridgeModel = {
    group,
    setState(state, entityId) {
      const intact = state === "normal" || state === "expanded";
      centerDeck.visible = intact;
      expandedDeck.visible = state === "expanded";
      centerRails.visible = intact;
      sideRails.visible = state === "expanded";
      brokenDeck.visible = state === "destroyed";
      if (state !== "unknown" && entityId) group.userData.entityId = entityId;
      else delete group.userData.entityId;
      group.userData.state = state;
      group.userData.openWaterGap = state === "destroyed";
    },
    dispose() {
      parent.remove(group);
      disposeGroup(group);
    },
  };
  model.setState("unknown");
  return model;
}

function wallSegment(parent: THREE.Object3D, name: string, angle: number, radius: number, color: number, width = 1.14) {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const wall = box(parent, name, [width, 0.88, 0.34], [x, 0.7, z], color, -angle);
  wall.rotation.y = -angle;
  box(parent, `${name}-coping`, [width + 0.08, 0.14, 0.4], [x, 1.2, z], palette.sandstoneLight, -angle);
  for (const offset of [-width * 0.34, width * 0.34]) {
    box(parent, `${name}-crenel-${offset}`, [0.28, 0.28, 0.36], [x + Math.cos(angle) * offset, 1.41, z + Math.sin(angle) * offset], palette.sandstoneLight, -angle);
  }
  return wall;
}

/** River-island keep with separate approaches, not a bridge marker. */
export function buildMidObservatory(
  parent: THREE.Object3D,
  position: WorldPoint,
  approaches: readonly WorldPoint[],
  captureTicks: number,
): MidObservatoryModel {
  const group = new THREE.Group();
  group.name = "mid-observation-objective";
  group.position.set(position.x, 0, position.y);
  parent.add(group);
  mesh(group, new THREE.CylinderGeometry(2.4, 2.62, 0.42, 10), palette.waterStone, "mid-island-foundation", [0, 0.05, 0]);
  mesh(group, new THREE.CylinderGeometry(2.08, 2.22, 0.16, 10), palette.sandstone, "mid-island-paving", [0, 0.34, 0]);
  const approachAngles = approaches.map((entry) => Math.atan2(entry.y - position.y, entry.x - position.x));
  const wallCount = 10;
  for (let index = 0; index < wallCount; index++) {
    const angle = (index / wallCount) * Math.PI * 2;
    const hasGate = approachAngles.some((target) => Math.abs(THREE.MathUtils.euclideanModulo(angle - target + Math.PI, Math.PI * 2) - Math.PI) < Math.PI / wallCount * 0.8);
    if (!hasGate) wallSegment(group, `mid-island-wall-${index}`, angle, 1.86, palette.slateLight);
    const tower = new THREE.Group();
    tower.name = `mid-island-corner-bastion-${index}`;
    const x = Math.cos(angle) * 2.08;
    const z = Math.sin(angle) * 2.08;
    tower.position.set(x, 0.38, z);
    group.add(tower);
    mesh(tower, new THREE.CylinderGeometry(0.29, 0.38, 0.9, 6), palette.sandstone, `${tower.name}-shaft`, [0, 0.45, 0]);
    mesh(tower, new THREE.CylinderGeometry(0.44, 0.44, 0.16, 6), palette.sandstoneLight, `${tower.name}-parapet`, [0, 0.94, 0]);
    cone(tower, `${tower.name}-roof`, 0.36, 0.48, [0, 1.22, 0], palette.slate, 5);
  }
  for (const [index, angle] of approachAngles.entries()) {
    const x = Math.cos(angle) * 1.92;
    const z = Math.sin(angle) * 1.92;
    const gate = new THREE.Group();
    gate.name = `mid-island-bridge-gate-${index}`;
    gate.position.set(x, 0.4, z);
    gate.rotation.y = -angle;
    group.add(gate);
    box(gate, `${gate.name}-left-pillar`, [0.28, 1.25, 0.38], [-0.56, 0.63, 0], palette.sandstoneLight);
    box(gate, `${gate.name}-right-pillar`, [0.28, 1.25, 0.38], [0.56, 0.63, 0], palette.sandstoneLight);
    box(gate, `${gate.name}-lintel`, [1.38, 0.28, 0.4], [0, 1.3, 0], palette.slateLight);
    box(gate, `${gate.name}-bronze-keystone`, [0.28, 0.34, 0.42], [0, 1.29, 0], palette.bronze);
  }

  mesh(group, new THREE.CylinderGeometry(0.78, 0.98, 1.52, 8), palette.slate, "mid-observatory-beacon-tower", [0, 1.15, 0]);
  mesh(group, new THREE.CylinderGeometry(1.02, 1.02, 0.2, 8), palette.sandstoneLight, "mid-observatory-beacon-walk", [0, 1.98, 0]);
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    box(group, `mid-observatory-beacon-merlon-${index}`, [0.28, 0.3, 0.3], [Math.cos(angle) * 0.86, 2.2, Math.sin(angle) * 0.86], palette.sandstoneLight, -angle);
  }
  const beacon = mesh(group, new THREE.OctahedronGeometry(0.6, 0), palette.neutral, "mid-observatory-beacon-crystal", [0, 2.83, 0], { emissive: palette.shadowStone, emissiveIntensity: 0.08 });
  beacon.scale.y = 1.35;
  const ownerBanner = addBanner(group, "neutral", "mid-observatory-owner-standard", [0, 2.05, 0.92], 0.86);
  const progressRing = mesh(group, new THREE.TorusGeometry(2.31, 0.09, 5, 32), palette.neutral, "mid-observatory-capture-ring", [0, 0.59, 0], { transparent: true, opacity: 0.9 });
  progressRing.rotation.x = Math.PI / 2;
  const update = (entity: DisplayEntity | undefined) => {
    const isVisible = entity !== undefined;
    if (entity) group.userData.entityId = entity.id;
    else delete group.userData.entityId;
    const owner = entity?.battlefield?.facilityOwner ?? "neutral";
    const captureSide = entity?.battlefield?.captureSide ?? "neutral";
    const capture = Math.max(0, entity?.battlefield?.captureProgress ?? 0);
    const progress = isVisible && capture > 0 ? Math.min(1, capture / Math.max(1, captureTicks)) : 0;
    const color = factionColor(capture > 0 ? captureSide : owner);
    beacon.material.color.set(isVisible ? factionColor(owner) : palette.neutral);
    beacon.material.emissive.set(isVisible ? factionColor(owner) : palette.shadowStone);
    beacon.material.emissiveIntensity = isVisible ? 0.3 : 0.04;
    ownerBanner.group.visible = isVisible && owner !== "neutral";
    ownerBanner.flag.material.color.set(factionColor(owner));
    progressRing.visible = progress > 0;
    progressRing.material.color.set(color);
    progressRing.scale.set(1, 1, 1);
    progressRing.geometry.dispose();
    progressRing.geometry = new THREE.TorusGeometry(2.31, 0.09, 5, 32, Math.PI * 2 * progress);
    group.userData.state = isVisible ? capture > 0 ? "contested" : "visible" : "unknown";
    if (isVisible) {
      group.userData.owner = owner;
      if (capture > 0) {
        group.userData.captureProgress = capture;
        group.userData.captureSide = captureSide;
      } else {
        delete group.userData.captureProgress;
        delete group.userData.captureSide;
      }
    } else {
      delete group.userData.owner;
      delete group.userData.captureProgress;
      delete group.userData.captureSide;
    }
  };
  const model: MidObservatoryModel = {
    group,
    update,
    dispose() {
      parent.remove(group);
      disposeGroup(group);
    },
  };
  update(undefined);
  return model;
}
