import * as core from '@diffusionstudio/core';

import type { Clip, SequenceDoc, Source, Track } from '../types';
import {
  clipToDiffusionTiming,
  resolveClipPlayDuration,
} from '../clip-timing';
import { isSequenceEmpty } from '../helpers';

type LoadedSource = core.BaseSource;

export type ClipTimingInfo = {
  playDuration: number;
  sourceLength: number | undefined;
};

export type SourceLoader = {
  load(source: Source, sourceId: string): Promise<LoadedSource>;
};

const sourceCache = new Map<string, LoadedSource>();

// One loaded source per sourceId+url. DSC clips share sources; trim/offset live on each clip's delay/range.

function sourceCacheKey(sourceId: string, url: string): string {
  return `${sourceId}\0${url}`;
}

async function getOrLoadSource(sourceDef: Source, sourceId: string): Promise<LoadedSource> {
  const key = sourceCacheKey(sourceId, sourceDef.url);
  const cached = sourceCache.get(key);
  if (cached) return cached;

  const loaded = await loadSource(sourceDef);
  await loaded.init();
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

async function loadSource(source: Source): Promise<LoadedSource> {
  switch (source.type) {
    case 'video':
      return core.Source.from<core.VideoSource>(source.url);
    case 'audio':
      return core.Source.from<core.AudioSource>(source.url);
    case 'image':
      return core.Source.from<core.ImageSource>(source.url);
  }
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
    dscClip.delay = clip.time;
    dscClip.duration = playDuration;
    return;
  }

  const { delay, range } = clipToDiffusionTiming(clip, playDuration);
  dscClip.delay = delay;
  (dscClip as core.AudioClip).range = range;
}

async function createClip(
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

async function syncTrack(
  composition: core.Composition,
  track: Track,
  trackIndex: number,
  doc: SequenceDoc,
  loader: SourceLoader,
): Promise<void> {
  if (track.clips.length === 0) return;

  // Index 0 is the top layer in Diffusion Studio; earlier tracks should shadow later ones.
  const layer = await composition.add(new core.Layer({ mode: 'DEFAULT' }), trackIndex);

  for (const clip of track.clips) {
    const sourceDef = doc.sources[clip.sourceId];
    if (!sourceDef) {
      throw new Error(`Missing source "${clip.sourceId}" for clip ${clip.id}`);
    }

    const source = await loader.load(sourceDef, clip.sourceId);
    const length = sourceLength(source, sourceDef.type);
    const playDuration = resolveClipPlayDuration(clip, length);
    const dscClip = await createClip(source, sourceDef.type);
    applyClipTiming(dscClip, clip, sourceDef.type, playDuration);
    dscClip.data = { trackId: track.id, clipId: clip.id, sourceId: clip.sourceId };
    await layer.add(dscClip);
  }
}

/** Rebuild composition layers from the Automerge sequence document. */
export async function syncCompositionFromDoc(
  composition: core.Composition,
  doc: SequenceDoc,
  loader: SourceLoader,
): Promise<{ empty: boolean; duration: number }> {
  composition.clear();

  if (isSequenceEmpty(doc)) {
    await composition.update();
    return { empty: true, duration: 0 };
  }

  for (let trackIndex = 0; trackIndex < doc.tracks.length; trackIndex++) {
    await syncTrack(composition, doc.tracks[trackIndex]!, trackIndex, doc, loader);
  }

  await composition.update();
  return { empty: false, duration: composition.duration };
}

/**
 * Signature of everything that requires a full composition rebuild: track order
 * and the clips (and their sources) on each track. Pure timing edits (moving a
 * clip along its track, resizing, trimming) do NOT change this signature and can
 * be applied in place without clearing the canvas.
 */
export function compositionStructureKey(doc: SequenceDoc): string {
  return JSON.stringify({
    tracks: doc.tracks.map((track) => ({
      id: track.id,
      clips: track.clips.map((clip) => `${clip.id}:${clip.sourceId}`),
    })),
    sources: Object.fromEntries(
      Object.entries(doc.sources).map(([id, source]) => [id, source.type]),
    ),
  });
}

/**
 * Update the timing (delay/range/duration) of already-mounted clips without
 * clearing the composition, so the monitor keeps showing frames while clips are
 * being dragged/trimmed instead of flashing black. Assumes the composition's
 * structure matches `doc` (see `compositionStructureKey`).
 */
export async function updateCompositionTiming(
  composition: core.Composition,
  doc: SequenceDoc,
  loader: SourceLoader,
): Promise<{ empty: boolean; duration: number }> {
  const byClipId = new Map<string, core.Clip>();
  for (const dscClip of composition.clips) {
    const clipId = dscClip.data['clipId'];
    if (typeof clipId === 'string') byClipId.set(clipId, dscClip);
  }

  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const dscClip = byClipId.get(clip.id);
      const sourceDef = doc.sources[clip.sourceId];
      if (!dscClip || !sourceDef) continue;

      const source = await loader.load(sourceDef, clip.sourceId);
      const length = sourceLength(source, sourceDef.type);
      const playDuration = resolveClipPlayDuration(clip, length);
      applyClipTiming(dscClip, clip, sourceDef.type, playDuration);
    }
  }

  await composition.update();
  return { empty: isSequenceEmpty(doc), duration: composition.duration };
}

export async function resolveClipTiming(
  clip: Clip,
  doc: SequenceDoc,
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

/** Resolve timeline layout timing for all clips (may load sources). */
export async function resolveTimelineClipTiming(
  doc: SequenceDoc,
  loader: SourceLoader,
): Promise<Map<string, ClipTimingInfo>> {
  const timing = new Map<string, ClipTimingInfo>();

  await Promise.all(
    doc.tracks.flatMap((track) =>
      track.clips.map(async (clip) => {
        timing.set(clip.id, await resolveClipTiming(clip, doc, loader));
      }),
    ),
  );

  return timing;
}
