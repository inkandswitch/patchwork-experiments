import type { Clip, ClipRef, SequenceDoc, Track } from './types';

export const SAMPLE_VIDEO_URL =
  'https://diffusion-studio-public.s3.eu-central-1.amazonaws.com/videos/big_buck_bunny_1080p_30fps.mp4';

export const DEFAULT_CLIP_DURATION = 10;

export function newId(): string {
  return crypto.randomUUID();
}

export function newTrack(): Track {
  return { id: newId(), clips: [] };
}

export function newClip(
  sourceId: string,
  time = 0,
  sourceInTime: number | null = null,
  duration: number | null = null,
): Clip {
  return { id: newId(), sourceId, time, sourceInTime, duration };
}

export function isSequenceEmpty(doc: SequenceDoc): boolean {
  return doc.tracks.length === 0 || doc.tracks.every((track) => track.clips.length === 0);
}

export function findTrack(doc: SequenceDoc, trackId: string): Track | undefined {
  return doc.tracks.find((track) => track.id === trackId);
}

export function findClip(doc: SequenceDoc, ref: ClipRef): Clip | undefined {
  const track = findTrack(doc, ref.trackId);
  if (!track) return undefined;
  return track.clips.find((clip) => clip.id === ref.clipId);
}

export function turnIntoSampleSequence(doc: SequenceDoc): void {
  doc.sources['sample-source-1'] = { type: 'video', url: SAMPLE_VIDEO_URL };
  doc.tracks = [
    {
      id: newId(),
      clips: [newClip('sample-source-1', 5, 10, 3)],
    },
    {
      id: newId(),
      clips: [newClip('sample-source-1')],
    },
  ];
}
