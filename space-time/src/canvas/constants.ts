export const PIXELS_PER_SECOND = 80;
export const CLIP_HEIGHT = 48;
export const HANDLE_WIDTH = 8;
/** Minimum handle hit target in screen pixels (converted to page space via camera zoom). */
export const MIN_HANDLE_HIT_SCREEN_PX = 14;
/** Clip/playhead edges snap within this distance on screen (see snapThresholdPage). */
export const SNAP_THRESHOLD_SCREEN_PX = 6;
export const MIN_CLIP_DURATION = 0.25;
export const MIN_PLAYHEAD_HEIGHT = 20;
export const MIN_VERTICAL_DRAG_PX = 12;
export const DEFAULT_IMAGE_DURATION = 5;
export const POST_IT_WIDTH = 160;
export const POST_IT_HEIGHT = 120;
export const MIN_POST_IT_WIDTH = 80;
export const MIN_POST_IT_HEIGHT = 60;

/** Default width (page px) for an image converted from a clip to inline. */
export const DEFAULT_INLINE_IMAGE_WIDTH = 240;
/** Smallest edge length (page px) an inline image can be resized to. */
export const MIN_INLINE_IMAGE_SIZE = 40;
export const POST_IT_FONT_SIZE = 20;
export const POST_IT_PADDING = 12;
export const POST_IT_LINE_HEIGHT = 24;
export const POST_IT_FONT_FAMILY = '"Caveat", "Comic Sans MS", ui-rounded, cursive';
export const POST_IT_FONT_WEIGHT = 600;
/** Horizontal margin kept around the playhead line during playback follow-pan. */
export const PLAYBACK_FOLLOW_MARGIN_SCREEN_PX = 120;

export type Camera = {
  x: number;
  y: number;
  z: number;
};

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

export type CanvasTheme = {
  bg: string;
  grid: string;
  gridMajor: string;
  border: string;
  text: string;
  textMuted: string;
  clipFill: string;
  clipFillHover: string;
  clipStroke: string;
  clipSelectedFill: string;
  clipSelectedStroke: string;
  handleFill: string;
  marker: string;
  playhead: string;
  playheadActive: string;
  playheadBand: string;
  playheadBandActive: string;
  danger: string;
  scribble: string;
  scribbleSelected: string;
  waveform: string;
  selectionBubble: string;
  postItFill: string;
  postItSelectedFill: string;
  postItStroke: string;
  postItSelectedStroke: string;
};

const THEME_VARS: Array<[keyof CanvasTheme, string]> = [
  ['bg', '--st-bg'],
  ['grid', '--st-grid'],
  ['gridMajor', '--st-grid-major'],
  ['border', '--st-border'],
  ['text', '--st-text'],
  ['textMuted', '--st-text-muted'],
  ['clipFill', '--st-clip-fill'],
  ['clipFillHover', '--st-clip-fill-hover'],
  ['clipStroke', '--st-clip-stroke'],
  ['clipSelectedFill', '--st-clip-selected-fill'],
  ['clipSelectedStroke', '--st-clip-selected-stroke'],
  ['handleFill', '--st-handle-fill'],
  ['marker', '--st-marker'],
  ['playhead', '--st-playhead'],
  ['playheadActive', '--st-playhead-active'],
  ['playheadBand', '--st-playhead-band'],
  ['playheadBandActive', '--st-playhead-band-active'],
  ['danger', '--st-danger'],
  ['scribble', '--st-scribble'],
  ['scribbleSelected', '--st-scribble-selected'],
  ['waveform', '--st-waveform'],
  ['selectionBubble', '--st-selection-bubble'],
  ['postItFill', '--st-post-it-fill'],
  ['postItSelectedFill', '--st-post-it-selected-fill'],
  ['postItStroke', '--st-post-it-stroke'],
  ['postItSelectedStroke', '--st-post-it-selected-stroke'],
];

export function readCanvasTheme(root: HTMLElement): CanvasTheme {
  const style = getComputedStyle(root);
  const theme = {} as CanvasTheme;
  for (const [key, cssVar] of THEME_VARS) {
    theme[key] = style.getPropertyValue(cssVar).trim();
  }
  return theme;
}

export function screenToPage(screenX: number, screenY: number, camera: Camera): { x: number; y: number } {
  return {
    x: screenX / camera.z - camera.x,
    y: screenY / camera.z - camera.y,
  };
}

export function pageToScreen(pageX: number, pageY: number, camera: Camera): { x: number; y: number } {
  return {
    x: (pageX + camera.x) * camera.z,
    y: (pageY + camera.y) * camera.z,
  };
}

/** Pan camera.x only, as much as needed so pageX stays within horizontal screen margins. */
export function panCameraToKeepPageXVisible(
  camera: Camera,
  pageX: number,
  viewportWidthScreen: number,
  marginLeftScreen = PLAYBACK_FOLLOW_MARGIN_SCREEN_PX,
  marginRightScreen = PLAYBACK_FOLLOW_MARGIN_SCREEN_PX,
): boolean {
  if (viewportWidthScreen <= marginLeftScreen + marginRightScreen) return false;

  const z = camera.z;
  const screenX = (pageX + camera.x) * z;
  const maxScreenX = viewportWidthScreen - marginRightScreen;
  if (screenX >= marginLeftScreen && screenX <= maxScreenX) return false;

  const prevX = camera.x;
  camera.x =
    screenX < marginLeftScreen ? marginLeftScreen / z - pageX : maxScreenX / z - pageX;
  return camera.x !== prevX;
}

export function formatRulerTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function cameraStorageKey(docUrl: string): string {
  return `space-time-camera:${docUrl}`;
}

export function loadCamera(docUrl: string): Camera {
  try {
    const raw = localStorage.getItem(cameraStorageKey(docUrl));
    if (!raw) return { ...DEFAULT_CAMERA };
    const parsed = JSON.parse(raw) as Camera;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.z === 'number' &&
      parsed.z > 0
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CAMERA };
}

export function saveCamera(docUrl: string, camera: Camera): void {
  try {
    localStorage.setItem(cameraStorageKey(docUrl), JSON.stringify(camera));
  } catch {
    /* ignore */
  }
}

/** Keep the page point under (screenX, screenY) fixed while changing zoom. */
export function zoomCameraAtScreenPoint(
  camera: Camera,
  screenX: number,
  screenY: number,
  zoomFactor: number,
): void {
  const worldX = screenX / camera.z - camera.x;
  const worldY = screenY / camera.z - camera.y;
  camera.z = Math.max(0.1, Math.min(4, camera.z * zoomFactor));
  camera.x = screenX / camera.z - worldX;
  camera.y = screenY / camera.z - worldY;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
