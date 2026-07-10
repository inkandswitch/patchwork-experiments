import type { CanvasTheme } from './constants';
import {
  CLIP_HEIGHT,
  HANDLE_WIDTH,
  PIXELS_PER_SECOND,
  POST_IT_FONT_FAMILY,
  POST_IT_FONT_SIZE,
  POST_IT_FONT_WEIGHT,
  POST_IT_LINE_HEIGHT,
  POST_IT_PADDING,
  type Camera,
} from './constants';
import type { CanvasLayout } from './layout';
import type { SourceThumbnails } from './clip-thumbnails';

const CLIP_LABEL_FONT = '11px ui-sans-serif, system-ui, sans-serif';
const CLIP_LABEL_PADDING_X = 10;

/** Draw `image` into the dest rect using object-fit: cover (centered crop). */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  iw: number,
  ih: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  if (iw <= 0 || ih <= 0 || dw <= 0 || dh <= 0) return;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

function frameForClipFraction(
  thumbs: SourceThumbnails,
  clip: CanvasLayout['clips'][number],
  fraction: number,
): SourceThumbnails['frames'][number] | null {
  const frames = thumbs.frames;
  if (frames.length === 0) return null;
  if (thumbs.type === 'image' || thumbs.duration <= 0) return frames[0]!;
  const sourceTime = Math.max(
    0,
    Math.min(thumbs.duration, (clip.sourceInTime ?? 0) + fraction * clip.duration),
  );
  // Nearest sampled frame to the mapped source time.
  let best = frames[0]!;
  let bestDelta = Math.abs(best.time - sourceTime);
  for (let i = 1; i < frames.length; i++) {
    const delta = Math.abs(frames[i]!.time - sourceTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = frames[i]!;
    }
  }
  return best;
}

/** Draw an audio clip's waveform across its box, mapped to the clip's window. */
function drawClipWaveform(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  clip: CanvasLayout['clips'][number],
  thumbs: SourceThumbnails,
): void {
  const peaks = thumbs.peaks;
  const duration = thumbs.duration;
  if (peaks.length === 0 || duration <= 0) return;

  const midY = clip.y + clip.height / 2;
  const maxBarHeight = clip.height * 0.82;
  const barStep = 3; // page px per bar (scales with zoom, like the filmstrip)
  const barWidth = 1.6;
  const bars = Math.max(1, Math.floor(clip.width / barStep));
  const inTime = clip.sourceInTime ?? 0;

  ctx.fillStyle = theme.waveform;
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < bars; i++) {
    // Time span of the source covered by this bar; take its loudest peak so
    // transients survive downsampling.
    const t0 = inTime + (i / bars) * clip.duration;
    const t1 = inTime + ((i + 1) / bars) * clip.duration;
    let b0 = Math.floor((t0 / duration) * peaks.length);
    let b1 = Math.ceil((t1 / duration) * peaks.length);
    b0 = Math.max(0, Math.min(peaks.length - 1, b0));
    b1 = Math.max(b0 + 1, Math.min(peaks.length, b1));
    let peak = 0;
    for (let b = b0; b < b1; b++) if (peaks[b]! > peak) peak = peaks[b]!;
    const h = Math.max(1, peak * maxBarHeight);
    ctx.fillRect(clip.x + i * barStep + (barStep - barWidth) / 2, midY - h / 2, barWidth, h);
  }
  ctx.globalAlpha = 1;
}

/** Tile the source's sampled frames across the clip box (iMovie filmstrip). */
function drawClipFilmstrip(
  ctx: CanvasRenderingContext2D,
  clip: CanvasLayout['clips'][number],
  thumbs: SourceThumbnails,
): void {
  const aspect = thumbs.aspect > 0 ? thumbs.aspect : 16 / 9;
  const tileW = Math.max(6, clip.height * aspect);
  const tiles = Math.max(1, Math.round(clip.width / tileW));
  const step = clip.width / tiles;
  for (let i = 0; i < tiles; i++) {
    const frame = frameForClipFraction(thumbs, clip, (i + 0.5) / tiles);
    if (!frame) continue;
    drawImageCover(
      ctx,
      frame.image,
      frame.image.width,
      frame.image.height,
      clip.x + i * step,
      clip.y,
      // Overlap by a hair to avoid seams from sub-pixel rounding.
      step + 0.5,
      clip.height,
    );
  }
}

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

/**
 * Page-space x that reads as time 0:00 — the active playhead's start, if any.
 * `override` freezes the origin (e.g. while dragging the active playhead, so
 * the grid/ruler don't scroll until the move is committed).
 */
