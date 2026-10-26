import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { profileGeometry, setVertexColor } from "./battlefield-unit-geometry";

describe("closed faceted unit profiles", () => {
  const rings = [
    { y: -1, x: -0.1, radiusX: 0.7, radiusZ: 0.5 },
    { y: 0, x: 0.1, radiusX: 1, radiusZ: 0.8 },
    { y: 1, x: 0.2, radiusX: 0.6, radiusZ: 0.4 },
  ];

  for (const sides of [5, 7, 9]) {
    for (const descending of [false, true]) {
      it(`closes every edge with opposite winding (${sides} sides, descending=${descending})`, () => {
        const geometry = profileGeometry(descending ? [...rings].reverse() : rings, sides);
        const indices = geometry.index!;
        const edges = new Map<string, number[]>();
        const positions = geometry.getAttribute("position");
        let signedVolume = 0;
        for (let index = 0; index < indices.count; index += 3) {
          const triangle = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
          const [a, b, c] = triangle.map(vertex => new THREE.Vector3().fromBufferAttribute(positions, vertex));
          expect(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq()).toBeGreaterThan(1e-8);
          signedVolume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
          for (let side = 0; side < 3; side++) {
            const from = triangle[side];
            const to = triangle[(side + 1) % 3];
            const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
            edges.set(key, [...(edges.get(key) ?? []), from < to ? 1 : -1]);
          }
        }
        for (const directions of edges.values()) {
          expect(directions).toHaveLength(2);
          expect(directions[0] + directions[1]).toBe(0);
        }
        expect(signedVolume).toBeGreaterThan(0);
        geometry.dispose();
      });

      it(`exposes its exterior to single-sided rays (${sides} sides, descending=${descending})`, () => {
        const cylinder = [{ y: -1, radiusX: 1, radiusZ: 1 }, { y: 1, radiusX: 1, radiusZ: 1 }];
        const geometry = profileGeometry(descending ? [...cylinder].reverse() : cylinder, sides);
        const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geometry, material);
        for (const origin of [[0, 3, 0], [0, -3, 0], [3, 0, 0], [3 * Math.cos(2 * Math.PI / sides), 0, 3 * Math.sin(2 * Math.PI / sides)]] as const) {
          const start = new THREE.Vector3(...origin);
          const hits = new THREE.Raycaster(start, start.clone().normalize().negate()).intersectObject(mesh);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0].distance).toBeCloseTo(origin[1] ? 2 : 3 - Math.cos(Math.PI / sides), 5);
        }
        geometry.dispose();
        material.dispose();
      });
    }
  }

  it("generates identical buffers from either authored ring direction", () => {
    const ascending = profileGeometry(rings);
    const descending = profileGeometry([...rings].reverse());
    expect(descending.index!.array).toEqual(ascending.index!.array);
    expect(descending.getAttribute("position").array).toEqual(ascending.getAttribute("position").array);
    ascending.dispose();
    descending.dispose();
  });

  it("bakes independent planar normals into each palette-colored facet", () => {
    const geometry = setVertexColor(profileGeometry(rings), 0x71858c);
    expect(geometry.index).toBeNull();
    const normals = geometry.getAttribute("normal");
    for (let vertex = 0; vertex < normals.count; vertex += 3) {
      const normal = new THREE.Vector3().fromBufferAttribute(normals, vertex);
      expect(normal.length()).toBeCloseTo(1);
      expect(new THREE.Vector3().fromBufferAttribute(normals, vertex + 1).distanceTo(normal)).toBeLessThan(1e-6);
      expect(new THREE.Vector3().fromBufferAttribute(normals, vertex + 2).distanceTo(normal)).toBeLessThan(1e-6);
    }
    geometry.dispose();
  });
});
