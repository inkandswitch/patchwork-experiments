import type { Clip, PostIt, Scribble, SpaceTimeDoc, Source } from './types';
import { POST_IT_HEIGHT, POST_IT_WIDTH } from './canvas/constants';

export const DEFAULT_IMAGE_DURATION = 5;

export function newId(): string {
  return crypto.randomUUID();
}

export function newClip(
  sourceId: string,
  x = 0,
  y = 0,
  sourceInTime: number | null = null,
  duration: number | null = null,
): Clip {
  return { id: newId(), sourceId, x, y, sourceInTime, duration };
}

export function newPlayhead(x: number, y: number, height: number) {
  return { id: newId(), x, y, height };
}

export function newScribble(outline: number[][]): Scribble {
  return { id: newId(), outline };
}

export function newPostIt(x: number, y: number): PostIt {
  return {
    id: newId(),
    x,
    y,
    width: POST_IT_WIDTH,
    height: POST_IT_HEIGHT,
    text: '',
  };
}

export function findScribble(doc: SpaceTimeDoc, scribbleId: string): Scribble | undefined {
  return doc.scribbles?.find((scribble) => scribble.id === scribbleId);
}

export function findPostIt(doc: SpaceTimeDoc, postItId: string): PostIt | undefined {
  return doc.postIts?.find((postIt) => postIt.id === postItId);
}

export function isDocEmpty(doc: SpaceTimeDoc): boolean {
  return doc.clips.length === 0;
}

export function findClip(doc: SpaceTimeDoc, clipId: string): Clip | undefined {
  return doc.clips.find((clip) => clip.id === clipId);
}

export function findPlayhead(doc: SpaceTimeDoc, playheadId: string) {
  return doc.playheads.find((ph) => ph.id === playheadId);
}

export function defaultSourceName(index: number): string {
  return `Source ${index + 1}`;
}

export function sourceDisplayName(source: Source | undefined, sourceIndex: number): string {
  return source?.name?.trim() || defaultSourceName(sourceIndex);
}

export function sourceIndexInDoc(doc: SpaceTimeDoc, sourceId: string): number {
  const index = Object.keys(doc.sources).indexOf(sourceId);
  return index >= 0 ? index : 0;
}

export function clipDisplayName(doc: SpaceTimeDoc, clip: Clip): string {
  if (clip.name?.trim()) return clip.name.trim();
  const source = doc.sources[clip.sourceId];
  return sourceDisplayName(source, sourceIndexInDoc(doc, clip.sourceId));
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?|#|$)/i;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

/** Resolve automerge file URLs through the Patchwork service worker. */
export function resolveSourceUrl(url: string): string {
  if (url.startsWith('automerge:')) {
    return `/${encodeURIComponent(url)}/`;
  }
  return url;
}

function extensionFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return match?.[1]?.toLowerCase() ?? null;
  }
}

export function inferSourceTypeFromUrl(url: string): Source['type'] | null {
  if (IMAGE_EXT.test(url)) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  if (AUDIO_EXT.test(url)) return 'audio';
  return null;
}

export function inferMimeTypeFromUrl(url: string, type: Source['type']): string {
  const ext = extensionFromUrl(url);
  if (type === 'video') {
    return (ext && VIDEO_MIME_BY_EXT[ext]) || 'video/mp4';
  }
  if (type === 'audio') {
    return (ext && AUDIO_MIME_BY_EXT[ext]) || 'audio/webm';
  }
  return (ext && IMAGE_MIME_BY_EXT[ext]) || 'image/jpeg';
}

export function resolveSourceMimeType(source: Source): string {
  if (source.mimeType?.trim()) return source.mimeType.trim();
  return inferMimeTypeFromUrl(source.url, source.type);
}

export function addSourceFromUrl(doc: SpaceTimeDoc, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const type = inferSourceTypeFromUrl(trimmed);
  if (!type) return null;

  const id = newId();
  doc.sources[id] = { type, url: trimmed };
  return id;
}

export function addAudioSource(
  doc: SpaceTimeDoc,
  url: string,
  name = 'Recording',
  mimeType?: string,
): string {
  const id = newId();
  doc.sources[id] = { type: 'audio', url, name, ...(mimeType ? { mimeType } : {}) };
  return id;
}

export function copyClip(clip: Clip): Clip {
  return {
    id: clip.id,
    name: clip.name,
    sourceId: clip.sourceId,
    x: clip.x,
    y: clip.y,
    sourceInTime: clip.sourceInTime,
    duration: clip.duration,
  };
}

export function cloneClip(clip: Clip): Clip {
  return { ...copyClip(clip), id: newId() };
}
