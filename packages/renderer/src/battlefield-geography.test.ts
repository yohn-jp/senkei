import { describe, expect, it } from "vitest";
import type { Replay } from "@senkei/replay-contract";
import { scenicRiverCourse } from "./battlefield-geography";

describe("battlefield presentation geography", () => {
  it("preserves the authored river anchor order when extending its ends", () => {
    const anchors = [
      { x: 12, y: 8 },
      { x: 4, y: 5 },
      { x: 8, y: 16 },
    ] as const;
    const replay = {
      scene: {
        bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } },
        river: anchors,
      },
    } as unknown as Replay;

    const course = scenicRiverCourse(replay);

    expect(course.slice(1, -1)).toEqual(anchors);
    expect(course).toHaveLength(anchors.length + 2);
    expect(course[0]!.x).toBeGreaterThan(anchors[0]!.x);
    expect(course.at(-1)!.y).toBeGreaterThan(anchors.at(-1)!.y);
  });

  it("returns no course for an absent or incomplete river", () => {
    const scene = { bounds: { min: { x: 0, y: 0 }, max: { x: 20, y: 20 } } };
    expect(scenicRiverCourse({ scene } as unknown as Replay)).toEqual([]);
    expect(scenicRiverCourse({ scene: { ...scene, river: [{ x: 0, y: 0 }] } } as unknown as Replay)).toEqual([]);
  });
});
