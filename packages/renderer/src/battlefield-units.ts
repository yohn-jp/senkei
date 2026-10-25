import * as THREE from "three";
import type { DisplayEntity } from "@senkei/replay-contract";
import {
  mergeColoredGeometry,
  panelGeometry,
  profileGeometry,
  setVertexColor,
  type ProfileRing,
  type UnitSurface,
} from "./battlefield-unit-geometry";

const SURFACES: readonly UnitSurface[] = ["armor", "cloth", "leather", "skin", "glow"];
const HERO_SCALE = 0.89;
const MINION_SCALE = 0.72;
type DetailLevel = "full" | "medium" | "far";
type HeroBodyProfile = "command" | "bastion" | "breacher" | "duelist" | "controller" | "pathfinder" | "channeler" | "marksman" | "stalker" | "oracle" | "engineer" | "ranger";

interface HeroBodyProportions {
  torso: readonly [number, number, number];
  pelvis: readonly [number, number, number];
  limbs: readonly [number, number, number];
  legHeight: number;
  head: number;
  legSpread: number;
}

interface ShapeSpec {
  id: string;
  name: string;
  weapon: "sword-shield" | "tower-shield" | "spear" | "twin-blades" | "katana" | "two-hand-maul" | "staff" | "crossbow" | "dual-daggers" | "halo-staff" | "siege-launcher" | "bow";
  headgear: "helm" | "bastion" | "crest" | "duelist" | "hat" | "winged" | "hood" | "marksman" | "shadow" | "oracle" | "engineer" | "ranger";
  cloth: number;
  armor: number;
  accent: number;
  build: number;
  mantle: boolean;
  bodyProfile: HeroBodyProfile;
  stance: Readonly<Record<string, readonly [number, number, number]>>;
}

const HERO_BODY_PROPORTIONS: Record<HeroBodyProfile, HeroBodyProportions> = {
  command: { torso: [1.07, 1.02, 1.03], pelvis: [1.04, 1, 1], limbs: [1, 1, 1], legHeight: 0.98, head: 0.96, legSpread: 0.19 },
  bastion: { torso: [1.2, 0.98, 1.12], pelvis: [1.16, 1.02, 1.1], limbs: [1.12, 0.96, 1.08], legHeight: 0.93, head: 0.9, legSpread: 0.23 },
  breacher: { torso: [1.04, 1.01, 1.04], pelvis: [0.96, 0.98, 1], limbs: [1.04, 1.04, 1.02], legHeight: 0.97, head: 0.96, legSpread: 0.21 },
  duelist: { torso: [0.88, 1.08, 0.92], pelvis: [0.9, 1.02, 0.95], limbs: [0.91, 1.06, 0.92], legHeight: 0.95, head: 0.98, legSpread: 0.185 },
  controller: { torso: [0.96, 1.02, 0.98], pelvis: [0.96, 1, 0.98], limbs: [0.95, 1.01, 0.96], legHeight: 0.96, head: 1.02, legSpread: 0.19 },
  pathfinder: { torso: [1.08, 1.04, 1.04], pelvis: [1.06, 1, 1.04], limbs: [1.03, 1.02, 1.02], legHeight: 0.98, head: 0.94, legSpread: 0.205 },
  channeler: { torso: [0.93, 1.08, 0.94], pelvis: [0.92, 0.99, 0.95], limbs: [0.91, 1.08, 0.93], legHeight: 0.94, head: 1.03, legSpread: 0.18 },
  marksman: { torso: [0.92, 1.05, 0.94], pelvis: [0.93, 1, 0.95], limbs: [0.91, 1.04, 0.92], legHeight: 0.95, head: 0.96, legSpread: 0.19 },
  stalker: { torso: [0.9, 0.98, 0.92], pelvis: [0.9, 0.98, 0.92], limbs: [0.89, 0.97, 0.9], legHeight: 0.91, head: 0.94, legSpread: 0.205 },
  oracle: { torso: [0.95, 1.1, 0.96], pelvis: [0.94, 1, 0.96], limbs: [0.93, 1.07, 0.95], legHeight: 0.94, head: 1.08, legSpread: 0.18 },
  engineer: { torso: [1.1, 1, 1.1], pelvis: [1.08, 1, 1.06], limbs: [1.08, 1, 1.06], legHeight: 0.98, head: 0.95, legSpread: 0.21 },
  ranger: { torso: [0.91, 1.1, 0.92], pelvis: [0.9, 1.01, 0.93], limbs: [0.9, 1.1, 0.91], legHeight: 0.95, head: 0.96, legSpread: 0.19 },
};

const HERO_SHAPES: Record<string, ShapeSpec> = {
  f01: { id: "F01", name: "Bannerhold", weapon: "sword-shield", headgear: "helm", cloth: 0x365a66, armor: 0x8c9b9c, accent: 0xc7a966, build: 1.03, mantle: true, bodyProfile: "command", stance: { "arm.left": [-0.12, 0, 0.12], "arm.right": [0.02, 0, -0.04], "leg.left": [-0.07, 0, 0], "leg.right": [0.05, 0, 0] } },
  f02: { id: "F02", name: "Stoneheart", weapon: "tower-shield", headgear: "bastion", cloth: 0x465963, armor: 0x75868c, accent: 0xb99760, build: 1.18, mantle: true, bodyProfile: "bastion", stance: { torso: [0.015, 0, 0], "arm.left": [-0.18, 0, 0.18], "arm.right": [0.04, 0, -0.08], "leg.left": [-0.03, 0, 0], "leg.right": [0.03, 0, 0] } },
  f03: { id: "F03", name: "Breach", weapon: "spear", headgear: "crest", cloth: 0x705d43, armor: 0x9a9a88, accent: 0xd1af6d, build: 0.95, mantle: false, bodyProfile: "breacher", stance: { torso: [0.095, 0, 0], "arm.left": [-0.06, 0, 0.12], "arm.right": [-0.12, 0, -0.12], "weapon.main": [0, 0, -0.18] } },
  f04: { id: "F04", name: "Rook", weapon: "twin-blades", headgear: "duelist", cloth: 0x566b70, armor: 0x8e9893, accent: 0xc4a879, build: 0.82, mantle: false, bodyProfile: "duelist", stance: { torso: [0.015, 0.1, 0], "arm.left": [-0.12, 0, 0.3], "arm.right": [-0.08, 0, -0.3], "leg.left": [0.03, 0, 0], "leg.right": [-0.03, 0, 0], "weapon.main": [0.04, 0, -0.18], "weapon.off": [0.04, 0, 0.18] } },
  f05: { id: "F05", name: "Lockstep", weapon: "katana", headgear: "hat", cloth: 0x61504b, armor: 0x85857e, accent: 0xc6aa6d, build: 0.91, mantle: true, bodyProfile: "controller", stance: { torso: [0.01, 0.06, 0], "arm.left": [-0.1, 0, 0.12], "arm.right": [-0.08, 0, -0.1], "leg.left": [0.06, 0, 0], "leg.right": [-0.05, 0, 0], "weapon.main": [0, 0, -0.16] } },
  f06: { id: "F06", name: "Pathfinder", weapon: "two-hand-maul", headgear: "winged", cloth: 0x485f58, armor: 0x9c9b86, accent: 0xd2b370, build: 1.04, mantle: true, bodyProfile: "pathfinder", stance: { torso: [0.045, 0, 0], "arm.left": [-0.04, 0, 0.08], "arm.right": [-0.12, 0, -0.08], "leg.left": [-0.06, 0, 0], "leg.right": [0.08, 0, 0] } },
  r01: { id: "R01", name: "Tempest", weapon: "staff", headgear: "hood", cloth: 0x445e6d, armor: 0x71858c, accent: 0x94a8a5, build: 0.88, mantle: true, bodyProfile: "channeler", stance: { torso: [-0.015, 0, 0], "arm.left": [-0.08, 0, 0.07], "arm.right": [-0.1, 0, -0.08], "leg.left": [-0.04, 0, 0], "leg.right": [0.04, 0, 0] } },
  r02: { id: "R02", name: "Farshot", weapon: "crossbow", headgear: "marksman", cloth: 0x657362, armor: 0x929386, accent: 0xc7aa6d, build: 0.86, mantle: true, bodyProfile: "marksman", stance: { torso: [-0.04, 0.06, 0], "arm.left": [-0.13, 0, 0.12], "arm.right": [-0.15, 0, -0.09], "leg.left": [0.04, 0, 0], "leg.right": [-0.04, 0, 0], "weapon.main": [0, 0, -0.08] } },
  r03: { id: "R03", name: "Farwatch", weapon: "dual-daggers", headgear: "shadow", cloth: 0x3e4d58, armor: 0x68787c, accent: 0xb6a47b, build: 0.85, mantle: true, bodyProfile: "stalker", stance: { torso: [0.12, -0.04, 0], "arm.left": [-0.12, 0, 0.3], "arm.right": [-0.1, 0, -0.3], "leg.left": [0.14, 0, 0], "leg.right": [-0.12, 0, 0], "weapon.main": [0.06, 0, -0.3], "weapon.off": [0.06, 0, 0.3] } },
  r04: { id: "R04", name: "Lifeline", weapon: "halo-staff", headgear: "oracle", cloth: 0x777050, armor: 0xaaa38d, accent: 0xd8c182, build: 0.89, mantle: true, bodyProfile: "oracle", stance: { torso: [-0.025, 0, 0], head: [0, 0.025, 0], "arm.left": [-0.04, 0, 0.06], "arm.right": [-0.06, 0, -0.06], "leg.left": [-0.02, 0, 0], "leg.right": [0.02, 0, 0], "weapon.main": [0, 0, -0.12] } },
  r05: { id: "R05", name: "Conductor", weapon: "siege-launcher", headgear: "engineer", cloth: 0x59645d, armor: 0x848d86, accent: 0xc3a66a, build: 1.02, mantle: false, bodyProfile: "engineer", stance: { torso: [0.02, 0, 0], "arm.left": [-0.08, 0, 0.08], "arm.right": [-0.1, 0, -0.08], "leg.left": [-0.08, 0, 0], "leg.right": [0.08, 0, 0] } },
  r06: { id: "R06", name: "Aegis", weapon: "bow", headgear: "ranger", cloth: 0x536c57, armor: 0x899588, accent: 0xc2ab70, build: 0.9, mantle: true, bodyProfile: "ranger", stance: { torso: [-0.045, 0.08, 0], "arm.left": [-0.08, 0, 0.18], "arm.right": [-0.14, 0, -0.18], "leg.left": [0.08, 0, 0], "leg.right": [-0.06, 0, 0], "weapon.main": [0, 0, 0.15] } },
};

export interface BattlefieldUnitRig {
  joints: Record<string, THREE.Group>;
  weaponPivots: Record<string, THREE.Group>;
  anchors: Record<string, THREE.Object3D>;
  /** Neutral local Euler rotations. Replay animation channels add offsets to these values. */
  restPose?: Readonly<Record<string, Readonly<{ x: number; y: number; z: number }>>>;
}

interface Bucket {
  group: THREE.Group;
  surfaces: Map<UnitSurface, THREE.BufferGeometry[]>;
}

type UnitMaterials = Record<UnitSurface, THREE.MeshStandardMaterial>;

function createUnitMaterials(): UnitMaterials {
  return {
    armor: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.36, roughness: 0.52, flatShading: true }),
    cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.02, roughness: 0.92, flatShading: true, side: THREE.DoubleSide }),
    leather: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.02, roughness: 0.82, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.78, flatShading: true }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.1, roughness: 0.3, emissive: 0x49361c, emissiveIntensity: 0.2, flatShading: true }),
  };
}

/** Bakes each part's small authored meshes into one draw call per surface. */
class UnitBuilder {
  readonly joints: Record<string, THREE.Group> = {};
  readonly weaponPivots: Record<string, THREE.Group> = {};
  readonly anchors: Record<string, THREE.Object3D> = {};
  private readonly buckets = new Map<THREE.Group, Bucket>();
  private readonly materials: UnitMaterials;

  constructor(readonly root: THREE.Group, materials: UnitMaterials = createUnitMaterials(), private readonly detail: DetailLevel = "full") {
    this.buckets.set(root, { group: root, surfaces: new Map() });
    this.materials = materials;
  }