function timeOriginX(layout: CanvasLayout, override?: number | null): number {
  if (override != null) return override;
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

function drawGrid(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  layout: CanvasLayout,
  timeOriginOverride?: number | null,
): void {
  const { camera, width, height } = layout;
  const pageLeft = -camera.x;
  const pageTop = -camera.y;
  const pageRight = pageLeft + width / camera.z;
  const pageBottom = pageTop + height / camera.z;

  const originX = timeOriginX(layout, timeOriginOverride);
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
  thumbnails?: Map<string, SourceThumbnails>,
): void {
  const radius = 4;
  const fill = selected ? theme.clipSelectedFill : hovered ? theme.clipFillHover : theme.clipFill;
  const stroke = selected ? theme.clipSelectedStroke : theme.clipStroke;

  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();

  const thumbs = thumbnails?.get(clip.sourceId);
  const hasFrames = !!thumbs && thumbs.type !== 'audio' && thumbs.frames.length > 0;
  const hasWaveform = !!thumbs && thumbs.type === 'audio' && thumbs.peaks.length > 0;
  const hasContent = hasFrames || hasWaveform;

  // Filmstrip fills the box (cover); waveform is drawn over the solid fill.
  // Both are clipped to the rounded rect. Sources still decoding fall back to
  // the plain fill above.
  if (hasContent) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
    ctx.clip();
    if (hasFrames) drawClipFilmstrip(ctx, clip, thumbs!);
    else drawClipWaveform(ctx, theme, clip, thumbs!);
    ctx.restore();
  }

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
  ctx.stroke();

  ctx.fillStyle = theme.handleFill;
  ctx.globalAlpha = hasFrames ? 0.85 : 1;
  roundRect(ctx, clip.x, clip.y, HANDLE_WIDTH, clip.height, radius);
  ctx.fill();
  roundRect(ctx, clip.x + clip.width - HANDLE_WIDTH, clip.y, HANDLE_WIDTH, clip.height, radius);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, radius);
  ctx.clip();

  if (!editing) {
    const labelX = clip.x + CLIP_LABEL_PADDING_X + HANDLE_WIDTH;
    const labelY = clip.y + clip.height / 2;
    const maxLabelWidth = clip.width - CLIP_LABEL_PADDING_X * 2 - HANDLE_WIDTH * 2;
    ctx.font = CLIP_LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = truncateLabel(ctx, clip.label, maxLabelWidth);
    if (hasContent) {
      // Subtitle treatment: a dark outline (stroke) under white fill stays
      // legible over any frames/waveform, regardless of their brightness.
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, labelX, labelY);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
      ctx.fillText(label, labelX, labelY);
    } else {
      ctx.fillStyle = theme.text;
      ctx.fillText(label, labelX, labelY);
    }
  }
  ctx.restore();
}

/**
 * The extent band spanning the playhead's clips. Drawn beneath the clips (so
 * the frames stay legible) and always visible: the active playhead's band is
 * the darker accent colour, inactive playheads are lighter and recede.
 */
