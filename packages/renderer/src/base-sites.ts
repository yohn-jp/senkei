import * as THREE from "three";
import type { DisplayEntity, Replay, DisplayState } from "@senkei/replay-contract";
import { buildBattlefieldBase, battlefieldStructureDamageStage } from "./battlefield-architecture";

type BaseSite = NonNullable<Replay["scene"]["baseSites"]>[number];
export type ScreenRect = { left: number; right: number; top: number; bottom: number };
type BaseSiteEntry = {
  site: BaseSite;
  label: HTMLSpanElement;
  marker: THREE.Group;
  architecture?: THREE.Group;
  architectureState?: string;
};

const SCREEN_MARGIN = 8;
const SILHOUETTE_MARGIN = 6;
const LABEL_GAP = 10;

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
  });
}

function overlaps(left: ScreenRect, right: ScreenRect, gap = 0): boolean {
  return left.left < right.right + gap && left.right + gap > right.left &&
    left.top < right.bottom + gap && left.bottom + gap > right.top;
}

/** Project an object's world-space bounds into a viewport-sized screen rectangle. */
export function projectedObjectRect(
  object: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number,
  margin = 0,
): ScreenRect | null {
  if (width <= 0 || height <= 0) return null;
  object.updateWorldMatrix(true, true);
  camera.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return null;

  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;
        const screenX = (point.x + 1) * width / 2;
        const screenY = (1 - point.y) * height / 2;
        left = Math.min(left, screenX);
        right = Math.max(right, screenX);
        top = Math.min(top, screenY);
        bottom = Math.max(bottom, screenY);
      }

  if (right < 0 || left > width || bottom < 0 || top > height) return null;
  return {
    left: Math.max(0, left - margin),
    right: Math.min(width, right + margin),
    top: Math.max(0, top - margin),
    bottom: Math.min(height, bottom + margin),
  };
}

/** Put a base-site label in nearby free space, outside every projected site silhouette. */
export function placeLabelOutsideProjectedBounds(
  bounds: ScreenRect,
  labelWidth: number,
  labelHeight: number,
  width: number,
  height: number,
  bottomReserve: number,
  obstacles: readonly ScreenRect[] = [],
): ScreenRect | null {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const candidates: ScreenRect[] = [
    { left: centerX - labelWidth / 2, right: centerX + labelWidth / 2, top: bounds.bottom + LABEL_GAP, bottom: bounds.bottom + LABEL_GAP + labelHeight },
    { left: centerX - labelWidth / 2, right: centerX + labelWidth / 2, top: bounds.top - LABEL_GAP - labelHeight, bottom: bounds.top - LABEL_GAP },
    { left: bounds.left - LABEL_GAP - labelWidth, right: bounds.left - LABEL_GAP, top: centerY - labelHeight / 2, bottom: centerY + labelHeight / 2 },
    { left: bounds.right + LABEL_GAP, right: bounds.right + LABEL_GAP + labelWidth, top: centerY - labelHeight / 2, bottom: centerY + labelHeight / 2 },
  ];
  const safeTop = 36;
  const safeBottom = height - bottomReserve;
  return candidates.find((candidate) =>
    candidate.left >= SCREEN_MARGIN && candidate.right <= width - SCREEN_MARGIN &&
    candidate.top >= safeTop && candidate.bottom <= safeBottom &&
    !obstacles.some((obstacle) => overlaps(candidate, obstacle)),
  ) ?? null;
}

/** Apply the renderer's label relocation offsets without moving text over a model. */
export function findScreenLabelPosition(
  start: ScreenRect,
  shifts: readonly (readonly [number, number])[],
  safeBounds: ScreenRect,
  protectedBounds: readonly ScreenRect[] = [],
): ScreenRect | null {
  for (const [dx, dy] of shifts) {
    const candidate = {
      left: start.left + dx,
      right: start.right + dx,
      top: start.top + dy,
      bottom: start.bottom + dy,
    };
    if (candidate.left < safeBounds.left || candidate.right > safeBounds.right ||
      candidate.top < safeBounds.top || candidate.bottom > safeBounds.bottom ||
      protectedBounds.some((bounds) => overlaps(candidate, bounds, 2))) continue;
    return candidate;
  }
  return null;
}

export function baseSiteLabelContent(site: BaseSite, base: DisplayEntity | undefined) {
  const siteState = base ? base.destroyed ? "destroyed" : "visible" : "unknown";
  const status = !base ? "State unknown" : base.destroyed ? "Destroyed · confirmed" : "Visible fortress";
  const title = (site.side === "azure" ? "AZURE FORTRESS" : "VERMILION FORTRESS") + (base ? "" : " SITE");
  return { siteState, status, title };
}

