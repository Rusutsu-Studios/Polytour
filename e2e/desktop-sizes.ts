/**
 * Desktop viewports every layout check covers: the 1280×720 minimum, the
 * 1440×900 and 1920×1080 main targets, and 1440p and 4K screens at 100 %.
 */
export const DESKTOP_SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
] as const;