  part(name: string, parent: THREE.Group, position: THREE.Vector3Tuple = [0, 0, 0]): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    parent.add(group);
    this.buckets.set(group, { group, surfaces: new Map() });
    if (name.startsWith("joint.")) this.joints[name.slice("joint.".length)] = group;
    if (name.startsWith("pivot.weapon.")) this.weaponPivots[name.slice("pivot.weapon.".length)] = group;
    if (name.startsWith("anchor.")) this.anchors[name.slice("anchor.".length)] = group;
    return group;
  }

  add(
    group: THREE.Group,
    surface: UnitSurface,
    geometry: THREE.BufferGeometry,
    color: number,
    position: THREE.Vector3Tuple = [0, 0, 0],
    rotation: THREE.Vector3Tuple = [0, 0, 0],
    scale: THREE.Vector3Tuple = [1, 1, 1],
  ): void {
    const bucket = this.buckets.get(group);
    if (!bucket) throw new Error(`Unknown Battlefield unit part: ${group.name}`);
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    geometry.applyMatrix4(transform);
    const colored = setVertexColor(geometry, color);
    const pieces = bucket.surfaces.get(surface) ?? [];
    pieces.push(colored);
    bucket.surfaces.set(surface, pieces);
  }

  sphere(group: THREE.Group, surface: UnitSurface, radii: THREE.Vector3Tuple, color: number, position: THREE.Vector3Tuple, detail = 0): void {
    const geometry = new THREE.IcosahedronGeometry(1, this.detail === "far" ? Math.min(detail, 0) : this.detail === "medium" ? Math.min(detail, 1) : detail);
    geometry.scale(...radii);
    geometry.computeVertexNormals();
    this.add(group, surface, geometry, color, position);
  }

  profile(group: THREE.Group, surface: UnitSurface, rings: readonly ProfileRing[], color: number, position: THREE.Vector3Tuple = [0, 0, 0], rotation: THREE.Vector3Tuple = [0, 0, 0], sides = 9): void {
    const radialSegments = this.detail === "far" ? Math.min(sides, 5) : this.detail === "medium" ? Math.min(sides, 7) : sides;
    this.add(group, surface, profileGeometry(rings, radialSegments), color, position, rotation);
  }

  panel(group: THREE.Group, surface: UnitSurface, outline: readonly (readonly [number, number])[], color: number, position: THREE.Vector3Tuple = [0, 0, 0], depth = 0.055, bevel = 0.04, rotation: THREE.Vector3Tuple = [0, 0, 0], scale: THREE.Vector3Tuple = [1, 1, 1]): void {
    this.add(group, surface, panelGeometry(outline, depth, this.detail === "far" ? 0 : this.detail === "medium" ? Math.min(bevel, 0.02) : bevel), color, position, rotation, scale);
  }

  finish(flatten = false): BattlefieldUnitRig {
    if (flatten) {
      const merged = new Map<UnitSurface, THREE.BufferGeometry[]>();
      for (const { group, surfaces } of this.buckets.values()) {
        const relative = new THREE.Matrix4();
        for (let cursor: THREE.Object3D | null = group; cursor && cursor !== this.root; cursor = cursor.parent) {
          cursor.updateMatrix();
          relative.premultiply(cursor.matrix);
        }
        for (const [surface, pieces] of surfaces) {
          const destination = merged.get(surface) ?? [];
          for (const geometry of pieces) {
            geometry.applyMatrix4(relative);
            destination.push(geometry);
          }
          merged.set(surface, destination);
        }
      }
      this.root.clear();
      for (const surface of SURFACES) {
        const pieces = merged.get(surface);
        if (!pieces?.length) continue;
        const mesh = new THREE.Mesh(mergeColoredGeometry(pieces), this.materials[surface]);
        mesh.name = `${this.root.name}.${surface}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.unitSurface = surface;
        this.root.add(mesh);
      }
      this.root.userData.bakedLod = true;
      return { joints: {}, weaponPivots: {}, anchors: {} };
    }
    for (const { group, surfaces } of this.buckets.values()) {
      for (const surface of SURFACES) {
        const parts = surfaces.get(surface);
        if (!parts?.length) continue;
        const mesh = new THREE.Mesh(mergeColoredGeometry(parts), this.materials[surface]);
        mesh.name = `${group.name}.${surface}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.unitSurface = surface;
        group.add(mesh);
      }
    }
    this.root.userData.battlefieldRig = {
      version: 1,
      generator: "senkei.battlefield-unit.v1",
      joints: Object.fromEntries(Object.entries(this.joints).map(([key, group]) => [key, group.name])),
      weaponPivots: Object.fromEntries(Object.entries(this.weaponPivots).map(([key, group]) => [key, group.name])),
      anchors: Object.fromEntries(Object.entries(this.anchors).map(([key, group]) => [key, group.name])),
    };
    return {
      joints: this.joints,
      weaponPivots: this.weaponPivots,
      anchors: this.anchors,
      restPose: Object.fromEntries([
        ...Object.entries(this.joints).map(([key, group]) => [key, { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z }] as const),
        ...Object.entries(this.weaponPivots).map(([key, group]) => [`weapon.${key}`, { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z }] as const),
      ]),
    };
  }
}

function canonicalHeroKey(entity: DisplayEntity, appearanceKey: string): string {
  const catalogId = entity.catalogId?.toLowerCase();
  if (catalogId && HERO_SHAPES[catalogId]) return catalogId;
  const key = appearanceKey.toLowerCase().replaceAll("_", "-");
  const suffix = key.replace(/^senkei\.next\.hero\./, "").replace(/^hero-/, "");
  if (HERO_SHAPES[suffix]) return suffix;
  for (const [id, spec] of Object.entries(HERO_SHAPES)) {
    if (key === `hero-${spec.id.toLowerCase()}` || key.includes(spec.name.toLowerCase())) return id;
  }
  return "f01";
}

function teamCloth(base: number, team: number): number {
  const teamColor = new THREE.Color(team);
  const neutral = new THREE.Color(0x7b8177);
  const muted = teamColor.lerp(neutral, 0.43);
  return new THREE.Color(base).lerp(muted, 0.48).getHex();
}

function createAnchor(builder: UnitBuilder, root: THREE.Group, key: string, position: THREE.Vector3Tuple): THREE.Group {
  const anchor = builder.part(`anchor.${key}`, root, position);
  anchor.visible = false;
  return anchor;
}

function addCape(builder: UnitBuilder, root: THREE.Group, cloth: number, team: number, spread: number, pattern: "long" | "short" | "leaf" = "long"): void {
  const cape = builder.part("joint.cape", root, [0, 0, -0.24]);
  const lower = pattern === "short" ? 0.73 : 0.37;
  const points: readonly (readonly [number, number])[] = pattern === "leaf"
    ? [[-0.26, 1.92], [0.26, 1.92], [0.38, 1.25], [0.32, 0.88], [0.12, 0.72], [0.05, 0.96], [-0.06, 0.73], [-0.18, 1.02], [-0.35, 0.86], [-0.4, 1.28]]
    : [[-0.26 * spread, 1.94], [0.26 * spread, 1.94], [0.37 * spread, 1.24], [0.4 * spread, lower], [0.2 * spread, lower + 0.08], [0, lower - 0.05], [-0.18 * spread, lower + 0.12], [-0.4 * spread, lower]];
  builder.panel(cape, "cloth", points, cloth, [0, 0, 0], 0.045, 0.025);
  builder.panel(cape, "cloth", [[-0.035, 1.74], [0.035, 1.74], [0.06, lower + 0.05], [0, lower + 0.16], [-0.045, lower + 0.05]], team, [0, 0, 0.028], 0.018, 0.01);
  const clasp = builder.part("cape.clasp", root, [0, 1.78, -0.18]);
  builder.sphere(clasp, "armor", [0.08, 0.09, 0.045], 0xc5a66b, [0, 0, 0]);
}

function addHeroChestArmor(
  builder: UnitBuilder,
  torso: THREE.Group,
  palette: { armor: number; cloth: number; accent: number },
  style: HeroBodyProfile,
): void {
  const chest = builder.part("armor.chest", torso, [0, 0, 0.14]);
  chest.userData.chestStyle = style;
  const plate = (outline: readonly (readonly [number, number])[], y = 0, z = 0.02, depth = 0.06) =>
    builder.panel(chest, "armor", outline, palette.armor, [0, y, z], depth, 0.024);
  const leather = (outline: readonly (readonly [number, number])[], y = 0, z = 0.03) =>
    builder.panel(chest, "leather", outline, 0x51473c, [0, y, z], 0.045, 0.012);
  const cloth = (outline: readonly (readonly [number, number])[], y = 0, z = 0.035) =>
    builder.panel(chest, "cloth", outline, palette.cloth, [0, y, z], 0.035, 0.012);

  switch (style) {
    case "command":
      plate([[-0.28, 0.49], [-0.22, 0.68], [0, 0.76], [0.22, 0.68], [0.28, 0.49], [0.16, 0.22], [0, 0.14], [-0.16, 0.22]]);
      plate([[-0.055, 0.59], [0, 0.68], [0.055, 0.59], [0.035, 0.3], [0, 0.22], [-0.035, 0.3]], 0, 0.065, 0.022);
      break;
    case "bastion":
      plate([[-0.34, 0.52], [-0.3, 0.7], [-0.16, 0.75], [0, 0.67], [0.16, 0.75], [0.3, 0.7], [0.34, 0.52], [0.24, 0.2], [0, 0.12], [-0.24, 0.2]], 0, 0.02, 0.095);
      plate([[-0.25, 0.47], [0, 0.53], [0.25, 0.47], [0.19, 0.39], [0, 0.43], [-0.19, 0.39]], 0, 0.07, 0.03);
      break;
    case "breacher":
      plate([[-0.26, 0.68], [0, 0.76], [0.26, 0.68], [0.12, 0.5], [0.075, 0.28], [0, 0.13], [-0.075, 0.28], [-0.12, 0.5]]);
      leather([[-0.34, 0.62], [-0.28, 0.69], [-0.09, 0.48], [-0.16, 0.42]], 0, 0.055);
      break;
    case "duelist":
      leather([[-0.27, 0.68], [-0.2, 0.71], [0.25, 0.19], [0.17, 0.16]]);
      leather([[0.27, 0.68], [0.2, 0.71], [-0.25, 0.19], [-0.17, 0.16]], 0, 0.07);
      plate([[-0.13, 0.5], [0, 0.57], [0.13, 0.5], [0.1, 0.34], [0, 0.29], [-0.1, 0.34]], 0, 0.085, 0.045);
      break;
    case "controller":
      plate([[-0.26, 0.66], [0.26, 0.66], [0.22, 0.53], [-0.22, 0.53]]);
      plate([[-0.23, 0.49], [0.23, 0.49], [0.19, 0.36], [-0.19, 0.36]], 0, 0.07);
      plate([[-0.19, 0.32], [0.19, 0.32], [0.14, 0.2], [-0.14, 0.2]], 0, 0.12);
      break;
    case "pathfinder":
      plate([[-0.29, 0.58], [-0.2, 0.7], [0.1, 0.62], [0.22, 0.42], [0.1, 0.18], [-0.12, 0.25]], 0, 0.02, 0.07);
      leather([[-0.27, 0.7], [-0.18, 0.73], [0.27, 0.22], [0.18, 0.19]], 0, 0.08);
      break;
    case "channeler":
      cloth([[-0.21, 0.68], [0, 0.74], [0.21, 0.68], [0.18, 0.3], [0.26, 0.16], [-0.25, 0.16], [-0.18, 0.3]]);
      plate([[-0.1, 0.57], [0, 0.66], [0.1, 0.57], [0.075, 0.35], [0, 0.28], [-0.075, 0.35]], 0, 0.075, 0.035);
      break;
    case "marksman":
      plate([[-0.22, 0.64], [0.22, 0.64], [0.18, 0.48], [-0.18, 0.48]], 0, 0.02);
      leather([[-0.29, 0.68], [-0.2, 0.71], [0.2, 0.2], [0.1, 0.17]], 0, 0.08);
      break;
    case "stalker":
      leather([[-0.27, 0.67], [-0.19, 0.7], [0.26, 0.19], [0.17, 0.16]]);
      leather([[0.27, 0.67], [0.19, 0.7], [-0.26, 0.19], [-0.17, 0.16]], 0, 0.07);
      plate([[-0.12, 0.49], [0, 0.55], [0.12, 0.49], [0.1, 0.35], [0, 0.3], [-0.1, 0.35]], 0, 0.09, 0.04);
      break;
    case "oracle":
      cloth([[-0.2, 0.7], [0.2, 0.7], [0.15, 0.45], [0.19, 0.19], [-0.19, 0.19], [-0.15, 0.45]]);
      plate([[-0.12, 0.57], [0, 0.67], [0.12, 0.57], [0.085, 0.31], [0, 0.23], [-0.085, 0.31]], 0, 0.07, 0.04);
      break;
    case "engineer":
      plate([[-0.29, 0.65], [-0.06, 0.65], [-0.06, 0.43], [-0.29, 0.43]], 0, 0.02, 0.075);
      plate([[0.06, 0.65], [0.29, 0.65], [0.29, 0.43], [0.06, 0.43]], 0, 0.02, 0.075);
      leather([[-0.22, 0.3], [0.22, 0.3], [0.18, 0.18], [-0.18, 0.18]], 0, 0.075);
      break;
    case "ranger":
      plate([[-0.26, 0.61], [-0.12, 0.72], [0.2, 0.62], [0.25, 0.4], [0.1, 0.2], [-0.18, 0.27]], 0, 0.02, 0.07);
      leather([[-0.23, 0.65], [-0.16, 0.7], [0.19, 0.23], [0.12, 0.2]], 0, 0.08);
      break;
  }
}

