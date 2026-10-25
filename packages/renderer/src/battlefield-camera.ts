/**
 * Camera framing for the orthographic Battlefield view. Inputs are authored
 * world points and entities already authorized for the current Replay tick.
 * This helper only fits those points inside a screen-safe rectangle; it does
 * not discover entities, change their positions, or affect simulation logic.
 */

export interface BattlefieldCameraVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BattlefieldCameraViewport {
  readonly width: number;
  readonly height: number;
  readonly insets?: Partial<{
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  }>;
}

export interface BattlefieldCameraFrameRequest {
  /** World-space point the camera would aim at without screen insets. */
  readonly center: BattlefieldCameraVector3;
  /** Authored or Replay-visible sample points that must remain in frame. */
  readonly points: readonly BattlefieldCameraVector3[];
  /** Camera position relative to center. */
  readonly cameraOffset: BattlefieldCameraVector3;
  readonly viewport: BattlefieldCameraViewport;
  /** Include vertical volume around each sample, for terrain and buildings. */
  readonly verticalExtents?: readonly [minimum: number, maximum: number];
  readonly fitScale?: number;
  readonly padding?: number;
  readonly minimumHalfHeight?: number;
  /**
   * An optional artistic zoom cap. If it prevents a complete fit, `fits` is
   * false so callers can choose a wider frame instead of assuming success.
   */
  readonly maximumHalfHeight?: number;
}

export interface BattlefieldCameraFrame {
  readonly center: BattlefieldCameraVector3;
  readonly halfHeight: number;
  readonly requiredHalfHeight: number;
  readonly fits: boolean;
}

const EPSILON = 1e-9;

function dot(left: BattlefieldCameraVector3, right: BattlefieldCameraVector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: BattlefieldCameraVector3, right: BattlefieldCameraVector3): BattlefieldCameraVector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(vector: BattlefieldCameraVector3): BattlefieldCameraVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function addScaled(
  point: BattlefieldCameraVector3,
  direction: BattlefieldCameraVector3,
  scale: number,
): BattlefieldCameraVector3 {
  return {
    x: point.x + direction.x * scale,
    y: point.y + direction.y * scale,
    z: point.z + direction.z * scale,
  };
}

/**
 * Fits the projected bounds into the usable screen area for common wide and
 * portrait viewports. Insets are measured in CSS pixels and represent UI that
 * must remain clear of the battlefield. `fits` is false only when an optional
 * maximum zoom-in cap conflicts with the required bounds.
 */
export function fitBattlefieldCameraFrame(
  request: BattlefieldCameraFrameRequest,
): BattlefieldCameraFrame {
  const width = Math.max(1, request.viewport.width);
  const height = Math.max(1, request.viewport.height);
  const aspect = width / height;
  const rawInsets = request.viewport.insets;
  const top = Math.max(0, rawInsets?.top ?? 0);
  const rightInset = Math.max(0, rawInsets?.right ?? 0);
  const bottom = Math.max(0, rawInsets?.bottom ?? 0);
  const leftInset = Math.max(0, rawInsets?.left ?? 0);
  const safeWidthRatio = Math.max(EPSILON, (width - leftInset - rightInset) / width);
  const safeHeightRatio = Math.max(EPSILON, (height - top - bottom) / height);

  const direction = normalize({
    x: -request.cameraOffset.x,
    y: -request.cameraOffset.y,
    z: -request.cameraOffset.z,
  });
  const worldUp = { x: 0, y: 1, z: 0 };
  let screenRight = normalize(cross(direction, worldUp));
  if (Math.hypot(screenRight.x, screenRight.y, screenRight.z) <= EPSILON)
    screenRight = { x: 1, y: 0, z: 0 };
  const screenUp = normalize(cross(screenRight, direction));
  const center = request.center;
  const [minY, maxY] = request.verticalExtents ?? [-1, 5];

  let projectedHalfWidth = 0;
  let projectedHalfHeight = 0;
  for (const point of request.points.length ? request.points : [center]) {
    for (const y of [minY, maxY]) {
      const relative = { x: point.x - center.x, y: y - center.y, z: point.z - center.z };
      projectedHalfWidth = Math.max(projectedHalfWidth, Math.abs(dot(relative, screenRight)));
      projectedHalfHeight = Math.max(projectedHalfHeight, Math.abs(dot(relative, screenUp)));
    }
  }

  const minimumHalfHeight = Math.max(0.01, request.minimumHalfHeight ?? 0.01);
  const fitScale = Math.max(1, request.fitScale ?? 1);
  const padding = Math.max(0, request.padding ?? 0);
  const unpadded = Math.max(
    minimumHalfHeight,
    projectedHalfHeight / safeHeightRatio,
    projectedHalfWidth / (aspect * safeWidthRatio),
  );
  const requiredHalfHeight = unpadded * fitScale + padding;
  const halfHeight = Math.min(
    requiredHalfHeight,
    Math.max(minimumHalfHeight, request.maximumHalfHeight ?? Infinity),
  );

  const safeCenterX = leftInset + (width - leftInset - rightInset) / 2;
  const safeCenterY = top + (height - top - bottom) / 2;
  const pixelsToWorld = (2 * halfHeight) / height;
  // Moving the camera target opposite the desired image offset moves the
  // geography toward the unobscured rectangle.
  const shiftRight = ((width / 2 - safeCenterX) * pixelsToWorld) / aspect;
  const shiftUp = ((safeCenterY - height / 2) * pixelsToWorld);
  const fittedCenter = addScaled(addScaled(center, screenRight, shiftRight), screenUp, shiftUp);

  return {
    center: fittedCenter,
    halfHeight,
    requiredHalfHeight,
    fits: halfHeight + EPSILON >= requiredHalfHeight,
  };
}
