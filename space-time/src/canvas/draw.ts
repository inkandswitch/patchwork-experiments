import type { CanvasTheme } from './constants';
import {
  CLIP_HEIGHT,
  HANDLE_WIDTH,
  PIXELS_PER_SECOND,
  POST_IT_FONT_FAMILY,
  POST_IT_FONT_SIZE,
  POST_IT_LINE_HEIGHT,
  POST_IT_PADDING,
  type Camera,
} from './constants';
import type { CanvasLayout } from './layout';

const CLIP_LABEL_FONT = '11px ui-sans-serif, system-ui, sans-serif';
const CLIP_LABEL_PADDING_X = 10;

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

function truncateLabel(ctx: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (maxWidth <= 0 || !label) return '';
  if (ctx.measureText(label).width <= maxWidth) return label;
  const ellipsis = '…';
  let truncated = label;
  while (truncated.length > 0 && ctx.measureText(truncated + ellipsis).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + ellipsis;
}

/** Map page coords to CSS pixels; include dpr so backing-store pixels match the display. */
function applyCameraTransform(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  dpr: number,
): void {
  const z = camera.z * dpr;
  ctx.setTransform(z, 0, 0, z, camera.x * z, camera.y * z);
}

/** Page-space x that reads as time 0:00 — the active playhead's start, if any. */
function timeOriginX(layout: CanvasLayout): number {
  const active = layout.playheads.find((ph) => ph.active);
  return active ? active.x : 0;
}

/** Format a time in seconds, allowing negatives (e.g. "-1:05"). */
function formatSignedRulerTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const whole = Math.floor(Math.abs(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${sign}${mins}:${String(secs).padStart(2, '0')}`;
}

function drawGrid(ctx: CanvasRenderingContext2D, theme: CanvasTheme, layout: CanvasLayout): void {
  const { camera, width, height } = layout;
  const pageLeft = -camera.x;
  const pageTop = -camera.y;
  const pageRight = pageLeft + width / camera.z;
  const pageBottom = pageTop + height / camera.z;

  const originX = timeOriginX(layout);
  const startSecond = Math.floor((pageLeft - originX) / PIXELS_PER_SECOND);
  const endSecond = Math.ceil((pageRight - originX) / PIXELS_PER_SECOND);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1 / camera.z;

  for (let second = startSecond; second <= endSecond; second++) {
    const x = originX + second * PIXELS_PER_SECOND;
    const major = second % 5 === 0;
    ctx.strokeStyle = major ? theme.gridMajor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x, pageTop);
    ctx.lineTo(x, pageBottom);
    ctx.stroke();
  }

  const gridStep = 80;
  const startY = Math.floor(pageTop / gridStep) * gridStep;
  for (let y = startY; y <= pageBottom; y += gridStep) {
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(pageLeft, y);
    ctx.lineTo(pageRight, y);
    ctx.stroke();
  }
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  clip: CanvasLayout['clips'][number],
  selected: boolean,
  hovered: boolean,
  editing: boolean,
): void {
  const radius = 4;
  const fill = selected ? theme.clipSelectedFill : hovered ? theme.clipFillHover : theme.clipFill;
  const stroke = selected ? theme.clipSelectedStroke : theme.clipStroke;

  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = theme.handleFill;
  roundRect(ctx, clip.x, clip.y, HANDLE_WIDTH, clip.height, radius);
  ctx.fill();
  roundRect(ctx, clip.x + clip.width - HANDLE_WIDTH, clip.y, HANDLE_WIDTH, clip.height, radius);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
  ctx.clip();

  if (!editing) {
    const maxLabelWidth = clip.width - CLIP_LABEL_PADDING_X * 2 - HANDLE_WIDTH * 2;
    ctx.font = CLIP_LABEL_FONT;
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = truncateLabel(ctx, clip.label, maxLabelWidth);
    ctx.fillText(label, clip.x + CLIP_LABEL_PADDING_X + HANDLE_WIDTH, clip.y + clip.height / 2);
  }
  ctx.restore();
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  ph: CanvasLayout['playheads'][number],
): void {
  ctx.save();

  if (ph.active || ph.currentX !== ph.x) {
    ctx.fillStyle = ph.active ? theme.playheadBandActive : theme.playheadBand;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(ph.x, ph.y, ph.maxEndX - ph.x, ph.height);
  }

  ctx.fillStyle = ph.active ? theme.playheadBandActive : theme.playheadBand;
  ctx.globalAlpha = 0.15;
  ctx.fillRect(ph.currentX - 20, ph.y, 40, ph.height);

  ctx.globalAlpha = 1;
  ctx.strokeStyle = ph.active ? theme.playheadActive : theme.playhead;
  ctx.lineWidth = ph.active ? 2 : 1.5;
  ctx.beginPath();
  ctx.moveTo(ph.currentX, ph.y);
  ctx.lineTo(ph.currentX, ph.y + ph.height);
  ctx.stroke();

  if (ph.looping) {
    ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = ph.active ? theme.playheadActive : theme.playhead;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('↺', ph.currentX, ph.y + ph.height + 4);
  }

  ctx.restore();
}

function drawGhostPlayhead(
  ctx: CanvasRenderingContext2D,
  ghost: CanvasLayout['ghostPlayheads'][number],
): void {
  ctx.save();
  ctx.strokeStyle = ghost.color;
  ctx.fillStyle = ghost.color;

  ctx.globalAlpha = 0.1;
  ctx.fillRect(ghost.x, ghost.y, ghost.maxEndX - ghost.x, ghost.height);
  ctx.globalAlpha = 0.2;
  ctx.fillRect(ghost.currentX - 16, ghost.y, 32, ghost.height);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(ghost.currentX, ghost.y);
  ctx.lineTo(ghost.currentX, ghost.y + ghost.height);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.9;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const label = truncateLabel(ctx, ghost.name, 120);
  ctx.fillText(label, ghost.currentX, ghost.y + 4);
  ctx.restore();
}

function drawRecordingPreview(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  preview: NonNullable<CanvasLayout['recordingPreview']>,
): void {
  const radius = 4;
  ctx.save();
  ctx.strokeStyle = theme.danger;
  ctx.fillStyle = theme.danger;
  ctx.globalAlpha = 0.12;
  roundRect(ctx, preview.x, preview.y, preview.width, preview.height, radius);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  roundRect(ctx, preview.x, preview.y, preview.width, preview.height, radius);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.danger;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Recording…', preview.x + 10, preview.y + preview.height / 2);
  ctx.restore();
}

function fillOutlinePath(ctx: CanvasRenderingContext2D, outline: number[][]): void {
  if (outline.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i]![0]!, outline[i]![1]!);
  }
  ctx.closePath();
  ctx.fill();
}

function drawScribble(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  outline: number[][],
  selected: boolean,
): void {
  if (outline.length < 2) return;
  ctx.save();
  fillOutlinePath(ctx, outline);
  ctx.fillStyle = selected ? theme.scribbleSelected : theme.scribble;
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = theme.scribbleSelected;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

const POST_IT_FONT = `${POST_IT_FONT_SIZE}px ${POST_IT_FONT_FAMILY}`;
const POST_IT_RESIZE_HANDLE = 6;

function drawPostItResizeHandle(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  postIt: CanvasLayout['postIts'][number],
): void {
  const x = postIt.x + postIt.width;
  const y = postIt.y + postIt.height;
  const size = POST_IT_RESIZE_HANDLE;
  ctx.strokeStyle = theme.postItSelectedStroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - size, y - 1);
  ctx.lineTo(x - 1, y - 1);
  ctx.lineTo(x - 1, y - size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.6, y - 1);
  ctx.lineTo(x - 1, y - 1);
  ctx.lineTo(x - 1, y - size * 0.6);
  ctx.stroke();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text.trim()) return [];
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const next = `${current} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i]!;
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawPostIt(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  postIt: CanvasLayout['postIts'][number],
  selected: boolean,
  editing: boolean,
): void {
  const radius = 2;
  ctx.save();
  roundRect(ctx, postIt.x, postIt.y, postIt.width, postIt.height, radius);
  ctx.fillStyle = theme.postItFill;
  ctx.fill();
  ctx.strokeStyle = selected ? theme.postItSelectedStroke : theme.postItStroke;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();

  if (!editing && postIt.text.trim()) {
    ctx.beginPath();
    roundRect(ctx, postIt.x, postIt.y, postIt.width, postIt.height, radius);
    ctx.clip();
    ctx.font = POST_IT_FONT;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const maxWidth = postIt.width - POST_IT_PADDING * 2;
    const lines = wrapTextLines(ctx, postIt.text, maxWidth);
    const maxLines = Math.floor((postIt.height - POST_IT_PADDING * 2) / POST_IT_LINE_HEIGHT);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      ctx.fillText(
        lines[i]!,
        postIt.x + POST_IT_PADDING,
        postIt.y + POST_IT_PADDING + i * POST_IT_LINE_HEIGHT,
      );
    }
  }
  if (selected) {
    drawPostItResizeHandle(ctx, theme, postIt);
  }
  ctx.restore();
}

function drawVerticalDragPreview(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  x: number,
  y0: number,
  y1: number,
  valid: boolean,
): void {
  ctx.strokeStyle = valid ? theme.playhead : theme.danger;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  layout: CanvasLayout,
  selectedClipId: string | null,
  hoveredClipId: string | null,
  verticalDragPreview?: { x: number; y0: number; y1: number; valid: boolean } | null,
  dpr = 1,
  editingClipId: string | null = null,
  selectedScribbleId: string | null = null,
  selectedPostItId: string | null = null,
  editingPostItId: string | null = null,
  scribblePreview?: number[][] | null,
): void {
  const { width, height, camera } = layout;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  applyCameraTransform(ctx, camera, dpr);
  drawGrid(ctx, theme, layout);

  for (const scribble of layout.scribbles) {
    drawScribble(
      ctx,
      theme,
      scribble.outline,
      scribble.scribbleId === selectedScribbleId,
    );
  }

  if (scribblePreview && scribblePreview.length >= 2) {
    drawScribble(ctx, theme, scribblePreview, false);
  }

  for (const clip of layout.clips) {
    drawClip(
      ctx,
      theme,
      clip,
      clip.clipId === selectedClipId,
      clip.clipId === hoveredClipId,
      clip.clipId === editingClipId,
    );
  }

  for (const postIt of layout.postIts) {
    drawPostIt(
      ctx,
      theme,
      postIt,
      postIt.postItId === selectedPostItId,
      postIt.postItId === editingPostItId,
    );
  }

  for (const ghost of layout.ghostPlayheads) {
    drawGhostPlayhead(ctx, ghost);
  }

  for (const ph of layout.playheads) {
    drawPlayhead(ctx, theme, ph);
  }

  if (layout.recordingPreview) {
    drawRecordingPreview(ctx, theme, layout.recordingPreview);
  }

  if (verticalDragPreview) {
    drawVerticalDragPreview(
      ctx,
      theme,
      verticalDragPreview.x,
      verticalDragPreview.y0,
      verticalDragPreview.y1,
      verticalDragPreview.valid,
    );
  }
}

export function drawTimeRuler(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  layout: CanvasLayout,
  dpr = 1,
): void {
  const { camera, width } = layout;
  const rulerHeight = 24;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, rulerHeight);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(0, rulerHeight);
  ctx.lineTo(width, rulerHeight);
  ctx.stroke();

  const pageLeft = -camera.x;
  const pageRight = pageLeft + width / camera.z;
  const originX = timeOriginX(layout);
  const startSecond = Math.floor((pageLeft - originX) / PIXELS_PER_SECOND);
  const endSecond = Math.ceil((pageRight - originX) / PIXELS_PER_SECOND);

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let second = startSecond; second <= endSecond; second++) {
    const pageX = originX + second * PIXELS_PER_SECOND;
    const screenX = (pageX + camera.x) * camera.z;
    const major = second % 5 === 0;
    ctx.strokeStyle = major ? theme.gridMajor : theme.grid;
    ctx.beginPath();
    ctx.moveTo(screenX, rulerHeight - (major ? 12 : 8));
    ctx.lineTo(screenX, rulerHeight);
    ctx.stroke();

    if (major) {
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(formatSignedRulerTime(second), screenX, 10);
    }
  }
}
