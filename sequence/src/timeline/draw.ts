import type { TimelineTheme } from './constants';
import {
  PIXELS_PER_SECOND,
  RULER_HEIGHT,
  TRACK_EDGE_PADDING,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  formatRulerTime,
  timeToX,
  timelineContentWidth,
  trackTop,
  tracksContentHeight,
} from './constants';
import type { GhostClip, TimelineLayout } from './layout';
import { clipRefEquals } from './layout';
import type { ClipRef } from '../types';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
): void {
  ctx.fillStyle = theme.rulerBg;
  ctx.fillRect(0, 0, layout.width, RULER_HEIGHT);

  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(0, RULER_HEIGHT + 0.5);
  ctx.lineTo(layout.width, RULER_HEIGHT + 0.5);
  ctx.stroke();

  const startSecond = Math.floor(layout.scrollX / PIXELS_PER_SECOND);
  const endSecond = Math.ceil((layout.scrollX + layout.width) / PIXELS_PER_SECOND);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';

  for (let second = startSecond; second <= endSecond; second++) {
    const x = timeToX(second, layout.scrollX);
    const major = second % 5 === 0;
    ctx.strokeStyle = major ? theme.gridMajor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER_HEIGHT - (major ? 12 : 8));
    ctx.lineTo(x + 0.5, RULER_HEIGHT);
    ctx.stroke();

    if (major) {
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(formatRulerTime(second), x, 10);
    }
  }
}

function drawTrackRows(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  trackCount: number,
): void {
  for (let i = 0; i < trackCount; i++) {
    const y = trackTop(i);
    ctx.fillStyle = i % 2 === 0 ? theme.trackBg : theme.trackAltBg;
    ctx.fillRect(TRACK_LABEL_WIDTH, y, layout.width - TRACK_LABEL_WIDTH, TRACK_HEIGHT);

    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(0, y + TRACK_HEIGHT + 0.5);
    ctx.lineTo(layout.width, y + TRACK_HEIGHT + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = theme.bg;
  ctx.fillRect(
    TRACK_LABEL_WIDTH,
    RULER_HEIGHT,
    layout.width - TRACK_LABEL_WIDTH,
    TRACK_EDGE_PADDING,
  );
  const bottomPadY = RULER_HEIGHT + TRACK_EDGE_PADDING + trackCount * TRACK_HEIGHT;
  ctx.fillRect(
    TRACK_LABEL_WIDTH,
    bottomPadY,
    layout.width - TRACK_LABEL_WIDTH,
    TRACK_EDGE_PADDING,
  );
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  trackCount: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    TRACK_LABEL_WIDTH,
    RULER_HEIGHT,
    layout.width - TRACK_LABEL_WIDTH,
    tracksContentHeight(trackCount),
  );
  ctx.clip();

  const startSecond = Math.floor(layout.scrollX / PIXELS_PER_SECOND);
  const endSecond = Math.ceil((layout.scrollX + layout.width) / PIXELS_PER_SECOND);

  for (let second = startSecond; second <= endSecond; second++) {
    const x = timeToX(second, layout.scrollX);
    ctx.strokeStyle = second % 5 === 0 ? theme.gridMajor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER_HEIGHT);
    ctx.lineTo(x + 0.5, RULER_HEIGHT + tracksContentHeight(trackCount));
    ctx.stroke();
  }

  ctx.restore();
}

function drawClips(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  selected: ClipRef | null,
  hovered: ClipRef | null,
  editing: ClipRef | null,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(TRACK_LABEL_WIDTH, RULER_HEIGHT, layout.width - TRACK_LABEL_WIDTH, layout.height - RULER_HEIGHT);
  ctx.clip();

  for (const clip of layout.clips) {
    const selectedClip = clipRefEquals(selected, clip);
    const hoveredClip = clipRefEquals(hovered, clip);

    ctx.fillStyle = selectedClip
      ? theme.clipSelectedFill
      : hoveredClip
        ? theme.clipFillHover
        : theme.clipFill;
    ctx.strokeStyle = selectedClip ? theme.clipSelectedStroke : theme.clipStroke;
    ctx.lineWidth = selectedClip ? 2 : 1;

    roundRect(ctx, clip.x, clip.y, clip.width, clip.height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.handleFill;
    roundRect(ctx, clip.x, clip.y, 8, clip.height, 4);
    ctx.fill();
    roundRect(ctx, clip.x + clip.width - 8, clip.y, 8, clip.height, 4);
    ctx.fill();

    if (!clipRefEquals(editing, clip)) {
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(clip.label, clip.x + 10, clip.y + clip.height / 2);
    }
  }

  ctx.restore();
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  trackCount: number,
): void {
  const x = layout.playheadX;
  if (x < TRACK_LABEL_WIDTH) return;

  const tracksBottom = RULER_HEIGHT + tracksContentHeight(trackCount);
  ctx.strokeStyle = theme.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, tracksBottom);
  ctx.stroke();

  ctx.fillStyle = theme.playhead;
  ctx.beginPath();
  ctx.moveTo(x - 6, 0);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x, 8);
  ctx.closePath();
  ctx.fill();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  ghost: GhostClip,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(TRACK_LABEL_WIDTH, RULER_HEIGHT, layout.width - TRACK_LABEL_WIDTH, layout.height - RULER_HEIGHT);
  ctx.clip();

  ctx.fillStyle = theme.clipSelectedFill;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(TRACK_LABEL_WIDTH, ghost.highlight.y, layout.width - TRACK_LABEL_WIDTH, ghost.highlight.height);
  ctx.globalAlpha = 1;

  ctx.globalAlpha = 0.75;
  ctx.fillStyle = theme.clipSelectedFill;
  ctx.strokeStyle = theme.clipSelectedStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  roundRect(ctx, ghost.x, ghost.y, ghost.width, ghost.height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(ghost.label, ghost.x + 10, ghost.y + ghost.height / 2);

  ctx.restore();
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  theme: TimelineTheme,
  layout: TimelineLayout,
  trackCount: number,
  selected: ClipRef | null,
  hovered: ClipRef | null,
  ghost: GhostClip | null,
  editing: ClipRef | null = null,
): void {
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawTrackRows(ctx, theme, layout, trackCount);
  drawGrid(ctx, theme, layout, trackCount);
  drawRuler(ctx, theme, layout);
  drawClips(ctx, theme, layout, selected, hovered, editing);
  drawPlayhead(ctx, theme, layout, trackCount);
  if (ghost) drawGhost(ctx, theme, layout, ghost);
}

export function maxScrollX(duration: number, canvasWidth: number): number {
  return Math.max(0, timelineContentWidth(duration) - (canvasWidth - TRACK_LABEL_WIDTH));
}
