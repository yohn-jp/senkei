import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { overlapsProtectedSilhouette, screenRectsOverlap, setVisibleLabelBounds } from "./battlefield-label-collision.js";

describe("battlefield screen label collision", () => {
  it("rejects labels over projected silhouettes and accepts clear space", () => {
    const hero = { left: 100, right: 140, top: 100, bottom: 170 };
    expect(overlapsProtectedSilhouette({ left: 108, right: 132, top: 130, bottom: 150 }, [hero])).toBe(true);
    expect(overlapsProtectedSilhouette({ left: 108, right: 132, top: 70, bottom: 92 }, [hero])).toBe(false);
  });

  it("uses a stable gap at contact edges", () => {
    const left = { left: 0, right: 20, top: 0, bottom: 12 };
    expect(screenRectsOverlap(left, { left: 24, right: 40, top: 0, bottom: 12 })).toBe(false);
    expect(screenRectsOverlap(left, { left: 23, right: 40, top: 0, bottom: 12 })).toBe(true);
  });

  it("ignores earlier poses of invisible LODs when protecting the displayed silhouette", () => {
    const root = new THREE.Group();
    const lod = new THREE.LOD();
    const near = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
    const far = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 3));
    lod.addLevel(near, 0);
    lod.addLevel(far, 10);
    root.add(lod);
    root.position.set(4, 0, 5);
    near.visible = true;
    far.visible = false;
    const bounds = new THREE.Box3();
    const current = setVisibleLabelBounds(bounds, root).clone();
    far.position.set(100, 100, 100);
    expect(setVisibleLabelBounds(bounds, root)).toEqual(current);
    near.visible = false;
    far.visible = true;
    expect(setVisibleLabelBounds(bounds, root)).not.toEqual(current);
  });
});
