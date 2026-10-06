/** A browser preference, independent of the Director's animation playback. */
export const BOARD_ZOOM = { min: 0.8, max: 2, step: 0.1, default: 1 } as const;

export function clampBoardZoom(value: number): number {
  if (!Number.isFinite(value)) return BOARD_ZOOM.default;
  return (
    Math.round(Math.min(BOARD_ZOOM.max, Math.max(BOARD_ZOOM.min, value)) * 10) /
    10
  );
}
