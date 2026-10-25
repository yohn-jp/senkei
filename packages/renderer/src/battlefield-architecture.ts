import * as THREE from "three";
import type { DisplayEntity, Replay, WorldPoint } from "@senkei/replay-contract";

export type BridgeVisualState = "normal" | "expanded" | "destroyed" | "unknown";
export type BattlefieldDamageStage = "unknown" | "intact" | "damaged" | "critical" | "destroyed";

/** Damage stage from a visible Replay entity; HP never implies destruction. */
export function battlefieldStructureDamageStage(
  entity: Pick<DisplayEntity, "hp" | "maxHp" | "destroyed">,
): BattlefieldDamageStage {
  if (entity.destroyed) return "destroyed";
  if (!Number.isFinite(entity.hp) || !Number.isFinite(entity.maxHp) || entity.maxHp <= 0) return "unknown";
  const ratio = THREE.MathUtils.clamp(entity.hp / entity.maxHp, 0, 1);
  return ratio <= 0.35 ? "critical" : ratio <= 0.7 ? "damaged" : "intact";
}

export interface BattlefieldBridgeModel {
  readonly group: THREE.Group;
  setState(state: BridgeVisualState, entityId?: string): void;
  setWork(remaining: number, tick: number, entityId?: string): void;
  setIntegrity?(stage: BattlefieldDamageStage): void;
  dispose(): void;
}

export interface MidObservatoryModel {
  readonly group: THREE.Group;
  update(entity: DisplayEntity | undefined, contested?: boolean): void;
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
  captureAmber: 0xd4a756,
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

function stoneScar(
  parent: THREE.Object3D,
  name: string,
  position: readonly [number, number, number],
  rotationY = 0,
  scale = 1,
) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.2, 0);
  shape.lineTo(-0.04, 0.18);
  shape.lineTo(-0.13, 0.39);
  shape.lineTo(0.11, 0.53);
  shape.lineTo(0.06, 0.71);
  shape.lineTo(0.22, 0.88);
  shape.lineTo(-0.07, 0.78);
  shape.lineTo(-0.18, 0.56);
  shape.lineTo(-0.09, 0.36);
  shape.lineTo(-0.24, 0.22);
  shape.closePath();
  const scar = mesh(
    parent,
    new THREE.ShapeGeometry(shape),
    palette.shadowStone,
    name,
    position,
    { side: THREE.DoubleSide, roughness: 1 },
  );
  scar.scale.setScalar(scale);
  scar.rotation.y = rotationY;
  return scar;
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
  const damageStage = battlefieldStructureDamageStage(entity);
  group.userData.damageStage = damageStage;
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
  const gateLintel = box(group, `${group.name}-gate-lintel`, [2.42, 0.38, 0.46], [0, 1.72, 3.17], palette.sandstoneLight);
  const gateDoor = box(group, `${group.name}-gate-door`, [1.45, 1.32, 0.15], [0, 0.83, 3.2], palette.agedWood);
  box(group, `${group.name}-gate-bronze-crossbar`, [1.5, 0.12, 0.2], [0, 1.08, 3.12], palette.bronze);
  if (damageStage === "critical") {
    gateLintel.visible = false;
    gateDoor.visible = false;
  }
  for (const z of [-3.15, 3.15]) {
    for (let x = -2.45, index = 0; x <= 2.46; x += 0.64, index++) {
      if (z > 0 && Math.abs(x) < 1.0) continue;
      box(group, `${group.name}-wall-merlon-${z}-${index}`, [0.3, 0.27, 0.32], [x, 1.7, z], palette.sandstoneLight);
    }
  }
  for (const x of [-3.16, 3.16]) {
    for (let z = -2.45, index = 0; z <= 2.46; z += 0.64, index++) {
      const merlon = box(group, `${group.name}-side-merlon-${x}-${index}`, [0.32, 0.27, 0.3], [x, 1.7, z], palette.sandstoneLight);
      if (damageStage === "critical" && x > 0 && index === 3) merlon.visible = false;
    }
  }
  for (const x of [-3.18, 3.18]) for (const z of [-3.17, 3.17]) {
    const tower = addCornerTower(group, side, `${group.name}-walltower-${x}-${z}`, x, z, 0.9);
    if (damageStage === "critical" && x > 0 && z < 0) {
      tower.rotation.z = -0.28;
      tower.position.y = 0.18;
    }
  }

  // Rear keep, raised above the courtyard with a split silhouette and colored pennants.
  box(group, `${group.name}-keep-foot`, [2.72, 0.42, 2.2], [0, 0.55, -2.08], palette.shadowStone);
  box(group, `${group.name}-keep-hall`, [2.35, 2.25, 1.9], [0, 1.78, -2.08], palette.sandstone);
  box(group, `${group.name}-keep-band`, [2.55, 0.24, 2.1], [0, 2.98, -2.08], palette.sandstoneLight);
  for (const x of [-1.0, 1.0]) {
    mesh(group, new THREE.CylinderGeometry(0.42, 0.56, 2.5, 6), palette.sandstoneLight, `${group.name}-keep-turret-${x}`, [x, 1.86, -2.08]);
    cone(group, `${group.name}-keep-roof-${x}`, 0.62, 1.0, [x, 3.55, -2.08], palette.slate, 5);
  }
  const keepSpire = cone(group, `${group.name}-keep-spire`, 1.35, 1.15, [0, 3.67, -2.08], side === "azure" ? palette.azure : palette.vermilion, 6);
  if (damageStage === "critical") {
    keepSpire.rotation.z = -0.18;
    keepSpire.position.x = 0.18;
  }
  if (damageStage === "damaged" || damageStage === "critical")
    stoneScar(group, `${group.name}-keep-impact-scar`, [0.38, 1.32, -1.126], Math.PI, 1.05);
  if (damageStage === "critical") {
    const rubble = new THREE.Group();
    rubble.name = `${group.name}-breached-gate-rubble`;
    group.add(rubble);
    for (let index = 0; index < 8; index++) {
      const angle = index * 2.399963229728653;
      box(
        rubble,
        `${rubble.name}-${index}`,
        [0.38 + index % 3 * 0.12, 0.16 + index % 2 * 0.08, 0.3 + index % 2 * 0.1],
        [Math.cos(angle) * 0.9, 0.23 + index % 2 * 0.05, 3.1 + Math.sin(angle) * 0.6],
        index % 2 ? palette.sandstoneLight : palette.slateLight,
        angle,
      );
    }
  }
  if (damageStage !== "critical") addBanner(group, side, `${group.name}-keep-standard`, [0, 3.34, -0.96], 1.08);
  return group;
}

