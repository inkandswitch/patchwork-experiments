export type SpaceTimeDoc = {
  '@patchwork': { type: 'space-time' };
  title: string;
  sources: Record<string, Source>;
  clips: Clip[];
  playheads: Playhead[];
  scribbles?: Scribble[];
  postIts?: PostIt[];
  embeds?: Embed[];
  /** Free-floating images placed on the canvas (moodboard decoration). */
  images?: InlineImage[];
};

/** An image source shown inline on the canvas (not on the timeline). */
export type InlineImage = {
  id: string;
  /** References an image entry in `sources`. */
  sourceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** An embedded Patchwork document rendered as a movable/resizable window. */
export type Embed = {
  id: string;
  /** automerge: URL of the embedded document. */
  docUrl: string;
  /** Optional tool id; when absent the document's default tool is used. */
  toolId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Zoom applied to the embedded content (independent of canvas zoom). */
  contentScale?: number;
};

export type Scribble = {
  id: string;
  /** Closed polygon outline in page space from perfectfreehand. */
  outline: number[][];
};

export type PostIt = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
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
  /**
   * Marker times in seconds into the source (FCP-style). Always kept within the
   * clip's visible [sourceIn, sourceIn+duration] window — trimming cannot hide them.
   */
  markers?: number[];
};

export type Playhead = {
  id: string;
  x: number;
  y: number;
  height: number;
};
