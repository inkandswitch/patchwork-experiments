import type { Source, SpaceTimeDoc } from '../types';
import { resolveSourceUrl } from '../helpers';

/** Captured filmstrip height in device-independent px; width follows aspect. */
const FRAME_HEIGHT = 96;
/** Roughly one sampled frame per this many seconds of video (clamped below). */
const SECONDS_PER_FRAME = 0.5;
const MIN_VIDEO_FRAMES = 8;
const MAX_VIDEO_FRAMES = 48;
/** Give up on a single video seek after this long (some sources never fire). */
const SEEK_TIMEOUT_MS = 4000;
/** Waveform resolution: amplitude buckets sampled per second of audio. */
const WAVEFORM_BUCKETS_PER_SECOND = 90;
const WAVEFORM_MAX_BUCKETS = 12000;

export type ThumbFrame = { time: number; image: HTMLCanvasElement };

export type SourceThumbnails = {
  status: 'loading' | 'ready' | 'error';
  type: Source['type'];
  /** width / height of the source media. */
  aspect: number;
  /** Source duration in seconds. */
  duration: number;
  /** Video/image filmstrip frames (empty for audio). */
  frames: ThumbFrame[];
  /** Per-bucket peak amplitude (0..1), evenly spaced over `duration` (audio). */
  peaks: number[];
};

export type ThumbnailStore = {
  /** Kick off decoding for any new/changed sources referenced by the doc. */
  ensure: (doc: SpaceTimeDoc) => void;
  /** Synchronous lookup for drawing. */
  map: Map<string, SourceThumbnails>;
  dispose: () => void;
};

type Entry = {
  url: string;
  thumbs: SourceThumbnails;
  cleanup?: () => void;
};

function captureFrame(
  media: HTMLVideoElement | HTMLImageElement,
  intrinsicWidth: number,
  intrinsicHeight: number,
): HTMLCanvasElement {
  const aspect = intrinsicWidth > 0 && intrinsicHeight > 0 ? intrinsicWidth / intrinsicHeight : 16 / 9;
  const h = FRAME_HEIGHT;
  const w = Math.max(1, Math.round(h * aspect));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(media, 0, 0, w, h);
  return canvas;
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', finish);
    video.currentTime = time;
  });
}

async function loadVideoFrames(
  url: string,
  entry: Entry,
  notify: () => void,
  isCurrent: () => boolean,
): Promise<void> {
  // Fetch to a Blob first so the whole file is in memory: object URLs support
  // instant in-memory seeking even when the origin doesn't do range requests.
  let objectUrl: string | null = null;
  let srcUrl = url;
  try {
    const response = await fetch(url);
    if (response.ok) {
      objectUrl = URL.createObjectURL(await response.blob());
      srcUrl = objectUrl;
    }
  } catch {
    /* fall back to the resolved URL directly */
  }

  const video = document.createElement('video');
  video.muted = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.src = srcUrl;
  entry.cleanup = () => {
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
    });
    if (!isCurrent()) return;

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    entry.thumbs.duration = duration;
    entry.thumbs.aspect =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;

    const count = duration
      ? Math.min(MAX_VIDEO_FRAMES, Math.max(MIN_VIDEO_FRAMES, Math.round(duration / SECONDS_PER_FRAME)))
      : 1;

    for (let i = 0; i < count; i++) {
      if (!isCurrent()) return;
      const time = duration ? ((i + 0.5) / count) * duration : 0;
      await seekVideo(video, time);
      if (!isCurrent()) return;
      entry.thumbs.frames.push({
        time,
        image: captureFrame(video, video.videoWidth, video.videoHeight),
      });
      // Reveal frames progressively so the strip fills in as it decodes.
      notify();
    }
    entry.thumbs.status = 'ready';
    notify();
  } catch {
    entry.thumbs.status = 'error';
    notify();
  } finally {
    entry.cleanup?.();
    entry.cleanup = undefined;
  }
}

let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