function addHumanoidBody(
  builder: UnitBuilder,
  root: THREE.Group,
  palette: { cloth: number; armor: number; accent: number; team: number; build: number },
  options: { scale: number; cape: boolean; bulk?: number; simple?: boolean; chestStyle?: HeroBodyProfile },
): { torso: THREE.Group; head: THREE.Group; mainPivot: THREE.Group; offPivot: THREE.Group } {
  const bulk = (options.bulk ?? 1) * palette.build;
  root.scale.setScalar(options.scale);
  if (options.cape) addCape(builder, root, palette.cloth, palette.team, bulk, "long");

  const pelvis = builder.part("joint.pelvis", root, [0, 0.89, 0]);
  builder.profile(pelvis, "leather", [
    { y: 0.02, radiusX: 0.22 * bulk, radiusZ: 0.15 },
    { y: 0.11, radiusX: 0.3 * bulk, radiusZ: 0.19 },
    { y: 0.28, radiusX: 0.24 * bulk, radiusZ: 0.15 },
  ], 0x554a3f);
  builder.profile(pelvis, "armor", [
    { y: 0.15, radiusX: 0.31 * bulk, radiusZ: 0.2 },
    { y: 0.2, radiusX: 0.32 * bulk, radiusZ: 0.2 },
  ], palette.accent);
  for (const side of [-1, 1]) {
    builder.panel(pelvis, "cloth", [[-0.12, 0.12], [0.12, 0.12], [0.17, -0.24], [0, -0.31], [-0.16, -0.21]], palette.cloth, [side * 0.16 * bulk, 0.03, 0.14], 0.035, 0.025, [0, side * 0.1, side * 0.03]);
    if (!options.simple) builder.panel(pelvis, "armor", [[-0.09, 0.11], [0.09, 0.11], [0.11, -0.12], [0, -0.18], [-0.1, -0.13]], palette.armor, [side * 0.25 * bulk, 0.05, 0.09], 0.045, 0.03, [0, side * 0.55, 0]);
  }

  const torso = builder.part("joint.torso", root, [0, 1.07, 0]);
  builder.profile(torso, "leather", [
    { y: -0.04, radiusX: 0.2 * bulk, radiusZ: 0.14 },
    { y: 0.1, radiusX: 0.29 * bulk, radiusZ: 0.18 },
    { y: 0.34, radiusX: 0.38 * bulk, radiusZ: 0.2 },
    { y: 0.57, radiusX: 0.39 * bulk, radiusZ: 0.19 },
    { y: 0.7, radiusX: 0.25 * bulk, radiusZ: 0.14 },
  ], palette.cloth);
  if (options.chestStyle) addHeroChestArmor(builder, torso, palette, options.chestStyle);
  else {
    builder.panel(torso, "armor", [[-0.29, 0.5], [-0.24, 0.68], [0, 0.76], [0.24, 0.68], [0.29, 0.5], [0.19, 0.22], [0, 0.12], [-0.19, 0.22]], palette.armor, [0, 0, 0.13], 0.075, 0.035);
    builder.panel(torso, "armor", [[-0.12, 0.48], [0, 0.58], [0.12, 0.48], [0.08, 0.25], [0, 0.2], [-0.08, 0.25]], palette.accent, [0, 0, 0.18], 0.028, 0.012);
    builder.sphere(torso, "armor", [0.095, 0.085, 0.05], palette.accent, [0, 0.1, 0.2]);
  }
  builder.panel(torso, "leather", [[-0.22, 0.18], [0.22, 0.18], [0.18, 0.04], [-0.18, 0.04]], 0x4c4037, [0, 0, 0.15], 0.035, 0.01);

  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = builder.part(`joint.leg.${side < 0 ? "left" : "right"}`, root, [side * 0.17 * bulk, 0.91, 0]);
    builder.profile(leg, "leather", [
      { y: -0.02, radiusX: 0.105 * bulk, radiusZ: 0.11 },
      { y: -0.32, radiusX: 0.13 * bulk, radiusZ: 0.13 },
      { y: -0.45, radiusX: 0.1 * bulk, radiusZ: 0.11 },
    ], 0x484640);
    if (!options.simple) {
      builder.panel(leg, "armor", [[-0.085, 0.1], [0.085, 0.1], [0.1, -0.11], [0, -0.17], [-0.095, -0.11]], palette.armor, [0, -0.19, 0.11], 0.045, 0.025);
      builder.sphere(leg, "armor", [0.11 * bulk, 0.095, 0.13], palette.accent, [0, -0.45, 0.07]);
    } else builder.sphere(leg, "armor", [0.105, 0.09, 0.12], palette.armor, [0, -0.43, 0.065]);
    const shin = builder.part(`joint.shin.${side < 0 ? "left" : "right"}`, leg, [0, -0.13, 0]);
    builder.profile(shin, "leather", [
      { y: -0.02, radiusX: 0.095, radiusZ: 0.105 },
      { y: -0.25, radiusX: 0.083, radiusZ: 0.1 },
      { y: -0.56, radiusX: 0.075, radiusZ: 0.085 },
    ], 0x453e37);
    builder.panel(shin, "armor", [[-0.075, 0.16], [0.075, 0.16], [0.065, -0.11], [0, -0.2], [-0.07, -0.12]], palette.armor, [0, -0.09, 0.08], 0.042, 0.02);
    builder.profile(shin, "leather", [
      { y: -0.58, radiusX: 0.11, radiusZ: 0.17 },
      { y: -0.73, x: 0, z: 0.055, radiusX: 0.12, radiusZ: 0.22 },
      { y: -0.77, x: 0, z: 0.06, radiusX: 0.1, radiusZ: 0.2 },
    ], 0x51453b);
    legs.push(leg);
  }

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    const arm = builder.part(`joint.arm.${label}`, torso, [side * 0.38 * bulk, 0.52, 0]);
    builder.sphere(arm, "armor", [0.185 * bulk, 0.16, 0.17], palette.armor, [0, 0, 0.015]);
    builder.panel(arm, "armor", [[-0.13, 0.12], [0.12, 0.12], [0.17, -0.04], [0.08, -0.17], [-0.13, -0.08]], palette.accent, [0, 0.005, 0.105], 0.045, 0.03, [0, 0, side * 0.08]);
    builder.profile(arm, "leather", [
      { y: -0.03, radiusX: 0.12, radiusZ: 0.12 },
      { y: -0.2, radiusX: 0.13, radiusZ: 0.12 },
      { y: -0.33, radiusX: 0.1, radiusZ: 0.1 },
    ], palette.cloth);
    const forearm = builder.part(`joint.forearm.${label}`, arm, [0, -0.31, 0]);
    builder.profile(forearm, "leather", [
      { y: 0.02, radiusX: 0.095, radiusZ: 0.1 },
      { y: -0.16, radiusX: 0.115, radiusZ: 0.11 },
      { y: -0.34, radiusX: 0.085, radiusZ: 0.085 },
    ], palette.cloth);
    if (!options.simple) builder.panel(forearm, "armor", [[-0.08, 0.14], [0.08, 0.14], [0.07, -0.12], [0, -0.19], [-0.075, -0.12]], palette.armor, [0, -0.085, 0.085], 0.045, 0.024, [0, 0, side * -0.06]);
    builder.profile(forearm, "leather", [
      { y: -0.33, radiusX: 0.08, radiusZ: 0.09 },
      { y: -0.38, radiusX: 0.11, radiusZ: 0.1 },
    ], 0x403b35);
    const hand = builder.part(`joint.hand.${label}`, forearm, [0, -0.39, 0.01]);
    builder.sphere(hand, "leather", [0.095, 0.09, 0.085], 0x665448, [0, -0.035, 0.01]);
    arms.push(hand);
  }

  const head = builder.part("joint.head", torso, [0, 0.69, 0]);
  builder.profile(head, "skin", [
    { y: 0.04, radiusX: 0.12, radiusZ: 0.105, z: 0.012 },
    { y: 0.13, radiusX: 0.17, radiusZ: 0.14, z: 0.012 },
    { y: 0.3, radiusX: 0.18, radiusZ: 0.145, z: 0.0 },
    { y: 0.43, radiusX: 0.145, radiusZ: 0.13, z: -0.005 },
    { y: 0.51, radiusX: 0.08, radiusZ: 0.08, z: -0.005 },
  ], 0xb98c70);
  builder.sphere(head, "skin", [0.045, 0.065, 0.06], 0xb98c70, [-0.168, 0.24, 0]);
  builder.sphere(head, "skin", [0.045, 0.065, 0.06], 0xb98c70, [0.168, 0.24, 0]);
  builder.sphere(head, "leather", [0.032, 0.025, 0.017], 0x252c2d, [-0.067, 0.265, 0.132]);
  builder.sphere(head, "leather", [0.032, 0.025, 0.017], 0x252c2d, [0.067, 0.265, 0.132]);
  builder.panel(head, "skin", [[-0.018, 0.08], [0.018, 0.08], [0.045, -0.035], [-0.045, -0.035]], 0xa97760, [0, 0.2, 0.145], 0.022, 0.009);
  if (!options.simple) {
    builder.panel(head, "leather", [[-0.12, 0.03], [0.12, 0.03], [0.105, -0.025], [-0.105, -0.025]], 0x684c40, [0, 0.125, 0.14], 0.025, 0.008);
    builder.panel(head, "leather", [[-0.105, 0.04], [-0.035, 0.04], [-0.02, 0.022], [-0.105, 0.02]], 0x403b36, [-0.067, 0.286, 0.145], 0.018, 0.006);
    builder.panel(head, "leather", [[0.035, 0.04], [0.105, 0.04], [0.105, 0.02], [0.02, 0.022]], 0x403b36, [0.067, 0.286, 0.145], 0.018, 0.006);
  }

  const mainPivot = builder.part("pivot.weapon.main", arms[1], [0, -0.005, 0.015]);
  const offPivot = builder.part("pivot.weapon.off", arms[0], [0, -0.005, 0.015]);
  createAnchor(builder, root, "head", [0, 2.12, 0.12]);
  createAnchor(builder, root, "weapon.main", [0.54, 1.45, 0.18]);
  createAnchor(builder, root, "weapon.off", [-0.54, 1.45, 0.18]);
  return { torso, head, mainPivot, offPivot };
}

function addRod(builder: UnitBuilder, group: THREE.Group, surface: UnitSurface, color: number, length: number, radius: number, y = 0): void {
  builder.profile(group, surface, [
    { y: y - 0.02, radiusX: radius * 0.88, radiusZ: radius * 0.88 },
    { y: y + length * 0.48, radiusX: radius, radiusZ: radius },
    { y: y + length, radiusX: radius * 0.72, radiusZ: radius * 0.72 },
  ], color, [0, 0, 0], [0, 0, 0], 7);
}

