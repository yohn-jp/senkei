import { describe, expect, it } from "vitest";
import { polylineEndpointsMatch, polylineLength, polylinePointAtFraction, polylineTangentAtClosestPoint } from "./battlefield-polyline.js";

describe("battlefield polyline geometry", () => {
  const bent = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];

  it("measures path length and samples its arclength midpoint", () => {
    expect(polylineLength(bent)).toBe(7);
    expect(polylinePointAtFraction(bent, 0.5)).toEqual({ x: 3, y: 0.5 });
  });

  it("finds the closest segment tangent and matches outer endpoints", () => {
    expect(polylineTangentAtClosestPoint(bent, { x: 2, y: 0.1 })).toEqual({ x: 1, y: 0 });
    expect(polylineTangentAtClosestPoint(bent, { x: 3.1, y: 3 })).toEqual({ x: 0, y: 1 });
    expect(polylineEndpointsMatch(bent, { x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(polylineEndpointsMatch(bent, { x: 3, y: 4 }, { x: 0, y: 0 })).toBe(true);
    expect(polylineEndpointsMatch(bent, { x: 3, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("handles degenerate paths without dividing by zero", () => {
    expect(polylinePointAtFraction([], 0.5)).toBeUndefined();
    expect(polylinePointAtFraction([{ x: 2, y: 1 }], 0.5)).toEqual({ x: 2, y: 1 });
    expect(polylinePointAtFraction([{ x: 2, y: 1 }, { x: 2, y: 1 }], 0.5)).toEqual({ x: 2, y: 1 });
    expect(polylineTangentAtClosestPoint([{ x: 0, y: 0 }, { x: 0, y: 0 }], { x: 1, y: 1 })).toBeUndefined();
  });
});