async function loadAudioPeaks(
  url: string,
  entry: Entry,
  notify: () => void,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) throw new Error('no AudioContext');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`audio fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    if (!isCurrent()) return;
    const buffer = await audioCtx.decodeAudioData(arrayBuffer);
    if (!isCurrent()) return;

    const duration = buffer.duration;
    const channelCount = buffer.numberOfChannels;
    const length = buffer.length;
    const buckets = Math.max(
      1,
      Math.min(WAVEFORM_MAX_BUCKETS, Math.ceil(duration * WAVEFORM_BUCKETS_PER_SECOND)),
    );
    const samplesPerBucket = Math.max(1, Math.floor(length / buckets));
    const peaks = new Array<number>(buckets).fill(0);
    // Peak amplitude per bucket across all channels (absolute, not normalized,
    // so loud passages read as tall bars — handy for lining up cuts).
    for (let ch = 0; ch < channelCount; ch++) {
      const data = buffer.getChannelData(ch);
      for (let b = 0; b < buckets; b++) {
        const start = b * samplesPerBucket;
        const end = Math.min(length, start + samplesPerBucket);
        let peak = peaks[b]!;
        for (let i = start; i < end; i++) {
          const v = Math.abs(data[i]!);
          if (v > peak) peak = v;
        }
        peaks[b] = peak;
      }
    }

    entry.thumbs.duration = duration;
    entry.thumbs.peaks = peaks;
    entry.thumbs.status = 'ready';
    notify();
  } catch {
    entry.thumbs.status = 'error';
    notify();
  }
}

async function loadImageFrame(
  url: string,
  entry: Entry,
  notify: () => void,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('image load failed')), { once: true });
    });
    if (!isCurrent()) return;
    entry.thumbs.aspect =
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight
        : 1;
    entry.thumbs.frames.push({
      time: 0,
      image: captureFrame(image, image.naturalWidth, image.naturalHeight),
    });
    entry.thumbs.status = 'ready';
    notify();
  } catch {
    entry.thumbs.status = 'error';
    notify();
  }
}

/**
 * Builds and caches iMovie-style filmstrip frames per source. Videos are
 * sampled at evenly-spaced times; images produce a single frame. Decoding is
 * async and cached by source id (keyed on the resolved URL so a changed source
 * regenerates); `notify` fires as frames become available so the canvas can
 * repaint.
 */
export function createThumbnailStore(notify: () => void): ThumbnailStore {
  const entries = new Map<string, Entry>();
  const map = new Map<string, SourceThumbnails>();
  let disposed = false;

  const ensure = (doc: SpaceTimeDoc) => {
    if (disposed) return;
    const seen = new Set<string>();
    for (const clip of doc.clips) {
      const sourceId = clip.sourceId;
      const source = doc.sources[sourceId];
      if (!source) continue;
      seen.add(sourceId);
      const url = resolveSourceUrl(source.url);
      const existing = entries.get(sourceId);
      if (existing && existing.url === url) continue;
      if (existing) existing.cleanup?.();

      const thumbs: SourceThumbnails = {
        status: 'loading',
        type: source.type,
        aspect: source.type === 'image' ? 1 : 16 / 9,
        duration: 0,
        frames: [],
        peaks: [],
      };
      const entry: Entry = { url, thumbs };
      entries.set(sourceId, entry);
      map.set(sourceId, thumbs);
      const isCurrent = () => !disposed && entries.get(sourceId) === entry;
      if (source.type === 'video') {
        void loadVideoFrames(url, entry, notify, isCurrent);
      } else if (source.type === 'audio') {
        void loadAudioPeaks(url, entry, notify, isCurrent);
      } else {
        void loadImageFrame(url, entry, notify, isCurrent);
      }
    }

    // Drop sources no longer referenced by any clip.
    for (const [sourceId, entry] of entries) {
      if (!seen.has(sourceId)) {
        entry.cleanup?.();
        entries.delete(sourceId);
        map.delete(sourceId);
      }
    }
  };

  const dispose = () => {
    disposed = true;
    for (const entry of entries.values()) entry.cleanup?.();
    entries.clear();
    map.clear();
  };

  return { ensure, map, dispose };
}
