import * as THREE from "three";
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

function segmentIntersection(
  a: WorldPoint,
  b: WorldPoint,
  c: WorldPoint,
  d: WorldPoint,
) {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y,
    denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 0.0001) return null;
  const qx = c.x - a.x,
    qy = c.y - a.y,
    t = (qx * sy - qy * sx) / denominator,
    u = (qx * ry - qy * rx) / denominator;
  if (t < 0.02 || t > 0.98 || u < 0.02 || u > 0.98) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
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
function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const mats = Array.isArray(node.material)
        ? node.material
        : [node.material];
      mats.forEach((m) => m.dispose());
    }
  });
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
  private state: DisplayState | null = null;
  private playing = false;
  private changedAt = 0;
  private frame = 0;
  private resize: ResizeObserver;
  private mobile = false;
  private pixel = true;
  private destroyed = false;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  private selected: string | null = null;
  private tracked: string | null = null;
  private labels: { element: HTMLSpanElement; point: THREE.Vector3 }[] = [];
  private marker = new THREE.Group();
  private startPointer = { x: 0, y: 0 };
  readonly canvas: HTMLCanvasElement;
  constructor(
    private host: HTMLElement,
    private replay: Replay,
    private onSelect: (id: string) => void,
    private onFailure: (message: string) => void,
  ) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.canvas = this.gl.domElement;
    this.canvas.setAttribute(
      "aria-label",
      "3D戦場。ドラッグで回転、ホイールまたはピンチでズーム",
    );
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.gl.setPixelRatio(1);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    host.appendChild(this.canvas);
    this.scene.background = new THREE.Color(0x263f4e);
    this.scene.fog = new THREE.Fog(0x263f4e, 65, 115);
    this.scene.add(new THREE.HemisphereLight(0xddefff, 0x5b6046, 1.6));
    const sun = new THREE.DirectionalLight(0xffe6b7, 2.8);
    sun.position.set(-10, 23, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -24,
      right: 24,
      top: 22,
      bottom: -22,
      near: 1,
      far: 70,
    });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.08;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fdcec, 1);
    fill.position.set(15, 10, -20);
    this.scene.add(fill);
    this.terrain();
    for (const camp of replay.scene.camps ?? [])
      this.buildCamp(camp.position, camp.id);
    this.scene.add(this.camps);
    for (const lane of replay.scene.lanes) {
      const element = document.createElement("span");
      element.className = "world-label";
      element.textContent = lane.label;
      host.appendChild(element);
      const p = lane.points[Math.min(1, lane.points.length - 1)];
      this.labels.push({
        element,
        point: new THREE.Vector3(p.x, lane.elevation + 0.15, p.y),
      });
    }
    this.scene.add(this.effects, this.marker);
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
    const hit = ray.intersectObjects([...this.units.values()], true)[0];
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
    this.resetCamera();
  };
  resetCamera() {
    this.tracked = null;
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
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = true;
  }
  setTracking(id: string | null) {
    this.tracked = id;
    if (!id) this.resetCamera();
  }
  zoom(factor: number) {
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
  }
  private height(p: WorldPoint) {
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
  private terrain() {
    const { min, max } = this.replay.scene.bounds;
    const w = max.x - min.x + 2,
      d = max.y - min.y + 2,
      cx = (max.x + min.x) / 2,
      cz = (max.y + min.y) / 2;
    box(this.scene, [200, 0.1, 200], [0, -2, 0], 0x263f4e);
    box(this.scene, [w + 2, 1.3, d + 2], [cx, -1, cz], 0x34494b);
    box(this.scene, [w + 0.3, 0.5, d + 0.3], [cx, -0.32, cz], 0x566957);
    box(this.scene, [w, 0.24, d], [cx, -0.08, cz], 0x77846c);

    // A winding river runs against the diagonal battle routes, giving the
    // center of the map three visible crossings and separating the jungle.
    const stream: WorldPoint[] = [
      { x: cx - w * 0.22, y: min.y - 0.4 },
      { x: cx - w * 0.15, y: cz - d * 0.28 },
      { x: cx - w * 0.04, y: cz - d * 0.09 },
      { x: cx + w * 0.06, y: cz + d * 0.1 },
      { x: cx + w * 0.14, y: cz + d * 0.28 },
      { x: cx + w * 0.21, y: max.y + 0.4 },
    ];
    const bank = ribbon(stream, 2.2, -0.15);
    const bankMesh = new THREE.Mesh(
      bank.geometry,
      new THREE.MeshStandardMaterial({
        color: 0x526b61,
        roughness: 1,
        flatShading: true,
      }),
    );
    bankMesh.receiveShadow = true;
    this.scene.add(bankMesh);
    const water = ribbon(stream, 1.45, -0.08, 0.02);
    const waterMesh = new THREE.Mesh(
      water.geometry,
      new THREE.MeshStandardMaterial({
        color: 0x4c8990,
        roughness: 0.34,
        metalness: 0.08,
        flatShading: true,
      }),
    );
    waterMesh.receiveShadow = true;
    this.scene.add(waterMesh);

    const crossings: { point: WorldPoint; angle: number; elevation: number }[] = [];
    for (const lane of this.replay.scene.lanes) {
      const shoulder = ribbon(lane.points, 4.2, lane.elevation - 0.14);
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
      for (let i = 1; i < lane.points.length; i++) {
        const a = lane.points[i - 1],
          b = lane.points[i];
        const found = stream
          .slice(1)
          .map((end, j) => segmentIntersection(a, b, stream[j], end))
          .find((point) => point !== null);
        if (found) {
          crossings.push({
            point: found,
            angle: -Math.atan2(b.y - a.y, b.x - a.x),
            elevation: lane.elevation,
          });
          break;
        }
      }
    }
    for (const crossing of crossings) {
      const bridge = new THREE.Group();
      bridge.position.set(crossing.point.x, crossing.elevation + 0.13, crossing.point.y);
      bridge.rotation.y = crossing.angle;
      box(bridge, [4.4, 0.28, 2.15], [0, 0, 0], 0x897452);
      for (const x of [-1.7, -0.85, 0, 0.85, 1.7])
        box(bridge, [0.09, 0.025, 1.9], [x, 0.16, 0], 0xc0a574);
      for (const side of [-1, 1])
        for (const x of [-1.75, 1.75])
          box(bridge, [0.14, 0.52, 0.14], [x, 0.3, side * 0.9], 0x635f4b);
      this.scene.add(bridge);
    }

    // Reproducible low-poly groves frame open jungle clearings between lanes.
    for (let i = 0; i < 58; i++) {
      const x = min.x + 0.8 + ((i * 7.13) % (w - 1.8)),
        z = min.y + 0.6 + ((i * 3.17) % (d - 1.2));
      const near = this.replay.scene.lanes.some((l) =>
        l.points
          .slice(1)
          .some((b, j) => distanceToSegment({ x, y: z }, l.points[j], b) < 2.55),
      );
      const inRiver = stream
        .slice(1)
        .some((b, j) => distanceToSegment({ x, y: z }, stream[j], b) < 1.5);
      if (near || inRiver) continue;
      const h = 0.35 + (i % 4) * 0.26;
      if (i % 5 === 0) {
        const rock = box(
          this.scene,
          [0.8 + (i % 3) * 0.16, h, 0.75],
          [x, h / 2 - 0.05, z],
          i % 2 ? 0x84916e : 0x768b6a,
          (i % 3) * 0.13,
        );
        rock.rotation.z = (i % 2 ? 1 : -1) * 0.14;
      } else {
        const tree = new THREE.Group();
        tree.position.set(x, 0, z);
        box(tree, [0.2, 1.15, 0.2], [0, 0.56, 0], 0x6e6650);
        cone(tree, 0.76, 1.6, 1.35, i % 2 ? 0x435e51 : 0x4e6953);
        cone(tree, 0.58, 1.36, 1.95, i % 3 ? 0x58775c : 0x66805d);
        this.scene.add(tree);
      }
    }
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
    const campAccent = campId.includes("center")
      ? 0x8eb9a6
      : campId.includes("se")
        ? 0xc98968
        : 0xc2a36b;
    const camp = new THREE.Group();
    camp.position.set(position.x, 0, position.y);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.75, 1.9, 0.16, 8),
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
      new THREE.TorusGeometry(1.55, 0.08, 4, 10),
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
        [Math.cos(angle) * 2.15, 0.18, Math.sin(angle) * 2.15],
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
    bar.castShadow = false;
    const hp = box(
      parent,
      [Math.max(0.02, (0.84 * e.hp) / e.maxHp), 0.07, 0.11],
      [-0.42 * (1 - e.hp / e.maxHp), y + 0.008, 0.005],
      sideColor,
    );
    hp.castShadow = false;
  }
  private canonicalAppearance(e: DisplayEntity) {
    const catalogId = e.catalogId?.toLowerCase();
    if (catalogId && catalogAppearance[catalogId])
      return catalogAppearance[catalogId];
    const appearance = e.appearanceKey.toLowerCase();
    const heroSuffix = appearance.replace(/^senkei\.next\.hero\./, "");
    return catalogAppearance[heroSuffix] ?? appearance.replaceAll("_", "-");
  }
  private heroModel(g: THREE.Group, e: DisplayEntity, color: number) {
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
    const base = e.kind === "base";
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
    if (e.destroyed) {
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
    this.changedAt = performance.now();
    for (const [id, g] of this.units)
      if (!state.entities[id]) {
        this.scene.remove(g);
        disposeTree(g);
        this.units.delete(id);
      }
    for (const e of Object.values(state.entities)) {
      let g = this.units.get(e.id);
      if (!g || g.userData.signature !== `${e.hp}:${e.destroyed}`) {
        const position = g?.position.clone();
        if (g) {
          this.scene.remove(g);
          disposeTree(g);
        }
        g = this.model(e);
        g.userData.signature = `${e.hp}:${e.destroyed}`;
        if (position) g.position.copy(position);
        else
          g.position.set(e.position.x, this.height(e.position), e.position.y);
        this.units.set(e.id, g);
        this.scene.add(g);
      }
      g.userData.from = g.position.clone();
      g.userData.to = new THREE.Vector3(
        e.position.x,
        this.height(e.position),
        e.position.y,
      );
      if (e.kind === "unit")
        g.rotation.y = e.side === "azure" ? Math.PI / 2 : -Math.PI / 2;
      if (!playing || this.reducedMotion) g.position.copy(g.userData.to);
    }
    disposeTree(this.effects);
    this.effects.clear();
    for (const cue of state.cues) {
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
        ring.position.set(
          entity.position.x,
          this.height(entity.position) + 0.12,
          entity.position.y,
        );
        ring.userData.spawnCue = true;
        this.effects.add(ring);
      }
      if (cue.type === "attack") {
        const a = state.entities[cue.entityId],
          b = state.entities[cue.targetId];
        if (!a || !b) continue;
        const start = new THREE.Vector3(
            a.position.x,
            this.height(a.position) + 1,
            a.position.y,
          ),
          end = new THREE.Vector3(
            b.position.x,
            this.height(b.position) + 1,
            b.position.y,
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
            actor.position.x,
            this.height(actor.position) + 1.1,
            actor.position.y,
          ),
          end = new THREE.Vector3(
            target.position.x,
            this.height(target.position) + 0.85,
            target.position.y,
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
        if (e)
          for (let j = 0; j < 5; j++)
            glow(
              box(
                this.effects,
                [0.16, 0.16, 0.16],
                [
                  e.position.x + Math.cos(j * 1.8) * 0.7,
                  this.height(e.position) + 0.8 + j * 0.2,
                  e.position.y + Math.sin(j * 1.8) * 0.7,
                ],
                0xffdb89,
                j,
              ),
              0xffdc86,
            );
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
        ring.position.set(
          e.position.x,
          this.height(e.position) + 0.16,
          e.position.y,
        );
        ring.userData.vitalsCue = true;
        this.effects.add(ring);
      }
      if (cue.type === "destroy") {
        const e = state.entities[cue.entityId];
        if (e)
          for (let j = 0; j < 7; j++)
            cone(
              this.effects,
              0.14 + (j % 3) * 0.05,
              0.34 + (j % 2) * 0.2,
              this.height(e.position) + 0.24 + (j % 3) * 0.22,
              j % 2 ? 0xc2a777 : 0x69766d,
              4,
            ).position.x = e.position.x + Math.cos(j * 1.45) * 0.55;
      }
    }
  }
  private render = () => {
    if (this.destroyed) return;
    try {
      this.controls.update();
      if (this.tracked && this.state?.entities[this.tracked]) {
        const entity = this.state.entities[this.tracked];
        if (!entity.destroyed) {
          const destination = new THREE.Vector3(
            entity.position.x,
            this.height(entity.position),
            entity.position.y,
          );
          const delta = destination
            .sub(this.controls.target)
            .multiplyScalar(0.12);
          this.controls.target.add(delta);
          this.camera.position.add(delta);
          this.controls.update();
        }
      }
      const phase =
        this.playing && !this.reducedMotion
          ? Math.min(1, (performance.now() - this.changedAt) / 300)
          : 1;
      for (const g of this.units.values()) {
        if (g.userData.to)
          g.position.lerpVectors(g.userData.from, g.userData.to, phase);
        if (
          this.playing &&
          !this.reducedMotion &&
          this.state?.cues.some(
            (c) => c.type === "attack" && c.entityId === g.userData.entityId,
          )
        )
          g.rotation.z = Math.sin(phase * Math.PI) * 0.16;
        else g.rotation.z = 0;
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
      if (chosen) this.marker.position.copy(chosen.position);
      this.gl.setRenderTarget(this.target);
      this.gl.render(this.scene, this.camera);
      this.gl.setRenderTarget(null);
      this.gl.render(this.output, this.outputCamera);
      for (const label of this.labels) {
        const p = label.point.clone().project(this.camera);
        label.element.style.left = `${((p.x + 1) * this.host.clientWidth) / 2}px`;
        label.element.style.top = `${((1 - p.y) * this.host.clientHeight) / 2}px`;
        label.element.hidden = Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
      }
      this.canvas.dataset.camera =
        this.camera.position
          .toArray()
          .map((v) => v.toFixed(3))
          .join(",") +
        ":" +
        this.camera.zoom.toFixed(3);
      this.canvas.dataset.tick = String(this.state?.tick ?? 0);
      this.canvas.dataset.rendered = "true";
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
    disposeTree(this.scene);
    disposeTree(this.output);
    this.target.dispose();
    this.gl.dispose();
    this.canvas.remove();
    this.labels.forEach((label) => label.element.remove());
  }
}