function addSword(builder: UnitBuilder, pivot: THREE.Group, color: number, gold: number, curved = false): void {
  builder.profile(pivot, "leather", [{ y: -0.21, radiusX: 0.034, radiusZ: 0.036 }, { y: -0.04, radiusX: 0.03, radiusZ: 0.034 }], 0x544236, [0, 0, 0.02], [0, 0, 0], 7);
  builder.panel(pivot, "armor", [[-0.16, -0.045], [-0.1, 0.015], [0.1, 0.015], [0.16, -0.045], [0.12, -0.085], [-0.12, -0.085]], gold, [0, 0, 0.02], 0.045, 0.018);
  const blade: readonly (readonly [number, number])[] = curved
    ? [[-0.07, 0.01], [0.03, 0.01], [0.1, 0.36], [0.14, 0.64], [0.04, 0.59], [-0.06, 0.34]]
    : [[-0.065, 0.0], [0.065, 0.0], [0.05, 0.55], [0, 0.76], [-0.05, 0.55]];
  builder.panel(pivot, "armor", blade, color, [0, 0, 0.045], 0.035, 0.018, curved ? [0, 0, -0.035] : [0, 0, 0]);
  builder.profile(pivot, "leather", [{ y: -0.22, radiusX: 0.04, radiusZ: 0.04 }, { y: -0.18, radiusX: 0.05, radiusZ: 0.05 }], gold, [0, 0, 0.02], [0, 0, 0], 7);
}

function addShield(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; cloth: number; team: number; accent: number }, size = 1): void {
  const outline = [[-0.25, 0.34], [-0.18, 0.44], [0.18, 0.44], [0.25, 0.34], [0.22, -0.12], [0, -0.49], [-0.22, -0.12]] as const;
  builder.panel(pivot, "leather", outline, 0x69513a, [0, 0.01, 0], 0.085, 0.035, [0, 0, -0.03], [size, size, 1]);
  builder.panel(pivot, "armor", outline, palette.accent, [0, 0.01, 0.045], 0.07, 0.055, [0, 0, -0.03], [size, size, 1]);
  builder.panel(pivot, "cloth", outline.map(([x, y]) => [x * 0.76, y * 0.78] as const), palette.cloth, [0, 0.01, 0.09], 0.035, 0.025, [0, 0, -0.03], [size, size, 1]);
  builder.panel(pivot, "cloth", [[-0.035, 0.31], [0.035, 0.31], [0.05, -0.2], [0, -0.33], [-0.05, -0.2]], palette.team, [0, 0.01, 0.115], 0.024, 0.012, [0, 0, -0.03], [size, size, 1]);
  for (const [x, y] of [[-0.17, 0.31], [0.17, 0.31], [-0.14, -0.1], [0.14, -0.1], [0, -0.36]])
    builder.sphere(pivot, "armor", [0.026 * size, 0.026 * size, 0.014], palette.accent, [x * size, 0.01 + y * size, 0.14], 0);
}

function addSpear(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; accent: number }): void {
  addRod(builder, pivot, "leather", 0x70553b, 1.54, 0.027, -0.29);
  builder.profile(pivot, "armor", [
    { y: 1.12, radiusX: 0.016, radiusZ: 0.025 },
    { y: 1.28, radiusX: 0.075, radiusZ: 0.04 },
    { y: 1.57, radiusX: 0.002, radiusZ: 0.002 },
  ], palette.armor, [0, 0, 0], [0, 0, 0], 5);
  builder.panel(pivot, "cloth", [[-0.02, 0.18], [0.02, 0.18], [0.2, -0.02], [0.05, 0.02], [0.13, -0.22], [-0.01, -0.08]], palette.accent, [0.01, 0.86, 0.03], 0.018, 0.009, [0, 0, 0.15]);
}

function addDagger(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; accent: number }): void {
  builder.profile(pivot, "leather", [{ y: -0.15, radiusX: 0.027, radiusZ: 0.03 }, { y: -0.02, radiusX: 0.022, radiusZ: 0.026 }], 0x594435, [0, 0, 0.01], [0, 0, 0], 6);
  builder.panel(pivot, "armor", [[-0.045, 0], [0.045, 0], [0.035, 0.28], [0, 0.4], [-0.035, 0.28]], palette.armor, [0, 0, 0.025], 0.024, 0.01);
  builder.panel(pivot, "armor", [[-0.09, -0.01], [-0.055, 0.025], [0.055, 0.025], [0.09, -0.01], [0.05, -0.045], [-0.05, -0.045]], palette.accent, [0, 0, 0.02], 0.026, 0.01);
}

function addStaff(builder: UnitBuilder, pivot: THREE.Group, accent: number, glow: number, halo = false): void {
  addRod(builder, pivot, "leather", 0x725b41, 1.52, 0.032, -0.22);
  builder.profile(pivot, "armor", [
    { y: 1.15, radiusX: 0.12, radiusZ: 0.09 }, { y: 1.26, radiusX: 0.09, radiusZ: 0.08 },
    { y: 1.45, radiusX: 0.035, radiusZ: 0.035 }, { y: 1.57, radiusX: 0.09, radiusZ: 0.08 },
    { y: 1.68, radiusX: 0.13, radiusZ: 0.09 },
  ], accent, [0, 0, 0], [0, 0, 0], 7);
  builder.sphere(pivot, "glow", [0.12, 0.15, 0.12], glow, [0, 1.45, 0.02], 1);
  if (halo) {
    builder.add(pivot, "armor", new THREE.TorusGeometry(0.25, 0.026, 5, 12), accent, [0, 1.55, 0.03], [0, Math.PI / 2, 0]);
  }
}

function addCrossbow(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; accent: number }): void {
  builder.profile(pivot, "leather", [
    { y: -0.14, x: -0.04, radiusX: 0.055, radiusZ: 0.06 },
    { y: 0.02, x: 0, radiusX: 0.055, radiusZ: 0.055 },
    { y: 0.46, x: 0.02, radiusX: 0.035, radiusZ: 0.04 },
  ], 0x765a3c, [0, 0, 0], [0, 0, -Math.PI / 2], 7);
  builder.panel(pivot, "armor", [[-0.44, -0.02], [-0.35, 0.08], [-0.19, 0.08], [0, 0.015], [0.19, 0.08], [0.35, 0.08], [0.44, -0.02], [0.31, -0.16], [0, -0.06], [-0.31, -0.16]], palette.armor, [0, 0.26, 0], 0.045, 0.023);
  builder.panel(pivot, "leather", [[-0.34, 0], [0, -0.13], [0.34, 0], [0.29, -0.045], [0, -0.19], [-0.29, -0.045]], palette.accent, [0, 0.26, 0.035], 0.025, 0.012);
  builder.profile(pivot, "armor", [{ y: 0.06, radiusX: 0.018, radiusZ: 0.018 }, { y: 0.48, radiusX: 0.008, radiusZ: 0.008 }], palette.armor, [0, 0.26, 0.02], [Math.PI / 2, 0, 0], 5);
}

function addBow(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; accent: number }): void {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, -0.5, 0), new THREE.Vector3(0.21, -0.3, 0),
    new THREE.Vector3(0.27, 0, 0), new THREE.Vector3(0.21, 0.3, 0),
    new THREE.Vector3(0.04, 0.5, 0),
  ]);
  const bow = new THREE.TubeGeometry(curve, 12, 0.036, 6, false);
  builder.add(pivot, "leather", bow, 0x765a3f);
  const string = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, -0.5, 0.015), new THREE.Vector3(-0.015, 0, 0.015), new THREE.Vector3(0.04, 0.5, 0.015),
  ]);
  builder.add(pivot, "armor", new THREE.TubeGeometry(string, 5, 0.008, 4, false), palette.armor);
  builder.panel(pivot, "armor", [[-0.04, -0.025], [0.04, -0.025], [0.04, 0.025], [-0.04, 0.025]], palette.accent, [0, 0, 0.03], 0.045, 0.012);
}

function addSiegeLauncher(builder: UnitBuilder, pivot: THREE.Group, palette: { armor: number; accent: number }): void {
  builder.profile(pivot, "armor", [
    { y: -0.18, radiusX: 0.085, radiusZ: 0.08 },
    { y: 0.03, radiusX: 0.13, radiusZ: 0.14 },
    { y: 0.43, radiusX: 0.14, radiusZ: 0.15 },
    { y: 0.65, radiusX: 0.09, radiusZ: 0.1 },
  ], palette.armor, [0, 0.03, 0.14], [Math.PI / 2, 0, 0], 8);
  builder.profile(pivot, "leather", [
    { y: -0.24, radiusX: 0.04, radiusZ: 0.04 },
    { y: 0.18, radiusX: 0.038, radiusZ: 0.038 },
    { y: 0.22, radiusX: 0.052, radiusZ: 0.05 },
  ], 0x71553c, [0, 0, 0], [Math.PI / 2, 0, 0], 7);
  builder.profile(pivot, "glow", [{ y: 0.32, radiusX: 0.095, radiusZ: 0.095 }, { y: 0.37, radiusX: 0.07, radiusZ: 0.07 }], palette.accent, [0, 0, 0.42], [Math.PI / 2, 0, 0], 7);
}