function drawPlayheadExtent(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  ph: CanvasLayout['playheads'][number],
): void {
  const width = ph.maxEndX - ph.x;
  if (width <= 0) return;
  ctx.save();
  ctx.fillStyle = ph.active ? theme.playheadBandActive : theme.playheadBand;
  ctx.globalAlpha = ph.active ? 0.08 : 0.035;
  ctx.fillRect(ph.x, ph.y, width, ph.height);
  ctx.restore();
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  ph: CanvasLayout['playheads'][number],
): void {
  ctx.save();

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

const POST_IT_FONT = `${POST_IT_FONT_WEIGHT} ${POST_IT_FONT_SIZE}px ${POST_IT_FONT_FAMILY}`;
const POST_IT_RESIZE_HANDLE = 6;

/**
 * A softly bowed sheet outline, à la Keynote's "curvy paper" effect: each edge
 * curves outward a touch so the note reads as a real, slightly buckled piece of
 * paper rather than a flat rectangle.
 */
function paperPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const bowX = Math.min(Math.max(width * 0.015, 1.5), 4);
  const bowY = Math.min(Math.max(height * 0.02, 1.5), 4);
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(cx, y + bowY, x + width, y);
  ctx.quadraticCurveTo(x + width - bowX, cy, x + width, y + height);
  ctx.quadraticCurveTo(cx, y + height - bowY, x, y + height);
  ctx.quadraticCurveTo(x + bowX, cy, x, y);
  ctx.closePath();
}

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
  const { x, y, width, height } = postIt;
  ctx.save();

  // Lifted-paper drop shadow (drawn with the fill so it hugs the bowed edges).
  ctx.save();
  ctx.shadowColor = 'rgba(30, 27, 15, 0.28)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 4;
  paperPath(ctx, x, y, width, height);
  ctx.fillStyle = selected ? theme.postItSelectedFill : theme.postItFill;
  ctx.fill();
  ctx.restore();

  // Paper shading: a highlight near the top fading to a faint darkening at the
  // bottom, so the sheet looks like it catches the light.
  paperPath(ctx, x, y, width, height);
  const shade = ctx.createLinearGradient(x, y, x, y + height);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
  shade.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.07)');
  ctx.fillStyle = shade;
  ctx.fill();

  // Hairline edge for definition; selection is conveyed by the fill colour, not
  // a heavy border.
  ctx.strokeStyle = theme.postItStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!editing && postIt.text.trim()) {
    ctx.save();
    paperPath(ctx, x, y, width, height);
    ctx.clip();
    ctx.font = POST_IT_FONT;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const maxWidth = width - POST_IT_PADDING * 2;
    const lines = wrapTextLines(ctx, postIt.text, maxWidth);
    const maxLines = Math.floor((height - POST_IT_PADDING * 2) / POST_IT_LINE_HEIGHT);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      ctx.fillText(lines[i]!, x + POST_IT_PADDING, y + POST_IT_PADDING + i * POST_IT_LINE_HEIGHT);
    }
    ctx.restore();
  }
  if (selected) {
    drawPostItResizeHandle(ctx, theme, postIt);
  }
  ctx.restore();
}

const INLINE_IMAGE_RADIUS = 6;
const INLINE_IMAGE_RESIZE_HANDLE = 12;

function drawInlineImage(
  ctx: CanvasRenderingContext2D,
  theme: CanvasTheme,
  image: CanvasLayout['inlineImages'][number],
  imageEl: HTMLImageElement | undefined,
  selected: boolean,
): void {
  const { x, y, width, height } = image;
  ctx.save();

  // Soft drop shadow so the picture reads as a physical print on the board.
  ctx.save();
  ctx.shadowColor = 'rgba(20, 20, 30, 0.32)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, width, height, INLINE_IMAGE_RADIUS);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, width, height, INLINE_IMAGE_RADIUS);
  ctx.clip();
  if (imageEl && imageEl.naturalWidth > 0) {
    drawImageCover(ctx, imageEl, imageEl.naturalWidth, imageEl.naturalHeight, x, y, width, height);
  } else {
    // Still decoding: a neutral placeholder keeps the box visible.
    ctx.fillStyle = theme.clipFill;
    ctx.fillRect(x, y, width, height);
  }
  ctx.restore();

  roundRect(ctx, x, y, width, height, INLINE_IMAGE_RADIUS);
  ctx.strokeStyle = selected ? theme.clipSelectedStroke : 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();

  if (selected) {
    const hx = x + width;
    const hy = y + height;
    const s = INLINE_IMAGE_RESIZE_HANDLE;
    ctx.fillStyle = theme.clipSelectedStroke;
    roundRect(ctx, hx - s, hy - s, s, s, 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.62, hy - 3);
    ctx.lineTo(hx - 3, hy - 3);
    ctx.lineTo(hx - 3, hy - s * 0.62);
    ctx.stroke();
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
  thumbnails?: Map<string, SourceThumbnails>,
  imageElements?: Map<string, HTMLImageElement>,
  selectedInlineImageId: string | null = null,
  timeOriginOverride: number | null = null,
): void {
  const { width, height, camera } = layout;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  applyCameraTransform(ctx, camera, dpr);
  drawGrid(ctx, theme, layout, timeOriginOverride);

  // Inline images are background decoration, drawn beneath everything else.
  for (const image of layout.inlineImages) {
    drawInlineImage(
      ctx,
      theme,
      image,
      imageElements?.get(image.sourceId),
      image.imageId === selectedInlineImageId,
    );
  }

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

  // Extent bands sit beneath the clips they contain.
  for (const ph of layout.playheads) {
    drawPlayheadExtent(ctx, theme, ph);
  }

  for (const clip of layout.clips) {
    drawClip(
      ctx,
      theme,
      clip,
      clip.clipId === selectedClipId,
      clip.clipId === hoveredClipId,
      clip.clipId === editingClipId,
      thumbnails,
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
  timeOriginOverride: number | null = null,
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
  const originX = timeOriginX(layout, timeOriginOverride);
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