/** A local-space tower silhouette for a Replay entity group already at entity.position. */
export function buildBattlefieldTower(parent: THREE.Object3D, entity: DisplayEntity): THREE.Group {
  const group = new THREE.Group();
  group.name = `${entity.side}-battlefield-tower-${entity.id}`;
  group.userData.entityId = entity.id;
  group.userData.destroyed = entity.destroyed;
  parent.add(group);
  const damageStage = battlefieldStructureDamageStage(entity);
  group.userData.damageStage = damageStage;
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
  // Projecting stone supports make the upper defense read as a fortified
  // structure at battlefield scale, while leaving the actual node clear.
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2 + Math.PI / 4;
    const buttress = mesh(
      group,
      new THREE.CylinderGeometry(0.16, 0.38, 1.18, 5),
      palette.slateLight,
      `${group.name}-buttress-${index}`,
      [Math.cos(angle) * 0.92, 0.76, Math.sin(angle) * 0.92],
    );
    buttress.rotation.set(Math.cos(angle) * 0.16, 0, -Math.sin(angle) * 0.16);
  }
  mesh(group, new THREE.CylinderGeometry(1.24, 1.24, 0.27, 8), palette.sandstoneLight, `${group.name}-parapet-walk`, [0, 2.53, 0]);
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    const merlon = box(group, `${group.name}-merlon-${index}`, [0.35, 0.48, 0.34], [Math.cos(angle) * 1.05, 2.88, Math.sin(angle) * 1.05], palette.sandstoneLight, -angle);
    // At critical health a parapet block has fallen away; loose masonry at
    // the foot records confirmed structure damage without inventing fire.
    if (damageStage === "critical" && index === 1) merlon.visible = false;
  }
  const roof = new THREE.Group();
  roof.name = `${group.name}-upperworks`;
  roof.position.y = 2.85;
  group.add(roof);
  const roofScale = damageStage === "critical" ? 0.78 : 1;
  mesh(roof, new THREE.CylinderGeometry(0.56 * roofScale, 0.76 * roofScale, 0.62 * roofScale, 6), palette.slate, `${group.name}-watch-roof`, [0, 0.49, 0]);
  cone(roof, `${group.name}-roof-spire`, 0.7 * roofScale, 1.05 * roofScale, [0, 1.23 * roofScale, 0], palette.slate, 6);
  if (damageStage === "critical") {
    roof.rotation.z = -0.13;
    for (let index = 0; index < 5; index++) {
      const angle = index * 2.399963229728653;
      const debris = box(
        group,
        `${group.name}-collapse-rubble-${index}`,
        [0.44 + (index % 2) * 0.2, 0.14 + (index % 3) * 0.06, 0.34 + (index % 2) * 0.12],
        [Math.cos(angle) * (1.15 + index % 2 * 0.18), 0.18 + index % 2 * 0.06, Math.sin(angle) * (1.15 + index % 2 * 0.18)],
        index % 2 ? palette.sandstoneLight : palette.slateLight,
        angle,
      );
      debris.rotation.z = (index % 3 - 1) * 0.16;
    }
  }

  // A chipped masonry scar appears only after authorized HP loss. The shape
  // is flush with the front face and follows the tower's own facing.
  if (damageStage === "damaged" || damageStage === "critical") {
    stoneScar(group, `${group.name}-impact-scar`, [0.08, 0.9, 1.075], 0.04);
  }
  if (damageStage === "critical") {
    const brokenFace = box(group, `${group.name}-broken-parapet-face`, [0.17, 0.78, 0.045], [-0.47, 1.67, 0.99], palette.shadowStone, 0.16);
    brokenFace.rotation.z = -0.19;
  }
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 2;
    const slit = box(group, `${group.name}-arrow-slit-${index}`, [0.12, 0.52, 0.06], [Math.cos(angle) * 0.98, 1.58, Math.sin(angle) * 0.98], palette.shadowStone, -angle);
    slit.material.color.set(palette.shadowStone);
  }
  if (damageStage !== "critical") addBanner(group, entity.side, `${group.name}-standard`, [0.22, 3.45, 0.15], 0.8);
  return group;
}

