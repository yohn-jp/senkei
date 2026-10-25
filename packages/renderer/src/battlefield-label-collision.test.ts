import { describe, expect, it } from "vitest";
import { overlapsProtectedSilhouette, screenRectsOverlap } from "./battlefield-label-collision.js";

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
});
