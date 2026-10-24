import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type HeroView = 'detail' | 'portrait' | 'battle';
export type HeroLight = 'studio' | 'daylight' | 'rim';
export interface HeroInspection { clips: { name: string; duration: number }[]; triangles: number; meshes: number; skinnedMeshes: number }

/** Isolated, presentation-only GLB viewer. No catalog, replay or engine dependency. */
export class HeroPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private environment: THREE.WebGLRenderTarget;
  private camera = new THREE.PerspectiveCamera(32, 1, .05, 100);
  private controls: OrbitControls;
  private mixer?: THREE.AnimationMixer;
  private model?: THREE.Group;
  private clips: THREE.AnimationClip[] = [];
  private action?: THREE.AnimationAction;
  private observer: ResizeObserver;
  private raf = 0;
  private request = 0;
  private dead = false;
  private running: boolean;
  private tick = performance.now();
  private frame = 0;
  private key = new THREE.DirectionalLight(0xffe4c2, 3.5);
  private fill = new THREE.DirectionalLight(0x8cc9ff, 2.5);
  private rim = new THREE.DirectionalLight(0xb5daff, 4);
  private ambient = new THREE.HemisphereLight(0xd6e5ff, 0x222634, 1.5);
  constructor(private host: HTMLElement, private onError: (message: string) => void) {
    this.running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .65;
    room.dispose(); pmrem.dispose();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', 'F01 3Dモデル。ドラッグで回転、スクロールでズーム');
    canvas.addEventListener('webglcontextlost', this.contextLost);
    host.appendChild(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.3; this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * .52;
    this.key.position.set(-3, 5, 4); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4 });
    this.key.shadow.bias = -.0002;
    this.fill.position.set(4, 3, 2); this.rim.position.set(0, 4, -4);
    this.scene.add(this.key, this.fill, this.rim, this.ambient);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.36, .12, 96), new THREE.MeshStandardMaterial({ color: 0x26364a, metalness: .45, roughness: .4 }));
    stage.position.y = -.025; stage.receiveShadow = true; this.scene.add(stage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.28, .009, 8, 96), new THREE.MeshStandardMaterial({ color: 0xb59b65, metalness: .7, roughness: .3 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .04; this.scene.add(ring);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .25 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.09; floor.receiveShadow = true; this.scene.add(floor);
    this.setView('detail');
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.animate();
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.onError('WebGLの接続が失われました。再読込で復帰できます。'); };
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
  }
  private release(root: THREE.Object3D) {
    const textures = new Set<THREE.Texture>(); const materials = new Set<THREE.Material>();
    root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => { materials.add(m); for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v); }); if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); } });
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  }
  async load(url: string, clip = 'Idle'): Promise<HeroInspection | undefined> {
    const request = ++this.request;
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.dead || request !== this.request) { this.release(gltf.scene); return; }
    if (this.model) { this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.model); this.scene.remove(this.model); this.release(this.model); }
    this.model = gltf.scene; this.clips = gltf.animations;
    this.mixer = new THREE.AnimationMixer(this.model);
    let triangles = 0, meshes = 0, skinnedMeshes = 0;
    this.model.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; if (o instanceof THREE.SkinnedMesh) skinnedMeshes++; } });
    this.scene.add(this.model); this.play(clip);
    return { clips: this.clips.map(c => ({ name: c.name, duration: c.duration })), triangles, meshes, skinnedMeshes };
  }
  play(name: string) {
    const clip = this.clips.find(c => c.name === name);
    if (!clip || !this.mixer) return;
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(clip); this.action.reset();
    this.action.setLoop(name === 'Idle' || name === 'Walk' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    this.action.clampWhenFinished = true; this.action.play(); this.mixer.update(0);
    this.renderer.domElement.dataset.animation = name;
  }
  pause(paused: boolean) { this.running = !paused; }
  seek(fraction: number) { if (this.action && this.mixer) { this.action.paused = false; this.action.time = Math.min(.9999, fraction) * this.action.getClip().duration; this.mixer.update(0); } }
  setView(view: HeroView) {
    const views = { detail: { pos: [4.2, 2.8, 7.5], target: [0, 1.65, 0] }, portrait: { pos: [1.2, 2.95, 3.2], target: [0, 2.58, 0] }, battle: { pos: [8, 12, 10], target: [0, 1.2, 0] } };
    this.camera.position.fromArray(views[view].pos); this.controls.target.fromArray(views[view].target); this.controls.update();
  }
  rotate(angle: number) { const offset = this.camera.position.clone().sub(this.controls.target); offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle); this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); }
  zoom(factor: number) { const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor); if (offset.length() >= 1.3 && offset.length() <= 22) this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); }
  light(mode: HeroLight) {
    const values = { studio: [3.5, 2.5, 4, 1.5], daylight: [4, 1.8, 1, 2.5], rim: [1.8, .6, 6, .7] }[mode];
    [this.key.intensity, this.fill.intensity, this.rim.intensity, this.ambient.intensity] = values;
  }
  private animate = () => {
    if (this.dead) return;
    const now = performance.now(), dt = Math.min((now - this.tick) / 1000, .05); this.tick = now;
    if (this.running) this.mixer?.update(dt);
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    const canvas = this.renderer.domElement;
    canvas.dataset.frame = String(++this.frame); canvas.dataset.time = (this.action?.time ?? 0).toFixed(3);
    this.raf = requestAnimationFrame(this.animate);
  };
  dispose() {
    this.dead = true; ++this.request; cancelAnimationFrame(this.raf); this.observer.disconnect(); this.controls.dispose(); this.mixer?.stopAllAction();
    this.release(this.scene); this.environment.dispose(); this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
