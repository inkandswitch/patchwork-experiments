import type { AutomergeUrl } from '@automerge/automerge-repo';
import * as core from '@diffusionstudio/core';

import type { Clip, Playhead, SpaceTimeDoc, Source } from '../types';
import {
  clipSequenceTime,
  clipToDiffusionTiming,
  clipWidth,
  resolveClipPlayDuration,
} from '../clip-timing';
import { isDocEmpty, resolveSourceMimeType, resolveSourceUrl } from '../helpers';
import { CLIP_HEIGHT, rangesOverlap } from '../canvas/constants';

type LoadedSource = core.BaseSource;

type PatchworkFileDoc = {
  content: Uint8Array;
  mimeType?: string;
};

export type ClipTimingInfo = {
  playDuration: number;
  sourceLength: number | undefined;
};

export async function safeCompositionUpdate(composition: core.Composition): Promise<void> {
  try {
    await composition.update();
  } catch (error) {
    console.warn('[space-time] composition update failed', error);
  }
}

export type SourceLoader = {
  load(source: Source, sourceId: string): Promise<LoadedSource>;
};

const sourceCache = new Map<string, LoadedSource>();
const recordingBlobCache = new Map<string, Blob>();

function sourceCacheKey(sourceId: string, url: string): string {
  return `${sourceId}\0${url}`;
}

/** Keep recorded bytes available for immediate playback before repo fetch settles. */
export function registerRecordingBlob(automergeUrl: string, blob: Blob): void {
  recordingBlobCache.set(automergeUrl, blob);
}

async function resolveSourceInput(source: Source): Promise<string | Blob> {
  const cachedBlob = recordingBlobCache.get(source.url);
  if (cachedBlob) return cachedBlob;

  if (source.url.startsWith('automerge:')) {
    const repo = window.repo;
    if (repo) {
      try {
        const handle = await repo.find(source.url as AutomergeUrl);
        const fileDoc = handle.doc() as PatchworkFileDoc | undefined;
        if (fileDoc?.content) {
          return new Blob([fileDoc.content], {
            type: fileDoc.mimeType || resolveSourceMimeType(source),
          });
        }
      } catch (error) {
        console.warn('[space-time] failed to load automerge file from repo', error);
      }
    }
  }

  return resolveSourceUrl(source.url);
}

async function loadSource(source: Source): Promise<LoadedSource> {
  const input = await resolveSourceInput(source);
  const mimeType = resolveSourceMimeType(source);
  switch (source.type) {
    case 'video':
      return core.Source.from<core.VideoSource>(input, { mimeType });
    case 'audio':
      return core.Source.from<core.AudioSource>(input, { mimeType });
    case 'image':
      return core.Source.from<core.ImageSource>(input, { mimeType });
  }
}

async function getOrLoadSource(sourceDef: Source, sourceId: string): Promise<LoadedSource> {
  const key = sourceCacheKey(sourceId, sourceDef.url);
  const cached = sourceCache.get(key);
  if (cached) return cached;

  const loaded = await loadSource(sourceDef);
  sourceCache.set(key, loaded);
  return loaded;
}

export function createSourceLoader(): SourceLoader {
  return {
    async load(source, sourceId) {
      return getOrLoadSource(source, sourceId);
    },
  };
}

function sourceLength(source: LoadedSource, type: Source['type']): number | undefined {
  if (type === 'image') return undefined;
  if ('duration' in source && typeof source.duration === 'number') {
    return source.duration;
  }
  return undefined;
}

function applyClipTiming(
  dscClip: core.Clip,
  clip: Clip,
  sourceType: Source['type'],
  playDuration: number,
): void {
  if (sourceType === 'image') {
    dscClip.delay = clipSequenceTime(clip);
    dscClip.duration = playDuration;
    return;
  }

  const { delay, range } = clipToDiffusionTiming(clip, playDuration);
  dscClip.delay = delay;
  if (sourceType === 'video') {
    (dscClip as core.VideoClip).range = range;
  } else {
    (dscClip as core.AudioClip).range = range;
  }
}

async function createDscClip(
  source: LoadedSource,
  sourceType: Source['type'],
): Promise<core.Clip> {
  switch (sourceType) {
    case 'video':
      return new core.VideoClip(source as core.VideoSource, {
        position: 'center',
        height: '100%',
      });
    case 'audio':
      return new core.AudioClip(source as core.AudioSource);
    case 'image':
      return new core.ImageClip(source as core.ImageSource, {
        position: 'center',
        height: '100%',
      });
  }
}

