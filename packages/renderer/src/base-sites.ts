import * as THREE from "three";
import type { Replay, DisplayState } from "@senkei/replay-contract";

/** Cartographic annotations for immutable public World locations. Never a base entity. */
export class KnownBaseSites {
  private entries: { site: NonNullable<Replay["scene"]["baseSites"]>[number]; label: HTMLSpanElement; marker: THREE.Group }[] = [];
  constructor(scene: THREE.Scene, host: HTMLElement, replay: Replay) {
    for (const site of replay.scene.baseSites ?? []) {
      const color = site.side === "azure" ? 0x48c8d7 : 0xe9845b;
      const marker = new THREE.Group();
      marker.name = `known-base-site-${site.id}`;
      marker.position.set(site.position.x, 0.14, site.position.y);
      // Dashed, flat corner marks are map notation. They deliberately do not
      // draw an intact building, HP bar, garrison, occupancy, or vision state.
      const ink = new THREE.MeshBasicMaterial({ color, depthWrite: false });
      for (const x of [-2.05, 2.05]) for (const z of [-2.05, 2.05]) {
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.025, 0.12), ink);
        horizontal.position.set(x - Math.sign(x) * 0.35, 0, z);
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.85), ink);
        vertical.position.set(x, 0, z - Math.sign(z) * 0.35);
        marker.add(horizontal, vertical);
      }
      scene.add(marker);
      const label = document.createElement("span");
      label.className = "base-site-label";
      label.dataset.siteId = site.id;
      Object.assign(label.style, {
        position: "absolute", pointerEvents: "none", zIndex: "1", padding: "3px 6px",
        color: site.side === "azure" ? "#b0f2f7" : "#ffd1b5", background: "#101d20ed",
        borderLeft: `3px solid #${color.toString(16)}`, font: "600 11px/1.35 system-ui",
        textAlign: "center", whiteSpace: "nowrap", transform: "translate(-50%, 12px)",
      });
      host.appendChild(label);
      this.entries.push({ site, label, marker });
    }
  }
  render(state: DisplayState | null, camera: THREE.Camera, width: number, height: number) {
    for (const { site, label, marker } of this.entries) {
      const base = Object.values(state?.entities ?? {}).find((entity) =>
        entity.kind === "base" && entity.side === site.side &&
        Math.hypot(entity.position.x - site.position.x, entity.position.y - site.position.y) < 0.01,
      );
      const status = base ? base.destroyed ? "Destroyed · confirmed" : "Visible base" : "State unknown";
      const siteState = base ? base.destroyed ? "destroyed" : "visible" : "unknown";
      const title = site.side === "azure" ? "AZURE BASE" : "VERMILION BASE";
      if (label.dataset.siteState !== siteState) {
        label.dataset.siteState = siteState;
        label.replaceChildren(document.createTextNode(title), document.createElement("br"), document.createTextNode(status));
      }
      const point = marker.position.clone().project(camera);
      label.style.left = `${(point.x + 1) * width / 2}px`;
      label.style.top = `${(1 - point.y) * height / 2}px`;
      label.hidden = Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1;
    }
  }
  dispose() { for (const entry of this.entries) entry.label.remove(); }
}
