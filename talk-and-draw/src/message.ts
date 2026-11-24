/**
 * The message we will eventually send to the model, and (for now) dump to the console.
 * Formatting is pure so it can be tested; `dumpToConsole` is the only side effect.
 */
import { strokeBBox, type BBox, type Stroke } from './ink';
import type { ImageScale, Snapshot } from './snapshot';

export interface TranscriptWord {
  word: string;
  /** seconds since session t0 */
  t0: number;
  t1: number;
}

export interface StrokeSummary {
  id: number;
  /** seconds since session t0 */
  t0: number;
  t1: number;
  bbox: BBox;
  pointCount: number;
  /** Raw points stay out of the model's text; kept here for a later tool. */
  points: Stroke['points'];
}

export interface AudioInfo {
  status: 'recorded' | 'unavailable' | 'none';
  mimeType?: string;
  bytes?: number;
  /** ms between session t0 and the recorder actually starting; transcript times
   *  (relative to audio start) need this added to line up with strokes. */
  offsetMs?: number;
  durationMs?: number;
  blob?: Blob;
  error?: string;
}

export interface TalkAndDrawMessage {
  version: 1;
  startedAt: string;
  durationMs: number;
  canvas: { width: number; height: number };
  image: ImageScale;
  transcript: TranscriptWord[];
  transcriptStatus: 'stubbed' | 'whisper' | 'failed';
  /** The whole transcript as one string (Whisper's `text`). */
  transcriptText?: string;
  /** e.g. "onnx-community/whisper-base.en_timestamped on webgpu, 812ms" */
  transcriptInfo?: string;
  audio: AudioInfo;
  strokes: StrokeSummary[];
  images: Snapshot[];
  /** The rendered timeline text, as the model will read it. */
  timeline: string;
}

export function summarizeStroke(s: Stroke): StrokeSummary {
  return {
    id: s.id,
    t0: s.t0 / 1000,
    t1: (s.t1 ?? s.t0) / 1000,
    bbox: strokeBBox(s.points),
    pointCount: s.points.length,
    points: s.points,
  };
}

const sec = (s: number) => s.toFixed(2);

export function formatHeader(m: Pick<TalkAndDrawMessage, 'canvas' | 'image' | 'startedAt'>): string {
  const { canvas: c, image: i } = m;
  const time = new Date(m.startedAt).toLocaleTimeString();
  return `Viewport ${c.width}x${c.height} (CSS px), images ${i.width}x${i.height} (scale ${i.scale.toFixed(3)}). Session started ${time}.`;
}

/**
 * Words and stroke markers merged by time. A stroke is placed at its END time — the
 * moment its snapshot was taken — so the words spoken while drawing it come first.
 */
export function formatTimeline(
  words: readonly TranscriptWord[],
  strokes: readonly StrokeSummary[],
  images: readonly Pick<Snapshot, 'label'>[],
  endSeconds: number,
): string {
  type Item = { at: number; order: number; text: string };
  const items: Item[] = [];
  for (const w of words) items.push({ at: w.t0, order: 0, text: `[${sec(w.t0)}] ${w.word}` });
  for (const s of strokes) {
    const b = s.bbox;
    const label = `after stroke ${s.id}`;
    const hasImage = images.some((i) => i.label === label);
    const img = hasImage ? `   → image "${label}"` : '';
    items.push({
      at: s.t1,
      order: 1,
      text: `[stroke ${s.id}, ${sec(s.t0)}–${sec(s.t1)}, bbox (${r(b.x0)},${r(b.y0)})-(${r(b.x1)},${r(b.y1)})]${img}`,
    });
  }
  items.sort((a, b) => a.at - b.at || a.order - b.order);
  const lines = ['Timeline (seconds from session start):'];
  let line: string[] = [];
  for (const it of items) {
    if (it.order === 0) {
      line.push(it.text);
      continue;
    }
    if (line.length) lines.push(line.join(' '));
    line = [];
    lines.push(it.text);
  }
  if (line.length) lines.push(line.join(' '));
  lines.push(`--- end of session at ${sec(endSeconds)}s ---   → image "final"`);
  return lines.join('\n');
}

const r = Math.round;

export function dumpToConsole(m: TalkAndDrawMessage): void {
  (window as any).lastTalkAndDraw = m;
  console.group('%cTalk & Draw session', 'color:#b400ff;font-weight:bold');
  console.log(formatHeader(m));
  console.log(
    `Audio: ${m.audio.status}` +
      (m.audio.durationMs != null ? `, ${(m.audio.durationMs / 1000).toFixed(1)}s` : '') +
      (m.audio.bytes != null ? `, ${(m.audio.bytes / 1024).toFixed(0)} KB ${m.audio.mimeType ?? ''}` : '') +
      (m.audio.offsetMs != null ? `, started ${m.audio.offsetMs.toFixed(0)}ms after t0` : '') +
      (m.audio.error ? ` (${m.audio.error})` : '') +
      `. Transcript: ${m.transcriptStatus}${m.transcriptInfo ? ` (${m.transcriptInfo})` : ''}.`,
  );
  if (m.transcriptText) console.log(`Transcript: "${m.transcriptText}"`);
  console.log(m.timeline);
  for (const img of m.images) {
    const tw = Math.min(320, img.width);
    const th = Math.round((img.height * tw) / img.width);
    console.log(
      `%c %c  image "${img.label}" at ${sec(img.t / 1000)}s (${img.width}x${img.height})`,
      `font-size:1px; padding:${th / 2}px ${tw / 2}px; background:url(${img.dataUrl}) no-repeat; background-size:${tw}px ${th}px;`,
      'font-size:12px',
    );
  }
  console.log('message object (also window.lastTalkAndDraw):', m);
  console.groupEnd();
}