function routeSpan(route: NonNullable<Replay["scene"]["routes"]>[number], islandCenter?: WorldPoint): readonly [WorldPoint, WorldPoint] {
  let [start, end] = route.points;
  if (islandCenter && route.bridgeKind === "facility") {
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

function deckFracture(span: number, lateral: number, position: number): THREE.BufferGeometry {
  const length = Math.min(0.78, Math.max(0.42, span * 0.12));
  const radius = 0.038;
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, -radius);
  shape.lineTo(-length * 0.19, radius * 0.25);
  shape.lineTo(-length * 0.05, -radius * 0.5);
  shape.lineTo(length * 0.16, radius * 0.4);
  shape.lineTo(length / 2, radius * 0.1);
  shape.lineTo(length / 2, radius);
  shape.lineTo(length * 0.17, radius * 0.7);
  shape.lineTo(-length * 0.04, radius * 1.5);
  shape.lineTo(-length * 0.2, radius * 0.6);
  shape.lineTo(-length / 2, radius * 1.2);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(position, 0.388, lateral);
  return geometry;
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

  const deckFractures = new THREE.Group();
  deckFractures.name = `${group.name}-timber-fractures`;
  group.add(deckFractures);
  const fractureMaterial = material(palette.shadowStone, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const damageTracks = [0, -laneOffset, laneOffset];
  for (const [trackIndex, lateral] of damageTracks.entries()) {
    for (let index = 0; index < 2; index++) {
      const fracture = new THREE.Mesh(deckFracture(span, lateral, span * (index === 0 ? -0.17 : 0.22)), fractureMaterial);
      fracture.name = `${deckFractures.name}-track-${trackIndex}-${index}`;
      fracture.castShadow = false;
      fracture.receiveShadow = false;
      deckFractures.add(fracture);
    }
  }
  deckFractures.visible = false;
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

  // A deliberately generic work site. It communicates activity without
  // claiming whether the hidden operation is expand, rebuild, or destroy.
  const workScaffold = new THREE.Group();
  workScaffold.name = `${group.name}-work-scaffold`;
  workScaffold.position.set(0, 0, laneOffset + laneWidth * 0.72 + 0.45);
  group.add(workScaffold);
  for (const x of [-0.92, 0.92]) {
    mesh(workScaffold, new THREE.CylinderGeometry(0.075, 0.095, 1.42, 5), palette.agedWood, `${workScaffold.name}-post-${x}`, [x, 0.71, 0]);
    box(workScaffold, `${workScaffold.name}-foot-${x}`, [0.38, 0.12, 0.38], [x, 0.08, 0], palette.slateLight);
    box(workScaffold, `${workScaffold.name}-brace-${x}`, [0.1, 1.15, 0.1], [x * 0.72, 0.56, 0], palette.agedWoodLight, x < 0 ? -0.38 : 0.38);
  }
  const workBeam = new THREE.Group();
  workBeam.name = `${workScaffold.name}-animated-beam`;
  workBeam.position.set(0, 1.42, 0);
  workScaffold.add(workBeam);
  box(workBeam, `${workBeam.name}-crossbeam`, [2.35, 0.16, 0.18], [0, 0, 0], palette.agedWoodLight);
  box(workBeam, `${workBeam.name}-counterweight`, [0.42, 0.3, 0.38], [-0.65, -0.54, 0], palette.slateLight);
  mesh(workBeam, new THREE.CylinderGeometry(0.035, 0.035, 0.86, 5), palette.agedWood, `${workBeam.name}-hoist-rope`, [0.48, -0.43, 0]);
  box(workBeam, `${workBeam.name}-tool-crate`, [0.5, 0.4, 0.44], [1.23, -1.18, 0.1], palette.agedWood);
  const workFlag = addBanner(workScaffold, "neutral", `${workScaffold.name}-flag`, [0.98, 1.44, 0.12], 0.54);
  workFlag.flag.material.color.set(0xc69a51);
  workFlag.flag.material.emissive.set(0x4d3512);
  const workTools = new THREE.Group();
  workTools.name = `${workScaffold.name}-hand-tools`;
  workTools.position.set(-1.3, 0.08, 0.2);
  workScaffold.add(workTools);
  box(workTools, `${workTools.name}-mallet-handle`, [0.08, 0.72, 0.08], [0, 0.36, 0], palette.agedWood, 0.22);
  box(workTools, `${workTools.name}-mallet-head`, [0.36, 0.14, 0.16], [0.06, 0.67, 0], palette.sandstoneLight, 0.22);
  const workFlagRest = workFlag.group.rotation.z;
  let integrityStage: BattlefieldDamageStage = "unknown";
  centerDeck.visible = false;
  expandedDeck.visible = false;
  centerRails.visible = false;
  sideRails.visible = false;
  brokenDeck.visible = false;
  workScaffold.visible = false;

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
      updateDamagePresentation();
    },
    setWork(remaining, tick, entityId) {
      const active = remaining > 0;
      workScaffold.visible = active;
      group.userData.workActive = active;
      if (active) {
        group.userData.buildRemaining = remaining;
        if (entityId) group.userData.entityId = entityId;
        workBeam.rotation.z = Math.sin(tick * 0.45) * 0.055;
        workFlag.group.rotation.z = workFlagRest + Math.sin(tick * 0.6) * 0.035;
      } else {
        delete group.userData.buildRemaining;
        workBeam.rotation.z = 0;
        workFlag.group.rotation.z = workFlagRest;
        if (group.userData.state === "unknown") delete group.userData.entityId;
      }
    },
    setIntegrity(stage) {
      integrityStage = stage;
      updateDamagePresentation();
    },
    dispose() {
      parent.remove(group);
      disposeGroup(group);
    },
  };
  function updateDamagePresentation() {
    const state = group.userData.state as BridgeVisualState | undefined;
    const destroyed = state === "destroyed" || integrityStage === "destroyed";
    group.userData.damageStage = destroyed ? "destroyed" : integrityStage;
    const damaged = !destroyed && (integrityStage === "damaged" || integrityStage === "critical");
    deckFractures.visible = damaged && (centerDeck.visible || expandedDeck.visible);
    if (deckFractures.children.length) {
      const visibleCount = integrityStage === "critical"
        ? expandedDeck.visible ? deckFractures.children.length : 2
        : integrityStage === "damaged" ? 1 : 0;
      deckFractures.children.forEach((child, index) => {
        child.visible = index < visibleCount;
      });
    }
  }
  model.setState("unknown");
  model.setIntegrity?.("unknown");
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
  const contestedAzureStandard = addBanner(group, "azure", "mid-observatory-contested-standard-azure", [-1.18, 2.02, 0], 0.54);
  const contestedVermilionStandard = addBanner(group, "vermilion", "mid-observatory-contested-standard-vermilion", [1.18, 2.02, 0], 0.54);
  const progressRingRadius = 1.25;
  const progressRingY = 2.48;
  const progressRing = mesh(
    group,
    new THREE.TorusGeometry(progressRingRadius, 0.075, 6, 40),
    palette.neutral,
    "mid-observatory-capture-ring",
    [0, progressRingY, 0],
    { transparent: true, opacity: 0.96, depthWrite: false, side: THREE.DoubleSide, emissive: palette.neutral, emissiveIntensity: 0.42 },
  );
  progressRing.rotation.x = Math.PI / 2;
  const contestedRing = mesh(
    group,
    new THREE.TorusGeometry(1.49, 0.075, 6, 40),
    palette.captureAmber,
    "mid-observatory-contested-ring",
    [0, 2.39, 0],
    { transparent: true, opacity: 0.98, depthWrite: false, side: THREE.DoubleSide, emissive: palette.captureAmber, emissiveIntensity: 0.58 },
  );
  contestedRing.rotation.x = Math.PI / 2;
  contestedRing.visible = false;
  const update = (entity: DisplayEntity | undefined, contested = false) => {
    const isVisible = entity !== undefined;
    if (entity) group.userData.entityId = entity.id;
    else delete group.userData.entityId;
    const owner = entity?.battlefield?.facilityOwner;
    const captureSide = entity?.battlefield?.captureSide;
    const capture = Math.max(0, entity?.battlefield?.captureProgress ?? 0);
    const progress = isVisible && capture > 0 ? Math.min(1, capture / Math.max(1, captureTicks)) : 0;
    const captureColor = factionColor(capture > 0 ? captureSide ?? "neutral" : owner ?? "neutral");
    const visibleOwnerColor = contested ? palette.captureAmber : factionColor(owner ?? "neutral");
    beacon.material.color.set(isVisible ? visibleOwnerColor : palette.neutral);
    beacon.material.emissive.set(!isVisible ? palette.shadowStone : contested ? palette.captureAmber : capture > 0 ? captureColor : factionColor(owner ?? "neutral"));
    beacon.material.emissiveIntensity = !isVisible ? 0.04 : contested ? 0.8 : capture > 0 ? 0.5 : 0.3;
    ownerBanner.group.visible = isVisible && owner !== undefined && owner !== "neutral" && !contested;
    ownerBanner.flag.material.color.set(factionColor(owner ?? "neutral"));
    contestedAzureStandard.group.visible = isVisible && contested;
    contestedVermilionStandard.group.visible = isVisible && contested;
    contestedRing.visible = isVisible && contested;
    contestedRing.material.color.set(palette.captureAmber);
    contestedRing.material.emissive.set(palette.captureAmber);
    progressRing.visible = progress > 0;
    progressRing.material.color.set(captureColor);
    progressRing.material.emissive.set(captureColor);
    progressRing.scale.set(1, 1, 1);
    progressRing.geometry.dispose();
    progressRing.geometry = new THREE.TorusGeometry(progressRingRadius, 0.075, 6, 40, Math.PI * 2 * progress);
    group.userData.captureRingRadius = progressRingRadius;
    group.userData.captureRingElevation = progressRingY;
    group.userData.state = isVisible ? contested ? "contested" : capture > 0 ? "capturing" : "visible" : "unknown";
    if (isVisible) group.userData.contested = contested;
    else delete group.userData.contested;
    if (isVisible && owner !== undefined) {
      group.userData.owner = owner;
    } else {
      delete group.userData.owner;
    }
    if (isVisible) {
      if (capture > 0) {
        group.userData.captureProgress = capture;
        if (captureSide !== undefined) group.userData.captureSide = captureSide;
        else delete group.userData.captureSide;
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