function addHeadgear(builder: UnitBuilder, head: THREE.Group, shape: ShapeSpec, palette: { armor: number; cloth: number; accent: number; team: number }): void {
  const hair = builder.part("head.hair", head);
  const helm = builder.part("head.gear", head);
  builder.profile(hair, "leather", [
    { y: 0.31, radiusX: 0.15, radiusZ: 0.13, z: -0.018 },
    { y: 0.45, radiusX: 0.17, radiusZ: 0.14, z: -0.02 },
    { y: 0.51, radiusX: 0.11, radiusZ: 0.095, z: -0.03 },
  ], 0x4c4038);
  const ridge = (x: number, y: number, height: number, color = palette.accent) => builder.panel(
    helm, "cloth", [[-0.055, 0], [0.055, 0], [0.035, height * 0.68], [0, height], [-0.04, height * 0.68]], color,
    [x, y, 0.02], 0.035, 0.015,
  );
  switch (shape.headgear) {
    case "helm":
      builder.profile(helm, "armor", [
        { y: 0.35, radiusX: 0.19, radiusZ: 0.15, z: -0.015 },
        { y: 0.46, radiusX: 0.2, radiusZ: 0.15, z: -0.02 },
        { y: 0.57, radiusX: 0.13, radiusZ: 0.11, z: -0.025 },
        { y: 0.6, radiusX: 0.05, radiusZ: 0.055, z: -0.025 },
      ], palette.armor);
      builder.panel(helm, "armor", [[-0.2, 0.36], [-0.12, 0.43], [0.12, 0.43], [0.2, 0.36], [0.12, 0.27], [-0.12, 0.27]], palette.accent, [0, 0, 0.075], 0.042, 0.02);
      builder.panel(helm, "leather", [[-0.12, 0.29], [0.12, 0.29], [0.09, 0.26], [-0.09, 0.26]], 0x272f32, [0, 0, 0.11], 0.025, 0.008);
      ridge(0, 0.54, 0.18);
      break;
    case "bastion":
      builder.profile(helm, "armor", [
        { y: 0.32, radiusX: 0.21, radiusZ: 0.16, z: -0.02 },
        { y: 0.48, radiusX: 0.22, radiusZ: 0.16, z: -0.02 },
        { y: 0.58, radiusX: 0.19, radiusZ: 0.13, z: -0.04 },
        { y: 0.64, radiusX: 0.11, radiusZ: 0.09, z: -0.05 },
      ], palette.armor);
      builder.panel(helm, "armor", [[-0.19, 0.34], [-0.1, 0.39], [0.1, 0.39], [0.19, 0.34], [0.17, 0.28], [-0.17, 0.28]], 0x29363b, [0, 0, 0.13], 0.04, 0.01);
      for (const side of [-1, 1]) builder.profile(helm, "armor", [
        { y: 0.39, x: side * 0.17, radiusX: 0.055, radiusZ: 0.06 },
        { y: 0.48, x: side * 0.23, radiusX: 0.04, radiusZ: 0.045 },
        { y: 0.61, x: side * 0.29, radiusX: 0.008, radiusZ: 0.008 },
      ], palette.accent, [0, 0, 0], [0, 0, side * 0.28], 6);
      break;
    case "crest":
      builder.profile(helm, "armor", [
        { y: 0.34, radiusX: 0.19, radiusZ: 0.15, z: -0.02 },
        { y: 0.45, radiusX: 0.2, radiusZ: 0.15, z: -0.03 },
        { y: 0.57, radiusX: 0.13, radiusZ: 0.11, z: -0.03 },
      ], palette.armor);
      builder.panel(helm, "armor", [[-0.2, 0.39], [0, 0.47], [0.2, 0.39], [0.13, 0.3], [-0.13, 0.3]], palette.accent, [0, 0, 0.09], 0.035, 0.018);
      ridge(0, 0.53, 0.34, palette.team);
      break;
    case "duelist":
      builder.profile(helm, "cloth", [
        { y: 0.33, radiusX: 0.18, radiusZ: 0.15, z: -0.02 },
        { y: 0.46, radiusX: 0.15, radiusZ: 0.13, z: -0.04 },
        { y: 0.54, x: -0.08, radiusX: 0.1, radiusZ: 0.1, z: -0.05 },
      ], palette.cloth);
      builder.panel(helm, "leather", [[-0.14, 0.37], [0.14, 0.37], [0.12, 0.32], [-0.12, 0.32]], palette.accent, [0, 0, 0.08], 0.022, 0.01);
      builder.profile(hair, "leather", [
        { y: 0.33, x: 0.12, radiusX: 0.08, radiusZ: 0.07 },
        { y: 0.45, x: 0.2, radiusX: 0.065, radiusZ: 0.07 },
        { y: 0.57, x: 0.27, radiusX: 0.025, radiusZ: 0.03 },
      ], 0x2c2d2a);
      break;
    case "hat":
      builder.profile(helm, "cloth", [
        { y: 0.37, radiusX: 0.33, radiusZ: 0.27 },
        { y: 0.41, radiusX: 0.31, radiusZ: 0.25 },
        { y: 0.43, radiusX: 0.18, radiusZ: 0.15 },
        { y: 0.52, radiusX: 0.13, radiusZ: 0.12 },
        { y: 0.64, radiusX: 0.035, radiusZ: 0.04 },
      ], 0x554941);
      builder.panel(helm, "leather", [[-0.12, 0.45], [0.12, 0.45], [0.1, 0.4], [-0.1, 0.4]], palette.accent, [0, 0, 0.14], 0.024, 0.01);
      break;
    case "winged":
      builder.profile(helm, "armor", [
        { y: 0.34, radiusX: 0.19, radiusZ: 0.15, z: -0.02 },
        { y: 0.47, radiusX: 0.2, radiusZ: 0.15, z: -0.03 },
        { y: 0.58, radiusX: 0.13, radiusZ: 0.11, z: -0.04 },
      ], palette.armor);
      for (const side of [-1, 1]) {
        const wing: readonly (readonly [number, number])[] = [[0, 0.1], [0.13, 0.19], [0.31, 0.28], [0.22, 0.15], [0.4, 0.06], [0.15, 0.08]];
        const points = side < 0 ? wing.map(([x, y]) => [-x, y] as const) : wing;
        builder.panel(helm, "armor", points, palette.accent, [side * 0.13, 0.42, 0], 0.05, 0.025, [0, 0, -side * 0.16]);
      }
      ridge(0, 0.55, 0.15);
      break;
    case "hood":
      builder.panel(helm, "cloth", [[-0.23, 0.25], [-0.2, 0.52], [-0.11, 0.7], [0.1, 0.72], [0.22, 0.51], [0.24, 0.22], [0.15, 0.11], [0, 0.19], [-0.15, 0.1]], palette.cloth, [0, 0, -0.045], 0.075, 0.035);
      builder.panel(helm, "leather", [[-0.15, 0.29], [0.15, 0.29], [0.13, 0.22], [-0.13, 0.22]], palette.accent, [0, 0, 0.125], 0.025, 0.008);
      break;
    case "marksman":
      builder.profile(helm, "leather", [
        { y: 0.35, radiusX: 0.2, radiusZ: 0.16, z: -0.01 },
        { y: 0.45, radiusX: 0.19, radiusZ: 0.15, z: -0.04 },
        { y: 0.55, radiusX: 0.12, radiusZ: 0.11, z: -0.06 },
      ], 0x635746);
      builder.panel(helm, "cloth", [[-0.19, 0.38], [0.19, 0.38], [0.16, 0.32], [-0.16, 0.32]], palette.cloth, [0, 0, 0.1], 0.03, 0.015);
      for (const side of [-1, 1]) builder.sphere(helm, "armor", [0.055, 0.045, 0.026], palette.accent, [side * 0.068, 0.25, 0.16]);
      builder.panel(helm, "armor", [[-0.13, 0.27], [0.13, 0.27], [0.11, 0.23], [-0.11, 0.23]], palette.armor, [0, 0, 0.15], 0.025, 0.008);
      break;
    case "shadow":
      builder.panel(helm, "cloth", [[-0.24, 0.23], [-0.22, 0.52], [-0.08, 0.72], [0.08, 0.68], [0.24, 0.48], [0.19, 0.16], [0.12, 0.1], [0, 0.18], [-0.15, 0.08]], palette.cloth, [0, 0, -0.04], 0.075, 0.03);
      builder.panel(helm, "leather", [[-0.14, 0.25], [0.14, 0.25], [0.1, 0.18], [-0.1, 0.18]], 0x333b41, [0, 0, 0.14], 0.03, 0.008);
      builder.sphere(helm, "glow", [0.028, 0.022, 0.014], 0xc28d63, [0, 0.26, 0.16]);
      break;
    case "oracle": {
      builder.panel(helm, "cloth", [[-0.2, 0.48], [-0.13, 0.72], [0.1, 0.74], [0.2, 0.48], [0.13, 0.25], [-0.12, 0.23]], palette.cloth, [0, 0, -0.045], 0.06, 0.03);
      builder.add(helm, "armor", new THREE.TorusGeometry(0.29, 0.03, 5, 14), palette.accent, [0, 0.5, -0.11]);
      for (const side of [-1, 1]) builder.panel(helm, "cloth", [[-0.035, 0.19], [0.035, 0.19], [0.06, -0.32], [0, -0.38], [-0.05, -0.28]], palette.team, [side * 0.14, 0.25, 0.11], 0.02, 0.009, [0, 0, side * -0.08]);
      break;
    }
    case "engineer":
      builder.profile(helm, "leather", [
        { y: 0.35, radiusX: 0.2, radiusZ: 0.16, z: -0.02 },
        { y: 0.45, radiusX: 0.2, radiusZ: 0.16, z: -0.03 },
        { y: 0.54, radiusX: 0.13, radiusZ: 0.11, z: -0.04 },
      ], 0x64553f);
      builder.panel(helm, "armor", [[-0.18, 0.41], [-0.1, 0.47], [0.1, 0.47], [0.18, 0.41], [0.12, 0.35], [-0.12, 0.35]], palette.armor, [0, 0, 0.1], 0.04, 0.02);
      for (const side of [-1, 1]) builder.sphere(helm, "glow", [0.046, 0.038, 0.021], palette.accent, [side * 0.075, 0.27, 0.16]);
      break;
    case "ranger":
      builder.profile(helm, "cloth", [
        { y: 0.34, radiusX: 0.2, radiusZ: 0.16, z: -0.02 },
        { y: 0.45, radiusX: 0.18, radiusZ: 0.14, z: -0.04 },
        { y: 0.55, radiusX: 0.11, radiusZ: 0.1, z: -0.05 },
      ], palette.cloth);
      for (const side of [-1, 1]) {
        builder.profile(helm, "leather", [
          { y: 0.4, x: side * 0.14, radiusX: 0.05, radiusZ: 0.05 },
          { y: 0.58, x: side * 0.2, radiusX: 0.034, radiusZ: 0.034 },
          { y: 0.77, x: side * 0.24, radiusX: 0.004, radiusZ: 0.004 },
        ], 0x706744, [0, 0, 0], [0, 0, -side * 0.12], 6);
        builder.panel(helm, "cloth", [[-0.055, 0.04], [0.055, 0.04], [0.075, -0.045], [0, -0.1], [-0.07, -0.04]], 0x879170, [side * 0.2, 0.48, 0.08], 0.018, 0.008, [0, 0, side * 0.3]);
      }
      break;
  }
}

function addHeroLoadout(builder: UnitBuilder, root: THREE.Group, pivots: { mainPivot: THREE.Group; offPivot: THREE.Group }, shape: ShapeSpec, palette: { armor: number; cloth: number; team: number; accent: number }): void {
  switch (shape.weapon) {
    case "sword-shield":
      addSword(builder, pivots.mainPivot, palette.armor, palette.accent);
      addShield(builder, pivots.offPivot, palette, 0.82);
      break;
    case "tower-shield":
      addSword(builder, pivots.mainPivot, palette.armor, palette.accent);
      addShield(builder, pivots.offPivot, palette, 1.22);
      break;
    case "spear":
      addSpear(builder, pivots.mainPivot, palette);
      builder.panel(pivots.offPivot, "armor", [[-0.12, 0.25], [0.12, 0.25], [0.18, -0.12], [0, -0.3], [-0.18, -0.12]], palette.accent, [0, 0.08, 0.08], 0.045, 0.025);
      break;
    case "twin-blades":
      addSword(builder, pivots.mainPivot, palette.armor, palette.accent, true);
      addSword(builder, pivots.offPivot, palette.armor, palette.accent, true);
      break;
    case "katana":
      addSword(builder, pivots.mainPivot, palette.armor, palette.accent, true);
      builder.profile(root, "leather", [
        { y: 0.85, x: -0.42, z: -0.25, radiusX: 0.028, radiusZ: 0.035 },
        { y: 1.3, x: -0.48, z: -0.25, radiusX: 0.026, radiusZ: 0.03 },
        { y: 1.7, x: -0.54, z: -0.25, radiusX: 0.02, radiusZ: 0.024 },
      ], 0x4c4037, [0, 0, 0], [0, 0, -0.28], 6);
      break;
    case "two-hand-maul":
      addRod(builder, pivots.mainPivot, "leather", 0x77593b, 1.4, 0.045, -0.18);
      builder.panel(pivots.mainPivot, "armor", [[-0.27, 0.15], [-0.19, 0.32], [0.19, 0.32], [0.27, 0.15], [0.18, -0.1], [-0.18, -0.1]], palette.armor, [0, 1.13, 0.02], 0.1, 0.04);
      builder.panel(pivots.mainPivot, "armor", [[-0.13, 0.18], [0.13, 0.18], [0.13, -0.04], [-0.13, -0.04]], palette.accent, [0, 1.13, 0.085], 0.025, 0.01);
      break;
    case "staff":
      addStaff(builder, pivots.mainPivot, palette.accent, 0x8ea69a);
      break;
    case "crossbow":
      addCrossbow(builder, pivots.mainPivot, palette);
      builder.sphere(pivots.offPivot, "leather", [0.08, 0.1, 0.12], 0x68533e, [0, 0.05, -0.1]);
      for (let index = 0; index < 3; index++) builder.profile(root, "armor", [
        { y: 0.92, x: -0.18 + index * 0.12, z: -0.27, radiusX: 0.012, radiusZ: 0.012 },
        { y: 1.42, x: -0.18 + index * 0.12, z: -0.27, radiusX: 0.009, radiusZ: 0.009 },
      ], palette.accent, [0, 0, 0], [0.12, 0, 0], 5);
      break;
    case "dual-daggers":
      addDagger(builder, pivots.mainPivot, palette);
      addDagger(builder, pivots.offPivot, palette);
      builder.panel(root, "cloth", [[-0.06, 0.34], [0.06, 0.34], [0.24, -0.23], [0.08, -0.1], [0, -0.33], [-0.08, -0.1], [-0.24, -0.23]], palette.cloth, [0, 1.3, -0.28], 0.035, 0.025);
      break;
    case "halo-staff":
      addStaff(builder, pivots.mainPivot, palette.accent, 0xb2ae91, true);
      break;
    case "siege-launcher":
      addSiegeLauncher(builder, pivots.mainPivot, palette);
      builder.profile(root, "leather", [
        { y: 1.06, x: 0.42, z: -0.23, radiusX: 0.14, radiusZ: 0.13 },
        { y: 1.35, x: 0.42, z: -0.23, radiusX: 0.18, radiusZ: 0.14 },
        { y: 1.61, x: 0.42, z: -0.23, radiusX: 0.12, radiusZ: 0.11 },
      ], 0x755f44);
      builder.panel(root, "armor", [[-0.14, 0.05], [0.14, 0.05], [0.1, -0.18], [-0.1, -0.18]], palette.accent, [0.42, 1.12, -0.07], 0.04, 0.02);
      break;
    case "bow":
      addBow(builder, pivots.mainPivot, palette);
      addRod(builder, pivots.offPivot, "armor", palette.armor, 0.48, 0.015, -0.05);
      builder.panel(root, "leather", [[-0.12, 0.1], [0.12, 0.1], [0.13, -0.22], [-0.1, -0.2]], 0x6d573b, [-0.31, 1.35, -0.26], 0.04, 0.018);
      for (let index = 0; index < 4; index++) builder.panel(root, "cloth", [[-0.026, 0.05], [0.026, 0.05], [0.035, -0.06], [0, -0.12], [-0.035, -0.06]], [0x9ca987, 0xb4a576, 0x6c8870, 0xbbae83][index], [-0.4 + index * 0.06, 1.48, -0.18], 0.018, 0.006, [0, 0, -0.25]);
      break;
  }

  if (shape.id === "F01" || shape.id === "F06") {
    const banner = builder.part("hero.standard", root, [shape.id === "F01" ? -0.4 : 0.42, 0, -0.36]);
    addRod(builder, banner, "leather", 0x705c41, 1.15, 0.022, 1.14);
    builder.panel(banner, "cloth", [[0, 2.26], [0.31, 2.18], [0.32, 1.79], [0.22, 1.68], [0.12, 1.8], [0, 1.69]], palette.team, [0, 0, 0], 0.04, 0.018);
    builder.panel(banner, "cloth", [[0.11, 2.08], [0.21, 2.08], [0.21, 1.88], [0.11, 1.88]], palette.accent, [0, 0, 0.027], 0.02, 0.009);
  }
}

