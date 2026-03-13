import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { NetState, TokenState, TokenInstance } from './lib';

export type { NetState, TokenState, TokenInstance };

export type CanvasToken = {
  id: string;
  state: TokenState;
  x: number;
  y: number;
};

export type P3NetDoc = {
  '@patchwork': {
    type: 'p3net';
    suggestedImportUrl?: string;
  };
  sourceUrl: AutomergeUrl;
  tokens: NetState;       // place-indexed; participates in step/reset
  canvas: CanvasToken[];  // floating tokens; do not fire transitions
};

export type SourceDoc = {
  name: string;
  extension: string;
  mimeType: string;
  content: string;
};
