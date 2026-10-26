import * as THREE from "three";
export { createHeroModelPreview } from "./renderer-hero-model-preview";
import { fitBattlefieldCameraFrame } from "./battlefield-camera";
import { KnownBaseSites } from "./base-sites";
import { BattlefieldLandmarks } from "./battlefield-landmarks";
import { BattlefieldFog } from "./battlefield-fog";
import { buildBattlefieldLaneGuides } from "./battlefield-lane-guides";
import { applyBattlefieldInformationLayers, type BattlefieldInformationLayers } from "./battlefield-information-layers";
import { buildWorldPresentation, buildWorldCamp } from "./world-presentation";
import { buildBattlefieldTower } from "./battlefield-architecture";
import { buildBattlefieldHero, buildBattlefieldMinion, buildBattlefieldMonster, isSharedUnitMaterial, type BattlefieldUnitRig } from "./battlefield-units";
import { NodeDisplayLayout } from "./node-display-layout";
import { BattlefieldUnitMotionIndex, battlefieldUnitPose, effectiveTrackPoint } from "./battlefield-unit-motion";
import { BattlefieldUnitOrientationIndex } from "./battlefield-unit-orientation";
import { battlefieldUnitRigMotion } from "./battlefield-unit-rig-motion";
import { BattlefieldReplayEffectIndex } from "./battlefield-replay-effects";
import { buildBattlefieldTransitionEffects } from "./battlefield-effect-meshes";
import { battlefieldUnitLodLevel } from "./battlefield-unit-geometry";
import { battlefieldModelGeometrySignature } from "./battlefield-model-signature";
import { presentationCameraOffset, transitionCameraOffset } from "./battlefield-presentation-camera";
import { overlapsProtectedSilhouette, screenRectsOverlap } from "./battlefield-label-collision.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  Replay,
  DisplayState,
  DisplayEntity,
  WorldPoint,
} from "@senkei/replay-contract";

const colors = { azure: 0x48c8d7, vermilion: 0xe9845b, neutral: 0xb5b8ad };
const stone = 0xb0b5a3;
export const HERO_CATALOG = {
  "hero-vanguard": { name: "前衛", role: "frontline" },
  "hero-bulwark": { name: "大盾兵", role: "frontline" },
  "hero-lancer": { name: "槍騎兵", role: "frontline" },
  "hero-duelist": { name: "双剣士", role: "frontline" },
  "hero-ronin": { name: "浪人", role: "frontline" },
  "hero-crusader": { name: "聖騎士", role: "frontline" },
  "hero-ranger": { name: "森の射手", role: "backline" },
  "hero-marksman": { name: "弩兵", role: "backline" },
  "hero-arcanist": { name: "術師", role: "backline" },
  "hero-oracle": { name: "星詠み", role: "backline" },
  "hero-shadow": { name: "影走り", role: "backline" },
  "hero-siege": { name: "攻城砲兵", role: "backline" },
} as const;

export const HERO_CATALOG_BY_ID = {
  F01: { key: "hero-vanguard", name: "Bannerhold", placement: "frontline" },
  F02: { key: "hero-bulwark", name: "Stoneheart", placement: "frontline" },
  F03: { key: "hero-lancer", name: "Breach", placement: "frontline" },
  F04: { key: "hero-duelist", name: "Rook", placement: "frontline" },
  F05: { key: "hero-ronin", name: "Lockstep", placement: "frontline" },
  F06: { key: "hero-crusader", name: "Pathfinder", placement: "frontline" },
  R01: { key: "hero-arcanist", name: "Tempest", placement: "backline" },
  R02: { key: "hero-marksman", name: "Farshot", placement: "backline" },
  R03: { key: "hero-shadow", name: "Farwatch", placement: "backline" },
  R04: { key: "hero-oracle", name: "Lifeline", placement: "backline" },
  R05: { key: "hero-siege", name: "Conductor", placement: "backline" },
  R06: { key: "hero-ranger", name: "Aegis", placement: "backline" },
} as const;

const heroAccents: Record<keyof typeof HERO_CATALOG, number> = {
  "hero-vanguard": 0xb3c6bb,
  "hero-bulwark": 0x728998,
  "hero-lancer": 0xc7a568,
  "hero-duelist": 0xc1b7a0,
  "hero-ronin": 0x7b554d,
  "hero-crusader": 0xdacb99,
  "hero-ranger": 0x74906d,
  "hero-marksman": 0x89917d,
  "hero-arcanist": 0x8880a6,
  "hero-oracle": 0xb5a777,
  "hero-shadow": 0x48515d,
  "hero-siege": 0x777f76,
};

const catalogAppearance: Record<string, string> = {
  f01: "hero-vanguard",
  f02: "hero-bulwark",
  f03: "hero-lancer",
  f04: "hero-duelist",
  f05: "hero-ronin",
  f06: "hero-crusader",
  r01: "hero-arcanist",
  r02: "hero-marksman",
  r03: "hero-shadow",
  r04: "hero-oracle",
  r05: "hero-siege",
  r06: "hero-ranger",
  minion_melee: "minion-melee",
  minion_ranged: "minion-ranged",
  monster_grove_brute: "monster-brute",
  monster_iron_warden: "monster-warden",
  monster_storm_stalker: "monster-stalker",
};

type CueLabelEntry = {
  element: HTMLSpanElement;
  point: THREE.Vector3;
  type: string;
  sourceId?: string;
  targetId?: string;
  entityId?: string;
};

type ProjectedCueLabel = {
  cueLabel: CueLabelEntry;
  projectedX: number;
  projectedY: number;
  order: number;
};

type WorldLabelPlacement = {
  element: HTMLSpanElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  priority: number;
};
type LabelRect = Pick<WorldLabelPlacement, "left" | "right" | "top" | "bottom">;

function ribbon(
  points: readonly WorldPoint[],
  width: number,
  elevation: number,
  yOffset = 0,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, elevation + yOffset, p.y)),
    false,
    "centripetal",
    0.35,
  );
  const steps = Math.max(24, points.length * 16);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const half = width / 2;
    vertices.push(
      p.x + side.x * half,
      p.y,
      p.z + side.z * half,
      p.x - side.x * half,
      p.y,
      p.z - side.z * half,
    );
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, curve };
}

function pointAlongPath(points: readonly WorldPoint[], progress: number) {
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * progress;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const start = points[index];
      const end = points[index + 1];
      const t = length > 0 ? THREE.MathUtils.clamp(remaining / length, 0, 1) : 0;
      return {
        x: THREE.MathUtils.lerp(start.x, end.x, t),
        y: THREE.MathUtils.lerp(start.y, end.y, t),
      };
    }
    remaining -= length;
  }
  return points[0];
}
function box(
  parent: THREE.Object3D,
  size: number[],
  position: number[],
  color: number,
  rotation = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(size as [number, number, number])),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  mesh.position.set(...(position as [number, number, number]));
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function glow(mesh: THREE.Mesh, color: number) {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  materials.forEach((material) => material.dispose());
  mesh.material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
function cone(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  y: number,
  color: number,
  sides = 4,
) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, sides),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  mesh.position.y = y;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
type ScenicInstance = {
  position: [number, number, number];
  color: number;
  scale?: [number, number, number];
  rotation?: [number, number, number];
};
function addSceneryInstances(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  items: ScenicInstance[],
) {
  if (!items.length) {
    geometry.dispose();
    return;
  }
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
    }),
    items.length,
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const transform = new THREE.Object3D();
  items.forEach((item, index) => {
    transform.position.set(...item.position);
    transform.rotation.set(...(item.rotation ?? [0, 0, 0]));
    transform.scale.set(...(item.scale ?? [1, 1, 1]));
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, new THREE.Color(item.color));
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
}
function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.InstancedMesh) node.dispose();
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points) {
      geometries.add(node.geometry);
      const mats = Array.isArray(node.material)
        ? node.material
        : [node.material];
      mats.forEach((material) => { if (!isSharedUnitMaterial(material)) materials.add(material); });
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
function distanceToSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const f = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy);
}
export type BattlefieldCameraMode = "tactical" | "overview";
export type BattlefieldPresentationMode = "tactical" | "cinematic";
export type { BattlefieldInformationLayers } from "./battlefield-information-layers";

