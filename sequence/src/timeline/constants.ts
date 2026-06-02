export const PIXELS_PER_SECOND = 80;
export const TRACK_HEIGHT = 48;
export const TRACK_LABEL_WIDTH = 128;
export const RULER_HEIGHT = 28;
export const ADD_TRACK_HEIGHT = 32;
export const HANDLE_WIDTH = 8;
export const MIN_CLIP_DURATION = 0.25;
export const MIN_TIMELINE_WIDTH = 600;

export type TimelineTheme = {
  bg: string;
  rulerBg: string;
  labelBg: string;
  trackBg: string;
  trackAltBg: string;
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
  playhead: string;
  buttonFill: string;
  buttonHover: string;
  buttonText: string;
  danger: string;
};

const THEME_VARS: Array<[keyof TimelineTheme, string]> = [
  ['bg', '--timeline-bg'],
  ['rulerBg', '--timeline-ruler-bg'],
  ['labelBg', '--timeline-label-bg'],
  ['trackBg', '--timeline-track-bg'],
  ['trackAltBg', '--timeline-track-alt-bg'],
  ['grid', '--timeline-grid'],
  ['gridMajor', '--timeline-grid-major'],
  ['border', '--timeline-border'],
  ['text', '--timeline-text'],
  ['textMuted', '--timeline-text-muted'],
  ['clipFill', '--timeline-clip-fill'],
  ['clipFillHover', '--timeline-clip-fill-hover'],
  ['clipStroke', '--timeline-clip-stroke'],
  ['clipSelectedFill', '--timeline-clip-selected-fill'],
  ['clipSelectedStroke', '--timeline-clip-selected-stroke'],
  ['handleFill', '--timeline-handle-fill'],
  ['playhead', '--timeline-playhead'],
  ['buttonFill', '--timeline-button-fill'],
  ['buttonHover', '--timeline-button-hover'],
  ['buttonText', '--timeline-button-text'],
  ['danger', '--timeline-danger'],
];

export function readTimelineTheme(root: HTMLElement): TimelineTheme {
  const style = getComputedStyle(root);
  const theme = {} as TimelineTheme;
  for (const [key, cssVar] of THEME_VARS) {
    theme[key] = style.getPropertyValue(cssVar).trim();
  }
  return theme;
}

export function timeToX(time: number, scrollX: number): number {
  return TRACK_LABEL_WIDTH + time * PIXELS_PER_SECOND - scrollX;
}

export function xToTime(x: number, scrollX: number): number {
  return (x - TRACK_LABEL_WIDTH + scrollX) / PIXELS_PER_SECOND;
}

export function timelineContentWidth(duration: number): number {
  return Math.max(MIN_TIMELINE_WIDTH, duration * PIXELS_PER_SECOND + 240);
}

export function tracksAreaHeight(trackCount: number): number {
  return trackCount * TRACK_HEIGHT + ADD_TRACK_HEIGHT;
}

export function totalCanvasHeight(trackCount: number): number {
  return RULER_HEIGHT + tracksAreaHeight(trackCount);
}

export function trackTop(trackIndex: number): number {
  return RULER_HEIGHT + trackIndex * TRACK_HEIGHT;
}

export function formatRulerTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