function addHeroFarLoadout(builder: UnitBuilder, body: { mainPivot: THREE.Group; offPivot: THREE.Group }, shape: ShapeSpec, palette: { armor: number; cloth: number; team: number; accent: number }): void {
  switch (shape.weapon) {
    case "sword-shield": case "tower-shield":
      addSword(builder, body.mainPivot, palette.armor, palette.accent);
      addShield(builder, body.offPivot, palette, shape.weapon === "tower-shield" ? 1.15 : 0.8);
      break;
    case "spear": addSpear(builder, body.mainPivot, palette); break;
    case "twin-blades": case "katana":
      addSword(builder, body.mainPivot, palette.armor, palette.accent, true);
      addDagger(builder, body.offPivot, palette);
      break;
    case "two-hand-maul":
      addRod(builder, body.mainPivot, "leather", 0x77593b, 1.25, 0.05, -0.16);
      builder.panel(body.mainPivot, "armor", [[-0.22, 0.15], [-0.16, 0.29], [0.16, 0.29], [0.22, 0.15], [0.15, -0.08], [-0.15, -0.08]], palette.armor, [0, 1.05, 0.02], 0.08, 0.03);
      break;
    case "staff": addStaff(builder, body.mainPivot, palette.accent, 0x8ea69a); break;
    case "halo-staff": addStaff(builder, body.mainPivot, palette.accent, 0xb2ae91, true); break;
    case "crossbow": addCrossbow(builder, body.mainPivot, palette); break;
    case "dual-daggers":
      addDagger(builder, body.mainPivot, palette);
      addDagger(builder, body.offPivot, palette);
      break;
    case "siege-launcher": addSiegeLauncher(builder, body.mainPivot, palette); break;
    case "bow": addBow(builder, body.mainPivot, palette); break;
  }
  if (shape.id === "F01" || shape.id === "F06") {
    builder.panel(builder.root, "cloth", [[0, 2.02], [0.22, 1.98], [0.22, 1.72], [0.12, 1.65], [0, 1.7]], palette.team, [shape.id === "F01" ? -0.4 : 0.42, 0, -0.3], 0.03, 0.012);
  }
}

function applyHeroBodyProportions(builder: UnitBuilder, shape: ShapeSpec): void {
  const proportions = HERO_BODY_PROPORTIONS[shape.bodyProfile];
  const torso = builder.joints.torso;
  const pelvis = builder.joints.pelvis;
  const head = builder.joints.head;
  if (!torso || !pelvis || !head) throw new Error(`Hero ${shape.id} does not contain a complete humanoid body rig`);
  torso.scale.set(...proportions.torso);
  pelvis.scale.set(...proportions.pelvis);
  head.scale.setScalar(proportions.head);

  for (const side of [-1, 1] as const) {
    const label = side < 0 ? "left" : "right";
    const arm = builder.joints[`arm.${label}`];
    const leg = builder.joints[`leg.${label}`];
    if (!arm || !leg) throw new Error(`Hero ${shape.id} is missing the ${label} limb rig`);
    arm.scale.set(...proportions.limbs);
    leg.scale.set(proportions.limbs[0], proportions.legHeight, proportions.limbs[2]);
    leg.position.x = side * proportions.legSpread;
  }
}

function attachLod(group: THREE.Group, name: string, entries: readonly { distance: number; build: (root: THREE.Group) => BattlefieldUnitRig }[]): BattlefieldUnitRig {
  const lod = new THREE.LOD();
  lod.name = `${name}.lod`;
  lod.autoUpdate = true;
  let fullRig: BattlefieldUnitRig = { joints: {}, weaponPivots: {}, anchors: {} };
  const levels: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const level = new THREE.Group();
    level.name = `${name}.${index === 0 ? "full" : index === 1 ? "medium" : "far"}`;
    const rig = entry.build(level);
    if (index === 0) fullRig = rig;
    levels.push(level.name);
    lod.addLevel(level, entry.distance);
  }
  group.add(lod);
  group.userData.battlefieldLod = { levels, distances: entries.map(({ distance }) => distance) };
  return fullRig;
}

function buildBattlefieldHeroLevel(
  group: THREE.Group,
  entity: DisplayEntity,
  teamColor: number,
  appearanceKey: string,
  shape: ShapeSpec,
  materials: UnitMaterials,
  detail: DetailLevel,
): BattlefieldUnitRig {
  const team = teamCloth(shape.cloth, teamColor);
  const builder = new UnitBuilder(group, materials, detail);
  const palette = { armor: shape.armor, cloth: team, accent: shape.accent, team, build: shape.build };
  const body = addHumanoidBody(builder, group, palette, {
    scale: HERO_SCALE,
    cape: shape.mantle,
    bulk: shape.build,
    simple: detail !== "full",
    chestStyle: shape.bodyProfile,
  });
  addHeadgear(builder, body.head, shape, palette);
  if (detail === "far") addHeroFarLoadout(builder, body, shape, palette);
  else addHeroLoadout(builder, group, body, shape, palette);
  applyHeroBodyProportions(builder, shape);
  for (const [jointName, [x, y, z]] of Object.entries(shape.stance)) {
    const joint = builder.joints[jointName] ?? (jointName.startsWith("weapon.") ? builder.weaponPivots[jointName.slice("weapon.".length)] : undefined);
    if (!joint) throw new Error(`Hero ${shape.id} references unknown stance joint or pivot: ${jointName}`);
    joint.rotation.set(x, y, z);
  }
  group.userData.heroChestStyle = shape.bodyProfile;
  if (detail !== "far") {
    group.userData.catalogId = entity.catalogId ?? shape.id;
    group.userData.appearanceKey = appearanceKey;
    group.userData.heroName = shape.name;
    group.userData.heroSilhouette = shape.id;
    group.userData.heroBodyProfile = shape.bodyProfile;
    group.userData.heroChestStyle = shape.bodyProfile;
  }
  return builder.finish(detail !== "full");
}

/**
 * Adds an articulated Hero at the supplied group's local ground origin. The parent owns
 * world position and facing; the model faces local +Z. Returns references in the full LOD
 * for deterministic movement/combat presentation.
 */
export function buildBattlefieldHero(
  group: THREE.Group,
  entity: DisplayEntity,
  teamColor: number,
  appearanceKey: string,
): BattlefieldUnitRig {
  const shape = HERO_SHAPES[canonicalHeroKey(entity, appearanceKey)];
  const name = `battlefield-hero-${shape.id.toLowerCase()}`;
  group.name = name;
  const materials = createUnitMaterials();
  const rig = attachLod(group, name, [
    { distance: 0, build: (level) => buildBattlefieldHeroLevel(level, entity, teamColor, appearanceKey, shape, materials, "full") },
    { distance: 18, build: (level) => buildBattlefieldHeroLevel(level, entity, teamColor, appearanceKey, shape, materials, "medium") },
    { distance: 46, build: (level) => buildBattlefieldHeroLevel(level, entity, teamColor, appearanceKey, shape, materials, "far") },
  ]);
  group.userData.catalogId = entity.catalogId ?? shape.id;
  group.userData.appearanceKey = appearanceKey;
  group.userData.heroName = shape.name;
  group.userData.heroSilhouette = shape.id;
  group.userData.heroBodyProfile = shape.bodyProfile;
  group.userData.heroChestStyle = shape.bodyProfile;
  group.userData.heroWeapon = shape.weapon;
  group.userData.battlefieldRig = {
    version: 1,
    generator: "senkei.battlefield-unit.v1",
    level: "full",
    joints: Object.fromEntries(Object.entries(rig.joints).map(([key, part]) => [key, part.name])),
    weaponPivots: Object.fromEntries(Object.entries(rig.weaponPivots).map(([key, part]) => [key, part.name])),
    anchors: Object.fromEntries(Object.entries(rig.anchors).map(([key, part]) => [key, part.name])),
    restPose: rig.restPose,
  };
  return rig;
}

function canonicalMinionKey(appearanceKey: string): "melee" | "ranged" | "siege" {
  const key = appearanceKey.toLowerCase().replaceAll("_", "-");
  if (key.includes("siege")) return "siege";
  if (key.includes("range") || key.includes("archer")) return "ranged";
  return "melee";
}

