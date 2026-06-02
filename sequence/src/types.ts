export type SequenceDoc = {
  '@patchwork': { type: 'sequence' };
  title: string;
  sources: Record<string, Source>;
  tracks: Track[];
};

export type Source = {
  type: 'image' | 'video' | 'audio';
  url: string;
};

export type Track = {
  clips: Clip[];
};

export type Clip = {
  sourceId: string;
  inTime: number | null; // null means right after the end of the previous clip
  duration: number | null; // null means use the entire source
};
