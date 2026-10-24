import * as THREE from "three";
import type { Replay, WorldPoint } from "@senkei/replay-contract";

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

/** Real-match world presentation. Gameplay topology comes only from Replay. */
export function buildWorldPresentation(scene: THREE.Scene, replay: Replay): void {

    const { min, max } = replay.scene.bounds;
    const w = max.x - min.x + 2,
      d = max.y - min.y + 2,
      cx = (max.x + min.x) / 2,
      cz = (max.y + min.y) / 2;
    box(scene, [200, 0.1, 200], [0, -2, 0], 0x263f4e);
    // Keep a restrained ground edge for depth, while letting the map read as
    // open terrain instead of a tall display plinth.
    box(scene, [w + 1.4, 0.5, d + 1.4], [cx, -0.35, cz], 0x4d604f);
    box(scene, [w, 0.14, d], [cx, -0.09, cz], 0x77846c);

    // Lane ribbons follow the exact points carried by the Replay. Their labels
    // and their separate, wider shoulders keep the three combat corridors
    // readable at overview scale.
    for (const lane of replay.scene.lanes) {
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
      scene.add(shoulderMesh);
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
      scene.add(roadMesh);
      const center = ribbon(lane.points, 0.16, lane.elevation + 0.045);
      const centerMesh = new THREE.Mesh(
        center.geometry,
        new THREE.MeshStandardMaterial({
          color: 0xd7cda9,
          roughness: 1,
          flatShading: true,
        }),
      );
      scene.add(centerMesh);
    }

    // Jungle movement corridors come from the versioned logical map through
    // PresentationReplay. Drawing those explicit edges preserves the actual
    // connections between lanes and camps without adding visual-only routes.
    const jungleRoutes = (replay.scene.routes ?? []).filter(
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
      scene.add(shoulderMesh);
      const path = ribbon(route.points, 1.35, 0.075);
      const pathMesh = new THREE.Mesh(
        path.geometry,
        new THREE.MeshStandardMaterial({ color: 0x99866a, roughness: 1, flatShading: true }),
      );
      pathMesh.receiveShadow = true;
      pathMesh.name = `jungle-route-${route.id}`;
      scene.add(pathMesh);
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
      const nearLane = replay.scene.lanes.some((l) =>
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
      const nearCamp = (replay.scene.camps ?? []).some(
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
      scene,
      "jungle-tree-trunks",
      new THREE.BoxGeometry(0.2, 1.15, 0.2),
      trunks,
    );
    addSceneryInstances(
      scene,
      "jungle-low-foliage",
      new THREE.ConeGeometry(0.76, 1.6, 4),
      lowCanopies,
    );
    addSceneryInstances(
      scene,
      "jungle-high-foliage",
      new THREE.ConeGeometry(0.58, 1.36, 4),
      highCanopies,
    );
    addSceneryInstances(
      scene,
      "jungle-rocks",
      new THREE.BoxGeometry(1, 1, 1),
      rocks,
    );
    if (!jungleRoutes.length)
      for (const z of [min.y - 0.3, max.y + 0.3])
        for (let j = 0; j < 12; j++)
          box(
            scene,
            [1.2, 0.55, 0.8],
            [min.x + j * (w / 11), -0.03, z],
            0x7a8377,
            j * 0.3,
          );
  
}

export function buildWorldCamp(parent: THREE.Group, position: WorldPoint, campId: string, replay: Replay): void {

    const scale = replay.scene.routes?.length ? 1.22 : 1;
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
    parent.add(camp);
  
}
