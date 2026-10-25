import type { WorldPoint } from "@senkei/replay-contract";

export function polylineLength(points: readonly WorldPoint[]): number {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
}

/** Point at an arclength fraction of a route, independent of vertex count. */
export function polylinePointAtFraction(points: readonly WorldPoint[], fraction: number): WorldPoint | undefined {
  if (!points.length) return undefined;
  if (points.length === 1) return points[0];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 1e-9) return points[0];
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length || i === lengths.length - 1) {
      const t = length <= 1e-9 ? 0 : Math.max(0, Math.min(1, remaining / length));
      return { x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * t, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * t };
    }
    remaining -= length;
  }
  return points.at(-1);
}

/** Unit tangent on the polyline segment closest to a point. */
export function polylineTangentAtClosestPoint(points: readonly WorldPoint[], target: WorldPoint): WorldPoint | undefined {
  let bestDistance = Infinity;
  let best: WorldPoint | undefined;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared));
    const distance = Math.hypot(target.x - (a.x + dx * t), target.y - (a.y + dy * t));
    if (distance < bestDistance) {
      bestDistance = distance;
      const length = Math.sqrt(lengthSquared);
      best = { x: dx / length, y: dy / length };
    }
  }
  return best;
}

export function polylineEndpointsMatch(points: readonly WorldPoint[], from: WorldPoint, to: WorldPoint): boolean {
  if (points.length < 2) return false;
  const first = points[0]!, last = points.at(-1)!;
  const near = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-5;
  return (near(first, from) && near(last, to)) || (near(first, to) && near(last, from));
}