/** Known immutable base locations; architectural state appears only from authorized Replay entities. */
export class KnownBaseSites {
  private entries: BaseSiteEntry[] = [];
  private silhouettes: ScreenRect[] = [];
  constructor(private scene: THREE.Scene, host: HTMLElement, private replay: Replay) {
    for (const site of replay.scene.baseSites ?? []) {
      const color = site.side === "azure" ? 0x4d9fa4 : 0xb65e48;
      const marker = new THREE.Group();
      marker.name = `known-base-site-${site.id}`;
      marker.position.set(site.position.x, 0.14, site.position.y);
      // Cartographic corner stones identify the immutable site. They never
      // imply that a hidden base is intact, owned, occupied, or visible.
      const ink = new THREE.MeshStandardMaterial({ color, roughness: 0.93, flatShading: true });
      for (const x of [-2.35, 2.35]) for (const z of [-2.35, 2.35]) {
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.16), ink);
        horizontal.position.set(x - Math.sign(x) * 0.35, 0, z);
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.92), ink);
        vertical.position.set(x, 0, z - Math.sign(z) * 0.35);
        horizontal.castShadow = vertical.castShadow = true;
        marker.add(horizontal, vertical);
      }
      this.scene.add(marker);
      const label = document.createElement("span");
      label.className = "base-site-label";
      label.dataset.siteId = site.id;
      Object.assign(label.style, {
        position: "absolute", pointerEvents: "none", zIndex: "1", padding: "3px 6px",
        color: site.side === "azure" ? "#b0e2df" : "#f3c1aa", background: "#101d20ed",
        borderLeft: `3px solid #${color.toString(16)}`, font: "600 11px/1.35 system-ui",
        width: "176px", boxSizing: "border-box", textAlign: "center", whiteSpace: "normal", transform: "none",
        // The renderer measures this label immediately after positioning it.
        transitionProperty: "none",
      });
      host.appendChild(label);
      this.entries.push({ site, label, marker });
    }
  }

  render(state: DisplayState | null, camera: THREE.Camera, width: number, height: number) {
    const siteBounds = new Map<BaseSiteEntry, ScreenRect>();
    for (const entry of this.entries) {
      const { site, label } = entry;
      const base = Object.values(state?.entities ?? {}).find((entity) =>
        entity.kind === "base" && entity.side === site.side &&
        Math.hypot(entity.position.x - site.position.x, entity.position.y - site.position.y) < 0.01,
      );
      const signature = base ? battlefieldStructureDamageStage(base) : "unknown";
      if (signature !== entry.architectureState) {
        if (entry.architecture) {
          this.scene.remove(entry.architecture);
          disposeTree(entry.architecture);
          entry.architecture = undefined;
        }
        if (base) {
          const centerX = (this.replay.scene.bounds.min.x + this.replay.scene.bounds.max.x) / 2;
          const centerZ = (this.replay.scene.bounds.min.y + this.replay.scene.bounds.max.y) / 2;
          const facing = Math.atan2(centerX - site.position.x, centerZ - site.position.y);
          entry.architecture = buildBattlefieldBase(this.scene, base as DisplayEntity, facing);
        }
        entry.architectureState = signature;
      }

      const { siteState, status, title } = baseSiteLabelContent(site, base);
      if (label.dataset.siteState !== siteState) {
        label.dataset.siteState = siteState;
        label.replaceChildren(document.createTextNode(title), document.createElement("br"), document.createTextNode(status));
      }
      label.hidden = false;
      label.style.width = `${Math.min(width < 700 ? 160 : 176, width - 16)}px`;
      const silhouette = entry.architecture ?? entry.marker;
      const bounds = projectedObjectRect(silhouette, camera, width, height, SILHOUETTE_MARGIN);
      if (bounds) siteBounds.set(entry, bounds);
    }

    this.silhouettes = [...siteBounds.values()];
    for (const entry of this.entries) {
      const { label, marker } = entry;
      const point = marker.position.clone().project(camera);
      const visible = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z >= -1 && point.z <= 1;
      const bounds = siteBounds.get(entry);
      const size = label.getBoundingClientRect();
      const obstacles = [...siteBounds.entries()].filter(([owner]) => owner !== entry).map(([, rect]) => rect);
      const placement = bounds && visible
        ? placeLabelOutsideProjectedBounds(
          bounds,
          size.width,
          size.height,
          width,
          height,
          width < 700 ? 112 : 48,
          obstacles,
        )
        : null;
      if (!placement) {
        label.hidden = true;
        continue;
      }
      label.style.left = `${placement.left}px`;
      label.style.top = `${placement.top}px`;
      label.hidden = false;
    }
  }

  /** Screen-space bounds protected from label relocation, relative to the renderer host. */
  projectedSilhouetteRects(): readonly ScreenRect[] {
    return this.silhouettes;
  }

  dispose() {
    this.silhouettes = [];
    for (const entry of this.entries) {
      entry.label.remove();
      this.scene.remove(entry.marker);
      disposeTree(entry.marker);
      if (entry.architecture) {
        this.scene.remove(entry.architecture);
        disposeTree(entry.architecture);
      }
    }
    this.entries = [];
  }
}
