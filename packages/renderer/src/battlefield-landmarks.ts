import * as THREE from "three";
import type { DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";

function ribbon(points: readonly WorldPoint[], width: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], here = points[i], after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, size = Math.hypot(dx, dy) || 1;
    const nx = -dy / size, ny = dx / size;
    positions.push(here.x + nx * half, y, here.y + ny * half, here.x - nx * half, y, here.y - ny * half);
    if (i < points.length - 1) {
      const at = i * 2;
      indices.push(at, at + 2, at + 3, at, at + 3, at + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetPath(points: readonly WorldPoint[], offset: number): WorldPoint[] {
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, size = Math.hypot(dx, dy) || 1;
    return { x: point.x - dy / size * offset, y: point.y + dx / size * offset };
  });
}

/** Static geography comes from the versioned map graph; facility state comes only from Replay. */
export class BattlefieldLandmarks {
  private bridges = new Map<string, { group: THREE.Group; boards: { mesh: THREE.Mesh; lane: string }[]; site: string }>();
  private observation?: { group: THREE.Group; disc: THREE.Mesh; ring: THREE.Mesh };
  constructor(private scene: THREE.Scene, replay: Replay) {
    const river = replay.scene.river;
    if (river && river.length >= 2) {
      const water = new THREE.Mesh(ribbon(river, 4.05, 0.072), new THREE.MeshStandardMaterial({ color: 0x306b78, roughness: 0.35, metalness: 0.08, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.87, depthWrite: false }));
      water.name = "canonical-river-from-fixed-crossings";
      water.receiveShadow = true;
      scene.add(water);
      const bank = new THREE.Mesh(ribbon(river, 5.0, 0.058), new THREE.MeshStandardMaterial({ color: 0x788266, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
      bank.name = "canonical-river-banks";
      scene.add(bank);
    }
    for (const route of replay.scene.routes ?? []) {
      if (!route.bridgeSite) continue;
      const mid = { x: (route.points[0].x + route.points[1].x) / 2, y: (route.points[0].y + route.points[1].y) / 2 };
      const dx = route.points[1].x - route.points[0].x, dz = route.points[1].y - route.points[0].y;
      const angle = Math.atan2(dz, dx);
      const group = new THREE.Group();
      group.name = `fixed-bridge-${route.bridgeSite}-${route.id}`;
      group.position.set(mid.x, -0.005, mid.y);
      group.rotation.y = -angle;
      const boards: { mesh: THREE.Mesh; lane: string }[] = [];
      for (const [lane, lateral] of [["LEFT", -0.88], ["CENTER", 0], ["RIGHT", 0.88]] as const) {
        for (let i = -2; i <= 2; i++) {
          const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x8e7954, roughness: 0.95, flatShading: true }));
          board.position.set(i * 0.77, 0.045, lateral);
          board.castShadow = true;
          board.receiveShadow = true;
          group.add(board);
          boards.push({ mesh: board, lane });
        }
      }
      for (const z of [-1.36, 1.36]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.32, 0.11), new THREE.MeshStandardMaterial({ color: 0x786849, roughness: 0.9, flatShading: true }));
        rail.position.set(0, 0.18, z);
        group.add(rail);
      }
      scene.add(group);
      this.bridges.set(route.id, { group, boards, site: route.bridgeSite });
    }
    for (const node of replay.scene.nodes ?? []) {
      const color = node.allegiance === "A" ? 0x48c8d7 : node.allegiance === "B" ? 0xe9845b : 0xb4c0a4;
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(node.id === "N.MID.OBS" ? 2.7 : 1.22, 12), new THREE.MeshStandardMaterial({ color: node.id === "N.MID.OBS" ? 0x686c5b : 0x666b58, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
      plaza.name = `combat-domain-${node.id}`;
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(node.position.x, -0.027, node.position.y);
      scene.add(plaza);
      const center = new THREE.Mesh(new THREE.CircleGeometry(node.id === "N.MID.OBS" ? 0.42 : 0.22, 8), new THREE.MeshBasicMaterial({ color, depthWrite: false }));
      center.name = `map-node-${node.id}-${node.allegiance}`;
      center.rotation.x = -Math.PI / 2;
      center.position.set(node.position.x, 0.012, node.position.y);
      scene.add(center);
      if (node.id === "N.MID.OBS") {
        const group = new THREE.Group();
        group.name = "mid-observation-objective";
        group.position.set(node.position.x, 0.02, node.position.y);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0x757563, roughness: 0.9, flatShading: true }));
        disc.position.y = 0.1;
        group.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.12, 5, 12), new THREE.MeshStandardMaterial({ color: 0x9aa88d, emissive: 0x101810, roughness: 0.8, flatShading: true }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.12;
        group.add(ring);
        scene.add(group);
        this.observation = { group, disc, ring };
      }
    }
    for (const lane of replay.scene.lanes) {
      const color = new THREE.MeshBasicMaterial({ color: 0x4c493d, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide });
      for (const [name, offset, width] of [["LEFT", -0.8, 0.12], ["CENTER", 0, 0.08], ["RIGHT", 0.8, 0.12]] as const) {
        const line = new THREE.Mesh(ribbon(offsetPath(lane.points, offset), width, 0.075), color.clone());
        line.name = `lane-${lane.id}-track-${name.toLowerCase()}`;
        scene.add(line);
      }
      color.dispose();
    }
    this.update(null);
  }
  update(state: DisplayState | null) {
    const facilities = Object.values(state?.entities ?? {}).filter(entity => entity.battlefield?.bridgeSite);
    for (const bridge of this.bridges.values()) {
      const facility = facilities.find(entity => entity.battlefield?.bridgeSite === bridge.site);
      const status = facility?.battlefield?.bridgeState ?? "unknown";
      const expanded = status === "expanded";
      bridge.boards.forEach(({ mesh, lane }, index) => {
        const enabled = status !== "destroyed" && (lane === "CENTER" || expanded);
        mesh.visible = (status !== "unknown" && enabled) || (status === "destroyed" && lane === "CENTER" && index % 2 === 1);
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.color.set(status === "destroyed" ? 0x554d3d : expanded ? 0xa49264 : 0x8e7954);
      });
      bridge.group.userData.state = status;
    }
    const objective = Object.values(state?.entities ?? {}).find(entity => entity.kind === "observation");
    if (this.observation) {
      const visible = Boolean(objective);
      const owner = objective?.battlefield?.captureSide ?? objective?.battlefield?.facilityOwner;
      const color = !visible ? 0x59645d : owner === "azure" ? 0x48c8d7 : owner === "vermilion" ? 0xe9845b : 0x9aa88d;
      const ringMaterial = this.observation.ring.material as THREE.MeshStandardMaterial;
      ringMaterial.color.set(color);
      ringMaterial.transparent = !visible;
      ringMaterial.opacity = visible ? 1 : 0.32;
      (this.observation.disc.material as THREE.MeshStandardMaterial).color.set(visible ? 0x757563 : 0x535b51);
      this.observation.group.userData.state = visible ? "visible" : "unknown";
      if (visible) {
        this.observation.group.userData.captureProgress = objective?.battlefield?.captureProgress;
        this.observation.group.userData.owner = owner;
      } else {
        delete this.observation.group.userData.captureProgress;
        delete this.observation.group.userData.owner;
      }
    }
  }
  dispose() {
    for (const { group } of this.bridges.values()) {
      this.scene.remove(group);
      group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
        }
      });
    }
    this.bridges.clear();
    if (this.observation) this.scene.remove(this.observation.group);
  }
}
