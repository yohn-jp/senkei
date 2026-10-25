import * as THREE from "three";
import type { DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";

/** Graph visibility only. Off-graph terrain never gains invented sight rules. */
export class BattlefieldFog {
  readonly group = new THREE.Group();
  private masks: { matrix: THREE.Matrix4; node?: string; edge?: string; sample?: number }[] = [];
  private batches: { nodes: THREE.InstancedMesh; edges: THREE.InstancedMesh; state: "unexplored" | "explored" }[] = [];
  private contacts = new THREE.Group();
  private materials = {
    unexplored: new THREE.MeshBasicMaterial({ color: 0x14232d, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide }),
    explored: new THREE.MeshBasicMaterial({ color: 0x354653, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide }),
    visible: new THREE.MeshBasicMaterial({ visible: false }),
  };
  private contactMaterial = new THREE.LineDashedMaterial({ color: 0xd5bc88, dashSize: 0.22, gapSize: 0.15, transparent: true, opacity: 0.7, depthWrite: false });

  constructor(scene: THREE.Scene, private replay: Replay) {
    this.group.name = "authorized-graph-fog";
    this.group.visible = false;
    for (const node of replay.scene.nodes ?? []) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1.3, 8), this.materials.unexplored);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(node.position.x, 0.19, node.position.y);
      mesh.renderOrder = 3;
      mesh.updateMatrix();
      this.masks.push({ matrix: mesh.matrix.clone(), node: node.id });
      mesh.geometry.dispose();
    }
    for (const edge of replay.scene.routes ?? []) {
      const from = edge.points[0], to = edge.points[edge.points.length - 1];
      const dx = to.x - from.x, dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      for (let sample = 0; sample < 9; sample++) {
        const start = Math.max(0, (sample - 0.5) / 8), end = Math.min(1, (sample + 0.5) / 8);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.materials.unexplored);
        mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dx, dy));
        mesh.position.set(from.x + dx * (start + end) / 2, 0.18, from.y + dy * (start + end) / 2);
        mesh.scale.set(edge.region === "lane" ? 2.5 : 1.6, length * (end - start), 1);
        mesh.updateMatrix();
        this.masks.push({ matrix: mesh.matrix.clone(), edge: edge.id, sample });
        mesh.geometry.dispose();
      }
    }
    for (const state of ["unexplored", "explored"] as const) {
      const nodes = new THREE.InstancedMesh(new THREE.CircleGeometry(1.3, 8), this.materials[state], this.masks.length);
      const edges = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.materials[state], this.masks.length);
      nodes.count = edges.count = 0;
      nodes.frustumCulled = edges.frustumCulled = false;
      nodes.renderOrder = 3;
      edges.renderOrder = 2;
      this.batches.push({ nodes, edges, state });
      this.group.add(nodes, edges);
    }
    this.contacts.name = "historical-facility-observations";
    this.group.add(this.contacts);
    scene.add(this.group);
  }

  update(state: DisplayState): void {
    this.group.visible = Boolean(state.fog);
    if (!state.fog) return;
    const fog = state.fog.state;
    for (const batch of this.batches) {
      batch.nodes.count = batch.edges.count = 0;
      for (const mask of this.masks) {
        const status = mask.node ? fog.nodes[mask.node] : fog.edges[mask.edge!]?.[mask.sample!];
        if ((status ?? "unexplored") !== batch.state) continue;
        const mesh = mask.node ? batch.nodes : batch.edges;
        mesh.setMatrixAt(mesh.count++, mask.matrix);
      }
      batch.nodes.instanceMatrix.needsUpdate = batch.edges.instanceMatrix.needsUpdate = true;
    }
    for (const child of this.contacts.children) (child as THREE.Line).geometry.dispose();
    this.contacts.clear();
    for (const contact of fog.facilities) {
      const route = this.replay.scene.routes?.find(route => route.bridgeSite === contact.site);
      const point: WorldPoint | undefined = contact.kind === "bridge"
        ? contact.site === "MID" ? this.replay.scene.nodes?.find(node => node.id === "N.MID.OBS")?.position
          : route ? { x: (route.points[0].x + route.points[1].x) / 2, y: (route.points[0].y + route.points[1].y) / 2 } : undefined
        : this.replay.scene.nodes?.find(node => node.id === contact.site)?.position;
      if (!point) continue;
      const vertices = Array.from({ length: 33 }, (_, i) => {
        const a = i / 32 * Math.PI * 2;
        return new THREE.Vector3(point.x + Math.cos(a) * 0.65, 0.25, point.y + Math.sin(a) * 0.65);
      });
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), this.contactMaterial);
      ring.computeLineDistances();
      ring.name = `last-known-${contact.id}-tick-${contact.last_seen_tick}`;
      ring.userData.lastSeenTick = contact.last_seen_tick;
      this.contacts.add(ring);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse(node => { if (node instanceof THREE.Mesh || node instanceof THREE.Line) node.geometry.dispose(); });
    Object.values(this.materials).forEach(material => material.dispose());
    this.contactMaterial.dispose();
  }
}