function buildBattlefieldMinionLevel(
  group: THREE.Group,
  entity: DisplayEntity,
  teamColor: number,
  appearanceKey: string,
  type: "melee" | "ranged" | "siege",
  materials: UnitMaterials,
  detail: DetailLevel,
): BattlefieldUnitRig {
  const team = teamCloth(0x586a61, teamColor);
  const builder = new UnitBuilder(group, materials, detail);
  const palette = { cloth: team, armor: 0x7f8c86, accent: 0xbca168, team, build: 0.92 };
  if (type === "siege") {
    group.scale.setScalar(0.92);
    const carriage = builder.part("minion.siege-carriage", group, [0, 0.3, -0.05]);
    builder.profile(carriage, "leather", [
      { y: -0.11, radiusX: 0.42, radiusZ: 0.56 },
      { y: 0.1, radiusX: 0.47, radiusZ: 0.58 },
      { y: 0.27, radiusX: 0.38, radiusZ: 0.44 },
    ], 0x755d40);
    builder.panel(carriage, "armor", [[-0.42, 0.23], [-0.33, 0.4], [0.33, 0.4], [0.42, 0.23], [0.32, -0.13], [-0.32, -0.13]], palette.armor, [0, 0.05, 0.1], 0.075, 0.03);
    builder.panel(carriage, "cloth", [[-0.23, 0.2], [0.23, 0.2], [0.18, -0.11], [-0.18, -0.11]], team, [0, 0.06, 0.145], 0.035, 0.018);
    for (const side of [-1, 1]) {
      const wheel = builder.part(`minion.siege-wheel.${side < 0 ? "left" : "right"}`, group, [side * 0.45, 0.28, -0.1]);
      builder.profile(wheel, "leather", [
        { y: -0.03, radiusX: 0.26, radiusZ: 0.26 },
        { y: 0.03, radiusX: 0.26, radiusZ: 0.26 },
      ], 0x363a39, [0, 0, 0], [0, 0, Math.PI / 2], 9);
      builder.profile(wheel, "armor", [
        { y: -0.04, radiusX: 0.11, radiusZ: 0.11 },
        { y: 0.04, radiusX: 0.11, radiusZ: 0.11 },
      ], palette.accent, [0, 0, 0], [0, 0, Math.PI / 2], 7);
    }
    const weapon = builder.part("pivot.weapon.main", group, [0, 0.78, 0.08]);
    builder.profile(weapon, "armor", [
      { y: -0.02, radiusX: 0.18, radiusZ: 0.17 },
      { y: 0.24, radiusX: 0.14, radiusZ: 0.14 },
      { y: 0.68, radiusX: 0.11, radiusZ: 0.11 },
    ], 0x626e6a, [0, 0, 0.18], [Math.PI / 2, 0, 0], 8);
    builder.profile(weapon, "leather", [
      { y: -0.05, radiusX: 0.045, radiusZ: 0.045 },
      { y: 0.38, radiusX: 0.04, radiusZ: 0.04 },
      { y: 0.54, radiusX: 0.055, radiusZ: 0.055 },
    ], 0x755a3c, [0, 0, 0.07], [Math.PI / 2, 0, 0], 7);
    builder.sphere(weapon, "glow", [0.08, 0.08, 0.08], palette.accent, [0, 0, 0.61]);
    const crew = builder.part("minion.siege-crew", group, [0, 0, -0.42]);
    builder.profile(crew, "cloth", [
      { y: 0.42, radiusX: 0.23, radiusZ: 0.17 },
      { y: 0.68, radiusX: 0.29, radiusZ: 0.19 },
      { y: 0.88, radiusX: 0.17, radiusZ: 0.15 },
    ], team);
    builder.profile(crew, "skin", [
      { y: 0.82, radiusX: 0.09, radiusZ: 0.09 },
      { y: 1.04, radiusX: 0.12, radiusZ: 0.11 },
      { y: 1.18, radiusX: 0.08, radiusZ: 0.08 },
    ], 0xb68b70, [0, 0, 0.035]);
    const cap = builder.part("minion.siege-helmet", crew);
    builder.profile(cap, "armor", [
      { y: 1.08, radiusX: 0.13, radiusZ: 0.115 },
      { y: 1.18, radiusX: 0.12, radiusZ: 0.11 },
      { y: 1.24, radiusX: 0.04, radiusZ: 0.045 },
    ], palette.armor);
    const pivotOff = builder.part("pivot.weapon.off", crew, [-0.24, 0.55, 0.02]);
    builder.sphere(pivotOff, "armor", [0.08, 0.13, 0.05], palette.accent, [0, 0, 0]);
    createAnchor(builder, group, "head", [0, 1.1, 0.15]);
    createAnchor(builder, group, "weapon.main", [0, 0.96, 0.76]);
    if (detail === "full") {
      group.userData.appearanceKey = appearanceKey;
      group.userData.catalogId = entity.catalogId ?? "minion-siege";
    }
    return builder.finish(detail !== "full");
  }

  const body = addHumanoidBody(builder, group, palette, { scale: MINION_SCALE, cape: false, simple: true, bulk: 0.84 });
  const helmet = builder.part("minion.helmet", body.head);
  builder.profile(helmet, "armor", [
    { y: 0.34, radiusX: 0.17, radiusZ: 0.14, z: -0.02 },
    { y: 0.45, radiusX: 0.18, radiusZ: 0.14, z: -0.02 },
    { y: 0.53, radiusX: 0.1, radiusZ: 0.1, z: -0.03 },
  ], palette.armor);
  builder.panel(helmet, "cloth", [[-0.15, 0.36], [0.15, 0.36], [0.12, 0.31], [-0.12, 0.31]], team, [0, 0, 0.11], 0.025, 0.01);

  if (type === "melee") {
    addRod(builder, body.mainPivot, "leather", 0x73563b, 1.05, 0.024, -0.12);
    builder.profile(body.mainPivot, "armor", [
      { y: 0.83, radiusX: 0.017, radiusZ: 0.026 },
      { y: 1.03, radiusX: 0.085, radiusZ: 0.035 },
      { y: 1.26, radiusX: 0.002, radiusZ: 0.002 },
    ], palette.armor, [0, 0, 0], [0, 0, 0], 5);
    addShield(builder, body.offPivot, { armor: palette.armor, cloth: team, team, accent: palette.accent }, 0.55);
  } else {
    addBow(builder, body.mainPivot, { armor: palette.armor, accent: palette.accent });
    builder.profile(body.offPivot, "leather", [
      { y: 0.03, radiusX: 0.025, radiusZ: 0.025 },
      { y: 0.49, radiusX: 0.012, radiusZ: 0.012 },
    ], palette.accent, [0.08, 0.04, 0], [0, 0, -0.12], 5);
  }
  if (detail === "full") {
    group.userData.appearanceKey = appearanceKey;
    group.userData.catalogId = entity.catalogId ?? `minion-${type}`;
    group.userData.unitClass = type;
  }
  return builder.finish(detail !== "full");
}

/** Adds a world-local Minion whose parent owns position/facing; models face local +Z. */
export function buildBattlefieldMinion(
  group: THREE.Group,
  entity: DisplayEntity,
  teamColor: number,
  appearanceKey: string,
): BattlefieldUnitRig {
  const type = canonicalMinionKey(appearanceKey);
  const name = `battlefield-minion-${type}`;
  group.name = name;
  const materials = createUnitMaterials();
  const rig = attachLod(group, name, [
    { distance: 0, build: (level) => buildBattlefieldMinionLevel(level, entity, teamColor, appearanceKey, type, materials, "full") },
    { distance: 12, build: (level) => buildBattlefieldMinionLevel(level, entity, teamColor, appearanceKey, type, materials, "medium") },
    { distance: 34, build: (level) => buildBattlefieldMinionLevel(level, entity, teamColor, appearanceKey, type, materials, "far") },
  ]);
  group.userData.appearanceKey = appearanceKey;
  group.userData.catalogId = entity.catalogId ?? `minion-${type}`;
  group.userData.unitClass = type;
  group.userData.battlefieldRig = {
    version: 1,
    generator: "senkei.battlefield-unit.v1",
    level: "full",
    joints: Object.fromEntries(Object.entries(rig.joints).map(([key, part]) => [key, part.name])),
    weaponPivots: Object.fromEntries(Object.entries(rig.weaponPivots).map(([key, part]) => [key, part.name])),
    anchors: Object.fromEntries(Object.entries(rig.anchors).map(([key, part]) => [key, part.name])),
  };
  return rig;
}

function monsterKind(appearanceKey: string, entity: DisplayEntity): "grove-brute" | "iron-warden" | "storm-stalker" {
  const key = `${appearanceKey} ${entity.catalogId ?? ""}`.toLowerCase().replaceAll("_", "-");
  if (key.includes("warden")) return "iron-warden";
  if (key.includes("stalker")) return "storm-stalker";
  return "grove-brute";
}

function addMonsterEyes(builder: UnitBuilder, head: THREE.Group, color: number, width = 0.14, z = 0.12): void {
  for (const side of [-1, 1]) builder.sphere(head, "glow", [0.042, 0.03, 0.022], color, [side * width, 0.22, z], 0);
}

function buildGroveBrute(builder: UnitBuilder, root: THREE.Group): void {
  root.scale.setScalar(1.02);
  const body = builder.part("joint.torso", root, [0, 0.58, 0]);
  builder.profile(body, "leather", [
    { y: -0.18, radiusX: 0.38, radiusZ: 0.31 },
    { y: 0.04, radiusX: 0.52, radiusZ: 0.4 },
    { y: 0.52, radiusX: 0.56, radiusZ: 0.37 },
    { y: 0.88, radiusX: 0.43, radiusZ: 0.31 },
    { y: 1.05, radiusX: 0.27, radiusZ: 0.25 },
  ], 0x6c6550);
  builder.panel(body, "armor", [[-0.4, 0.49], [-0.29, 0.82], [0, 0.91], [0.29, 0.82], [0.4, 0.49], [0.18, 0.12], [0, 0.03], [-0.18, 0.12]], 0x827a5c, [0, 0, 0.31], 0.11, 0.08);
  builder.panel(body, "cloth", [[-0.25, 0.52], [-0.18, 0.72], [0, 0.78], [0.18, 0.72], [0.25, 0.52], [0.11, 0.16], [0, 0.12], [-0.11, 0.16]], 0x617056, [0, 0, 0.38], 0.035, 0.02);
  const head = builder.part("joint.head", body, [0, 0.84, 0.12]);
  builder.profile(head, "leather", [
    { y: 0.02, z: 0.02, radiusX: 0.2, radiusZ: 0.17 },
    { y: 0.18, z: 0.04, radiusX: 0.27, radiusZ: 0.24 },
    { y: 0.42, z: 0, radiusX: 0.23, radiusZ: 0.21 },
    { y: 0.54, z: -0.03, radiusX: 0.14, radiusZ: 0.14 },
  ], 0x79745b);
  builder.profile(head, "leather", [
    { y: 0.08, x: 0, z: 0.2, radiusX: 0.13, radiusZ: 0.16 },
    { y: 0.14, x: 0, z: 0.3, radiusX: 0.14, radiusZ: 0.18 },
    { y: 0.22, x: 0, z: 0.34, radiusX: 0.1, radiusZ: 0.13 },
  ], 0x877d61);
  addMonsterEyes(builder, head, 0xd2a15e, 0.12, 0.19);
  for (const side of [-1, 1]) {
    const arm = builder.part(`joint.arm.${side < 0 ? "left" : "right"}`, root, [side * 0.49, 1.04, -0.02]);
    builder.profile(arm, "leather", [
      { y: 0.06, radiusX: 0.24, radiusZ: 0.23 },
      { y: -0.23, x: side * 0.06, radiusX: 0.21, radiusZ: 0.2 },
      { y: -0.51, x: side * 0.14, radiusX: 0.14, radiusZ: 0.15 },
      { y: -0.65, x: side * 0.17, radiusX: 0.16, radiusZ: 0.18 },
    ], 0x615d4c, [0, 0, 0], [0, 0, side * -0.1]);
    builder.panel(arm, "armor", [[-0.19, 0.12], [0.19, 0.12], [0.24, -0.04], [0.11, -0.2], [-0.17, -0.13]], side < 0 ? 0x847d5c : 0x93835f, [0, 0, 0.16], 0.1, 0.06, [0, 0, side * -0.13]);
    for (let claw = 0; claw < 3; claw++) builder.profile(arm, "armor", [
      { y: -0.59, x: side * (0.07 + claw * 0.075), z: 0.12, radiusX: 0.04, radiusZ: 0.045 },
      { y: -0.81, x: side * (0.09 + claw * 0.08), z: 0.2, radiusX: 0.004, radiusZ: 0.004 },
    ], 0xc0aa72, [0, 0, 0], [0, 0, side * 0.08], 5);
    const leg = builder.part(`joint.leg.${side < 0 ? "left" : "right"}`, root, [side * 0.3, 0.38, 0]);
    builder.profile(leg, "leather", [
      { y: 0.05, radiusX: 0.19, radiusZ: 0.2 },
      { y: -0.19, radiusX: 0.18, radiusZ: 0.18 },
      { y: -0.45, x: side * 0.04, radiusX: 0.13, radiusZ: 0.16 },
      { y: -0.55, x: side * 0.04, z: 0.09, radiusX: 0.16, radiusZ: 0.25 },
    ], 0x555649);
    builder.profile(leg, "armor", [
      { y: -0.12, radiusX: 0.14, radiusZ: 0.145 },
      { y: -0.39, radiusX: 0.105, radiusZ: 0.12 },
    ], 0x77745b, [0, 0, 0.11]);
  }
  for (const side of [-1, 1]) {
    builder.profile(body, "armor", [
      { y: 0.83, x: side * 0.16, z: -0.06, radiusX: 0.12, radiusZ: 0.1 },
      { y: 1.06, x: side * 0.25, z: -0.08, radiusX: 0.075, radiusZ: 0.07 },
      { y: 1.25, x: side * 0.32, z: -0.08, radiusX: 0.002, radiusZ: 0.002 },
    ], 0xaaa27a, [0, 0, 0], [0, 0, side * -0.2], 6);
  }
  const mantle = builder.part("joint.cape", root, [0, 1.16, -0.31]);
  builder.panel(mantle, "cloth", [[-0.36, 0], [0.36, 0], [0.49, -0.42], [0.31, -0.71], [0.08, -0.58], [-0.12, -0.78], [-0.4, -0.53]], 0x65775a, [0, 0, 0], 0.045, 0.025);
}

