import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { DisplayEntity } from "@senkei/replay-contract";
import { buildBattlefieldHero, isSharedUnitMaterial, type BattlefieldUnitRig } from "./battlefield-units";

import { applyHeroPreviewMotion, type HeroPreviewPose } from "./hero-preview-motion";
export type { HeroPreviewPose } from "./hero-preview-motion";

export interface HeroModelPreviewOptions {
  catalogId: string;
  appearanceKey: string;
  name: string;
  /** Inspection-only selection. Omit to preserve the production distance-based LOD. */
  lodOverride?: HeroPreviewLod;
  onError?: (message: string) => void;
}

export type HeroPreviewLod = "full" | "medium" | "far";

export interface HeroModelPreviewController {
  dispose(): void;
  setPose(pose: HeroPreviewPose): void;
  resetView(): void;
}

const TEAM_COLOR = 0x71847b;
const GENERATOR = "senkei.battlefield-unit.v1";

function materialProfile(root: THREE.Object3D): string {
  const counts = new Map<string, number>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const surface = String(object.userData.unitSurface ?? "unlabeled");
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      const key = [
        surface,
        material.type,
        `metalness=${standard.metalness ?? "n/a"}`,
        `roughness=${standard.roughness ?? "n/a"}`,
        `vertexColors=${standard.vertexColors ?? false}`,
        `flatShading=${standard.flatShading ?? false}`,
      ].join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return JSON.stringify([...counts].sort(([left], [right]) => left.localeCompare(right)).map(([profile, slots]) => ({ profile, slots })));
}

function createCatalogEntity(options: HeroModelPreviewOptions): DisplayEntity {
  return {
    id: `hero-preview:${options.catalogId}`,
    side: "neutral",
    kind: "unit",
    archetype: "hero",
    appearanceKey: options.appearanceKey,
    catalogId: options.catalogId,
    position: { x: 0, y: 0 },
    hp: 1,
    maxHp: 1,
    destroyed: false,
  } as DisplayEntity;
}

export function disposeHeroPreviewScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) if (!isSharedUnitMaterial(material)) material.dispose();
}

/**
 * Creates one catalog-only preview using the exact Battlefield Hero builder and rig.
 * The canvas contains no Replay, Enbu state, or combat-derived values.
 */