export type ClipTimingOverride = {
  x: number;
  duration: number;
  sourceInTime?: number | null;
};

function effectiveClip(clip: Clip, override: ClipTimingOverride | undefined): Clip {
  if (!override) return clip;
  return {
    ...clip,
    x: override.x,
    duration: override.duration,
    sourceInTime: override.sourceInTime !== undefined ? override.sourceInTime : clip.sourceInTime,
  };
}

function clipOverlapsPlayheadVertically(clip: Clip, playhead: Playhead): boolean {
  return rangesOverlap(
    clip.y,
    clip.y + CLIP_HEIGHT,
    playhead.y,
    playhead.y + playhead.height,
  );
}

function maxEndXForTouchableClips(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo>,
): number {
  let max = playhead.x;
  for (const clip of doc.clips) {
    if (!clipOverlapsPlayheadVertically(clip, playhead)) continue;
    const playDuration = resolveClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
    max = Math.max(max, clip.x + clipWidth(clip, playDuration));
  }
  return max;
}

function clipOverlapsPlayheadRegion(
  clip: Clip,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo>,
  maxEndX: number,
): boolean {
  if (!clipOverlapsPlayheadVertically(clip, playhead)) return false;
  const playDuration = resolveClipPlayDuration(clip, timing.get(clip.id)?.sourceLength);
  const width = clipWidth(clip, playDuration);
  return rangesOverlap(clip.x, clip.x + width, playhead.x, maxEndX);
}

function touchableClipsForPlayhead(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo>,
): Clip[] {
  const maxEndX = maxEndXForTouchableClips(doc, playhead, timing);
  return doc.clips
    .filter((clip) => clipOverlapsPlayheadRegion(clip, playhead, timing, maxEndX))
    .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
}

/** Clips inside the active playhead's vertical band and horizontal extent. */
export function clipsInPlayheadExtent(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo>,
): Clip[] {
  return touchableClipsForPlayhead(doc, playhead, timing);
}

export function playheadCompositionStructureKey(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo>,
): string {
  const touchable = touchableClipsForPlayhead(doc, playhead, timing);

  return JSON.stringify({
    playheadId: playhead.id,
    clips: touchable.map((clip) => `${clip.id}:${clip.sourceId}`),
  });
}

type PreparedPlayheadClip = {
  dscClip: core.Clip;
};

async function preparePlayheadClip(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  clip: Clip,
  loader: SourceLoader,
  timing: Map<string, ClipTimingInfo>,
  overrides?: ReadonlyMap<string, ClipTimingOverride>,
): Promise<PreparedPlayheadClip | null> {
  const timingClip = effectiveClip(clip, overrides?.get(clip.id));
  const sourceDef = doc.sources[timingClip.sourceId];
  if (!sourceDef) return null;

  const source = await loader.load(sourceDef, timingClip.sourceId);
  const length = sourceLength(source, sourceDef.type);
  const playDuration = resolveClipPlayDuration(timingClip, length);
  const dscClip = await createDscClip(source, sourceDef.type);
  applyClipTiming(dscClip, timingClip, sourceDef.type, playDuration);
  dscClip.data = { clipId: timingClip.id, sourceId: timingClip.sourceId, playheadId: playhead.id };
  return { dscClip };
}

export async function syncPlayheadComposition(
  composition: core.Composition,
  doc: SpaceTimeDoc,
  playhead: Playhead,
  loader: SourceLoader,
  timing: Map<string, ClipTimingInfo>,
  overrides?: ReadonlyMap<string, ClipTimingOverride>,
): Promise<{ empty: boolean; duration: number }> {
  try {
    if (composition.playing) await composition.pause();
  } catch (error) {
    console.warn('[space-time] composition pause before sync failed', error);
  }

  const touchable = touchableClipsForPlayhead(doc, playhead, timing);
  if (touchable.length === 0) {
    composition.clear();
    await safeCompositionUpdate(composition);
    return { empty: true, duration: 0 };
  }

  const prepared: PreparedPlayheadClip[] = [];
  for (const clip of touchable) {
    const item = await preparePlayheadClip(doc, playhead, clip, loader, timing, overrides);
    if (item) prepared.push(item);
  }

  if (prepared.length === 0) {
    composition.clear();
    await safeCompositionUpdate(composition);
    return { empty: true, duration: 0 };
  }

  composition.clear();
  for (let trackIndex = 0; trackIndex < prepared.length; trackIndex++) {
    const layer = await composition.add(new core.Layer({ mode: 'DEFAULT' }), trackIndex);
    await layer.add(prepared[trackIndex]!.dscClip);
  }

  await composition.update();
  return { empty: false, duration: composition.duration };
}

