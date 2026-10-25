import type { Replay, WorldPoint } from "@senkei/replay-contract";

/**
 * Continue the explicit Presentation World river beyond the scenic ground.
 * Replay order is preserved exactly: crossings are never re-sorted from their
 * coordinates. These tails contain no traversable edges. Terrain and water
 * share this course so neither stops as a band on dry land.
 */
export function scenicRiverCourse(replay: Replay): readonly WorldPoint[] {
  const river = replay.scene.river;
  if (!river || river.length < 2) return [];
  const { min, max } = replay.scene.bounds;
  const extension = Math.hypot(max.x - min.x, max.y - min.y) + 80;
  const extend = (from: WorldPoint, toward: WorldPoint): WorldPoint => {
    const dx = from.x - toward.x, dy = from.y - toward.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + dx / length * extension, y: from.y + dy / length * extension };
  };
  return [extend(river[0], river[1]), ...river, extend(river[river.length - 1], river[river.length - 2])];
}
