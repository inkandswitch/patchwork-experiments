export type SpaceTimeDoc = {
  '@patchwork': { type: 'space-time' };
  title: string;
  sources: Record<string, Source>;
  clips: Clip[];
  playheads: Playhead[];
};

export type Source = {
  type: 'image' | 'video' | 'audio';
  url: string;
  name?: string;
  /** Stored for automerge recordings where the URL has no file extension. */
  mimeType?: string;
};

export type Clip = {
  id: string;
  name?: string;
  sourceId: string;
  /** Canvas left edge in pixels; x / PIXELS_PER_SECOND = sequence time. */
  x: number;
  /** Canvas top edge in pixels; smaller y = higher on screen. */
  y: number;
  sourceInTime: number | null;
  duration: number | null;
};

export type Playhead = {
  id: string;
  x: number;
  y: number;
  height: number;
};