export async function updatePlayheadCompositionTiming(
  composition: core.Composition,
  doc: SpaceTimeDoc,
  playhead: Playhead,
  loader: SourceLoader,
  timing: Map<string, ClipTimingInfo>,
  overrides?: ReadonlyMap<string, ClipTimingOverride>,
): Promise<{ empty: boolean; duration: number }> {
  const touchable = touchableClipsForPlayhead(doc, playhead, timing);
  if (touchable.length === 0) {
    composition.clear();
    await safeCompositionUpdate(composition);
    return { empty: true, duration: 0 };
  }

  const touchableIds = new Set(touchable.map((clip) => clip.id));
  const compositionClipIds = new Set(
    composition.clips
      .map((dscClip) => dscClip.data['clipId'])
      .filter((clipId): clipId is string => typeof clipId === 'string'),
  );
  const sameClipSet =
    touchableIds.size === compositionClipIds.size &&
    [...touchableIds].every((clipId) => compositionClipIds.has(clipId));

  if (!sameClipSet) {
    return syncPlayheadComposition(composition, doc, playhead, loader, timing, overrides);
  }

  const byClipId = new Map<string, core.Clip>();
  for (const dscClip of composition.clips) {
    const clipId = dscClip.data['clipId'];
    if (typeof clipId === 'string') byClipId.set(clipId, dscClip);
  }

  for (const clip of touchable) {
    const dscClip = byClipId.get(clip.id);
    const sourceDef = doc.sources[clip.sourceId];
    if (!dscClip || !sourceDef) continue;

    const timingClip = effectiveClip(clip, overrides?.get(clip.id));
    const source = await loader.load(sourceDef, timingClip.sourceId);
    const length = sourceLength(source, sourceDef.type);
    const playDuration = resolveClipPlayDuration(timingClip, length);
    applyClipTiming(dscClip, timingClip, sourceDef.type, playDuration);
  }

  await composition.update();
  return { empty: false, duration: composition.duration };
}

export async function resolveClipTiming(
  clip: Clip,
  doc: SpaceTimeDoc,
  loader: SourceLoader,
): Promise<ClipTimingInfo> {
  const sourceDef = doc.sources[clip.sourceId];
  if (!sourceDef) {
    return {
      playDuration: resolveClipPlayDuration(clip, undefined),
      sourceLength: undefined,
    };
  }

  try {
    const source = await loader.load(sourceDef, clip.sourceId);
    const length = sourceLength(source, sourceDef.type);
    return {
      playDuration: resolveClipPlayDuration(clip, length),
      sourceLength: length,
    };
  } catch {
    return {
      playDuration: resolveClipPlayDuration(clip, undefined),
      sourceLength: undefined,
    };
  }
}

export async function resolveAllClipTiming(
  doc: SpaceTimeDoc,
  loader: SourceLoader,
): Promise<Map<string, ClipTimingInfo>> {
  const timing = new Map<string, ClipTimingInfo>();
  await Promise.all(
    doc.clips.map(async (clip) => {
      timing.set(clip.id, await resolveClipTiming(clip, doc, loader));
    }),
  );
  return timing;
}

export function isPlayheadCompositionEmpty(
  doc: SpaceTimeDoc,
  playhead: Playhead,
  timing: Map<string, ClipTimingInfo> = new Map(),
): boolean {
  return isDocEmpty(doc) || touchableClipsForPlayhead(doc, playhead, timing).length === 0;
}

export async function loadSourceDuration(
  doc: SpaceTimeDoc,
  sourceId: string,
  loader: SourceLoader,
): Promise<number | null> {
  const sourceDef = doc.sources[sourceId];
  if (!sourceDef) return null;
  if (sourceDef.type === 'image') return null;

  try {
    const source = await loader.load(sourceDef, sourceId);
    const length = sourceLength(source, sourceDef.type);
    return length ?? null;
  } catch {
    return null;
  }
}
