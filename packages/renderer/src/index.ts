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
    for (const lane of replay.scene.lanes) {
      const element = document.createElement("span");
      element.className = "world-label";
      element.textContent = lane.label;
      host.appendChild(element);
      const p = lane.points[0];
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
    const mobile = w < 700,
      changed = mobile !== this.mobile;
    this.mobile = mobile;
    this.gl.setSize(w, h);
    this.target.setSize(
      Math.max(1, Math.floor(w / (this.pixel ? 2 : 1))),
      Math.max(1, Math.floor(h / (this.pixel ? 2 : 1))),
    );
    const span = mobile ? Math.max(18.5, (14 * h) / w) : 13;
    const aspect = w / h;
    this.camera.left = -span * aspect;
    this.camera.right = span * aspect;
    this.camera.top = span * 1.15;
    this.camera.bottom = -span * 0.85;
    this.camera.updateProjectionMatrix();
    if (changed) this.resetCamera();
  };
  resetCamera() {
    const { min, max } = this.replay.scene.bounds;
    const center = new THREE.Vector3(
      (min.x + max.x) / 2,
      0,
      (min.y + max.y) / 2,
    );
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position
      .copy(center)
      .add(
        this.mobile
          ? new THREE.Vector3(34, 34, 9)
          : new THREE.Vector3(14, 28, 32),
      );
    this.camera.zoom = 1;
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = true;
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
    this.layout();
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
    box(this.scene, [w, 1.2, d], [cx, -1, cz], 0x34494b);
    box(this.scene, [w - 0.2, 0.45, d - 0.2], [cx, -0.3, cz], 0x73836b);
    box(this.scene, [200, 0.1, 200], [0, -2, 0], 0x263f4e);
    // A sunken river and stepped banks give the three routes a readable crossing.
    box(this.scene, [2.1, 0.08, d - 0.4], [0, -0.035, cz], 0x548f9a);
    for (let z = min.y; z <= max.y; z += 1.4)
      box(this.scene, [0.8, 0.03, 0.07], [0.3, 0.015, z], 0x9cc9bc);
    for (const lane of this.replay.scene.lanes) {
      for (let i = 1; i < lane.points.length; i++) {
        const a = lane.points[i - 1],
          b = lane.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y),
          angle = -Math.atan2(b.y - a.y, b.x - a.x);
        box(
          this.scene,
          [len + 1, 0.28, 2.75],
          [(a.x + b.x) / 2, lane.elevation - 0.12, (a.y + b.y) / 2],
          0x889376,
          angle,
        );
        box(
          this.scene,
          [len, 0.07, 2.15],
          [(a.x + b.x) / 2, lane.elevation + 0.04, (a.y + b.y) / 2],
          0xc0b79a,
          angle,
        );
        const count = Math.ceil(len / 0.65);
        for (let j = 0; j < count; j++) {
          const f = j / count;
          const x = a.x + (b.x - a.x) * f,
            z = a.y + (b.y - a.y) * f;
          box(
            this.scene,
            [0.48, 0.025, 0.12],
            [x, lane.elevation + 0.085, z + 0.74],
            0xd6c9a4,
            angle,
          );
          if (Math.abs(x) < 1.45)
            box(
              this.scene,
              [0.55, 0.14, 2.5],
              [x, lane.elevation + 0.03, z],
              0x9c8058,
              angle,
            );
        }
      }
    }
    // Authored deterministic low-poly terrain; no downloaded assets or runtime randomness.
    for (let i = 0; i < 38; i++) {
      const x = min.x + 1 + ((i * 7.13) % (w - 4)),
        z = min.y + 0.4 + ((i * 3.17) % (d - 3));
      const near = this.replay.scene.lanes.some((l) =>
        l.points
          .slice(1)
          .some((b, j) => distanceToSegment({ x, y: z }, l.points[j], b) < 2),
      );
      if (near || Math.abs(x) < 2) continue;
      const h = 0.35 + (i % 4) * 0.26;
      box(
        this.scene,
        [1.8, h, 1.2],
        [x, h / 2 - 0.05, z],
        i % 2 ? 0x84916e : 0x768b6a,
        (i % 3) * 0.13,
      );
      if (i % 3 === 0) {
        const tree = new THREE.Group();
        tree.position.set(x, h, z);
        box(tree, [0.18, 1, 0.18], [0, 0.5, 0], 0x6e6650);
        cone(tree, 0.7, 1.5, 1.35, 0x435e51);
        cone(tree, 0.5, 1.3, 1.9, 0x58775c);
        this.scene.add(tree);
      }
    }
    for (const x of [min.x - 0.2, max.x + 0.2])
      for (let j = 0; j < 8; j++)
        box(
          this.scene,
          [0.6, 0.5, 0.8],
          [x, -0.1, min.y + j * 2.2],
          0x7a8377,
          j * 0.3,
        );
  }
  private model(e: DisplayEntity) {
    const g = new THREE.Group();
    g.userData.entityId = e.id;
    const color = colors[e.side];
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
      const base = e.kind === "base";
      const wide = base ? 2 : 1.15;
      const high = base ? 2.4 : 1.8;
      box(g, [wide + 0.35, 0.3, wide + 0.35], [0, 0.15, 0], 0x696f62);
      box(g, [wide, high, wide], [0, high / 2 + 0.3, 0], stone);
      box(g, [wide + 0.2, 0.22, wide + 0.2], [0, high + 0.3, 0], 0xd5cdb2);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          box(
            g,
            [0.3, 0.45, 0.3],
            [x * wide * 0.44, high + 0.6, z * wide * 0.44],
            stone,
          );
      box(g, [0.32, 0.7, 0.08], [0, high * 0.65, wide / 2 + 0.04], 0x344a51);
      box(g, [0.12, 1.8, 0.12], [0, high + 1.05, 0], 0x6e6552);
      box(
        g,
        [e.side === "azure" ? 0.85 : 0.65, 0.55, 0.07],
        [0.35, high + 1.6, 0],
        color,
        e.side === "azure" ? 0 : 0.35,
      );
      box(g, [wide + 0.02, 0.32, wide + 0.02], [0, 0.7, 0], color);
      if (base) {
        cone(g, 1.1, 0.8, high + 1, 0x566e72);
        for (const x of [-1.15, 1.15])
          box(g, [0.55, 1.6, 0.7], [x, 0.8, 0], stone);
      }
      if (e.hp < e.maxHp) {
        box(g, [0.1, 0.95, 0.04], [0.2, 1, wide / 2 + 0.05], 0x3e4c49, 0.3);
        box(g, [0.55, 0.12, 0.06], [-0.25, 1.5, wide / 2 + 0.07], 0x57665b);
      }
    } else {
      g.scale.setScalar(1.15);
      const heavy = e.appearanceKey === "heavy",
        archer = e.appearanceKey === "archer";
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
        g.rotation.y = e.side === "azure" ? -Math.PI / 2 : Math.PI / 2;
      if (!playing || this.reducedMotion) g.position.copy(g.userData.to);
    }
    disposeTree(this.effects);
    this.effects.clear();
    for (const cue of state.cues) {
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
        const beam = box(
          this.effects,
          [0.09, 0.09, start.distanceTo(end)],
          start.clone().add(end).multiplyScalar(0.5).toArray(),
          0xffd289,
        );
        beam.lookAt(end);
        beam.userData.cue = true;
      }
      if (cue.type === "damage") {
        const e = state.entities[cue.entityId];
        if (e)
          for (let j = 0; j < 5; j++)
            box(
              this.effects,
              [0.12, 0.12, 0.12],
              [
                e.position.x + Math.cos(j * 1.8) * 0.7,
                this.height(e.position) + 0.8 + j * 0.2,
                e.position.y + Math.sin(j * 1.8) * 0.7,
              ],
              0xffdb89,
              j,
            );
      }
    }
  }
  private render = () => {
    if (this.destroyed) return;
    try {
      this.controls.update();
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