function buildIronWarden(builder: UnitBuilder, root: THREE.Group): void {
  root.scale.setScalar(1.04);
  const torso = builder.part("joint.torso", root, [0, 0.52, 0]);
  builder.profile(torso, "armor", [
    { y: -0.16, radiusX: 0.4, radiusZ: 0.31 },
    { y: 0.0, radiusX: 0.52, radiusZ: 0.39 },
    { y: 0.45, radiusX: 0.58, radiusZ: 0.36 },
    { y: 0.83, radiusX: 0.45, radiusZ: 0.3 },
    { y: 0.98, radiusX: 0.3, radiusZ: 0.25 },
  ], 0x687578);
  builder.panel(torso, "armor", [[-0.41, 0.57], [-0.28, 0.83], [0, 0.94], [0.28, 0.83], [0.41, 0.57], [0.31, 0.13], [0, 0.02], [-0.31, 0.13]], 0x84918e, [0, 0, 0.31], 0.13, 0.075);
  builder.panel(torso, "glow", [[-0.2, 0.46], [-0.1, 0.58], [0, 0.38], [0.1, 0.58], [0.2, 0.46], [0, 0.17]], 0xc4a165, [0, 0, 0.42], 0.026, 0.012);
  const head = builder.part("joint.head", torso, [0, 0.77, 0.02]);
  builder.profile(head, "armor", [
    { y: 0.02, radiusX: 0.18, radiusZ: 0.16 },
    { y: 0.18, radiusX: 0.23, radiusZ: 0.2 },
    { y: 0.4, radiusX: 0.19, radiusZ: 0.16 },
    { y: 0.51, radiusX: 0.12, radiusZ: 0.1 },
  ], 0x778582);
  builder.panel(head, "armor", [[-0.23, 0.27], [-0.17, 0.4], [0, 0.5], [0.17, 0.4], [0.23, 0.27], [0.15, 0.12], [-0.15, 0.12]], 0x53636a, [0, 0, 0.08], 0.07, 0.035);
  builder.panel(head, "leather", [[-0.13, 0.23], [0.13, 0.23], [0.12, 0.2], [-0.12, 0.2]], 0x252f34, [0, 0, 0.125], 0.025, 0.008);
  addMonsterEyes(builder, head, 0xd5a666, 0.095, 0.15);
  for (const side of [-1, 1]) {
    const arm = builder.part(`joint.arm.${side < 0 ? "left" : "right"}`, root, [side * 0.55, 1.06, 0]);
    builder.profile(arm, "armor", [
      { y: 0.04, radiusX: 0.2, radiusZ: 0.2 },
      { y: -0.24, radiusX: 0.19, radiusZ: 0.18 },
      { y: -0.5, radiusX: 0.13, radiusZ: 0.13 },
      { y: -0.63, radiusX: 0.15, radiusZ: 0.17 },
    ], 0x59666a, [0, 0, 0], [0, 0, side * 0.1]);
    builder.panel(arm, "armor", [[-0.18, 0.14], [0.18, 0.14], [0.21, -0.06], [0.08, -0.21], [-0.17, -0.12]], 0x86918b, [0, 0, 0.14], 0.095, 0.045);
    const leg = builder.part(`joint.leg.${side < 0 ? "left" : "right"}`, root, [side * 0.32, 0.35, 0]);
    builder.profile(leg, "armor", [
      { y: 0.04, radiusX: 0.17, radiusZ: 0.17 },
      { y: -0.24, radiusX: 0.16, radiusZ: 0.15 },
      { y: -0.5, radiusX: 0.12, radiusZ: 0.13 },
      { y: -0.58, z: 0.09, radiusX: 0.15, radiusZ: 0.22 },
    ], 0x4f5c60);
    builder.panel(leg, "armor", [[-0.1, 0.14], [0.1, 0.14], [0.11, -0.1], [0, -0.17], [-0.1, -0.1]], 0x798781, [0, -0.1, 0.11], 0.07, 0.03);
  }
  const hammer = builder.part("pivot.weapon.main", builder.joints["arm.right"], [0, -0.64, 0]);
  addRod(builder, hammer, "leather", 0x594b3e, 1.0, 0.04, -0.12);
  builder.panel(hammer, "armor", [[-0.28, 0.16], [-0.2, 0.34], [0.2, 0.34], [0.28, 0.16], [0.19, -0.13], [-0.19, -0.13]], 0x88918b, [0, 0.89, 0.02], 0.12, 0.055);
  builder.panel(hammer, "glow", [[-0.12, 0.1], [0.12, 0.1], [0.12, -0.07], [-0.12, -0.07]], 0xc4a165, [0, 0.89, 0.09], 0.026, 0.01);
  const shield = builder.part("pivot.weapon.off", builder.joints["arm.left"], [0, -0.62, 0.04]);
  addShield(builder, shield, { armor: 0x687578, cloth: 0x59676c, team: 0xb3a26d, accent: 0x929a91 }, 1.08);
}

function buildStormStalker(builder: UnitBuilder, root: THREE.Group): void {
  root.scale.setScalar(0.95);
  const body = builder.part("joint.torso", root, [0, 0.67, -0.03]);
  builder.profile(body, "leather", [
    { y: -0.54, radiusX: 0.24, radiusZ: 0.25 },
    { y: -0.3, radiusX: 0.36, radiusZ: 0.32 },
    { y: 0.0, radiusX: 0.43, radiusZ: 0.36 },
    { y: 0.31, radiusX: 0.37, radiusZ: 0.31 },
    { y: 0.52, radiusX: 0.25, radiusZ: 0.22 },
  ], 0x68776b, [0, 0, 0], [Math.PI / 2, 0, 0]);
  builder.panel(body, "armor", [[-0.26, 0.38], [-0.15, 0.51], [0, 0.59], [0.15, 0.51], [0.26, 0.38], [0.18, 0.12], [0, 0.03], [-0.18, 0.12]], 0x84907d, [0, 0.18, -0.05], 0.06, 0.03);
  const head = builder.part("joint.head", root, [0, 0.94, 0.54]);
  builder.profile(head, "leather", [
    { y: -0.03, z: 0.08, radiusX: 0.14, radiusZ: 0.16 },
    { y: 0.09, z: 0.12, radiusX: 0.19, radiusZ: 0.21 },
    { y: 0.27, z: 0.06, radiusX: 0.16, radiusZ: 0.16 },
    { y: 0.38, z: 0, radiusX: 0.095, radiusZ: 0.12 },
  ], 0x7c8878);
  builder.profile(head, "leather", [
    { y: 0.0, x: 0, z: 0.24, radiusX: 0.08, radiusZ: 0.1 },
    { y: 0.03, x: 0, z: 0.36, radiusX: 0.07, radiusZ: 0.15 },
    { y: 0.08, x: 0, z: 0.44, radiusX: 0.025, radiusZ: 0.08 },
  ], 0x88917c);
  addMonsterEyes(builder, head, 0xd1a66b, 0.095, 0.18);
  for (const side of [-1, 1]) {
    for (const fore of [-1, 1]) {
      const leg = builder.part(`joint.leg.${side < 0 ? "left" : "right"}.${fore < 0 ? "back" : "front"}`, root, [side * 0.27, 0.53, fore * 0.31]);
      builder.profile(leg, "leather", [
        { y: 0.02, radiusX: 0.1, radiusZ: 0.105 },
        { y: -0.23, x: side * 0.04, radiusX: 0.085, radiusZ: 0.09 },
        { y: -0.47, x: side * 0.06, z: 0.04, radiusX: 0.065, radiusZ: 0.08 },
        { y: -0.51, x: side * 0.06, z: 0.09, radiusX: 0.1, radiusZ: 0.15 },
      ], fore > 0 ? 0x5c6d61 : 0x56665d, [0, 0, 0], [0, 0, side * -0.16]);
      builder.profile(leg, "armor", [
        { y: -0.06, radiusX: 0.092, radiusZ: 0.1 },
        { y: -0.21, radiusX: 0.08, radiusZ: 0.08 },
      ], 0x7c8d7a, [0, 0.04, 0.09]);
    }
  }
  const tail = builder.part("joint.cape", root, [0, 0.63, -0.48]);
  builder.profile(tail, "leather", [
    { y: 0, radiusX: 0.12, radiusZ: 0.11 },
    { y: -0.2, x: 0.12, radiusX: 0.1, radiusZ: 0.09 },
    { y: -0.42, x: 0.22, radiusX: 0.075, radiusZ: 0.07 },
    { y: -0.64, x: 0.18, radiusX: 0.06, radiusZ: 0.055 },
  ], 0x596b63, [0, 0, 0], [Math.PI / 2, 0.18, 0.05], 7);
  for (let spike = 0; spike < 4; spike++) builder.panel(body, "armor", [[-0.07, 0.1], [0.07, 0.1], [0.04, -0.02], [0, -0.16], [-0.04, -0.02]], spike % 2 ? 0xb49563 : 0x97a084, [(-1.5 + spike) * 0.15, 0.28 + (spike % 2) * 0.04, -0.06], 0.025, 0.01, [0, 0, (spike - 1.5) * -0.12]);
  const arm = builder.part("joint.arm.right", root, [0.43, 0.94, 0.03]);
  builder.profile(arm, "leather", [{ y: 0.02, radiusX: 0.12, radiusZ: 0.12 }, { y: -0.18, radiusX: 0.085, radiusZ: 0.09 }, { y: -0.33, radiusX: 0.08, radiusZ: 0.08 }], 0x5c6a60);
  const dagger = builder.part("pivot.weapon.main", arm, [0, -0.32, 0.04]);
  addDagger(builder, dagger, { armor: 0x869382, accent: 0xd1a66b });
  const off = builder.part("pivot.weapon.off", root, [-0.43, 0.7, 0.03]);
  addDagger(builder, off, { armor: 0x869382, accent: 0xd1a66b });
}

function buildBattlefieldMonsterLevel(
  group: THREE.Group,
  kind: "grove-brute" | "iron-warden" | "storm-stalker",
  materials: UnitMaterials,
  detail: DetailLevel,
): BattlefieldUnitRig {
  const builder = new UnitBuilder(group, materials, detail);
  if (kind === "iron-warden") buildIronWarden(builder, group);
  else if (kind === "storm-stalker") buildStormStalker(builder, group);
  else buildGroveBrute(builder, group);
  if (kind !== "storm-stalker") group.position.y = 0.24;
  createAnchor(builder, group, "head", kind === "storm-stalker" ? [0, 1.28, 0.5] : [0, 1.9, 0.2]);
  return builder.finish(detail !== "full");
}

/** Adds a world-local neutral Monster whose parent owns position/facing; models face local +Z. */
export function buildBattlefieldMonster(
  group: THREE.Group,
  entity: DisplayEntity,
  appearanceKey: string,
): BattlefieldUnitRig {
  const kind = monsterKind(appearanceKey, entity);
  const name = `battlefield-monster-${kind}`;
  group.name = name;
  const materials = createUnitMaterials();
  const rig = attachLod(group, name, [
    { distance: 0, build: (level) => buildBattlefieldMonsterLevel(level, kind, materials, "full") },
    { distance: 24, build: (level) => buildBattlefieldMonsterLevel(level, kind, materials, "medium") },
    { distance: 58, build: (level) => buildBattlefieldMonsterLevel(level, kind, materials, "far") },
  ]);
  group.userData.appearanceKey = appearanceKey;
  group.userData.catalogId = entity.catalogId ?? `monster-${kind}`;
  group.userData.species = kind;
  group.userData.battlefieldRig = {
    version: 1,
    generator: "senkei.battlefield-unit.v1",
    level: "full",
    joints: Object.fromEntries(Object.entries(rig.joints).map(([key, part]) => [key, part.name])),
    weaponPivots: Object.fromEntries(Object.entries(rig.weaponPivots).map(([key, part]) => [key, part.name])),
    anchors: Object.fromEntries(Object.entries(rig.anchors).map(([key, part]) => [key, part.name])),
  };
  return rig;
}
