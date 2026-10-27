import * as THREE from "three";

export type ScreenRect = { left: number; right: number; top: number; bottom: number };

/** Measure the displayed unit LOD, not hidden LODs carrying earlier poses. */
export function setVisibleLabelBounds(target: THREE.Box3, object: THREE.Object3D): THREE.Box3 {
  const lod = object instanceof THREE.LOD ? object : object.children.find(child => child instanceof THREE.LOD);
  const visible = lod?.levels.find(level => level.object.visible)?.object;
  const subject = visible ?? object;
  subject.updateWorldMatrix(true, true);
  return target.setFromObject(subject);
}

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 4): boolean {
  return a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;
}

/** Protected projected model footprints keep labels out of unit/facility silhouettes. */
export function overlapsProtectedSilhouette(rect: ScreenRect, silhouettes: readonly ScreenRect[]): boolean {
  return silhouettes.some(silhouette => screenRectsOverlap(rect, silhouette, 2));
}
