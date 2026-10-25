import { describe, expect, it } from "vitest";
import {
  fitBattlefieldCameraFrame,
  type BattlefieldCameraVector3,
  type BattlefieldCameraViewport,
} from "./battlefield-camera";

const viewports: readonly BattlefieldCameraViewport[] = [
  { width: 1440, height: 900, insets: { top: 50, bottom: 16 } },
  { width: 1920, height: 1080, insets: { top: 50, bottom: 16 } },
  { width: 390, height: 844, insets: { top: 58, bottom: 24 } },
  { width: 430, height: 932, insets: { top: 58, bottom: 24 } },
  { width: 320, height: 740, insets: { top: 58, bottom: 24 } },
];

const wideWorld: readonly BattlefieldCameraVector3[] = [
  { x: -74, y: 0, z: -47 },
  { x: 74, y: 0, z: -47 },
  { x: -74, y: 0, z: 47 },
  { x: 74, y: 0, z: 47 },
];

function dot(a: BattlefieldCameraVector3, b: BattlefieldCameraVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: BattlefieldCameraVector3, b: BattlefieldCameraVector3): BattlefieldCameraVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalized(vector: BattlefieldCameraVector3): BattlefieldCameraVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function projectBounds(
  point: BattlefieldCameraVector3,
  center: BattlefieldCameraVector3,
  right: BattlefieldCameraVector3,
  up: BattlefieldCameraVector3,
  viewport: BattlefieldCameraViewport,
  halfHeight: number,
): { x: number; y: number } {
  const relative = { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z };
  const scale = viewport.height / (2 * halfHeight);
  return {
    x: viewport.width / 2 + dot(relative, right) * scale,
    y: viewport.height / 2 - dot(relative, up) * scale,
  };
}

describe("fitBattlefieldCameraFrame", () => {
  it("keeps Overview terrain and building extents inside safe UI bounds at all five acceptance viewports", () => {
    const center = { x: 0, y: 0, z: 0 };
    const cameraOffset = { x: 42, y: 68, z: 42 };
    for (const viewport of viewports) {
      const frame = fitBattlefieldCameraFrame({
        center,
        points: wideWorld,
        cameraOffset,
        viewport,
        verticalExtents: [-1, 5],
        fitScale: 1.045,
        padding: 0.35,
      });
      expect(frame.fits, JSON.stringify(viewport)).toBe(true);

      const direction = normalized({ x: -cameraOffset.x, y: -cameraOffset.y, z: -cameraOffset.z });
      const right = normalized(cross(direction, { x: 0, y: 1, z: 0 }));
      const up = normalized(cross(right, direction));
      const safe = {
        left: viewport.insets?.left ?? 0,
        right: viewport.width - (viewport.insets?.right ?? 0),
        top: viewport.insets?.top ?? 0,
        bottom: viewport.height - (viewport.insets?.bottom ?? 0),
      };
      for (const point of wideWorld) {
        for (const y of [-1, 5]) {
          const projected = projectBounds({ ...point, y }, frame.center, right, up, viewport, frame.halfHeight);
          expect(projected.x).toBeGreaterThanOrEqual(safe.left - 0.5);
          expect(projected.x).toBeLessThanOrEqual(safe.right + 0.5);
          expect(projected.y).toBeGreaterThanOrEqual(safe.top - 0.5);
          expect(projected.y).toBeLessThanOrEqual(safe.bottom + 0.5);
        }
      }
    }
  });

  it("reports when an optional close-follow zoom cap cannot contain the authorized group", () => {
    const viewport = { width: 390, height: 844, insets: { top: 58, bottom: 24 } };
    const points = [
      { x: -8, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
    ];
    const frame = fitBattlefieldCameraFrame({
      center: { x: 0, y: 0, z: 0 },
      points,
      cameraOffset: { x: 22, y: 28, z: 0 },
      viewport,
      fitScale: 1,
      verticalExtents: [-0.2, 2.2],
      minimumHalfHeight: 4,
      maximumHalfHeight: 5,
    });
    expect(frame.requiredHalfHeight).toBeGreaterThan(frame.halfHeight);
    expect(frame.fits).toBe(false);
  });

  it("centers the map in asymmetric left and right overlays at wide aspect ratios", () => {
    const viewport = {
      width: 1280,
      height: 800,
      insets: { top: 20, right: 24, bottom: 20, left: 240 },
    };
    const center = { x: 0, y: 0, z: 0 };
    const cameraOffset = { x: 42, y: 68, z: 42 };
    const frame = fitBattlefieldCameraFrame({
      center,
      points: wideWorld,
      cameraOffset,
      viewport,
      verticalExtents: [-1, 5],
      fitScale: 1.02,
      padding: 0.35,
    });
    const direction = normalized({ x: -cameraOffset.x, y: -cameraOffset.y, z: -cameraOffset.z });
    const right = normalized(cross(direction, { x: 0, y: 1, z: 0 }));
    const up = normalized(cross(right, direction));
    for (const point of wideWorld) {
      for (const y of [-1, 5]) {
        const projected = projectBounds({ ...point, y }, frame.center, right, up, viewport, frame.halfHeight);
        expect(projected.x).toBeGreaterThanOrEqual(239.5);
        expect(projected.x).toBeLessThanOrEqual(1256.5);
        expect(projected.y).toBeGreaterThanOrEqual(19.5);
        expect(projected.y).toBeLessThanOrEqual(780.5);
      }
    }
  });

  it("uses the center point as a stable frame for empty visible samples", () => {
    const frame = fitBattlefieldCameraFrame({
      center: { x: 12, y: 0, z: -6 },
      points: [],
      cameraOffset: { x: 0, y: 55, z: 32 },
      viewport: { width: 1440, height: 900 },
      minimumHalfHeight: 10.5,
    });
    expect(frame.halfHeight).toBe(10.5);
    expect(frame.center.x).toBeCloseTo(12);
    expect(frame.center.z).toBeCloseTo(-6);
    expect(frame.fits).toBe(true);
  });
});