export class Battlefield {
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200);
  private controls: OrbitControls;
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private output = new THREE.Scene();
  private outputCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private units = new Map<string, THREE.Group>();
  private effects = new THREE.Group();
  private camps = new THREE.Group();
  private baseSites: KnownBaseSites;
  private battlefieldLandmarks: BattlefieldLandmarks;
  private battlefieldFog: BattlefieldFog;
  private laneGuides: THREE.Group;
  private informationLayers: BattlefieldInformationLayers = { vision: true, lanes: true, engagements: true };
  private state: DisplayState | null = null;
  private playing = false;
  private changedAt = 0;
  private frame = 0;
  private performanceWindowStart = 0;
  private performanceFrameCount = 0;
  private resize: ResizeObserver;
  private mobile = false;
  private pixel = true;
  private destroyed = false;
  private cameraMode: BattlefieldCameraMode = "tactical";
  private presentationMode: BattlefieldPresentationMode = "tactical";
  private userCameraChanged = false;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  private selected: string | null = null;
  private trackedIds: string[] = [];
  private readonly unitLayout = new NodeDisplayLayout();
  private readonly unitMotion: BattlefieldUnitMotionIndex;
  private readonly unitOrientation: BattlefieldUnitOrientationIndex;
  private readonly transitionEffects: BattlefieldReplayEffectIndex;
  private modelOffsets: ReadonlyMap<string, WorldPoint> = new Map();
  private labels: {
    element: HTMLSpanElement;
    point: THREE.Vector3;
    kind: "lane" | "camp";
    desktopTransform?: string;
    mobileTransform?: string;
  }[] = [];
  private entityLabels = new Map<string, HTMLSpanElement>();
  private cueLabels: CueLabelEntry[] = [];
  private cueLayoutSignature = "";
  private silhouetteLayoutSignature = "";
  private protectedSilhouetteRects: LabelRect[] = [];
  private marker = new THREE.Group();
  private focusMarker = new THREE.Group();
  private startPointer = { x: 0, y: 0 };
  readonly canvas: HTMLCanvasElement;
  constructor(
    private host: HTMLElement,
    private replay: Replay,
    private onSelect: (id: string) => void,
    private onFailure: (message: string) => void,
  ) {
    this.unitMotion = new BattlefieldUnitMotionIndex(replay);
    this.unitOrientation = new BattlefieldUnitOrientationIndex(replay);
    this.transitionEffects = new BattlefieldReplayEffectIndex(replay);
    this.battlefieldFog = new BattlefieldFog(this.scene, replay);
    this.gl = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.canvas = this.gl.domElement;
    this.canvas.setAttribute(
      "aria-label",
      "3D戦場。ドラッグで回転、ホイールまたはピンチでズーム",
    );
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.gl.setPixelRatio(1);
    this.gl.info.autoReset = false;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    const authoredBattlefield = Boolean(replay.scene.routes?.length);
    this.gl.toneMappingExposure = authoredBattlefield ? 0.96 : 1.05;
    host.appendChild(this.canvas);
    this.scene.background = new THREE.Color(0x263f4e);
    this.scene.fog = replay.scene.routes?.length
      ? null
      : new THREE.Fog(0x263f4e, 65, 115);
    this.scene.add(new THREE.HemisphereLight(
      0xddefff,
      0x5b6046,
      authoredBattlefield ? 1.15 : 1.6,
    ));
    const sun = new THREE.DirectionalLight(0xffe6b7, authoredBattlefield ? 2.15 : 2.8);
    const { min: mapMin, max: mapMax } = replay.scene.bounds;
    const mapCenterX = (mapMin.x + mapMax.x) / 2;
    const mapCenterZ = (mapMin.y + mapMax.y) / 2;
    const mapSpan = Math.max(mapMax.x - mapMin.x, mapMax.y - mapMin.y, 1);
    if (authoredBattlefield) {
      const lightOffset = mapSpan * 0.72;
      sun.position.set(mapCenterX - lightOffset, mapSpan * 0.9, mapCenterZ + lightOffset);
      sun.target.position.set(mapCenterX, 0, mapCenterZ);
    } else {
      sun.position.set(-10, 23, 12);
    }
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowSpan = authoredBattlefield ? mapSpan * 0.78 : 24;
    Object.assign(sun.shadow.camera, {
      left: -shadowSpan,
      right: shadowSpan,
      top: shadowSpan,
      bottom: -shadowSpan,
      near: 1,
      far: authoredBattlefield ? mapSpan * 2.5 : 70,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.08;
    this.scene.add(sun);
    if (authoredBattlefield) this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0x9fdcec, authoredBattlefield ? 0.62 : 1);
    fill.position.set(
      authoredBattlefield ? mapCenterX + mapSpan * 0.45 : 15,
      authoredBattlefield ? mapSpan * 0.36 : 10,
      authoredBattlefield ? mapCenterZ - mapSpan * 0.55 : -20,
    );
    this.scene.add(fill);
    this.terrain();
    this.battlefieldLandmarks = new BattlefieldLandmarks(this.scene, replay);
    this.baseSites = new KnownBaseSites(this.scene, host, replay);
    for (const camp of replay.scene.camps ?? [])
      this.buildCamp(camp.position, camp.id);
    this.scene.add(this.camps);
    this.laneGuides = buildBattlefieldLaneGuides(this.scene, replay);
    for (const lane of replay.scene.lanes) {
      const element = document.createElement("span");
      element.className = "world-label";
      element.textContent = lane.label;
      host.appendChild(element);
      // Put each name near the middle of its own route. The first waypoint is
      // often the shared base, where three labels collapse into one cluster.
      const p = pointAlongPath(lane.points, 0.48);
      this.labels.push({
        element,
        point: new THREE.Vector3(p.x, lane.elevation + 0.15, p.y),
        kind: "lane",
      });
    }
    for (const camp of replay.scene.camps ?? []) {
      const element = document.createElement("span");
      element.className = "world-label";
      const location = camp.id.replace(/^camp[_-]?/i, "").replaceAll("_", " ");
      element.textContent = `CAMP · ${location.toUpperCase()}`;
      element.style.whiteSpace = "nowrap";
      host.appendChild(element);
      this.labels.push({
        element,
        point: new THREE.Vector3(camp.position.x, 0.9, camp.position.y),
        kind: "camp",
        desktopTransform: "translate(10px, -135%)",
        mobileTransform: location.toLowerCase() === "nw"
          ? "translate(-105%, -135%)"
          : "translate(10px, -135%)",
      });
    }
    this.scene.add(this.effects, this.marker, this.focusMarker);
    for (let j = 0; j < 4; j++)
      box(
        this.marker,
        [0.35, 0.07, 0.09],
        [
          Math.cos((j * Math.PI) / 2) * 0.65,
          0.06,
          Math.sin((j * Math.PI) / 2) * 0.65,
        ],
        0xffd788,
        (j * Math.PI) / 2,
      );
    this.marker.visible = false;
    this.focusMarker.visible = false;
    const focusRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.12, 4, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd788, toneMapped: false }),
    );
    focusRing.rotation.x = Math.PI / 2;
    focusRing.position.y = 0.07;
    this.focusMarker.add(focusRing);
    for (let j = 0; j < 4; j++)
      box(
        this.focusMarker,
        [0.32, 0.07, 0.1],
        [
          Math.cos((j * Math.PI) / 2) * 1.55,
          0.06,
          Math.sin((j * Math.PI) / 2) * 1.55,
        ],
        0xffe5a4,
        (j * Math.PI) / 2,
      );
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: this.target.texture,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.output.add(quad);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.addEventListener("start", () => {
      this.userCameraChanged = true;
    });
    this.controls.minZoom = 0.75;
    this.controls.maxZoom = 2.5;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.25;
    this.canvas.addEventListener("pointerdown", this.pointerDown);
    this.canvas.addEventListener("pointerup", this.pointerUp);
    this.resize = new ResizeObserver(this.layout);
    this.resize.observe(host);
    this.layout();
    this.resetCamera();
    this.render();
  }
  private contextLost = (e: globalThis.Event) => {
    e.preventDefault();
    this.onFailure(
      "WebGLコンテキストが失われました。描画を再試行してください。",
    );
  };
  private pointerDown = (e: PointerEvent) => {
    this.startPointer = { x: e.clientX, y: e.clientY };
  };
  private pointerUp = (e: PointerEvent) => {
    if (
      Math.hypot(
        e.clientX - this.startPointer.x,
        e.clientY - this.startPointer.y,
      ) > 6
    )
      return;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    const pickable = new Set<THREE.Object3D>([
      ...this.units.values(),
      ...this.scene.children.filter(object => typeof object.userData.entityId === "string"),
    ]);
    const hit = ray.intersectObjects([...pickable], true)[0];
    if (hit) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.entityId) node = node.parent;
      if (node) this.onSelect(node.userData.entityId);
    }
  };
  private layout = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    const mobile = w < 700;
    this.mobile = mobile;
    this.gl.setSize(w, h);
    this.target.setSize(
      Math.max(1, Math.floor(w / (this.pixel ? 2 : 1))),
      Math.max(1, Math.floor(h / (this.pixel ? 2 : 1))),
    );
    // Refit only the frustum's aspect. The controls target, orbit, pan, zoom,
    // selection, and camera mode belong to the replay workspace and survive
    // a host resize or tab becoming visible again.
    this.updateFrustum(this.camera.top);
  };
  resetCamera() {
    this.trackedIds = [];
    this.cameraMode = "tactical";
    this.userCameraChanged = false;
    this.focusMarker.visible = false;
    if (this.replay.scene.routes?.length) {
      this.fitAuthoredCamera("tactical");
      return;
    }
    this.fitLegacyCamera();
  }
  private updateFrustum(halfHeight: number) {
    const aspect = Math.max(
      0.25,
      this.host.clientWidth / Math.max(1, this.host.clientHeight),
    );
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }
  private fitLegacyCamera() {
    const { min, max } = this.replay.scene.bounds;
    const center = new THREE.Vector3(
      (min.x + max.x) / 2,
      0,
      (min.y + max.y) / 2,
    );
    this.controls.enableDamping = false;
    // Consume any orbit or pan delta left by damping before writing the reset
    // pose, or OrbitControls would apply that old gesture to the overview.
    this.controls.update();
    const offset = this.mobile
      ? new THREE.Vector3(10, 46, 18)
      : new THREE.Vector3(17, 38, 31);
    this.camera.position.copy(center).add(offset);
    this.camera.zoom = 1;
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    const direction = center.clone().sub(this.camera.position).normalize();
    const right = new THREE.Vector3()
      .crossVectors(direction, this.camera.up)
      .normalize();
    const screenUp = new THREE.Vector3()
      .crossVectors(right, direction)
      .normalize();
    let horizontal = 0,
      vertical = 0;
    for (const x of [min.x, max.x])
      for (const z of [min.y, max.y])
        for (const y of [-1, 5]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          horizontal = Math.max(horizontal, Math.abs(corner.dot(right)));
          vertical = Math.max(vertical, Math.abs(corner.dot(screenUp)));
        }
    const aspect = Math.max(0.25, this.host.clientWidth / this.host.clientHeight);
    const halfHeight = Math.max(vertical, horizontal / aspect) * 1.18;
    this.updateFrustum(halfHeight);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  private authoredCameraOffset(
    purpose: "strategic" | "overview" | "follow" = "strategic",
    forward?: THREE.Vector2 | null,
  ) {
    let offset: THREE.Vector3;
    if (purpose === "follow" && forward) {
      const horizontal = this.mobile ? 22 : 24;
      const height = this.mobile ? 28 : 27;
      // A quarter view reveals single-file equipment and keeps the route ahead.
      offset = new THREE.Vector3(
        -forward.x * horizontal * 0.7 + forward.y * horizontal * 0.8,
        height,
        -forward.y * horizontal * 0.7 - forward.x * horizontal * 0.8,
      );
    } else if (purpose === "overview" && !this.mobile) {
      offset = new THREE.Vector3(12, 68, 48);
    } else if (this.mobile) {
      offset = purpose === "follow"
        ? new THREE.Vector3(22, 28, 0)
        : new THREE.Vector3(32, 50, 0);
    } else if (purpose === "follow") {
      offset = new THREE.Vector3(0, 27, 24);
    } else {
      offset = new THREE.Vector3(0, 55, 32);
    }
    const adjusted = presentationCameraOffset(offset, this.presentationMode);
    return new THREE.Vector3(adjusted.x, adjusted.y, adjusted.z);
  }
  private projectedFrameHalfHeight(
    center: THREE.Vector3,
    points: readonly THREE.Vector3[],
    purpose: "strategic" | "overview" | "follow" = "strategic",
    forward?: THREE.Vector2 | null,
    fitScale = 1.16,
  ) {
    return fitBattlefieldCameraFrame({
      center, points, cameraOffset: this.authoredCameraOffset(purpose, forward),
      viewport: { width: this.host.clientWidth, height: this.host.clientHeight },
      verticalExtents: [-1, 5], fitScale, padding: 0.35,
      minimumHalfHeight: purpose === "follow" ? 5 : 6.5,
    }).halfHeight;
  }

  private authoredOverviewHalfHeight(center: THREE.Vector3) {
    const { min, max } = this.replay.scene.bounds;
    const corners = [min.x, max.x].flatMap((x) =>
      [min.y, max.y].map((z) => new THREE.Vector3(x, 0, z)),
    );
    // Overview is already bounded by the full authorized World extents. Keep
    // only a small breathing margin so the actual geography fills the stage.
    return this.projectedFrameHalfHeight(center, corners, "overview", null, 1.045) * 1.015;
  }
  private visibleCameraEntities(): DisplayEntity[] {
    if (this.state) return Object.values(this.state.entities);
    return this.replay.initialView.map((entity) => ({ ...entity, destroyed: false }));
  }
  private tacticalCameraFrame() {
    const subjects = this.tacticalSubjects();
    const framePoints = new Map<string, THREE.Vector3>();
    const include = (point: THREE.Vector3) => {
      framePoints.set(`${point.x.toFixed(3)}:${point.z.toFixed(3)}`, point);
    };
    const center = subjects.length
      ? subjects.reduce(
          (sum, entity) => {
            sum.x += entity.position.x;
            sum.z += entity.position.y;
            return sum;
          },
          new THREE.Vector3(),
        ).multiplyScalar(1 / subjects.length)
      : new THREE.Vector3(
          (this.replay.scene.bounds.min.x + this.replay.scene.bounds.max.x) / 2,
          0,
          (this.replay.scene.bounds.min.y + this.replay.scene.bounds.max.y) / 2,
        );
    for (const entity of subjects)
      include(new THREE.Vector3(entity.position.x, 0, entity.position.y));

    // Frame a local piece of the real map around the authorized frontline.
    // Geometry supplies terrain context, but never decides where hidden
    // entities are or pulls Tactical back out to the full map.
    const contextRadius = 12;
    const near = (point: WorldPoint) =>
      Math.hypot(point.x - center.x, point.y - center.z) <= contextRadius;
    for (const lane of this.replay.scene.lanes)
      for (const point of lane.points)
        if (near(point)) include(new THREE.Vector3(point.x, 0, point.y));
    for (const route of this.replay.scene.routes ?? [])
      for (const point of route.points)
        if (near(point)) include(new THREE.Vector3(point.x, 0, point.y));
    for (const entity of this.visibleCameraEntities())
      if (entity.kind !== "unit" && near(entity.position))
        include(new THREE.Vector3(entity.position.x, 0, entity.position.y));
    if (!framePoints.size) {
      include(center.clone());
    }
    const points = [...framePoints.values()];
    const maxHalfHeight = this.mobile ? 12 : 13;
    const minHalfHeight = this.mobile ? 9 : 10.5;
    return {
      center,
      halfHeight: THREE.MathUtils.clamp(
        this.projectedFrameHalfHeight(center, points, "strategic", null, 1.12),
        minHalfHeight,
        maxHalfHeight,
      ),
    };
  }
  private strategicViewportFit(
    center: THREE.Vector3,
    halfHeight: number,
    purpose: "strategic" | "overview" = "strategic",
  ) {
    const hostHeight = Math.max(1, this.host.clientHeight);
    const top = Math.min(this.mobile ? 58 : 50, hostHeight * 0.3);
    const bottom = Math.min(16, hostHeight * 0.1);
    const fit = fitBattlefieldCameraFrame({
      center, points: [], cameraOffset: this.authoredCameraOffset(purpose),
      viewport: { width: this.host.clientWidth, height: hostHeight, insets: { top, bottom } },
      verticalExtents: [center.y, center.y],
      minimumHalfHeight: halfHeight / Math.max(0.01, (hostHeight - top - bottom) / hostHeight),
    });
    return { center: new THREE.Vector3(fit.center.x, fit.center.y, fit.center.z), halfHeight: fit.halfHeight };
  }

  private authoredCloseHalfHeight() {
    const { min, max } = this.replay.scene.bounds;
    return Math.max(
      5.5,
      Math.min(12, Math.max(max.x - min.x, max.y - min.y) * 0.08),
    );
  }
  private followForward(entities: readonly DisplayEntity[]): THREE.Vector2 | null {
    const focus = entities.find((entity) => entity.side !== "neutral") ?? entities[0];
    if (!focus) return null;
    if (focus.kind === "bridge" || focus.kind === "observation") {
      const site = focus.battlefield?.bridgeSite;
      const route = this.replay.scene.routes?.find(candidate => focus.kind === "observation"
        ? candidate.bridgeKind === "facility" && candidate.points.some(point =>
            Math.hypot(point.x - focus.position.x, point.y - focus.position.y) < 1e-5)
        : candidate.bridgeSite === site);
      if (route) {
        const first = route.points[0]!, last = route.points[route.points.length - 1]!;
        const direction = new THREE.Vector2(last.x - first.x, last.y - first.y);
        if (direction.lengthSq() > 0.0001) return direction.normalize();
      }
    }
    const destination = focus.side === "neutral"
      ? undefined
      : this.replay.scene.baseSites?.find((site) => site.side !== focus.side)?.position;
    if (destination) {
      const direction = new THREE.Vector2(
        destination.x - focus.position.x,
        destination.y - focus.position.y,
      );
      if (direction.lengthSq() > 0.0001) return direction.normalize();
    }
    const visibleThreat = this.visibleCameraEntities()
      .filter((entity) =>
        entity.kind === "unit" &&
        !entity.destroyed &&
        entity.side !== focus.side &&
        entity.side !== "neutral",
      )
      .sort((left, right) => {
        const leftDistance = Math.hypot(
          left.position.x - focus.position.x,
          left.position.y - focus.position.y,
        );
        const rightDistance = Math.hypot(
          right.position.x - focus.position.x,
          right.position.y - focus.position.y,
        );
        return leftDistance - rightDistance || left.id.localeCompare(right.id);
      })[0];
    if (!visibleThreat) return null;
    const direction = new THREE.Vector2(
      visibleThreat.position.x - focus.position.x,
      visibleThreat.position.y - focus.position.y,
    );
    return direction.lengthSq() > 0.0001 ? direction.normalize() : null;
  }
  private tacticalSubjects(): DisplayEntity[] {
    const units = this.visibleCameraEntities().filter((entity) =>
      entity.kind === "unit" && !entity.destroyed,
    );
    if (!units.length) return [];
    const eventIds = new Set<string>();
    for (const cue of this.state?.cues ?? []) {
      if (cue.tick !== this.state?.tick) continue;
      if (cue.type === "attack" || cue.type === "skill") {
        eventIds.add(cue.entityId);
        eventIds.add(cue.targetId);
      } else if (cue.type === "damage" || cue.type === "destroy" || cue.type === "move") {
        eventIds.add(cue.entityId);
      }
    }
    const eventUnits = units.filter((entity) => eventIds.has(entity.id));
    const candidates = eventUnits.length ? eventUnits : units;
    const clusterRadius = 12;
    const midpoint = new THREE.Vector2(
      (this.replay.scene.bounds.min.x + this.replay.scene.bounds.max.x) / 2,
      (this.replay.scene.bounds.min.y + this.replay.scene.bounds.max.y) / 2,
    );
    let best: DisplayEntity[] = [];
    let bestScore = -Infinity;
    let bestKey = "";
    for (const anchor of candidates) {
      const cluster = candidates.filter((entity) =>
        Math.hypot(
          entity.position.x - anchor.position.x,
          entity.position.y - anchor.position.y,
        ) <= clusterRadius,
      );
      const heroes = cluster.filter((entity) => this.isHero(entity)).length;
      let opposingPairs = 0;
      for (let left = 0; left < cluster.length; left++)
        for (let right = left + 1; right < cluster.length; right++) {
          const a = cluster[left]!;
          const b = cluster[right]!;
          if (a.side !== "neutral" && b.side !== "neutral" && a.side !== b.side)
            opposingPairs++;
        }
      const eventCount = cluster.filter((entity) => eventIds.has(entity.id)).length;
      const centerDistance = Math.hypot(
        anchor.position.x - midpoint.x,
        anchor.position.y - midpoint.y,
      );
      const score = cluster.length + heroes * 2 + opposingPairs * 5 + eventCount * 4 - centerDistance * 0.025;
      const key = cluster.map((entity) => entity.id).sort().join("|");
      if (score > bestScore || (score === bestScore && key < bestKey)) {
        best = cluster;
        bestScore = score;
        bestKey = key;
      }
    }
    return best.sort((left, right) => left.id.localeCompare(right.id));
  }
  private fitAuthoredCamera(mode: BattlefieldCameraMode) {
    const tactical = mode === "tactical" ? this.tacticalCameraFrame() : null;
    const cameraPurpose = mode === "overview" ? "overview" : "strategic";
    const target = tactical?.center ?? new THREE.Vector3(
      (this.replay.scene.bounds.min.x + this.replay.scene.bounds.max.x) / 2,
      0,
      (this.replay.scene.bounds.min.y + this.replay.scene.bounds.max.y) / 2,
    );
    const boundsHalfHeight = this.authoredOverviewHalfHeight(target);
    // Tactical frames the current authorized unit cluster. Overview includes
    // the complete World bounds; Follow frames the tracked entity.
    const halfHeight = tactical?.halfHeight ?? boundsHalfHeight;
    const safeFrame = this.strategicViewportFit(target, halfHeight, cameraPurpose);
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(safeFrame.center);
    this.camera.position.copy(safeFrame.center).add(this.authoredCameraOffset(cameraPurpose));
    this.camera.zoom = 1;
    this.camera.lookAt(safeFrame.center);
    this.updateFrustum(safeFrame.halfHeight);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  setCameraMode(mode: BattlefieldCameraMode) {
    this.trackedIds = [];
    this.focusMarker.visible = false;
    this.userCameraChanged = false;
    if (!this.replay.scene.routes?.length) {
      // G1 sample fixtures keep their original camera and picking projection.
      this.cameraMode = "tactical";
      this.fitLegacyCamera();
      return;
    }
    this.cameraMode = mode;
    this.fitAuthoredCamera(mode);
  }
  /** Selects the rendering emphasis without changing the replay or information authorization. */
  setPresentationMode(mode: BattlefieldPresentationMode) {
    const previous = this.presentationMode;
    this.presentationMode = mode;
    this.canvas.dataset.presentationMode = mode;
    this.gl.toneMappingExposure = mode === "tactical" ? 0.96 : 1.04;
    this.scene.background = new THREE.Color(mode === "tactical" ? 0x263f4e : 0x22353d);
    if (previous === mode || !this.replay.scene.routes?.length) return;
    if (!this.userCameraChanged) {
      if (this.trackedIds.length) this.frameTracked(this.trackedIds);
      else this.fitAuthoredCamera(this.cameraMode);
      return;
    }
    this.controls.enableDamping = false;
    this.controls.update();
    const target = this.controls.target.clone();
    const currentOffset = this.camera.position.clone().sub(target);
    const adjusted = transitionCameraOffset(currentOffset, previous, mode);
    this.camera.position.copy(target).add(new THREE.Vector3(adjusted.x, adjusted.y, adjusted.z));
    this.camera.lookAt(target);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  setInformationLayers(layers: BattlefieldInformationLayers) {
    this.informationLayers = { ...layers };
    this.canvas.dataset.informationLayers = JSON.stringify(this.informationLayers);
    applyBattlefieldInformationLayers(layers, {
      fog: this.battlefieldFog,
      laneGuides: this.laneGuides,
      effects: this.effects,
      laneLabels: this.labels.map(({ element }) => element),
      entityLabels: this.entityLabels.values(),
      engagementLabels: this.cueLabels.map(({ element }) => element),
    });
  }
  focusPoint(point: WorldPoint) {
    this.trackedIds = [];
    this.focusMarker.visible = true;
    this.userCameraChanged = true;
    const shouldFrameTactical =
      Boolean(this.replay.scene.routes?.length) && this.cameraMode !== "tactical";
    if (shouldFrameTactical) this.fitAuthoredCamera("tactical");
    this.cameraMode = "tactical";
    if (this.replay.scene.routes?.length) {
      this.updateFrustum(this.authoredCloseHalfHeight());
      this.camera.zoom = 1;
    }
    const destination = new THREE.Vector3(point.x, 0, point.y);
    const delta = destination.clone().sub(this.controls.target);
    this.controls.target.copy(destination);
    this.camera.position.add(delta);
    this.focusMarker.position.set(point.x, this.height(point), point.y);
    this.controls.update();
  }
  setTrackingGroup(ids: readonly string[]) {
    const visible = ids.filter((id) => {
      const entity = this.state?.entities[id];
      return Boolean(entity && !entity.destroyed);
    });
    if (!visible.length) {
      this.resetCamera();
      return;
    }
    if (
      visible.length === this.trackedIds.length &&
      visible.every((id, index) => id === this.trackedIds[index])
    )
      return;
    this.focusMarker.visible = false;
    if (!this.replay.scene.routes?.length) {
      this.trackedIds = [visible[0]];
      return;
    }
    this.trackedIds = visible;
    this.userCameraChanged = false;
    this.cameraMode = "tactical";
    this.frameTracked(visible);
  }
  setTracking(id: string | null) {
    if (!id) {
      this.resetCamera();
      return;
    }
    const entity = this.state?.entities[id];
    if (!entity || entity.destroyed) return;
    if (this.trackedIds.length === 1 && this.trackedIds[0] === id) return;
    this.focusMarker.visible = false;
    if (!this.replay.scene.routes?.length) {
      this.trackedIds = [id];
      return;
    }
    this.trackedIds = [id];
    this.userCameraChanged = false;
    this.cameraMode = "tactical";
    this.frameTracked([id]);
  }
  private frameTracked(ids: readonly string[]) {
    const entities = ids
      .map((id) => this.state?.entities[id])
      .filter((entity): entity is DisplayEntity => Boolean(entity && !entity.destroyed));
    if (!entities.length) return;
    const center = entities.reduce(
      (sum, entity) => {
        const point = this.renderPoint(entity);
        sum.x += point.x;
        sum.y += this.height(point);
        sum.z += point.y;
        return sum;
      },
      new THREE.Vector3(),
    ).multiplyScalar(1 / entities.length);
    const forward = this.followForward(entities);
    const unitFocus = entities.every(entity => entity.kind === "unit");
    const groupPoints = entities.map(entity => {
      const point = this.renderPoint(entity);
      return new THREE.Vector3(point.x, 0, point.y);
    });
    if (forward && unitFocus) {
      groupPoints.push(new THREE.Vector3(center.x + forward.x * 6.5, 0, center.z + forward.y * 6.5));
      for (const threat of this.visibleCameraEntities()) {
        if (
          threat.kind !== "unit" ||
          threat.destroyed ||
          threat.side === "neutral" ||
          threat.side === entities[0]!.side
        ) continue;
        const dx = threat.position.x - center.x;
        const dz = threat.position.y - center.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= 9.5 && dx * forward.x + dz * forward.y > 0)
          groupPoints.push(new THREE.Vector3(threat.position.x, 0, threat.position.y));
      }
    }
    const groupHalfHeight = Math.max(
      this.projectedFrameHalfHeight(center, groupPoints, "follow", forward, 1.08),
      unitFocus ? 4.2 : this.mobile ? 6 : 5.5,
    );
    this.cameraMode = "tactical";
    this.controls.enableDamping = false;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(this.authoredCameraOffset("follow", forward));
    this.camera.zoom = 1;
    this.camera.lookAt(center);
    this.updateFrustum(groupHalfHeight);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  zoom(factor: number) {
    this.userCameraChanged = true;
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      0.75,
      2.5,
    );
    this.camera.updateProjectionMatrix();
  }
  setPixel(enabled: boolean) {
    this.pixel = enabled;
    this.target.setSize(
      Math.max(1, Math.floor(this.host.clientWidth / (this.pixel ? 2 : 1))),
      Math.max(1, Math.floor(this.host.clientHeight / (this.pixel ? 2 : 1))),
    );
  }
  select(id: string | null) {
    this.selected = id;
    if (id) this.userCameraChanged = true;
  }
  private height(p: WorldPoint) {
    if (this.replay.scene.routes?.length) {
      let best = Infinity;
      let surface = -0.035;
      for (const lane of this.replay.scene.lanes)
        for (let i = 1; i < lane.points.length; i++) {
          const d = distanceToSegment(p, lane.points[i - 1], lane.points[i]);
          if (d < best) {
            best = d;
            // Authored lane tracks sit at lane elevation - 0.045. Keep feet
            // barely above that path without changing the Replay position.
            surface = lane.elevation - 0.035;
          }
        }
      for (const route of this.replay.scene.routes) {
        if (route.region !== "jungle") continue;
        for (let i = 1; i < route.points.length; i++) {
          const d = distanceToSegment(p, route.points[i - 1], route.points[i]);
          if (d < best) {
            best = d;
            // Jungle tracks are drawn at y=0.037.
            surface = 0.047;
          }
        }
      }
      for (const camp of this.replay.scene.camps ?? []) {
        const d = Math.hypot(p.x - camp.position.x, p.y - camp.position.y);
        if (d <= 3 && d <= best) {
          best = d;
          // Camp ground is level with the continuous ground surface.
          surface = -0.035;
        }
      }
      return surface;
    }
    let best = Infinity,
      height = 0;
    for (const lane of this.replay.scene.lanes)
      for (let i = 1; i < lane.points.length; i++) {
        const d = distanceToSegment(p, lane.points[i - 1], lane.points[i]);
        if (d < best) {
          best = d;
          height = lane.elevation;
        }
      }
    return height + 0.11;
  }
  /** Offset lane tracks from the authoritative centerline for display only. */
  private renderPoint(entity: DisplayEntity): WorldPoint {
    return effectiveTrackPoint(entity, this.replay);
  }
  /** Cosmetic member placement; never used by camera, graph or logical movement. */
  private displayPoint(entity: DisplayEntity): WorldPoint {
    const point = this.renderPoint(entity), offset = this.modelOffsets.get(entity.id);
    return offset ? { x: point.x + offset.x, y: point.y + offset.y } : point;
  }
  private terrain() {
    if (this.replay.scene.routes?.length) {
      buildWorldPresentation(this.scene, this.replay);
      return;
    }
    const { min, max } = this.replay.scene.bounds;
    const w = max.x - min.x + 2,
      d = max.y - min.y + 2,
      cx = (max.x + min.x) / 2,
      cz = (max.y + min.y) / 2;
    box(this.scene, [200, 0.1, 200], [0, -2, 0], 0x263f4e);
    // Keep a restrained ground edge for depth, while letting the map read as
    // open terrain instead of a tall display plinth.
    box(this.scene, [w + 1.4, 0.5, d + 1.4], [cx, -0.35, cz], 0x4d604f);
    box(this.scene, [w, 0.14, d], [cx, -0.09, cz], 0x77846c);

    // Lane ribbons follow the exact points carried by the Replay. Their labels
    // and their separate, wider shoulders keep the three combat corridors
    // readable at overview scale.
    for (const lane of this.replay.scene.lanes) {
      const shoulder = ribbon(
        lane.points,
        4.2,
        Math.max(lane.elevation - 0.14, 0.015),
      );
      const shoulderMesh = new THREE.Mesh(
        shoulder.geometry,
        new THREE.MeshStandardMaterial({
          color: 0x777e62,
          roughness: 1,
          flatShading: true,
        }),
      );
      shoulderMesh.receiveShadow = true;
      this.scene.add(shoulderMesh);
      const road = ribbon(lane.points, 3.2, lane.elevation + 0.015);
      const roadMesh = new THREE.Mesh(
        road.geometry,
        new THREE.MeshStandardMaterial({
          color: 0xc0b99e,
          roughness: 0.92,
          flatShading: true,
        }),
      );
      roadMesh.receiveShadow = true;
      this.scene.add(roadMesh);
      const center = ribbon(lane.points, 0.16, lane.elevation + 0.045);
      const centerMesh = new THREE.Mesh(
        center.geometry,
        new THREE.MeshStandardMaterial({
          color: 0xd7cda9,
          roughness: 1,
          flatShading: true,
        }),
      );
      this.scene.add(centerMesh);
    }

    // Jungle movement corridors come from the versioned logical map through
    // PresentationReplay. Drawing those explicit edges preserves the actual
    // connections between lanes and camps without adding visual-only routes.
    const jungleRoutes = (this.replay.scene.routes ?? []).filter(
      (route) => route.region === "jungle",
    );
    for (const route of jungleRoutes) {
      const shoulder = ribbon(route.points, 2.35, 0.055);
      const shoulderMesh = new THREE.Mesh(
        shoulder.geometry,
        new THREE.MeshStandardMaterial({ color: 0x53664f, roughness: 1, flatShading: true }),
      );
      shoulderMesh.receiveShadow = true;
      shoulderMesh.name = `jungle-route-edge-${route.id}`;
      this.scene.add(shoulderMesh);
      const path = ribbon(route.points, 1.35, 0.075);
      const pathMesh = new THREE.Mesh(
        path.geometry,
        new THREE.MeshStandardMaterial({ color: 0x99866a, roughness: 1, flatShading: true }),
      );
      pathMesh.receiveShadow = true;
      pathMesh.name = `jungle-route-${route.id}`;
      this.scene.add(pathMesh);
    }

    // Reproducible low-poly groves frame open jungle clearings between lanes.
    // One mesh per repeated shape keeps the fixed forest light on draw calls.
    const trunks: ScenicInstance[] = [];
    const lowCanopies: ScenicInstance[] = [];
    const highCanopies: ScenicInstance[] = [];
    const rocks: ScenicInstance[] = [];
    let sceneryIndex = 0;
    const addForestCandidate = (x: number, z: number, seed: number) => {
      if (x < min.x + 0.4 || x > max.x - 0.4 || z < min.y + 0.4 || z > max.y - 0.4)
        return;
      const nearLane = this.replay.scene.lanes.some((l) =>
        l.points
          .slice(1)
          .some((b, j) => distanceToSegment({ x, y: z }, l.points[j], b) < 2.55),
      );
      const routeDistances = jungleRoutes.flatMap((route) =>
        route.points.slice(1).map((end, j) =>
          distanceToSegment({ x, y: z }, route.points[j], end),
        ),
      );
      const nearestRoute = Math.min(...routeDistances);
      const hasRoutes = routeDistances.length > 0;
      const nearRoute = hasRoutes && nearestRoute < 6.5;
      const onRoute = hasRoutes && nearestRoute < 2.15;
      const nearCamp = (this.replay.scene.camps ?? []).some(
        (camp) => Math.hypot(x - camp.position.x, z - camp.position.y) < 3.35,
      );
      if (nearLane || nearCamp || onRoute || (hasRoutes && !nearRoute)) return;
      const size = hasRoutes
        ? 0.66 + (seed % 4) * 0.07
        : 0.82 + (seed % 4) * 0.1;
      const h = (0.35 + (seed % 4) * 0.26) * size;
      if (seed % 7 === 0) {
        rocks.push({
          position: [x, h / 2 - 0.05, z],
          scale: [0.8 + (seed % 3) * 0.16, h, 0.75],
          rotation: [0, (seed % 3) * 0.13, seed % 2 ? 0.14 : -0.14],
          color: seed % 2 ? 0x84916e : 0x768b6a,
        });
      } else {
        trunks.push({
          position: [x, 0.575 * size, z],
          scale: [size, size, size],
          color: 0x6e6650,
        });
        lowCanopies.push({
          position: [x, 1.35 * size, z],
          scale: [size, size, size],
          color: seed % 2 ? 0x435e51 : 0x4e6953,
        });
        highCanopies.push({
          position: [x, 1.95 * size, z],
          scale: [size, size, size],
          color: seed % 3 ? 0x58775c : 0x66805d,
        });
      }
    };
    if (jungleRoutes.length) {
      // Form deterministic groves beside the real jungle edges. A clear strip
      // remains around routes, lanes, and camp pads; the trees are scenery and
      // carry no collision or navigation meaning.
      jungleRoutes.forEach((route, routeIndex) => {
        for (let segment = 1; segment < route.points.length; segment++) {
          const start = route.points[segment - 1];
          const end = route.points[segment];
          const dx = end.x - start.x;
          const dz = end.y - start.y;
          const length = Math.hypot(dx, dz);
          if (length < 2) continue;
          const tangentX = dx / length;
          const tangentZ = dz / length;
          const normalX = -tangentZ;
          const normalZ = tangentX;
          const samples = Math.ceil(length / 2.2);
          for (let sample = 1; sample <= samples; sample++) {
            const along = (length * sample) / (samples + 1);
            for (const side of [-1, 1]) {
              for (let groveRow = 0; groveRow < 2; groveRow++) {
                const seed = sceneryIndex++;
                const offset = 2.55 + groveRow * 1.05 + ((routeIndex + sample + seed) % 3) * 0.36;
                const jitter = ((seed % 3) - 1) * 0.18;
                addForestCandidate(
                  start.x + tangentX * (along + jitter) + normalX * offset * side,
                  start.y + tangentZ * (along + jitter) + normalZ * offset * side,
                  seed,
                );
              }
            }
          }
        }
      });
    } else {
      // Keep the original sparse sample-map dressing and its camera evidence.
      for (let i = 0; i < 58; i++) {
        const x = min.x + 0.8 + ((i * 7.13) % (w - 1.8));
        const z = min.y + 0.6 + ((i * 3.17) % (d - 1.2));
        addForestCandidate(x, z, i);
      }
    }
    addSceneryInstances(
      this.scene,
      "jungle-tree-trunks",
      new THREE.BoxGeometry(0.2, 1.15, 0.2),
      trunks,
    );
    addSceneryInstances(
      this.scene,
      "jungle-low-foliage",
      new THREE.ConeGeometry(0.76, 1.6, 4),
      lowCanopies,
    );
    addSceneryInstances(
      this.scene,
      "jungle-high-foliage",
      new THREE.ConeGeometry(0.58, 1.36, 4),
      highCanopies,
    );
    addSceneryInstances(
      this.scene,
      "jungle-rocks",
      new THREE.BoxGeometry(1, 1, 1),
      rocks,
    );
    if (!jungleRoutes.length)
      for (const z of [min.y - 0.3, max.y + 0.3])
        for (let j = 0; j < 12; j++)
          box(
            this.scene,
            [1.2, 0.55, 0.8],
            [min.x + j * (w / 11), -0.03, z],
            0x7a8377,
            j * 0.3,
          );
  }
  private buildCamp(position: WorldPoint, campId: string) {
    if (this.replay.scene.routes?.length) {
      buildWorldCamp(this.camps, position, campId, this.replay);
      return;
    }
    const scale = this.replay.scene.routes?.length ? 1.22 : 1;
    const campAccent = campId.includes("center")
      ? 0x8eb9a6
      : campId.includes("se")
        ? 0xc98968
        : 0xc2a36b;
    const camp = new THREE.Group();
    camp.position.set(position.x, 0, position.y);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.75 * scale, 1.9 * scale, 0.16, 8),
      new THREE.MeshStandardMaterial({
        color: 0x77694f,
        roughness: 1,
        flatShading: true,
      }),
    );
    pad.position.y = -0.04;
    pad.receiveShadow = true;
    camp.add(pad);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.55 * scale, 0.09, 4, 10),
      new THREE.MeshStandardMaterial({
        color: campAccent,
        roughness: 1,
        flatShading: true,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.07;
    camp.add(ring);
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      box(
        camp,
        [0.55 + (i % 2) * 0.25, 0.55 + (i % 3) * 0.18, 0.6],
        [Math.cos(angle) * 2.15 * scale, 0.18, Math.sin(angle) * 2.15 * scale],
        i % 2 ? 0x667267 : campAccent,
        angle,
      );
    }
    const brazier = new THREE.Group();
    brazier.position.set(0, 0.12, 0);
    box(brazier, [0.36, 0.72, 0.36], [0, 0.34, 0], 0x625948);
    cone(brazier, 0.31, 0.76, 0.94, campAccent, 5);
    box(brazier, [0.16, 0.55, 0.16], [0, 0.38, 0], 0xffd08a);
    camp.add(brazier);
    this.camps.add(camp);
  }
  private healthBar(parent: THREE.Group, e: DisplayEntity, y: number) {
    const sideColor = colors[e.side];
    const bar = box(parent, [0.92, 0.075, 0.1], [0, y, 0], 0x253b43);
    bar.name = "health-bar-background";
    bar.castShadow = false;
    const ratio = THREE.MathUtils.clamp(e.maxHp > 0 ? e.hp / e.maxHp : 0, 0, 1);
    const hp = box(
      parent,
      [0.84, 0.07, 0.11],
      [-0.42 * (1 - ratio), y + 0.008, 0.005],
      sideColor,
    );
    hp.name = "health-bar-fill";
    hp.scale.x = Math.max(0.02 / 0.84, ratio);
    hp.castShadow = false;
  }
  private updateHealthBar(group: THREE.Group, e: DisplayEntity) {
    const fill = group.getObjectByName("health-bar-fill");
    if (!(fill instanceof THREE.Mesh)) return;
    const ratio = THREE.MathUtils.clamp(e.maxHp > 0 ? e.hp / e.maxHp : 0, 0, 1);
    fill.scale.x = Math.max(0.02 / 0.84, ratio);
    fill.position.x = -0.42 * (1 - ratio);
    const material = Array.isArray(fill.material) ? fill.material[0] : fill.material;
    if (material instanceof THREE.MeshStandardMaterial) material.color.set(colors[e.side]);
  }
  private canonicalAppearance(e: DisplayEntity) {
    const catalogId = e.catalogId?.toLowerCase();
    if (catalogId && catalogAppearance[catalogId])
      return catalogAppearance[catalogId];
    const appearance = e.appearanceKey.toLowerCase();
    const heroSuffix = appearance.replace(/^senkei\.next\.hero\./, "");
    return catalogAppearance[heroSuffix] ?? appearance.replaceAll("_", "-");
  }
  private entityLabel(e: DisplayEntity) {
    if (e.kind === "base") return "BASE";
    if (e.kind === "tower") return "TOWER";
    if (e.kind === "bridge") return `BRIDGE · ${e.battlefield?.bridgeSite ?? "FIXED"} · ${(e.battlefield?.bridgeState ?? "unknown").toUpperCase()}`;
    if (e.kind === "observation") {
      const owner = e.battlefield?.captureSide ?? e.battlefield?.facilityOwner;
      return `MID OBSERVATION · ${owner?.toUpperCase() ?? "STATE UNKNOWN"}`;
    }
    const appearance = this.canonicalAppearance(e);
    if (
      e.side === "neutral" &&
      (e.archetype === "monster" || appearance.startsWith("monster-"))
    )
      return "MONSTER";
    if (e.archetype === "minion" || appearance.startsWith("minion-")) {
      const type = appearance.replace("minion-", "").toUpperCase();
      return `MINION · ${type}`;
    }
    if (this.isHero(e)) {
      const catalogId = e.catalogId?.toUpperCase();
      const catalogName = catalogId
        ? HERO_CATALOG_BY_ID[catalogId as keyof typeof HERO_CATALOG_BY_ID]?.name
        : undefined;
      return catalogName ? `HERO · ${catalogId} ${catalogName}` : "HERO";
    }
    return appearance.toUpperCase();
  }
  private entityHealthSuffix(e: DisplayEntity) {
    // Observation facilities are capture objectives. Their Replay entity needs
    // structural identity, but HP is not an authorized/applicable objective field.
    return e.kind === "observation" ? "" : ` · ${e.hp}/${e.maxHp}`;
  }
  private isHero(e: DisplayEntity) {
    const appearance = this.canonicalAppearance(e);
    return e.kind === "unit" &&
      (e.archetype === "hero" || appearance.startsWith("hero-"));
  }
  private sideMarker(side: DisplayEntity["side"]) {
    if (side === "azure") return "◆ Azure";
    if (side === "vermilion") return "▲ Vermilion";
    return "○ Neutral";
  }
  private attachRig(group: THREE.Group, rig: BattlefieldUnitRig) {
    group.userData.animationRig = rig;
    group.userData.rigRest = new Map(
      [...Object.values(rig.joints), ...Object.values(rig.weaponPivots)]
        .map(joint => [joint, joint.rotation.clone()]),
    );
    const materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.Mesh)
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    });
    group.userData.focusMaterials = [...materials];
    group.userData.focusBaseMaterials = [...materials];
    const modelBounds = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    group.userData.modelHeight = modelBounds.y;
    group.userData.modelBounds = modelBounds.toArray();
  }
  private entityHeight(entity: DisplayEntity, point: WorldPoint): number {
    if (entity.kind === "unit") {
      if (entity.battlefield?.crossing === "ford") return -0.18;
      if (entity.battlefield?.crossing === "bridge") return 0.39;
      if (entity.battlefield?.node === "N.MID.OBS") return 0.43;
      if (entity.battlefield?.node?.endsWith(".BASE")) return 0.33;
    }
    return this.height(point);
  }
  private heroModel(g: THREE.Group, e: DisplayEntity, color: number) {
    if (this.replay.scene.routes?.length) {
      this.attachRig(g, buildBattlefieldHero(g, e, color, this.canonicalAppearance(e)));
      this.healthBar(g, e, 2.6);
      return;
    }
    const appearance = this.canonicalAppearance(e);
    const key = (Object.keys(HERO_CATALOG) as (keyof typeof HERO_CATALOG)[]).find(
      (candidate) => appearance === candidate || e.archetype === candidate,
    );
    const hero = key ?? "hero-vanguard";
    const accent = heroAccents[hero];
    const frontline = HERO_CATALOG[hero].role === "frontline";
    const broad = hero === "hero-bulwark" || hero === "hero-crusader" || hero === "hero-siege";
    const height = hero === "hero-lancer" || hero === "hero-oracle" ? 1.2 : 1;
    g.scale.setScalar(frontline ? 1.13 : 1.02);
    box(g, [0.23, 0.43, 0.22], [-0.17, 0.2, 0], 0x39484b);
    box(g, [0.23, 0.43, 0.22], [0.17, 0.2, 0], 0x39484b);
    box(g, [broad ? 0.68 : 0.5, 0.61, 0.38], [0, 0.65, 0], color);
    box(g, [broad ? 0.78 : 0.59, 0.18, 0.48], [0, 0.91, 0], accent);
    box(g, [0.36, 0.34, 0.34], [0, 1.13, 0], 0xd4c9ad);
    if (hero === "hero-ronin") {
      cone(g, 0.54, 0.18, 1.39, 0x79664d, 8);
      box(g, [0.12, 0.9, 0.12], [0.42, 0.75, 0.03], 0xbeb99c, 0.18);
      box(g, [0.08, 0.42, 0.26], [-0.3, 0.75, -0.25], 0x7b554d, -0.28);
    } else if (hero === "hero-lancer") {
      box(g, [0.09, 2.15, 0.09], [0.48, 1.0, 0], 0x947750, -0.12);
      cone(g, 0.11, 0.55, 2.32, 0xc5c9bd, 4).position.x = 0.48;
      box(g, [0.52, 0.22, 0.45], [0, 0.54, 0], 0x9f6c50);
    } else if (hero === "hero-arcanist") {
      cone(g, 0.41, 0.94, 0.5, 0x615e82, 5);
      box(g, [0.11, 1.7, 0.11], [0.45, 0.78, 0], 0x927451);
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.23, 0),
        new THREE.MeshStandardMaterial({
          color: 0xa9a0d9,
          emissive: 0x534f89,
          roughness: 0.4,
          flatShading: true,
        }),
      );
      orb.position.set(0.45, 1.75, 0);
      g.add(orb);
    } else if (hero === "hero-oracle") {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.075, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xe7d59a, roughness: 0.55 }),
      );
      halo.position.set(0, 1.64, 0);
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
      cone(g, 0.44, 1.0, 0.48, 0xa18d69, 6);
      box(g, [0.1, 1.65, 0.1], [0.48, 0.8, 0], 0xc1ae7a);
      cone(g, 0.21, 0.42, 1.72, 0xe9d89b, 6).position.x = 0.48;
    } else if (hero === "hero-shadow") {
      cone(g, 0.35, 0.68, 1.36, 0x3e4651, 5);
      box(g, [0.1, 0.76, 0.1], [-0.48, 0.7, 0], 0xaeb8bc, 0.3);
      box(g, [0.1, 0.76, 0.1], [0.48, 0.7, 0], 0xaeb8bc, -0.3);
      box(g, [0.48, 0.66, 0.09], [0, 0.8, -0.36], 0x444650);
    } else if (hero === "hero-marksman") {
      cone(g, 0.28, 0.55, 1.4, 0x7f8c78, 5);
      box(g, [0.1, 1.15, 0.12], [0.47, 0.74, 0], 0x927b56);
      box(g, [1.0, 0.12, 0.18], [0.38, 0.82, 0], 0xc3b48a);
      box(g, [0.12, 0.48, 0.12], [0.38, 0.82, 0], 0x554d40);
    } else if (hero === "hero-ranger") {
      cone(g, 0.31, 0.44, 1.37, 0x657757, 5);
      box(g, [0.1, 1.55, 0.1], [0.5, 0.85, 0], 0x8b7653);
      for (const side of [-1, 1])
        box(g, [0.08, 0.48, 0.12], [side * 0.43, 0.85, -0.28], 0x697a5e, side * 0.24);
      box(g, [0.07, 0.78, 0.07], [-0.32, 0.88, -0.22], 0xc0ad7b);
    } else if (hero === "hero-siege") {
      box(g, [0.5, 0.52, 0.42], [-0.38, 0.84, -0.26], 0x626e68);
      box(g, [0.64, 0.25, 0.36], [0.35, 1.0, 0], 0x826b4e, 0.08);
      box(g, [0.15, 0.16, 1.0], [0.45, 1.04, 0.38], 0x464c4c);
      box(g, [0.24, 0.18, 0.42], [0.45, 1.04, 0.96], 0x747a72);
    } else if (hero === "hero-bulwark") {
      box(g, [0.76, 0.92, 0.18], [0, 0.69, 0.37], 0x4b6675);
      box(g, [0.14, 0.72, 0.08], [0, 0.7, 0.49], color);
      box(g, [0.12, 1.15, 0.12], [0.51, 0.82, 0], 0x88744f);
      box(g, [0.52, 0.18, 0.48], [0.52, 1.48, 0], 0x9b8870);
    } else if (hero === "hero-crusader") {
      box(g, [0.34, 0.76, 0.18], [-0.43, 0.72, 0], accent, -0.28);
      box(g, [0.34, 0.76, 0.18], [0.43, 0.72, 0], accent, 0.28);
      box(g, [0.58, 0.68, 0.14], [0, 0.65, 0.38], 0xe2d5ae);
      box(g, [0.12, 1.1, 0.12], [0.57, 0.85, 0], 0x988158);
      box(g, [0.65, 0.13, 0.14], [0.57, 1.57, 0], 0xd7c897);
    } else {
      box(g, [0.07, 1.5, 0.07], [0.43, 0.91, 0], 0xbcb293);
      cone(g, 0.11, 0.33, 1.82, 0xd3d8c5, 4).position.x = 0.43;
      box(g, [0.34, 0.46, 0.12], [-0.34, 0.72, 0.29], color);
    }
    if (e.side === "azure")
      box(g, [0.36, 0.25, 0.07], [0, 1.37, -0.18], color);
    else
      cone(g, 0.16, 0.5, 1.43, color, 4);
    this.healthBar(g, e, Math.max(2.05, height * 1.8));
  }
  private minionModel(g: THREE.Group, e: DisplayEntity, color: number) {
    if (this.replay.scene.routes?.length) {
      this.attachRig(g, buildBattlefieldMinion(g, e, color, this.canonicalAppearance(e)));
      this.healthBar(g, e, 1.95);
      return;
    }
    const appearance = this.canonicalAppearance(e);
    g.scale.setScalar(appearance === "minion-siege" ? 0.95 : 0.72);
    box(g, [0.2, 0.31, 0.2], [-0.12, 0.16, 0], 0x414d48);
    box(g, [0.2, 0.31, 0.2], [0.12, 0.16, 0], 0x414d48);
    box(g, [0.47, 0.48, 0.34], [0, 0.51, 0], color);
    box(g, [0.31, 0.29, 0.29], [0, 0.91, 0], 0xbdb69e);
    if (appearance === "minion-ranged") {
      cone(g, 0.25, 0.45, 1.1, 0x596c5c, 5);
      box(g, [0.1, 0.95, 0.1], [0.4, 0.57, 0], 0x9d8054);
      box(g, [0.58, 0.07, 0.07], [0.34, 0.71, 0.1], 0xd3c9a3);
    } else if (appearance === "minion-siege") {
      box(g, [0.72, 0.35, 0.55], [0, 0.35, -0.3], 0x75694f);
      box(g, [0.15, 0.2, 1.15], [0, 0.66, 0.28], 0x514d43);
      box(g, [0.24, 0.24, 0.32], [0, 0.66, 0.9], 0x9b8060);
      for (const x of [-0.35, 0.35]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.19, 0.19, 0.14, 8),
          new THREE.MeshStandardMaterial({ color: 0x4c4a42, flatShading: true }),
        );
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.19, -0.28);
        g.add(wheel);
      }
    } else {
      box(g, [0.52, 0.54, 0.12], [0, 0.54, 0.31], 0x455660);
      box(g, [0.08, 0.43, 0.06], [0, 0.54, 0.4], color);
      box(g, [0.08, 1.1, 0.08], [0.39, 0.65, 0], 0x9c8356);
    }
    if (e.side === "azure")
      box(g, [0.26, 0.17, 0.06], [0, 1.21, -0.14], color);
    else
      cone(g, 0.13, 0.37, 1.26, color, 4);
    this.healthBar(g, e, 1.45);
  }
  private monsterModel(g: THREE.Group, e: DisplayEntity) {
    if (this.replay.scene.routes?.length) {
      this.attachRig(g, buildBattlefieldMonster(g, e, this.canonicalAppearance(e)));
      this.healthBar(g, e, 2.65);
      return;
    }
    const key = this.canonicalAppearance(e);
    if (key === "monster-drake") {
      g.scale.setScalar(1.2);
      box(g, [0.72, 0.56, 0.9], [0, 0.68, 0], 0x6d796d);
      cone(g, 0.34, 0.55, 1.14, 0x89927c, 5).position.z = 0.48;
      for (const side of [-1, 1]) {
        box(g, [0.1, 0.9, 0.85], [side * 0.54, 0.88, -0.24], 0x82917d, side * 0.38);
        cone(g, 0.15, 0.7, 1.2, 0xc0935b, 4).position.x = side * 0.62;
      }
      box(g, [0.18, 0.2, 0.95], [0, 0.43, -0.84], 0x667968, 0.4);
    } else if (key === "monster-raptor" || key === "monster-stalker") {
      g.scale.setScalar(0.95);
      box(g, [0.55, 0.4, 1.15], [0, 0.5, 0], 0x6f7869);
      box(g, [0.38, 0.36, 0.4], [0, 0.78, 0.58], 0x8b8d75);
      box(g, [0.16, 0.17, 1.1], [0, 0.57, -1.0], 0x797c6a, 0.38);
      for (const side of [-1, 1]) {
        box(g, [0.14, 0.46, 0.15], [side * 0.22, 0.23, 0.32], 0x555d55);
        cone(g, 0.12, 0.3, 0.9, 0xd5b27a, 4).position.x = side * 0.2;
      }
    } else if (key === "monster-wraith") {
      g.scale.setScalar(0.92);
      cone(g, 0.6, 1.55, 0.8, 0x707f7c, 6);
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28, 1),
        new THREE.MeshStandardMaterial({ color: 0x9ab5ac, emissive: 0x344f4e }),
      );
      orb.position.set(0, 1.35, 0.12);
      g.add(orb);
      box(g, [0.16, 1.0, 0.16], [-0.52, 0.9, 0.1], 0x657472, 0.45);
      box(g, [0.16, 1.0, 0.16], [0.52, 0.9, 0.1], 0x657472, -0.45);
    } else {
      g.scale.setScalar(1.13);
      box(g, [0.86, 0.96, 0.65], [0, 0.82, 0], 0x74776b);
      box(g, [0.58, 0.55, 0.52], [0, 1.38, 0.1], 0x858477);
      for (const side of [-1, 1]) {
        box(g, [0.35, 0.74, 0.42], [side * 0.62, 0.83, 0.06], 0x666d63, side * 0.18);
        cone(g, 0.22, 0.58, 1.88, 0x9c8e68, 4).position.x = side * 0.3;
        box(g, [0.18, 0.68, 0.2], [side * 0.25, 0.3, 0.05], 0x5d665d);
      }
    }
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xe8a669 }),
    );
    eye.position.set(0.15, 1.3, 0.45);
    g.add(eye);
    this.healthBar(g, e, 2.2);
  }
  private structureModel(g: THREE.Group, e: DisplayEntity, color: number) {
    if (this.replay.scene.routes?.length) {
      // The persistent geographic presenters own bases, bridges and the MID
      // observatory. Never draw a second proxy building at the entity anchor.
      if (e.kind === "tower") {
        buildBattlefieldTower(g, e);
        if (!e.destroyed) this.healthBar(g, e, 4.15);
      }
      return;
    }
    const base = e.kind === "base";
    if (e.kind === "bridge") {
      const state = e.battlefield?.bridgeState;
      if (state) {
        const broken = state === "destroyed";
        const deck = box(g, [2.2, 0.1, 0.44], [0, 0.03, 0], broken ? 0x62513f : 0x9a845d);
        deck.rotation.y = 0.35;
      } else {
        const unknown = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.06, 4, 8), new THREE.MeshBasicMaterial({ color: 0x9aa88d, transparent: true, opacity: 0.42 }));
        unknown.rotation.x = Math.PI / 2;
        unknown.position.y = 0.1;
        g.add(unknown);
      }
      if (e.battlefield?.buildRemaining) {
        const work = box(g, [0.16, 0.54, 0.16], [0, 0.34, 0], 0xe6c477);
        work.rotation.z = -0.3;
      }
      return;
    }
    if (e.kind === "observation") {
      const owner = e.battlefield?.facilityOwner ?? e.side;
      const ownerColor = owner === "azure" ? colors.azure : owner === "vermilion" ? colors.vermilion : 0x9aa88d;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x706e5d, roughness: 0.9, flatShading: true }));
      base.position.y = 0.28;
      g.add(base);
      const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.68, 0), new THREE.MeshStandardMaterial({ color: ownerColor, emissive: ownerColor, emissiveIntensity: 0.22, flatShading: true }));
      beacon.position.y = 1.02;
      beacon.scale.y = 1.45;
      g.add(beacon);
      const progress = Math.max(0, Math.min(1, (e.battlefield?.captureProgress ?? 0) / (this.replay.scene.captureTicks ?? 8)));
      if (progress > 0) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 4, 16, Math.PI * 2 * progress), new THREE.MeshBasicMaterial({ color: ownerColor }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.6;
        g.add(ring);
      }
      return;
    }
    if (this.replay.scene.routes?.length) {
      g.scale.setScalar(base ? 1.08 : 1.14);
      if (base && e.side === "vermilion") g.rotation.y = Math.PI;
    }
    if (base && this.replay.scene.routes?.length) {
      // Keep the Replay base anchor in the open center of a small courtyard.
      // Heroes can occupy and fight at that exact coordinate without a solid
      // tower body or roof hiding them from the tactical camera.
      // Build the paving as a perimeter ring. Leave the center at terrain
      // height: a continuous raised floor here would hide units on the base
      // anchor, which is also the hero spawn and assault position.
      for (const z of [-1.51, 1.51]) {
        box(g, [3.35, 0.2, 0.32], [0, 0.1, z], 0x646b60);
        box(g, [2.95, 0.1, 0.16], [0, 0.25, z], 0xb0b5a3);
        box(g, [3.05, 0.14, 0.13], [0, 0.34, z], color);
      }
      for (const x of [-1.51, 1.51]) {
        box(g, [0.32, 0.2, 2.8], [x, 0.1, 0], 0x646b60);
        box(g, [0.16, 0.1, 2.56], [x, 0.25, 0], 0xb0b5a3);
        box(g, [0.13, 0.14, 3.05], [x, 0.34, 0], color);
      }

      const wallY = 0.49;
      box(g, [0.3, 0.58, 2.64], [-1.3, wallY, 0], stone);
      box(g, [0.3, 0.58, 2.64], [1.3, wallY, 0], stone);
      box(g, [2.64, 0.58, 0.3], [0, wallY, -1.3], stone);
      // A broad gate faces the map. The open center keeps units visible as
      // they spawn, regroup, or enter a base assault.
      box(g, [0.72, 0.58, 0.3], [-0.96, wallY, 1.3], stone);
      box(g, [0.72, 0.58, 0.3], [0.96, wallY, 1.3], stone);

      for (const x of [-1.3, 1.3])
        for (const z of [-1.3, 1.3]) {
          box(g, [0.46, 1.34, 0.46], [x, 0.69, z], stone);
          box(g, [0.55, 0.12, 0.55], [x, 1.42, z], 0xd5cdb2);
          box(g, [0.12, 0.72, 0.08], [x, 1.06, z > 0 ? 1.55 : -1.55], color);
        }

      // Place the base core behind and to one side of the Replay anchor so it
      // reads as the objective without covering a unit on the center tile.
      box(g, [0.82, 0.24, 0.72], [0.74, 0.43, -0.78], 0x646b60);
      box(g, [0.52, 0.52, 0.48], [0.74, 0.8, -0.78], stone);
      cone(g, 0.38, 0.78, 1.45, color, 5).position.set(0.74, 1.45, -0.78);
      this.healthBar(g, e, 2.15);
      return;
    }
    const wide = base ? 2.25 : e.appearanceKey === "spire-tower" ? 1.05 : 1.35;
    const high = base ? 2.9 : e.appearanceKey === "spire-tower" ? 2.7 : 2.05;
    box(g, [wide + 0.55, 0.35, wide + 0.55], [0, 0.17, 0], 0x646b60);
    box(g, [wide, high, wide], [0, high / 2 + 0.32, 0], stone);
    box(g, [wide + 0.24, 0.24, wide + 0.24], [0, high + 0.32, 0], 0xd5cdb2);
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        box(g, [0.32, 0.48, 0.32], [x * wide * 0.43, high + 0.62, z * wide * 0.43], stone);
    if (!base) {
      box(g, [0.12, 0.14, 0.12], [0, high + 1.08, 0], 0x665e4e);
      cone(g, 0.82, 0.74, high + 1.46, color, 5);
    }
    box(g, [0.34, 0.82, 0.08], [0, high * 0.65, wide / 2 + 0.05], 0x344a51);
    box(g, [0.14, 1.95, 0.14], [0, high + 1.03, 0], 0x6e6552);
    box(
      g,
      [e.side === "azure" ? 0.9 : 0.66, 0.57, 0.08],
      [0.42, high + 1.6, 0],
      color,
      e.side === "azure" ? 0 : 0.35,
    );
    box(g, [wide + 0.04, 0.34, wide + 0.04], [0, 0.78, 0], color);
    if (base) {
      cone(g, 1.18, 1.0, high + 1.2, 0x566e72, 6);
      for (const x of [-1.25, 1.25]) {
        box(g, [0.62, 1.95, 0.78], [x, 0.98, 0], stone);
        cone(g, 0.45, 0.54, 2.12, 0xd5cdb2, 4).position.x = x;
      }
    }
    if (e.hp < e.maxHp) {
      box(g, [0.12, 1.12, 0.04], [0.22, 1.1, wide / 2 + 0.07], 0x3e4c49, 0.3);
      box(g, [0.64, 0.12, 0.06], [-0.3, 1.66, wide / 2 + 0.08], 0x57665b);
    }
    this.healthBar(g, e, high + 2.05);
  }
  private model(e: DisplayEntity) {
    const g = new THREE.Group();
    g.userData.entityId = e.id;
    const color = colors[e.side];
    const appearance = this.canonicalAppearance(e);
    if (this.replay.scene.routes?.length && e.kind !== "unit") {
      this.structureModel(g, e, color);
      return g;
    }
    if (e.destroyed) {
      if (this.replay.scene.routes?.length && e.kind !== "unit") {
        const isBase = e.kind === "base";
        const spread = isBase ? 1.45 : 0.86;
        box(g, [spread * 2.3, 0.3, spread * 1.95], [0, 0.13, 0], 0x625f52);
        for (let j = 0; j < 7; j++) {
          const fragment = box(
            g,
            [
              0.48 + (j % 3) * 0.18,
              0.24 + (j % 2) * 0.17,
              0.42 + (j % 2) * 0.16,
            ],
            [
              Math.cos(j * 2.1) * spread,
              0.22 + (j % 2) * 0.09,
              Math.sin(j * 2.1) * spread,
            ],
            j % 2 ? 0x8d8874 : 0x6d7266,
            j * 0.42,
          );
          fragment.userData.rest = fragment.position.clone();
          fragment.userData.fallingFrom = new THREE.Vector3(
            fragment.position.x * 0.2,
            2.2 + j * 0.1,
            fragment.position.z * 0.2,
          );
        }
        return g;
      }
      for (let j = 0; j < 7; j++) {
        const fragment = box(
          g,
          [0.45, 0.25 + (j % 3) * 0.15, 0.4],
          [Math.cos(j * 2.1) * 0.7, 0.15, Math.sin(j * 2.1) * 0.7],
          j % 2 ? stone : color,
          j,
        );
        fragment.userData.rest = fragment.position.clone();
        fragment.userData.fallingFrom = new THREE.Vector3(
          fragment.position.x * 0.2,
          e.kind === "unit" ? 1 : 2.2 + j * 0.1,
          fragment.position.z * 0.2,
        );
      }
      return g;
    }
    if (e.kind !== "unit") {
      this.structureModel(g, e, color);
    } else if (
      e.side === "neutral" &&
      (e.archetype === "monster" || appearance.startsWith("monster-"))
    ) {
      this.monsterModel(g, e);
    } else if (e.archetype === "minion" || appearance.startsWith("minion-")) {
      this.minionModel(g, e, color);
    } else if (e.archetype === "hero" || appearance.startsWith("hero-")) {
      this.heroModel(g, e, color);
    } else {
      const heavy = e.appearanceKey === "heavy",
        archer = e.appearanceKey === "archer";
      g.scale.setScalar(1.15);
      const body = heavy ? 0.57 : 0.38;
      box(g, [0.16, 0.35, 0.19], [-0.15, 0.2, 0], 0x35474a);
      box(g, [0.16, 0.35, 0.19], [0.15, 0.2, 0], 0x35474a);
      box(g, [body, 0.5, 0.33], [0, 0.6, 0], color);
      box(g, [body + 0.1, 0.12, 0.4], [0, 0.85, 0], heavy ? 0xb8c0b7 : color);
      box(g, [0.3, 0.29, 0.3], [0, 1.05, 0], archer ? 0x8a8061 : 0xd4c8a5);
      if (archer) {
        cone(g, 0.3, 0.3, 1.25, 0x477c6e);
        box(g, [0.12, 0.95, 0.12], [0.4, 0.7, 0.1], 0xb7a478, 0.35);
        box(g, [0.48, 0.05, 0.05], [0.2, 0.8, 0.3], 0xd7d6bc);
      } else if (heavy) {
        box(g, [0.48, 0.7, 0.13], [0, 0.66, 0.34], 0x344b5c);
        box(g, [0.1, 0.65, 0.05], [0, 0.67, 0.42], color);
        box(g, [0.2, 0.2, 0.6], [0.4, 1.05, 0], 0xc0c5b6);
      } else {
        box(g, [0.07, 1.65, 0.07], [0.4, 0.85, 0], 0xbcb293);
        cone(g, 0.1, 0.3, 1.75, 0xd3d8c5);
        box(g, [0.3, 0.42, 0.1], [-0.28, 0.65, 0.25], color);
      }
      // Azure carries a square back pennant; Vermilion carries a tall pointed crest.
      if (e.side === "azure")
        box(g, [0.35, 0.22, 0.06], [0, 1.33, -0.1], color);
      else cone(g, 0.13, 0.48, 1.38, color);
      const bar = box(g, [0.7, 0.06, 0.09], [0, 1.85, 0], 0x283d46);
      bar.castShadow = false;
      const hp = box(
        g,
        [(0.7 * e.hp) / e.maxHp, 0.065, 0.1],
        [-0.35 * (1 - e.hp / e.maxHp), 1.85, 0.01],
        color,
      );
      hp.castShadow = false;
    }
    return g;
  }
  update(state: DisplayState, playing: boolean) {
    this.playing = playing;
    if (this.state === state) return;
    this.state = state;
    this.modelOffsets = this.unitLayout.update(state, this.replay);
    if (this.trackedIds.length && !this.userCameraChanged) {
      this.frameTracked(this.trackedIds);
    } else if (
      this.replay.scene.routes?.length &&
      this.cameraMode === "tactical" &&
      !this.userCameraChanged &&
      !this.selected
    ) {
      this.fitAuthoredCamera("tactical");
    }
    this.changedAt = performance.now();
    const cues = this.replay.scene.routes?.length
      ? state.cues.filter((cue) => cue.tick === state.tick)
      : state.cues;
    const recentDeaths = new Set(
      cues.flatMap((cue) => (cue.type === "destroy" ? [cue.entityId] : [])),
    );
    // Unit debris belongs to the death cue; permanent structure ruins remain.
    const shown = (e: DisplayEntity | undefined) => Boolean(e && (!e.destroyed || e.kind !== "unit" || recentDeaths.has(e.id)));
    for (const [id, g] of this.units)
      if (!shown(state.entities[id])) {
        this.scene.remove(g);
        disposeTree(g);
        this.units.delete(id);
        this.entityLabels.get(id)?.remove();
        this.entityLabels.delete(id);
      }
    for (const e of Object.values(state.entities)) {
      if (!shown(e)) continue;
      let g = this.units.get(e.id);
      // Logical progress and HP bars update per tick; only authored geometry
      // identity or a visible structural stage change rebuilds model buffers.
      const signature = battlefieldModelGeometrySignature(e, Boolean(this.replay.scene.routes?.length));
      if (!g || g.userData.geometrySignature !== signature) {
        const position = g?.position.clone();
        const rotation = g?.rotation.clone();
        if (g) {
          this.scene.remove(g);
          disposeTree(g);
        }
        // Keep the authored rig for the confirmed death tick so its fall pose
        // is visible. Visibility loss never reaches this branch as a death.
        const dyingHero = Boolean(this.replay.scene.routes?.length &&
          e.destroyed && recentDeaths.has(e.id) && this.isHero(e));
        g = this.model(dyingHero ? { ...e, destroyed: false } : e);
        g.userData.geometrySignature = signature;
        g.userData.entityId = e.id;
        if (rotation) g.rotation.copy(rotation);
        if (position && !this.replay.scene.routes?.length) g.position.copy(position);
        else {
          const point = this.renderPoint(e);
          g.position.set(point.x, this.entityHeight(e, point), point.y);
        }
        this.units.set(e.id, g);
        this.scene.add(g);
      }
      this.updateHealthBar(g, e);
      let label = this.entityLabels.get(e.id);
      if (!label) {
        label = document.createElement("span");
        label.className = "world-label entity-world-label";
        label.style.visibility = this.informationLayers.engagements ? "visible" : "hidden";
        label.setAttribute("aria-hidden", "true");
        Object.assign(label.style, {
          background: "rgba(14, 27, 31, .64)",
          border: `1px solid ${e.side === "azure" ? "#48c8d7aa" : e.side === "vermilion" ? "#e9845baa" : "#b5b8adaa"}`,
          borderRadius: "2px",
          color: "#f1eee2",
          fontSize: "9px",
          letterSpacing: ".02em",
          maxWidth: "min(210px, calc(100vw - 32px))",
          padding: "2px 4px",
          textAlign: "center",
          transform: "translate(-50%, -120%)",
          whiteSpace: "normal",
          zIndex: "3",
        });
        this.host.appendChild(label);
        this.entityLabels.set(e.id, label);
      }
      const labelName = this.entityLabel(e);
      label.textContent = `${labelName}${this.entityHealthSuffix(e)}`;
      g.userData.from = g.position.clone();
      const point = this.renderPoint(e);
      g.userData.to = new THREE.Vector3(point.x, this.entityHeight(e, point), point.y);
      if (e.kind === "unit") {
        const motion = this.unitMotion.at(state.tick, e.id);
        g.userData.walking = Boolean(motion);
        g.rotation.y = this.unitOrientation.at(state.tick, e.id) ?? 0;
      }
      const offset = this.modelOffsets.get(e.id) ?? { x: 0, y: 0 };
      const cosine = Math.cos(g.rotation.y), sine = Math.sin(g.rotation.y);
      const local = { x: cosine * offset.x - sine * offset.y, y: sine * offset.x + cosine * offset.y };
      const previous = (g.userData.displayOffset as WorldPoint | undefined) ?? { x: 0, y: 0 };
      for (const child of g.children) {
        child.position.x += local.x - previous.x;
        child.position.z += local.y - previous.y;
      }
      g.userData.displayOffset = local;
      // Real authored movement follows the Replay graph. Interpolating a
      // node-to-node change through arbitrary world space can draw a false
      // shortcut, so only the original sample fixtures retain that flourish.
      if (
        !playing ||
        this.reducedMotion ||
        this.replay.scene.routes?.length
      )
        g.position.copy(g.userData.to);
    }
    this.battlefieldLandmarks.update(state);
    this.battlefieldFog.update(state);
    disposeTree(this.effects);
    this.effects.clear();
    buildBattlefieldTransitionEffects(this.effects, this.replay, state, this.transitionEffects.at(state.tick));
    for (const cueLabel of this.cueLabels) cueLabel.element.remove();
    this.cueLabels = [];
    this.cueLayoutSignature = "";
    if (this.replay.scene.routes?.length) {
      const addCueLabel = (
        type: string,
        text: string,
        side: DisplayEntity["side"],
        point: THREE.Vector3,
        ids: { sourceId?: string; targetId?: string; entityId?: string } = {},
      ) => {
        const element = document.createElement("span");
        element.className = "world-label cue-world-label";
        element.style.visibility = this.informationLayers.engagements ? "visible" : "hidden";
        element.dataset.cueType = type;
        element.dataset.tick = String(state.tick);
        element.setAttribute("aria-label", text);
        element.setAttribute("role", "note");
        const border = `#${colors[side].toString(16).padStart(6, "0")}`;
        const glyph = type === "attack"
          ? "⚔"
          : type === "skill"
            ? "✦"
            : type === "damage"
              ? "−"
              : type === "vitals"
                ? "+"
                : type === "destroy"
                  ? "×"
                  : "✚";
        Object.assign(element.style, {
          background: "rgba(15, 26, 28, .78)",
          border: `1px solid ${border}`,
          borderRadius: "50%",
          boxShadow: "0 1px 6px rgba(0,0,0,.38)",
          color: "#fff8df",
          fontFamily: '"DM Mono", monospace',
          fontSize: "13px",
          fontWeight: "700",
          height: "24px",
          letterSpacing: "0",
          // Inline display:flex overrides the native [hidden] rule and leaves
          // rejected/offscreen cues stacked at the host's top-left corner.
          lineHeight: "24px",
          padding: "0",
          textAlign: "center",
          whiteSpace: "nowrap",
          width: "24px",
          zIndex: "4",
        });
        element.textContent = glyph;
        this.host.appendChild(element);
        this.cueLabels.push({ element, point, type, ...ids });
      };
      const cueAnchor = (entity: DisplayEntity, height: number) => {
        const point = this.displayPoint(entity);
        return new THREE.Vector3(point.x, this.entityHeight(entity, this.renderPoint(entity)) + height, point.y);
      };
      for (const cue of cues) {
        if (cue.type === "attack" || cue.type === "skill") {
          const source = state.entities[cue.entityId];
          const target = state.entities[cue.targetId];
          // Owner/public projections may omit an endpoint; do not infer it.
          if (!source || !target) continue;
          const sourcePoint = cueAnchor(source, cue.type === "skill" ? 1.1 : 1);
          const targetPoint = cueAnchor(target, cue.type === "skill" ? 0.85 : 1);
          const midpoint = sourcePoint
            .add(targetPoint)
            .multiplyScalar(0.5)
            .add(new THREE.Vector3(0, 2.05, 0));
          addCueLabel(
            cue.type,
            cue.type === "attack"
              ? `ATTACK · ${this.entityLabel(source)} → ${this.entityLabel(target)}`
              : `SKILL ${cue.skillKey} · ${this.entityLabel(source)} → ${this.entityLabel(target)}`,
            source.side,
            midpoint,
            { sourceId: source.id, targetId: target.id },
          );
        } else if (cue.type === "damage") {
          const entity = state.entities[cue.entityId];
          if (!entity) continue;
          addCueLabel(
            cue.type,
            `DAMAGE · ${this.entityLabel(entity)} · HP ${cue.hp}/${entity.maxHp}`,
            entity.side,
            cueAnchor(entity, 3),
            { entityId: entity.id },
          );
        } else if (cue.type === "vitals") {
          const entity = state.entities[cue.entityId];
          if (!entity) continue;
          addCueLabel(
            cue.type,
            `VITALS · ${this.entityLabel(entity)} · HP ${cue.hp}/${cue.maxHp}`,
            entity.side,
            cueAnchor(entity, 3),
            { entityId: entity.id },
          );
        } else if (cue.type === "destroy") {
          const entity = state.entities[cue.entityId];
          if (!entity) continue;
          const title = entity.kind === "base"
            ? "BASE DESTROYED"
            : entity.kind === "tower"
              ? "TOWER DESTROYED"
              : this.isHero(entity)
                ? "HERO DEFEATED"
                : entity.side === "neutral" && entity.archetype === "monster"
                  ? "MONSTER DEFEATED"
                  : "UNIT DESTROYED";
          addCueLabel(
            cue.type,
            `${title} · ${this.entityLabel(entity)}`,
            entity.side,
            cueAnchor(entity, 3.2),
            { entityId: entity.id },
          );
        } else if (cue.type === "spawn") {
          const entity = state.entities[cue.entity.id];
          if (!entity) continue;
          addCueLabel(
            cue.type,
            `APPEARED · ${this.entityLabel(entity)}`,
            entity.side,
            cueAnchor(entity, 3),
            { entityId: entity.id },
          );
        }
      }
    }
    for (const cue of cues) {
      if (cue.type === "spawn") {
        const entity = state.entities[cue.entity.id];
        if (!entity) continue;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.58, 0.12, 4, 10),
          new THREE.MeshBasicMaterial({
            color: colors[entity.side],
            transparent: true,
            opacity: 0.9,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        const point = this.displayPoint(entity);
        ring.position.set(
          point.x,
          this.height(point) + 0.12,
          point.y,
        );
        ring.userData.spawnCue = true;
        this.effects.add(ring);
      }
      if (cue.type === "attack") {
        const a = state.entities[cue.entityId],
          b = state.entities[cue.targetId];
        if (!a || !b) continue;
        const startPoint = this.displayPoint(a), endPoint = this.displayPoint(b);
        const start = new THREE.Vector3(
            startPoint.x,
            this.height(startPoint) + 1,
            startPoint.y,
          ),
          end = new THREE.Vector3(
            endPoint.x,
            this.height(endPoint) + 1,
            endPoint.y,
          );
        const beam = glow(
          box(
          this.effects,
          [0.14, 0.14, start.distanceTo(end)],
          start.clone().add(end).multiplyScalar(0.5).toArray(),
          a.side === "neutral" ? 0xbdd5bd : 0xffd289,
          ),
          a.side === "neutral" ? 0xc9e6c5 : 0xffd58e,
        );
        beam.lookAt(end);
        beam.userData.cue = true;
      }
      if (cue.type === "skill") {
        const actor = state.entities[cue.entityId],
          target = state.entities[cue.targetId];
        if (!actor || !target) continue;
        const start = new THREE.Vector3(
            this.displayPoint(actor).x,
            this.height(actor.position) + 1.1,
            this.displayPoint(actor).y,
          ),
          end = new THREE.Vector3(
            this.displayPoint(target).x,
            this.height(target.position) + 0.85,
            this.displayPoint(target).y,
          );
        const ray = glow(
          box(
          this.effects,
          [0.26, 0.26, start.distanceTo(end)],
          start.clone().add(end).multiplyScalar(0.5).toArray(),
          0xc6bfff,
          ),
          0xc6bfff,
        );
        ray.lookAt(end);
        ray.userData.skillCue = true;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.9, 0.14, 5, 10),
          new THREE.MeshBasicMaterial({ color: 0xffe5a4, toneMapped: false }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(end.x, this.height(target.position) + 0.14, end.z);
        ring.userData.skillCue = true;
        this.effects.add(ring);
        const crest = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.3, 0),
          new THREE.MeshBasicMaterial({ color: 0xd8d0ff, toneMapped: false }),
        );
        crest.position.set(end.x, end.y + 0.6, end.z);
        crest.userData.skillCue = true;
        this.effects.add(crest);
      }
      if (cue.type === "damage") {
        const e = state.entities[cue.entityId];
        if (e) {
          const point = this.displayPoint(e);
          for (let j = 0; j < 5; j++)
            glow(
              box(
                this.effects,
                [0.16, 0.16, 0.16],
                [
                  point.x + Math.cos(j * 1.8) * 0.7,
                  this.height(point) + 0.8 + j * 0.2,
                  point.y + Math.sin(j * 1.8) * 0.7,
                ],
                0xffdb89,
                j,
              ),
              0xffdc86,
            );
        }
      }
      if (cue.type === "vitals") {
        const e = state.entities[cue.entityId];
        if (!e) continue;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.78, 0.13, 4, 10),
          new THREE.MeshBasicMaterial({
            color: 0xa7f0b3,
            toneMapped: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        const point = this.displayPoint(e);
        ring.position.set(
          point.x,
          this.height(point) + 0.16,
          point.y,
        );
        ring.userData.vitalsCue = true;
        this.effects.add(ring);
      }
      if (cue.type === "destroy") {
        const e = state.entities[cue.entityId];
        if (e) {
          const point = this.displayPoint(e);
          for (let j = 0; j < 7; j++) {
            const shard = cone(
              this.effects,
              0.14 + (j % 3) * 0.05,
              0.34 + (j % 2) * 0.2,
              this.height(point) + 0.24 + (j % 3) * 0.22,
              j % 2 ? 0xc2a777 : 0x69766d,
              4,
            );
            shard.position.set(
              point.x + Math.cos(j * 1.45) * 0.55,
              this.height(point) + 0.24 + (j % 3) * 0.22,
              point.y + Math.sin(j * 1.45) * 0.55,
            );
            shard.userData.destroyCue = true;
          }
        }
      }
    }
  }
  private render = () => {
    if (this.destroyed) return;
    // A retained replay can be hidden by Ready, Enbu execution, or Analysis.
    // Keep its camera/selection but release GPU work while it has no viewport.
    if (!this.host.getClientRects().length || !this.host.clientWidth || !this.host.clientHeight) {
      this.canvas.dataset.suspended = "true";
      this.performanceWindowStart = 0;
      this.performanceFrameCount = 0;
      this.frame = requestAnimationFrame(this.render);
      return;
    }
    this.canvas.dataset.suspended = "false";
    try {
      const frameStarted = performance.now();
      this.gl.info.reset();
      this.controls.update();
      const tracked = this.trackedIds
        .map((id) => this.state?.entities[id])
        .filter((entity): entity is DisplayEntity => Boolean(entity && !entity.destroyed));
      if (this.trackedIds.length && !tracked.length) this.trackedIds = [];
      if (tracked.length) {
        const destination = tracked.reduce(
          (sum, entity) => {
            const point = this.renderPoint(entity);
            sum.x += point.x;
            sum.y += this.height(point);
            sum.z += point.y;
            return sum;
          },
          new THREE.Vector3(),
        ).multiplyScalar(1 / tracked.length);
        const delta = destination.sub(this.controls.target).multiplyScalar(this.playing && !this.reducedMotion ? 0.12 : 1);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
        this.controls.update();
      }
      const phase =
        this.playing && !this.reducedMotion
          ? Math.min(1, (performance.now() - this.changedAt) / 300)
          : 1;
      this.camera.updateMatrixWorld();
      const cameraUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      for (const g of this.units.values()) {
        if (g.userData.to) {
          if (this.replay.scene.routes?.length || !this.playing || this.reducedMotion)
            g.position.copy(g.userData.to);
          else g.position.lerpVectors(g.userData.from, g.userData.to, phase);
        }
        const actionPose = battlefieldUnitPose(
          this.state?.tick ?? 0,
          this.state?.cues ?? [],
          g.userData.entityId,
          Boolean(g.userData.walking),
          this.playing && !this.reducedMotion,
          phase,
        );
        g.userData.actionPose = actionPose;
        const rigMotion = battlefieldUnitRigMotion(actionPose);
        const rig = g.userData.animationRig as BattlefieldUnitRig | undefined;
        const entity = this.state?.entities[g.userData.entityId];
        if (rig) {
          const focused = this.selected === g.userData.entityId || this.trackedIds.includes(g.userData.entityId);
          const lod = g.children.find(child => child instanceof THREE.LOD) as THREE.LOD | undefined;
          if (lod) {
            // Orthographic zoom changes screen occupancy without changing
            // camera distance. Project the model bounds along camera-up so
            // Overview and Follow use its actual screen-space footprint.
            const [width, height, depth] = g.userData.modelBounds ?? [0, g.userData.modelHeight ?? 2.5, 0];
            const projectedHeight = Math.abs(cameraUp.x) * width + Math.abs(cameraUp.y) * height + Math.abs(cameraUp.z) * depth;
            const pixels = projectedHeight * this.host.clientHeight * this.camera.zoom / (this.camera.top - this.camera.bottom);
            const levelIndex = battlefieldUnitLodLevel(pixels, focused, Boolean(entity && this.isHero(entity)));
            lod.autoUpdate = false;
            lod.levels.forEach((level, index) => { level.object.visible = index === Math.min(levelIndex, lod.levels.length - 1); });
            g.userData.lodLevel = levelIndex;
            g.userData.lodPixelHeight = Number(pixels.toFixed(2));
          }
          const subject = this.trackedIds.length === 1 ? this.state?.entities[this.trackedIds[0]!] : undefined;
          const companion = Boolean(subject && entity && subject.id !== entity.id &&
            Math.hypot(subject.position.x - entity.position.x, subject.position.y - entity.position.y) < 2.5);
          const opacity = companion ? 0.27 : 1;
          if (g.userData.focusOpacity !== opacity) {
            const baseMaterials = g.userData.focusBaseMaterials as THREE.Material[];
            let clones = g.userData.focusOpacityMaterials as Map<THREE.Material, THREE.Material> | undefined;
            if (companion && !clones) {
              clones = new Map(baseMaterials.map(material => [material, material.clone()]));
              const replacements = new Map([...clones].map(([source, clone]) => [source, clone]));
              g.traverse(object => {
                if (!(object instanceof THREE.Mesh)) return;
                object.material = Array.isArray(object.material)
                  ? object.material.map(material => replacements.get(material) ?? material)
                  : replacements.get(object.material) ?? object.material;
              });
              g.userData.focusOpacityMaterials = clones;
            } else if (!companion && clones) {
              const originals = new Map([...clones].map(([source, clone]) => [clone, source]));
              g.traverse(object => {
                if (!(object instanceof THREE.Mesh)) return;
                object.material = Array.isArray(object.material)
                  ? object.material.map(material => originals.get(material) ?? material)
                  : originals.get(object.material) ?? object.material;
              });
              for (const material of clones.values()) material.dispose();
              delete g.userData.focusOpacityMaterials;
              clones = undefined;
            }
            const focusMaterials = clones ? [...clones.values()] : baseMaterials;
            for (const material of focusMaterials) {
              material.opacity = opacity;
              material.transparent = companion;
              material.depthWrite = !companion;
              material.needsUpdate = true;
            }
            g.userData.focusOpacity = opacity;
          }
          const rest = g.userData.rigRest as Map<THREE.Group, THREE.Euler>;
          for (const [joint, rotation] of rest) joint.rotation.copy(rotation);
          for (const [name, delta] of Object.entries(rigMotion.joints)) {
            const joint = rig.joints[name];
            if (joint) {
              joint.rotation.x += delta.x;
              joint.rotation.y += delta.y;
              joint.rotation.z += delta.z;
            }
          }
          for (const [name, delta] of Object.entries(rigMotion.weaponPivots)) {
            const pivot = rig.weaponPivots[name];
            if (pivot) {
              pivot.rotation.x += delta.x;
              pivot.rotation.y += delta.y;
              pivot.rotation.z += delta.z;
            }
          }
        }
        g.rotation.z = rigMotion.rootZ;
        const collapsing =
          this.playing &&
          !this.reducedMotion &&
          this.state?.cues.some(
            (c) =>
              c.type === "destroy" &&
              c.tick === this.state?.tick &&
              c.entityId === g.userData.entityId,
          );
        for (const fragment of g.children) {
          if (fragment.userData.rest) {
            fragment.position.lerpVectors(
              fragment.userData.fallingFrom,
              fragment.userData.rest,
              collapsing ? phase : 1,
            );
            fragment.rotation.z = collapsing ? (1 - phase) * 0.8 : 0;
          }
        }
      }
      this.effects.scale.y =
        this.playing && !this.reducedMotion
          ? 0.8 + Math.sin(phase * Math.PI) * 0.35
          : 1;
      for (const effect of this.effects.children)
        if (effect.userData.replayTransition) {
          const progress = this.playing && !this.reducedMotion
            ? Math.min(1, (performance.now() - this.changedAt) / effect.userData.transitionDurationMs)
            : 0.5;
          effect.visible = !this.playing || progress < 1;
          effect.scale.setScalar(0.85 + progress * 0.3);
        } else
        if (
          effect.userData.spawnCue ||
          effect.userData.skillCue ||
          effect.userData.vitalsCue
        ) {
          const pulse = this.playing && !this.reducedMotion ? phase : 1;
          effect.scale.setScalar(
            (effect.userData.skillCue ? 0.85 : 0.75) + pulse * 0.4,
          );
          const material = effect instanceof THREE.Mesh && effect.material;
          if (material && !Array.isArray(material) && "opacity" in material)
            material.opacity = 1 - pulse * 0.5;
        }
      const chosen = this.selected && this.units.get(this.selected);
      this.marker.visible = !!chosen;
      if (chosen) {
        const offset = this.modelOffsets.get(this.selected!);
        this.marker.position.copy(chosen.position).add(new THREE.Vector3(offset?.x ?? 0, 0, offset?.y ?? 0));
      }
      this.gl.setRenderTarget(this.target);
      this.gl.render(this.scene, this.camera);
      this.gl.setRenderTarget(null);
      this.gl.render(this.output, this.outputCamera);
      const hostRect = this.host.getBoundingClientRect();
      const labelPlacements: WorldLabelPlacement[] = [];
      const overlaps = screenRectsOverlap;
      const cueCameraSignature = [
        ...this.camera.position.toArray(),
        ...this.camera.quaternion.toArray(),
        this.camera.zoom,
        this.camera.left,
        this.camera.right,
        this.camera.top,
        this.camera.bottom,
        this.host.clientWidth,
        this.host.clientHeight,
      ].map((value) => value.toFixed(3)).join(":") +
        `:${this.mobile ? "mobile" : "desktop"}:${this.selected ?? ""}:${this.trackedIds.join(",")}:${this.state?.tick ?? -1}`;
      if (cueCameraSignature !== this.silhouetteLayoutSignature) {
        this.silhouetteLayoutSignature = cueCameraSignature;
        this.protectedSilhouetteRects = [];
        const bounds = new THREE.Box3();
        for (const [id, group] of this.units) {
          const entity = this.state?.entities[id];
          if (!entity || !(entity.kind === "unit" || entity.kind === "tower" || entity.kind === "base" || entity.kind === "bridge" || entity.kind === "observation")) continue;
          bounds.setFromObject(group);
          if (bounds.isEmpty()) continue;
          let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
          for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
            const point = new THREE.Vector3(x, y, z).project(this.camera);
            const px = ((point.x + 1) * this.host.clientWidth) / 2;
            const py = ((1 - point.y) * this.host.clientHeight) / 2;
            left = Math.min(left, px); right = Math.max(right, px);
            top = Math.min(top, py); bottom = Math.max(bottom, py);
          }
          const projected = {
            left: hostRect.left + left - 3,
            right: hostRect.left + right + 3,
            top: hostRect.top + top - 3,
            bottom: hostRect.top + bottom + 3,
          };
          if (projected.right >= hostRect.left && projected.left <= hostRect.right && projected.bottom >= hostRect.top && projected.top <= hostRect.bottom)
            this.protectedSilhouetteRects.push(projected);
        }
      }
      this.baseSites.render(this.state, this.camera, this.host.clientWidth, this.host.clientHeight);
      for (const element of this.host.querySelectorAll<HTMLElement>(".base-site-label")) {
        if (element.hidden) continue;
        const start = element.getBoundingClientRect();
        const left = Number.parseFloat(element.style.left) || 0;
        const top = Number.parseFloat(element.style.top) || 0;
        const shifts = [
          [0, 0], [0, -42], [0, 42], [-96, 0], [96, 0],
          [-96, -42], [96, -42], [-96, 42], [96, 42],
          [0, -84], [0, 84], [-192, 0], [192, 0],
        ] as const;
        let placed: DOMRect | undefined;
        for (const [dx, dy] of shifts) {
          const candidate = {
            left: start.left + dx, right: start.right + dx,
            top: start.top + dy, bottom: start.bottom + dy,
          };
          if (candidate.left < hostRect.left + 4 || candidate.right > hostRect.right - 4 ||
            candidate.top < hostRect.top + 4 || candidate.bottom > hostRect.bottom - 4 ||
            overlapsProtectedSilhouette(candidate, this.protectedSilhouetteRects)) continue;
          placed = start;
          element.style.left = `${left + dx}px`;
          element.style.top = `${top + dy}px`;
          break;
        }
        if (!placed) element.hidden = true;
        else {
          const rect = element.getBoundingClientRect();
          labelPlacements.push({ element, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, priority: 0 });
        }
      }
      if (this.cueLayoutSignature) {
        for (const cueLabel of this.cueLabels) {
          if (cueLabel.element.hidden) continue;
          const rect = cueLabel.element.getBoundingClientRect();
          labelPlacements.push({
            element: cueLabel.element,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            priority: 10,
          });
        }
      }
      const authoredScale = this.camera.top / Math.max(this.camera.zoom, 0.01);
      for (const label of this.labels) {
        const transform = this.mobile
          ? label.mobileTransform
          : label.desktopTransform;
        if (transform) label.element.style.transform = transform;
        const zoomVisible = !this.replay.scene.routes?.length ||
          authoredScale <= (label.kind === "lane" ? 112 : 54);
        const p = label.point.clone().project(this.camera);
        label.element.style.left = `${((p.x + 1) * this.host.clientWidth) / 2}px`;
        label.element.style.top = `${((1 - p.y) * this.host.clientHeight) / 2}px`;
        label.element.hidden =
          !zoomVisible || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1;
        if (label.element.hidden) continue;
        let rect = label.element.getBoundingClientRect();
        const shiftX = rect.left < hostRect.left + 6 ? hostRect.left + 6 - rect.left
          : rect.right > hostRect.right - 6 ? hostRect.right - 6 - rect.right : 0;
        const shiftY = rect.top < hostRect.top + 34 ? hostRect.top + 34 - rect.top
          : rect.bottom > hostRect.bottom - 10 ? hostRect.bottom - 10 - rect.bottom : 0;
        if (shiftX || shiftY) {
          label.element.style.left = `${((p.x + 1) * this.host.clientWidth) / 2 + shiftX}px`;
          label.element.style.top = `${((1 - p.y) * this.host.clientHeight) / 2 + shiftY}px`;
          rect = label.element.getBoundingClientRect();
        }
        if (labelPlacements.some((other) => overlaps(rect, other)) || overlapsProtectedSilhouette(rect, this.protectedSilhouetteRects)) {
          label.element.hidden = true;
          continue;
        }
        labelPlacements.push({
          element: label.element,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          priority: label.kind === "lane" ? 50 : 60,
        });
      }
      if (cueCameraSignature !== this.cueLayoutSignature) {
        this.cueLayoutSignature = cueCameraSignature;
        for (let index = labelPlacements.length - 1; index >= 0; index--)
          if (this.cueLabels.some(({ element }) => labelPlacements[index]?.element === element))
            labelPlacements.splice(index, 1);
        const currentState = this.state;
        const focusedHeroIds = new Set<string>();
        for (const id of [...(this.selected ? [this.selected] : []), ...this.trackedIds]) {
          const entity = currentState?.entities[id];
          if (entity && this.isHero(entity)) focusedHeroIds.add(id);
        }
        const focusedTargets = new Set(focusedHeroIds);
        for (const cueLabel of this.cueLabels) {
          if (
            (cueLabel.type === "attack" || cueLabel.type === "skill") &&
            cueLabel.sourceId &&
            focusedHeroIds.has(cueLabel.sourceId) &&
            cueLabel.targetId
          ) focusedTargets.add(cueLabel.targetId);
        }
        const candidates: ProjectedCueLabel[] = [];
        for (let order = 0; order < this.cueLabels.length; order++) {
          const cueLabel = this.cueLabels[order]!;
          cueLabel.element.hidden = true;
          const p = cueLabel.point.clone().project(this.camera);
          const inView = Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1;
          if (!inView) continue;
          candidates.push({
            cueLabel,
            projectedX: ((p.x + 1) * this.host.clientWidth) / 2,
            projectedY: ((1 - p.y) * this.host.clientHeight) / 2,
            order,
          });
        }
        const involvesFocusedHero = (candidate: ProjectedCueLabel) => {
          const { cueLabel } = candidate;
          if (
            cueLabel.type === "skill" &&
            cueLabel.sourceId &&
            focusedHeroIds.has(cueLabel.sourceId)
          ) return true;
          if (
            cueLabel.type === "destroy" &&
            cueLabel.entityId &&
            focusedHeroIds.has(cueLabel.entityId)
          ) return true;
          if (
            cueLabel.type === "damage" &&
            cueLabel.entityId &&
            focusedTargets.has(cueLabel.entityId)
          ) return true;
          return (
            (cueLabel.type === "attack" || cueLabel.type === "skill") &&
            Boolean(
              (cueLabel.sourceId && focusedHeroIds.has(cueLabel.sourceId)) ||
                (cueLabel.targetId && focusedHeroIds.has(cueLabel.targetId)),
            )
          );
        };
        const priority = (candidate: ProjectedCueLabel) => {
          const { cueLabel } = candidate;
          if (
            cueLabel.type === "skill" &&
            cueLabel.sourceId &&
            focusedHeroIds.has(cueLabel.sourceId)
          ) return 0;
          if (
            cueLabel.type === "destroy" &&
            cueLabel.entityId &&
            focusedHeroIds.has(cueLabel.entityId)
          ) return 0;
          const entity = cueLabel.entityId
            ? currentState?.entities[cueLabel.entityId]
            : undefined;
          if (
            cueLabel.type === "destroy" &&
            (entity?.kind === "base" || entity?.kind === "tower" ||
              Boolean(entity && this.isHero(entity)))
          ) return 1;
          if (
            cueLabel.type === "damage" &&
            cueLabel.entityId &&
            focusedTargets.has(cueLabel.entityId)
          ) return 2;
          if (
            (cueLabel.type === "attack" || cueLabel.type === "skill") &&
            involvesFocusedHero(candidate)
          ) return 3;
          if (cueLabel.type === "attack" || cueLabel.type === "skill") return 4;
          if (cueLabel.type === "damage") return 5;
          if (cueLabel.type === "destroy") return 6;
          if (cueLabel.type === "vitals") return 7;
          return 8;
        };
        const ordered = [...candidates].sort(
          (a, b) => priority(a) - priority(b) || a.order - b.order,
        );
        const hasFocusedEvent = candidates.some(involvesFocusedHero);
        const budget = this.mobile ? 3 : 8;
        const chosen = ordered.slice(0, budget);
        if (!hasFocusedEvent) {
          const fallback = candidates.find(({ cueLabel }) =>
            cueLabel.type === "attack" || cueLabel.type === "skill",
          );
          if (fallback && !chosen.includes(fallback)) {
            if (chosen.length >= budget) chosen[chosen.length - 1] = fallback;
            else chosen.push(fallback);
          }
        }
        const safeTop = hostRect.top + Math.min(88, hostRect.height * 0.3);
        const safeBottom = hostRect.bottom - Math.min(60, hostRect.height * 0.2);
        for (const candidate of chosen) {
          const { cueLabel, projectedX, projectedY } = candidate;
          const element = cueLabel.element;
          element.hidden = false;
          element.style.left = `${projectedX}px`;
          element.style.top = `${projectedY}px`;
          const labelWidth = element.getBoundingClientRect().width;
          const minX = Math.min(this.host.clientWidth / 2, labelWidth / 2 + 4);
          const maxX = Math.max(minX, this.host.clientWidth - labelWidth / 2 - 4);
          element.style.left = `${THREE.MathUtils.clamp(projectedX, minX, maxX)}px`;
          const labelHeight = element.getBoundingClientRect().height;
          const verticalStep = Math.max(32, Math.ceil((labelHeight + 8) / 8) * 8);
          let placedRect: { left: number; right: number; top: number; bottom: number } | null = null;
          const maxSteps = Math.ceil(hostRect.height / verticalStep) + 1;
          for (let step = 0; step < maxSteps; step++) {
            // A cue can rise into free space; it cannot fall onto the body it
            // describes merely to fit another label beneath the controls.
            const offset = -step * verticalStep;
            element.style.transform = offset < 0
              ? `translate(-50%, calc(-120% - ${-offset}px))`
              : offset > 0
                ? `translate(-50%, calc(-120% + ${offset}px))`
                : "translate(-50%, -120%)";
            const rect = element.getBoundingClientRect();
            const box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            const inside =
              box.left >= hostRect.left + 4 &&
              box.right <= hostRect.right - 4 &&
              box.top >= safeTop + 4 &&
              box.bottom <= safeBottom - 4;
            const cuePriority = priority(candidate) * 4 + 5;
            const collisions = labelPlacements.filter((other) => overlaps(box, other));
            const blocked = collisions.some((other) => other.priority <= cuePriority) ||
              overlapsProtectedSilhouette(box, this.protectedSilhouetteRects);
            if (inside && !blocked) {
              placedRect = box;
              for (const lowerPriority of collisions) {
                lowerPriority.element.hidden = true;
                const placementIndex = labelPlacements.indexOf(lowerPriority);
                if (placementIndex >= 0) labelPlacements.splice(placementIndex, 1);
              }
              labelPlacements.push({
                element,
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                priority: cuePriority,
              });
              break;
            }
          }
          if (!placedRect) {
            element.hidden = true;
            continue;
          }
        }
      }
      const entityLabelEntries = [...this.entityLabels.entries()].sort(([left], [right]) => {
        const focused = (id: string) => id === this.selected || this.trackedIds.includes(id);
        return Number(focused(right)) - Number(focused(left)) || left.localeCompare(right);
      });
      for (const [id, element] of entityLabelEntries) {
        const entity = this.state?.entities[id];
        const group = this.units.get(id);
        const nearbyHeroes = entity && this.isHero(entity)
          ? Object.values(this.state?.entities ?? {}).filter((other) =>
              this.isHero(other) &&
              !other.destroyed &&
              Math.hypot(
                other.position.x - entity.position.x,
                other.position.y - entity.position.y,
              ) < 0.65,
            )
          : [];
        const heroStack = entity
          ? nearbyHeroes
              .filter((other) => other.side === entity.side)
              .sort((a, b) => a.id.localeCompare(b.id))
          : [];
        const overlapsOtherSide = Boolean(
          entity && nearbyHeroes.some((other) => other.side !== entity.side),
        );
        const focused = Boolean(
          entity &&
            (this.selected === id ||
              (this.trackedIds.length === 1 && this.trackedIds[0] === id)),
        );
        const groupedHeroes = Boolean(
          entity &&
            this.cameraMode === "tactical" &&
            authoredScale <= 30 &&
            heroStack.length > 1 &&
            heroStack[0].id === id,
        );
        const individualHero = Boolean(
          entity &&
            this.cameraMode === "tactical" &&
            authoredScale <= 16 &&
            !entity.destroyed &&
            heroStack.length === 1 &&
            heroStack[0].id === id,
        );
        const visible = Boolean(
          entity &&
            group &&
            (focused || (this.trackedIds.length !== 1 && (groupedHeroes || individualHero))),
        );
        element.hidden = !visible;
        element.dataset.focused = String(focused);
        if (!visible || !group) continue;
        const identity = this.entityLabel(entity!).replace(/^HERO · /, "");
        const sideMarker = this.sideMarker(entity!.side);
        const healthSuffix = this.entityHealthSuffix(entity!);
        element.textContent = focused
          ? `${sideMarker} · ${identity}${healthSuffix}`
          : groupedHeroes
            ? `${sideMarker} · ${heroStack.length} visible Heroes`
            : `${focused ? `${sideMarker} · ` : ""}${this.entityLabel(entity!)}${healthSuffix}`;
        const height = entity?.kind === "base"
          ? this.replay.scene.routes?.length ? 2.6 : 4.6
          : entity?.kind === "tower" ? 4 : 2.8;
        const modelOffset = this.modelOffsets.get(id);
        const p = group.position.clone().add(new THREE.Vector3(modelOffset?.x ?? 0, height, modelOffset?.y ?? 0)).project(this.camera);
        if (focused && this.replay.scene.routes?.length) {
          element.style.left = this.mobile ? "8px" : "182px";
          element.style.top = "auto";
          element.style.bottom = "10px";
          element.style.transform = "none";
          element.style.maxWidth = this.mobile ? "calc(100% - 112px)" : "min(380px, calc(100% - 210px))";
          element.hidden = false;
          continue;
        }
        element.style.bottom = "auto";
        element.style.left = `${((p.x + 1) * this.host.clientWidth) / 2}px`;
        element.style.top = `${((1 - p.y) * this.host.clientHeight) / 2}px`;
        const separateSelectedIdentity = Boolean(
          focused &&
            heroStack.length > 1 &&
            heroStack[0].id !== id,
        );
        const sideOffset = separateSelectedIdentity
          ? entity!.side === "azure"
            ? -42
            : entity!.side === "vermilion"
              ? 42
              : 0
          : overlapsOtherSide
            ? entity!.side === "azure"
              ? -14
              : entity!.side === "vermilion"
                ? 14
                : 0
            : 0;
        element.style.transform = `translate(-50%, calc(-120% + ${sideOffset}px))`;
        element.hidden = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1;
        if (element.hidden) continue;
        const rect = element.getBoundingClientRect();
        // A partly clipped nameplate cannot identify its unit. Keep the body
        // visible and let selection expose its full peripheral identity.
        if (
          rect.left < hostRect.left + 4 || rect.right > hostRect.right - 4 ||
          rect.top < hostRect.top + 4 || rect.bottom > hostRect.bottom - 4
        ) {
          element.hidden = true;
          continue;
        }
        if (overlapsProtectedSilhouette(rect, this.protectedSilhouetteRects)) {
          element.hidden = true;
          continue;
        }
        const entityPriority = focused ? 0 : groupedHeroes ? 40 : 45;
        const collisions = labelPlacements.filter((other) => overlaps(rect, other));
        if (collisions.some((other) => other.priority <= entityPriority)) {
          element.hidden = true;
          continue;
        }
        for (const lowerPriority of collisions) {
          lowerPriority.element.hidden = true;
          const placementIndex = labelPlacements.indexOf(lowerPriority);
          if (placementIndex >= 0) labelPlacements.splice(placementIndex, 1);
        }
        labelPlacements.push({
          element,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          priority: entityPriority,
        });
      }
      this.canvas.dataset.camera =
        this.camera.position
          .toArray()
          .map((v) => v.toFixed(3))
          .join(",") +
        ":" +
        this.camera.zoom.toFixed(3) + ":" +
        [this.camera.left, this.camera.right, this.camera.top, this.camera.bottom]
          .map((value) => value.toFixed(3)).join(",");
      this.canvas.dataset.tick = String(this.state?.tick ?? 0);
      this.canvas.dataset.cameraTarget = this.controls.target.toArray().map((value) => value.toFixed(3)).join(",");
      this.canvas.dataset.cameraMode = this.cameraMode;
      this.canvas.dataset.fog = this.state?.fog ? "authorized-graph-samples" : "unavailable";
      this.canvas.dataset.fogTick = this.state?.fog ? String(this.state.fog.state.tick) : "";
      this.canvas.dataset.lastKnownFacilities = String(this.state?.fog?.state.facilities.length ?? 0);
      this.canvas.dataset.fogNodes = this.state?.fog ? JSON.stringify(this.state.fog.state.nodes) : "";
      this.canvas.dataset.tracking = this.trackedIds.join(",");
      const poseEntityId = this.selected && this.units.has(this.selected)
        ? this.selected
        : this.trackedIds.length === 1 ? this.trackedIds[0] : undefined;
      const poseGroup = poseEntityId ? this.units.get(poseEntityId) : undefined;
      const pose = poseGroup?.userData.actionPose as ReturnType<typeof battlefieldUnitPose> | undefined;
      this.canvas.dataset.unitPoseEntity = poseEntityId ?? "";
      this.canvas.dataset.unitPose = pose
        ? pose.death > 0.001 ? "death" : pose.skill > 0.001 ? "skill" : pose.strike > 0.001 ? "attack" : pose.hit > 0.001 ? "hit" : Math.abs(pose.walk) > 0.001 ? "move" : "idle"
        : "none";
      this.canvas.dataset.unitPoseSample = pose
        ? [pose.walk, pose.strike, pose.hit, pose.attackLean].map((value) => value.toFixed(3)).join(",")
        : "";
      this.canvas.dataset.rendered = "true";
      this.canvas.dataset.drawCalls = String(this.gl.info.render.calls);
      this.canvas.dataset.triangles = String(this.gl.info.render.triangles);
      this.canvas.dataset.lodSummary = JSON.stringify([...this.units.values()].reduce((counts, group) => {
        const level = group.userData.lodLevel === 0 ? "full" : group.userData.lodLevel === 1 ? "medium" : "far";
        counts[level]++;
        return counts;
      }, { full: 0, medium: 0, far: 0 }));
      this.canvas.dataset.renderCpuMs = (performance.now() - frameStarted).toFixed(2);
      if (!this.performanceWindowStart) this.performanceWindowStart = frameStarted;
      this.performanceFrameCount++;
      const windowMs = frameStarted - this.performanceWindowStart;
      if (windowMs >= 1000) {
        this.canvas.dataset.fps = (this.performanceFrameCount * 1000 / windowMs).toFixed(1);
        this.performanceWindowStart = frameStarted;
        this.performanceFrameCount = 0;
      }
      this.frame = requestAnimationFrame(this.render);
    } catch (error) {
      this.onFailure(error instanceof Error ? error.message : "WebGL描画失敗");
    }
  };
  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.battlefieldFog.dispose();
    disposeTree(this.scene);
    disposeTree(this.output);
    this.target.dispose();
    this.gl.dispose();
    this.canvas.remove();
    this.labels.forEach((label) => label.element.remove());
    this.entityLabels.forEach((label) => label.remove());
    this.baseSites.dispose();
    this.battlefieldLandmarks.dispose();
    this.cueLabels.forEach((label) => label.element.remove());
  }
}