export function createHeroModelPreview(
  host: HTMLElement,
  options: HeroModelPreviewOptions,
): HeroModelPreviewController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x253138);
  scene.fog = new THREE.Fog(0x253138, 12, 24);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", `${options.name} 3D model preview. Drag to rotate and pinch to zoom.`);
  renderer.domElement.dataset.previewMode = "catalog";
  renderer.domElement.dataset.previewReady = "false";
  renderer.domElement.dataset.catalogId = options.catalogId;
  renderer.domElement.dataset.appearanceKey = options.appearanceKey;
  renderer.domElement.dataset.silhouetteId = options.catalogId;
  renderer.domElement.dataset.name = options.name;
  renderer.domElement.dataset.generator = GENERATOR;
  renderer.domElement.dataset.pose = "idle";
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  const initialCamera = new THREE.Vector3(3.55, 2.6, 5.65);
  const initialTarget = new THREE.Vector3(0, 1.05, 0);
  camera.position.copy(initialCamera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(initialTarget);
  controls.enableDamping = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 3.6;
  controls.maxDistance = 9;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = 1.48;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.82;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xc3d7d1, 0x30363a, 1.25));
  const key = new THREE.DirectionalLight(0xffe5c4, 3.0);
  key.position.set(-3.8, 6.5, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(768, 768);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 16;
  key.shadow.camera.left = -3.4;
  key.shadow.camera.right = 3.4;
  key.shadow.camera.top = 4.1;
  key.shadow.camera.bottom = -0.2;
  key.shadow.bias = -0.00045;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ac7cc, 1.35);
  fill.position.set(4, 3, 1.2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe3ad70, 1.5);
  rim.position.set(0.3, 4.2, -4.5);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x495753, roughness: 0.94, metalness: 0.01 }),
  );
  ground.name = "catalog-preview-studio-ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.025;
  ground.receiveShadow = true;
  scene.add(ground);

  const model = new THREE.Group();
  const entity = createCatalogEntity(options);
  model.name = `catalog-preview-${options.catalogId}`;
  model.userData.previewMode = "catalog";
  scene.add(model);
  let rig: BattlefieldUnitRig;
  try {
    rig = buildBattlefieldHero(model, entity, TEAM_COLOR, options.appearanceKey);
  } catch (error) {
    controls.dispose();
    disposeHeroPreviewScene(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw error;
  }
  const heroLod = model.children.find((child): child is THREE.LOD => child instanceof THREE.LOD);
  const lodProfiles = heroLod?.levels.map(({ object }) => materialProfile(object)) ?? [];
  let motionRig = rig;
  if (options.lodOverride) {
    if (!heroLod) throw new Error("Hero preview LOD override requested, but the generated Hero has no LOD.");
    const selectedIndex = heroLod.levels.findIndex(({ object }) => object.name.endsWith(`.${options.lodOverride}`));
    if (selectedIndex < 0) throw new Error(`Hero preview does not contain the requested ${options.lodOverride} LOD.`);
    const selectedRig = rig.lodRigs?.[selectedIndex];
    if (!selectedRig) throw new Error(`Hero preview is missing the ${options.lodOverride} LOD rig.`);
    motionRig = selectedRig;
    heroLod.autoUpdate = false;
    heroLod.levels.forEach(({ object }, index) => { object.visible = index === selectedIndex; });
  }
  renderer.domElement.dataset.generator = String(model.userData.battlefieldRig?.generator ?? GENERATOR);
  renderer.domElement.dataset.silhouetteId = String(model.userData.heroSilhouette ?? options.catalogId);
  renderer.domElement.dataset.bodyProfile = String(model.userData.heroBodyProfile ?? "unknown");
  renderer.domElement.dataset.chestStyle = String(model.userData.heroChestStyle ?? "unknown");
  renderer.domElement.dataset.weapon = String(model.userData.heroWeapon ?? "unknown");
  renderer.domElement.dataset.previewReady = "true";
  renderer.domElement.setAttribute("aria-busy", "false");

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let pose: HeroPreviewPose = "idle";
  let poseStarted = performance.now();
  let disposed = false;
  let observer: ResizeObserver | undefined;

  const recordFrame = () => {
    renderer.domElement.dataset.camera = [...camera.position.toArray(), ...controls.target.toArray()].map(value => value.toFixed(4)).join(",");
    renderer.domElement.dataset.bodyPoseSample = [model.rotation.z, motionRig.joints.torso?.rotation.z ?? 0].map(value => value.toFixed(4)).join(",");
    renderer.domElement.dataset.rootY = model.position.y.toFixed(4);
    renderer.domElement.dataset.poseSample = [motionRig.joints["leg.left"], motionRig.joints["arm.right"], motionRig.weaponPivots.main]
      .map(joint => joint ? joint.rotation.toArray().slice(0, 3).map(value => Number(value).toFixed(4)).join(",") : "none").join(":");
    if (heroLod) {
      const selectedIndex = heroLod.levels.findIndex(({ object }) => object.visible);
      const selected = heroLod.levels[selectedIndex]?.object;
      renderer.domElement.dataset.lodOverride = options.lodOverride ?? "automatic";
      renderer.domElement.dataset.lodIndex = String(selectedIndex);
      renderer.domElement.dataset.lodLevel = selected?.name.split(".").at(-1) ?? "none";
      renderer.domElement.dataset.lodChild = selected?.name ?? "none";
      renderer.domElement.dataset.lodVisible = heroLod.levels.map(({ object }) => String(object.visible)).join(",");
      renderer.domElement.dataset.lodMaterialProfile = selectedIndex >= 0 ? lodProfiles[selectedIndex] ?? "[]" : "[]";
    }
  };
  const render = () => {
    if (!disposed) { renderer.render(scene, camera); recordFrame(); }
  };
  const animate = (time: number) => {
    if (disposed) return;
    applyHeroPreviewMotion(motionRig, model, pose, Math.max(0, (time - poseStarted) / 1000), false);
    controls.update();
    renderer.render(scene, camera);
    recordFrame();
  };
  const resize = () => {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width || 480));
    const height = Math.max(1, Math.floor(bounds.height || 560));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const onChange = () => render();
  const onContextLost = (event: Event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    renderer.domElement.dataset.previewReady = "false";
    renderer.domElement.setAttribute("aria-busy", "true");
    options.onError?.("The 3D preview graphics context was lost.");
  };
  const onContextRestored = () => {
    renderer.domElement.dataset.previewReady = "true";
    renderer.domElement.setAttribute("aria-busy", "false");
    if (!reducedMotion && !disposed) renderer.setAnimationLoop(animate);
    render();
  };

  controls.addEventListener("change", onChange);
  renderer.domElement.addEventListener("webglcontextlost", onContextLost, false);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored, false);
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(resize);
    observer.observe(host);
  } else window.addEventListener("resize", resize);
  resize();
  if (reducedMotion) applyHeroPreviewMotion(motionRig, model, pose, 0, true);
  else renderer.setAnimationLoop(animate);
  render();

  return {
    setPose(nextPose) {
      pose = nextPose;
      poseStarted = performance.now();
      renderer.domElement.dataset.pose = nextPose;
      applyHeroPreviewMotion(motionRig, model, pose, 0, reducedMotion);
      render();
    },
    resetView() {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      camera.position.copy(initialCamera);
      camera.up.set(0, 1, 0);
      controls.target.copy(initialTarget);
      camera.updateProjectionMatrix();
      controls.update();
      controls.enableDamping = damping;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resize);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      disposeHeroPreviewScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
