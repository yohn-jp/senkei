type PresentationMode = "tactical" | "cinematic";

/** Existing authored camera offsets use the same azimuth in both modes. */
export const CINEMATIC_CAMERA_HEIGHT_SCALE = 0.82;

export interface CameraOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Retains the authored offset's azimuth while lowering the Cinematic view angle. */
export function presentationCameraOffset(
  offset: CameraOffset,
  mode: PresentationMode,
): CameraOffset {
  return {
    x: offset.x,
    y: offset.y * (mode === "cinematic" ? CINEMATIC_CAMERA_HEIGHT_SCALE : 1),
    z: offset.z,
  };
}

/** Changes only camera elevation for a user-adjusted view and is reversible. */
export function transitionCameraOffset(
  offset: CameraOffset,
  from: PresentationMode,
  to: PresentationMode,
): CameraOffset {
  const fromScale = from === "cinematic" ? CINEMATIC_CAMERA_HEIGHT_SCALE : 1;
  const toScale = to === "cinematic" ? CINEMATIC_CAMERA_HEIGHT_SCALE : 1;
  return { x: offset.x, y: offset.y * (toScale / fromScale), z: offset.z };
}
