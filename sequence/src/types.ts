export type SequenceDoc = {
  '@patchwork': { type: 'sequence' };
  title: string;
  sources: Record<string, Source>;
  tracks: Track[];
};

export type Source = {
  type: 'image' | 'video' | 'audio';
  url: string;
  name?: string;
};

export type Track = {
  id: string;
  clips: Clip[];
};

export type Clip = {
  id: string;
  name?: string;
  sourceId: string;
  /** Seconds from the start of the sequence where this clip starts. */
  time: number;
  /** Seconds of source media to skip from the beginning; null means no skip. */
  sourceInTime: number | null;
  /** Seconds from sourceInTime; null means use the remainder of the source.  */
  duration: number | null;
};

export type ClipRef = {
  trackId: string;
  clipId: string;
};
