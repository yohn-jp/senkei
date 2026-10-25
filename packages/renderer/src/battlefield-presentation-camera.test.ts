import { describe, expect, it } from "vitest";
import { presentationCameraOffset, transitionCameraOffset } from "./battlefield-presentation-camera.js";

describe("presentation camera", () => {
  it("lowers the authored Cinematic viewing angle without changing azimuth", () => {
    const authored = { x: 12, y: 68, z: 48 };
    const tactical = presentationCameraOffset(authored, "tactical");
    const cinematic = presentationCameraOffset(authored, "cinematic");
    expect(cinematic.x).toBe(tactical.x);
    expect(cinematic.z).toBe(tactical.z);
    expect(cinematic.y).toBeLessThan(tactical.y);
    expect(Math.atan2(cinematic.y, Math.hypot(cinematic.x, cinematic.z)))
      .toBeLessThan(Math.atan2(tactical.y, Math.hypot(tactical.x, tactical.z)));
  });

  it("restores a user-adjusted view angle while preserving its target-plane offset", () => {
    const original = { x: 17, y: 41, z: -28 };
    const cinematic = transitionCameraOffset(original, "tactical", "cinematic");
    const restored = transitionCameraOffset(cinematic, "cinematic", "tactical");
    expect(cinematic.x).toBe(original.x);
    expect(cinematic.z).toBe(original.z);
    expect(restored.x).toBe(original.x);
    expect(restored.y).toBeCloseTo(original.y);
    expect(restored.z).toBe(original.z);
  });
});
