import * as THREE from "three";
import type { DisplayEntity, Replay, DisplayState } from "@senkei/replay-contract";
import { buildBattlefieldBase, battlefieldStructureDamageStage } from "./battlefield-architecture";

type BaseSite = NonNullable<Replay["scene"]["baseSites"]>[number];
type BaseSiteEntry = {
  site: BaseSite;
  label: HTMLSpanElement;
  marker: THREE.Group;
  architecture?: THREE.Group;
  architectureState?: string;
};

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
  });
}

/** Known immutable base locations; architectural state appears only from authorized Replay entities. */
export class KnownBaseSites {
  private entries: BaseSiteEntry[] = [];
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
        width: "176px", boxSizing: "border-box", textAlign: "center", whiteSpace: "normal", transform: "translate(-50%, 12px)",
      });
      host.appendChild(label);
      this.entries.push({ site, label, marker });
    }
  }

  render(state: DisplayState | null, camera: THREE.Camera, width: number, height: number) {
    const centerX = (this.replay.scene.bounds.min.x + this.replay.scene.bounds.max.x) / 2;
    const centerZ = (this.replay.scene.bounds.min.y + this.replay.scene.bounds.max.y) / 2;
    for (const entry of this.entries) {
      const { site, label, marker } = entry;
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
          const facing = Math.atan2(centerX - site.position.x, centerZ - site.position.y);
          entry.architecture = buildBattlefieldBase(this.scene, base as DisplayEntity, facing);
        }
        entry.architectureState = signature;
      }

      const status = base ? base.destroyed ? "Destroyed · confirmed" : "Visible fortress" : "State unknown";
      const siteState = base ? base.destroyed ? "destroyed" : "visible" : "unknown";
      const title = (site.side === "azure" ? "AZURE FORTRESS" : "VERMILION FORTRESS") + (base ? "" : " SITE");
      if (label.dataset.siteState !== siteState) {
        label.dataset.siteState = siteState;
        label.replaceChildren(document.createTextNode(title), document.createElement("br"), document.createTextNode(status));
      }
      const point = marker.position.clone().project(camera);
      label.style.width = `${Math.min(width < 700 ? 160 : 176, width - 16)}px`;
      const halfLabel = label.getBoundingClientRect().width / 2;
      label.style.left = `${Math.min(width - halfLabel - 8, Math.max(halfLabel + 8, (point.x + 1) * width / 2))}px`;
      const bottomReserve = width < 700 ? 112 : 48;
      label.style.top = `${Math.max(4, Math.min(height - bottomReserve, (1 - point.y) * height / 2))}px`;
      label.hidden = Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1;
    }
  }

  dispose() {
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
