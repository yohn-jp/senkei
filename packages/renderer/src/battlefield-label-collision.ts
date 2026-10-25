export type ScreenRect = { left: number; right: number; top: number; bottom: number };

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 4): boolean {
  return a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;
}

/** Protected projected model footprints keep labels out of unit/facility silhouettes. */
export function overlapsProtectedSilhouette(rect: ScreenRect, silhouettes: readonly ScreenRect[]): boolean {
  return silhouettes.some(silhouette => screenRectsOverlap(rect, silhouette, 2));
}
